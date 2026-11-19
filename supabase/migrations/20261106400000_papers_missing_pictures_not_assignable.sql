-- Owner, 6 Nov 2026: "if papers dont have their supporting snips and all of the pages dont allow them to be
-- assigned show them seperately".
--
-- A paper can be given to a verifier (by the HOD or by the automatic hand-out) only when
--   1. every open question meant for verifiers has its picture (checker_has_picture), AND
--   2. every printed page of the paper is stored (audit_paper_pages vs audit_papers.page_count).
-- Papers that fall short are left out of "Papers nobody holds" and get their own list,
-- hod_held_back_papers(), that says what is missing. A paper that is ALREADY held is never taken back by this.
--
-- All live bodies are patched from the live function text (pg_get_functiondef), each patch asserted, so no
-- other behaviour changes. Settings and grants are kept by CREATE OR REPLACE. Safe to run twice.

-- 1. What is missing from one paper (internal; only other definer functions call it).
create or replace function public.paper_picture_gaps(p_paper_id uuid)
returns table(open_questions integer, missing_snips integer, pages_total integer, pages_missing integer)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    (select count(*)::int from public.audit_questions q
      where q.paper_id = ap.id and q.kind = 'question' and q.review_bucket = 'kid'
        and q.question_passed = false and q.set_aside_at is null),
    (select count(*)::int from public.audit_questions q
      where q.paper_id = ap.id and q.kind = 'question' and q.review_bucket = 'kid'
        and q.question_passed = false and q.set_aside_at is null
        and not public.checker_has_picture(q)),
    coalesce(ap.page_count, 0)::int,
    greatest(coalesce(ap.page_count, 0)
             - coalesce((select count(distinct pg.page)::int from public.audit_paper_pages pg
                          where pg.audit_paper_id = ap.id and coalesce(pg.object_path, '') <> ''), 0), 0)::int
  from public.audit_papers ap
  where ap.id = p_paper_id;
$$;

create or replace function public.paper_pictures_complete(p_paper_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select g.missing_snips = 0 and g.pages_missing = 0
                     from public.paper_picture_gaps(p_paper_id) g), false);
$$;

revoke all on function public.paper_picture_gaps(uuid) from public, anon, authenticated;
revoke all on function public.paper_pictures_complete(uuid) from public, anon, authenticated;

-- 2. "Papers nobody holds" lists only papers that are complete.
create or replace function public.hod_unassigned_papers(p_limit integer default 200)
returns table(paper_id uuid, subject text, school text, cls text, exam text, year text, open_count integer)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
#variable_conflict use_column
begin
  if not public.is_hod() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
    select c.paper_id, ap.subject, ap.school, ap.class, ap.exam_type, ap.year, c.n
    from (select q.paper_id, count(*)::int as n from public.audit_questions q
          where (q.review_bucket = 'kid' and q.question_passed = false and q.kind = 'question' and public.checker_question_servable(q)) group by q.paper_id) c
    join public.audit_papers ap on ap.id = c.paper_id
    where not exists (select 1 from public.checker_assignments a
                      where a.audit_paper_id = c.paper_id and a.status in ('queued', 'assigned'))
      and public.paper_pictures_complete(c.paper_id)
    order by ap.subject, ap.class, c.n desc
    limit greatest(1, least(coalesce(p_limit, 200), 1000));
end;
$function$;

-- 3. The separate list: papers waiting for verifiers that are not complete, and what is missing.
create or replace function public.hod_held_back_papers(p_limit integer default 200)
returns table(paper_id uuid, subject text, school text, cls text, exam text, year text,
              open_count integer, missing_snips integer, pages_total integer, pages_missing integer)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
#variable_conflict use_column
begin
  if not public.is_hod() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
    select ap.id, ap.subject, ap.school, ap.class, ap.exam_type, ap.year,
           g.open_questions, g.missing_snips, g.pages_total, g.pages_missing
    from public.audit_papers ap
    cross join lateral public.paper_picture_gaps(ap.id) g
    where ap.source in ('new_ocr', 'live_copy')
      and not ('pdf_mismatch' = any (coalesce(ap.flag_reasons, '{}'::text[])))
      and g.open_questions > 0
      and (g.missing_snips > 0 or g.pages_missing > 0)
      and not exists (select 1 from public.checker_assignments a
                      where a.audit_paper_id = ap.id and a.status in ('queued', 'assigned'))
    order by (g.missing_snips + g.pages_missing), ap.subject, ap.class, ap.id
    limit greatest(1, least(coalesce(p_limit, 200), 1000));
end;
$function$;

revoke all on function public.hod_held_back_papers(integer) from public, anon, authenticated;
grant execute on function public.hod_held_back_papers(integer) to authenticated;

-- 4. The automatic hand-out and the HOD's assign button, patched from the live text.
do $patch$
declare
  v_def text;
  v_new text;
begin
  -- 4a. distribute_unassigned_papers: only complete papers are candidates.
  select pg_get_functiondef('public.distribute_unassigned_papers()'::regprocedure) into v_def;
  if v_def !~ 'paper_pictures_complete' then
    v_new := replace(v_def, 'where ap.source is distinct from ''live_copy''',
                            'where ap.source is distinct from ''live_copy'' and public.paper_pictures_complete(c.paper_id)');
    if v_new = v_def then
      raise exception 'could not patch distribute_unassigned_papers (anchor not found)';
    end if;
    execute v_new;
  end if;

  -- 4b. hod_assign_paper: a paper nobody holds is refused while it is missing pictures or pages.
  select pg_get_functiondef('public.hod_assign_paper(uuid,uuid)'::regprocedure) into v_def;
  if v_def !~ 'paper_pictures_complete' then
    v_new := regexp_replace(
      v_def,
      '(select \* into v_prev from public\.checker_assignments\s+where audit_paper_id = p_paper_id and status in \(''queued'', ''assigned''\) for update;)',
      E'\\1\n  if v_prev.id is null and not public.paper_pictures_complete(p_paper_id) then\n    raise exception ''This paper is missing pictures or pages, so it cannot be given out yet. It is listed under Not ready to give out.'' using errcode = ''22023'';\n  end if;');
    if v_new = v_def then
      raise exception 'could not patch hod_assign_paper (anchor not found)';
    end if;
    execute v_new;
  end if;
end
$patch$;

-- 5. Prove it: the three functions carry the rule, and the new list is closed to anon.
do $check$
declare v_bad int;
begin
  select count(*) into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('distribute_unassigned_papers', 'hod_assign_paper', 'hod_unassigned_papers')
     and pg_get_functiondef(p.oid) !~ 'paper_pictures_complete';
  if v_bad <> 0 then
    raise exception '% function(s) do not carry the rule', v_bad;
  end if;
  if has_function_privilege('anon', 'public.hod_held_back_papers(integer)', 'execute') then
    raise exception 'hod_held_back_papers is open to anon';
  end if;
end
$check$;
