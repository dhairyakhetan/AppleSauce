-- =====================================================================================================================
-- Shikshaq's games team: the `games` schema.
--
-- What it is: the tables and functions behind /games (Write questions, Approve questions, Try the games, Team). All of
-- it goes in one new schema, `games`. It reads nothing in Shikshaq's own tables and changes nothing outside `games`.
--
-- How to run it (Supabase dashboard, SQL editor). Read CHANGES.md first: take a backup before step 3.
--   1. The MODERATOR line below has the moderator's Google email (the games team's first admin; nobody can remove or
--      demote them).
--   2. Run the whole file as it is. It is a dry run: it does everything, checks it, then undoes it, and ends with
--      "Dry run passed". Nothing is kept.
--   3. Change 'yes' to 'no' on the DRY RUN line, and run the whole file again. This time it is kept.
--   4. Settings, then Data API (API settings): add `games` to the exposed schemas, and save.
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
--   admin   also manages the team (admin_people, admin_set_role, admin_remove) and the list of chapters (admin_list,
--           admin_add_chapters, admin_add_topic, admin_rename, admin_renumber, admin_delete_from_list,
--           admin_set_topics_fixed), on the site's Chapters page
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
-- The fixed list of chapters (games.chapters) is empty here: an admin adds it on the site's Chapters page (/games/chapters),
-- which has the starting list ready to paste. A question can only be sent for a chapter on it. Its topics (games.topics)
-- are fixed where the list gives the chapter topics; where it gives none, they are written with the questions, and the
-- first question sent under a new topic adds it to the chapter.
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

-- Admins keep the list on the site: add chapters (one, or many pasted), rename a chapter or topic (its questions take
-- the new name), change a number or delete only while nothing has been sent for it (the number is part of every
-- question ID), and open or fix a chapter's topics. Every change is noted here.
create table games.list_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  by_email text not null,
  action text not null check (action in ('add', 'rename', 'renumber', 'delete', 'topics')),
  detail text not null check (char_length(detail) between 1 and 500)
);
comment on table games.list_log is 'Every change an admin made to the list of chapters and topics, newest last.';

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
      select jsonb_agg(jsonb_build_object('at', l.at, 'by', coalesce(nullif(btrim(m.name), ''), l.by_email), 'action', l.action, 'detail', l.detail) order by l.id desc)
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
create function games.admin_add_chapters(chapters jsonb) returns jsonb language plpgsql security definer set search_path = ''
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
  perform games.list_check_admin();
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
  if added + topics > 0 then perform games.list_note('add', format('Added %s chapters and %s topics.', added, topics)); end if;
  return jsonb_build_object('chapters', added, 'topics', topics, 'already', already);
end $$;

-- One topic for a chapter: the list's if the chapter's topics are fixed, otherwise one more in use.
create function games.admin_add_topic(chapter text, topic_no int, name text) returns void language plpgsql security definer set search_path = ''
as $$
declare
  ch games.chapters%rowtype;
begin
  perform games.list_check_admin();
  select * into ch from games.chapters c where c.chapter_id = chapter;
  if not found then raise exception 'That chapter isn''t on the list.'; end if;
  if not games.list_add_topic(ch, topic_no, name, exists (select 1 from games.topics t where t.chapter_id = ch.chapter_id and t.from_list)) then
    raise exception 'Topic % of % is already "%".', topic_no, games.list_label(ch), btrim(name);
  end if;
  perform games.list_note('add', format('%s: added topic %s "%s".', games.list_label(ch), topic_no, btrim(name)));
end $$;

-- Renames a chapter (topic_no null) or one of its topics. Its questions, waiting, approved or sent back, take the new
-- name too; their IDs don't change.
create function games.admin_rename(chapter text, topic_no int, name text) returns void language plpgsql security definer set search_path = ''
as $$
declare
  ch games.chapters%rowtype;
  t games.topics%rowtype;
  nm text := btrim(coalesce(name, ''));
  tno int := topic_no;
