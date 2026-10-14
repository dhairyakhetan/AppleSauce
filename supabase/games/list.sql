-- =====================================================================================================================
-- The games team's fixed list of chapters (and, where it gives them, topics): questions can only be sent for a chapter
-- on it, under its names. This adds the list to games.chapters and games.topics. Run install.sql first.
--
-- What it touches: only those two tables, in the `games` schema, and it only adds (a topic already written with
-- questions that the list now names becomes the list's). A chapter or topic that is already on the list must have the
-- same name here, or it stops: questions keep the names they were sent with, so renaming one is a separate decision.
-- Running it again with more rows adds only the new ones.
--
-- Topics: a chapter the list gives topics has only those. A chapter it gives none (one row, with the topic columns
-- left out) takes the topics its questions are written under: the first question sent under a new topic adds it.
--
-- As committed it holds the 189 chapters on the site (Shikshaq's question bank, 13 October 2026), with no topics, under
-- the site's names, numbered in the order each syllabus teaches them: Mathematics for CBSE 10 and 12, ICSE 3 to 10 and
-- ISC 11 and 12 (the bank's ICSE 11 and 12 papers are ISC's), and ICSE 10 History & Civics. CHANGES.md says what was
-- left out and why.
--
-- How to run it (Supabase dashboard, SQL editor):
--   1. The list is between the two $list$ lines below. To add more, paste rows there, straight from a spreadsheet
--      (columns separated by tabs) or written by hand (separated by |). One row per topic. A chapter with no topics is
--      one row with the topic columns left out or empty. A header row is fine; it is skipped.
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
CBSE | 10 | Mathematics | 1 | Real Numbers
CBSE | 10 | Mathematics | 2 | Factorisation and Remainder Theorem
CBSE | 10 | Mathematics | 3 | Pair of Linear Equations in Two Variables
CBSE | 10 | Mathematics | 4 | Quadratic Equations
CBSE | 10 | Mathematics | 5 | Arithmetic Progression
CBSE | 10 | Mathematics | 6 | Similarity
CBSE | 10 | Mathematics | 7 | Coordinate Geometry
CBSE | 10 | Mathematics | 8 | Trigonometry
CBSE | 10 | Mathematics | 9 | Circles
CBSE | 10 | Mathematics | 10 | Constructions
CBSE | 10 | Mathematics | 11 | Mensuration
CBSE | 10 | Mathematics | 12 | Statistics
CBSE | 10 | Mathematics | 13 | Probability
CBSE | 12 | Mathematics | 1 | Relations and Functions
CBSE | 12 | Mathematics | 2 | Inverse Trigonometric Functions
CBSE | 12 | Mathematics | 3 | Matrices
CBSE | 12 | Mathematics | 4 | Determinants
CBSE | 12 | Mathematics | 5 | Continuity and Differentiability
CBSE | 12 | Mathematics | 6 | Applications of Derivatives
CBSE | 12 | Mathematics | 7 | Integrals
CBSE | 12 | Mathematics | 8 | Applications of Integrals
CBSE | 12 | Mathematics | 9 | Differential Equations
CBSE | 12 | Mathematics | 10 | Vector Algebra
CBSE | 12 | Mathematics | 11 | Three-dimensional Geometry
CBSE | 12 | Mathematics | 12 | Linear Programming
CBSE | 12 | Mathematics | 13 | Probability
ICSE | 3 | Mathematics | 1 | Numbers and Place Value
ICSE | 3 | Mathematics | 2 | Addition and Subtraction
ICSE | 3 | Mathematics | 3 | Multiplication
ICSE | 3 | Mathematics | 4 | Money
ICSE | 3 | Mathematics | 5 | Measurement
ICSE | 3 | Mathematics | 6 | Time and Calendar
ICSE | 3 | Mathematics | 7 | Shapes
ICSE | 3 | Mathematics | 8 | Spatial Reasoning
ICSE | 3 | Mathematics | 9 | Patterns
ICSE | 3 | Mathematics | 10 | Data Handling
ICSE | 4 | Mathematics | 1 | Numbers and Place Value
ICSE | 4 | Mathematics | 2 | Addition and Subtraction
ICSE | 4 | Mathematics | 3 | Multiplication and Division
ICSE | 4 | Mathematics | 4 | Fractions
ICSE | 4 | Mathematics | 5 | Money
ICSE | 4 | Mathematics | 6 | Measurement
ICSE | 4 | Mathematics | 7 | Perimeter and Area
ICSE | 4 | Mathematics | 8 | Time
ICSE | 4 | Mathematics | 9 | Shapes and Spatial Reasoning
ICSE | 4 | Mathematics | 10 | Maps and Directions
ICSE | 4 | Mathematics | 11 | Patterns
ICSE | 4 | Mathematics | 12 | Data Handling
ICSE | 5 | Mathematics | 1 | Numbers and Place Value
ICSE | 5 | Mathematics | 2 | Addition and Subtraction
ICSE | 5 | Mathematics | 3 | Multiplication and Division
ICSE | 5 | Mathematics | 4 | Factors and Multiples
ICSE | 5 | Mathematics | 5 | Fractions
ICSE | 5 | Mathematics | 6 | Decimals
ICSE | 5 | Mathematics | 7 | Money
ICSE | 5 | Mathematics | 8 | Measurement
ICSE | 5 | Mathematics | 9 | Area and Perimeter
ICSE | 5 | Mathematics | 10 | Time
ICSE | 5 | Mathematics | 11 | Shapes and Angles
ICSE | 5 | Mathematics | 12 | Spatial Reasoning
ICSE | 5 | Mathematics | 13 | Maps and Directions
ICSE | 5 | Mathematics | 14 | Patterns
ICSE | 5 | Mathematics | 15 | Data Handling
ICSE | 6 | Mathematics | 1 | Knowing Our Numbers
ICSE | 6 | Mathematics | 2 | Whole Numbers
ICSE | 6 | Mathematics | 3 | Playing with Numbers
ICSE | 6 | Mathematics | 4 | Basic Geometrical Ideas
ICSE | 6 | Mathematics | 5 | Understanding Elementary Shapes
ICSE | 6 | Mathematics | 6 | Integers
ICSE | 6 | Mathematics | 7 | Fractions
ICSE | 6 | Mathematics | 8 | Decimals
ICSE | 6 | Mathematics | 9 | Data Handling
ICSE | 6 | Mathematics | 10 | Mensuration
ICSE | 6 | Mathematics | 11 | Algebra
ICSE | 6 | Mathematics | 12 | Ratio and Proportion
ICSE | 6 | Mathematics | 13 | Symmetry
ICSE | 6 | Mathematics | 14 | Practical Geometry
ICSE | 7 | Mathematics | 1 | Integers
ICSE | 7 | Mathematics | 2 | Fractions and Decimals
ICSE | 7 | Mathematics | 3 | Data Handling
ICSE | 7 | Mathematics | 4 | Simple Equations
ICSE | 7 | Mathematics | 5 | Lines and Angles
ICSE | 7 | Mathematics | 6 | The Triangle and Its Properties
ICSE | 7 | Mathematics | 7 | Congruence of Triangles
ICSE | 7 | Mathematics | 8 | Comparing Quantities
ICSE | 7 | Mathematics | 9 | Rational Numbers
ICSE | 7 | Mathematics | 10 | Practical Geometry
ICSE | 7 | Mathematics | 11 | Perimeter and Area
ICSE | 7 | Mathematics | 12 | Algebraic Expressions
ICSE | 7 | Mathematics | 13 | Exponents and Powers
ICSE | 7 | Mathematics | 14 | Symmetry
ICSE | 7 | Mathematics | 15 | Visualising Solid Shapes
ICSE | 8 | Mathematics | 1 | Rational Numbers
ICSE | 8 | Mathematics | 2 | Linear Equations in One Variable
ICSE | 8 | Mathematics | 3 | Understanding Quadrilaterals
ICSE | 8 | Mathematics | 4 | Practical Geometry
ICSE | 8 | Mathematics | 5 | Data Handling
ICSE | 8 | Mathematics | 6 | Squares and Square Roots
ICSE | 8 | Mathematics | 7 | Cubes and Cube Roots
ICSE | 8 | Mathematics | 8 | Comparing Quantities
ICSE | 8 | Mathematics | 9 | Algebraic Expressions and Identities
ICSE | 8 | Mathematics | 10 | Visualising Solid Shapes
ICSE | 8 | Mathematics | 11 | Mensuration
ICSE | 8 | Mathematics | 12 | Exponents and Powers
ICSE | 8 | Mathematics | 13 | Direct and Inverse Proportions
ICSE | 8 | Mathematics | 14 | Factorisation
ICSE | 8 | Mathematics | 15 | Introduction to Graphs
ICSE | 8 | Mathematics | 16 | Playing with Numbers
ICSE | 9 | Mathematics | 1 | Number Systems
ICSE | 9 | Mathematics | 2 | Compound Interest
ICSE | 9 | Mathematics | 3 | Algebraic Identities and Factorisation
ICSE | 9 | Mathematics | 4 | Polynomials
ICSE | 9 | Mathematics | 5 | Linear Equations in Two Variables
ICSE | 9 | Mathematics | 6 | Indices and Logarithms
ICSE | 9 | Mathematics | 7 | Euclidean Geometry
ICSE | 9 | Mathematics | 8 | Lines and Angles
ICSE | 9 | Mathematics | 9 | Triangles
ICSE | 9 | Mathematics | 10 | Quadrilaterals
ICSE | 9 | Mathematics | 11 | Areas of Parallelograms and Triangles
ICSE | 9 | Mathematics | 12 | Circles
ICSE | 9 | Mathematics | 13 | Constructions
ICSE | 9 | Mathematics | 14 | Statistics
ICSE | 9 | Mathematics | 15 | Mensuration
ICSE | 9 | Mathematics | 16 | Heron's Formula
ICSE | 9 | Mathematics | 17 | Surface Areas and Volumes
ICSE | 9 | Mathematics | 18 | Trigonometry
ICSE | 9 | Mathematics | 19 | Coordinate Geometry
ICSE | 9 | Mathematics | 20 | Probability
ICSE | 10 | Mathematics | 1 | GST and Banking
ICSE | 10 | Mathematics | 2 | Shares and Dividends
ICSE | 10 | Mathematics | 3 | Linear Inequations
ICSE | 10 | Mathematics | 4 | Quadratic Equations
ICSE | 10 | Mathematics | 5 | Ratio and Proportion
ICSE | 10 | Mathematics | 6 | Factorisation and Remainder Theorem
ICSE | 10 | Mathematics | 7 | Matrices
ICSE | 10 | Mathematics | 8 | Arithmetic Progression
ICSE | 10 | Mathematics | 9 | Geometric Progression
ICSE | 10 | Mathematics | 10 | Coordinate Geometry
ICSE | 10 | Mathematics | 11 | Similarity
ICSE | 10 | Mathematics | 12 | Loci
ICSE | 10 | Mathematics | 13 | Circles
ICSE | 10 | Mathematics | 14 | Constructions
ICSE | 10 | Mathematics | 15 | Mensuration
ICSE | 10 | Mathematics | 16 | Trigonometry
ICSE | 10 | Mathematics | 17 | Statistics
ICSE | 10 | Mathematics | 18 | Probability
ICSE | 10 | History & Civics | 1 | Parliament
ICSE | 10 | History & Civics | 2 | President
ICSE | 10 | History & Civics | 3 | Judiciary
ICSE | 10 | History & Civics | 4 | Revolt of 1857
ICSE | 10 | History & Civics | 5 | Indian Nationalism
ICSE | 10 | History & Civics | 6 | Indian Independence
ICSE | 10 | History & Civics | 7 | Rise of Fascism
ICSE | 10 | History & Civics | 8 | Rise of Nazism
ICSE | 10 | History & Civics | 9 | World War II
ICSE | 10 | History & Civics | 10 | United Nations
ICSE | 10 | History & Civics | 11 | Post-WWII World
ISC | 11 | Mathematics | 1 | Sets
ISC | 11 | Mathematics | 2 | Relations and Functions
ISC | 11 | Mathematics | 3 | Trigonometric Functions
ISC | 11 | Mathematics | 4 | Mathematical Induction
ISC | 11 | Mathematics | 5 | Complex Numbers and Quadratic Equations
ISC | 11 | Mathematics | 6 | Linear Inequalities
ISC | 11 | Mathematics | 7 | Permutations and Combinations
ISC | 11 | Mathematics | 8 | Binomial Theorem
ISC | 11 | Mathematics | 9 | Sequences and Series
ISC | 11 | Mathematics | 10 | Straight Lines
ISC | 11 | Mathematics | 11 | Conic Sections
ISC | 11 | Mathematics | 12 | Introduction to Three-dimensional Geometry
ISC | 11 | Mathematics | 13 | Limits and Derivatives
ISC | 11 | Mathematics | 14 | Mathematical Reasoning
ISC | 11 | Mathematics | 15 | Statistics
ISC | 11 | Mathematics | 16 | Probability
ISC | 12 | Mathematics | 1 | Relations and Functions
ISC | 12 | Mathematics | 2 | Inverse Trigonometric Functions
ISC | 12 | Mathematics | 3 | Matrices
ISC | 12 | Mathematics | 4 | Determinants
ISC | 12 | Mathematics | 5 | Continuity and Differentiability
ISC | 12 | Mathematics | 6 | Applications of Derivatives
ISC | 12 | Mathematics | 7 | Integrals
ISC | 12 | Mathematics | 8 | Differential Equations
ISC | 12 | Mathematics | 9 | Probability
ISC | 12 | Mathematics | 10 | Vector Algebra
ISC | 12 | Mathematics | 11 | Three-dimensional Geometry
ISC | 12 | Mathematics | 12 | Applications of Integrals
ISC | 12 | Mathematics | 13 | Application of Calculus in Commerce and Economics
ISC | 12 | Mathematics | 14 | Linear Regression
ISC | 12 | Mathematics | 15 | Linear Programming
ISC | 12 | Mathematics | 16 | Conic Sections
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
  for r in select distinct on (g.chapter_id) g.chapter_id, g.row_no from games_list_rows g where g.topic_no is null and exists (select 1 from games.topics t where t.chapter_id = g.chapter_id and t.from_list) order by g.chapter_id, g.row_no loop
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
  -- a topic already written with questions, now on the list too, is the list's from here on
  update games.topics t set from_list = true
  where not t.from_list and exists (select 1 from games_list_rows g where g.chapter_id = t.chapter_id and g.topic_no = t.topic_no);

  if current_setting('games_list.dry_run') <> 'no' then
    raise exception 'Dry run passed: the list has % chapters and % topics, of which % chapters and % topics are new. Nothing was kept. To add them, change ''yes'' to ''no'' on the DRY RUN line near the top and run the whole file again.',
      all_chapters, all_topics, chapters, topics;
  end if;
  raise notice 'Added % chapters and % topics (the list had % chapters and % topics).', chapters, topics, all_chapters, all_topics;
end $$;

commit;
