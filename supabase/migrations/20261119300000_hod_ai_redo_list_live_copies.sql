-- Shikshaq: the "Send to AI" tab also lists requests on live Maths copies (19 Nov 2026).
-- Paste this whole file into the Supabase SQL editor and press Run. Then send me a picture of the 3 lines at the
-- bottom (all three should say "ok").
--
-- Owner, 19 Nov 2026: "show them". Two test requests sat on a live Maths copy paper. The HOD desk leaves those
-- papers out on purpose (they are frozen), so the tab never listed them and nobody could see them.
--
-- WHAT IT DOES: replaces ONE read-only function, hod_ai_redo_list(). It is the same as the previous version
-- (20261119200000) except that it no longer leaves live Maths copies out, and each item now says which kind of paper it
-- is ("paper_source"), so the tab can show a note on the frozen ones and not offer Yes or No on them. It changes no
-- table and no other function, and it writes nothing. Only HODs and admins can call it. Yes and No still use
-- hod_ai_redo_decide, which still refuses frozen papers (that is why the tab shows no buttons on them).
--
-- ROLLBACK (puts back the previous version, which hides live Maths copies): paste the file
-- 20261119200000_hod_ai_redo_flow.sql again.

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
           'paper_source', ap.source,
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
           'question_state', public.approval_question_state(q.kind, q.question_passed, q.set_aside_at),
           'trail', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'at', t.at,
                      'action', t.action,
                      'who', public.history_actor_from_key(coalesce(t.actor_user_id, t.reviewer_id)::text) ->> 'name',
                      'note', t.note,
                      'field', t.field,
                      'before', case when t.field = 'body' and jsonb_typeof(t.before) = 'string' then t.before end,
                      'after', case when t.field = 'body' and jsonb_typeof(t.after) = 'string' then t.after end,
                      'undone', t.undone_at is not null) order by t.at, t.id)
               from (select l.* from public.audit_review_log l
                      where l.question_id = q.id
                        and l.at >= coalesce(q.ai_redo_at, l.at) - interval '1 minute'
                      order by l.at, l.id
                      limit 40) t
           ), '[]'::jsonb)
         ) order by case q.ai_redo_state when 'requested' then 0 when 'approved' then 1 else 2 end,
                    coalesce(q.ai_redo_decided_at, q.ai_redo_at), q.id), '[]'::jsonb)
    into v
  from public.audit_questions q
  join public.audit_papers ap on ap.id = q.paper_id
  where q.kind = 'question'
    and q.ai_redo_state in ('requested', 'approved', 'redone');

  return v;
end;
$function$;

revoke all on function public.hod_ai_redo_list() from public, anon, authenticated;
grant execute on function public.hod_ai_redo_list() to authenticated;

-- CHECK: send me a picture of this result. It should show three lines, all "ok". -----------------------------------
select 'the list function exists' as what,
       case when to_regprocedure('public.hod_ai_redo_list()') is not null then 'ok' else 'MISSING' end as result
union all
select 'signed-in people can call it, a signed-out visitor cannot',
       case when to_regprocedure('public.hod_ai_redo_list()') is not null
             and has_function_privilege('authenticated', 'public.hod_ai_redo_list()', 'execute')
             and not has_function_privilege('anon', 'public.hod_ai_redo_list()', 'execute')
            then 'ok' else 'NOT SAFE' end
union all
select 'it checks the caller is an HOD and lists live Maths copies too',
       case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                          where n.nspname = 'public' and p.proname = 'hod_ai_redo_list'
                            and pg_get_functiondef(p.oid) like '%is_hod%'
                            and pg_get_functiondef(p.oid) like '%paper_source%'
                            and pg_get_functiondef(p.oid) not like '%distinct from ''live_copy''%')
            then 'ok' else 'MISSING' end;