begin
  perform games.list_check_admin();
  select * into ch from games.chapters c where c.chapter_id = chapter;
  if not found then raise exception 'That chapter isn''t on the list.'; end if;
  if char_length(nm) not between 1 and 120 then raise exception 'A name must be 1 to 120 characters.'; end if;
  if tno is null then
    if exists (select 1 from games.chapters c where c.board = ch.board and c.class = ch.class and c.subject = ch.subject
               and c.chapter_id <> ch.chapter_id and games.norm(c.name) = games.norm(nm)) then
      raise exception '% class % % already has a chapter called "%".', ch.board, ch.class, ch.subject, nm;
    end if;
    update games.chapters c set name = nm where c.chapter_id = ch.chapter_id;
    update games.questions q set chapter = nm where q.chapter_id = ch.chapter_id;
    update games.question_bank q set chapter = nm where q.chapter_id = ch.chapter_id;
    perform games.list_note('rename', format('%s: "%s" renamed "%s".', games.list_label(ch), ch.name, nm));
  else
    select * into t from games.topics x where x.chapter_id = ch.chapter_id and x.topic_no = tno;
    if not found then raise exception '% has no topic %.', games.list_label(ch), tno; end if;
    if exists (select 1 from games.topics x where x.chapter_id = ch.chapter_id and x.topic_no <> tno and games.norm(x.name) = games.norm(nm)) then
      raise exception '% already has a topic called "%".', games.list_label(ch), nm;
    end if;
    update games.topics x set name = nm where x.topic_id = t.topic_id;
    update games.questions q set topic = nm where q.chapter_id = ch.chapter_id and q.topic_no = tno;
    update games.question_bank q set topic = nm where q.chapter_id = ch.chapter_id and q.topic_no = tno;
    perform games.list_note('rename', format('%s topic %s: "%s" renamed "%s".', games.list_label(ch), tno, t.name, nm));
  end if;
end $$;

-- Gives a chapter (topic_no null) or a topic another number, while nothing has been sent for it.
create function games.admin_renumber(chapter text, topic_no int, new_no int) returns void language plpgsql security definer set search_path = ''
as $$
declare
  ch games.chapters%rowtype;
  t games.topics%rowtype;
  tno int := topic_no;
  n int;
  nid text;
begin
  perform games.list_check_admin();
  select * into ch from games.chapters c where c.chapter_id = chapter;
  if not found then raise exception 'That chapter isn''t on the list.'; end if;
  if new_no is null or new_no not between 1 and 99 then raise exception 'A number must be from 1 to 99.'; end if;
  if tno is null then
    select count(*) into n from games.questions q where q.chapter_id = ch.chapter_id;
    if n > 0 then raise exception '% has %, so its number stays: it is part of each question''s ID.', games.list_label(ch), n || case when n = 1 then ' question' else ' questions' end; end if;
    if new_no = ch.chapter_no then return; end if;
    if exists (select 1 from games.chapters c where c.board = ch.board and c.class = ch.class and c.subject = ch.subject and c.chapter_no = new_no) then
      raise exception '% class % % already has a chapter %.', ch.board, ch.class, ch.subject, new_no;
    end if;
    nid := left(ch.chapter_id, char_length(ch.chapter_id) - 2) || lpad(new_no::text, 2, '0');
    insert into games.chapters (chapter_id, board, class, subject, chapter_no, name) values (nid, ch.board, ch.class, ch.subject, new_no, ch.name);
    insert into games.topics (topic_id, chapter_id, topic_no, name, from_list)
    select nid || 'T' || lpad(x.topic_no::text, 2, '0'), nid, x.topic_no, x.name, x.from_list from games.topics x where x.chapter_id = ch.chapter_id;
    delete from games.chapters c where c.chapter_id = ch.chapter_id;
    perform games.list_note('renumber', format('%s "%s" is now chapter %s.', games.list_label(ch), ch.name, new_no));
  else
    select * into t from games.topics x where x.chapter_id = ch.chapter_id and x.topic_no = tno;
    if not found then raise exception '% has no topic %.', games.list_label(ch), tno; end if;
    select count(*) into n from games.questions q where q.chapter_id = ch.chapter_id and q.topic_no = tno;
    if n > 0 then raise exception 'Topic % of % has %, so its number stays: it is part of each question''s ID.', tno, games.list_label(ch), n || case when n = 1 then ' question' else ' questions' end; end if;
    if new_no = tno then return; end if;
    if exists (select 1 from games.topics x where x.chapter_id = ch.chapter_id and x.topic_no = new_no) then
      raise exception '% already has a topic %.', games.list_label(ch), new_no;
    end if;
    update games.topics x set topic_no = new_no, topic_id = ch.chapter_id || 'T' || lpad(new_no::text, 2, '0') where x.topic_id = t.topic_id;
    perform games.list_note('renumber', format('%s topic %s "%s" is now topic %s.', games.list_label(ch), tno, t.name, new_no));
  end if;
