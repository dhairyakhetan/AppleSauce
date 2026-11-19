import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/* 20261113200000_ask_for_papers.sql cannot run in CI (the owner pastes it in the Supabase SQL editor), so its load-bearing
   lines are pinned here: the table closed to every client role with row security on, one open ask per person enforced by
   the table, every function checking its caller inside and closed to anon, and the limits matching the website. */

const FILE = '20261113200000_ask_for_papers.sql';
const raw = readFileSync(`supabase/migrations/${FILE}`, 'utf8').replace(/\r\n/g, '\n');
const sql = raw
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

const FUNCTIONS = ['paper_ask_for_more()', 'paper_ask_mine()', 'hod_paper_asks()', 'hod_paper_ask_dismiss(uuid)'];

function body(name: string): string {
  const start = sql.indexOf(`create or replace function public.${name.split('(')[0]}(`);
  expect(start, name).toBeGreaterThan(-1);
  const next = sql.indexOf('create or replace function public.', start + 10);
  const end = next === -1 ? sql.indexOf('do $$', start) : next;
  return sql.slice(start, end === -1 ? undefined : end);
}

describe('ask for papers migration', () => {
  it('is one transaction, safe to run twice', () => {
    expect(sql.trimStart().startsWith('begin;')).toBe(true);
    expect(sql.trimEnd().endsWith('commit;')).toBe(true);
    expect(sql).toContain('create table if not exists public.paper_asks');
    expect(sql).toContain('create unique index if not exists paper_asks_one_open_idx');
  });

  it('keeps the rollback lines in its header, one for each thing it makes', () => {
    const header = raw.slice(0, raw.indexOf('begin;'));
    expect(header).toContain('ROLLBACK');
    for (const f of FUNCTIONS) expect(header, f).toContain(`drop function if exists public.${f};`);
    expect(header).toContain('drop table if exists public.paper_asks;');
  });

  it('closes the table to every client role with row security on', () => {
    expect(sql).toContain('alter table public.paper_asks enable row level security;');
    for (const role of ['public', 'anon', 'authenticated']) expect(sql).toContain(`revoke all on table public.paper_asks from ${role};`);
  });

  it('allows only one open ask per person, in the table itself', () => {
    expect(sql).toMatch(/create unique index if not exists paper_asks_one_open_idx on public\.paper_asks \(user_id\) where status = 'open';/);
  });

  it('makes every function run as owner with a fixed search path and a check of the caller inside', () => {
    for (const f of FUNCTIONS) {
      const b = body(f);
      expect(b, f).toContain('security definer');
      expect(b, f).toContain('set search_path = public, pg_temp');
      expect(b, f).toContain("errcode = '42501'");
    }
    expect(body('paper_ask_for_more()')).toContain('public.is_paper_checker()');
    expect(body('paper_ask_mine()')).toContain('public.is_paper_checker()');
    expect(body('hod_paper_asks()')).toContain('public.is_hod()');
    expect(body('hod_paper_ask_dismiss(uuid)')).toContain('public.is_hod()');
  });

  it('closes every function to anon and opens it to signed-in people only', () => {
    for (const f of FUNCTIONS) expect(sql, f).toContain(`'public.${f}'`);
    expect(sql).toContain('revoke all on function %s from public, anon, authenticated');
    expect(sql).toContain('grant execute on function %s to authenticated');
  });

  it('limits an ask the same way the website says: 3 days, 3 a day, no ask while holding a paper', () => {
    const ask = body('paper_ask_for_more()');
    expect(ask).toContain("interval '3 days'");
    expect(ask).toContain("interval '24 hours'");
    expect(ask).toContain(">= 3");
    expect(ask).toContain("errcode = '54000'");
    expect(ask).toContain("'has_work'");
    expect(ask).toContain("'already_asked'");
    expect(ask).toContain('pg_advisory_xact_lock');
  });

  it('hides a person from the HOD list once they hold a paper again, and an ask older than 3 days', () => {
    const list = body('hod_paper_asks()');
    expect(list).toContain("c.status in ('queued', 'assigned')");
    expect(list).toContain("a.asked_at > now() - interval '3 days'");
    expect(list).toContain("c.status = 'done'");
    expect(list).toContain("interval '14 days'");
  });

  it('lets an HOD clear an ask that is already gone without an error', () => {
    const d = body('hod_paper_ask_dismiss(uuid)');
    expect(d).toContain("status = 'dismissed'");
    expect(d).not.toContain('not found');
  });
});
