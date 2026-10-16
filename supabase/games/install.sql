-- =====================================================================================================================
-- Shikshaq's games team: the `games` schema.
--
-- What it is: the tables and functions behind /games (Write questions, Approve questions, Try the games, Team, Chapters),
-- and the starting list of chapters. All of it goes in one new schema, `games`. It reads nothing in Shikshaq's own tables
-- and changes nothing outside `games`.
--
-- How to run it (Supabase dashboard, SQL editor). Read CHANGES.md first: take a backup before step 4.
--   1. The MODERATOR line below has the moderator's Google email (the games team's first admin; nobody can remove or
--      demote them).
--   2. The starting list of chapters is near the end. Check the drafted ones there: once installed, a chapter can still
--      be renamed on the site's Chapters page, but its number changes, and it is deleted, only until a question is
--      sent for it.
--   3. Run the whole file as it is. It is a dry run: it does everything, checks it, then undoes it, and ends with
--      "Dry run passed". Nothing is kept.
--   4. Change 'yes' to 'no' on the DRY RUN line, and run the whole file again. This time it is kept.
--   5. Settings, then Data API (API settings): add `games` to the exposed schemas, and save.
--   To remove all of it later: drop schema games cascade;
--
-- Safe by construction:
--   * One transaction: all of it happens, or none of it.
--   * Its first step is a plain `create schema games`. If anything called `games` already exists, it stops there.
--   * At the end it compares everything outside `games` (tables, columns' permissions, functions, triggers, policies,
--     schemas, default permissions, extensions, event triggers) with how it was at the start. If anything differs, it
--     stops and nothing is kept.
--
-- Who can do what. Nobody can read or write the tables directly; everything goes through the functions below, and each
-- function checks who is asking. Only signed-in people on the team's list (games.team) get anything:
--   member  writes questions and sends them (submit_batch), sees their own sent-back questions (my_sent_back)
--   hod     also approves them or sends them back (hod_questions, hod_approved, hod_set_status, waiting_count)
--   admin   also manages the team (admin_people, admin_set_role, admin_remove) and the list of chapters on the site's
--           Chapters page (admin_list, admin_save_chapters, admin_topic_questions)
--
-- Signing in. A person's email counts only if this session was signed in with Google (or another provider listed in
-- games.settings) or with an email sign-in link. A password doesn't count: with "Confirm email" off, anyone can sign up
-- with someone else's email, and when that person later signs in with Google the two become one account, with the
-- password still working (tested on Supabase's own sign-in server). The session's sign-in method (`amr` in its token)
-- says how it was signed in, and survives token refreshes.
--
-- IDs:
--   question  CBSE10SCI01T02Q003 = chapter ID CBSE10SCI01 (board, class, subject code, chapter) + topic 02 + question 003
--   batch     B20261009-03 = the 3rd batch sent on 9 October 2026 (India time)
-- The fixed list of chapters (games.chapters) starts as the starting list near the end; admins keep it on the site's
-- Chapters page (/games/chapters). A question can only be sent for a chapter on it. Its topics (games.topics) are fixed
-- where the list gives the chapter topics; where it gives none, they are written with the questions, and the first
-- question sent under a new topic adds it to the chapter.
-- =====================================================================================================================

begin;

-- 1. MODERATOR: the games team's first admin, whom nobody can remove or demote. Their Google email, between the quotes:
select set_config('games_install.moderator', 'dhairyaplayz97@gmail.com', true);
-- 2. DRY RUN: 'yes' does everything and then undoes it. Change it to 'no' to keep it.
select set_config('games_install.dry_run', 'yes', true);

-- If anything called `games` already exists, the script stops here, and nothing changes.
create schema games;

-- ---------------------------------------------------------------- what exists outside `games`, before

create function pg_temp.games_outside() returns table (kind text, name text, detail text) language sql stable as $$
  select 'schema', n.nspname::text, coalesce(array_to_string(n.nspacl, ' '), '')
  from pg_namespace n where n.nspname <> 'games' and n.nspname !~ '^pg_(toast_)?temp_'
  union all
  select 'relation', n.nspname || '.' || c.relname,
         c.relkind::text || ' ' || coalesce(array_to_string(c.relacl, ' '), '') || ' rls=' || c.relrowsecurity || '/' || c.relforcerowsecurity
         || ' triggers=' || c.relhastriggers || ' owner=' || c.relowner::regrole
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname not in ('games', 'pg_toast') and n.nspname !~ '^pg_(toast_)?temp_'
  union all
  select 'column', a.attrelid::regclass::text || '.' || a.attname, coalesce(array_to_string(a.attacl, ' '), '')
  from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
  where a.attacl is not null and n.nspname not in ('games', 'pg_toast') and n.nspname !~ '^pg_(toast_)?temp_'
  union all
  select 'function', n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
         md5(coalesce(p.prosrc, '')) || ' ' || coalesce(array_to_string(p.proacl, ' '), '') || ' definer=' || p.prosecdef
         || ' owner=' || p.proowner::regrole || ' config=' || coalesce(array_to_string(p.proconfig, ' '), '')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname <> 'games' and n.nspname !~ '^pg_(toast_)?temp_'
  union all
  select 'trigger', t.tgrelid::regclass::text || '.' || t.tgname, t.tgenabled::text || ' ' || t.tgfoid::regproc::text
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
  where n.nspname <> 'games'
  union all
  select 'policy', p.polrelid::regclass::text || '.' || p.polname,
         p.polcmd::text || ' ' || coalesce(pg_get_expr(p.polqual, p.polrelid), '') || ' ' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')
  from pg_policy p join pg_class c on c.oid = p.polrelid join pg_namespace n on n.oid = c.relnamespace
  where n.nspname <> 'games'
  union all
  select 'constraint', c.conrelid::regclass::text || '.' || c.conname, pg_get_constraintdef(c.oid)
  from pg_constraint c join pg_namespace n on n.oid = c.connamespace
  where n.nspname <> 'games' and n.nspname !~ '^pg_(toast_)?temp_'
  union all
  select 'default privileges', case when d.defaclnamespace = 0 then '(every schema)' else d.defaclnamespace::regnamespace::text end || ' ' || d.defaclrole::regrole || ' ' || d.defaclobjtype::text,
         array_to_string(d.defaclacl, ' ')
  from pg_default_acl d
  union all
  select 'extension', e.extname::text, e.extversion from pg_extension e
  union all
  select 'event trigger', e.evtname::text, e.evtevent || ' ' || e.evtenabled::text from pg_event_trigger e
  union all
  select 'role', r.rolname::text, r.rolsuper || ' ' || r.rolcanlogin || ' ' || r.rolbypassrls || ' ' || coalesce(array_to_string(s.setconfig, ' '), '')
  from pg_roles r left join pg_db_role_setting s on s.setrole = r.oid and s.setdatabase in (0, (select oid from pg_database where datname = current_database()))
$$;
create temporary table games_install_before on commit drop as select * from pg_temp.games_outside();

-- ---------------------------------------------------------------- the schema

comment on schema games is 'Shikshaq''s games team: questions for the revision games, and who may write and approve them. Nothing here reads or changes anything outside this schema. Remove all of it with: drop schema games cascade;';
revoke all on schema games from public;
grant usage on schema games to authenticated;

-- ---------------------------------------------------------------- settings and the team

-- Which sign-in providers prove an email (besides an email sign-in link). Change it here, in the SQL editor.
create table games.settings (
  only_row boolean primary key default true check (only_row),
  sign_in_providers text[] not null default '{google}'
);
insert into games.settings default values;
comment on table games.settings is 'One row. sign_in_providers: the OAuth providers whose sign-in proves an email (an email sign-in link always does; a password never does).';

-- The games team's list: only these emails get in. Admins change it from the Team page.
create table games.team (
  email text primary key check (email = lower(email) and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  role text not null check (role in ('admin', 'hod', 'member')),
  name text check (char_length(name) <= 120),
  moderator boolean not null default false check (not moderator or role = 'admin'),
  added_by text,
  added_at timestamptz not null default now(),
  last_seen_at timestamptz
);
create unique index team_one_moderator on games.team (moderator) where moderator;
comment on table games.team is 'The games team: email, role (admin, hod or member), name, and the moderator (an admin nobody can remove or demote).';

-- How two questions are compared: case, extra spaces and punctuation at the end don't matter.
create function games.norm(t text) returns text language sql immutable set search_path = ''
as $$ select lower(regexp_replace(regexp_replace(btrim(t), '[[:space:]?.!:;,।]+$', ''), '\s+', ' ', 'g')) $$;

-- The signed-in person's email, if this session proves it is theirs: signed in with Google (games.settings) or with an
-- email sign-in link. Null otherwise. `amr` in the token lists how the session was signed in. A code sent by text
-- message is recorded the same way as an email link ('otp'), so on an account that has a phone a code proves nothing
-- about the email: such an account must sign in with Google.
create function games.proven_email() returns text language sql stable security definer set search_path = ''
as $$
  select case when auth.uid() is not null and exists (
      select 1 from jsonb_array_elements(case when jsonb_typeof(auth.jwt() -> 'amr') = 'array' then auth.jwt() -> 'amr' else '[]'::jsonb end) a
      where (coalesce(a ->> 'method', a #>> '{}') = 'otp'
             and not coalesce(auth.jwt() -> 'app_metadata' -> 'providers', '[]'::jsonb) ? 'phone'
             and nullif(btrim(coalesce(auth.jwt() ->> 'phone', '')), '') is null)
         or (coalesce(a ->> 'method', a #>> '{}') = 'oauth'
             and coalesce(auth.jwt() -> 'app_metadata' -> 'providers', '[]'::jsonb) ?| (select s.sign_in_providers from games.settings s)))
    then nullif(lower(btrim(auth.jwt() ->> 'email')), '') end
$$;

-- The signed-in person's role on the team: admin, hod or member; null when not on it (or not proven).
create function games.team_role() returns text language sql stable security definer set search_path = ''
as $$ select t.role from games.team t where t.email = games.proven_email() $$;

create function games.is_hod() returns boolean language sql stable security definer set search_path = ''
as $$ select coalesce(games.team_role() in ('hod', 'admin'), false) $$;

-- Called every time a games page opens (and by the account menu). Returns the role; null when not on the team;
-- 'reauth' when signed in, but not in a way that proves the email (a password): sign in with Google or a link instead.
-- Notes the name and when they were last here (a visit within 10 minutes, with the same name, writes nothing).
create function games.my_role() returns text language plpgsql security definer set search_path = ''
as $$
declare
  mail text := games.proven_email();
  who text := coalesce(nullif(btrim(auth.jwt() -> 'user_metadata' ->> 'full_name'), ''), nullif(btrim(auth.jwt() -> 'user_metadata' ->> 'name'), ''));
  mine text;
begin
  if auth.uid() is null then return null; end if;
  if mail is null then return 'reauth'; end if;
  select t.role into mine from games.team t where t.email = mail;
  if mine is null then return null; end if;
  update games.team t set name = coalesce(left(who, 120), t.name), last_seen_at = now()
  where t.email = mail
    and (t.last_seen_at is null or t.last_seen_at < now() - interval '10 minutes' or t.name is distinct from coalesce(left(who, 120), t.name));
  return mine;
end $$;

-- The team, for admins: the moderator, then admins, HoDs and members.
create function games.admin_people() returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if games.team_role() is distinct from 'admin' then raise exception 'Only a games admin can see the team.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('email', t.email, 'name', t.name, 'role', t.role, 'moderator', t.moderator, 'added_at', t.added_at, 'last_seen_at', t.last_seen_at)
                     order by t.moderator desc, case t.role when 'admin' then 0 when 'hod' then 1 else 2 end, coalesce(t.name, t.email))
    from games.team t
  ), '[]');
end $$;

-- An admin adds someone, or changes their role. They needn't have signed in yet.
create function games.admin_set_role(person text, new_role text) returns void language plpgsql security definer set search_path = ''
as $$
declare
  mail text := lower(btrim(coalesce(person, '')));
begin
  if games.team_role() is distinct from 'admin' then raise exception 'Only a games admin can change the team.'; end if;
  if new_role is null or new_role not in ('admin', 'hod', 'member') then raise exception 'Unknown role.'; end if;
  if mail !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'That doesn''t look like an email address.'; end if;
  if mail = games.proven_email() and new_role <> 'admin' then raise exception 'You can''t take away your own admin role.'; end if;
  if new_role <> 'admin' and exists (select 1 from games.team t where t.email = mail and t.moderator) then raise exception 'The moderator stays an admin.'; end if;
  insert into games.team (email, role, added_by) values (mail, new_role, games.proven_email())
  on conflict (email) do update set role = excluded.role;
end $$;

-- An admin takes someone off the team.
create function games.admin_remove(person text) returns void language plpgsql security definer set search_path = ''
as $$
declare
  mail text := lower(btrim(coalesce(person, '')));
begin
  if games.team_role() is distinct from 'admin' then raise exception 'Only a games admin can change the team.'; end if;
  if mail = games.proven_email() then raise exception 'You can''t remove yourself.'; end if;
  if exists (select 1 from games.team t where t.email = mail and t.moderator) then raise exception 'The moderator can''t be removed.'; end if;
  delete from games.team where email = mail;
end $$;

-- ---------------------------------------------------------------- the fixed list: boards, subjects, chapters, topics

-- The boards and subjects the site knows, with their codes (src/lib/games/details.ts; a test checks they agree).
create table games.boards (name text primary key, code text not null unique check (code ~ '^[A-Z]{2,5}$'));
create table games.subjects (name text primary key, code text not null unique check (code ~ '^[A-Z]{3}$'));

-- The chapters and topics questions can be written for. Chapters come from the list, not from here; questions can only
-- be sent for a chapter on it, under the name it gives. A chapter's topics come from the list too (from_list), which fixes
-- them; a chapter the list gives no topics takes the topics its questions are sent under (from_list false).
create table games.chapters (
  chapter_id text primary key check (chapter_id ~ '^[A-Z]{2,5}(0[1-9]|1[0-2])[A-Z]{3}[0-9]{2}$'),
  board text not null references games.boards (name) on update cascade,
  class smallint not null check (class between 1 and 12),
  subject text not null references games.subjects (name) on update cascade,
  chapter_no smallint not null check (chapter_no between 1 and 99),
  name text not null check (char_length(name) between 1 and 120),
  unique (board, class, subject, chapter_no)
);
create table games.topics (
  topic_id text primary key,
  chapter_id text not null references games.chapters on delete cascade,
  topic_no smallint not null check (topic_no between 1 and 99),
  name text not null check (char_length(name) between 1 and 120),
  from_list boolean not null default true,
  unique (chapter_id, topic_no),
  constraint topic_id_matches check (topic_id = chapter_id || 'T' || lpad(topic_no::text, 2, '0'))
);
comment on table games.chapters is 'The fixed list of chapters. chapter_id = board code + class + subject code + chapter number, e.g. CBSE10SCI01.';
comment on table games.topics is 'The topics of each chapter. topic_id = chapter ID + T + topic number, e.g. CBSE10SCI01T02.';
comment on column games.topics.from_list is 'True: from the list, which fixes the chapter''s topics. False: added by the first question sent under it, in a chapter the list gives no topics.';

insert into games.boards (name, code) values
  ('CBSE', 'CBSE'), ('ICSE', 'ICSE'), ('ISC', 'ISC'), ('NIOS', 'NIOS'), ('IB', 'IB'), ('IGCSE', 'IGCSE'),
  ('Cambridge', 'CAIE'), ('Edexcel', 'EDEX'), ('Aligarh Muslim University Board', 'AMU'),
  ('Jamia Millia Islamia', 'JMI'), ('Banasthali Vidyapith', 'BANV'), ('Dayalbagh Educational Institute', 'DEI'),
  ('Maharishi Patanjali Sanskrit Sansthan', 'MPSS'), ('Andhra Pradesh State Board', 'AP'),
  ('Assam State Board', 'AS'), ('Bihar State Board', 'BR'), ('Chhattisgarh State Board', 'CG'),
  ('Delhi State Board', 'DL'), ('Goa State Board', 'GA'), ('Gujarat State Board', 'GJ'),
  ('Haryana State Board', 'HR'), ('Himachal Pradesh State Board', 'HP'), ('Jammu and Kashmir State Board', 'JK'),
  ('Jharkhand State Board', 'JH'), ('Karnataka State Board', 'KA'), ('Kerala State Board', 'KL'),
  ('Madhya Pradesh State Board', 'MP'), ('Maharashtra State Board', 'MH'), ('Manipur State Board', 'MN'),
  ('Meghalaya State Board', 'ML'), ('Mizoram State Board', 'MZ'), ('Nagaland State Board', 'NL'),
  ('Odisha State Board', 'OD'), ('Punjab State Board', 'PB'), ('Rajasthan State Board', 'RJ'),
  ('Tamil Nadu State Board', 'TN'), ('Telangana State Board', 'TS'), ('Tripura State Board', 'TR'),
  ('Uttar Pradesh State Board', 'UP'), ('Uttarakhand State Board', 'UK'), ('West Bengal State Board', 'WB'),
  ('Andhra Pradesh Open School Society', 'APOSS'), ('Bihar Board of Open Schooling and Examination', 'BBOSE'),
  ('Chhattisgarh State Open School', 'CGSOS'), ('Madhya Pradesh State Open School', 'MPSOS'),
  ('Rajasthan State Open School', 'RSOS'), ('Telangana Open School Society', 'TOSS'),
  ('Bihar State Madrasa Education Board', 'BSMEB'), ('Chhattisgarh Madrasa Board', 'CGMB'),
  ('Uttar Pradesh Board of Madrasa Education', 'UPBME'), ('Uttarakhand Madrasa Education Board', 'UKMEB'),
  ('West Bengal Board of Madrasah Education', 'WBBME'), ('Bihar Sanskrit Shiksha Board', 'BSSB'),
  ('Chhattisgarh Sanskrit Board', 'CGSB'), ('Uttar Pradesh Madhyamik Sanskrit Shiksha Parishad', 'UPSSP'),
  ('Uttarakhand Sanskrit Shiksha Parishad', 'USSP');
insert into games.subjects (name, code) values
  ('Physics', 'PHY'), ('Chemistry', 'CHE'), ('Biology', 'BIO'), ('Mathematics', 'MAT'),
  ('Applied Mathematics', 'AMA'), ('Additional Mathematics', 'ADM'), ('Further Mathematics', 'FMA'),
  ('Statistics', 'STA'), ('Science', 'SCI'), ('Environmental Studies', 'EVS'), ('Environmental Science', 'ENV'),
  ('Environmental Management', 'EMG'), ('Biotechnology', 'BTE'), ('Computer Science', 'CSC'),
  ('Computer Applications', 'CAP'), ('Informatics Practices', 'INP'), ('Information Technology', 'ITE'),
  ('Artificial Intelligence', 'AIN'), ('Data Science', 'DSC'), ('Robotics', 'ROB'), ('Web Applications', 'WEB'),
  ('Data Entry Operations', 'DEO'), ('Engineering Graphics', 'EGR'), ('Engineering Science', 'ESC'),
  ('Electricity and Electronics', 'EEL'), ('Technical Drawing', 'TDR'),
  ('Geometrical and Mechanical Drawing', 'GMD'), ('Geometrical and Building Drawing', 'GBD'),
  ('Design and Technology', 'DTE'), ('Social Science', 'SST'), ('History', 'HIS'), ('Geography', 'GEO'),
  ('Civics', 'CIV'), ('History & Civics', 'HCV'), ('Political Science', 'POL'), ('Economics', 'ECO'),
  ('Sociology', 'SOC'), ('Psychology', 'PSY'), ('Philosophy', 'PHI'), ('Anthropology', 'ANT'),
  ('Religious Studies', 'REL'), ('Global Perspectives', 'GLP'), ('Theory of Knowledge', 'TOK'),
  ('Legal Studies', 'LGS'), ('Knowledge Traditions and Practices of India', 'KTP'),
  ('Indian Culture and Heritage', 'ICH'), ('General Knowledge', 'GKN'), ('Moral Science', 'MSC'),
  ('Accountancy', 'ACC'), ('Business Studies', 'BST'), ('Commerce', 'CMR'), ('Commercial Studies', 'COM'),
  ('Commercial Applications', 'CMA'), ('Economic Applications', 'ECA'), ('Entrepreneurship', 'ENT'),
  ('Business Administration', 'BAD'), ('Taxation', 'TAX'), ('Cost Accounting', 'CAC'), ('Financial Markets', 'FIN'),
  ('Banking', 'BNK'), ('Insurance', 'INS'), ('Marketing', 'MKT'), ('Salesmanship', 'SLS'),
  ('Office Procedures and Practices', 'OPP'), ('Shorthand', 'SHO'), ('Retail', 'RET'), ('Tourism', 'TOU'),
  ('Hospitality Management', 'HOS'), ('Front Office Operations', 'FOO'), ('Food Production', 'FPR'),
  ('Food Nutrition and Dietetics', 'FND'), ('Cookery', 'COO'), ('Home Science', 'HSC'),
  ('Beauty and Wellness', 'BWL'), ('Health Care', 'HCA'), ('Medical Diagnostics', 'MDG'),
  ('Early Childhood Care and Education', 'ECC'), ('Agriculture', 'AGR'), ('Horticulture', 'HOR'), ('Apparel', 'APP'),
  ('Textile Design', 'TXD'), ('Fashion Studies', 'FAS'), ('Design', 'DES'),
  ('Design Thinking and Innovation', 'DTI'), ('Multimedia', 'MMD'), ('Mass Media Studies', 'MMS'),
  ('Library and Information Science', 'LIS'), ('Typography and Computer Application', 'TCA'),
  ('Geospatial Technology', 'GST'), ('Electrical Technology', 'ETE'), ('Electronic Technology', 'ETN'),
  ('Electronics and Hardware', 'ELH'), ('Automotive', 'AUT'), ('Air Conditioning and Refrigeration', 'ACR'),
  ('Security', 'SEC'), ('Physical Activity Trainer', 'PAT'), ('Foundation Skills for Sciences', 'FSS'),
  ('Multi Skill Foundation Course', 'MSF'), ('Vocational Education', 'VOC'), ('Art', 'ART'), ('Painting', 'PNT'),
  ('Graphics', 'GRA'), ('Sculpture', 'SCU'), ('Applied Art', 'AAR'), ('Music', 'MUS'), ('Hindustani Music', 'HMU'),
  ('Carnatic Music', 'CMU'), ('Dance', 'DAN'), ('Drama', 'DRA'), ('Performing Arts', 'PFA'), ('Film', 'FLM'),
  ('Physical Education', 'PED'), ('Yoga', 'YOG'), ('National Cadet Corps', 'NCC'), ('English', 'ENG'),
  ('English Language', 'ENL'), ('English Literature', 'ELT'), ('Elective English', 'ELE'), ('Hindi', 'HIN'),
  ('Hindi Elective', 'HIE'), ('Sanskrit', 'SAN'), ('Urdu', 'URD'), ('Punjabi', 'PUN'), ('Bengali', 'BEN'),
  ('Tamil', 'TAM'), ('Telugu', 'TEL'), ('Kannada', 'KAN'), ('Malayalam', 'MAL'), ('Marathi', 'MAR'),
  ('Gujarati', 'GUJ'), ('Odia', 'ORI'), ('Assamese', 'ASM'), ('Manipuri', 'MNI'), ('Sindhi', 'SND'),
  ('Kashmiri', 'KAS'), ('Konkani', 'KOK'), ('Nepali', 'NEP'), ('Bodo', 'BOD'), ('Dogri', 'DOI'), ('Maithili', 'MAI'),
  ('Santali', 'SAT'), ('Mizo', 'MIZ'), ('Khasi', 'KHA'), ('Garo', 'GAR'), ('Kokborok', 'KBK'), ('Tangkhul', 'TNG'),
  ('Lepcha', 'LEP'), ('Limboo', 'LIM'), ('Bhutia', 'BHU'), ('Tibetan', 'TIB'), ('Rai', 'RAI'), ('Gurung', 'GRG'),
  ('Tamang', 'TMG'), ('Sherpa', 'SHP'), ('Thai', 'THA'), ('Arabic', 'ARA'), ('Persian', 'PER'), ('French', 'FRE'),
  ('German', 'GER'), ('Spanish', 'SPA'), ('Russian', 'RUS'), ('Japanese', 'JPN'), ('Chinese', 'CHI'),
  ('Korean', 'KOR'), ('Italian', 'ITA'), ('Portuguese', 'POR'), ('Latin', 'LAT'), ('Dzongkha', 'DZO');

-- What is wrong with a question's board, subject and chapter ID, in words; null when nothing is.
create function games.codes_problem(board text, subject text, chapter_id text) returns text language sql stable set search_path = ''
as $$
  select case
    when not exists (select 1 from games.boards b where lower(b.name) = lower(board))
      then format('The board "%s" isn''t on the site''s list.', board)
    when not exists (select 1 from games.subjects s where lower(s.name) = lower(subject))
      then format('The subject "%s" isn''t on the site''s list.', subject)
    when m is null
      or (select b.code from games.boards b where lower(b.name) = lower(board)) is distinct from m[1]
      or (select s.code from games.subjects s where lower(s.name) = lower(subject)) is distinct from m[2]
      then format('The chapter ID %s doesn''t match the board "%s" and subject "%s".', chapter_id, board, subject)
  end
  from (select regexp_match(chapter_id, '^([A-Z]{2,5})[0-9]{2}([A-Z]{3})[0-9]{2}$') m) id
$$;

-- The list, for the team's pages: every chapter with its topics, in order. `open` is true for a chapter whose topics the
-- list doesn't fix: its questions may go under topics of their own.
create function games.catalog() returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if games.team_role() is null then raise exception 'Only people on the games team can see this.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('chapter_id', c.chapter_id, 'board', c.board, 'class', c.class, 'subject', c.subject,
                                        'chapter_no', c.chapter_no, 'name', c.name,
                                        'open', not exists (select 1 from games.topics t where t.chapter_id = c.chapter_id and t.from_list),
                                        'topics', coalesce((select jsonb_agg(jsonb_build_object('topic_id', t.topic_id, 'topic_no', t.topic_no, 'name', t.name) order by t.topic_no)
                                                            from games.topics t where t.chapter_id = c.chapter_id), '[]'))
                     order by c.board, c.class, c.subject, c.chapter_no)
    from games.chapters c
  ), '[]');
