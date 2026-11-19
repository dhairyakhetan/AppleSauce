-- 20261106200000: show a question's stored diagram to the checker.
-- NOT applied by Claude. The owner pastes this into the Supabase SQL editor. The website works with or without it:
-- until it is pasted, the checker screen asks for the diagrams, gets nothing back and shows nothing extra.
--
-- Owner, 6 November 2026: "when i am checking questions and it has an accompanying diagram, it should als show to the
-- checker". Many questions checkers flag ("figure missing") already have their diagram cut out and stored (audit_figures,
-- files in the private audit-figures bucket; live check: 59 stored diagrams for the 92 flagged questions that sit with a
-- checker or the HOD, every file present). The verify screen never asked for them: it only gets the crop of the question's
-- words (source.snippet_object) and the whole page.
--
-- verifier_question_diagrams(question) returns the ACTIVE diagrams of that question and of the shared stem above it
-- (parent_id, up to 4 levels: a part of a question needs the stem's diagram too; live: 89 of the 347 active figures sit
-- on a parent). Stem diagrams come first. Only paths the caller may open are returned: checker_can_see_audit_object() is the
-- same rule the storage policy "audit figures: admin, HOD, holder of the paper" uses (an HOD, or a paper checker who holds
-- the paper). The caller then asks storage for a signed link, exactly as it already does for the crop. Read-only; changes
-- nothing.
--
-- Closed to public, anon AND authenticated by name, then granted to authenticated (the rule for every verifier_* function).
-- The gate is the first statement: a signed-out visitor or a non-checker gets 42501 'Not authorized'.
--
-- Rollback: drop function public.verifier_question_diagrams(uuid);  (the screen then shows nothing extra again.)

create or replace function public.verifier_question_diagrams(p_question_id uuid)
returns table (
  figure_id uuid, question_id uuid, storage_path text, page integer, ord integer,
  width integer, height integer, kind text, caption text, from_stem boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
#variable_conflict use_column
begin
  if not (public.is_paper_checker() or public.is_hod()) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
    with recursive chain as (
      select q.id, q.parent_id, 0 as depth
      from public.audit_questions q
      where q.id = p_question_id
      union all
      select p.id, p.parent_id, c.depth + 1
      from public.audit_questions p
      join chain c on p.id = c.parent_id
      where c.depth < 4
    )
    select f.id, f.question_id, f.storage_path, f.page, f.ord, f.width, f.height, f.kind, f.caption, (c.depth > 0)
    from chain c
    join public.audit_figures f on f.question_id = c.id
    where f.status = 'active'
      and f.storage_path is not null
      and public.checker_can_see_audit_object(f.storage_path)
    order by c.depth desc, f.ord, f.created_at;
end;
$function$;

revoke all on function public.verifier_question_diagrams(uuid) from public, anon, authenticated;
grant execute on function public.verifier_question_diagrams(uuid) to authenticated;
