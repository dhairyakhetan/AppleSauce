/* Test support for 20261127130000_handout_speed.sql: two empty in-memory Postgres databases (PGlite) with the tables
   the hand-out reads, one holding the OLD functions exactly as the migrations define them, one holding the NEW
   migration on top of the same old helpers, and a seeded synthetic data set with every awkward case the picture rules
   have (parents, page fallback, held papers, live copies, set aside, wrong PDF, missing pages ...). Not shipped. */
import { readFileSync } from 'node:fs';

import { PGlite } from '@electric-sql/pglite';

export const read = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const M = 'supabase/migrations/';

/** The full text of `create or replace function public.<name>(...) ... $tag$;` from the LAST place a file defines it. */
export function fnText(file: string, name: string): string {
  const text = read(M + file);
  const start = text.lastIndexOf(`create or replace function public.${name}(`);
  if (start < 0) throw new Error(`${name} not in ${file}`);
  const open = /\bas\s+(\$[a-z_]*\$)/g;
  open.lastIndex = start;
  const m = open.exec(text);
  if (!m) throw new Error(`no body for ${name}`);
  const tag = m[1];
  const bodyStart = m.index + m[0].length;
  const close = text.indexOf(tag, bodyStart);
  return text.slice(start, close + tag.length) + ';';
}

/** The `do $patch$ ... $patch$;` block of a migration. */
export function doBlock(file: string): string {
  const text = read(M + file);
  const start = text.indexOf('do $patch$');
  return text.slice(start, text.indexOf('$patch$;', start + 12) + '$patch$;'.length);
}

const BASE = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('test.role', true), ''), 'authenticated') $$;

  create table public.audit_papers (
    id uuid primary key, source text, page_count integer, flag_reasons text[], subject text, school text, class text,
    exam_type text, year text, board text, status text, is_red boolean, red_reason text,
    created_at timestamptz not null default now(), publish_meta jsonb, live_bank_paper_id uuid, approval_state text);
  create table public.audit_questions (
    id uuid primary key, paper_id uuid not null references public.audit_papers(id), parent_id uuid, kind text,
    review_bucket text, question_passed boolean, set_aside_at timestamptz, body text, flag_detail text,
    flag_reasons text[], figure jsonb, source jsonb);
  create table public.audit_paper_pages (
    audit_paper_id uuid not null references public.audit_papers(id) on delete cascade,
    page integer not null, object_path text not null, primary key (audit_paper_id, page));
  create table public.checker_assignments (
    id bigint generated always as identity primary key, audit_paper_id uuid not null references public.audit_papers(id),
    user_id uuid not null, assigned_by uuid, status text not null default 'assigned', assigned_at timestamptz not null default now(),
    started_at timestamptz, closed_at timestamptz, closed_reason text);
  create unique index checker_assignments_one_holder on public.checker_assignments (audit_paper_id) where status in ('queued', 'assigned');
  -- (20261007130000 dropped checker_assignments_one_current: a checker may hold several papers)
  create index checker_assignments_user_status on public.checker_assignments (user_id, status, assigned_at);
  create table public.paper_checkers (user_id uuid primary key, active boolean not null default true);
  create table public.verifier_profiles (user_id uuid primary key, grade integer, board text, preferred_subjects text[], school text, valid_until date);
  create table public.admins (id uuid primary key);
  create table public.audit_review_log (id bigint generated always as identity primary key, reviewer_id uuid, actor_user_id uuid, paper_id uuid, question_id uuid, action text, note text);
  -- the indexes that exist on the real table today
  create index idx_audit_questions_open_by_paper on public.audit_questions (paper_id) where kind = 'question' and question_passed = false;
  create index idx_audit_questions_kid_ready on public.audit_questions (paper_id)
    where kind = 'question' and review_bucket = 'kid' and question_passed = false and btrim(coalesce(body, '')) <> '';

  create function public.is_hod() returns boolean language sql stable as $$ select true $$;
  create function public.verifier_return_idle() returns integer language sql as $$ select 0 $$;
  create function public.verifier_paper_cap() returns integer language sql stable as $$ select 10 $$;
  create function public.verifier_idle_days() returns integer language sql stable as $$ select 7 $$;
  create function public.subject_family(p text) returns text language sql immutable as $$ select nullif(lower(btrim(coalesce(p, ''))), '') $$;
  create function public.class_grade(p text) returns integer language sql immutable as $$ select ((regexp_match(coalesce(p, ''), '[0-9]+'))[1])::int $$;
  create function public.board_family(p text) returns text language sql immutable as $$ select nullif(lower(btrim(coalesce(p, ''))), '') $$;