end $$;

-- ---------------------------------------------------------------- questions

create table games.batches (
  batch_id text primary key check (batch_id ~ '^B[0-9]{8}-[0-9]{2,}$'),
  teacher text not null check (char_length(teacher) between 1 and 80),
  teacher_email text not null,
  sent_at timestamptz not null default now()
);
create index batches_teacher on games.batches (teacher_email); -- a teacher's sent-back questions

create table games.questions (
  question_id text primary key,
  batch_id text not null references games.batches on delete cascade,
  chapter_id text not null check (chapter_id ~ '^[A-Z]{2,5}(0[1-9]|1[0-2])[A-Z]{3}[0-9]{2}$'),
  topic_id text,
  board text not null check (char_length(board) between 1 and 60),
  class smallint not null check (class between 1 and 12),
  subject text not null check (char_length(subject) between 1 and 80),
  chapter_no smallint not null check (chapter_no between 1 and 99),
  chapter text not null check (char_length(chapter) between 1 and 200),
  topic_no smallint check (topic_no between 1 and 99),
  topic text not null default '' check (char_length(topic) <= 200),
  question_no smallint not null check (question_no between 1 and 999),
  question text not null check (char_length(question) between 1 and 300),
  answer text not null check (char_length(answer) between 1 and 100),
  -- other answers that count as right (none when there is only the one)
  also text[] not null default '{}' check (cardinality(also) <= 5 and array_position(also, null) is null),
  -- fill in the blank: the same fact as a sentence, with ___ where the answer goes (one blank only)
  fill text check (fill is null or (char_length(fill) <= 300 and fill ~ '_{3,}' and fill !~ '_{3,}[^_].*_{3,}')),
  -- multiple choice: the wrong options shown beside the answer (none for an ordinary question)
  wrong_options text[] not null default '{}' check (cardinality(wrong_options) <= 5 and array_position(wrong_options, null) is null),
  difficulty text check (difficulty in ('easy', 'medium', 'hard')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  note text not null default '' check (char_length(note) <= 500),
  reviewed_at timestamptz,
  reviewed_by text,
  seen_at timestamptz,  -- when the teacher saw that it was sent back
  -- the IDs always agree with the columns
  constraint ids_match check (
    chapter_id ~ ('^[A-Z]{2,5}' || lpad(class::text, 2, '0') || '[A-Z]{3}' || lpad(chapter_no::text, 2, '0') || '$')
    and topic_id is not distinct from (case when topic_no is null then null else chapter_id || 'T' || lpad(topic_no::text, 2, '0') end)
    and question_id = chapter_id || 'T' || lpad(coalesce(topic_no, 0)::text, 2, '0') || 'Q' || lpad(question_no::text, 3, '0')
  ),
  constraint sent_back_says_why check (status <> 'rejected' or note <> '')
);
-- a question can't wait or be approved twice in one chapter; one that was sent back can be sent again
create unique index questions_once_per_chapter on games.questions (chapter_id, games.norm(question)) where status <> 'rejected';
create index questions_batch on games.questions (batch_id, status);
create index questions_status on games.questions (status, class, subject, chapter_id);
create index questions_numbering on games.questions (chapter_id, (coalesce(topic_no, 0)), question_no);
create index questions_sent_back on games.questions (chapter_id, games.norm(question)) where status = 'rejected';
create index questions_approved on games.questions (reviewed_at, question_id) where status = 'approved';

-- The final question bank: approved questions only, one row per question. Kept in step with games.questions by the
-- trigger below; nothing else writes to it.
create table games.question_bank (
  question_id text primary key references games.questions on delete cascade,
  board text not null,
  class smallint not null,
  subject text not null,
  chapter_no smallint not null,
  chapter text not null,
  topic_no smallint,
  topic text not null,
  question_no smallint not null,
  question text not null,
  answer text not null,
  also text[] not null default '{}',
  fill text,
  wrong_options text[] not null default '{}',
  difficulty text,
  chapter_id text not null,
  topic_id text,
  teacher text not null,
  approved_at timestamptz not null
);
create index question_bank_order on games.question_bank (class, subject, chapter_no, topic_no, question_no, question_id);

comment on table games.batches is 'One row per "Send for approval" from Write questions.';
comment on table games.questions is 'Every question ever sent: waiting (pending), approved, or sent back (rejected), with the HoD''s reason.';
comment on table games.question_bank is 'The final question bank: approved questions only, one row per question. Kept in step with games.questions automatically.';
comment on column games.question_bank.question_id is 'Chapter ID + topic + question number, e.g. CBSE10SCI01T02Q003 (T00 = no topic)';
comment on column games.question_bank.question is 'The question, exactly as the teacher wrote it';
comment on column games.question_bank.answer is 'The answer, exactly as the teacher wrote it';
comment on column games.question_bank.also is 'Other answers that count as right, exactly as the teacher wrote them';
comment on column games.question_bank.fill is 'Fill in the blank: the same fact as a sentence with ___ where the answer goes (null when none was written)';
comment on column games.question_bank.wrong_options is 'Multiple choice: the wrong options, exactly as the teacher wrote them (empty for an ordinary question)';
comment on column games.question_bank.teacher is 'The teacher who sent it (their name, never their email)';

create function games.sync_question_bank() returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.status = 'approved' then
    insert into games.question_bank (question_id, board, class, subject, chapter_no, chapter, topic_no, topic, question_no,
                                     question, answer, also, fill, wrong_options, difficulty, chapter_id, topic_id, teacher, approved_at)
    select new.question_id, new.board, new.class, new.subject, new.chapter_no, new.chapter, new.topic_no, new.topic, new.question_no,
           new.question, new.answer, new.also, new.fill, new.wrong_options, new.difficulty, new.chapter_id, new.topic_id, b.teacher, coalesce(new.reviewed_at, now())
    from games.batches b where b.batch_id = new.batch_id
    on conflict (question_id) do update set
      board = excluded.board, class = excluded.class, subject = excluded.subject, chapter_no = excluded.chapter_no,
      chapter = excluded.chapter, topic_no = excluded.topic_no, topic = excluded.topic, question_no = excluded.question_no,
      question = excluded.question, answer = excluded.answer, also = excluded.also, fill = excluded.fill,
      wrong_options = excluded.wrong_options, difficulty = excluded.difficulty, chapter_id = excluded.chapter_id,
      topic_id = excluded.topic_id, teacher = excluded.teacher, approved_at = excluded.approved_at;
  else
    delete from games.question_bank where question_id = new.question_id;
  end if;
  return new;
end $$;
create trigger questions_to_bank after insert or update of status on games.questions
  for each row execute function games.sync_question_bank();

-- Send: the signed-in person's questions, as one batch (the site sends 500 at a time). Each must be for a chapter and
-- topic on the list (their names are taken from the list). A question may have up to 5 other answers and up to 5
-- wrong options, none the same as the answer or each other, and a fill-in sentence with exactly one ___ (the site
-- checks much more before sending; these are what the bank can't do without). Questions already waiting or approved
-- in the same chapter are skipped, and so is one that was sent back to this same person and hasn't changed (question,
-- answer, other answers, fill-in sentence and wrong options): the site points them to the reason instead. Returns the
-- batch ID, how many were sent and skipped, and the new question IDs.
create function games.submit_batch(questions jsonb) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  mail text := games.proven_email();
  who text;
  day text := to_char(now() at time zone 'Asia/Kolkata', 'YYYYMMDD');
  seq int;
  bid text;
  q jsonb;
  qid text;
  cid text;
  tno int;
  qtext text;
  nq text;
  wrong text[];
  others text[];
  sentence text;
  why text;
  n int;
  back text[];
  ch games.chapters%rowtype;
  tp games.topics%rowtype;
  tname text;
  fixed boolean;
  seen text[] := '{}';
  sent int := 0;
  already int := 0;
  sent_back int := 0;
  back_ids text[] := '{}';
  added text[] := '{}';
begin
  if games.team_role() is null then
    raise exception 'Only people on the games team can send questions. Sign in with Google, using the email on the team''s list.';
  end if;
  -- the name the team knows them by (else their Google name); never their email
  select coalesce(nullif(btrim(t.name), ''), nullif(btrim(auth.jwt() -> 'user_metadata' ->> 'full_name'), ''), nullif(btrim(auth.jwt() -> 'user_metadata' ->> 'name'), ''), 'A teacher')
  into who from games.team t where t.email = mail;
  who := left(who, 80);
  if jsonb_typeof(questions) is distinct from 'array' or jsonb_array_length(questions) not between 1 and 500 then
    raise exception 'Send between 1 and 500 questions at a time.';
  end if;
  perform pg_advisory_xact_lock(hashtext('games.submit_batch'));

  select coalesce(max(substring(b.batch_id from 11)::int), 0) + 1 into seq from games.batches b where b.batch_id like 'B' || day || '-%';
  bid := 'B' || day || '-' || lpad(seq::text, greatest(2, char_length(seq::text)), '0');
  insert into games.batches (batch_id, teacher, teacher_email) values (bid, who, mail);

  for q in select * from jsonb_array_elements(questions) loop
    cid := q ->> 'chapter_id';
    qtext := btrim(q ->> 'question');
    tno := (q ->> 'topic_no')::int;
    nq := games.norm(qtext);
    if cid is null then raise exception 'A question has no chapter ID.'; end if;
    why := games.codes_problem(q ->> 'board', q ->> 'subject', cid);
    if why is not null then raise exception '%', why; end if;
    -- the fixed list
    select * into ch from games.chapters c where c.chapter_id = cid;
    if not found then
      raise exception 'Chapter % (%, class %, %) isn''t on the list of chapters.', q ->> 'chapter_no', q ->> 'board', q ->> 'class', q ->> 'subject';
    end if;
    if games.norm(ch.name) is distinct from games.norm(q ->> 'chapter') then
      raise exception 'Chapter % is called "%" on the list, not "%".', ch.chapter_no, ch.name, q ->> 'chapter';
    end if;
    -- the list fixes a chapter's topics when it gives it any; otherwise its questions may go under topics of their own
    fixed := exists (select 1 from games.topics t where t.chapter_id = cid and t.from_list);
    tp := null;
    tname := btrim(coalesce(q ->> 'topic', ''));
    if tno is not null then
      select * into tp from games.topics t where t.chapter_id = cid and t.topic_no = tno;
      if found then
        if games.norm(tp.name) is distinct from games.norm(tname) then
          raise exception 'Topic % of chapter % is called "%"%, not "%".', tno, ch.chapter_no, tp.name, case when tp.from_list then ' on the list' else '' end, tname;
        end if;
      elsif fixed then
        raise exception 'Chapter % ("%") has no topic % on the list.', ch.chapter_no, ch.name, tno;
      else
        -- a new topic: added to the chapter under the number and name it was sent with
        if tno not between 1 and 99 or char_length(tname) not between 1 and 120 then
          raise exception 'A topic needs a number from 1 to 99 and a name of at most 120 characters: "%".', qtext;
        end if;
        select * into tp from games.topics t where t.chapter_id = cid and games.norm(t.name) = games.norm(tname);
        if found then
          raise exception 'Chapter % ("%") already has "%" as topic %.', ch.chapter_no, ch.name, tp.name, tp.topic_no;
        end if;
        insert into games.topics (topic_id, chapter_id, topic_no, name, from_list)
        values (cid || 'T' || lpad(tno::text, 2, '0'), cid, tno, tname, false)
        returning * into tp;
      end if;
    elsif fixed then
      raise exception 'A question in chapter % ("%") has no topic. Put it under one of the chapter''s topics.', ch.chapter_no, ch.name;
    end if;
    -- multiple choice: up to 5 wrong options, each different from the answer and from each other
    wrong := coalesce((select array_agg(btrim(w.x) order by w.i)
                       from jsonb_array_elements_text(case when jsonb_typeof(q -> 'wrong_options') = 'array' then q -> 'wrong_options' else '[]' end)
                            with ordinality as w(x, i)), '{}');
    if cardinality(wrong) > 5 then raise exception 'A question has more than 5 wrong options: "%".', qtext; end if;
    if exists (select 1 from unnest(wrong) x where char_length(x) not between 1 and 100) then
      raise exception 'A wrong option is empty or longer than 100 characters: "%".', qtext;
    end if;
    if exists (select 1 from unnest(wrong) x where games.norm(x) = games.norm(q ->> 'answer')) then
      raise exception 'A wrong option is the same as the answer: "%".', qtext;
    end if;
    if (select count(distinct games.norm(x)) from unnest(wrong) x) <> cardinality(wrong) then
      raise exception 'A question has the same wrong option twice: "%".', qtext;
    end if;
    -- other answers that count: up to 5, each different from the answer and from each other
    others := coalesce((select array_agg(btrim(w.x) order by w.i)
                        from jsonb_array_elements_text(case when jsonb_typeof(q -> 'also') = 'array' then q -> 'also' else '[]' end)
                             with ordinality as w(x, i)), '{}');
    if cardinality(others) > 5 then raise exception 'A question has more than 5 other answers: "%".', qtext; end if;
    if exists (select 1 from unnest(others) x where char_length(x) not between 1 and 100) then
      raise exception 'Another answer is empty or longer than 100 characters: "%".', qtext;
    end if;
    if exists (select 1 from unnest(others) x where games.norm(x) = games.norm(q ->> 'answer'))
       or (select count(distinct games.norm(x)) from unnest(others) x) <> cardinality(others) then
      raise exception 'Another answer repeats the answer or another one: "%".', qtext;
    end if;
    -- the fill-in sentence: exactly one ___
    sentence := nullif(btrim(coalesce(q ->> 'fill', '')), '');
    if sentence is not null and (char_length(sentence) > 300 or sentence !~ '_{3,}' or sentence ~ '_{3,}[^_].*_{3,}') then
      raise exception 'The fill-in sentence needs exactly one ___ and at most 300 characters: "%".', qtext;
    end if;

    if cid || '|' || nq = any(seen)
       or exists (select 1 from games.questions x where x.chapter_id = cid and games.norm(x.question) = nq and x.status <> 'rejected') then
      already := already + 1;
      continue;
    end if;
    seen := seen || (cid || '|' || nq);
    select array_agg(x.question_id) into back from games.questions x join games.batches b on b.batch_id = x.batch_id
    where x.chapter_id = cid and x.status = 'rejected' and games.norm(x.question) = nq
      and games.norm(x.answer) = games.norm(q ->> 'answer') and x.also = others and coalesce(x.fill, '') = coalesce(sentence, '')
      and x.wrong_options = wrong and b.teacher_email = mail;
    if back is not null then
      sent_back := sent_back + 1;
      back_ids := back_ids || back;
      continue;
    end if;
    select coalesce(max(x.question_no), 0) + 1 into n from games.questions x where x.chapter_id = cid and coalesce(x.topic_no, 0) = coalesce(tno, 0);
    -- a question ID has three digits for its number (Q001 to Q999)
    if n > 999 then
      raise exception '% already has 999 questions, the most it can hold. Nothing was sent.',
        case when tno is null then format('Chapter %s ("%s")', ch.chapter_no, ch.name) else format('Topic %s ("%s") of chapter %s', tno, tp.name, ch.chapter_no) end;
    end if;
    insert into games.questions (question_id, batch_id, chapter_id, topic_id, board, class, subject, chapter_no, chapter,
                                 topic_no, topic, question_no, question, answer, also, fill, wrong_options, difficulty)
    values (cid || 'T' || lpad(coalesce(tno, 0)::text, 2, '0') || 'Q' || lpad(n::text, 3, '0'), bid, cid,
            case when tno is null then null else cid || 'T' || lpad(tno::text, 2, '0') end,
            ch.board, ch.class, ch.subject, ch.chapter_no, ch.name, tno, coalesce(tp.name, ''),
            n, qtext, btrim(q ->> 'answer'), others, sentence, wrong, q ->> 'difficulty')
    returning question_id into qid;
    added := added || qid;
    sent := sent + 1;
  end loop;

  if sent = 0 then
    delete from games.batches b where b.batch_id = bid;
    bid := null;
  end if;
  return jsonb_build_object('batch_id', bid, 'sent', sent, 'already', already, 'sent_back', sent_back, 'sent_back_ids', to_jsonb(back_ids), 'question_ids', to_jsonb(added));
end $$;

-- ---------------------------------------------------------------- approving

-- The number waiting, on the Approve questions link. HoDs and admins.
create function games.waiting_count() returns int language plpgsql stable security definer set search_path = ''
as $$
begin
  if not games.is_hod() then raise exception 'Only HoDs and admins can approve questions.'; end if;
  return (select count(*)::int from games.questions where status = 'pending');
end $$;

-- Every question waiting or sent back, with who sent it and when, oldest first. HoDs and admins.
create function games.hod_questions() returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if not games.is_hod() then raise exception 'Only HoDs and admins can approve questions.'; end if;
  return (
    select coalesce(jsonb_agg(to_jsonb(q) || jsonb_build_object('teacher', b.teacher, 'teacher_email', b.teacher_email, 'sent_at', b.sent_at)
                              order by b.sent_at, q.question_id), '[]')
    from games.questions q join games.batches b on b.batch_id = q.batch_id
    where q.status in ('pending', 'rejected')
  );
end $$;

-- Approved questions, newest first, a page at a time: the page after (before_at, before_id). HoDs and admins.
create function games.hod_approved(before_at timestamptz default null, before_id text default null, take int default 200) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not games.is_hod() then raise exception 'Only HoDs and admins can approve questions.'; end if;
  return (
    select coalesce(jsonb_agg(to_jsonb(q) || jsonb_build_object('teacher', b.teacher, 'teacher_email', b.teacher_email, 'sent_at', b.sent_at)
                              order by q.reviewed_at desc, q.question_id desc), '[]')
    from (
      select * from games.questions x
      where x.status = 'approved' and (x.reviewed_at, x.question_id) < (coalesce(before_at, 'infinity'), coalesce(before_id, ''))
      order by x.reviewed_at desc, x.question_id desc
      limit least(greatest(coalesce(take, 200), 1), 1000)
    ) q join games.batches b on b.batch_id = q.batch_id
  );
end $$;

-- Approve (approved), send back with a reason (rejected) or move back to waiting (pending). Returns what changed, what
-- was skipped, and how many are now waiting and approved. HoDs and admins.
create function games.hod_set_status(ids text[], new_status text, reason text default '') returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  why text := btrim(coalesce(reason, ''));
  skipped text[] := '{}';
  done jsonb;
begin
  if not games.is_hod() then raise exception 'Only HoDs and admins can approve questions.'; end if;
  if new_status is null or new_status not in ('pending', 'approved', 'rejected') then raise exception 'Unknown status.'; end if;
  if new_status = 'rejected' and why = '' then raise exception 'Say why the question is going back.'; end if;
  -- a sent-back question stays sent back while the same question (sent again) is waiting or approved
  if new_status <> 'rejected' then
    select coalesce(array_agg(t.question_id), '{}') into skipped
    from games.questions t
    where t.question_id = any(ids) and t.status = 'rejected' and (
      exists (select 1 from games.questions x
              where x.chapter_id = t.chapter_id and games.norm(x.question) = games.norm(t.question) and x.status <> 'rejected')
      or exists (select 1 from games.questions u
                 where u.question_id = any(ids) and u.status = 'rejected' and u.question_id < t.question_id
                   and u.chapter_id = t.chapter_id and games.norm(u.question) = games.norm(t.question)));
  end if;
  with changed as (
    update games.questions q
    set status = new_status,
        note = case when new_status = 'rejected' then why else '' end,
        reviewed_at = case when new_status = 'pending' then null else now() end,
        reviewed_by = case when new_status = 'pending' then null else games.proven_email() end,
        seen_at = null
    where q.question_id = any(ids) and q.question_id <> all(skipped)
      -- nothing to do when it already has this status (and this reason): its time and "seen" stay as they are
      and (q.status is distinct from new_status or (new_status = 'rejected' and q.note is distinct from why))
    returning q.question_id
  )
  select coalesce(jsonb_agg(changed.question_id), '[]') into done from changed;
  return jsonb_build_object('changed', done, 'skipped', to_jsonb(skipped),
    'waiting', (select count(*) from games.questions where status = 'pending'),
    'approved', (select count(*) from games.question_bank));
end $$;

-- ---------------------------------------------------------------- the teacher's sent-back questions

-- The signed-in person's questions that were sent back, newest first: the reason, who sent it back, whether they have
-- seen it, and whether the same question has since been sent again (waiting or approved).
create function games.my_sent_back() returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if games.team_role() is null then raise exception 'Only people on the games team can see this.'; end if;
  return (
    select coalesce(jsonb_agg(to_jsonb(q) - 'reviewed_by' - 'seen_at' || jsonb_build_object(
        'sent_at', b.sent_at,
        'reviewer', coalesce(r.name, 'Your HoD'),
        'seen', q.seen_at is not null,
        'now', (select x.status from games.questions x
                where x.chapter_id = q.chapter_id and games.norm(x.question) = games.norm(q.question) and x.status <> 'rejected'
                order by x.status = 'approved' desc limit 1))
      order by q.reviewed_at desc, q.question_id), '[]')
    from games.questions q
    join games.batches b on b.batch_id = q.batch_id
    left join games.team r on r.email = q.reviewed_by
    where q.status = 'rejected' and b.teacher_email = games.proven_email()
  );
end $$;

-- The person has seen these sent-back questions (the ones shown to them; all of them when no list is given).
create function games.mark_sent_back_seen(ids text[] default null) returns void language plpgsql security definer set search_path = ''
as $$
begin
  if games.team_role() is null then raise exception 'Only people on the games team can do this.'; end if;
  update games.questions q set seen_at = now()
  from games.batches b
  where b.batch_id = q.batch_id and b.teacher_email = games.proven_email() and q.status = 'rejected' and q.seen_at is null
    and (ids is null or q.question_id = any(ids));
end $$;

-- ---------------------------------------------------------------- the question bank, for the team

-- Every approved question, in order (Try the games and the download). The team only, for now.
create function games.bank() returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if games.team_role() is null then raise exception 'Only people on the games team can see this.'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(b) order by b.class, b.subject, b.chapter_no, b.topic_no, b.question_no, b.question_id), '[]')
          from games.question_bank b);
