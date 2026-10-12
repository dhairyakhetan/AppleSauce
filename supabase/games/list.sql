-- =====================================================================================================================
-- The games team's fixed list of chapters and topics: questions can only be sent for a chapter and topic on it, under
-- its names. This adds the list to games.chapters and games.topics. Run install.sql first.
--
-- What it touches: only those two tables, in the `games` schema, and it only adds. A chapter or topic that is already
-- on the list must have the same name here, or it stops: questions keep the names they were sent with, so renaming one
-- is a separate decision. Running it again with more rows adds only the new ones.
--
-- How to run it (Supabase dashboard, SQL editor):
--   1. Paste the list between the two $list$ lines below, straight from a spreadsheet (columns separated by tabs) or
--      written by hand (separated by |). One row per topic. A chapter with no topics is one row with the topic columns
--      left out or empty. A header row is fine; it is skipped.
--   2. Run the whole file. It is a dry run: it checks every row, says how many chapters and topics it would add, then
--      undoes it. If a row has a problem it says which row and why, and nothing is kept.
--   3. Change 'yes' to 'no' on the DRY RUN line, and run the whole file again. This time it is kept.
-- =====================================================================================================================

begin;

-- DRY RUN: 'yes' checks and counts, then undoes it. Change it to 'no' to keep it.
select set_config('games_list.dry_run', 'yes', true);

create temp table games_list_text (body text) on commit drop;
insert into games_list_text values ($list$
Board | Class | Subject | Chapter number | Chapter | Topic number | Topic
$list$);

-- ---------------------------------------------------------------- read the rows

create temp table games_list on commit drop as
with lines as (
  select l.line, l.n::int as n
  from games_list_text, regexp_split_to_table(body, E'\r?\n') with ordinality as l(line, n)
), cells as (
  -- row_no counts from the first line pasted, header included, so it is the row's number in the sheet
  select n - min(n) filter (where btrim(line) <> '') over () + 1 as row_no, line,
         array(select btrim(x) from unnest(case when line ~ E'\t' then string_to_array(line, E'\t') else string_to_array(line, '|') end) x) as c
  from lines
)
select row_no::int, c,
       -- trailing empty cells (a chapter with no topics, copied from a sheet) don't count
       coalesce((select max(i) from generate_subscripts(c, 1) i where c[i] <> ''), 0) as cells
from cells
where btrim(line) <> '' and btrim(line) !~* E'^board\\s*[|\t]';

do $$
declare
  problems text[] := '{}';
  r record;
begin
  if not exists (select 1 from games_list) then
    raise exception 'The list is empty. Paste it between the two $list$ lines, then run the file again. Nothing was kept.';
  end if;

  -- each row on its own
  for r in select * from games_list order by row_no loop
    if r.cells not in (5, 7) then
      problems := problems || format('row %s has %s columns; it needs 7 (board, class, subject, chapter number, chapter, topic number, topic), or 5 for a chapter with no topics', r.row_no, r.cells);
      continue;
    end if;
    if not exists (select 1 from games.boards b where lower(b.name) = lower(r.c[1])) then
      problems := problems || format('row %s: the board "%s" isn''t on the site''s list (games.boards)', r.row_no, r.c[1]);
    end if;
    if not coalesce(case when r.c[2] ~ '^\d{1,2}$' then r.c[2]::int between 1 and 12 end, false) then
      problems := problems || format('row %s: the class "%s" isn''t a number from 1 to 12', r.row_no, r.c[2]);
    end if;
    if not exists (select 1 from games.subjects s where lower(s.name) = lower(r.c[3])) then
      problems := problems || format('row %s: the subject "%s" isn''t on the site''s list (games.subjects)', r.row_no, r.c[3]);
    end if;
    if not coalesce(case when r.c[4] ~ '^\d{1,2}$' then r.c[4]::int between 1 and 99 end, false) then
      problems := problems || format('row %s: the chapter number "%s" isn''t a number from 1 to 99', r.row_no, r.c[4]);
    end if;
    if char_length(r.c[5]) not between 1 and 120 then
      problems := problems || format('row %s: the chapter name must be 1 to 120 characters', r.row_no);
    end if;
    if r.cells = 7 and not coalesce(case when r.c[6] ~ '^\d{1,2}$' then r.c[6]::int between 1 and 99 end, false) then
      problems := problems || format('row %s: the topic number "%s" isn''t a number from 1 to 99', r.row_no, r.c[6]);
    end if;
    if r.cells = 7 and char_length(r.c[7]) not between 1 and 120 then
      problems := problems || format('row %s: the topic name must be 1 to 120 characters', r.row_no);
    end if;
  end loop;
  if cardinality(problems) > 0 then
    raise exception E'Nothing was kept. Fix these rows of the list, then run the file again:\n%', array_to_string(problems[1:20], E'\n')
      || case when cardinality(problems) > 20 then format(E'\n... and %s more', cardinality(problems) - 20) else '' end;
  end if;
end $$;

