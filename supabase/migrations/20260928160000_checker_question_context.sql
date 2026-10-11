-- W11: checker_question_context(p_question_id uuid) -- the WHOLE question a
-- sub-part belongs to, for the paper checker (Kid Mode).
--
-- Owner, 2026-09-28: "if the question is a subpart, include full subpart
-- picture and context", then chose: show the whole parent question (e.g. 3
-- with all its parts) as text AND a picture of the whole question, with the
-- flagged part highlighted.
--
-- Two shapes of "sub-part" exist in audit_questions today (measured
-- 2026-09-28, read-only):
--
--   1. new_ocr papers carry a real hierarchy: parent_id (5.2.a -> 5.2 -> 5)
--      and number_path. 483 rows have a parent_id; none is in the kid
--      bucket yet, but they will be once those papers are routed.
--   2. live_copy papers are FLAT (parent_id and number_path are null on
--      every kid row). Their grouping survives only in
--      live_bank_question_id: '<group>_CTX' is the shared context/stem row
--      and '<group>_Q1', '<group>_Q2', ... are its parts, e.g.
--      history-civi-CG-0442_CTX / _Q1 / _Q2. In the kid bucket today: 243
--      _CTX rows and 45 _Qn rows.
--
-- This function returns the whole group for either shape: the root row
-- (is_parent = true) and every part, in paper order, with is_current marking
-- the row the checker is on. An empty result means "not part of a larger
-- question" and the client shows nothing extra.
--
-- Authorization: exactly the same gate as every mutating checker RPC --
-- public.checker_authorize_question() first, so only the checker holding
-- the lease on this question (or an admin) can read its context, and only
-- for a kid-bucket question on a live_copy/new_ocr paper. The rows returned
-- are restricted to the SAME paper, kind = 'question'. Read-only: no
-- UPDATE/INSERT anywhere in this function.
--
-- Grants follow CLAUDE.md's trap exactly: revoke from public AND from anon
-- and authenticated by role name (Supabase's default privileges grant
-- EXECUTE to both by name), then grant execute to authenticated only.
--
-- Idempotent: CREATE OR REPLACE, safe to re-run.

begin;

create or replace function public.checker_question_context(p_question_id uuid)
returns table (
  id uuid,
  ord int,
  display_number text,
  number_path text,
  body text,
  options jsonb,
  source jsonb,
  is_current boolean,
  is_parent boolean,
  depth int
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_q public.audit_questions;
  v_root uuid;
  v_has_children boolean;
  v_group text;
begin
  -- Raises 42501 unless the caller is a paper checker holding this
  -- question's lease (or an admin), and the question is kid-routed.
  v_q := public.checker_authorize_question(p_question_id);

  select exists (
    select 1 from public.audit_questions c
    where c.parent_id = v_q.id and c.kind = 'question'
  ) into v_has_children;

  -- Shape 1: real hierarchy. Walk up to the top-level question (bounded
  -- depth, same paper only), then return it and all its descendants.
  if v_q.parent_id is not null or v_has_children then
    with recursive up as (
      select a.id, a.parent_id, 0 as lvl
      from public.audit_questions a
      where a.id = v_q.id
      union all
      select p.id, p.parent_id, up.lvl + 1
      from public.audit_questions p
      join up on p.id = up.parent_id
      where p.paper_id = v_q.paper_id and up.lvl < 10
    )
    select up.id into v_root from up order by up.lvl desc limit 1;

    return query
      with recursive down as (
        select a.id, 0 as lvl
        from public.audit_questions a
        where a.id = v_root
        union all
        select c.id, down.lvl + 1
        from public.audit_questions c
        join down on c.parent_id = down.id
        where c.paper_id = v_q.paper_id and down.lvl < 10
      )
      select aq.id, aq.ord, aq.display_number, aq.number_path, aq.body,
             aq.options, aq.source,
             (aq.id = v_q.id) as is_current,
             (aq.id = v_root) as is_parent,
             down.lvl as depth
      from down
      join public.audit_questions aq on aq.id = down.id
      where aq.kind = 'question' and aq.paper_id = v_q.paper_id
      order by aq.ord;
    return;
  end if;

  -- Shape 2: flat live_copy rows grouped by live_bank_question_id
  -- '<group>_CTX' / '<group>_Q<n>'.
  if v_q.live_bank_question_id ~ '_(CTX|Q[0-9]+)$' then
    v_group := regexp_replace(v_q.live_bank_question_id, '_(CTX|Q[0-9]+)$', '');

    return query
      select aq.id, aq.ord, aq.display_number, aq.number_path, aq.body,
             aq.options, aq.source,
             (aq.id = v_q.id) as is_current,
             (aq.live_bank_question_id = v_group || '_CTX') as is_parent,
             case when aq.live_bank_question_id = v_group || '_CTX' then 0 else 1 end as depth
      from public.audit_questions aq
      where aq.paper_id = v_q.paper_id
        and aq.kind = 'question'
        -- Prefix compare, not a regex built from v_group, so a group id
        -- containing regex metacharacters can never widen the match.
        and left(aq.live_bank_question_id, length(v_group) + 1) = v_group || '_'
        and substr(aq.live_bank_question_id, length(v_group) + 2) ~ '^(CTX|Q[0-9]+)$'
      order by aq.ord;
    return;
  end if;

  -- Not part of a larger question: empty result.
  return;
end;
$function$;

revoke all on function public.checker_question_context(uuid) from public, anon, authenticated;
grant execute on function public.checker_question_context(uuid) to authenticated;

commit;

-- Verify after applying (CLAUDE.md: audit with has_function_privilege):
--   select has_function_privilege('anon', 'public.checker_question_context(uuid)', 'EXECUTE');          -- false
--   select has_function_privilege('authenticated', 'public.checker_question_context(uuid)', 'EXECUTE'); -- true
