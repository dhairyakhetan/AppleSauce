-- =====================================================================
-- APPLIED 2026-08-31. 66 bios and 4 descriptions changed, 70 originals in
-- public._dash_backup. Kept as the record of what was done; re-running is
-- harmless but finds nothing left to change.
--
-- Remove em/en dashes from teacher bios and Shikshaqmine descriptions
--
-- Scope, deliberately narrow:
--   teachers_list.bio          66 rows  -- the long SEO description; it feeds
--                                          the meta description on a profile
--   Shikshaqmine."Description"  4 rows
--
-- NOT touched:
--   teacher_comments.comment   23 rows  -- words real people wrote about their
--                                          teachers, including real ranges like
--                                          "Classes 6-8". Not ours to rewrite.
--   Shikshaqmine."Qualifications etc"
--                               3 rows  -- a credential field ("Chartered
--                                          Accountancy - Intermediate Level"),
--                                          not marketing copy.
--
-- The transform, in the order it applies:
--   1. a dash between two digits is a range      -> hyphen      (6-8)
--   2. a dash straight after closing punctuation
--      is redundant                              -> drop it     (offline," X)
--   3. a dash before a capital introduces a
--      title or a list                           -> colon       (boards: CBSE)
--   4. anything else joins two clauses           -> comma       (levels, from)
--
-- Rule 3 before 4 matters, and rule 2 before 3: without it, a dash following
-- `,"` became a stray colon.
--
-- Originals are copied to _dash_backup first, because a text transform cannot
-- be reversed by another text transform. Drop that table once you are happy.
-- =====================================================================

begin;

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
select 'teachers_list', 'bio', id::text, bio
  from public.teachers_list
 where bio ~ '[—–]';

insert into public._dash_backup (tbl, col, key, before_value)
select 'Shikshaqmine', 'Description', "Slug", "Description"
  from public."Shikshaqmine"
 where "Description" ~ '[—–]';

create or replace function pg_temp.dashfix(t text) returns text as $$
  select regexp_replace(
           regexp_replace(
             regexp_replace(
               regexp_replace(t, '(\d)\s*[—–]\s*(\d)', '\1-\2', 'g'),
             '([,.!?”"''])\s*[—–]\s*', '\1 ', 'g'),
           '\s*[—–]\s*([A-Z])', ': \1', 'g'),
         '\s*[—–]\s*', ', ', 'g');
$$ language sql immutable;

update public.teachers_list
   set bio = pg_temp.dashfix(bio)
 where bio ~ '[—–]';

update public."Shikshaqmine"
   set "Description" = pg_temp.dashfix("Description")
 where "Description" ~ '[—–]';

commit;

-- Expect 0 and 0. The remaining 23 comments and 3 qualification rows are
-- intentional and are not counted here.
select
  (select count(*) from public.teachers_list where bio ~ '[—–]')            as bios_left,
  (select count(*) from public."Shikshaqmine" where "Description" ~ '[—–]') as descriptions_left,
  (select count(*) from public._dash_backup)                                as originals_saved;