end $$;

create function games.bank_count() returns int language plpgsql stable security definer set search_path = ''
as $$
begin
  if games.team_role() is null then raise exception 'Only people on the games team can see this.'; end if;
  return (select count(*)::int from games.question_bank);
end $$;

-- ---------------------------------------------------------------- the list, for admins (the Chapters page)

-- Admins keep the list on the site, one board, class and subject at a time: add chapters and topics, rename them (their
-- questions take the new name), change a number or delete only while nothing has been sent for it (the number is part
-- of every question ID), and open or fix a chapter's topics. The page saves them all at once, and each change is noted
-- here.
create table games.list_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  by_email text, -- null: the install script (the starting list)
  action text not null check (action in ('add', 'rename', 'renumber', 'delete', 'topics')),
  detail text not null check (char_length(detail) between 1 and 500)
);
comment on table games.list_log is 'The list of chapters and topics: the starting list (by_email null, the install script), then every change an admin made, newest last.';

create function games.list_check_admin() returns void language plpgsql stable security definer set search_path = ''
as $$
begin
  if games.team_role() is distinct from 'admin' then raise exception 'Only a games admin can change the list of chapters.'; end if;
end $$;

create function games.list_note(act text, what text) returns void language sql security definer set search_path = ''
as $$ insert into games.list_log (by_email, action, detail) values (games.proven_email(), act, left(what, 500)) $$;

