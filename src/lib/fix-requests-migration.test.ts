import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/* 20261112100000_fix_requests.sql cannot run in CI (the owner pastes it in the Supabase SQL editor), so its
   load-bearing lines are pinned here: the table closed to every client role with row security on, every
   function checking its caller inside and closed to anon, the limits matching the website, and the rollback
   lines kept in the header. */

const FILE = '20261112100000_fix_requests.sql';
const raw = readFileSync(`supabase/migrations/${FILE}`, 'utf8').replace(/\r\n/g, '\n');
const sql = raw
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

const FUNCTIONS = [
  'request_submit(text, text, text, text)',
  'request_my_list()',
  'hod_request_list(text)',
  'hod_request_counts()',
  'hod_request_decide(uuid, boolean, text)',
];

/** The text of one function, from its create line to the next create or the end. */
function body(name: string): string {
  const start = sql.indexOf(`create function public.${name}(`);
  expect(start, name).toBeGreaterThan(-1);
  const next = sql.indexOf('create function public.', start + 10);
  return sql.slice(start, next === -1 ? undefined : next);
}

describe('fix requests migration', () => {
  it('is one transaction, safe to run twice', () => {
    expect(sql.trimStart().startsWith('begin;')).toBe(true);
    expect(sql.trimEnd().endsWith('commit;')).toBe(true);
    expect(sql).toContain('create table if not exists public.fix_requests');
    expect(sql.match(/create index if not exists/g)?.length).toBe(2);
    for (const f of FUNCTIONS) expect(sql, f).toContain(`drop function if exists public.${f};`);
  });

  it('keeps the rollback lines in its header, one for each thing it makes', () => {
    const header = raw.slice(0, raw.indexOf('begin;'));
    expect(header).toContain('ROLLBACK');
    for (const f of FUNCTIONS) expect(header, f).toContain(`drop function if exists public.${f};`);
    expect(header).toContain('drop table if exists public.fix_requests;');
    expect(header).toContain("delete from public.log_action_catalog where action in ('hod_request_approve', 'hod_request_reject');");
  });

  it('has the columns the owner asked for, with the states and kinds checked', () => {
    for (const c of [
      'id               uuid primary key default gen_random_uuid()',
      'created_at       timestamptz not null default now()',
      'raised_by        uuid references auth.users (id) on delete set null',
      'raised_by_name',
      'raised_as        text not null check (raised_as in (\'member\', \'hod\'))',
      'kind             text not null check (kind in (\'bug\', \'edit\'))',
      'title            text not null check (char_length(title) between 3 and 120)',
      'char_length(details) <= 4000',
      'char_length(page_path) <= 300',
      "check (status in ('waiting_for_hod', 'approved', 'rejected', 'in_progress', 'done'))",
      'decided_by       uuid',
      'decided_at       timestamptz',
      'char_length(decision_note) <= 500',
      'claude_note',
      'done_at          timestamptz',
    ]) {
      expect(sql, c).toContain(c);
    }
    // The sender's account can be deleted later, so the column must allow null.
    expect(sql).not.toMatch(/raised_by\s+uuid not null/);
    expect(sql).toContain('create index if not exists fix_requests_status_created_idx on public.fix_requests (status, created_at);');
  });

  it('closes the table to every client role with row security on, and grants nothing on it', () => {
    expect(sql).toContain('alter table public.fix_requests enable row level security;');
    for (const role of ['public', 'anon', 'authenticated']) expect(sql).toContain(`revoke all on table public.fix_requests from ${role};`);
    expect(sql).not.toMatch(/grant [^;]*on (table )?public\.fix_requests/i);
  });

  it('lets a person read only their own rows, and an HOD or admin read all, as a second lock', () => {
    expect(sql).toContain('using (raised_by = (select auth.uid()))');
    expect(sql).toContain('using (public.is_hod())');
    expect(sql.match(/create policy/g)?.length).toBe(2);
    // No policy for writing: nothing but the functions can change a row.
    expect(sql).not.toMatch(/create policy[^;]*for (insert|update|delete|all)/i);
  });

  it('revokes every function from public, anon and authenticated by name, then grants authenticated only', () => {
    for (const f of FUNCTIONS) expect(sql, f).toContain(`'public.${f}'`);
    expect(sql).toContain("execute format('revoke all on function %s from public, anon, authenticated', f);");
    expect(sql).toContain("execute format('grant execute on function %s to authenticated', f);");
    expect(sql).not.toMatch(/grant execute[^;]*to (anon|public)/i);
  });

  it('makes every function security definer with its search path set', () => {
    for (const f of FUNCTIONS) {
      const name = f.slice(0, f.indexOf('('));
      const b = body(name);
      expect(b, name).toContain('security definer');
      expect(b, name).toContain("set search_path to 'public', 'pg_temp'");
    }
  });

  it('refuses the wrong caller inside every function with 42501 Not authorized', () => {
    for (const f of FUNCTIONS) {
      const name = f.slice(0, f.indexOf('('));
      const b = body(name);
      expect(b, name).toContain("raise exception 'Not authorized' using errcode = '42501'");
    }
    expect(body('request_submit')).toContain('public.is_paper_checker() or public.is_hod()');
    for (const n of ['hod_request_list', 'hod_request_counts', 'hod_request_decide']) expect(body(n), n).toContain('not public.is_hod()');
    expect(body('request_my_list')).toContain('auth.uid() is null');
    expect(body('request_my_list')).toContain('r.raised_by = auth.uid()');
  });

  it('starts a member request waiting for the HOD and an HOD request approved', () => {
    const b = body('request_submit');
    expect(b).toContain("case when v_hod then 'hod' else 'member' end");
    expect(b).toContain("case when v_hod then 'approved' else 'waiting_for_hod' end");
  });

  it('checks lengths with plain sentences (22023) and limits a person to 10 a day', () => {
    const b = body('request_submit');
    expect(b.match(/using errcode = '22023'/g)?.length).toBe(4);
    expect(b).toContain('Give the request a short title, at least 3 letters.');
    expect(b).toContain('The title is too long. Keep it under 120 letters.');
    expect(b).toContain('The details are too long. Keep them under 4000 letters.');
    expect(b).toContain("interval '24 hours'");
    expect(b).toContain(">= 10 then");
    expect(b).toContain("using errcode = '54000'");
    expect(b).toContain('pg_advisory_xact_lock');
  });

  it('lists at most 200 for the HOD, newest first, and refuses a made-up status', () => {
    const b = body('hod_request_list');
    expect(b).toContain('order by r.created_at desc');
    expect(b).toContain('limit 200');
    expect(b).toContain("p_status not in ('waiting_for_hod', 'approved', 'rejected', 'in_progress', 'done')");
  });

  it('decides only a waiting request, needs a reason to reject, and keeps an HOD from approving their own', () => {
    const b = body('hod_request_decide');
    expect(b).toContain('for update');
    expect(b).toContain("if v_row.status <> 'waiting_for_hod' then");
    expect(b).toContain('Say in a few words why this is not going ahead.');
    expect(b).toContain('v_row.raised_by is not distinct from v_uid and not public.is_admin()');
    expect(b).toContain("case when p_approve then 'approved' else 'rejected' end");
    expect(b).toContain('decided_by = v_uid, decided_at = now(), decision_note = v_note');
  });

  it('writes the decision to the History log and labels both actions', () => {
    const b = body('hod_request_decide');
    expect(b).toContain('insert into public.audit_review_log');
    expect(b).toContain("'hod_request_approve'");
    expect(b).toContain("'hod_request_reject'");
    expect(sql).toContain('insert into public.log_action_catalog');
    expect(sql).toContain('on conflict (action) do nothing;');
  });

  it('the website limits match the database', async () => {
    const { TITLE_MIN, TITLE_MAX, DETAILS_MAX, NOTE_MAX, PAGE_MAX, DAILY_LIMIT } = await import('@/lib/fix-requests');
    expect([TITLE_MIN, TITLE_MAX, DETAILS_MAX, NOTE_MAX, PAGE_MAX, DAILY_LIMIT]).toEqual([3, 120, 4000, 500, 300, 10]);
    expect(sql).toContain(`between ${TITLE_MIN} and ${TITLE_MAX}`);
    expect(sql).toContain(`char_length(details) <= ${DETAILS_MAX}`);
    expect(sql).toContain(`char_length(decision_note) <= ${NOTE_MAX}`);
    expect(sql).toContain(`char_length(page_path) <= ${PAGE_MAX}`);
    expect(sql).toContain(`>= ${DAILY_LIMIT} then`);
  });

  it('the website calls exactly the functions this file makes', () => {
    const api = readFileSync('src/lib/fix-requests-api.ts', 'utf8');
    const called = [...api.matchAll(/call\('([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(called).toEqual(['hod_request_counts', 'hod_request_decide', 'hod_request_list', 'request_my_list', 'request_submit']);
    for (const c of called) expect(sql).toContain(`create function public.${c}(`);
  });
});
