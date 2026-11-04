-- =====================================================================================================================
-- Shikshaq's games team, upgrade 1 (November 2026): the team's log, and Approve questions a page at a time.
--
-- What it adds, all new, all in the `games` schema. Nothing that exists is changed:
--   games.team_log            every change to the team: someone added, a role changed, someone taken off, with who did it
--                             and when. It starts with everyone on the team now, as the team list says they were added.
--   games.admin_team_set      add someone or change their role (all of admin_set_role's checks), and note it in the log
--   games.admin_team_remove   take someone off (all of admin_remove's checks), and note it in the log
--   games.admin_team_log      the log, newest first, 20 at a time (admins)
--   games.hod_counts          how many questions are waiting, approved and sent back (HoDs and admins)
--   games.hod_waiting         the waiting questions, a few batches at a time, newest batch first (HoDs and admins)
--   games.hod_sent_back       the sent-back questions, 20 at a time, newest first (HoDs and admins)
--
-- The site from this version on calls these in place of admin_set_role, admin_remove and hod_questions. Those stay as
-- they are, so the site already deployed keeps working until the new one is: run this first, then deploy.
--
-- How to run it (Supabase dashboard, SQL editor). Only after supabase/games/install.sql. Take a backup first.
--   1. Run the whole file as it is. It is a dry run: it does everything, checks it, then undoes it, and ends with
--      "Dry run passed". Nothing is kept.
--   2. Change 'yes' to 'no' on the DRY RUN line, and run the whole file again. This time it is kept.
--   3. Deploy the site.
--   To remove only what this adds (the site would then need the version before it):
--     drop function games.admin_team_set(text, text), games.admin_team_remove(text), games.admin_team_log(bigint, int),
--       games.hod_counts(), games.hod_waiting(timestamptz, text, int), games.hod_sent_back(timestamptz, text, int);
--     drop table games.team_log;
--
-- Safe by construction:
--   * One transaction: all of it happens, or none of it.
--   * It stops at once if the games schema isn't there, and at its first `create` if it was run before.
--   * At the end it compares everything that existed before it ran, inside `games` and outside (schemas, tables,
--     columns with their types and permissions, functions with their code, owner and permissions, triggers, policies,
--     constraints, default permissions, extensions, event triggers, roles), with how it was at the start. If anything
--     differs, or anything new is not what this adds, it stops and nothing is kept.
--   * Signed-out visitors can call nothing in `games`; signed-in people only the site's functions, each of which checks
--     the team list itself. Nobody reads or writes the new table directly.
-- =====================================================================================================================

begin;

-- DRY RUN: 'yes' does everything and then undoes it. Change it to 'no' to keep it.
select set_config('games_upgrade.dry_run', 'yes', true);

do $$
begin
  if to_regnamespace('games') is null then
    raise exception 'The games schema isn''t installed. Run supabase/games/install.sql first. Nothing was changed.';
  end if;
end $$;

-- ---------------------------------------------------------------- everything that exists, before

-- (a temporary function, gone when the session ends; replaced if a run before left one in this session)
create or replace function pg_temp.games_everything() returns table (kind text, name text, detail text) language sql stable as $$
  select 'schema', n.nspname::text, coalesce(array_to_string(n.nspacl, ' '), '')
  from pg_namespace n where n.nspname !~ '^pg_(toast_)?temp_'
  union all
  select 'relation', n.nspname || '.' || c.relname,
         c.relkind::text || ' ' || coalesce(array_to_string(c.relacl, ' '), '') || ' rls=' || c.relrowsecurity || '/' || c.relforcerowsecurity
         || ' triggers=' || c.relhastriggers || ' owner=' || c.relowner::regrole
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname <> 'pg_toast' and n.nspname !~ '^pg_(toast_)?temp_'
  union all
  select 'column', n.nspname || '.' || c.relname || '.' || a.attname,
         format_type(a.atttypid, a.atttypmod) || ' notnull=' || a.attnotnull || ' ' || coalesce(array_to_string(a.attacl, ' '), '')
  from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
  where a.attnum > 0 and not a.attisdropped and n.nspname <> 'pg_toast' and n.nspname !~ '^pg_(toast_)?temp_'
  union all
  select 'function', n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
         md5(coalesce(p.prosrc, '')) || ' ' || coalesce(array_to_string(p.proacl, ' '), '') || ' definer=' || p.prosecdef
         || ' owner=' || p.proowner::regrole || ' config=' || coalesce(array_to_string(p.proconfig, ' '), '')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname !~ '^pg_(toast_)?temp_'
  union all
  select 'trigger', n.nspname || '.' || c.relname || '.' || t.tgname, t.tgenabled::text || ' ' || t.tgfoid::regproc::text
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
  union all
  select 'policy', n.nspname || '.' || c.relname || '.' || p.polname,
         p.polcmd::text || ' ' || coalesce(pg_get_expr(p.polqual, p.polrelid), '') || ' ' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')
  from pg_policy p join pg_class c on c.oid = p.polrelid join pg_namespace n on n.oid = c.relnamespace
  union all
  select 'constraint', case when c.conrelid = 0 then n.nspname else n.nspname || '.' || (select r.relname from pg_class r where r.oid = c.conrelid) end || '.' || c.conname,
         pg_get_constraintdef(c.oid)
  from pg_constraint c join pg_namespace n on n.oid = c.connamespace
  where n.nspname !~ '^pg_(toast_)?temp_'
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
create temporary table games_upgrade_before on commit drop as select * from pg_temp.games_everything();

-- ---------------------------------------------------------------- the team's log

-- If this was run before, the script stops here, and nothing changes.
create table games.team_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  by_email text,                -- who made the change; null for someone already on the team when the log began
  action text not null check (action in ('add', 'role', 'remove')),
  person text not null check (char_length(person) between 3 and 320),
  role text not null check (role in ('admin', 'hod', 'member')),          -- the role given (add, role) or held (remove)
  old_role text check (old_role in ('admin', 'hod', 'member')),           -- the role before (role only)
  before_log boolean not null default false,                              -- on the team when the log began
  constraint old_role_for_a_change check ((action = 'role') = (old_role is not null))
);
comment on table games.team_log is 'Every change to the games team, newest last: someone added (add), a role changed (role), someone taken off (remove), by whom and when. It starts with the team as it was when the log began (before_log).';
alter table games.team_log enable row level security;
revoke all on games.team_log from public, anon, authenticated;

-- everyone on the team now, as the team list says they were added (with the role they have now)
insert into games.team_log (at, by_email, action, person, role, before_log)
select t.added_at, t.added_by, 'add', t.email, t.role, true from games.team t order by t.added_at, t.email;

-- An admin adds someone, or changes their role: every check is admin_set_role's own, then the change is noted.
create function games.admin_team_set(person text, new_role text) returns void language plpgsql security definer set search_path = ''
as $$
declare
  mail text := lower(btrim(coalesce(person, '')));
  was text;
begin
  perform pg_advisory_xact_lock(hashtext('games.team'));
  select t.role into was from games.team t where t.email = mail;
  perform games.admin_set_role(person, new_role);
  if was is null then
    insert into games.team_log (by_email, action, person, role) values (games.proven_email(), 'add', mail, new_role);
  elsif was <> new_role then
    insert into games.team_log (by_email, action, person, role, old_role) values (games.proven_email(), 'role', mail, new_role, was);
  end if;
end $$;

-- An admin takes someone off the team: every check is admin_remove's own, then the change is noted.
create function games.admin_team_remove(person text) returns void language plpgsql security definer set search_path = ''
as $$
declare
  mail text := lower(btrim(coalesce(person, '')));
  was text;
begin
  perform pg_advisory_xact_lock(hashtext('games.team'));
  select t.role into was from games.team t where t.email = mail;
  perform games.admin_remove(person);
  if was is not null then
    insert into games.team_log (by_email, action, person, role) values (games.proven_email(), 'remove', mail, was);
  end if;
end $$;

-- The log for admins, newest first, a page at a time: the entries before `before_id`. Names are the team's names for
-- the people, when they are still on it.
create function games.admin_team_log(before_id bigint default null, take int default 20) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if games.team_role() is distinct from 'admin' then raise exception 'Only a games admin can see the team''s log.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'id', l.id, 'at', l.at, 'by', coalesce(nullif(btrim(b.name), ''), l.by_email), 'action', l.action, 'person', l.person,
        'name', nullif(btrim(p.name), ''), 'role', l.role, 'old_role', l.old_role, 'before_log', l.before_log)
      order by l.id desc)
    from (select * from games.team_log x where x.id < coalesce(before_id, 9223372036854775807) order by x.id desc
          limit least(greatest(coalesce(take, 20), 1), 100)) l
    left join games.team b on b.email = l.by_email
    left join games.team p on p.email = l.person
  ), '[]');