-- How a chapter is named in messages: "Chapter 4 (CBSE class 10 Science)".
create function games.list_label(c games.chapters) returns text language sql immutable set search_path = ''
as $$ select format('Chapter %s (%s class %s %s)', c.chapter_no, c.board, c.class, c.subject) $$;

-- The list as admins see it: every chapter with its topics, how many questions each has (of any status), whether its
-- topics are open, and the latest changes.
create function games.admin_list() returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  perform games.list_check_admin();
  return jsonb_build_object(
    'chapters', coalesce((
      select jsonb_agg(jsonb_build_object('chapter_id', c.chapter_id, 'board', c.board, 'class', c.class, 'subject', c.subject,
                                          'chapter_no', c.chapter_no, 'name', c.name,
                                          'open', not exists (select 1 from games.topics t where t.chapter_id = c.chapter_id and t.from_list),
                                          'questions', (select count(*) from games.questions q where q.chapter_id = c.chapter_id),
                                          'topics', coalesce((select jsonb_agg(jsonb_build_object('topic_id', t.topic_id, 'topic_no', t.topic_no, 'name', t.name,
                                                                'questions', (select count(*) from games.questions q where q.chapter_id = t.chapter_id and q.topic_no = t.topic_no))
                                                              order by t.topic_no)
                                                              from games.topics t where t.chapter_id = c.chapter_id), '[]'))
                       order by c.board, c.class, c.subject, c.chapter_no)
      from games.chapters c), '[]'),
    'log', coalesce((
      select jsonb_agg(jsonb_build_object('at', l.at, 'by', coalesce(nullif(btrim(m.name), ''), l.by_email, 'the install script'), 'action', l.action, 'detail', l.detail) order by l.id desc)
      from (select * from games.list_log order by id desc limit 30) l left join games.team m on m.email = l.by_email), '[]'));
end $$;

-- A topic for a chapter: its number and name must be free in the chapter. `fixed` says whether it is the list's.
create function games.list_add_topic(ch games.chapters, tno int, tname text, fixed boolean) returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  t games.topics%rowtype;
begin
  tname := btrim(coalesce(tname, ''));
  if tno is null or tno not between 1 and 99 then raise exception 'A topic number must be from 1 to 99 (% "%").', games.list_label(ch), tname; end if;
  if char_length(tname) not between 1 and 120 then raise exception 'A topic name must be 1 to 120 characters (% topic %).', games.list_label(ch), tno; end if;
  select * into t from games.topics x where x.chapter_id = ch.chapter_id and x.topic_no = tno;
  if found then
    if games.norm(t.name) is distinct from games.norm(tname) then
      raise exception 'Topic % of % is already "%", not "%". Rename it instead.', tno, games.list_label(ch), t.name, tname;
    end if;
    return false;
  end if;
  select * into t from games.topics x where x.chapter_id = ch.chapter_id and games.norm(x.name) = games.norm(tname);
  if found then raise exception '% already has "%" as topic %.', games.list_label(ch), t.name, t.topic_no; end if;
  insert into games.topics (topic_id, chapter_id, topic_no, name, from_list) values (ch.chapter_id || 'T' || lpad(tno::text, 2, '0'), ch.chapter_id, tno, tname, fixed);
  return true;
end $$;

-- Adds chapters (with any topics, which fix the chapter's topics): [{board, class, subject, chapter_no, name,
-- topics: [{topic_no, name}]}]. One already on the list under the same name is left as it is. All of it, or none.
-- The starting list (near the end) goes in through it.
create function games.list_add_chapters(chapters jsonb) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  r jsonb;
  t jsonb;
  b games.boards%rowtype;
  s games.subjects%rowtype;
  ch games.chapters%rowtype;
  cls int;
  no int;
  nm text;
  cid text;
  added int := 0;
  topics int := 0;
  already int := 0;
begin
  if jsonb_typeof(chapters) is distinct from 'array' or jsonb_array_length(chapters) not between 1 and 2000 then
    raise exception 'Add between 1 and 2,000 chapters at a time.';
  end if;
  for r in select * from jsonb_array_elements(chapters) loop
    select * into b from games.boards x where lower(x.name) = lower(btrim(coalesce(r ->> 'board', '')));
    if not found then raise exception 'The board "%" isn''t on the site''s list.', r ->> 'board'; end if;
    select * into s from games.subjects x where lower(x.name) = lower(btrim(coalesce(r ->> 'subject', '')));
    if not found then raise exception 'The subject "%" isn''t on the site''s list.', r ->> 'subject'; end if;
    cls := case when (r ->> 'class') ~ '^\d{1,2}$' then (r ->> 'class')::int end;
    no := case when (r ->> 'chapter_no') ~ '^\d{1,2}$' then (r ->> 'chapter_no')::int end;
    nm := btrim(coalesce(r ->> 'name', ''));
    if cls is null or cls not between 1 and 12 then raise exception 'The class "%" isn''t a number from 1 to 12.', r ->> 'class'; end if;
    if no is null or no not between 1 and 99 then raise exception 'The chapter number "%" isn''t a number from 1 to 99.', r ->> 'chapter_no'; end if;
    if char_length(nm) not between 1 and 120 then raise exception 'A chapter name must be 1 to 120 characters (chapter % of % class % %).', no, b.name, cls, s.name; end if;
    cid := b.code || lpad(cls::text, 2, '0') || s.code || lpad(no::text, 2, '0');
    select * into ch from games.chapters c where c.chapter_id = cid;
    if found then
      if games.norm(ch.name) is distinct from games.norm(nm) then
        raise exception '% is already "%", not "%". Rename it instead.', games.list_label(ch), ch.name, nm;
      end if;
      already := already + 1;
    else
      select * into ch from games.chapters c where c.board = b.name and c.class = cls and c.subject = s.name and games.norm(c.name) = games.norm(nm);
      if found then raise exception '% class % % already has "%" as chapter %.', b.name, cls, s.name, ch.name, ch.chapter_no; end if;
      insert into games.chapters (chapter_id, board, class, subject, chapter_no, name) values (cid, b.name, cls, s.name, no, nm) returning * into ch;
      added := added + 1;
    end if;
    for t in select * from jsonb_array_elements(case when jsonb_typeof(r -> 'topics') = 'array' then r -> 'topics' else '[]' end) loop
      if games.list_add_topic(ch, case when (t ->> 'topic_no') ~ '^\d{1,2}$' then (t ->> 'topic_no')::int end, t ->> 'name', true) then topics := topics + 1; end if;
    end loop;
    -- a chapter the list gives topics has only the list's
    update games.topics x set from_list = true where x.chapter_id = cid and not x.from_list
      and jsonb_array_length(case when jsonb_typeof(r -> 'topics') = 'array' then r -> 'topics' else '[]' end) > 0;
  end loop;
  return jsonb_build_object('chapters', added, 'topics', topics, 'already', already);
end $$;

-- One board, class and subject's chapters as the Chapters page shows them, and sends back as `before` when it saves:
-- in order, each with whether its topics are open, and its topics in order.
create function games.list_group(b text, cls int, s text) returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'chapter_id', c.chapter_id, 'chapter_no', c.chapter_no, 'name', c.name,
      'open', not exists (select 1 from games.topics t where t.chapter_id = c.chapter_id and t.from_list),
      'topics', coalesce((select jsonb_agg(jsonb_build_object('topic_no', t.topic_no, 'name', t.name) order by t.topic_no)
                          from games.topics t where t.chapter_id = c.chapter_id), '[]'))
    order by c.chapter_no), '[]')
  from games.chapters c where c.board = b and c.class = cls and c.subject = s
$$;