end $$;

-- Deletes a chapter (with its topics; topic_no null) or a topic, while nothing has been sent for it.
create function games.admin_delete_from_list(chapter text, topic_no int) returns void language plpgsql security definer set search_path = ''
as $$
declare
  ch games.chapters%rowtype;
  t games.topics%rowtype;
  tno int := topic_no;
  n int;
begin
  perform games.list_check_admin();
  select * into ch from games.chapters c where c.chapter_id = chapter;
  if not found then raise exception 'That chapter isn''t on the list.'; end if;
  if tno is null then
    select count(*) into n from games.questions q where q.chapter_id = ch.chapter_id;
    if n > 0 then raise exception '% has %, so it can''t be deleted. Rename it instead.', games.list_label(ch), n || case when n = 1 then ' question' else ' questions' end; end if;
    delete from games.chapters c where c.chapter_id = ch.chapter_id;
    perform games.list_note('delete', format('%s "%s" deleted.', games.list_label(ch), ch.name));
  else
    select * into t from games.topics x where x.chapter_id = ch.chapter_id and x.topic_no = tno;
    if not found then raise exception '% has no topic %.', games.list_label(ch), tno; end if;
    select count(*) into n from games.questions q where q.chapter_id = ch.chapter_id and q.topic_no = tno;
    if n > 0 then raise exception 'Topic % of % has %, so it can''t be deleted. Rename it instead.', tno, games.list_label(ch), n || case when n = 1 then ' question' else ' questions' end; end if;
    delete from games.topics x where x.topic_id = t.topic_id;
    perform games.list_note('delete', format('%s topic %s "%s" deleted.', games.list_label(ch), tno, t.name));
  end if;
end $$;

-- Fixes a chapter's topics (questions then go only under them) or opens them (writers may add their own).
create function games.admin_set_topics_fixed(chapter text, fixed boolean) returns void language plpgsql security definer set search_path = ''
as $$
declare
  ch games.chapters%rowtype;
begin
  perform games.list_check_admin();
  select * into ch from games.chapters c where c.chapter_id = chapter;
  if not found then raise exception 'That chapter isn''t on the list.'; end if;
  if fixed is null then raise exception 'Say whether the topics are fixed.'; end if;
  if fixed and not exists (select 1 from games.topics t where t.chapter_id = ch.chapter_id) then
    raise exception '% has no topics yet: add them first, then fix them.', games.list_label(ch);
  end if;
  update games.topics t set from_list = fixed where t.chapter_id = ch.chapter_id;
  perform games.list_note('topics', format('%s: topics %s.', games.list_label(ch), case when fixed then 'fixed' else 'opened' end));
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
  games.admin_list(), games.admin_add_chapters(jsonb), games.admin_add_topic(text, int, text), games.admin_rename(text, int, text),
  games.admin_renumber(text, int, int), games.admin_delete_from_list(text, int), games.admin_set_topics_fixed(text, boolean) to authenticated;

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
                          'admin_list', 'admin_add_chapters', 'admin_add_topic', 'admin_rename', 'admin_renumber', 'admin_delete_from_list',
                          'admin_set_topics_fixed');
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
    raise exception 'Dry run passed: everything worked, and nothing outside the games schema would change. Nothing was kept. To install it, change ''yes'' to ''no'' on the DRY RUN line near the top and run the whole file again.';
  end if;
end $$;

commit;
