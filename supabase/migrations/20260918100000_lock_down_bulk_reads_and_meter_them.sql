-- ===========================================================================
-- ONE MIGRATION. Run it once, top to bottom. Safe to re-run (idempotent).
--
-- WHAT IT CLOSES, verified by curl as a real caller before it was written:
--   GET /rest/v1/Shikshaqmine?select=Title,Link,"Phone Number"
--     -> all 148 teachers, both numbers, ONE request
--   GET /rest/v1/bank_questions?select=paper_id,number,body,marks
--     -> all 46,873 questions in ~47 paginated requests
-- One free account, no browser, no rate limit, about ninety seconds. September
-- closed these for `anon` and left `authenticated` wide open, on the
-- reasonable-at-the-time assumption that an account implied a real student.
--
-- IT IS SAFE TO RUN AGAINST THE CURRENTLY DEPLOYED CODE. The client already
-- ships with both paths: it calls the new functions, and falls back to the old
-- direct selects while they do not exist (src/lib/teacher-contact.ts,
-- src/hooks/useSiteCounts.ts). Before this runs, the fallbacks are used and a
-- 404 on /rpc/site_counts appears in the console. After it runs, the functions
-- answer and that 404 stops. Nothing breaks in either direction.
--
-- AFTER RUNNING IT, change two values in src/lib/free-preview.ts and deploy:
--   export const FREE_PREVIEW_QUESTIONS = 2;
--   export const FREE_PREVIEW_WORD = 'two';
-- Seven places promise the reader a number of free questions. Section 6 below
-- drops the gate from five to two; until that constant follows, the page will
-- promise five and hand over two.
--
-- WHAT IT DOES NOT DO: stop a determined person collecting the same data one
-- request at a time. This turns "1 request for 148 numbers" into "148 requests
-- for 148 numbers", forces every read through a function that can see
-- auth.uid(), and records each one. That is a cost increase and an audit
-- trail, not a wall.
--
-- Sections:
--   1  bank_questions: the RPC becomes the only read path
--   2  Shikshaqmine: contact columns leave the table grant
--   3  read_events: the telemetry that does not exist yet
--   4  teacher_own_contact() and admin_teacher_contacts()
--   5  site_counts()
--   6  bank_paper_questions() + teacher_whatsapp_link(): logging, preview 5 -> 2
--   7  quota machinery, shipped SWITCHED OFF
-- ROLLBACK is at the bottom.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. bank_questions
-- ---------------------------------------------------------------------------
-- Safe: the RPC already is the only read path. src/lib/question-bank.ts calls
-- bank_paper_questions() and nothing in src/ selects the table directly
-- (grepped across the tree). The RPC is SECURITY DEFINER, so it runs as the
-- owner and is unaffected by this revoke.
revoke select on public.bank_questions from authenticated;

-- ---------------------------------------------------------------------------
-- 2. Shikshaqmine contact columns
-- ---------------------------------------------------------------------------
-- Mirrors what 20260909000002 did for anon, plus "Email ID", which anon never
-- had: 148 teachers' email addresses should not be readable by every account.
--
-- UPDATE is a separate privilege and is deliberately untouched, so teachers
-- still edit their own row under the existing policy. That policy's own
-- reference to "Email ID" keeps working -- RLS expressions are evaluated
-- internally and do not require the caller to hold column privileges on what
-- they reference. The client's update filters were moved off "Email ID" to
-- "Slug" ahead of this, because Postgres DOES require SELECT on a column named
-- in a WHERE clause.
revoke select on public."Shikshaqmine" from authenticated;
grant select (
  "Area", "Class Size (Group/ Solo)", "Classes Taught", "Classes Taught for Backend",
  "Description", "EXPANDED", "Featured", "Featured Subject", "Hero Image",
  "LOCATION V2", "MOU", "Max Fees", "Min Fees", "Mode of Teaching",
  "Place of Teaching", "Qualifications etc", "Review 1", "Review 2", "Review 3",
  "STUDENT'S HOME IN THESE AREAS", "School Boards Catered", "Sir/Ma'am?", "Slug",
  "Subjects", "TUTOR'S HOME IN THESE AREAS", "Title", "Video", "Video Link",
  "Years they started teaching", id, is_paused
) on public."Shikshaqmine" to authenticated;