`;

const OLD_HELPERS: [string, string][] = [
  ['20261003160000_checker_lanes_pictures_lost_text.sql', 'checker_body_ok'],
  ['20261126200000_page_fallback_when_not_found.sql', 'paper_all_pages_stored'],
  ['20261126200000_page_fallback_when_not_found.sql', 'checker_page_fallback_ok'],
  ['20261126200000_page_fallback_when_not_found.sql', 'checker_has_picture'],
  ['20261126200000_page_fallback_when_not_found.sql', 'checker_reference_ok'],
  ['20261103000000_reference_pages_before_serving.sql', 'checker_question_servable'],
  ['20261007150000_verifier_waiting_on_hod.sql', 'verifier_has_work'],
  ['20261112310000_request_limits_and_page_gap_check.sql', 'paper_picture_gaps'],
  ['20261106400000_papers_missing_pictures_not_assignable.sql', 'paper_pictures_complete'],
  ['20261012200000_assignment_score_helpers.sql', 'school_norm'],
  ['20261012200000_assignment_score_helpers.sql', 'assignment_points'],
  ['20261011110000_hod_assign_to_self.sql', 'hod_assign_paper'],
];
const OLD_LISTS: [string, string][] = [
  ['20261127110000_hod_sitewide_audit_fixes.sql', 'hod_unassigned_papers'],
  ['20261113310000_hod_lists_speed.sql', 'hod_held_back_papers'],
  ['20261127110000_hod_sitewide_audit_fixes.sql', 'hod_held_other_papers'],
  ['20261127110000_hod_sitewide_audit_fixes.sql', 'distribute_unassigned_papers'],
];

/** `old`: the functions as they are live today. `new`: the same helpers plus the migration (run `times` times). */
export async function makeDb(kind: 'old' | 'new', times = 1): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(BASE);
  for (const [f, n] of OLD_HELPERS) await db.exec(fnText(f, n));
  // the 6 Nov patch that put the picture rule into hod_assign_paper (distribute already carries it)
  if (kind === 'old') for (const [f, n] of OLD_LISTS) await db.exec(fnText(f, n));
  if (kind === 'new') {
    for (const [f, n] of OLD_LISTS) await db.exec(fnText(f, n));
  }
  await db.exec(doBlock('20261106400000_papers_missing_pictures_not_assignable.sql'));
  if (kind === 'new') {
    const mig = read(M + '20261127130000_handout_speed.sql');
    for (let i = 0; i < times; i++) await db.exec(mig);
  }
  return db;
}

/** Seeded data: the same script on two databases gives the same rows. `papers` papers of 20 to 60 questions each. */
export function dataSql(papers: number, checkers: number): string {
  return `
  select setseed(0.31);
  create temp table _p as
  select i, md5('p' || i)::uuid as id, random() r1, random() r2, random() r3, random() r4, random() r5, random() qual,
         (20 + floor(random() * 41))::int as nq, (4 + floor(random() * 9))::int as pc
    from generate_series(1, ${papers}) i;
  insert into public.audit_papers (id, source, page_count, flag_reasons, subject, school, class, exam_type, year, board, status, is_red, red_reason, created_at, publish_meta)
  select id,
         case when r1 < 0.07 then 'live_copy' when r1 < 0.075 then 'old_source' else 'new_ocr' end,
         case when r2 < 0.03 then null when r2 < 0.05 then 0 else pc end,
         case when r3 < 0.04 then array['pdf_mismatch'] when r3 < 0.08 then array['other_reason'] when r3 < 0.1 then null else '{}'::text[] end,
         (array['Maths','English','Physics','Chemistry','Biology','History','Geography'])[1 + (i % 7)],
         'School ' || (i % 23),
         (array['Class 6','Class 7','Class 8','Class 9','Class X','Class XII','10','12'])[1 + (i % 8)],
         'Annual', (2018 + (i % 8))::text,
         (array['ICSE','CBSE','ISC'])[1 + (i % 3)],
         case when r4 < 0.015 then 'red' else 'passed' end,
         case when r4 < 0.03 then true when r4 < 0.035 then false else null end,
         case when r4 < 0.03 then 'duplicate of something' end,
         now() - make_interval(secs => i * 60),
         jsonb_build_object('school', 'School ' || ((i + 3) % 23))
    from _p;

  -- printed pages: most papers fully stored, some missing a page, some with an empty path, some with none
  insert into public.audit_paper_pages (audit_paper_id, page, object_path)
  select p.id, pg, case when p.r5 between 0.84 and 0.88 and pg = 2 then '' else 'pages/' || p.id || '/' || pg || '.jpg' end
    from _p p cross join lateral generate_series(1, p.pc) pg
   where not (p.r5 < 0.06)
     and not (p.r5 between 0.06 and 0.14 and pg = 1 + (p.i % p.pc))
     and not (p.r5 between 0.14 and 0.17 and pg > 1);

  create temp table _q as
  select p.i as pi, p.id as paper_id, j, md5('q' || p.i || '-' || j)::uuid as id,
         random() a, random() b, random() c, random() d, random() e, random() f, random() g, random() h, random() k, random() m,
         p.pc, p.qual
    from _p p cross join lateral generate_series(1, p.nq) j;
  insert into public.audit_questions (id, paper_id, parent_id, kind, review_bucket, question_passed, set_aside_at, body, flag_detail, flag_reasons, figure, source)
  select q.id, q.paper_id,
         case when q.j > 1 and q.a < 0.22 then md5('q' || q.pi || '-' || (1 + floor(random() * (q.j - 1))::int))::uuid
              when q.j > 1 and q.a between 0.22 and 0.225 then md5('q' || (1 + (q.pi % 5)) || '-1')::uuid
              when q.a between 0.225 and 0.23 then md5('missing' || q.j)::uuid end,
         case when q.b < 0.93 then 'question' when q.b < 0.97 then 'passage' else 'instruction' end,
         case when q.c < 0.62 then 'kid' when q.c < 0.70 then 'none' when q.c < 0.78 then 'escalated'
              when q.c < 0.90 then 'admin' when q.c < 0.95 then 'data' else 'renderer' end,
         case when q.d < 0.62 then false else true end,
         case when q.e < 0.03 then now() end,
         case when q.f < 0.03 then '' when q.f < 0.05 then '   ' when q.f < 0.06 then null
              when q.f < 0.10 then 'A table of values | x | y |' when q.f < 0.14 then repeat('Long passage text. ', 25)
              when q.f < 0.17 then 'Read the table below and answer.' else 'Question text ' || q.j end,
         case when q.g < 0.02 then 'suggestion: {"body": "recovered"}' end,
         case when q.h < 0.06 then array['figure_missing']
              when q.h < 0.12 then array['incomplete_text']
              when q.h < 0.14 then array['figure_missing', 'incomplete_text']
              when q.h < 0.16 then null else '{}'::text[] end,
         case when q.k < 0.04 then '{"x": 1}'::jsonb when q.k < 0.06 then '{}'::jsonb when q.k < 0.07 then '[]'::jsonb
              when q.k < 0.08 then '""'::jsonb when q.k < 0.09 then 'null'::jsonb when q.k < 0.095 then '[1]'::jsonb end,
         case when q.m < 0.005 then null else jsonb_strip_nulls(jsonb_build_object(
           'whole_snippet_object', case when random() < 0.10 then 'snips/w.png' when random() < 0.03 then '' end,
           'snippet_object', case when random() < (case when q.qual < 0.6 then 0.995 else 0.85 end) then 'snips/' || q.j || '.png' when random() < 0.3 then '' end,
           'align_score', case when random() < 0.40 then null when random() < 0.80 then to_jsonb(round((0.9 + random() * 0.1)::numeric, 2))
                               when random() < 0.5 then to_jsonb(round((0.3 + random() * 0.6)::numeric, 2))
                               when random() < 0.6 then to_jsonb((round((0.9 + random() * 0.1)::numeric, 2))::text)
                               else to_jsonb('abc'::text) end,
           'page', case when random() < 0.25 then null when random() < 0.7 then to_jsonb(1 + floor(random() * (q.pc + 1))::int)
                        when random() < 0.5 then to_jsonb((1 + floor(random() * q.pc)::int)::text) else to_jsonb('x'::text) end,
           'page_verified', case when random() < 0.25 then null when random() < 0.65 then to_jsonb(true)
                                 when random() < 0.7 then to_jsonb(false) when random() < 0.5 then to_jsonb('true'::text) else to_jsonb('false'::text) end,
           'pipeline', case when random() < 0.03 then 'english_w14' end,
           'swarm', case when random() < 0.04 then jsonb_build_object('kind', 'passage') end)) end
    from _q q;

  -- checkers, some with a profile, some held back from the pool
  create temp table _c as select i, md5('c' || i)::uuid as id, random() r from generate_series(1, ${checkers}) i;
  insert into public.paper_checkers (user_id, active) select id, r > 0.08 from _c;
  insert into public.verifier_profiles (user_id, grade, board, preferred_subjects, school, valid_until)
  select id, case when r < 0.1 then null else 8 + (i % 5) end, (array['ICSE','CBSE','ISC'])[1 + (i % 3)],
         case when r < 0.5 then array['Maths','Physics'] when r < 0.8 then array['English'] end,
         case when r > 0.9 then 'School ' || (i % 23) end,
         case when r > 0.95 then current_date - 1 end
    from _c where r < 0.97;
  insert into public.admins (id) select id from _c where r > 0.995;

  -- about 8 percent of papers are already held: the first of each checker 'assigned', the rest 'queued'
  insert into public.checker_assignments (audit_paper_id, user_id, status, assigned_by)
  select p.id, c.id, case when row_number() over (partition by c.id order by p.i) = 1 then 'assigned' else 'queued' end, null
    from _p p join _c c on c.i = 1 + (p.i % ${checkers})
   where p.r5 > 0.92;
  -- a returned row for a paper the checker let sit
  insert into public.checker_assignments (audit_paper_id, user_id, status, closed_reason, closed_at, assigned_by)
  select p.id, c.id, 'returned', 'nothing done for 7 days, returned automatically', now() - interval '1 day', null
    from _p p join _c c on c.i = 1 + ((p.i + 1) % ${checkers})
   where p.r5 between 0.5 and 0.52
     and not exists (select 1 from public.checker_assignments x where x.audit_paper_id = p.id);
  analyze;
  `;
}

export async function ms<T>(f: () => Promise<T>): Promise<[T, number]> {
  const t = performance.now();
  const r = await f();
  return [r, performance.now() - t];
}
