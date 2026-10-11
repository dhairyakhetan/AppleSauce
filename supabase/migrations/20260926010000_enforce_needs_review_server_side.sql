-- needs_review moves from a client-side convention to a real, server-enforced
-- gate on question content.
--
-- The 2026-09-25 migration (20260925120000) deliberately kept needs_review out
-- of every RLS policy and grant, because the paper ROW must stay
-- selectable/listed (a "Coming soon" card, findable in search) -- that part
-- was correct and is untouched. But `bank_paper_questions()`, the sole
-- anon/authenticated-reachable read of bank_questions, only ever checked
-- `p.is_published`. Anyone who knew (or enumerated) an under-review paper's
-- id could call the RPC directly -- devtools, curl, anything that isn't the
-- React app -- and get real question text: 2 rows signed out, all of them
-- signed in, identical to any published paper. BankPaper.tsx never calling
-- the RPC for a needs_review paper was the only thing standing between that
-- content and a reader; that is UI cosmetics, not a gate.
--
-- Reproduced verbatim from the live definition (pg_get_functiondef) with one
-- added condition, same discipline 20260909000001's own comment describes:
-- this is what is actually running, not a reconstruction from doc comments.
create or replace function public.bank_paper_questions(p_paper_id text)
 returns table(id text, paper_id text, number text, body text, marks numeric, chapter text, qtype text, page integer, figure text, options text[])
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is not null then
    insert into public.read_events (user_id, kind, target_id, ip_hash)
    values (v_uid, 'paper', p_paper_id,
      encode(extensions.digest(coalesce(
        current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''
      ), 'sha256'), 'hex'));
  end if;

  return query
    select q.id, q.paper_id, q.number, q.body, q.marks, q.chapter,
           q.qtype, q.page, q.figure, q.options
    from public.bank_questions q
    join public.bank_papers p on p.id = q.paper_id
    where q.paper_id = p_paper_id
      and p.is_published
      -- The new gate: a paper still under review returns zero rows to
      -- EVERY caller, signed in or not, RPC or app. is_published is
      -- unaffected -- the paper stays listed; this only withholds content.
      and not p.needs_review
    order by q.ord
    -- The existing gate. Was 5. auth.uid() is null for an anonymous caller and for
    -- Googlebot alike, and is read inside the function rather than from
    -- anything the client sends, so no flag or parameter can ask for more.
    limit case when v_uid is null then 2 else null end;
end;
$function$;

-- Layer (a): PUBLIC, not just the role names -- matches the discipline every
-- other SECURITY DEFINER function in this project already follows (CLAUDE.md's
-- "revoke ... from public is not enough" gotcha, applied here even though
-- CREATE OR REPLACE FUNCTION does not reset existing grants, as a defensive
-- restatement rather than an assumption that nothing changed them.
revoke all on function public.bank_paper_questions(text) from public;
grant execute on function public.bank_paper_questions(text) to anon, authenticated;