-- ---------------------------------------------------------------------------
-- 3. read_events
-- ---------------------------------------------------------------------------
-- There are 3 rows of read telemetry in this database today, which is why no
-- quota in section 7 has a defensible number attached to it yet.
create table if not exists public.read_events (
  id          bigserial primary key,
  user_id     uuid references auth.users(id) on delete set null,
  kind        text not null check (kind in ('paper', 'contact')),
  target_id   text not null,
  ip_hash     text,
  created_at  timestamptz not null default now()
);

create index if not exists read_events_user_time on public.read_events (user_id, created_at desc);
create index if not exists read_events_time      on public.read_events (created_at desc);
create index if not exists read_events_kind_time on public.read_events (kind, created_at desc);

alter table public.read_events enable row level security;

-- No policies and no grants, on purpose. Only the SECURITY DEFINER functions
-- below write here and nothing reads it over REST at all. A table with RLS on
-- and zero policies returns nothing to every role, which is the right default
-- for something recording reading behaviour, much of it by minors.
revoke all on public.read_events from public, anon, authenticated;
revoke all on sequence public.read_events_id_seq from public, anon, authenticated;

comment on table public.read_events is
  'One row per gated read (paper questions, teacher contact). Written only by SECURITY DEFINER functions; unreadable over REST. Retention 90 days, see purge_read_events().';

-- ---------------------------------------------------------------------------
-- 4. The two paths that legitimately need the contact columns
-- ---------------------------------------------------------------------------
-- NO ARGUMENT, deliberately: keyed entirely on auth.uid(), so it cannot be
-- aimed at another teacher. The join mirrors the existing "Teachers can view
-- own data" policy rather than inventing a second definition of "my row".
-- Checked against live data: all 31 teacher profiles resolve through it, every
-- one with a phone number, so no teacher loses their dashboard.
create or replace function public.teacher_own_contact()
returns table (id bigint, slug text, email_id text, phone_number text, link text)
language sql
stable
security definer
set search_path to 'public', 'extensions'
as $function$
  select s.id, s."Slug", s."Email ID", s."Phone Number", s."Link"
  from public."Shikshaqmine" s
  join public.profiles p
    on lower(trim(p.email)) = lower(trim(s."Email ID"))
  where p.id = (select auth.uid())
    and p.role = 'teacher'
    and s."Email ID" is not null
    and s."Email ID" <> ''
  limit 1;
$function$;

revoke all on function public.teacher_own_contact() from public;
grant execute on function public.teacher_own_contact() to authenticated;

comment on function public.teacher_own_contact() is
  'The signed-in teacher''s own contact columns. Takes no argument so it cannot be aimed at anyone else.';

-- The in-body is_admin() guard is the house pattern (20260818120000):
-- revoking from PUBLIC stops REST reaching it, and the guard means a future
-- GRANT cannot silently reopen it.
create or replace function public.admin_teacher_contacts()
returns table (id bigint, slug text, email_id text, phone_number text, link text)
language plpgsql
stable
security definer
set search_path to 'public', 'extensions'
as $function$
begin
  if not public.is_admin() then
    raise exception 'admin_teacher_contacts: not authorised' using errcode = '42501';
  end if;
  return query
    select s.id, s."Slug", s."Email ID", s."Phone Number", s."Link"
    from public."Shikshaqmine" s;
end;
$function$;

revoke all on function public.admin_teacher_contacts() from public;
grant execute on function public.admin_teacher_contacts() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. site_counts()
-- ---------------------------------------------------------------------------
-- The Footer renders on every route and was paging ALL 1,282 bank_papers rows
-- -- two round trips, ~100KB -- to compute one distinct-school count, because
-- there is no distinct-count over REST. In SQL it is one cheap aggregate.
-- These three numbers are already printed in the footer of every page, so
-- exposing them to anon exposes nothing new.
create or replace function public.site_counts()
returns table (teachers bigint, papers bigint, schools bigint)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    (select count(*) from public.teachers_list),
    (select count(*) from public.bank_papers where is_published),
    (select count(distinct school) from public.bank_papers
      where is_published and school is not null and btrim(school) <> '');
$function$;

