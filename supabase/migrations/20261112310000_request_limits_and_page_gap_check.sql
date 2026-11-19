-- 12 Nov 2026, found by the whole-flow audit.
--
-- 1. request_submit: (a) a title made only of invisible characters (zero-width spaces) is refused,
--    (b) one person can have at most 20 requests waiting for an HOD at once, so a pile cannot grow past what the
--    HOD list (newest 200) can show.
-- 2. paper_picture_gaps: "pages missing" now checks pages 1..page_count one by one. Before, it took page_count minus
--    the number of stored pages, so a stray extra page (for example 13 of a 12-page paper) could hide a real gap
--    (page 12 missing) and the paper would be handed out without it.

create or replace function public.request_submit(p_kind text, p_title text, p_details text, p_page text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_uid uuid := auth.uid();
  v_hod boolean;
  v_title text := btrim(regexp_replace(coalesce(p_title, ''), '[​-‍⁠﻿]', '', 'g'));
  v_details text := btrim(coalesce(p_details, ''));
  v_page text := nullif(left(btrim(coalesce(p_page, '')), 300), '');
  v_id uuid;
begin
  if v_uid is null or not (public.is_paper_checker() or public.is_hod()) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  v_hod := public.is_hod();

  if p_kind is null or p_kind not in ('bug', 'edit') then
    raise exception 'Say whether something is broken or something should change.' using errcode = '22023';
  end if;
  if char_length(v_title) < 3 then
    raise exception 'Give the request a short title, at least 3 letters.' using errcode = '22023';
  end if;
  if char_length(v_title) > 120 then
    raise exception 'The title is too long. Keep it under 120 letters.' using errcode = '22023';
  end if;
  if char_length(v_details) > 4000 then
    raise exception 'The details are too long. Keep them under 4000 letters.' using errcode = '22023';
  end if;

  -- One person cannot send two at the same instant and slip past the limits.
  perform pg_advisory_xact_lock(hashtext('fix_requests:' || v_uid::text));
  if (select count(*) from public.fix_requests r
       where r.raised_by = v_uid and r.created_at > now() - interval '24 hours') >= 10 then
    raise exception 'You have already sent 10 requests in the last day. Please try again tomorrow.' using errcode = '54000';
  end if;
  if not v_hod and (select count(*) from public.fix_requests r
                     where r.raised_by = v_uid and r.status = 'waiting_for_hod') >= 20 then
    raise exception 'You already have 20 requests waiting for an HOD. Please wait for some to be dealt with.' using errcode = '54000';
  end if;

  insert into public.fix_requests (raised_by, raised_by_name, raised_as, kind, title, details, page_path, status)
  values (v_uid, left(public.history_person_name(v_uid), 120),
          case when v_hod then 'hod' else 'member' end,
          p_kind, v_title, v_details, v_page,
          case when v_hod then 'approved' else 'waiting_for_hod' end)
  returning id into v_id;
  return v_id;
end;
$function$;

create or replace function public.paper_picture_gaps(p_paper_id uuid)
returns table(open_questions integer, missing_snips integer, pages_total integer, pages_missing integer)
language sql
stable security definer
set search_path = public, pg_temp
as $function$
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
                          where pg.audit_paper_id = ap.id and coalesce(pg.object_path, '') <> ''
                            and pg.page between 1 and coalesce(ap.page_count, 0)), 0), 0)::int
  from public.audit_papers ap
  where ap.id = p_paper_id;
$function$;
