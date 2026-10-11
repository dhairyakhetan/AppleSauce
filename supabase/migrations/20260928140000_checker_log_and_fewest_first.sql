-- 1. admin_checker_log(): who did what. One row per checker/admin action in
--    audit_review_log that has a real signed-in actor, newest first, with the
--    actor's name (profiles.full_name, falling back to the auth email) and
--    the paper/question it touched. Admin-only.
-- 2. checker_next_question(): owner, 2026-09-28, "prioritize like that" --
--    serve the paper with the FEWEST questions left to check first, so each
--    paper clears and goes live as soon as possible. Live papers (D68) still
--    come before new ones.

create or replace function public.admin_checker_log(p_limit int default 300)
returns table (
  at timestamptz, actor_user_id uuid, actor_name text, action text,
  school text, subject text, cls text, year text,
  live_bank_paper_id text, question_number text, note text
)
language plpgsql security definer stable set search_path to 'public'
as $function$
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
    select l.at, l.actor_user_id,
           coalesce(nullif(p.full_name, ''), u.email::text, 'Unknown') as actor_name,
           l.action, ap.school, ap.subject, ap.class, ap.year,
           ap.live_bank_paper_id, aq.display_number, l.note
    from public.audit_review_log l
    left join public.profiles p on p.id = l.actor_user_id
    left join auth.users u on u.id = l.actor_user_id
    left join public.audit_papers ap on ap.id = l.paper_id
    left join public.audit_questions aq on aq.id = l.question_id
    where l.actor_user_id is not null
    order by l.at desc
    limit least(greatest(coalesce(p_limit, 300), 1), 1000);
end;
$function$;

revoke all on function public.admin_checker_log(int) from public, anon, authenticated;
grant execute on function public.admin_checker_log(int) to authenticated;

create or replace function public.checker_next_question()
returns table (
  id uuid, paper_id uuid, ord int, display_number text, number_path text,
  body text, options jsonb, marks numeric, instructions text,
  flag_reasons text[], flag_detail text, source jsonb,
  subject text, school text, cls text, exam text, year text
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_q public.audit_questions;
  v_subjects text[];
  v_classes text[];
begin
  if not public.is_paper_checker() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select subjects, classes into v_subjects, v_classes
  from public.paper_checkers where user_id = v_uid;

  select aq.* into v_q
  from public.audit_questions aq
  join public.audit_papers ap on ap.id = aq.paper_id
  where aq.kind = 'question'
    and aq.review_bucket = 'kid'
    and aq.question_passed = false
    and ap.source in ('live_copy', 'new_ocr')
    and (aq.locked_until is null or aq.locked_until < now())
    and (v_subjects is null or array_length(v_subjects, 1) is null or ap.subject = any(v_subjects))
    and (v_classes is null or array_length(v_classes, 1) is null or ap.class = any(v_classes))
    and not exists (
      select 1 from public.audit_question_skips s
      where s.question_id = aq.id and s.user_id = v_uid and s.skipped_at > now() - interval '24 hours'
    )
  -- D68: live papers first. Then the paper with the fewest questions still
  -- unpassed, so it clears soonest; then newest year, then paper order.
  order by
    case when ap.source = 'live_copy' then 0 else 1 end,
    (select count(*) from public.audit_questions r
      where r.paper_id = aq.paper_id and r.kind = 'question' and not r.question_passed),
    case when ap.year ~ '^\d+$' then ap.year::int else 0 end desc,
    ap.created_at, aq.ord
  limit 1
  for update of aq skip locked;

  if v_q.id is null then
    return;
  end if;

  update public.audit_questions
  set locked_by = v_uid, locked_until = now() + interval '10 minutes'
  where public.audit_questions.id = v_q.id;

  return query
    select aq.id, aq.paper_id, aq.ord, aq.display_number, aq.number_path,
           aq.body, aq.options, aq.marks, aq.instructions,
           aq.flag_reasons, aq.flag_detail, aq.source,
           ap.subject, ap.school, ap.class, ap.exam_type, ap.year
    from public.audit_questions aq
    join public.audit_papers ap on ap.id = aq.paper_id
    where aq.id = v_q.id;
end;
$function$;

revoke all on function public.checker_next_question() from public, anon, authenticated;
grant execute on function public.checker_next_question() to authenticated;
