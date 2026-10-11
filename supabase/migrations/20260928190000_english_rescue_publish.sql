-- W14: publish a rescued English question (and its passage) to the live bank.
--
-- Owner, 2026-09-28: hidden English questions go through the AI check and
-- then the paper checkers; the ones a checker confirms become visible on the
-- site. A question with a stimulus (passage / extract) is always shown with
-- it. See "W14 - English Rescue" in the brain for the design and the numbers.
--
-- Measured before writing this (read-only, 2026-09-28):
--   * English live rows use the release ids: bank_papers.id = release
--     paper_id, bank_questions.id = release question id ('Q-<paper>-...').
--   * No English stimulus is on the live site today. Other subjects carry
--     shared context as its OWN bank_questions row just before its questions
--     (id '<group>_CTX', qtype 'context:<kind>', number null, body verbatim,
--     counted in question_count) and BankPaper.tsx renders it as a card.
--     scripts/convert-subject-bank.ts planned the same for English. This file
--     follows that: a stimulus row has id = the release stimulus id
--     ('S-<paper>-<n>'), qtype 'context:<kind>', and sits immediately before
--     the first live question that uses it.
--   * bank_questions has a NON-deferrable UNIQUE (paper_id, ord), so
--     `set ord = ord + 1 where ord > x` fails with 23505 whenever a later row
--     exists (reproduced on a temp table). Every shift below is two-step:
--     move the block out of range (+1000000), then back (-999999).
--
-- Staging contract (auditor/pipeline/english_release.py,
-- english_rescue_stage.py): a rescue row is an audit_questions row on a
-- live_copy English audit paper with
--   source->>'pipeline' = 'english_w14', source->>'role' = 'rescue',
--   source->>'release_id' = the release question id,
--   source->>'seq' = its position in the paper in release order,
--   source->'stimulus' = {id, kind, title, text} or null,
--   live_bank_question_id null until published.
-- The 4,313 shown rows carry the same block with role 'shown', which is how
-- the ordering below knows where every live English question sits.
--
-- What this file adds:
--   0. english_open_ord_gap, english_sync_question_count   internal helpers
--   1. english_place_stimulus(...)           internal
--   2a. english_rescue_publish_split_half(uuid)  internal: a checker split's
--      second half of a rescue row goes live right after its first half
--   2. english_rescue_publish_question(uuid)  internal (service role, trigger)
--   3. english_rescue_publish_paper(uuid)     internal retry for one audit paper
--   4. trigger: publish the moment a checker/admin passes a rescue row
--   5. english_backfill_shown_stimuli(text)   internal, NOT run here: places
--      the missing passages for the 2,099 shown questions. The orchestrator
--      runs it after review.
--   6. admin_english_rescue_publish_paper(uuid)  admin retry wrapper
--   7. admin_english_rescue_unpublish(uuid)       admin undo of a rescue
--
-- Rules every function keeps:
--   * Never UPDATEs an existing bank_questions row's text. A question row is
--     only ever INSERTed from the audit row's body (the release text, or a
--     checker's logged fix); a stimulus row only from the release stimulus
--     text carried in staging. Only `ord` of existing rows moves.
--   * Only rows that are question_passed AND role 'rescue' are inserted.
--   * Every live change writes bank_question_revisions: live_apply for an
--     insert (before null, after = full row) or an ord/question_count
--     change, live_clear for needs_review. The unpublish function writes
--     admin_delete rows with the full row in `before`, so
--     admin_undo_revision() can put a removed row back.
--   * SECURITY DEFINER, search_path public, revoked from public, anon and
--     authenticated BY NAME (CLAUDE.md's trap). The two admin_* wrappers are
--     then granted to authenticated and check is_admin() inside.
--
-- Idempotent: CREATE OR REPLACE / DROP ... IF EXISTS. Safe to re-run.

begin;

-- ============================================================
-- 0. Shared helpers
-- ============================================================

-- Opens a one-slot gap at p_at: every row of the paper with ord >= p_at
-- moves down by one. Two-step because UNIQUE (paper_id, ord) is not
-- deferrable. Caller holds the paper's advisory lock.
create or replace function public.english_open_ord_gap(p_live_paper_id text, p_at int)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if exists (select 1 from public.bank_questions where paper_id = p_live_paper_id and ord >= 1000000) then
    raise exception 'english_open_ord_gap: paper % already has ord >= 1000000', p_live_paper_id;
  end if;
  update public.bank_questions set ord = ord + 1000000
    where paper_id = p_live_paper_id and ord >= p_at;
  update public.bank_questions set ord = ord - 999999
    where paper_id = p_live_paper_id and ord >= 1000000;
end;
$function$;

revoke all on function public.english_open_ord_gap(text, int) from public;
revoke all on function public.english_open_ord_gap(text, int) from anon;
revoke all on function public.english_open_ord_gap(text, int) from authenticated;

-- Recomputes bank_papers.question_count as the real row count (other
-- subjects count their context rows too) and logs the change.
create or replace function public.english_sync_question_count(
  p_live_paper_id text, p_actor text, p_actor_user_id uuid, p_source text,
  p_audit_paper_id uuid, p_audit_question_id uuid
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_before int;
  v_after int;
begin
  select question_count into v_before from public.bank_papers where id = p_live_paper_id;
  select count(*) into v_after from public.bank_questions where paper_id = p_live_paper_id;
  if v_before is distinct from v_after then
    update public.bank_papers set question_count = v_after where id = p_live_paper_id;
    insert into public.bank_question_revisions
      (table_name, row_id, action, field, before, after, actor, actor_user_id, source, audit_paper_id, audit_question_id, reason)
    values ('bank_papers', p_live_paper_id, 'live_apply', 'question_count', to_jsonb(v_before), to_jsonb(v_after),
            p_actor, p_actor_user_id, p_source, p_audit_paper_id, p_audit_question_id, 'english rescue');
  end if;
end;
$function$;

revoke all on function public.english_sync_question_count(text, text, uuid, text, uuid, uuid) from public;
revoke all on function public.english_sync_question_count(text, text, uuid, text, uuid, uuid) from anon;
revoke all on function public.english_sync_question_count(text, text, uuid, text, uuid, uuid) from authenticated;

-- ============================================================
-- 1. english_place_stimulus -- put a passage row immediately before the
--    first live question that uses it. Inserts it if missing; moves it if
--    a newly published question now comes first. Never edits its text.
-- ============================================================
create or replace function public.english_place_stimulus(
  p_live_paper_id text, p_stimulus jsonb, p_chapter text,
  p_actor text, p_actor_user_id uuid, p_source text,
  p_audit_paper_id uuid, p_audit_question_id uuid
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_sid text := p_stimulus ->> 'id';
  v_text text := p_stimulus ->> 'text';
  v_kind text := coalesce(nullif(p_stimulus ->> 'kind', ''), 'passage');
  v_target int;
  v_existing public.bank_questions;
  v_old int;
  v_row jsonb;
begin
  if v_sid is null or v_text is null or btrim(v_text) = '' then
    return; -- nothing to place; never invent a passage
  end if;
  -- A release stimulus id always names its own paper: 'S-<paper>-<n>'.
  if left(v_sid, length(p_live_paper_id) + 3) <> 'S-' || p_live_paper_id || '-' then
    raise exception 'english_place_stimulus: stimulus % does not belong to paper %', v_sid, p_live_paper_id;
  end if;

  -- First live question (by ord) whose staged copy links this stimulus.
  select min(bq.ord) into v_target
  from public.bank_questions bq
  join public.audit_questions aq on aq.live_bank_question_id = bq.id
  join public.audit_papers ap on ap.id = aq.paper_id
  where bq.paper_id = p_live_paper_id
    and ap.source = 'live_copy'
    and ap.live_bank_paper_id = p_live_paper_id
    and aq.source ->> 'pipeline' = 'english_w14'
    and aq.source -> 'stimulus' ->> 'id' = v_sid;

  if v_target is null then
    return; -- no live question uses it (yet)
  end if;

  select * into v_existing from public.bank_questions where id = v_sid;

  if v_existing.id is null then
    perform public.english_open_ord_gap(p_live_paper_id, v_target);
    insert into public.bank_questions (id, paper_id, ord, number, display_number, body, marks, chapter, qtype, page, figure, options)
    values (v_sid, p_live_paper_id, v_target, null, null, v_text, null, p_chapter, 'context:' || v_kind, null, null, null);

    select to_jsonb(bq.*) into v_row from public.bank_questions bq where bq.id = v_sid;
    insert into public.bank_question_revisions
      (table_name, row_id, action, field, before, after, actor, actor_user_id, source, audit_paper_id, audit_question_id, reason)
    values ('bank_questions', v_sid, 'live_apply', null, null, v_row,
            p_actor, p_actor_user_id, p_source, p_audit_paper_id, p_audit_question_id, 'english stimulus placed');
    return;
  end if;

  if v_existing.paper_id <> p_live_paper_id then
    raise exception 'english_place_stimulus: % is a row of paper %, not %', v_sid, v_existing.paper_id, p_live_paper_id;
  end if;

  if v_existing.ord = v_target - 1 then
    return; -- already right before its first question
  end if;

  -- Move it: park it out of range, then open a gap before the (possibly
  -- shifted) first question and drop it in. The gap it leaves behind is
  -- harmless: the site orders by ord and never assumes ords are dense.
  v_old := v_existing.ord;
  update public.bank_questions set ord = -1000000 - 1 where id = v_sid;

  select min(bq.ord) into v_target
  from public.bank_questions bq
  join public.audit_questions aq on aq.live_bank_question_id = bq.id
  join public.audit_papers ap on ap.id = aq.paper_id
  where bq.paper_id = p_live_paper_id
    and ap.source = 'live_copy'
    and ap.live_bank_paper_id = p_live_paper_id
    and aq.source ->> 'pipeline' = 'english_w14'
    and aq.source -> 'stimulus' ->> 'id' = v_sid;

  perform public.english_open_ord_gap(p_live_paper_id, v_target);
  update public.bank_questions set ord = v_target where id = v_sid;

  insert into public.bank_question_revisions
    (table_name, row_id, action, field, before, after, actor, actor_user_id, source, audit_paper_id, audit_question_id, reason)
  values ('bank_questions', v_sid, 'live_apply', 'ord', to_jsonb(v_old), to_jsonb(v_target),
          p_actor, p_actor_user_id, p_source, p_audit_paper_id, p_audit_question_id, 'english stimulus moved before its first question');
end;
$function$;

revoke all on function public.english_place_stimulus(text, jsonb, text, text, uuid, text, uuid, uuid) from public;
revoke all on function public.english_place_stimulus(text, jsonb, text, text, uuid, text, uuid, uuid) from anon;
revoke all on function public.english_place_stimulus(text, jsonb, text, text, uuid, text, uuid, uuid) from authenticated;

-- ============================================================
-- 2a. english_rescue_publish_split_half -- the second half of a checker
--     split of a RESCUE row. checker_split_question gives it no source
--     block, only split_from_id, and the chokepoint places split halves only
--     when a whole audit paper passes (a rescue paper may never). So it
--     goes live here, right after its first half's live row, with the same
--     id scheme the chokepoint uses. Returns the live id or null (parent is
--     not a published English rescue row yet, or the half is not passed).
-- ============================================================
create or replace function public.english_rescue_publish_split_half(p_audit_question_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_q public.audit_questions;
  v_parent public.audit_questions;
  v_live_paper text;
  v_parent_ord int;
  v_id text;
  v_row jsonb;
  v_actor text;
  v_actor_user_id uuid;
  v_source text;
begin
  select * into v_q from public.audit_questions where id = p_audit_question_id;
  if v_q.id is null or v_q.split_from_id is null or not coalesce(v_q.question_passed, false)
     or v_q.live_bank_question_id is not null or v_q.kind <> 'question' then
    return null;
  end if;
  select * into v_parent from public.audit_questions where id = v_q.split_from_id;
  if v_parent.id is null or v_parent.paper_id <> v_q.paper_id
     or coalesce(v_parent.source ->> 'pipeline', '') <> 'english_w14'
     or coalesce(v_parent.source ->> 'role', '') <> 'rescue'
     or v_parent.live_bank_question_id is null then
    return null; -- not ours, or its first half is not live yet
  end if;
  select live_bank_paper_id into v_live_paper from public.audit_papers
    where id = v_q.paper_id and source = 'live_copy' and subject = 'English';
  if v_live_paper is null then
    return null;
  end if;

  perform pg_advisory_xact_lock(hashtext(v_live_paper));

  select ord into v_parent_ord from public.bank_questions
    where id = v_parent.live_bank_question_id and paper_id = v_live_paper;
  if v_parent_ord is null then
    raise exception 'english rescue split: first half % is not a row of paper %', v_parent.live_bank_question_id, v_live_paper;
  end if;

  v_id := v_parent.live_bank_question_id || '-s-' || left(replace(v_q.id::text, '-', ''), 12);
  if exists (select 1 from public.bank_questions where id = v_id) then
    update public.audit_questions set live_bank_question_id = v_id where id = v_q.id;
    return v_id;
  end if;

  v_actor := coalesce(v_q.checked_by, v_q.checked_by_user::text, 'unknown-checker');
  v_actor_user_id := case when v_q.checked_by is null then v_q.checked_by_user else null end;
  v_source := case when v_q.checked_by is null then 'checker' else 'ai' end;

  perform public.english_open_ord_gap(v_live_paper, v_parent_ord + 1);
  insert into public.bank_questions (id, paper_id, ord, number, display_number, body, marks, chapter, qtype, page, figure, options)
  values (v_id, v_live_paper, v_parent_ord + 1, v_q.display_number, v_q.display_number, v_q.body, v_q.marks,
          v_parent.chapter, v_parent.qtype, null, null, null);
  update public.audit_questions set live_bank_question_id = v_id where id = v_q.id;

  select to_jsonb(bq.*) into v_row from public.bank_questions bq where bq.id = v_id;
  insert into public.bank_question_revisions
    (table_name, row_id, action, field, before, after, actor, actor_user_id, source, audit_paper_id, audit_question_id, reason)
  values ('bank_questions', v_id, 'live_apply', null, null, v_row,
          v_actor, v_actor_user_id, v_source, v_q.paper_id, v_q.id, 'english rescue: split half published');

  perform public.english_sync_question_count(v_live_paper, v_actor, v_actor_user_id, v_source, v_q.paper_id, v_q.id);
  return v_id;
end;
$function$;

revoke all on function public.english_rescue_publish_split_half(uuid) from public;
revoke all on function public.english_rescue_publish_split_half(uuid) from anon;
revoke all on function public.english_rescue_publish_split_half(uuid) from authenticated;

-- ============================================================
-- 2. english_rescue_publish_question -- INSERT one rescued question.
--    Returns the live id, or null when the row is not publishable (not
--    passed, not a rescue row, or kept hidden).
-- ============================================================
create or replace function public.english_rescue_publish_question(p_audit_question_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_q public.audit_questions;
  v_paper public.audit_papers;
  v_bp public.bank_papers;
  v_live_paper text;
  v_id text;
  v_seq int;
  v_after_ord int;
  v_new_ord int;
  v_row jsonb;
  v_actor text;
  v_actor_user_id uuid;
  v_source text;
  v_options text[];
  v_live_q int;
  v_staged_q int;
begin
  select * into v_q from public.audit_questions where id = p_audit_question_id;
  if v_q.id is null then
    raise exception 'english rescue: audit question % not found', p_audit_question_id;
  end if;

  -- Only a passed, English W14 rescue row that nobody decided to keep hidden.
  if not coalesce(v_q.question_passed, false)
     or v_q.kind <> 'question'
     or coalesce(v_q.source ->> 'pipeline', '') <> 'english_w14'
     or coalesce(v_q.source ->> 'role', '') <> 'rescue'
     or coalesce(v_q.source ->> 'rescue_decision', '') = 'keep_hidden' then
    return null;
  end if;

  select * into v_paper from public.audit_papers where id = v_q.paper_id;
  if v_paper.id is null or v_paper.source <> 'live_copy' or v_paper.live_bank_paper_id is null
     or v_paper.subject is distinct from 'English' then
    raise exception 'english rescue: audit paper % is not a live_copy English paper', v_q.paper_id;
  end if;
  v_live_paper := v_paper.live_bank_paper_id;

  v_id := v_q.source ->> 'release_id';
  -- A release question id always names its own paper: 'Q-<paper>-...'.
  if v_id is null or left(v_id, length(v_live_paper) + 3) <> 'Q-' || v_live_paper || '-' then
    raise exception 'english rescue: release id % does not belong to paper %', v_id, v_live_paper;
  end if;
  if (v_q.source ->> 'seq') is null or (v_q.source ->> 'seq') !~ '^[0-9]+$' then
    raise exception 'english rescue: audit question % has no release order (source.seq)', v_q.id;
  end if;
  v_seq := (v_q.source ->> 'seq')::int;

  -- Same paper-scoped lock as the chokepoint and every admin structure edit.
  perform pg_advisory_xact_lock(hashtext(v_live_paper));

  select * into v_bp from public.bank_papers where id = v_live_paper;
  if v_bp.id is null then
    raise exception 'english rescue: live paper % not found', v_live_paper;
  end if;

  if v_q.live_bank_question_id is not null then
    return v_q.live_bank_question_id; -- already published
  end if;

  -- Idempotency: a previous run inserted it but crashed before linking.
  -- Link only; never touch the existing row.
  if exists (select 1 from public.bank_questions where id = v_id) then
    if (select paper_id from public.bank_questions where id = v_id) <> v_live_paper then
      raise exception 'english rescue: % already exists in another paper', v_id;
    end if;
    update public.audit_questions set live_bank_question_id = v_id where id = v_q.id;
    return v_id;
  end if;

  -- Ordering needs every live English question of the paper to be staged
  -- with its release order; refuse rather than guess a position.
  -- (A checker split's second half is a live 'Q-...' row with no release
  -- order of its own; it rides directly after its first half, so it is left
  -- out of this count.)
  select count(*) into v_live_q from public.bank_questions bq
    where bq.paper_id = v_live_paper and bq.id like 'Q-%'
      and not exists (select 1 from public.audit_questions h
                      where h.live_bank_question_id = bq.id and h.split_from_id is not null);
  select count(distinct bq.id) into v_staged_q
  from public.bank_questions bq
  join public.audit_questions aq on aq.live_bank_question_id = bq.id
  join public.audit_papers ap on ap.id = aq.paper_id
  where bq.paper_id = v_live_paper and bq.id like 'Q-%'
    and aq.split_from_id is null
    and ap.source = 'live_copy' and ap.live_bank_paper_id = v_live_paper
    and aq.source ->> 'pipeline' = 'english_w14'
    and (aq.source ->> 'seq') ~ '^[0-9]+$';
  if v_live_q <> v_staged_q then
    raise exception 'english rescue: paper % has % live questions but only % staged with release order', v_live_paper, v_live_q, v_staged_q;
  end if;

  v_actor := coalesce(v_q.checked_by, v_q.checked_by_user::text, 'unknown-checker');
  v_actor_user_id := case when v_q.checked_by is null then v_q.checked_by_user else null end;
  v_source := case when v_q.checked_by is null then 'checker' else 'ai' end;

  -- Right after the live row of the nearest EARLIER question in release
  -- order; at the top when none is live yet.
  select bq.ord into v_after_ord
  from public.bank_questions bq
  join public.audit_questions aq on aq.live_bank_question_id = bq.id
  join public.audit_papers ap on ap.id = aq.paper_id
  where bq.paper_id = v_live_paper
    and ap.source = 'live_copy' and ap.live_bank_paper_id = v_live_paper
    and aq.source ->> 'pipeline' = 'english_w14'
    and (aq.source ->> 'seq') ~ '^[0-9]+$'
    and (aq.source ->> 'seq')::int < v_seq
  order by (aq.source ->> 'seq')::int desc
  limit 1;

  if v_after_ord is null then
    select coalesce(min(ord), 0) into v_new_ord from public.bank_questions where paper_id = v_live_paper;
  else
    v_new_ord := v_after_ord + 1;
  end if;

  perform public.english_open_ord_gap(v_live_paper, v_new_ord);

  if v_q.options is not null and jsonb_typeof(v_q.options) = 'array' then
    select array_agg(case when jsonb_typeof(e) = 'string' then e #>> '{}'
                          else coalesce((e ->> 'label') || ') ', '') || coalesce(e ->> 'text', '') end
                     order by n)
      into v_options
    from jsonb_array_elements(v_q.options) with ordinality as t(e, n);
  end if;

  -- The body is the audit row's body: the release text byte for byte, or a
  -- checker's logged fix (audit_review_log 'checker_fix' keeps the before).
  insert into public.bank_questions
    (id, paper_id, ord, number, display_number, body, marks, chapter, qtype, page, figure, options, instructions)
  values
    (v_id, v_live_paper, v_new_ord, v_q.number_path, v_q.display_number, v_q.body, v_q.marks,
     v_q.chapter, v_q.qtype, null, null, v_options, v_q.instructions);

  update public.audit_questions set live_bank_question_id = v_id where id = v_q.id;

  select to_jsonb(bq.*) into v_row from public.bank_questions bq where bq.id = v_id;
  insert into public.bank_question_revisions
    (table_name, row_id, action, field, before, after, actor, actor_user_id, source, audit_paper_id, audit_question_id, reason)
  values ('bank_questions', v_id, 'live_apply', null, null, v_row,
          v_actor, v_actor_user_id, v_source, v_paper.id, v_q.id, 'english rescue: hidden question published');

  if v_q.source -> 'stimulus' is not null and jsonb_typeof(v_q.source -> 'stimulus') = 'object' then
    perform public.english_place_stimulus(v_live_paper, v_q.source -> 'stimulus', v_q.chapter,
                                          v_actor, v_actor_user_id, v_source, v_paper.id, v_q.id);
  end if;

  perform public.english_sync_question_count(v_live_paper, v_actor, v_actor_user_id, v_source, v_paper.id, v_q.id);

  -- A paper that showed nothing becomes readable once it has a confirmed
  -- question (owner, 2026-09-28: confirmed = visible). Only for a published
  -- paper: a paper an admin hid stays hidden.
  if v_bp.is_published and v_bp.needs_review then
    update public.bank_papers set needs_review = false where id = v_live_paper;
    insert into public.bank_question_revisions
      (table_name, row_id, action, field, before, after, actor, source, audit_paper_id, audit_question_id, reason)
    values ('bank_papers', v_live_paper, 'live_clear', 'needs_review', to_jsonb(true), to_jsonb(false),
            'system:english_rescue', 'system', v_paper.id, v_q.id, 'first rescued English question published');

    -- Owner, 2026-09-28: a paper opened by a rescue carries the "some
    -- questions missing" note until every hidden question of it is settled.
    if v_bp.incomplete_note is null then
      update public.bank_papers set incomplete_note = 'Some questions from this paper are still being checked and will appear here once confirmed.'
        where id = v_live_paper;
      insert into public.bank_question_revisions
        (table_name, row_id, action, field, before, after, actor, source, audit_paper_id, audit_question_id, reason)
      values ('bank_papers', v_live_paper, 'live_apply', 'incomplete_note', 'null'::jsonb,
              to_jsonb('Some questions from this paper are still being checked and will appear here once confirmed.'::text),
              'system:english_rescue', 'system', v_paper.id, v_q.id, 'paper opened by english rescue');
    end if;
  end if;

  -- The note this flow set comes off once no rescue row of the paper is
  -- left unpublished (passed-and-live, or deliberately kept hidden).
  if not exists (
    select 1 from public.audit_questions r
    join public.audit_papers rp on rp.id = r.paper_id
    where rp.source = 'live_copy' and rp.live_bank_paper_id = v_live_paper
      and r.kind = 'question'
      and r.source ->> 'pipeline' = 'english_w14' and r.source ->> 'role' = 'rescue'
      and r.live_bank_question_id is null
      and coalesce(r.source ->> 'rescue_decision', '') <> 'keep_hidden'
  ) and (select incomplete_note from public.bank_papers where id = v_live_paper)
        = 'Some questions from this paper are still being checked and will appear here once confirmed.' then
    update public.bank_papers set incomplete_note = null where id = v_live_paper;
    insert into public.bank_question_revisions
      (table_name, row_id, action, field, before, after, actor, source, audit_paper_id, audit_question_id, reason)
    values ('bank_papers', v_live_paper, 'live_apply', 'incomplete_note',
            to_jsonb('Some questions from this paper are still being checked and will appear here once confirmed.'::text), 'null'::jsonb,
            'system:english_rescue', 'system', v_paper.id, v_q.id, 'every hidden question of the paper settled');
  end if;

  insert into public.audit_review_log (reviewer_id, actor_user_id, paper_id, question_id, action, note)
  values (null, v_actor_user_id, v_paper.id, v_q.id, 'live_apply', 'english rescue published ' || v_id);

  -- A checker may have split this row before passing it; any passed second
  -- half waiting for this row to go live follows it now.
  perform public.english_rescue_publish_split_half(h.id)
  from public.audit_questions h
  where h.split_from_id = v_q.id and h.question_passed and h.live_bank_question_id is null;

  return v_id;
end;
$function$;

revoke all on function public.english_rescue_publish_question(uuid) from public;
revoke all on function public.english_rescue_publish_question(uuid) from anon;
revoke all on function public.english_rescue_publish_question(uuid) from authenticated;

comment on function public.english_rescue_publish_question(uuid) is
  'W14: inserts ONE passed English rescue row (audit_questions.source role=rescue) into bank_questions at its release position, places its stimulus, fixes question_count, clears needs_review on a published paper. Logged in bank_question_revisions. Never updates an existing row''s text.';

-- ============================================================
-- 3. english_rescue_publish_paper -- retry every passed, unpublished
--    rescue row of one audit paper, in release order.
-- ============================================================
create or replace function public.english_rescue_publish_paper(p_audit_paper_id uuid)
returns int
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_q record;
  v_n int := 0;
begin
  for v_q in
    select id from public.audit_questions
    where paper_id = p_audit_paper_id
      and kind = 'question'
      and question_passed
      and live_bank_question_id is null
      and source ->> 'pipeline' = 'english_w14'
      and source ->> 'role' = 'rescue'
    order by (source ->> 'seq')::int
  loop
    if public.english_rescue_publish_question(v_q.id) is not null then
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$function$;

revoke all on function public.english_rescue_publish_paper(uuid) from public;
revoke all on function public.english_rescue_publish_paper(uuid) from anon;
revoke all on function public.english_rescue_publish_paper(uuid) from authenticated;

-- ============================================================
-- 4. Publish the moment a checker or admin passes a rescue row.
--    Named '..._a_...' so it fires before audit_questions_sync_paper_status
--    (same-event AFTER triggers fire in name order). A failure here never
--    undoes the checker's action: it is caught, the partial publish rolls
--    back with its subtransaction, and the failure is logged so
--    english_rescue_publish_paper() can retry it.
-- ============================================================
create or replace function public.trg_english_rescue_publish()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  begin
    if new.split_from_id is not null then
      perform public.english_rescue_publish_split_half(new.id);
    else
      perform public.english_rescue_publish_question(new.id);
    end if;
  exception when others then
    insert into public.audit_review_log (reviewer_id, actor_user_id, paper_id, question_id, action, note)
    values (null, null, new.paper_id, new.id, 'live_apply',
            'english rescue publish FAILED, retry with english_rescue_publish_paper: ' || sqlerrm);
  end;
  return new;
end;
$function$;

revoke all on function public.trg_english_rescue_publish() from public;
revoke all on function public.trg_english_rescue_publish() from anon;
revoke all on function public.trg_english_rescue_publish() from authenticated;

drop trigger if exists audit_questions_a_english_rescue_publish on public.audit_questions;
create trigger audit_questions_a_english_rescue_publish
after update of question_passed on public.audit_questions
for each row
when (new.question_passed and old.question_passed is distinct from true
      and new.live_bank_question_id is null
      and ((new.source ->> 'pipeline' = 'english_w14' and new.source ->> 'role' = 'rescue')
           -- a split half: the function returns at once unless its first
           -- half is a published English rescue row
           or new.split_from_id is not null))
execute function public.trg_english_rescue_publish();

-- ============================================================
-- 5. english_backfill_shown_stimuli -- the passages the 2,099 shown
--    questions are missing today. Defined here, NOT run here.
--    Run per paper after review:
--      select public.english_backfill_shown_stimuli(id)
--      from public.bank_papers where subject = 'English' and question_count > 0;
-- ============================================================
create or replace function public.english_backfill_shown_stimuli(p_live_paper_id text)
returns int
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_s record;
  v_n int := 0;
begin
  perform pg_advisory_xact_lock(hashtext(p_live_paper_id));
  for v_s in
    select distinct on (aq.source -> 'stimulus' ->> 'id')
           aq.source -> 'stimulus' as stim, aq.chapter, aq.paper_id as audit_paper_id, aq.id as audit_question_id
    from public.audit_questions aq
    join public.audit_papers ap on ap.id = aq.paper_id
    join public.bank_questions bq on bq.id = aq.live_bank_question_id and bq.paper_id = p_live_paper_id
    where ap.source = 'live_copy' and ap.live_bank_paper_id = p_live_paper_id
      and aq.source ->> 'pipeline' = 'english_w14'
      and jsonb_typeof(aq.source -> 'stimulus') = 'object'
    order by aq.source -> 'stimulus' ->> 'id', bq.ord
  loop
    if not exists (select 1 from public.bank_questions where id = v_s.stim ->> 'id') then
      v_n := v_n + 1;
    end if;
    perform public.english_place_stimulus(p_live_paper_id, v_s.stim, v_s.chapter,
                                          'system:english_backfill', null, 'system',
                                          v_s.audit_paper_id, v_s.audit_question_id);
  end loop;
  perform public.english_sync_question_count(p_live_paper_id, 'system:english_backfill', null, 'system', null, null);
  return v_n;
end;
$function$;

revoke all on function public.english_backfill_shown_stimuli(text) from public;
revoke all on function public.english_backfill_shown_stimuli(text) from anon;
revoke all on function public.english_backfill_shown_stimuli(text) from authenticated;

-- ============================================================
-- 6. Admin retry wrapper.
-- ============================================================
create or replace function public.admin_english_rescue_publish_paper(p_audit_paper_id uuid)
returns int
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return public.english_rescue_publish_paper(p_audit_paper_id);
end;
$function$;

revoke all on function public.admin_english_rescue_publish_paper(uuid) from public;
revoke all on function public.admin_english_rescue_publish_paper(uuid) from anon;
revoke all on function public.admin_english_rescue_publish_paper(uuid) from authenticated;
grant execute on function public.admin_english_rescue_publish_paper(uuid) to authenticated;

-- ============================================================
-- 7. Admin undo of a rescue: takes the question off the site again.
--    Logged as admin_delete with the full row in `before`, so
--    admin_undo_revision() can put it back. Its passage row is removed
--    too when no live question uses it any more. The audit row goes back
--    to hidden (rescue_decision 'keep_hidden', not re-published by the
--    trigger). needs_review is left as it is.
-- ============================================================
create or replace function public.admin_english_rescue_unpublish(p_audit_question_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_q public.audit_questions;
  v_live_paper text;
  v_row public.bank_questions;
  v_stim public.bank_questions;
  v_sid text;
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select * into v_q from public.audit_questions where id = p_audit_question_id;
  if v_q.id is null or coalesce(v_q.source ->> 'pipeline', '') <> 'english_w14'
     or coalesce(v_q.source ->> 'role', '') <> 'rescue' then
    raise exception 'Not an English rescue question';
  end if;
  select live_bank_paper_id into v_live_paper from public.audit_papers where id = v_q.paper_id;

  perform pg_advisory_xact_lock(hashtext(v_live_paper));

  if v_q.live_bank_question_id is not null then
    select * into v_row from public.bank_questions
      where id = v_q.live_bank_question_id and paper_id = v_live_paper;
    if v_row.id is not null then
      delete from public.bank_questions where id = v_row.id;
      insert into public.bank_question_revisions
        (table_name, row_id, action, field, before, after, actor, actor_user_id, source, audit_paper_id, audit_question_id, reason)
      values ('bank_questions', v_row.id, 'admin_delete', null, to_jsonb(v_row), null,
              coalesce(auth.uid()::text, 'unknown-admin'), auth.uid(), 'admin', v_q.paper_id, v_q.id, coalesce(p_reason, 'english rescue undone'));
    end if;
  end if;

  update public.audit_questions
  set live_bank_question_id = null,
      question_passed = false,
      status = 'flagged',
      review_bucket = 'none',
      source = jsonb_set(source, '{rescue_decision}', to_jsonb('keep_hidden'::text))
  where id = v_q.id;

  v_sid := v_q.source -> 'stimulus' ->> 'id';
  if v_sid is not null then
    select * into v_stim from public.bank_questions where id = v_sid and paper_id = v_live_paper;
    if v_stim.id is not null and not exists (
      select 1 from public.bank_questions bq
      join public.audit_questions aq on aq.live_bank_question_id = bq.id
      join public.audit_papers ap on ap.id = aq.paper_id
      where bq.paper_id = v_live_paper
        and ap.source = 'live_copy' and ap.live_bank_paper_id = v_live_paper
        and aq.source ->> 'pipeline' = 'english_w14'
        and aq.source -> 'stimulus' ->> 'id' = v_sid
    ) then
      delete from public.bank_questions where id = v_stim.id;
      insert into public.bank_question_revisions
        (table_name, row_id, action, field, before, after, actor, actor_user_id, source, audit_paper_id, audit_question_id, reason)
      values ('bank_questions', v_stim.id, 'admin_delete', null, to_jsonb(v_stim), null,
              coalesce(auth.uid()::text, 'unknown-admin'), auth.uid(), 'admin', v_q.paper_id, v_q.id, 'passage no longer used after english rescue undone');
    end if;
  end if;

  perform public.english_sync_question_count(v_live_paper, coalesce(auth.uid()::text, 'unknown-admin'), auth.uid(), 'admin', v_q.paper_id, v_q.id);

  insert into public.audit_review_log (reviewer_id, actor_user_id, paper_id, question_id, action, note)
  values (null, auth.uid(), v_q.paper_id, v_q.id, 'admin_english_rescue_unpublish', coalesce(p_reason, 'english rescue undone'));
end;
$function$;

revoke all on function public.admin_english_rescue_unpublish(uuid, text) from public;
revoke all on function public.admin_english_rescue_unpublish(uuid, text) from anon;
revoke all on function public.admin_english_rescue_unpublish(uuid, text) from authenticated;
grant execute on function public.admin_english_rescue_unpublish(uuid, text) to authenticated;

commit;
