-- HOD desk, step 6: ONE publish path for admins and HODs.
--
-- The body of admin_approve_paper moves, unchanged, into an internal function
-- approval_publish_paper(). admin_approve_paper becomes "check admin, call it";
-- hod_approve_paper (next migration) becomes "check HOD, run the four hard
-- checks, call it". Both therefore write the live paper identically: same
-- column list, question text copied byte-exact, answer_key never copied, same
-- ids, same audit log entry.
--
-- The only addition is three OPTIONAL header overrides read from publish_meta:
-- marks, allowed_time_minutes and general_instructions. When the key is absent
-- (every paper staged by the pipeline today) the result is exactly what
-- admin_approve_paper produced before: marks summed from the passed questions,
-- time and instructions from the audit paper. When the HOD desk has set them,
-- the live paper shows what the HOD saw in the preview.
--
-- approval_publish_paper is internal: revoked from public, anon AND
-- authenticated, reachable only through the two definer functions.

create or replace function public.approval_publish_paper(p_audit_paper_id uuid, p_note text default null)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_p public.audit_papers;
  v_meta jsonb;
  v_open integer;
  v_unstaged integer;
  v_bank text;
  v_published integer;
  v_placeholders integer;
  v_marks numeric;
  v_try integer := 0;
begin
  select * into v_p from public.audit_papers where id = p_audit_paper_id for update;
  if v_p.id is null then
    raise exception 'Paper not found' using errcode = 'P0002';
  end if;
  if v_p.approval_state is distinct from 'awaiting' then
    raise exception 'This paper is not waiting for approval (%)', coalesce(v_p.approval_state, 'not in the queue')
      using errcode = '55000';
  end if;

  select count(*) into v_open
  from public.audit_questions q
  where q.paper_id = p_audit_paper_id
    and public.approval_question_state(q.kind, q.question_passed, q.set_aside_at) = 'open';
  if v_open > 0 then
    raise exception '% question(s) on this paper are still open. Pass or set aside each one first.', v_open
      using errcode = '55000';
  end if;

  -- Retro: the paper is already live. Approval is a record, nothing moves.
  if v_p.approval_kind = 'retro' or v_p.live_bank_paper_id is not null then
    update public.audit_papers
       set approval_state = 'approved', approved_at = now(), approved_by = v_uid, approval_note = p_note
     where id = p_audit_paper_id;
    insert into public.audit_review_log (actor_user_id, paper_id, question_id, action, before, after, note)
    values (v_uid, p_audit_paper_id, null, 'admin_approve',
            jsonb_build_object('approval_state', 'awaiting'),
            jsonb_build_object('approval_state', 'approved', 'kind', 'retro',
                               'live_bank_paper_id', v_p.live_bank_paper_id),
            p_note);
    return v_p.live_bank_paper_id;
  end if;

  -- New: the paper goes live now.
  v_meta := v_p.publish_meta;
  if v_meta is null or coalesce(v_meta ->> 'school', '') = '' or coalesce(v_meta ->> 'cls', '') = ''
     or coalesce(v_meta ->> 'subject', '') = '' or coalesce(v_meta ->> 'board', '') = '' then
    raise exception 'The paper details (school, class, subject, board) are not staged yet; the pipeline stages them when it queues the paper'
      using errcode = '55000';
  end if;

  -- A picture must already sit in the public figures bucket (figure.path):
  -- the database cannot copy storage objects.
  select count(*) into v_unstaged
  from public.audit_questions q
  where q.paper_id = p_audit_paper_id and q.kind = 'question' and q.question_passed
    and (q.figure ->> 'path') is null
    and exists (select 1 from public.audit_figures f where f.question_id = q.id and f.status = 'active');
  if v_unstaged > 0 then
    raise exception '% question(s) have a picture that is not staged for the site yet', v_unstaged
      using errcode = '55000';
  end if;

  loop
    v_try := v_try + 1;
    v_bank := substr(md5(gen_random_uuid()::text), 1, 6);
    exit when not exists (select 1 from public.bank_papers where id = v_bank)
          and not exists (select 1 from public.bank_questions where paper_id = v_bank);
    if v_try > 50 then
      raise exception 'Could not find a free paper id';
    end if;
  end loop;

  perform pg_advisory_xact_lock(hashtext(v_bank));

  create temporary table if not exists approval_leaves (
    audit_id uuid primary key, passed boolean not null, is_stem boolean not null, bank_ord integer not null,
    bank_id text, parent_audit_id uuid, keep_marks boolean not null
  ) on commit drop;
  delete from pg_temp.approval_leaves;

  -- Leaves (questions that are not a parent of another row, publish.py's
  -- rule) and, since the owner's 2026-10-02 answer, stems too: a parent
  -- with printed lead-in text is its own row, in ord order before its
  -- parts, and its parts point at it through parent_question_id (the
  -- sub-part nesting BankPaper.tsx already renders). A stem with no text
  -- at all has nothing to show and is skipped; its parts stay top level.
  -- A stem keeps its marks only when none of its parts carries marks, so
  -- a total is never shown or counted twice. Dense ord over passed +
  -- set-aside rows so a set-aside question keeps its slot. Ids follow
  -- publish.py: MQ-<paper>-<printed n>-<m>.
  insert into pg_temp.approval_leaves (audit_id, passed, is_stem, bank_ord, bank_id, parent_audit_id, keep_marks)
  select l.id, l.question_passed, l.is_stem, l.bank_ord,
         case when l.question_passed
              then 'MQ-' || v_bank || '-' || l.top_n || '-' ||
                   (row_number() over (partition by l.top_n order by l.ord, l.id) - 1)::text end,
         l.parent_id,
         not l.is_stem or not l.kids_have_marks
  from (
    select q.id, q.ord, q.question_passed, q.parent_id, s.is_stem, s.kids_have_marks,
           (row_number() over (order by q.ord, q.id) - 1)::integer as bank_ord,
           coalesce(substring(coalesce(q.number_path, q.display_number, '') from '[[:alnum:]]+'), '0') as top_n
    from public.audit_questions q
    cross join lateral (
      select exists (select 1 from public.audit_questions c where c.parent_id = q.id) as is_stem,
             exists (select 1 from public.audit_questions c where c.parent_id = q.id and c.marks is not null) as kids_have_marks
    ) s
    where q.paper_id = p_audit_paper_id
      and q.kind = 'question'
      and (q.question_passed or q.set_aside_at is not null)
      and (not s.is_stem
           or nullif(btrim(coalesce(q.body, '')), '') is not null
           or nullif(btrim(coalesce(q.instructions, '')), '') is not null)
  ) l;

  select count(*) filter (where passed and not is_stem), count(*) filter (where not passed)
    into v_published, v_placeholders
  from pg_temp.approval_leaves;
  if v_published = 0 then
    raise exception 'No passed question to publish on this paper' using errcode = '55000';
  end if;

  select coalesce(sum(q.marks), 0) into v_marks
  from pg_temp.approval_leaves a join public.audit_questions q on q.id = a.audit_id
  where a.passed and a.keep_marks;

  perform set_config('shikshaq.actor', coalesce(v_uid::text, 'admin'), true);
  perform set_config('shikshaq.source', 'admin', true);
  perform set_config('shikshaq.reason', 'approved for launch', true);

  insert into public.bank_papers
    (id, school_raw, school, is_board_paper, year, exam, cls, subject, board, question_count, marks,
     is_published, has_school, needs_review, allowed_time_minutes, general_instructions, incomplete_note)
  values
    (v_bank,
     coalesce(nullif(v_meta ->> 'school_raw', ''), v_p.school),
     v_meta ->> 'school',
     coalesce((v_meta ->> 'is_board_paper')::boolean, false),
     nullif(v_meta ->> 'year', ''),
     coalesce(nullif(v_meta ->> 'exam', ''), v_p.exam_type),
     v_meta ->> 'cls',
     v_meta ->> 'subject',
     v_meta ->> 'board',
     v_published,
     -- Header overrides from publish_meta (HOD desk); absent = sum of the passed questions, as before.
     coalesce(case when (v_meta ->> 'marks') ~ '^[0-9]{1,4}(\.[0-9]+)?$' then (v_meta ->> 'marks')::numeric end, v_marks),
     true,
     coalesce((v_meta ->> 'has_school')::boolean, true),
     false,
     coalesce(case when (v_meta ->> 'allowed_time_minutes') ~ '^[0-9]{1,3}$' then (v_meta ->> 'allowed_time_minutes')::integer end,
              v_p.allowed_time_minutes),
     coalesce(nullif(btrim(v_meta ->> 'general_instructions'), ''), nullif(v_p.instructions, '')),
     nullif(v_meta ->> 'incomplete_note', ''));

  -- Body byte-exact. answer_key is deliberately not in this column list.
  insert into public.bank_questions
    (id, paper_id, ord, number, body, marks, chapter, qtype, page, figure, options, display_number,
     instructions, suggested_time_minutes, chapter_from_paper, alternative_group, alternative_label,
     section_label, syllabus_ref, parent_question_id)
  select a.bank_id, v_bank, a.bank_ord, q.display_number, q.body,
         case when a.keep_marks then q.marks end,
         q.chapter, q.qtype,
         case when (q.source ->> 'page') ~ '^[0-9]{1,6}$' then (q.source ->> 'page')::integer end,
         q.figure ->> 'path',
         public.approval_flatten_options(q.options),
         q.display_number, q.instructions, q.suggested_time_minutes, coalesce(q.chapter_from_paper, false),
         q.alternative_group, q.alternative_label, q.section_label, q.syllabus_ref,
         (select p.bank_id from pg_temp.approval_leaves p where p.audit_id = a.parent_audit_id and p.passed)
  from pg_temp.approval_leaves a
  join public.audit_questions q on q.id = a.audit_id
  where a.passed;

  update public.audit_questions q
     set live_bank_question_id = case when a.passed then a.bank_id end,
         live_placeholder_ord = case when a.passed then null else a.bank_ord end
  from pg_temp.approval_leaves a
  where q.id = a.audit_id;

  update public.audit_papers
     set live_bank_paper_id = v_bank, approval_state = 'approved', approved_at = now(),
         approved_by = v_uid, approval_note = p_note
   where id = p_audit_paper_id;

  perform set_config('shikshaq.actor', '', true);
  perform set_config('shikshaq.source', '', true);
  perform set_config('shikshaq.reason', '', true);

  insert into public.audit_review_log (actor_user_id, paper_id, question_id, action, before, after, note)
  values (v_uid, p_audit_paper_id, null, 'admin_approve',
          jsonb_build_object('approval_state', 'awaiting'),
          jsonb_build_object('approval_state', 'approved', 'kind', 'new', 'live_bank_paper_id', v_bank,
                             'questions_published', v_published, 'placeholders', v_placeholders,
                             'stems', (select count(*) from pg_temp.approval_leaves where passed and is_stem)),
          p_note);

  return v_bank;
end;
$function$;

revoke all on function public.approval_publish_paper(uuid, text) from public, anon, authenticated;

-- admin_approve_paper: same signature, same result, now a thin door.
create or replace function public.admin_approve_paper(p_audit_paper_id uuid, p_note text default null)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return public.approval_publish_paper(p_audit_paper_id, p_note);
end;
$function$;
