-- Shikshaq: a picture the checkers kept goes onto the site by itself when an HOD opens the paper (13 Nov 2026).
--
-- Owner: "not on the site yet shouldnt happen if you are ready to shwo the clipping there then it can jkust show on the
-- paper itself".
--
-- WHY: the publish checks refuse a passed question whose picture has no public copy yet (audit_questions.figure.path),
-- and the database cannot copy storage files itself ("the database cannot copy storage objects", approval_publish_paper).
-- Until now only a tool on the owner's laptop (queue_for_approval.py) made that copy. So a question passed late, or a
-- paper the tool had not reached, showed a red "picture is not on the site yet" and could not be published.
--
-- WHAT THIS ADDS (nothing existing is changed):
--   1. One storage rule: a signed-in HOD may ADD a png under staged/ in the public figures bucket (paper-figures). They
--      cannot replace or delete anything there (no update or delete rule is added). The picture the HOD adds is the same
--      picture the checkers already kept in the private bucket, so nothing new is exposed.
--   2. hod_unstaged_pictures(paper)  what still has to be copied, with the exact private path to copy from and the exact
--      public path to copy to (the same staged/<paper>/<question>_<n>.png names the laptop tool uses).
--   3. hod_confirm_staged_picture(question, version)  after the browser has copied every picture of one question, this
--      checks the copies really are in the public bucket and then records the public path on the question through the
--      same versioned path the laptop tool uses (apply_fix_locked), so it shows in the question's history.
--   The website does the copying itself (it downloads the private picture and uploads it to the public bucket) as soon as
--   an HOD opens a paper that is ready. Papers that are already live and live-copy papers are never touched.
--
-- ROLLBACK (nothing else depends on these):
--   drop policy if exists "HODs can upload staged paper figures" on storage.objects;
--   drop function if exists public.hod_unstaged_pictures(uuid);
--   drop function if exists public.hod_confirm_staged_picture(uuid, integer);

-- ---------------------------------------------------------------------------
-- 1. who may add a picture to the public figures bucket
drop policy if exists "HODs can upload staged paper figures" on storage.objects;
create policy "HODs can upload staged paper figures" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'paper-figures'
    and name like 'staged/%'
    and storage.extension(name) = 'png'
    and public.is_hod()
  );

-- ---------------------------------------------------------------------------
-- 2. what still has to be copied for one paper
create or replace function public.hod_unstaged_pictures(p_audit_paper_id uuid)
returns table(question_id uuid, question_version integer, ord integer, from_path text, to_path text, is_first boolean)
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
    select q.id,
           q.version,
           f.ord,
           f.storage_path,
           'staged/' || q.paper_id::text || '/' || q.id::text || '_' || coalesce(nullif(f.ord, 0), 1)::text || '.png',
           (row_number() over (partition by q.id order by coalesce(f.ord, 0), f.id)) = 1
      from public.audit_questions q
      join public.audit_papers ap on ap.id = q.paper_id
      join public.audit_figures f on f.question_id = q.id and f.status = 'active'
     where q.paper_id = p_audit_paper_id
       and q.kind = 'question'
       and q.question_passed
       and (q.figure ->> 'path') is null
       and ap.source is distinct from 'live_copy'
       and ap.live_bank_paper_id is null
     order by q.ord, coalesce(f.ord, 0), f.id;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3. record that one question's pictures are now on the site
create or replace function public.hod_confirm_staged_picture(p_question_id uuid, p_expected_version integer)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_q public.audit_questions;
  v_ap public.audit_papers;
  v_first text;
  v_missing integer;
begin
  if not public.is_hod() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select * into v_q from public.audit_questions where id = p_question_id;
  if v_q.id is null then
    raise exception 'Question not found' using errcode = 'P0002';
  end if;
  select * into v_ap from public.audit_papers where id = v_q.paper_id;
  if v_ap.source = 'live_copy' or v_ap.live_bank_paper_id is not null then
    raise exception 'The pictures of this paper are not copied from here.' using errcode = '55000';
  end if;
  if v_q.kind <> 'question' or not coalesce(v_q.question_passed, false) then
    raise exception 'Only a passed question has its picture copied to the site.' using errcode = '55000';
  end if;

  -- Already on the site (the laptop tool or an earlier call did it): nothing to do.
  if (v_q.figure ->> 'path') is not null then
    return v_q.version;
  end if;

  select 'staged/' || v_q.paper_id::text || '/' || v_q.id::text || '_' || coalesce(nullif(f.ord, 0), 1)::text || '.png'
    into v_first
    from public.audit_figures f
   where f.question_id = v_q.id and f.status = 'active'
   order by coalesce(f.ord, 0), f.id
   limit 1;
  if v_first is null then
    raise exception 'This question has no picture to copy.' using errcode = '55000';
  end if;

  -- Every picture of the question must really be in the public bucket before the question points at it.
  select count(*) into v_missing
    from public.audit_figures f
   where f.question_id = v_q.id and f.status = 'active'
     and not exists (select 1 from storage.objects o
                      where o.bucket_id = 'paper-figures'
                        and o.name = 'staged/' || v_q.paper_id::text || '/' || v_q.id::text || '_' || coalesce(nullif(f.ord, 0), 1)::text || '.png');
  if v_missing > 0 then
    raise exception 'Not every picture of this question has reached the site yet.' using errcode = '55000';
  end if;

  return public.apply_fix_locked(
    'audit_questions', v_q.id::text, p_expected_version,
    jsonb_build_object('figure', coalesce(v_q.figure, '{}'::jsonb) || jsonb_build_object('path', v_first)),
    'hod:' || auth.uid()::text, 'hod_desk', 'picture copied to the site for approval');
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4. who may call them: signed-in people only; each function checks HOD inside
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.hod_unstaged_pictures(uuid)',
    'public.hod_confirm_staged_picture(uuid, integer)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
