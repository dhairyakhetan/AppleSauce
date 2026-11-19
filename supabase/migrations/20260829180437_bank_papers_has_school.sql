-- Whether this paper is attributable to a real school, and so whether it
-- belongs on a /school/:slug page.
--
-- Three kinds of row fail that test and they are not the same thing:
--   a board paper   -- belongs to ICSE, not to any one school
--   an unread name  -- the source could not make out a school at all
--   not a school    -- "Graphs Question" is a topic file, "Brugesh Sir" a tutor
--
-- This used to be decided in the browser by a regex the client shipped, which
-- meant a mis-filed paper could only be corrected by a deploy. It is a
-- property of the paper, so it is stored with the paper and an editor can fix
-- one row. `school` still holds a label to print either way ("ICSE board
-- paper"), so nothing that displays a paper needs to special-case this.
alter table public.bank_papers
  add column if not exists has_school boolean not null default true;

create index if not exists bank_papers_has_school_idx
  on public.bank_papers (has_school) where has_school;