-- the rows as chapters and topics, with their IDs (as the site makes them: CBSE10SCI01, CBSE10SCI01T02)
create temp table games_list_rows on commit drop as
select l.row_no, b.name as board, l.c[2]::int as class, s.name as subject, l.c[4]::int as chapter_no, l.c[5] as chapter,
       case when l.cells = 7 then l.c[6]::int end as topic_no, case when l.cells = 7 then l.c[7] end as topic,
       b.code || lpad(l.c[2]::int::text, 2, '0') || s.code || lpad(l.c[4]::int::text, 2, '0') as chapter_id
from games_list l
join games.boards b on lower(b.name) = lower(l.c[1])
join games.subjects s on lower(s.name) = lower(l.c[3]);

do $$
declare
  problems text[] := '{}';
  r record;
begin
  -- the rows agree with each other
  for r in select chapter_id, min(row_no) as row_no, array_agg(distinct chapter) as names from games_list_rows group by chapter_id having count(distinct chapter) > 1 loop
    problems := problems || format('chapter %s (from row %s) has more than one name: %s', r.chapter_id, r.row_no, array_to_string(r.names, ' / '));
  end loop;
  for r in select chapter_id, min(row_no) as row_no from games_list_rows group by chapter_id having bool_or(topic_no is null) and bool_or(topic_no is not null) loop
    problems := problems || format('chapter %s (from row %s) has rows with topics and a row without one; a chapter has topics or doesn''t', r.chapter_id, r.row_no);
  end loop;
  for r in select chapter_id, topic_no, min(row_no) as row_no, array_agg(distinct topic) as names from games_list_rows where topic_no is not null group by chapter_id, topic_no having count(distinct topic) > 1 loop
    problems := problems || format('topic %s of chapter %s (from row %s) has more than one name: %s', r.topic_no, r.chapter_id, r.row_no, array_to_string(r.names, ' / '));
  end loop;

  -- and with what is on the list already
  for r in select distinct on (g.chapter_id) g.chapter_id, g.row_no, g.chapter, c.name from games_list_rows g join games.chapters c using (chapter_id) where c.name <> g.chapter order by g.chapter_id, g.row_no loop
    problems := problems || format('row %s: chapter %s is already on the list as "%s", not "%s"', r.row_no, r.chapter_id, r.name, r.chapter);
  end loop;
  for r in select distinct on (g.chapter_id, g.topic_no) g.chapter_id, g.topic_no, g.row_no, g.topic, t.name from games_list_rows g join games.topics t on t.chapter_id = g.chapter_id and t.topic_no = g.topic_no where t.name <> g.topic order by g.chapter_id, g.topic_no, g.row_no loop
    problems := problems || format('row %s: topic %s of chapter %s is already on the list as "%s", not "%s"', r.row_no, r.topic_no, r.chapter_id, r.name, r.topic);
  end loop;
  for r in select distinct on (g.chapter_id) g.chapter_id, g.row_no from games_list_rows g where g.topic_no is null and exists (select 1 from games.topics t where t.chapter_id = g.chapter_id) order by g.chapter_id, g.row_no loop
    problems := problems || format('row %s: chapter %s already has topics on the list, so its rows need a topic', r.row_no, r.chapter_id);
  end loop;

  if cardinality(problems) > 0 then
    raise exception E'Nothing was kept. Fix these rows of the list, then run the file again:\n%', array_to_string(problems[1:20], E'\n')
      || case when cardinality(problems) > 20 then format(E'\n... and %s more', cardinality(problems) - 20) else '' end;
  end if;
end $$;

-- ---------------------------------------------------------------- add what is new

do $$
declare
  chapters int;
  topics int;
  all_chapters int := (select count(distinct chapter_id) from games_list_rows);
  all_topics int := (select count(distinct (chapter_id, topic_no)) from games_list_rows where topic_no is not null);
begin
  insert into games.chapters (chapter_id, board, class, subject, chapter_no, name)
  select distinct on (chapter_id) chapter_id, board, class, subject, chapter_no, chapter from games_list_rows order by chapter_id, row_no
  on conflict (chapter_id) do nothing;
  get diagnostics chapters = row_count;

  insert into games.topics (topic_id, chapter_id, topic_no, name)
  select distinct on (chapter_id, topic_no) chapter_id || 'T' || lpad(topic_no::text, 2, '0'), chapter_id, topic_no, topic
  from games_list_rows where topic_no is not null order by chapter_id, topic_no, row_no
  on conflict (topic_id) do nothing;
  get diagnostics topics = row_count;

  if current_setting('games_list.dry_run') <> 'no' then
    raise exception 'Dry run passed: the list has % chapters and % topics, of which % chapters and % topics are new. Nothing was kept. To add them, change ''yes'' to ''no'' on the DRY RUN line near the top and run the whole file again.',
      all_chapters, all_topics, chapters, topics;
  end if;
  raise notice 'Added % chapters and % topics (the list had % chapters and % topics).', chapters, topics, all_chapters, all_topics;
end $$;

commit;
