-- Owner-approved 2026-09-29 ("Yes, fix it"). Gap found by the end-to-end
-- rollback test (Digital Directory/Shikshaq/05 Papers Pipeline/Fresh Start/
-- 18 Pipeline End to End Test 2026-09-29.md).
--
-- apply_live_copy_paper_to_live() -- the chokepoint fired by
-- audit_papers_apply_to_live when audit_papers.paper_passed flips -- only
-- UPDATED bank_questions rows that already exist (audit_questions.
-- live_bank_question_id) and only INSERTED split children (split_from_id).
-- It never inserted a passed audit question with live_bank_question_id IS
-- NULL and split_from_id IS NULL. So a hidden empty paper refilled through
-- the pipeline cleared needs_review but never got any questions, and the
-- auto-return block (needs v_qcount >= 1) never fired.
--
-- This patches the chokepoint from its LIVE definition (pg_get_functiondef,
-- read 2026-09-29) in four places. Every anchor must occur EXACTLY once in
-- the live text, and the migration refuses to apply a second time (it raises
-- if the Pass 0 marker is already present), so a partial or repeated apply
-- can never double-splice the function.
--
--   1. Declare block: function-level variables for the new code.
--   2. "Pass 0", spliced in front of Pass 1 (split children), so a split
--      child of a just-inserted parent finds its parent's live row:
--        * selects every audit_question of the paper with kind = 'question',
--          question_passed = true, live_bank_question_id IS NULL,
--          split_from_id IS NULL and a non-null body (a row with no text
--          must never reach live; it stays for admin), in audit ord order;
--        * inserts each as a new bank_questions row. Body is copied
--          BYTE-EXACT (no trim, no normalise). Columns carried are the four
--          the update pass maps (body, display_number, marks, answer_key),
--          plus number (= the printed number, as the split branch does) and
--          chapter (the split branch carries chapter too; a brand-new row
--          has no other source for it). qtype / page / figure / options stay
--          null, as in the split branch;
--        * id scheme mirrors the split branch, derived from the audit row's
--          own uuid so it is unique per row and re-runs are idempotent:
--          <live paper id>-n-<first 12 hex of the audit id>;
--        * places the row in paper order: right after the live row of the
--          nearest PRECEDING audit question, by (ord, id) so ties cannot
--          skip an anchor, that already has a live row in this paper, or
--          first (ord 0) when there is none. The tail is shifted with the
--          two-step shift from 20260928200000 (bank_questions carries a
--          non-deferrable UNIQUE (paper_id, ord)); the paper-scoped advisory
--          lock the function already takes covers it;
--        * records the new id on audit_questions.live_bank_question_id, so
--          the split pass, the field-diff pass and every later run treat it
--          like any other row;
--        * logs each insert to bank_question_revisions exactly as the split
--          branch does (action 'live_apply', field null, before null, after =
--          the full row; 'live_apply' is already allowed by the CHECK).
--   3. question_count resync, AFTER Pass 2 and before the needs_review
--      block, so it counts Pass 0 inserts AND Pass 1 split children.
--      Unconditional: whenever count(*) of the paper's bank_questions rows
--      differs from bank_papers.question_count it is corrected and logged
--      (field 'question_count'). This is required, not cosmetic: every
--      public read filters question_count > 0 and site_counts() counts on it,
--      so a refilled paper would otherwise stay invisible even after
--      auto-return. (question_count equals the bank_questions row count for
--      all 1,491 papers that have questions, checked 2026-09-29, so on any
--      paper already in step this writes nothing.) bank_papers.marks is
--      deliberately NOT touched: it is not kept equal to the sum of question
--      marks today (7 papers differ).
--   4. Auto-return guard: the auto-return block (20260929140000) now also
--      requires that every question of the audit paper is passed
--      (v_total > 0 and v_total = v_passed). Without it, an admin re-apply on
--      a partly passed paper (admin_reapply_paper_to_live) could republish an
--      empty-hidden paper with only some of its questions present.
--
-- Papers whose questions all already have live ids are untouched by Pass 0:
-- its select returns no rows, so no insert, no shift.
--
-- Security definer and search_path are preserved (CREATE OR REPLACE from the
-- live text keeps ACLs); EXECUTE is restated revoked from public, anon AND
-- authenticated (Supabase grants execute to the roles by name, revoking from
-- public alone is not enough).

begin;

