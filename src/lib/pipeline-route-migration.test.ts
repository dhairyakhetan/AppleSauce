import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/* The three migrations behind the overview page cannot run in CI (no
   database), so their load-bearing lines are pinned here: both desk tables are
   closed to every API role, the route function lets HODs in and nobody else
   (42501), it is closed to anon AND authenticated by name before being granted
   back to authenticated, the earlier library's frozen copies are left out, and
   no question text is selected.

   Applied to the live project on 12 October 2026 (the apply tool stamps its own
   version) after a rolled-back rehearsal that probed anon, a student, an HOD and
   an admin. */

const read = (name: string) =>
  readFileSync(`supabase/migrations/${name}`, 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

const pictures = read('20261012500000_pipeline_picture_queue.sql');
const drive = read('20261012500050_paper_drive_summary.sql');
// The latest definition of the function: 20261012500100 made it, 20261012990000 counted it the way the owner asked.
const route = read('20261012990000_pipeline_route_owner_counts.sql');

describe('the two desk tables', () => {
  it('the picture queue is one row, with RLS on, no policy and every role revoked', () => {
    expect(pictures).toContain('id integer primary key default 1 check (id = 1)');
    expect(pictures).toContain('alter table public.pipeline_picture_queue enable row level security;');
    expect(pictures).toContain('revoke all on table public.pipeline_picture_queue from public, anon, authenticated;');
    expect(pictures).not.toMatch(/create policy/i);
    expect(pictures).not.toMatch(/grant\s/i);
    expect(pictures).toContain('desk_synced_at timestamptz not null default now()');
  });

  it('the PDF count is keyed by name, with RLS on, no policy and every role revoked', () => {
    expect(drive).toContain('key text primary key');
    expect(drive).toContain('alter table public.paper_drive_summary enable row level security;');
    expect(drive).toContain('revoke all on table public.paper_drive_summary from public, anon, authenticated;');
    expect(drive).not.toMatch(/create policy/i);
    expect(drive).not.toMatch(/grant\s/i);
  });

  it('the PDF count has the columns the desk tool writes', () => {
    for (const col of ['total_pdfs', 'classified', 'unclassified', 'set_aside', 'student_upload', 'loaded_or_live', 'bytes_total', 'by_status']) {
      expect(drive).toContain(col);
    }
  });

  it('neither table holds a name, a path or question text', () => {
    for (const sql of [pictures, drive]) {
      expect(sql).not.toMatch(/\b(body|pdf_name|path|school|title)\b/);
    }
  });
});

describe('admin_pipeline_route', () => {
  it('lets HODs in (an admin counts) and refuses everyone else with 42501', () => {
    expect(route).toContain('if not public.is_hod() then');
    expect(route).toContain("using errcode = '42501'");
    expect(route).not.toContain('is_admin()');
  });

  it('is a definer with a pinned search path, closed to anon and authenticated by name, then granted to authenticated', () => {
    expect(route).toContain('security definer');
    expect(route).toContain("set search_path to 'public', 'pg_temp'");
    expect(route).toContain('revoke all on function public.admin_pipeline_route() from public, anon, authenticated;');
    expect(route).toContain('grant execute on function public.admin_pipeline_route() to authenticated;');
    expect(route).not.toMatch(/grant execute[^;]*\bto (anon|public)\b/i);
  });

  it('leaves the frozen earlier-library copies out of every count, by the audit paper and by the registry row', () => {
    expect(route).toContain("p.source <> 'live_copy'");
    expect(route).toContain("coalesce(r.source, '') = 'live_copy'");
    // a null source must not drop a row out of both the route and the left-out count
    expect(route).not.toMatch(/[^(]r\.source = 'live_copy'/);
  });

  it('counts "open" as not passed and not set aside, in one pass shared by every block', () => {
    expect(route).toContain('with oq as materialized');
    expect(route).toContain('not coalesce(q.question_passed, false) and q.set_aside_at is null');
    expect(route).not.toContain('checker_question_servable');
  });

  it('counts the swarm only, and only for the few papers at the loaded and checked-by-the-AI stages (never every question)', () => {
    expect(route).toContain("jsonb_exists(q.source, 'swarm')");
    expect(route).toContain("r.processed_state in ('loaded', 'ai_checked')");
    expect(route).toContain("'swarm_read'");
    // the swarm test sits inside the small per-paper CTE, not in the question-wide ones
    const oq = route.slice(route.indexOf('oq as materialized'), route.indexOf('kid as materialized'));
    expect(oq).not.toContain('swarm');
  });

  it('drops the cumulative counts and the old AI-check count (current stage only)', () => {
    expect(route).not.toContain("'read_total'");
    expect(route).not.toContain("'ai_read_total'");
    expect(route).not.toContain('ai_decision');
  });

  it('counts papers with no PDF apart from the PDFs on the disk', () => {
    expect(route).toContain("'no_pdf'");
    expect(route).toContain("nullif(btrim(coalesce(p.pdf_path, '')), '') is null");
    expect(route).toContain("'live_only'");
    // the disk count is the desk's own row, passed through untouched
    expect(route).toContain("from public.paper_drive_summary d where d.key = 'latest'");
  });

  it('returns every section of the new route, and only counts', () => {
    for (const key of ["'checking'", "'needs_you'", "'ready'", "'live'", "'trust'", "'pictures'", "'drive'", "'synced'", "'swarm_read'", "'no_pdf'"]) {
      expect(route).toContain(key);
    }
    expect(route).not.toMatch(/q\.(body|options|instructions)\b/);
    expect(route).toContain('public.ai_trust_overall()');
    expect(route).toContain('public.approval_paper_checks(ap.id)');
  });
});
