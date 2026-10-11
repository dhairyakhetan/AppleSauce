-- Remove em/en dashes from bank_questions.chapter (chapter names shown on the
-- blog and in the paper chapter rail). Owner approved 2026-10-05.
--
-- Precedent: supabase/normalise-bio-dashes.sql (originals go to
-- public._dash_backup first, because a text transform cannot be undone by
-- another text transform).
--
-- Scope, deliberately narrow:
--   bank_questions.chapter   only. bank_questions.body (question text) is
--   never touched, nor are teacher reviews: those are other people's words.
--   chapter_from_paper is a boolean, not text, and is not touched.
--
-- Checked before writing: nothing keys on the chapter value. No index,
-- constraint, view or function in public references the column, and the paper
-- page filters on the same loaded value in memory, so renaming is safe.
--
-- The transform: names are "Topic <dash> Subtopic".
--   1. the first dash introduces the subtopic -> ": "   (Mughals: Akbar)
--   2. any later dash joins a further part    -> ", "   (Mughals: Akbar, ...)
-- The updates fire the content_version triggers, which bump `version` and log
-- the change. That is the intended audit trail, not a side effect to avoid.

create table if not exists public._dash_backup (
  id           bigserial primary key,
  tbl          text        not null,
  col          text        not null,
  key          text,
  before_value text,
  at           timestamptz not null default now()
);

alter table public._dash_backup enable row level security;
revoke all on public._dash_backup from anon, authenticated;

insert into public._dash_backup (tbl, col, key, before_value)
select 'bank_questions', 'chapter', id, chapter
  from public.bank_questions
 where chapter ~ '[—–]';

create or replace function pg_temp.chapterfix(t text) returns text as $$
  select regexp_replace(
           regexp_replace(t, '\s*[—–]\s*', ': '),
         '\s*[—–]\s*', ', ', 'g');
$$ language sql immutable;

update public.bank_questions
   set chapter = pg_temp.chapterfix(chapter)
 where chapter ~ '[—–]';

-- Expect 0 remaining; backup rows equal the rows changed.
-- select count(*) from public.bank_questions where chapter ~ '[—–]';
-- select count(*) from public._dash_backup where tbl='bank_questions' and col='chapter';