-- Saves an admin's changes to one board, class and subject's chapters, all at once (the Chapters page's "Save changes"):
-- {board, class, subject, before, after}. `before` is the list as the page showed it (games.list_group); if it has
-- changed since, nothing is saved. `after` is the list as it is to be: [{chapter_id (null for a new chapter), chapter_no,
-- name, open, topics: [{was (the topic's number until now; null for a new topic), topic_no, name}]}]. A chapter or topic
-- left out of it is deleted. A name can change at any time, and its questions take the new one; a number changes, and a
-- chapter or topic is deleted, only while it has no questions, as the number is part of each question's ID. All of it,
-- or none of it; each change is noted. Bulk add saves several subjects at once: `changes` is then a list of these, and
-- if any is refused, none is kept.
create function games.admin_save_chapters(changes jsonb) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  b games.boards%rowtype;
  s games.subjects%rowtype;
  cls int;
  grp text;
  aft jsonb := changes -> 'after';
  c jsonb;
  t jsonb;
  o jsonb;
  cur games.chapters%rowtype;
  ch games.chapters%rowtype;
  old_topics jsonb;
  was_open boolean;
  is_open boolean;
  moved jsonb := '{}';
  no int;
  nm text;
  tno int;
  twas int;
  tnm text;
  n int;
  dup text;
  done int := 0;
begin
  perform games.list_check_admin();
  if jsonb_typeof(changes) = 'array' then
    if jsonb_array_length(changes) not between 1 and 200 then raise exception 'Save between 1 and 200 subjects at a time.'; end if;
    for c in select y from jsonb_array_elements(changes) y loop
      if jsonb_typeof(c) is distinct from 'object' then raise exception 'Each subject to save must be one object.'; end if;
      done := done + (games.admin_save_chapters(c) ->> 'changes')::int;
    end loop;
    return jsonb_build_object('changes', done);
  end if;
  select * into b from games.boards x where x.name = changes ->> 'board';
  if not found then raise exception 'The board "%" isn''t on the site''s list.', changes ->> 'board'; end if;
  select * into s from games.subjects x where x.name = changes ->> 'subject';
  if not found then raise exception 'The subject "%" isn''t on the site''s list.', changes ->> 'subject'; end if;
  cls := case when (changes ->> 'class') ~ '^\d{1,2}$' then (changes ->> 'class')::int end;
  if cls is null or cls not between 1 and 12 then raise exception 'The class must be from 1 to 12.'; end if;
  grp := format('%s class %s %s', b.name, cls, s.name);
  if (changes -> 'before') is distinct from games.list_group(b.name, cls, s.name) then
    raise exception 'The chapters of % changed after you opened them (another admin saved changes, or a question was sent under a new topic). Nothing was saved: press Revert changes to see them as they are now, then make your changes again.', grp;
  end if;

  -- what is to be saved, checked whole before anything changes
  if jsonb_typeof(aft) is distinct from 'array' or jsonb_array_length(aft) > 99 then
    raise exception 'The chapters to save must be a list of at most 99.';
  end if;
  for c in select y from jsonb_array_elements(aft) y loop
    no := case when (c ->> 'chapter_no') ~ '^\d{1,2}$' then (c ->> 'chapter_no')::int end;
    nm := btrim(coalesce(c ->> 'name', ''));
    if no is null or no not between 1 and 99 then raise exception 'A chapter number must be from 1 to 99 ("%").', nm; end if;
    if char_length(nm) not between 1 and 120 then raise exception 'The name of chapter % must be 1 to 120 characters.', no; end if;
    if nm ~ '[–—]' then raise exception 'No dashes in a name ("%"): use a colon or a comma.', nm; end if;
    if jsonb_typeof(c -> 'open') is distinct from 'boolean' or jsonb_typeof(c -> 'topics') is distinct from 'array' then
      raise exception 'Chapter % needs its topics, and whether they are open.', no;
    end if;
    if not (c ->> 'open')::boolean and jsonb_array_length(c -> 'topics') = 0 then
      raise exception 'Chapter % ("%") has no topics: add them first, then fix them.', no, nm;
    end if;
    if c ->> 'chapter_id' is not null then
      select * into cur from games.chapters x where x.chapter_id = c ->> 'chapter_id' and x.board = b.name and x.class = cls and x.subject = s.name;
      if not found then raise exception 'Chapter % isn''t one of the chapters of %.', c ->> 'chapter_id', grp; end if;
      if cur.chapter_no <> no then
        select count(*) into n from games.questions q where q.chapter_id = cur.chapter_id;
        if n > 0 then
          raise exception '% has %, so its number stays: it is part of each question''s ID.', games.list_label(cur), n || case when n = 1 then ' question' else ' questions' end;
        end if;
      end if;
    end if;
    for t in select y from jsonb_array_elements(c -> 'topics') y loop
      tno := case when (t ->> 'topic_no') ~ '^\d{1,2}$' then (t ->> 'topic_no')::int end;
      tnm := btrim(coalesce(t ->> 'name', ''));
      twas := case when (t ->> 'was') ~ '^\d{1,2}$' then (t ->> 'was')::int end;
      if tno is null or tno not between 1 and 99 then raise exception 'A topic number must be from 1 to 99 (chapter %, "%").', no, tnm; end if;
      if char_length(tnm) not between 1 and 120 then raise exception 'The name of topic % of chapter % must be 1 to 120 characters.', tno, no; end if;
      if tnm ~ '[–—]' then raise exception 'No dashes in a name ("%"): use a colon or a comma.', tnm; end if;
      if t ->> 'was' is not null then
        if twas is null or c ->> 'chapter_id' is null
           or not exists (select 1 from games.topics x where x.chapter_id = c ->> 'chapter_id' and x.topic_no = twas) then
          raise exception 'Chapter % has no topic % to keep.', no, t ->> 'was';
        end if;
        if twas <> tno then
          select count(*) into n from games.questions q where q.chapter_id = c ->> 'chapter_id' and q.topic_no = twas;
          if n > 0 then
            raise exception 'Topic % of % has %, so its number stays: it is part of each question''s ID.', twas, games.list_label(cur), n || case when n = 1 then ' question' else ' questions' end;
          end if;
        end if;
      end if;
    end loop;
    select min(y ->> 'topic_no') into dup from jsonb_array_elements(c -> 'topics') y group by (y ->> 'topic_no')::int having count(*) > 1 limit 1;
    if dup is not null then raise exception 'Chapter % has two topics numbered %.', no, dup; end if;
    select min(btrim(y ->> 'name')) into dup from jsonb_array_elements(c -> 'topics') y group by games.norm(y ->> 'name') having count(*) > 1 limit 1;
    if dup is not null then raise exception 'Chapter % has two topics called "%".', no, dup; end if;
    select min(y ->> 'was') into dup from jsonb_array_elements(c -> 'topics') y where y ->> 'was' is not null group by (y ->> 'was')::int having count(*) > 1 limit 1;
    if dup is not null then raise exception 'Topic % of chapter % is there twice.', dup, no; end if;
  end loop;
  select min(y ->> 'chapter_no') into dup from jsonb_array_elements(aft) y group by (y ->> 'chapter_no')::int having count(*) > 1 limit 1;
  if dup is not null then raise exception '% has two chapters numbered %.', grp, dup; end if;
  select min(btrim(y ->> 'name')) into dup from jsonb_array_elements(aft) y group by games.norm(y ->> 'name') having count(*) > 1 limit 1;
  if dup is not null then raise exception '% has two chapters called "%".', grp, dup; end if;
  select min(y ->> 'chapter_id') into dup from jsonb_array_elements(aft) y where y ->> 'chapter_id' is not null group by y ->> 'chapter_id' having count(*) > 1 limit 1;
  if dup is not null then raise exception 'Chapter % is there twice.', dup; end if;

  -- chapters left out are deleted; chapters given another number leave theirs (they come back below, it being free)
  for cur in select * from games.chapters x where x.board = b.name and x.class = cls and x.subject = s.name order by x.chapter_no loop
    select y into c from jsonb_array_elements(aft) y where y ->> 'chapter_id' = cur.chapter_id;
    if c is null then
      select count(*) into n from games.questions q where q.chapter_id = cur.chapter_id;
      if n > 0 then
        raise exception '% has %, so it can''t be deleted. Rename it instead.', games.list_label(cur), n || case when n = 1 then ' question' else ' questions' end;
      end if;
      delete from games.chapters x where x.chapter_id = cur.chapter_id;
      perform games.list_note('delete', format('%s "%s" deleted.', games.list_label(cur), cur.name));
      done := done + 1;
    elsif (c ->> 'chapter_no')::int <> cur.chapter_no then
      moved := moved || jsonb_build_object(cur.chapter_id, jsonb_build_object('chapter', to_jsonb(cur),
        'open', not exists (select 1 from games.topics x where x.chapter_id = cur.chapter_id and x.from_list),
        'topics', coalesce((select jsonb_agg(jsonb_build_object('topic_no', x.topic_no, 'name', x.name)) from games.topics x where x.chapter_id = cur.chapter_id), '[]')));
      delete from games.chapters x where x.chapter_id = cur.chapter_id;
    end if;
  end loop;

  -- each chapter as it is to be, then its topics
  for c in select y from jsonb_array_elements(aft) y order by (y ->> 'chapter_no')::int loop
    no := (c ->> 'chapter_no')::int;
    nm := btrim(c ->> 'name');
    is_open := (c ->> 'open')::boolean;
    if c ->> 'chapter_id' is null or moved ? (c ->> 'chapter_id') then
      insert into games.chapters (chapter_id, board, class, subject, chapter_no, name)
      values (b.code || lpad(cls::text, 2, '0') || s.code || lpad(no::text, 2, '0'), b.name, cls, s.name, no, nm) returning * into ch;
      done := done + 1;
      if c ->> 'chapter_id' is null then
        perform games.list_note('add', format('%s "%s" added.', games.list_label(ch), nm));
        old_topics := '[]';
        was_open := true;
      else
        o := moved -> (c ->> 'chapter_id');
        cur := jsonb_populate_record(null::games.chapters, o -> 'chapter');
        perform games.list_note('renumber', format('%s "%s" is now chapter %s.', games.list_label(cur), cur.name, no));
        if nm is distinct from cur.name then
          perform games.list_note('rename', format('%s: "%s" renamed "%s".', games.list_label(ch), cur.name, nm));
          done := done + 1;
        end if;
        old_topics := o -> 'topics';
        was_open := (o ->> 'open')::boolean;
      end if;
    else
      select * into ch from games.chapters x where x.chapter_id = c ->> 'chapter_id';
      if nm is distinct from ch.name then
        update games.chapters x set name = nm where x.chapter_id = ch.chapter_id;
        update games.questions q set chapter = nm where q.chapter_id = ch.chapter_id;
        update games.question_bank q set chapter = nm where q.chapter_id = ch.chapter_id;
        perform games.list_note('rename', format('%s: "%s" renamed "%s".', games.list_label(ch), ch.name, nm));
        done := done + 1;
      end if;
      old_topics := coalesce((select jsonb_agg(jsonb_build_object('topic_no', x.topic_no, 'name', x.name)) from games.topics x where x.chapter_id = ch.chapter_id), '[]');
      was_open := not exists (select 1 from games.topics x where x.chapter_id = ch.chapter_id and x.from_list);
    end if;

    -- topics left out are deleted; topics given another number leave theirs
    for o in select x from jsonb_array_elements(old_topics) x
             where not exists (select 1 from jsonb_array_elements(c -> 'topics') y where (y ->> 'was')::int = (x ->> 'topic_no')::int) loop
      tno := (o ->> 'topic_no')::int;
      select count(*) into n from games.questions q where q.chapter_id = ch.chapter_id and q.topic_no = tno;
      if n > 0 then
        raise exception 'Topic % of % has %, so it can''t be deleted. Rename it instead.', tno, games.list_label(ch), n || case when n = 1 then ' question' else ' questions' end;
      end if;
      delete from games.topics x where x.chapter_id = ch.chapter_id and x.topic_no = tno;
      perform games.list_note('delete', format('%s topic %s "%s" deleted.', games.list_label(ch), tno, o ->> 'name'));
      done := done + 1;
    end loop;
    delete from games.topics x where x.chapter_id = ch.chapter_id
      and exists (select 1 from jsonb_array_elements(c -> 'topics') y where (y ->> 'was')::int = x.topic_no and (y ->> 'topic_no')::int <> x.topic_no);
    for t in select y from jsonb_array_elements(c -> 'topics') y order by (y ->> 'topic_no')::int loop
      tno := (t ->> 'topic_no')::int;
      tnm := btrim(t ->> 'name');
      twas := (t ->> 'was')::int;
      select x into o from jsonb_array_elements(old_topics) x where (x ->> 'topic_no')::int = twas;
      if twas = tno and exists (select 1 from games.topics x where x.chapter_id = ch.chapter_id and x.topic_no = tno) then
        if tnm is distinct from o ->> 'name' then
          update games.topics x set name = tnm where x.chapter_id = ch.chapter_id and x.topic_no = tno;
          update games.questions q set topic = tnm where q.chapter_id = ch.chapter_id and q.topic_no = tno;
          update games.question_bank q set topic = tnm where q.chapter_id = ch.chapter_id and q.topic_no = tno;
          perform games.list_note('rename', format('%s topic %s: "%s" renamed "%s".', games.list_label(ch), tno, o ->> 'name', tnm));
          done := done + 1;
        end if;
      else
        insert into games.topics (topic_id, chapter_id, topic_no, name, from_list)
        values (ch.chapter_id || 'T' || lpad(tno::text, 2, '0'), ch.chapter_id, tno, tnm, not is_open);
        if twas is null then
          perform games.list_note('add', format('%s: added topic %s "%s".', games.list_label(ch), tno, tnm));
          done := done + 1;
        else
          if twas <> tno then
            perform games.list_note('renumber', format('%s topic %s "%s" is now topic %s.', games.list_label(ch), twas, o ->> 'name', tno));
            done := done + 1;
          end if;
          if tnm is distinct from o ->> 'name' then
            perform games.list_note('rename', format('%s topic %s: "%s" renamed "%s".', games.list_label(ch), tno, o ->> 'name', tnm));
            done := done + 1;
          end if;
        end if;
      end if;
    end loop;
    update games.topics x set from_list = not is_open where x.chapter_id = ch.chapter_id and x.from_list is distinct from not is_open;
    if c ->> 'chapter_id' is not null and is_open is distinct from was_open and jsonb_array_length(c -> 'topics') > 0 then
      perform games.list_note('topics', format('%s: topics %s.', games.list_label(ch), case when is_open then 'opened' else 'fixed' end));
      done := done + 1;
    end if;
  end loop;
  return jsonb_build_object('changes', done);
end $$;

-- Up to 20 of a topic's questions (topic_no null: a chapter's questions under no topic), of any status, in order, and
-- how many it has: what the Chapters page shows under a topic.
create function games.admin_topic_questions(chapter text, topic_no int) returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  cid text := chapter;
  tno int := coalesce(topic_no, 0);
begin
  perform games.list_check_admin();
  return jsonb_build_object(
    'total', (select count(*) from games.questions q where q.chapter_id = cid and coalesce(q.topic_no, 0) = tno),
    'questions', coalesce((
      select jsonb_agg(jsonb_build_object('question_id', q.question_id, 'question', q.question, 'answer', q.answer, 'status', q.status) order by q.question_no)
      from (select * from games.questions x where x.chapter_id = cid and coalesce(x.topic_no, 0) = tno order by x.question_no limit 20) q), '[]'));
end $$;

-- ---------------------------------------------------------------- who can see what

-- Nobody reads or writes the tables directly (the functions do it for them).
do $$
declare t record;
begin
  for t in select c.oid::regclass r from pg_class c where c.relnamespace = 'games'::regnamespace and c.relkind = 'r' loop
    execute format('alter table %s enable row level security', t.r);
    execute format('revoke all on %s from public, anon, authenticated', t.r);
  end loop;
end $$;

-- Functions are callable by everyone unless taken away (Postgres' own rule for a new schema): take every one away,
-- then give the ones the site calls to signed-in people only. Each checks the team list itself.
revoke execute on all functions in schema games from public, anon, authenticated;
grant execute on function games.my_role(), games.catalog(), games.submit_batch(jsonb), games.my_sent_back(), games.mark_sent_back_seen(text[]),
  games.bank(), games.bank_count(), games.waiting_count(), games.hod_questions(), games.hod_approved(timestamptz, text, int),
  games.hod_set_status(text[], text, text), games.admin_people(), games.admin_set_role(text, text), games.admin_remove(text),
  games.admin_list(), games.admin_save_chapters(jsonb), games.admin_topic_questions(text, int) to authenticated;

-- ---------------------------------------------------------------- the moderator

do $$
declare
  mail text := lower(btrim(current_setting('games_install.moderator')));
begin
  if mail !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Put the moderator''s Google email on the MODERATOR line near the top, then run the script again. Nothing was kept.';
  end if;
  insert into games.team (email, role, moderator) values (mail, 'admin', true);
end $$;

-- ---------------------------------------------------------------- the starting list of chapters

-- The chapters the team starts with: one row each (board, class, subject, chapter number, chapter), numbered in the
-- order each syllabus teaches them, with no topics (writers divide each chapter into topics as they send questions).
-- They go in through games.list_add_chapters, with the same checks as the Chapters page: a board or subject the site
-- doesn't know, a number or name out of range, or a name used twice in a subject stops the script, and nothing is kept.
-- Admins change the list later on the site's Chapters page.
create temporary table games_install_list (board text, class int, subject text, chapter_no int, name text) on commit drop;
insert into games_install_list (board, class, subject, chapter_no, name) values
-- From the site (178): every Mathematics chapter in Shikshaq's question bank (13 October 2026), under the site's names.
  ('CBSE', 10, 'Mathematics', 1, 'Real Numbers'),
  ('CBSE', 10, 'Mathematics', 2, 'Factorisation and Remainder Theorem'),
  ('CBSE', 10, 'Mathematics', 3, 'Pair of Linear Equations in Two Variables'),
  ('CBSE', 10, 'Mathematics', 4, 'Quadratic Equations'),
  ('CBSE', 10, 'Mathematics', 5, 'Arithmetic Progression'),
  ('CBSE', 10, 'Mathematics', 6, 'Similarity'),
  ('CBSE', 10, 'Mathematics', 7, 'Coordinate Geometry'),
  ('CBSE', 10, 'Mathematics', 8, 'Trigonometry'),
  ('CBSE', 10, 'Mathematics', 9, 'Circles'),
  ('CBSE', 10, 'Mathematics', 10, 'Constructions'),
  ('CBSE', 10, 'Mathematics', 11, 'Mensuration'),
  ('CBSE', 10, 'Mathematics', 12, 'Statistics'),
  ('CBSE', 10, 'Mathematics', 13, 'Probability'),
  ('CBSE', 12, 'Mathematics', 1, 'Relations and Functions'),
  ('CBSE', 12, 'Mathematics', 2, 'Inverse Trigonometric Functions'),
  ('CBSE', 12, 'Mathematics', 3, 'Matrices'),
  ('CBSE', 12, 'Mathematics', 4, 'Determinants'),
  ('CBSE', 12, 'Mathematics', 5, 'Continuity and Differentiability'),
  ('CBSE', 12, 'Mathematics', 6, 'Applications of Derivatives'),
  ('CBSE', 12, 'Mathematics', 7, 'Integrals'),
  ('CBSE', 12, 'Mathematics', 8, 'Applications of Integrals'),
  ('CBSE', 12, 'Mathematics', 9, 'Differential Equations'),
  ('CBSE', 12, 'Mathematics', 10, 'Vector Algebra'),
  ('CBSE', 12, 'Mathematics', 11, 'Three-dimensional Geometry'),
  ('CBSE', 12, 'Mathematics', 12, 'Linear Programming'),
  ('CBSE', 12, 'Mathematics', 13, 'Probability'),
  ('ICSE', 3, 'Mathematics', 1, 'Numbers and Place Value'),
  ('ICSE', 3, 'Mathematics', 2, 'Addition and Subtraction'),
  ('ICSE', 3, 'Mathematics', 3, 'Multiplication'),
  ('ICSE', 3, 'Mathematics', 4, 'Money'),
  ('ICSE', 3, 'Mathematics', 5, 'Measurement'),
  ('ICSE', 3, 'Mathematics', 6, 'Time and Calendar'),
  ('ICSE', 3, 'Mathematics', 7, 'Shapes'),
  ('ICSE', 3, 'Mathematics', 8, 'Spatial Reasoning'),
  ('ICSE', 3, 'Mathematics', 9, 'Patterns'),
  ('ICSE', 3, 'Mathematics', 10, 'Data Handling'),
  ('ICSE', 4, 'Mathematics', 1, 'Numbers and Place Value'),
  ('ICSE', 4, 'Mathematics', 2, 'Addition and Subtraction'),
  ('ICSE', 4, 'Mathematics', 3, 'Multiplication and Division'),
  ('ICSE', 4, 'Mathematics', 4, 'Fractions'),
  ('ICSE', 4, 'Mathematics', 5, 'Money'),
  ('ICSE', 4, 'Mathematics', 6, 'Measurement'),
  ('ICSE', 4, 'Mathematics', 7, 'Perimeter and Area'),
  ('ICSE', 4, 'Mathematics', 8, 'Time'),
  ('ICSE', 4, 'Mathematics', 9, 'Shapes and Spatial Reasoning'),
  ('ICSE', 4, 'Mathematics', 10, 'Maps and Directions'),
  ('ICSE', 4, 'Mathematics', 11, 'Patterns'),
  ('ICSE', 4, 'Mathematics', 12, 'Data Handling'),
  ('ICSE', 5, 'Mathematics', 1, 'Numbers and Place Value'),
  ('ICSE', 5, 'Mathematics', 2, 'Addition and Subtraction'),
  ('ICSE', 5, 'Mathematics', 3, 'Multiplication and Division'),
  ('ICSE', 5, 'Mathematics', 4, 'Factors and Multiples'),
  ('ICSE', 5, 'Mathematics', 5, 'Fractions'),
  ('ICSE', 5, 'Mathematics', 6, 'Decimals'),
  ('ICSE', 5, 'Mathematics', 7, 'Money'),
  ('ICSE', 5, 'Mathematics', 8, 'Measurement'),
  ('ICSE', 5, 'Mathematics', 9, 'Area and Perimeter'),
  ('ICSE', 5, 'Mathematics', 10, 'Time'),
  ('ICSE', 5, 'Mathematics', 11, 'Shapes and Angles'),
  ('ICSE', 5, 'Mathematics', 12, 'Spatial Reasoning'),
  ('ICSE', 5, 'Mathematics', 13, 'Maps and Directions'),
  ('ICSE', 5, 'Mathematics', 14, 'Patterns'),
  ('ICSE', 5, 'Mathematics', 15, 'Data Handling'),
  ('ICSE', 6, 'Mathematics', 1, 'Knowing Our Numbers'),
  ('ICSE', 6, 'Mathematics', 2, 'Whole Numbers'),
  ('ICSE', 6, 'Mathematics', 3, 'Playing with Numbers'),
  ('ICSE', 6, 'Mathematics', 4, 'Basic Geometrical Ideas'),
  ('ICSE', 6, 'Mathematics', 5, 'Understanding Elementary Shapes'),
  ('ICSE', 6, 'Mathematics', 6, 'Integers'),
  ('ICSE', 6, 'Mathematics', 7, 'Fractions'),
  ('ICSE', 6, 'Mathematics', 8, 'Decimals'),
  ('ICSE', 6, 'Mathematics', 9, 'Data Handling'),
  ('ICSE', 6, 'Mathematics', 10, 'Mensuration'),
  ('ICSE', 6, 'Mathematics', 11, 'Algebra'),
  ('ICSE', 6, 'Mathematics', 12, 'Ratio and Proportion'),
  ('ICSE', 6, 'Mathematics', 13, 'Symmetry'),
  ('ICSE', 6, 'Mathematics', 14, 'Practical Geometry'),
  ('ICSE', 7, 'Mathematics', 1, 'Integers'),
  ('ICSE', 7, 'Mathematics', 2, 'Fractions and Decimals'),
  ('ICSE', 7, 'Mathematics', 3, 'Data Handling'),
  ('ICSE', 7, 'Mathematics', 4, 'Simple Equations'),
  ('ICSE', 7, 'Mathematics', 5, 'Lines and Angles'),
  ('ICSE', 7, 'Mathematics', 6, 'The Triangle and Its Properties'),
  ('ICSE', 7, 'Mathematics', 7, 'Congruence of Triangles'),
  ('ICSE', 7, 'Mathematics', 8, 'Comparing Quantities'),
  ('ICSE', 7, 'Mathematics', 9, 'Rational Numbers'),
  ('ICSE', 7, 'Mathematics', 10, 'Practical Geometry'),
  ('ICSE', 7, 'Mathematics', 11, 'Perimeter and Area'),
  ('ICSE', 7, 'Mathematics', 12, 'Algebraic Expressions'),
  ('ICSE', 7, 'Mathematics', 13, 'Exponents and Powers'),
  ('ICSE', 7, 'Mathematics', 14, 'Symmetry'),
  ('ICSE', 7, 'Mathematics', 15, 'Visualising Solid Shapes'),
  ('ICSE', 8, 'Mathematics', 1, 'Rational Numbers'),
  ('ICSE', 8, 'Mathematics', 2, 'Linear Equations in One Variable'),
  ('ICSE', 8, 'Mathematics', 3, 'Understanding Quadrilaterals'),
  ('ICSE', 8, 'Mathematics', 4, 'Practical Geometry'),
  ('ICSE', 8, 'Mathematics', 5, 'Data Handling'),
  ('ICSE', 8, 'Mathematics', 6, 'Squares and Square Roots'),
  ('ICSE', 8, 'Mathematics', 7, 'Cubes and Cube Roots'),
  ('ICSE', 8, 'Mathematics', 8, 'Comparing Quantities'),
  ('ICSE', 8, 'Mathematics', 9, 'Algebraic Expressions and Identities'),
  ('ICSE', 8, 'Mathematics', 10, 'Visualising Solid Shapes'),
  ('ICSE', 8, 'Mathematics', 11, 'Mensuration'),
  ('ICSE', 8, 'Mathematics', 12, 'Exponents and Powers'),
  ('ICSE', 8, 'Mathematics', 13, 'Direct and Inverse Proportions'),
  ('ICSE', 8, 'Mathematics', 14, 'Factorisation'),
  ('ICSE', 8, 'Mathematics', 15, 'Introduction to Graphs'),
  ('ICSE', 8, 'Mathematics', 16, 'Playing with Numbers'),
  ('ICSE', 9, 'Mathematics', 1, 'Number Systems'),
  ('ICSE', 9, 'Mathematics', 2, 'Compound Interest'),
  ('ICSE', 9, 'Mathematics', 3, 'Algebraic Identities and Factorisation'),
  ('ICSE', 9, 'Mathematics', 4, 'Polynomials'),
  ('ICSE', 9, 'Mathematics', 5, 'Linear Equations in Two Variables'),
  ('ICSE', 9, 'Mathematics', 6, 'Indices and Logarithms'),
  ('ICSE', 9, 'Mathematics', 7, 'Euclidean Geometry'),
  ('ICSE', 9, 'Mathematics', 8, 'Lines and Angles'),
  ('ICSE', 9, 'Mathematics', 9, 'Triangles'),
  ('ICSE', 9, 'Mathematics', 10, 'Quadrilaterals'),
  ('ICSE', 9, 'Mathematics', 11, 'Areas of Parallelograms and Triangles'),
  ('ICSE', 9, 'Mathematics', 12, 'Circles'),
  ('ICSE', 9, 'Mathematics', 13, 'Constructions'),
  ('ICSE', 9, 'Mathematics', 14, 'Statistics'),
  ('ICSE', 9, 'Mathematics', 15, 'Mensuration'),
  ('ICSE', 9, 'Mathematics', 16, 'Heron''s Formula'),
  ('ICSE', 9, 'Mathematics', 17, 'Surface Areas and Volumes'),
  ('ICSE', 9, 'Mathematics', 18, 'Trigonometry'),
  ('ICSE', 9, 'Mathematics', 19, 'Coordinate Geometry'),
  ('ICSE', 9, 'Mathematics', 20, 'Probability'),
  ('ICSE', 10, 'Mathematics', 1, 'GST and Banking'),
  ('ICSE', 10, 'Mathematics', 2, 'Shares and Dividends'),
  ('ICSE', 10, 'Mathematics', 3, 'Linear Inequations'),
  ('ICSE', 10, 'Mathematics', 4, 'Quadratic Equations'),
  ('ICSE', 10, 'Mathematics', 5, 'Ratio and Proportion'),
  ('ICSE', 10, 'Mathematics', 6, 'Factorisation and Remainder Theorem'),
  ('ICSE', 10, 'Mathematics', 7, 'Matrices'),
  ('ICSE', 10, 'Mathematics', 8, 'Arithmetic Progression'),
  ('ICSE', 10, 'Mathematics', 9, 'Geometric Progression'),
  ('ICSE', 10, 'Mathematics', 10, 'Coordinate Geometry'),
  ('ICSE', 10, 'Mathematics', 11, 'Similarity'),
  ('ICSE', 10, 'Mathematics', 12, 'Loci'),
  ('ICSE', 10, 'Mathematics', 13, 'Circles'),
  ('ICSE', 10, 'Mathematics', 14, 'Constructions'),
  ('ICSE', 10, 'Mathematics', 15, 'Mensuration'),
  ('ICSE', 10, 'Mathematics', 16, 'Trigonometry'),
  ('ICSE', 10, 'Mathematics', 17, 'Statistics'),
  ('ICSE', 10, 'Mathematics', 18, 'Probability'),
  ('ISC', 11, 'Mathematics', 1, 'Sets'),
  ('ISC', 11, 'Mathematics', 2, 'Relations and Functions'),
  ('ISC', 11, 'Mathematics', 3, 'Trigonometric Functions'),
  ('ISC', 11, 'Mathematics', 4, 'Mathematical Induction'),
  ('ISC', 11, 'Mathematics', 5, 'Complex Numbers and Quadratic Equations'),
  ('ISC', 11, 'Mathematics', 6, 'Linear Inequalities'),
  ('ISC', 11, 'Mathematics', 7, 'Permutations and Combinations'),
  ('ISC', 11, 'Mathematics', 8, 'Binomial Theorem'),
  ('ISC', 11, 'Mathematics', 9, 'Sequences and Series'),
  ('ISC', 11, 'Mathematics', 10, 'Straight Lines'),
  ('ISC', 11, 'Mathematics', 11, 'Conic Sections'),
  ('ISC', 11, 'Mathematics', 12, 'Introduction to Three-dimensional Geometry'),
  ('ISC', 11, 'Mathematics', 13, 'Limits and Derivatives'),
  ('ISC', 11, 'Mathematics', 14, 'Mathematical Reasoning'),
  ('ISC', 11, 'Mathematics', 15, 'Statistics'),
  ('ISC', 11, 'Mathematics', 16, 'Probability'),
  ('ISC', 12, 'Mathematics', 1, 'Relations and Functions'),
  ('ISC', 12, 'Mathematics', 2, 'Inverse Trigonometric Functions'),
  ('ISC', 12, 'Mathematics', 3, 'Matrices'),
  ('ISC', 12, 'Mathematics', 4, 'Determinants'),
  ('ISC', 12, 'Mathematics', 5, 'Continuity and Differentiability'),
  ('ISC', 12, 'Mathematics', 6, 'Applications of Derivatives'),
  ('ISC', 12, 'Mathematics', 7, 'Integrals'),
  ('ISC', 12, 'Mathematics', 8, 'Differential Equations'),
  ('ISC', 12, 'Mathematics', 9, 'Probability'),
  ('ISC', 12, 'Mathematics', 10, 'Vector Algebra'),
  ('ISC', 12, 'Mathematics', 11, 'Three-dimensional Geometry'),
  ('ISC', 12, 'Mathematics', 12, 'Applications of Integrals'),
  ('ISC', 12, 'Mathematics', 13, 'Application of Calculus in Commerce and Economics'),
  ('ISC', 12, 'Mathematics', 14, 'Linear Regression'),
  ('ISC', 12, 'Mathematics', 15, 'Linear Programming'),
  ('ISC', 12, 'Mathematics', 16, 'Conic Sections'),
-- Drafted (386): chapters the site has no papers for, from each board's syllabus and textbooks (14 October 2026), named as
-- the textbook names them, written the site's way. CHECK THESE BEFORE INSTALLING.
-- (ICSE 10 History & Civics keeps the site's 11 names and adds the syllabus chapters it lacks.)
  ('CBSE', 9, 'Science', 1, 'Matter in Our Surroundings'),
  ('CBSE', 9, 'Science', 2, 'Is Matter Around Us Pure'),
  ('CBSE', 9, 'Science', 3, 'Atoms and Molecules'),
  ('CBSE', 9, 'Science', 4, 'Structure of the Atom'),
  ('CBSE', 9, 'Science', 5, 'The Fundamental Unit of Life'),
  ('CBSE', 9, 'Science', 6, 'Tissues'),
  ('CBSE', 9, 'Science', 7, 'Motion'),
  ('CBSE', 9, 'Science', 8, 'Force and Laws of Motion'),
  ('CBSE', 9, 'Science', 9, 'Gravitation'),
  ('CBSE', 9, 'Science', 10, 'Work and Energy'),
  ('CBSE', 9, 'Science', 11, 'Sound'),
  ('CBSE', 9, 'Science', 12, 'Improvement in Food Resources'),
  ('CBSE', 9, 'History', 1, 'The French Revolution'),
  ('CBSE', 9, 'History', 2, 'Socialism in Europe and the Russian Revolution'),
  ('CBSE', 9, 'History', 3, 'Nazism and the Rise of Hitler'),
  ('CBSE', 9, 'History', 4, 'Forest Society and Colonialism'),
  ('CBSE', 9, 'History', 5, 'Pastoralists in the Modern World'),
  ('CBSE', 9, 'Geography', 1, 'India: Size and Location'),
  ('CBSE', 9, 'Geography', 2, 'Physical Features of India'),
  ('CBSE', 9, 'Geography', 3, 'Drainage'),
  ('CBSE', 9, 'Geography', 4, 'Climate'),
  ('CBSE', 9, 'Geography', 5, 'Natural Vegetation and Wildlife'),
  ('CBSE', 9, 'Geography', 6, 'Population'),
  ('CBSE', 9, 'Political Science', 1, 'What Is Democracy? Why Democracy?'),
  ('CBSE', 9, 'Political Science', 2, 'Constitutional Design'),
  ('CBSE', 9, 'Political Science', 3, 'Electoral Politics'),
  ('CBSE', 9, 'Political Science', 4, 'Working of Institutions'),
  ('CBSE', 9, 'Political Science', 5, 'Democratic Rights'),
  ('CBSE', 9, 'Economics', 1, 'The Story of Village Palampur'),
  ('CBSE', 9, 'Economics', 2, 'People as Resource'),
  ('CBSE', 9, 'Economics', 3, 'Poverty as a Challenge'),
  ('CBSE', 9, 'Economics', 4, 'Food Security in India'),
  ('CBSE', 10, 'Science', 1, 'Chemical Reactions and Equations'),
  ('CBSE', 10, 'Science', 2, 'Acids, Bases and Salts'),
  ('CBSE', 10, 'Science', 3, 'Metals and Non-metals'),
  ('CBSE', 10, 'Science', 4, 'Carbon and Its Compounds'),
  ('CBSE', 10, 'Science', 5, 'Life Processes'),
  ('CBSE', 10, 'Science', 6, 'Control and Coordination'),
  ('CBSE', 10, 'Science', 7, 'How Do Organisms Reproduce'),
  ('CBSE', 10, 'Science', 8, 'Heredity'),
  ('CBSE', 10, 'Science', 9, 'Light: Reflection and Refraction'),
  ('CBSE', 10, 'Science', 10, 'The Human Eye and the Colourful World'),
  ('CBSE', 10, 'Science', 11, 'Electricity'),
  ('CBSE', 10, 'Science', 12, 'Magnetic Effects of Electric Current'),
  ('CBSE', 10, 'Science', 13, 'Our Environment'),
  ('CBSE', 10, 'History', 1, 'The Rise of Nationalism in Europe'),
  ('CBSE', 10, 'History', 2, 'Nationalism in India'),
  ('CBSE', 10, 'History', 3, 'The Making of a Global World'),
  ('CBSE', 10, 'History', 4, 'The Age of Industrialisation'),
  ('CBSE', 10, 'History', 5, 'Print Culture and the Modern World'),
  ('CBSE', 10, 'Geography', 1, 'Resources and Development'),
  ('CBSE', 10, 'Geography', 2, 'Forest and Wildlife Resources'),
  ('CBSE', 10, 'Geography', 3, 'Water Resources'),
  ('CBSE', 10, 'Geography', 4, 'Agriculture'),
  ('CBSE', 10, 'Geography', 5, 'Minerals and Energy Resources'),
  ('CBSE', 10, 'Geography', 6, 'Manufacturing Industries'),
  ('CBSE', 10, 'Geography', 7, 'Lifelines of National Economy'),
  ('CBSE', 10, 'Political Science', 1, 'Power Sharing'),
  ('CBSE', 10, 'Political Science', 2, 'Federalism'),
  ('CBSE', 10, 'Political Science', 3, 'Gender, Religion and Caste'),
  ('CBSE', 10, 'Political Science', 4, 'Political Parties'),
  ('CBSE', 10, 'Political Science', 5, 'Outcomes of Democracy'),
  ('CBSE', 10, 'Economics', 1, 'Development'),
  ('CBSE', 10, 'Economics', 2, 'Sectors of the Indian Economy'),
  ('CBSE', 10, 'Economics', 3, 'Money and Credit'),
  ('CBSE', 10, 'Economics', 4, 'Globalisation and the Indian Economy'),
  ('CBSE', 10, 'Economics', 5, 'Consumer Rights'),
  ('CBSE', 9, 'Mathematics', 1, 'Number Systems'),
  ('CBSE', 9, 'Mathematics', 2, 'Polynomials'),
  ('CBSE', 9, 'Mathematics', 3, 'Coordinate Geometry'),
  ('CBSE', 9, 'Mathematics', 4, 'Linear Equations in Two Variables'),
  ('CBSE', 9, 'Mathematics', 5, 'Euclidean Geometry'),
  ('CBSE', 9, 'Mathematics', 6, 'Lines and Angles'),
  ('CBSE', 9, 'Mathematics', 7, 'Triangles'),
  ('CBSE', 9, 'Mathematics', 8, 'Quadrilaterals'),
  ('CBSE', 9, 'Mathematics', 9, 'Circles'),
  ('CBSE', 9, 'Mathematics', 10, 'Heron''s Formula'),
  ('CBSE', 9, 'Mathematics', 11, 'Surface Areas and Volumes'),
  ('CBSE', 9, 'Mathematics', 12, 'Statistics'),
  ('CBSE', 11, 'Mathematics', 1, 'Sets'),
  ('CBSE', 11, 'Mathematics', 2, 'Relations and Functions'),
  ('CBSE', 11, 'Mathematics', 3, 'Trigonometric Functions'),
  ('CBSE', 11, 'Mathematics', 4, 'Complex Numbers and Quadratic Equations'),
  ('CBSE', 11, 'Mathematics', 5, 'Linear Inequalities'),
  ('CBSE', 11, 'Mathematics', 6, 'Permutations and Combinations'),
  ('CBSE', 11, 'Mathematics', 7, 'Binomial Theorem'),
  ('CBSE', 11, 'Mathematics', 8, 'Sequences and Series'),
  ('CBSE', 11, 'Mathematics', 9, 'Straight Lines'),
  ('CBSE', 11, 'Mathematics', 10, 'Conic Sections'),
  ('CBSE', 11, 'Mathematics', 11, 'Introduction to Three-dimensional Geometry'),
  ('CBSE', 11, 'Mathematics', 12, 'Limits and Derivatives'),
  ('CBSE', 11, 'Mathematics', 13, 'Statistics'),
  ('CBSE', 11, 'Mathematics', 14, 'Probability'),
  ('CBSE', 11, 'Physics', 1, 'Units and Measurements'),
  ('CBSE', 11, 'Physics', 2, 'Motion in a Straight Line'),
  ('CBSE', 11, 'Physics', 3, 'Motion in a Plane'),
  ('CBSE', 11, 'Physics', 4, 'Laws of Motion'),
  ('CBSE', 11, 'Physics', 5, 'Work, Energy and Power'),
  ('CBSE', 11, 'Physics', 6, 'System of Particles and Rotational Motion'),
  ('CBSE', 11, 'Physics', 7, 'Gravitation'),
  ('CBSE', 11, 'Physics', 8, 'Mechanical Properties of Solids'),
  ('CBSE', 11, 'Physics', 9, 'Mechanical Properties of Fluids'),
  ('CBSE', 11, 'Physics', 10, 'Thermal Properties of Matter'),
  ('CBSE', 11, 'Physics', 11, 'Thermodynamics'),
  ('CBSE', 11, 'Physics', 12, 'Kinetic Theory'),
  ('CBSE', 11, 'Physics', 13, 'Oscillations'),
  ('CBSE', 11, 'Physics', 14, 'Waves'),
  ('CBSE', 12, 'Physics', 1, 'Electric Charges and Fields'),
  ('CBSE', 12, 'Physics', 2, 'Electrostatic Potential and Capacitance'),
  ('CBSE', 12, 'Physics', 3, 'Current Electricity'),
  ('CBSE', 12, 'Physics', 4, 'Moving Charges and Magnetism'),
  ('CBSE', 12, 'Physics', 5, 'Magnetism and Matter'),
  ('CBSE', 12, 'Physics', 6, 'Electromagnetic Induction'),
  ('CBSE', 12, 'Physics', 7, 'Alternating Current'),
  ('CBSE', 12, 'Physics', 8, 'Electromagnetic Waves'),
  ('CBSE', 12, 'Physics', 9, 'Ray Optics and Optical Instruments'),
  ('CBSE', 12, 'Physics', 10, 'Wave Optics'),
  ('CBSE', 12, 'Physics', 11, 'Dual Nature of Radiation and Matter'),
  ('CBSE', 12, 'Physics', 12, 'Atoms'),
  ('CBSE', 12, 'Physics', 13, 'Nuclei'),
  ('CBSE', 12, 'Physics', 14, 'Semiconductor Electronics'),
  ('CBSE', 11, 'Chemistry', 1, 'Some Basic Concepts of Chemistry'),
  ('CBSE', 11, 'Chemistry', 2, 'Structure of Atom'),
  ('CBSE', 11, 'Chemistry', 3, 'Classification of Elements and Periodicity in Properties'),
  ('CBSE', 11, 'Chemistry', 4, 'Chemical Bonding and Molecular Structure'),
  ('CBSE', 11, 'Chemistry', 5, 'Thermodynamics'),
  ('CBSE', 11, 'Chemistry', 6, 'Equilibrium'),
  ('CBSE', 11, 'Chemistry', 7, 'Redox Reactions'),
  ('CBSE', 11, 'Chemistry', 8, 'Organic Chemistry: Some Basic Principles and Techniques'),
  ('CBSE', 11, 'Chemistry', 9, 'Hydrocarbons'),
  ('CBSE', 12, 'Chemistry', 1, 'Solutions'),
  ('CBSE', 12, 'Chemistry', 2, 'Electrochemistry'),
  ('CBSE', 12, 'Chemistry', 3, 'Chemical Kinetics'),
  ('CBSE', 12, 'Chemistry', 4, 'The d- and f-Block Elements'),
  ('CBSE', 12, 'Chemistry', 5, 'Coordination Compounds'),
  ('CBSE', 12, 'Chemistry', 6, 'Haloalkanes and Haloarenes'),
  ('CBSE', 12, 'Chemistry', 7, 'Alcohols, Phenols and Ethers'),
  ('CBSE', 12, 'Chemistry', 8, 'Aldehydes, Ketones and Carboxylic Acids'),
  ('CBSE', 12, 'Chemistry', 9, 'Amines'),
  ('CBSE', 12, 'Chemistry', 10, 'Biomolecules'),
  ('CBSE', 11, 'Biology', 1, 'The Living World'),
  ('CBSE', 11, 'Biology', 2, 'Biological Classification'),
  ('CBSE', 11, 'Biology', 3, 'Plant Kingdom'),
  ('CBSE', 11, 'Biology', 4, 'Animal Kingdom'),
  ('CBSE', 11, 'Biology', 5, 'Morphology of Flowering Plants'),
  ('CBSE', 11, 'Biology', 6, 'Anatomy of Flowering Plants'),
  ('CBSE', 11, 'Biology', 7, 'Structural Organisation in Animals'),
  ('CBSE', 11, 'Biology', 8, 'Cell: The Unit of Life'),
  ('CBSE', 11, 'Biology', 9, 'Biomolecules'),
  ('CBSE', 11, 'Biology', 10, 'Cell Cycle and Cell Division'),
  ('CBSE', 11, 'Biology', 11, 'Photosynthesis in Higher Plants'),
  ('CBSE', 11, 'Biology', 12, 'Respiration in Plants'),
  ('CBSE', 11, 'Biology', 13, 'Plant Growth and Development'),
  ('CBSE', 11, 'Biology', 14, 'Breathing and Exchange of Gases'),
  ('CBSE', 11, 'Biology', 15, 'Body Fluids and Circulation'),
  ('CBSE', 11, 'Biology', 16, 'Excretory Products and Their Elimination'),
  ('CBSE', 11, 'Biology', 17, 'Locomotion and Movement'),
  ('CBSE', 11, 'Biology', 18, 'Neural Control and Coordination'),
  ('CBSE', 11, 'Biology', 19, 'Chemical Coordination and Integration'),
  ('CBSE', 12, 'Biology', 1, 'Sexual Reproduction in Flowering Plants'),
  ('CBSE', 12, 'Biology', 2, 'Human Reproduction'),
  ('CBSE', 12, 'Biology', 3, 'Reproductive Health'),
  ('CBSE', 12, 'Biology', 4, 'Principles of Inheritance and Variation'),
  ('CBSE', 12, 'Biology', 5, 'Molecular Basis of Inheritance'),
  ('CBSE', 12, 'Biology', 6, 'Evolution'),
  ('CBSE', 12, 'Biology', 7, 'Human Health and Disease'),
  ('CBSE', 12, 'Biology', 8, 'Microbes in Human Welfare'),
  ('CBSE', 12, 'Biology', 9, 'Biotechnology: Principles and Processes'),
  ('CBSE', 12, 'Biology', 10, 'Biotechnology and Its Applications'),
  ('CBSE', 12, 'Biology', 11, 'Organisms and Populations'),
  ('CBSE', 12, 'Biology', 12, 'Ecosystem'),
  ('CBSE', 12, 'Biology', 13, 'Biodiversity and Conservation'),
  ('ICSE', 9, 'Physics', 1, 'Measurements and Experimentation'),
  ('ICSE', 9, 'Physics', 2, 'Motion in One Dimension'),
  ('ICSE', 9, 'Physics', 3, 'Laws of Motion'),
  ('ICSE', 9, 'Physics', 4, 'Pressure in Fluids and Atmospheric Pressure'),
  ('ICSE', 9, 'Physics', 5, 'Upthrust in Fluids and Floatation'),
  ('ICSE', 9, 'Physics', 6, 'Heat and Energy'),
  ('ICSE', 9, 'Physics', 7, 'Reflection of Light'),
  ('ICSE', 9, 'Physics', 8, 'Sound'),
  ('ICSE', 9, 'Physics', 9, 'Current Electricity'),
  ('ICSE', 9, 'Physics', 10, 'Magnetism'),
  ('ICSE', 10, 'Physics', 1, 'Force'),
  ('ICSE', 10, 'Physics', 2, 'Work, Energy and Power'),
  ('ICSE', 10, 'Physics', 3, 'Machines'),
  ('ICSE', 10, 'Physics', 4, 'Refraction of Light at Plane Surfaces'),
  ('ICSE', 10, 'Physics', 5, 'Refraction Through a Lens'),
  ('ICSE', 10, 'Physics', 6, 'Spectrum'),
  ('ICSE', 10, 'Physics', 7, 'Sound'),
  ('ICSE', 10, 'Physics', 8, 'Current Electricity'),
  ('ICSE', 10, 'Physics', 9, 'Household Circuits'),
  ('ICSE', 10, 'Physics', 10, 'Electromagnetism'),
  ('ICSE', 10, 'Physics', 11, 'Calorimetry'),
  ('ICSE', 10, 'Physics', 12, 'Radioactivity'),
  ('ICSE', 9, 'Chemistry', 1, 'The Language of Chemistry'),
  ('ICSE', 9, 'Chemistry', 2, 'Chemical Changes and Reactions'),
  ('ICSE', 9, 'Chemistry', 3, 'Water'),
  ('ICSE', 9, 'Chemistry', 4, 'Atomic Structure and Chemical Bonding'),
  ('ICSE', 9, 'Chemistry', 5, 'The Periodic Table'),
  ('ICSE', 9, 'Chemistry', 6, 'Hydrogen'),
  ('ICSE', 9, 'Chemistry', 7, 'Gas Laws'),
  ('ICSE', 9, 'Chemistry', 8, 'Atmospheric Pollution'),
  ('ICSE', 10, 'Chemistry', 1, 'Periodic Properties and Their Variations'),
  ('ICSE', 10, 'Chemistry', 2, 'Chemical Bonding'),
  ('ICSE', 10, 'Chemistry', 3, 'Acids, Bases and Salts'),
  ('ICSE', 10, 'Chemistry', 4, 'Analytical Chemistry'),
  ('ICSE', 10, 'Chemistry', 5, 'Mole Concept and Stoichiometry'),
  ('ICSE', 10, 'Chemistry', 6, 'Electrolysis'),
  ('ICSE', 10, 'Chemistry', 7, 'Metallurgy'),
  ('ICSE', 10, 'Chemistry', 8, 'Hydrogen Chloride'),
  ('ICSE', 10, 'Chemistry', 9, 'Ammonia'),
  ('ICSE', 10, 'Chemistry', 10, 'Nitric Acid'),
  ('ICSE', 10, 'Chemistry', 11, 'Sulphuric Acid'),
  ('ICSE', 10, 'Chemistry', 12, 'Organic Chemistry'),
  ('ICSE', 9, 'Biology', 1, 'Cell: The Unit of Life'),
  ('ICSE', 9, 'Biology', 2, 'Tissues'),
  ('ICSE', 9, 'Biology', 3, 'The Flower'),
  ('ICSE', 9, 'Biology', 4, 'Pollination and Fertilisation'),
  ('ICSE', 9, 'Biology', 5, 'Seeds: Structure and Germination'),
  ('ICSE', 9, 'Biology', 6, 'Respiration in Plants'),
  ('ICSE', 9, 'Biology', 7, 'Five Kingdom Classification'),
  ('ICSE', 9, 'Biology', 8, 'Economic Importance of Bacteria and Fungi'),
  ('ICSE', 9, 'Biology', 9, 'Nutrition'),
  ('ICSE', 9, 'Biology', 10, 'Digestive System'),
  ('ICSE', 9, 'Biology', 11, 'Skeleton: Movement and Locomotion'),
  ('ICSE', 9, 'Biology', 12, 'Skin'),
  ('ICSE', 9, 'Biology', 13, 'The Respiratory System'),
  ('ICSE', 9, 'Biology', 14, 'Hygiene'),
  ('ICSE', 9, 'Biology', 15, 'Diseases: Cause and Control'),
  ('ICSE', 9, 'Biology', 16, 'Waste Generation and Management'),
  ('ICSE', 10, 'Biology', 1, 'Cell Cycle, Cell Division and Structure of Chromosomes'),
  ('ICSE', 10, 'Biology', 2, 'Genetics'),
  ('ICSE', 10, 'Biology', 3, 'Absorption by Roots'),
  ('ICSE', 10, 'Biology', 4, 'Transpiration'),
  ('ICSE', 10, 'Biology', 5, 'Photosynthesis'),
  ('ICSE', 10, 'Biology', 6, 'Chemical Coordination in Plants'),
  ('ICSE', 10, 'Biology', 7, 'The Circulatory System'),
  ('ICSE', 10, 'Biology', 8, 'The Excretory System'),
  ('ICSE', 10, 'Biology', 9, 'The Nervous System'),
  ('ICSE', 10, 'Biology', 10, 'Sense Organs'),
  ('ICSE', 10, 'Biology', 11, 'The Endocrine System'),
  ('ICSE', 10, 'Biology', 12, 'The Reproductive System'),
  ('ICSE', 10, 'Biology', 13, 'Human Population'),
  ('ICSE', 10, 'Biology', 14, 'Pollution'),
  ('ICSE', 9, 'History & Civics', 1, 'Our Constitution'),
  ('ICSE', 9, 'History & Civics', 2, 'Salient Features of the Constitution'),
  ('ICSE', 9, 'History & Civics', 3, 'Elections'),
  ('ICSE', 9, 'History & Civics', 4, 'Local Self-Government: Rural'),
  ('ICSE', 9, 'History & Civics', 5, 'Local Self-Government: Urban'),
  ('ICSE', 9, 'History & Civics', 6, 'The Harappan Civilisation'),
  ('ICSE', 9, 'History & Civics', 7, 'The Vedic Period'),
  ('ICSE', 9, 'History & Civics', 8, 'Jainism and Buddhism'),
  ('ICSE', 9, 'History & Civics', 9, 'The Mauryan Empire'),
  ('ICSE', 9, 'History & Civics', 10, 'The Sangam Age'),
  ('ICSE', 9, 'History & Civics', 11, 'The Age of the Guptas'),
  ('ICSE', 9, 'History & Civics', 12, 'The Cholas'),
  ('ICSE', 9, 'History & Civics', 13, 'The Delhi Sultanate'),
  ('ICSE', 9, 'History & Civics', 14, 'The Mughal Empire'),
  ('ICSE', 9, 'History & Civics', 15, 'Composite Culture'),
  ('ICSE', 9, 'History & Civics', 16, 'The Renaissance'),
  ('ICSE', 9, 'History & Civics', 17, 'The Reformation'),
  ('ICSE', 9, 'History & Civics', 18, 'Industrial Revolution'),
  ('ICSE', 10, 'History & Civics', 1, 'Parliament'),
  ('ICSE', 10, 'History & Civics', 2, 'President'),
  ('ICSE', 10, 'History & Civics', 3, 'Prime Minister and Council of Ministers'),
  ('ICSE', 10, 'History & Civics', 4, 'Judiciary'),
  ('ICSE', 10, 'History & Civics', 5, 'Revolt of 1857'),
  ('ICSE', 10, 'History & Civics', 6, 'Indian Nationalism'),
  ('ICSE', 10, 'History & Civics', 7, 'Muslim League'),
  ('ICSE', 10, 'History & Civics', 8, 'Mahatma Gandhi and the National Movement'),
  ('ICSE', 10, 'History & Civics', 9, 'Forward Bloc and INA'),
  ('ICSE', 10, 'History & Civics', 10, 'Indian Independence'),
  ('ICSE', 10, 'History & Civics', 11, 'World War I'),
  ('ICSE', 10, 'History & Civics', 12, 'Rise of Fascism'),
  ('ICSE', 10, 'History & Civics', 13, 'Rise of Nazism'),
  ('ICSE', 10, 'History & Civics', 14, 'World War II'),
  ('ICSE', 10, 'History & Civics', 15, 'United Nations'),
  ('ICSE', 10, 'History & Civics', 16, 'UN Agencies'),
  ('ICSE', 10, 'History & Civics', 17, 'Post-WWII World'),
  ('ICSE', 9, 'Geography', 1, 'Earth as a Planet'),
  ('ICSE', 9, 'Geography', 2, 'Geographic Grid: Latitudes and Longitudes'),
  ('ICSE', 9, 'Geography', 3, 'Rotation and Revolution'),
  ('ICSE', 9, 'Geography', 4, 'Earth''s Structure'),
  ('ICSE', 9, 'Geography', 5, 'Landforms of the Earth'),
  ('ICSE', 9, 'Geography', 6, 'Rocks'),
  ('ICSE', 9, 'Geography', 7, 'Volcanoes'),
  ('ICSE', 9, 'Geography', 8, 'Earthquakes'),
  ('ICSE', 9, 'Geography', 9, 'Weathering'),
  ('ICSE', 9, 'Geography', 10, 'Denudation'),
  ('ICSE', 9, 'Geography', 11, 'Hydrosphere'),
  ('ICSE', 9, 'Geography', 12, 'Composition and Structure of the Atmosphere'),
  ('ICSE', 9, 'Geography', 13, 'Insolation'),
  ('ICSE', 9, 'Geography', 14, 'Atmospheric Pressure and Winds'),
  ('ICSE', 9, 'Geography', 15, 'Humidity'),
  ('ICSE', 9, 'Geography', 16, 'Pollution'),
  ('ICSE', 9, 'Geography', 17, 'Natural Regions of the World'),
  ('ICSE', 10, 'Geography', 1, 'Interpretation of Topographical Maps'),
  ('ICSE', 10, 'Geography', 2, 'Location, Extent and Physical Features'),
  ('ICSE', 10, 'Geography', 3, 'Climate'),
  ('ICSE', 10, 'Geography', 4, 'Soil Resources'),
  ('ICSE', 10, 'Geography', 5, 'Natural Vegetation'),
  ('ICSE', 10, 'Geography', 6, 'Water Resources'),
  ('ICSE', 10, 'Geography', 7, 'Mineral and Energy Resources'),
  ('ICSE', 10, 'Geography', 8, 'Agriculture'),
  ('ICSE', 10, 'Geography', 9, 'Manufacturing Industries'),
  ('ICSE', 10, 'Geography', 10, 'Transport'),
  ('ICSE', 10, 'Geography', 11, 'Waste Management'),
  ('ISC', 11, 'Physics', 1, 'Units and Measurements'),
  ('ISC', 11, 'Physics', 2, 'Motion in a Straight Line'),
  ('ISC', 11, 'Physics', 3, 'Motion in a Plane'),
  ('ISC', 11, 'Physics', 4, 'Laws of Motion'),
  ('ISC', 11, 'Physics', 5, 'Work, Energy and Power'),
  ('ISC', 11, 'Physics', 6, 'System of Particles and Rotational Motion'),
  ('ISC', 11, 'Physics', 7, 'Gravitation'),
  ('ISC', 11, 'Physics', 8, 'Mechanical Properties of Solids'),
  ('ISC', 11, 'Physics', 9, 'Mechanical Properties of Fluids'),
  ('ISC', 11, 'Physics', 10, 'Thermal Properties of Matter'),
  ('ISC', 11, 'Physics', 11, 'Thermodynamics'),
  ('ISC', 11, 'Physics', 12, 'Kinetic Theory'),
  ('ISC', 11, 'Physics', 13, 'Oscillations'),
  ('ISC', 11, 'Physics', 14, 'Waves'),
  ('ISC', 12, 'Physics', 1, 'Electric Charges and Fields'),
  ('ISC', 12, 'Physics', 2, 'Electrostatic Potential and Capacitance'),
  ('ISC', 12, 'Physics', 3, 'Current Electricity'),
  ('ISC', 12, 'Physics', 4, 'Moving Charges and Magnetism'),
  ('ISC', 12, 'Physics', 5, 'Magnetism and Matter'),
  ('ISC', 12, 'Physics', 6, 'Electromagnetic Induction'),
  ('ISC', 12, 'Physics', 7, 'Alternating Current'),
  ('ISC', 12, 'Physics', 8, 'Electromagnetic Waves'),
  ('ISC', 12, 'Physics', 9, 'Ray Optics and Optical Instruments'),
  ('ISC', 12, 'Physics', 10, 'Wave Optics'),
  ('ISC', 12, 'Physics', 11, 'Dual Nature of Radiation and Matter'),
  ('ISC', 12, 'Physics', 12, 'Atoms'),
  ('ISC', 12, 'Physics', 13, 'Nuclei'),
  ('ISC', 12, 'Physics', 14, 'Semiconductor Electronics'),
  ('ISC', 11, 'Chemistry', 1, 'Some Basic Concepts of Chemistry'),
  ('ISC', 11, 'Chemistry', 2, 'Structure of Atom'),
  ('ISC', 11, 'Chemistry', 3, 'Classification of Elements and Periodicity in Properties'),
  ('ISC', 11, 'Chemistry', 4, 'Chemical Bonding and Molecular Structure'),
  ('ISC', 11, 'Chemistry', 5, 'Thermodynamics'),
  ('ISC', 11, 'Chemistry', 6, 'Equilibrium'),
  ('ISC', 11, 'Chemistry', 7, 'Redox Reactions'),
  ('ISC', 11, 'Chemistry', 8, 'Organic Chemistry: Some Basic Principles and Techniques'),
  ('ISC', 11, 'Chemistry', 9, 'Hydrocarbons'),
  ('ISC', 12, 'Chemistry', 1, 'Solutions'),
  ('ISC', 12, 'Chemistry', 2, 'Electrochemistry'),
  ('ISC', 12, 'Chemistry', 3, 'Chemical Kinetics'),
  ('ISC', 12, 'Chemistry', 4, 'The d- and f-Block Elements'),
  ('ISC', 12, 'Chemistry', 5, 'Coordination Compounds'),
  ('ISC', 12, 'Chemistry', 6, 'Haloalkanes and Haloarenes'),
  ('ISC', 12, 'Chemistry', 7, 'Alcohols, Phenols and Ethers'),
  ('ISC', 12, 'Chemistry', 8, 'Aldehydes, Ketones and Carboxylic Acids'),
  ('ISC', 12, 'Chemistry', 9, 'Amines'),
  ('ISC', 12, 'Chemistry', 10, 'Biomolecules'),
  ('ISC', 11, 'Biology', 1, 'The Living World'),
  ('ISC', 11, 'Biology', 2, 'Biological Classification'),
  ('ISC', 11, 'Biology', 3, 'Plant Kingdom'),
  ('ISC', 11, 'Biology', 4, 'Animal Kingdom'),
  ('ISC', 11, 'Biology', 5, 'Morphology of Flowering Plants'),
  ('ISC', 11, 'Biology', 6, 'Anatomy of Flowering Plants'),
  ('ISC', 11, 'Biology', 7, 'Structural Organisation in Animals'),
  ('ISC', 11, 'Biology', 8, 'Cell: The Unit of Life'),
  ('ISC', 11, 'Biology', 9, 'Biomolecules'),
  ('ISC', 11, 'Biology', 10, 'Cell Cycle and Cell Division'),
  ('ISC', 11, 'Biology', 11, 'Photosynthesis in Higher Plants'),
  ('ISC', 11, 'Biology', 12, 'Respiration in Plants'),
  ('ISC', 11, 'Biology', 13, 'Plant Growth and Development'),
  ('ISC', 11, 'Biology', 14, 'Breathing and Exchange of Gases'),
  ('ISC', 11, 'Biology', 15, 'Body Fluids and Circulation'),
  ('ISC', 11, 'Biology', 16, 'Excretory Products and Their Elimination'),
  ('ISC', 11, 'Biology', 17, 'Locomotion and Movement'),
  ('ISC', 11, 'Biology', 18, 'Neural Control and Coordination'),
  ('ISC', 11, 'Biology', 19, 'Chemical Coordination and Integration'),
  ('ISC', 12, 'Biology', 1, 'Sexual Reproduction in Flowering Plants'),
  ('ISC', 12, 'Biology', 2, 'Human Reproduction'),
  ('ISC', 12, 'Biology', 3, 'Reproductive Health'),
  ('ISC', 12, 'Biology', 4, 'Principles of Inheritance and Variation'),
  ('ISC', 12, 'Biology', 5, 'Molecular Basis of Inheritance'),
  ('ISC', 12, 'Biology', 6, 'Evolution'),
  ('ISC', 12, 'Biology', 7, 'Human Health and Disease'),
  ('ISC', 12, 'Biology', 8, 'Microbes in Human Welfare'),
  ('ISC', 12, 'Biology', 9, 'Biotechnology: Principles and Processes'),
  ('ISC', 12, 'Biology', 10, 'Biotechnology and Its Applications'),
  ('ISC', 12, 'Biology', 11, 'Organisms and Populations'),
  ('ISC', 12, 'Biology', 12, 'Ecosystem'),
  ('ISC', 12, 'Biology', 13, 'Biodiversity and Conservation');

do $$
declare
  listed int := (select count(*) from games_install_list);
  r jsonb := games.list_add_chapters((select jsonb_agg(to_jsonb(l)) from games_install_list l));
begin
  if (r ->> 'chapters')::int <> listed then
    raise exception 'Stopped: the starting list has % rows but % different chapters, so a chapter is on it twice. Nothing was kept.', listed, r ->> 'chapters';
  end if;
  insert into games.list_log (action, detail) values ('add', format('The starting list: added %s chapters.', listed));
end $$;

-- ---------------------------------------------------------------- checks

-- Nothing outside `games` changed.
do $$
declare
  diff text;
begin
  select string_agg(format('%s %s', d.kind, d.name), '; ') into diff from (
    (select * from games_install_before except select * from pg_temp.games_outside())
    union
    (select * from pg_temp.games_outside() except select * from games_install_before)
  ) d;
  if diff is not null then
    raise exception 'Stopped: this would change something outside the games schema (%). Nothing was kept.', diff;
  end if;
end $$;

-- Signed-out visitors can't call anything here; signed-in people can call only the site's functions.
do $$
declare
  bad text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into bad from pg_proc p
  where p.pronamespace = 'games'::regnamespace and has_function_privilege('anon', p.oid, 'EXECUTE');
  if bad is not null then raise exception 'Stopped: signed-out visitors could call %. Nothing was kept.', bad; end if;
  select string_agg(p.oid::regprocedure::text, ', ') into bad from pg_proc p
  where p.pronamespace = 'games'::regnamespace and has_function_privilege('authenticated', p.oid, 'EXECUTE')
    and p.proname not in ('my_role', 'catalog', 'submit_batch', 'my_sent_back', 'mark_sent_back_seen', 'bank', 'bank_count',
                          'waiting_count', 'hod_questions', 'hod_approved', 'hod_set_status', 'admin_people', 'admin_set_role', 'admin_remove',
                          'admin_list', 'admin_save_chapters', 'admin_topic_questions');
  if bad is not null then raise exception 'Stopped: signed-in people could call %. Nothing was kept.', bad; end if;
  select string_agg(c.oid::regclass::text, ', ') into bad from pg_class c
  where c.relnamespace = 'games'::regnamespace and c.relkind = 'r'
    and (has_table_privilege('anon', c.oid, 'SELECT') or has_table_privilege('authenticated', c.oid, 'SELECT')
         or has_table_privilege('authenticated', c.oid, 'INSERT') or has_table_privilege('authenticated', c.oid, 'UPDATE')
         or has_table_privilege('authenticated', c.oid, 'DELETE') or not c.relrowsecurity);
  if bad is not null then raise exception 'Stopped: the tables % could be read or written directly. Nothing was kept.', bad; end if;
end $$;

-- The dry run ends here, with everything undone.
do $$
begin
  if current_setting('games_install.dry_run') is distinct from 'no' then
    raise exception 'Dry run passed: everything worked (with % chapters on the list), and nothing outside the games schema would change. Nothing was kept. To install it, change ''yes'' to ''no'' on the DRY RUN line near the top and run the whole file again.',
      (select count(*) from games.chapters);
  end if;
end $$;

commit;