revoke all on function public.site_counts() from public;
grant execute on function public.site_counts() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. The two existing gates: add logging, drop the preview to two
-- ---------------------------------------------------------------------------
-- Both become volatile plpgsql so they can insert. Return shapes and gating
-- behaviour are otherwise unchanged.
--
-- THE PREVIEW CHANGE IS THE ONLY LEVER THAT REDUCES ANONYMOUS EXPOSURE.
-- `anon` holds EXECUTE on bank_paper_questions and always has -- verified with
-- no account at all, 5 real question bodies came back. Across 1,282 published
-- papers that is 6,410 bodies in 1,282 requests. Two brings it to 2,564.
-- Nothing else in this file touches that number.
--
-- pgcrypto lives in the `extensions` schema on this project, not public, which
-- is why digest() is qualified and search_path is extended. Unqualified, this
-- fails at apply time.
--
-- request.headers is read defensively: if it is ever absent the read is still
-- served and still attributed to the account, which is the threat that
-- matters. Hashed rather than stored raw -- enough to spot one connection
-- farming accounts, without keeping a log of where students read from.
create or replace function public.bank_paper_questions(p_paper_id text)
returns table (
  id text, paper_id text, number text, body text, marks numeric,
  chapter text, qtype text, page integer, figure text, options text[]
)
language plpgsql
volatile
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is not null then
    insert into public.read_events (user_id, kind, target_id, ip_hash)
    values (v_uid, 'paper', p_paper_id,
      encode(extensions.digest(coalesce(
        current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''
      ), 'sha256'), 'hex'));
  end if;

  return query
    select q.id, q.paper_id, q.number, q.body, q.marks, q.chapter,
           q.qtype, q.page, q.figure, q.options
    from public.bank_questions q
    join public.bank_papers p on p.id = q.paper_id
    where q.paper_id = p_paper_id
      and p.is_published
    order by q.ord
    -- The gate. Was 5. auth.uid() is null for an anonymous caller and for
    -- Googlebot alike, and is read inside the function rather than from
    -- anything the client sends, so no flag or parameter can ask for more.
    limit case when v_uid is null then 2 else null end;
end;
$function$;

revoke all on function public.bank_paper_questions(text) from public;
grant execute on function public.bank_paper_questions(text) to anon, authenticated;

create or replace function public.teacher_whatsapp_link(p_slug text)
returns text
language plpgsql
volatile
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_uid  uuid := auth.uid();
  v_link text;
begin
  if v_uid is null then
    return null;
  end if;

  select s."Link" into v_link
  from public."Shikshaqmine" s
  where s."Slug" = p_slug
  limit 1;

  insert into public.read_events (user_id, kind, target_id, ip_hash)
  values (v_uid, 'contact', p_slug,
    encode(extensions.digest(coalesce(
      current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''
    ), 'sha256'), 'hex'));

  return v_link;
end;
$function$;

