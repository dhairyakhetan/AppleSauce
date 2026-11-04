-- 20261012200000: two small pure helpers for smart auto-assign (HOD desk design, 2026-10-12).
--
-- school_norm(text): one spelling of a school name for comparing "is this the checker's own school".
--   Lower-cases and drops every space and punctuation mark, so "St. Xavier's  Collegiate" and "st xaviers collegiate" match.
--   A blank or all-punctuation name gives NULL, so two unknown schools never count as "the same school".
--
-- assignment_points(...): the scoring table used by distribute_unassigned_papers() and explain_assignment().
--   One place holds the numbers so the hand-out and the HOD's "why this person" explanation can never disagree.
--   Higher total = better fit. The hard rules (cap, own school, paper above the student's class, expired details,
--   frozen live_copy papers) are NOT points: they are applied by the callers before anything is scored.
--
--     subject  +60  the paper's subject family is on the checker's preferred list
--                    (0 when it is not, or when the checker set no preference: others are allowed, just lower)
--     grade    +30  paper is within two classes at or below the checker's class (a class 12 student: classes 10 to 12)
--              +15  the paper's class or the checker's class is unknown (neutral, half marks)
--                0  paper is more than two classes below the checker's class (allowed, last choice)
--                    (a paper ABOVE the checker's class gets -1000 here; callers also exclude it outright)
--     board    +20  both boards known and the same family (ICSE/ISC/CISCE are one family; CBSE and Kendriya are one)
--              -20  both known and different
--                0  either unknown
--     load      -6  for each paper the checker currently holds with open work
--               -1  for every 20 open questions they hold (counted up to 200, so at most -10)
--     mix       -2  for each held paper in the same subject family, -1 for each held paper in the same class
--                    (spreads variety; the total of this term never goes below -10)
--
-- Both are plain SQL, side-effect free, and are only called from SECURITY DEFINER functions, so they are closed to
-- every API role (revoked from public, anon and authenticated; Supabase grants function execute by role name).
-- No data row is touched.

create or replace function public.school_norm(p_school text)
returns text
language sql
immutable
set search_path to 'public', 'pg_temp'
as $fn$
  select nullif(regexp_replace(lower(coalesce(p_school, '')), '[^[:alnum:]]+', '', 'g'), '');
$fn$;

create or replace function public.assignment_points(
  p_subject text,          -- paper subject family (subject_family)
  p_paper_grade int,       -- paper class as a number, null if unknown
  p_paper_board text,      -- paper board family (board_family), null if unknown
  p_pref text[],           -- checker preferred subject families, null/empty if none
  p_grade int,             -- checker class (12 stands in when the checker never said)
  p_grade_known boolean,   -- did the checker really give a class
  p_board text,            -- checker board family, null if unknown
  p_papers int,            -- papers the checker holds now (with open work)
  p_load int,              -- open questions the checker holds now
  p_same_subject int,      -- held papers in this paper's subject family
  p_same_grade int         -- held papers in this paper's class
)
returns table(subject_pts int, grade_pts int, board_pts int, load_pts int, mix_pts int, total int)
language sql
immutable
set search_path to 'public', 'pg_temp'
as $fn$
  with x as (
    select
      case when coalesce(array_length(p_pref, 1), 0) > 0 and p_subject is not null and p_subject = any(p_pref)
           then 60 else 0 end as s,
      case when p_paper_grade is null or not coalesce(p_grade_known, false) then 15
           when p_paper_grade > p_grade then -1000
           when p_paper_grade >= p_grade - 2 then 30
           else 0 end as g,
      case when p_paper_board is null or p_board is null then 0
           when p_paper_board = p_board then 20
           else -20 end as b,
      - (6 * coalesce(p_papers, 0)) - (least(coalesce(p_load, 0), 200) / 20) as l,
      greatest(- (2 * coalesce(p_same_subject, 0)) - coalesce(p_same_grade, 0), -10) as m
  )
  select x.s, x.g, x.b, x.l, x.m, x.s + x.g + x.b + x.l + x.m from x;
$fn$;

revoke all on function public.school_norm(text) from public, anon, authenticated;
revoke all on function public.assignment_points(text, int, text, text[], int, boolean, text, int, int, int, int)
  from public, anon, authenticated;