end $$;

-- ---------------------------------------------------------------- Approve questions, a page at a time

-- The numbers on Approve questions' tabs. HoDs and admins.
create function games.hod_counts() returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if not games.is_hod() then raise exception 'Only HoDs and admins can approve questions.'; end if;
  return jsonb_build_object(
    'waiting', (select count(*) from games.questions where status = 'pending'),
    'approved', (select count(*) from games.question_bank),
    'sent_back', (select count(*) from games.questions where status = 'rejected'));
end $$;

-- The waiting questions, a few batches at a time, newest batch first: the batches sent before (before_at, before_batch)
-- that still have a question waiting, with those questions, who sent them and when. HoDs and admins.
create function games.hod_waiting(before_at timestamptz default null, before_batch text default null, take int default 3) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not games.is_hod() then raise exception 'Only HoDs and admins can approve questions.'; end if;
  return (
    select coalesce(jsonb_agg(to_jsonb(q) || jsonb_build_object('teacher', b.teacher, 'teacher_email', b.teacher_email, 'sent_at', b.sent_at)
                              order by b.sent_at desc, b.batch_id desc, q.question_id), '[]')
    from (
      select x.* from games.batches x
      where (x.sent_at, x.batch_id) < (coalesce(before_at, 'infinity'), coalesce(before_batch, ''))
        and exists (select 1 from games.questions y where y.batch_id = x.batch_id and y.status = 'pending')
      order by x.sent_at desc, x.batch_id desc
      limit least(greatest(coalesce(take, 3), 1), 50)
    ) b join games.questions q on q.batch_id = b.batch_id and q.status = 'pending'
  );
