-- The HOD desk's "Send to AI" tab (19 Nov 2026): one read-only list of every question an HOD has approved for the AI
-- to redo ("needs AI review"), across all papers, with the student's reason. Questions the AI has already redone
-- are listed too (state 'redone'), so the HOD can see what came back.
--
-- This adds ONE function. It changes no table and no existing function, and it writes nothing.
--
-- ROLLBACK (nothing depends on it except the new tab, which then shows "did not load"):
--   drop function if exists public.hod_ai_redo_list();

create or replace function public.hod_ai_redo_list()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v jsonb;
begin
  if not public.is_hod() then
    raise exception 'Only HODs and admins can use this.' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', q.id,
           'paper_id', q.paper_id,
           'paper_title', coalesce(nullif(btrim(ap.title), ''),
                                   concat_ws(' ', coalesce(ap.publish_meta ->> 'school', ap.school),
                                             coalesce(ap.publish_meta ->> 'subject', ap.subject),
                                             coalesce(ap.publish_meta ->> 'cls', ap.class),
                                             coalesce(ap.publish_meta ->> 'exam', ap.exam_type),
                                             nullif(coalesce(ap.publish_meta ->> 'year', ap.year), 'year-unknown'))),
           'subject', coalesce(ap.publish_meta ->> 'subject', ap.subject),
           'cls', coalesce(ap.publish_meta ->> 'cls', ap.class),
           'school', coalesce(ap.publish_meta ->> 'school', ap.school),
           'ord', q.ord,
           'display_number', q.display_number,
           'number_path', q.number_path,
           'body', q.body,
           'marks', q.marks,
           'ai_redo_state', q.ai_redo_state,
           'ai_redo_reason', q.ai_redo_reason,
           'ai_redo_note', q.ai_redo_note,
           'asked_by_name', public.history_actor_from_key(q.ai_redo_by::text) ->> 'name',
           'asked_at', q.ai_redo_at,
           'decided_by_name', public.history_actor_from_key(q.ai_redo_decided_by::text) ->> 'name',
           'decided_at', q.ai_redo_decided_at,
           'question_state', public.approval_question_state(q.kind, q.question_passed, q.set_aside_at)
         ) order by case q.ai_redo_state when 'approved' then 0 else 1 end, q.ai_redo_decided_at, q.id), '[]'::jsonb)
    into v
  from public.audit_questions q
  join public.audit_papers ap on ap.id = q.paper_id
  where q.kind = 'question'
    and q.ai_redo_state in ('approved', 'redone')
    and ap.source is distinct from 'live_copy';

  return v;
end;
$function$;

revoke all on function public.hod_ai_redo_list() from public, anon, authenticated;
grant execute on function public.hod_ai_redo_list() to authenticated;