do $patch$
declare
  d text;
  n text;
  v_x text;
  v_declare_anchor text := 'v_any_unplaced boolean := false;';
  v_pass1_anchor text := E'  -- ---- Pass 1: split halves that have no live row yet (fix #3) --------\n';
  v_needs_anchor text := E'  -- ---- Clear needs_review only when every question is passed AND every\n';
  v_return_anchor text := E'  if v_last_hide_actor = \'ai:empty-paper-hide\' then\n';
  v_declare_block text := $decl$v_any_unplaced boolean := false;
  v_anchor_ord int;
  v_inserted int := 0;
  v_qc_sync_before int;
  v_qc_sync_after int;$decl$;
  v_pass0 text := $p0$  -- ---- Pass 0 (owner 2026-09-29): brand-new questions. A passed audit
  --      question with no live row and no split parent (a hidden empty
  --      paper refilled through the pipeline) is inserted into
  --      bank_questions, body byte-exact, in paper order, and its new id is
  --      recorded on the audit row. Runs first so the split pass below can
  --      place a split child of a just-inserted parent.
  for v_q in
    select * from public.audit_questions
    where paper_id = p_audit_paper_id
      and kind = 'question'
      and question_passed = true
      and live_bank_question_id is null
      and split_from_id is null
      and body is not null
    order by ord, id
  loop
    v_actor := coalesce(v_q.checked_by, v_q.checked_by_user::text, 'unknown-checker');
    v_actor_user_id := case when v_q.checked_by is null then v_q.checked_by_user else null end;
    v_source := case when v_q.checked_by is null then 'checker' else 'ai' end;

    v_new_live_id := v_live_paper_id || '-n-' || left(replace(v_q.id::text, '-', ''), 12);

    if exists (select 1 from public.bank_questions where id = v_new_live_id and paper_id = v_live_paper_id) then
      -- Idempotency: already inserted by an earlier run; just link it.
      update public.audit_questions set live_bank_question_id = v_new_live_id where id = v_q.id;
      continue;
    end if;

    v_anchor_ord := null;
    select bq.ord into v_anchor_ord
    from public.audit_questions a
    join public.bank_questions bq
      on bq.id = a.live_bank_question_id and bq.paper_id = v_live_paper_id
    where a.paper_id = p_audit_paper_id
      and a.kind = 'question'
      and (a.ord, a.id) < (v_q.ord, v_q.id)
    order by a.ord desc, a.id desc
    limit 1;
    v_anchor_ord := coalesce(v_anchor_ord, -1);

    -- Two-step shift (20260928200000): see the header of that migration.
    update public.bank_questions set ord = -(ord + 1)
      where paper_id = v_live_paper_id and ord > v_anchor_ord;
    update public.bank_questions set ord = -ord
      where paper_id = v_live_paper_id and ord < 0;

    insert into public.bank_questions (id, paper_id, ord, number, display_number, body, marks, chapter, answer_key, qtype, page, figure, options)
    values (v_new_live_id, v_live_paper_id, v_anchor_ord + 1, v_q.display_number, v_q.display_number,
            v_q.body, v_q.marks, v_q.chapter, v_q.answer_key, null, null, null, null);

    update public.audit_questions set live_bank_question_id = v_new_live_id where id = v_q.id;

    select to_jsonb(bq.*) into v_new_row from public.bank_questions bq where bq.id = v_new_live_id;
    insert into public.bank_question_revisions
      (table_name, row_id, action, field, before, after, actor, actor_user_id, source, audit_paper_id, audit_question_id)
    values ('bank_questions', v_new_live_id, 'live_apply', null, null, v_new_row, v_actor, v_actor_user_id, v_source,
            p_audit_paper_id, v_q.id);

    v_inserted := v_inserted + 1;
  end loop;

$p0$;
  v_resync text := $rs$  -- ---- question_count resync (owner 2026-09-29): after Pass 0 AND the
  --      split pass, so every row inserted this run is counted. Public
  --      reads filter question_count > 0, so it must track the real count.
  select question_count into v_qc_sync_before from public.bank_papers where id = v_live_paper_id;
  select count(*) into v_qc_sync_after from public.bank_questions where paper_id = v_live_paper_id;
  if v_qc_sync_before is distinct from v_qc_sync_after then
    update public.bank_papers set question_count = v_qc_sync_after where id = v_live_paper_id;
    insert into public.bank_question_revisions
      (table_name, row_id, action, field, before, after, actor, source, audit_paper_id, reason)
    values ('bank_papers', v_live_paper_id, 'live_apply', 'question_count',
            to_jsonb(v_qc_sync_before), to_jsonb(v_qc_sync_after), 'system:chokepoint', 'system', p_audit_paper_id,
            'chokepoint: question_count resynced');
  end if;

$rs$;
begin
  select pg_get_functiondef('public.apply_live_copy_paper_to_live(uuid)'::regprocedure) into d;

  -- Second-apply guard: never splice Pass 0 into a function that has it.
  if position('Pass 0 (owner 2026-09-29)' in d) > 0 then
    raise exception 'apply_live_copy_paper_to_live: Pass 0 already present, refusing to apply twice';
  end if;

  -- Every anchor must occur exactly once in the live text.
  foreach v_x in array array[v_declare_anchor, v_pass1_anchor, v_needs_anchor, v_return_anchor] loop
    if (length(d) - length(replace(d, v_x, ''))) / length(v_x) <> 1 then
      raise exception 'apply_live_copy_paper_to_live: anchor not found exactly once: %', left(v_x, 60);
    end if;
  end loop;

  d := replace(d, v_declare_anchor, v_declare_block);
  d := replace(d, v_pass1_anchor, v_pass0 || v_pass1_anchor);
  d := replace(d, v_needs_anchor, v_resync || v_needs_anchor);
  d := replace(
    d,
    v_return_anchor,
    E'  if v_last_hide_actor = \'ai:empty-paper-hide\' and v_total > 0 and v_total = v_passed then\n'
  );

  execute d;
end
$patch$;

revoke all on function public.apply_live_copy_paper_to_live(uuid) from public, anon, authenticated;

commit;