end $$;

-- The sent-back questions, newest first, a page at a time: the page after (before_at, before_id). HoDs and admins.
create function games.hod_sent_back(before_at timestamptz default null, before_id text default null, take int default 20) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not games.is_hod() then raise exception 'Only HoDs and admins can approve questions.'; end if;
  return (
    select coalesce(jsonb_agg(to_jsonb(q) || jsonb_build_object('teacher', b.teacher, 'teacher_email', b.teacher_email, 'sent_at', b.sent_at)
                              order by q.reviewed_at desc, q.question_id desc), '[]')
    from (
      select * from games.questions x
      where x.status = 'rejected' and (x.reviewed_at, x.question_id) < (coalesce(before_at, 'infinity'), coalesce(before_id, ''))
      order by x.reviewed_at desc, x.question_id desc
      limit least(greatest(coalesce(take, 20), 1), 100)
    ) q join games.batches b on b.batch_id = q.batch_id
  );
end $$;

-- ---------------------------------------------------------------- who can call them

-- Taken away from everyone first (Postgres' own rule, and Supabase's default permissions, would let anyone call a new
-- function), then given to signed-in people only. Each checks the team list itself.
revoke execute on function games.admin_team_set(text, text), games.admin_team_remove(text), games.admin_team_log(bigint, int),
  games.hod_counts(), games.hod_waiting(timestamptz, text, int), games.hod_sent_back(timestamptz, text, int) from public, anon, authenticated;
grant execute on function games.admin_team_set(text, text), games.admin_team_remove(text), games.admin_team_log(bigint, int),
  games.hod_counts(), games.hod_waiting(timestamptz, text, int), games.hod_sent_back(timestamptz, text, int) to authenticated;

-- ---------------------------------------------------------------- checks

-- Nothing that existed changed, and everything new is what this adds: the log table (with its columns, keys and
-- constraints) and the six functions. A new column on a table that exists, or anything else, stops it.
do $$
declare
  diff text;
begin
  select string_agg(format('%s %s', d.kind, d.name), '; ') into diff from (
    select * from games_upgrade_before except select * from pg_temp.games_everything()
  ) d;
  if diff is not null then
    raise exception 'Stopped: this would change something that already exists (%). Nothing was kept.', diff;
  end if;
  select string_agg(format('%s %s', d.kind, d.name), '; ') into diff from (
    select * from pg_temp.games_everything() except select * from games_upgrade_before
  ) d where d.name !~ '^games\.team_log(_|\.|$)'
      and d.name !~ '^games\.(admin_team_set|admin_team_remove|admin_team_log|hod_counts|hod_waiting|hod_sent_back)\(';
  if diff is not null then
    raise exception 'Stopped: this would add something it shouldn''t (%). Nothing was kept.', diff;
  end if;
end $$;

-- Signed-out visitors can't call anything in games; signed-in people only the site's functions; no table directly.
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
                          'admin_list', 'admin_save_chapters', 'admin_topic_questions',
                          'admin_team_set', 'admin_team_remove', 'admin_team_log', 'hod_counts', 'hod_waiting', 'hod_sent_back');
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
  if current_setting('games_upgrade.dry_run') is distinct from 'no' then
    raise exception 'Dry run passed: everything worked (the team''s log starts with %), nothing that exists would change, and nothing else is added. Nothing was kept. To keep it, change ''yes'' to ''no'' on the DRY RUN line near the top and run the whole file again.',
      (select case when count(*) = 1 then '1 person' else count(*) || ' people' end from games.team_log);
  end if;
end $$;

commit;
