-- 20261012950000: verifier_peek_next_in_paper -- look at the next questions of a paper WITHOUT claiming them.
--
-- Why (the checker speed plan, 12 Oct 2026, section 2): after Pass the screen waits for verifier_next_in_paper, then
-- for the picture's signed URL. To show the next question at once the screen needs to know, a card ahead, which
-- questions come next so it can sign and preload their pictures. verifier_next_in_paper cannot be used for that: each
-- call LEASES one row (locked_by, locked_until = now() + 10 minutes, leased_at = now()), and leased_at feeds
-- seconds_on_question, so leasing early inflates the time measure and holds rows for nothing.
--
-- What this adds, and nothing else: ONE new read-only function.
--   verifier_peek_next_in_paper(p_audit_paper_id uuid, p_count int default 2)
--   * STABLE, so Postgres itself refuses any write inside it; no UPDATE, no INSERT, no PERFORM of a writer. It does not
--     call verifier_close_finished (which verifier_next_in_paper calls on an empty result); an empty peek is just empty.
--   * Same gate as verifier_next_in_paper: is_paper_checker(), then the caller must hold the paper through an assignment
--     in status queued or assigned. Both refuse 42501. A plain student, or a checker who does not hold the paper, gets nothing.
--   * Same servable rule and the same order as verifier_next_in_paper (its p_include_skipped = false form): kid bucket,
--     not passed, kind question, checker_question_servable(), not leased to someone else, not skipped since the paper
--     was assigned; leased-to-me first, then ord, then id. So the first row is the one the caller is on now
--     (held_by_me = true) and the rest are what Pass will serve next; the screen drops held rows it already shows.
--   * p_count is clamped to 1..3 (null counts as 2).
--   * Returns only what a prefetch needs: id, ord, display_number, page, page_path and snippet_path (the same two
--     picture paths verifier_next_in_paper returns), and held_by_me. No question text, no options, no raw reading, no source.
--
-- checker_question_context is NOT prefetchable: it is gated on holding the lease of that exact question
-- (checker_authorize_question), and a peeked row is by design not leased. The screen fetches it after the claim, as today.
--
-- Grants follow CLAUDE.md: revoke from public, anon AND authenticated by name, then grant to authenticated only.

create or replace function public.verifier_peek_next_in_paper(p_audit_paper_id uuid, p_count integer default 2)
returns table(id uuid, ord integer, display_number text, page integer, page_path text, snippet_path text, held_by_me boolean)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_uid uuid := auth.uid();
  v_since timestamptz;
  v_n integer := least(greatest(coalesce(p_count, 2), 1), 3);
begin
  if not public.is_paper_checker() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select a.assigned_at into v_since
  from public.checker_assignments a
  where a.audit_paper_id = p_audit_paper_id and a.user_id = v_uid
    and a.status in ('queued', 'assigned');
  if not found then
    raise exception 'This paper is not assigned to you' using errcode = '42501';
  end if;

  return query
    select aq.id, aq.ord, aq.display_number,
           case when (aq.source ->> 'page') ~ '^[0-9]{1,6}$' then (aq.source ->> 'page')::integer end,
           pg.object_path,
           coalesce(nullif(aq.source ->> 'snippet_object', ''), nullif(aq.source ->> 'whole_snippet_object', '')),
           (aq.locked_by = v_uid and aq.locked_until > now())
    from public.audit_questions aq
    left join lateral (select max(s.skipped_at) as at from public.audit_question_skips s
                       where s.question_id = aq.id and s.user_id = v_uid
                         and s.skipped_at >= v_since) sk on true
    left join public.audit_paper_pages pg
           on pg.audit_paper_id = aq.paper_id
          and (aq.source ->> 'page') ~ '^[0-9]{1,6}$'
          and pg.page = (aq.source ->> 'page')::integer
    where aq.paper_id = p_audit_paper_id
      and aq.review_bucket = 'kid' and aq.question_passed = false and aq.kind = 'question'
      and public.checker_question_servable(aq)
      and (aq.locked_until is null or aq.locked_until < now() or aq.locked_by = v_uid)
      and sk.at is null
    order by case when aq.locked_by = v_uid and aq.locked_until > now() and sk.at is null then 0 else 1 end,
             sk.at nulls first, aq.ord, aq.id
    limit v_n;
end;
$function$;

revoke all on function public.verifier_peek_next_in_paper(uuid, integer) from public, anon, authenticated;
grant execute on function public.verifier_peek_next_in_paper(uuid, integer) to authenticated;