revoke all on function public.teacher_whatsapp_link(text) from public;
grant execute on function public.teacher_whatsapp_link(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Quota machinery, SHIPPED SWITCHED OFF
-- ---------------------------------------------------------------------------
-- enforcing defaults to FALSE and should stay false at launch. Every threshold
-- below is a guess about what a real student does, and the first person a bad
-- guess stops is a Class 10 student working through past papers the week
-- before boards -- the exact person this product exists for, doing the exact
-- thing it is for. Let read_events fill for two to four weeks, read the p99,
-- set the limits above it, then flip one boolean. No migration needed:
--   update public.read_quota_config set enforcing = true;
create table if not exists public.read_quota_config (
  id                 boolean primary key default true check (id),
  enforcing          boolean not null default false,
  papers_per_hour    integer not null default 20,
  papers_per_day     integer not null default 40,
  papers_first_24h   integer not null default 15,
  contacts_per_day   integer not null default 5,
  contacts_per_week  integer not null default 15,
  contacts_lifetime  integer not null default 30,
  updated_at         timestamptz not null default now()
);
insert into public.read_quota_config (id) values (true) on conflict (id) do nothing;
alter table public.read_quota_config enable row level security;
revoke all on public.read_quota_config from public, anon, authenticated;

-- A separate table rather than a column on profiles, so granting an exemption
-- never touches the row carrying someone's role. This exists because the cost
-- of a false positive is not symmetrical: a scraper who gets through is a bad
-- day; a real student locked out with no way back in does not return.
create table if not exists public.read_quota_exempt (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  reason     text,
  created_at timestamptz not null default now()
);
alter table public.read_quota_exempt enable row level security;
revoke all on public.read_quota_exempt from public, anon, authenticated;

create table if not exists public.read_quota_breaches (
  id         bigserial primary key,
  user_id    uuid references auth.users(id) on delete set null,
  kind       text not null,
  limit_hit  text not null,
  enforced   boolean not null,
  created_at timestamptz not null default now()
);
create index if not exists read_quota_breaches_time on public.read_quota_breaches (created_at desc);
alter table public.read_quota_breaches enable row level security;
revoke all on public.read_quota_breaches from public, anon, authenticated;

-- Returns the name of the limit exceeded, or null when within limits. Callers
-- decide what to do with that, which is what keeps soft-fail and enforcement
-- the same code path.
create or replace function public.read_quota_exceeded(p_uid uuid, p_kind text)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  c public.read_quota_config%rowtype;
  v_age interval;
  n integer;
begin
  if p_uid is null then return null; end if;
  if exists (select 1 from public.read_quota_exempt e where e.user_id = p_uid) then
    return null;
  end if;

  select * into c from public.read_quota_config where id;
  if not found then return null; end if;

  if p_kind = 'paper' then
    select now() - u.created_at into v_age from auth.users u where u.id = p_uid;
    -- A day-old account working through the library is the clearest scraper
    -- signature available, and the cheapest to act on.
    if v_age < interval '24 hours' then
      select count(*) into n from public.read_events where user_id = p_uid and kind = 'paper';
      if n >= c.papers_first_24h then return 'papers_first_24h'; end if;
    end if;

    select count(*) into n from public.read_events
      where user_id = p_uid and kind = 'paper' and created_at > now() - interval '1 hour';
    if n >= c.papers_per_hour then return 'papers_per_hour'; end if;

    select count(*) into n from public.read_events
      where user_id = p_uid and kind = 'paper' and created_at > now() - interval '24 hours';
    if n >= c.papers_per_day then return 'papers_per_day'; end if;

  elsif p_kind = 'contact' then
    -- Contacts are scarcer than papers by design. A parent shortlists three or
    -- four tutors; nobody legitimately reveals thirty numbers.
    select count(*) into n from public.read_events
      where user_id = p_uid and kind = 'contact' and created_at > now() - interval '24 hours';
    if n >= c.contacts_per_day then return 'contacts_per_day'; end if;

    select count(*) into n from public.read_events
      where user_id = p_uid and kind = 'contact' and created_at > now() - interval '7 days';
    if n >= c.contacts_per_week then return 'contacts_per_week'; end if;

    select count(*) into n from public.read_events
      where user_id = p_uid and kind = 'contact';
    if n >= c.contacts_lifetime then return 'contacts_lifetime'; end if;
  end if;

  return null;
end;
$function$;

revoke all on function public.read_quota_exceeded(uuid, text) from public;

-- Bot signals. Volume-independent, so they catch a patient scraper that stays
-- under every cap. Scoring only -- nothing here blocks anyone; it produces a
-- list to look at before enforcement is ever switched on.
create or replace view public.read_suspicion as
with recent as (
  select user_id, kind, ip_hash, created_at
  from public.read_events
  where created_at > now() - interval '30 days'
),
-- People pause, get distracted, speed up. Scripts are metronomes, so a
-- near-zero spread in the gaps between reads is a strong signal. The window
-- has to run over the whole per-user series, which is why this is its own CTE
-- rather than a lateral: a lateral would lag against an arbitrary single row
-- and produce a number that looks fine and means nothing.
gaps as (
  select user_id,
         extract(epoch from (created_at - lag(created_at)
           over (partition by user_id order by created_at))) as gap_s
  from recent
),
gap_stats as (
  select user_id, stddev_samp(gap_s) as gap_stddev_s
  from gaps where gap_s is not null group by user_id
),
-- Ten papers inside two minutes is twelve seconds each: fetching, not reading.
bursts as (
  select e.user_id, max(w.n) as max_burst_2min
  from recent e
  join lateral (
    select count(*) as n from recent b
    where b.user_id = e.user_id and b.kind = 'paper'
      and b.created_at >= e.created_at
      and b.created_at <  e.created_at + interval '2 minutes'
  ) w on true
  where e.kind = 'paper'
  group by e.user_id
),
per_user as (
  select
    r.user_id,
    count(*) filter (where r.kind = 'paper')   as papers,
    count(*) filter (where r.kind = 'contact') as contacts,
    count(distinct r.ip_hash)                  as networks,
    min(r.created_at)                          as first_seen,
    max(r.created_at)                          as last_seen,
    coalesce(b.max_burst_2min, 0)              as max_burst_2min,
    g.gap_stddev_s
  from recent r
  left join bursts    b on b.user_id = r.user_id
  left join gap_stats g on g.user_id = r.user_id
  group by r.user_id, b.max_burst_2min, g.gap_stddev_s
)
select
  user_id, papers, contacts, networks, first_seen, last_seen,
  max_burst_2min, gap_stddev_s,
  (case when max_burst_2min >= 10 then 3 else 0 end)
  + (case when gap_stddev_s is not null and gap_stddev_s < 2 and papers >= 10 then 3 else 0 end)
  + (case when networks >= 3 then 2 else 0 end)
  + (case when papers >= 100 then 2 else 0 end)
  + (case when contacts >= 20 then 3 else 0 end) as score
from per_user
where papers > 0 or contacts > 0;

revoke all on public.read_suspicion from public, anon, authenticated;

-- 90 days. Long enough to characterise a scraper, short enough that this is
-- not a permanent record of what individual students read. NEEDS SCHEDULING:
-- pg_cron is NOT installed on this project (checked), so either enable it and
--   select cron.schedule('purge-read-events','0 3 * * *','select public.purge_read_events()');
-- or call it from any scheduler, including by hand. It is idempotent.
create or replace function public.purge_read_events()
returns integer
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare n integer;
begin
  delete from public.read_events where created_at < now() - interval '90 days';
  get diagnostics n = row_count;
  delete from public.read_quota_breaches where created_at < now() - interval '90 days';
  return n;
end;
$function$;

revoke all on function public.purge_read_events() from public;

commit;

-- ===========================================================================
-- VERIFY (paste into the SQL editor after running)
--
--   -- anon still blocked, unchanged
--   select has_column_privilege('anon','public."Shikshaqmine"','Link','SELECT');        -- f
--   -- authenticated NOW blocked, which is the point of this migration
--   select has_column_privilege('authenticated','public."Shikshaqmine"','Link','SELECT'); -- f
--   select has_column_privilege('authenticated','public."Shikshaqmine"','Phone Number','SELECT'); -- f
--   select has_column_privilege('authenticated','public.bank_questions','body','SELECT');  -- f
--   -- a teacher can still reach their own row
--   select count(*) from public."Shikshaqmine" s join public.profiles p
--     on lower(trim(p.email)) = lower(trim(s."Email ID")) where p.role='teacher';         -- 31
--
-- Then in the app: a teacher opens their dashboard, sees their own number AND
-- SAVES SUCCESSFULLY (that is the regression that matters); admin's teacher
-- table shows contacts; a paper opens signed in and signed out; and
--   select count(*) from public.read_events;
-- rises as you browse. Check ip_hash is not the hash of an empty string -- if
-- it is, request.headers is not exposed here and the network-based signals in
-- read_suspicion go blind. Account-based ones still work.
--
-- From outside, as an anonymous caller, the preview should now be two:
--   curl -s -X POST "$URL/rest/v1/rpc/bank_paper_questions" -H "apikey: $KEY" \
--     -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
--     -d '{"p_paper_id":"0c9771"}' | grep -o '"paper_id"' | wc -l      -- 2
-- ===========================================================================

-- ===========================================================================
-- ROLLBACK
--   begin;
--     grant select on public.bank_questions  to authenticated;
--     grant select on public."Shikshaqmine"  to authenticated;
--     drop view     if exists public.read_suspicion;
--     drop function if exists public.teacher_own_contact();
--     drop function if exists public.admin_teacher_contacts();
--     drop function if exists public.site_counts();
--     drop function if exists public.read_quota_exceeded(uuid, text);
--     drop function if exists public.purge_read_events();
--     drop table    if exists public.read_quota_breaches;
--     drop table    if exists public.read_quota_exempt;
--     drop table    if exists public.read_quota_config;
--     -- drop table public.read_events;   -- only if the recorded data is not wanted
--     -- Then restore bank_paper_questions and teacher_whatsapp_link from
--     -- 20260909000001 and 20260909000002 (both `language sql stable`, preview 5).
--   commit;
-- ===========================================================================
