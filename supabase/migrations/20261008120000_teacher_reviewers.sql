-- Teacher reviewers: a team that approves, rejects and edits teachers without
-- being an admin.
--
-- Owner, 8 Oct 2026: papers work has its own section and more teams are
-- coming. Approving and rejecting teachers should not need admin. A teacher
-- reviewer CAN see teachers' phone and email, CAN edit details (not only
-- approve or reject), and the role is granted by an admin OR the HOD.
--
-- What this adds:
--   * teacher_reviewers: who holds the role. is_teacher_reviewer() is true for
--     admins too (same shape as is_hod()).
--   * hod_add_teacher_reviewer / hod_remove_teacher_reviewer /
--     hod_list_teacher_reviewers: granting and revoking, each gated on
--     is_hod() (true for admins as well).
--   * reviewer_* functions: the only way a reviewer reaches applications and
--     listed teachers (contacts included). Each is SECURITY DEFINER with the
--     role check inside, and each writes a row to admin_audit_log.
--   * approve_teacher_application: same signature and every existing check,
--     now also accepting a teacher reviewer.
--
-- What this deliberately does NOT do:
--   * No RLS policy on teacher_applications or "Shikshaqmine" is created,
--     altered or widened. A reviewer reads and writes through the functions
--     below, nothing else.
--   * A reviewer cannot pause or unpause a listing, delete anything, change a
--     slug or id, change an email, upload a photo, or edit the contact columns
--     of a listed teacher. Those stay with admin.
--
-- Every function here is revoked from public, anon AND authenticated, then
-- granted to authenticated only (the DO block at the end). Supabase grants
-- EXECUTE to the roles by name, so revoking from public alone is not enough.

-- ---------------------------------------------------------------- table

create table if not exists public.teacher_reviewers (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  active     boolean not null default true,
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz
);
alter table public.teacher_reviewers enable row level security;
revoke all on public.teacher_reviewers from public, anon, authenticated;
grant select on public.teacher_reviewers to authenticated;

drop policy if exists "teacher reviewers read own row" on public.teacher_reviewers;
create policy "teacher reviewers read own row"
  on public.teacher_reviewers for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------- role

create or replace function public.is_teacher_reviewer()
returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select public.is_admin() or exists (
    select 1 from public.teacher_reviewers r where r.user_id = auth.uid() and r.active
  );
$$;

-- Internal helpers, never callable from the API (revoked below).
create or replace function public.reviewer_actor_name()
returns text
language sql stable security definer
set search_path to 'public'
as $$
  select coalesce(
    nullif(btrim((select p.full_name from public.profiles p where p.id = auth.uid())), ''),
    (select u.email::text from auth.users u where u.id = auth.uid()),
    'a teacher reviewer'
  );
$$;

create or replace function public.reviewer_log(
  p_action text, p_target_type text, p_target_id text, p_target_label text, p_reason text
)
returns void
language plpgsql security definer
set search_path to 'public'
as $$
begin
  insert into public.admin_audit_log (actor_id, actor_name, action, target_type, target_id, target_label, reason)
  values (auth.uid(), public.reviewer_actor_name() || ' (teacher reviewer)',
          p_action, p_target_type, p_target_id, coalesce(nullif(p_target_label, ''), 'teacher'), p_reason);
end;
$$;

-- ---------------------------------------------------------------- granting

create or replace function public.hod_add_teacher_reviewer(p_email text)
returns uuid
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_user_id uuid;
begin
  if not public.is_hod() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select id into v_user_id from auth.users where lower(email) = lower(btrim(p_email));
  if v_user_id is null then
    raise exception 'No account with the email %; they must sign up first', p_email using errcode = 'P0002';
  end if;
  insert into public.teacher_reviewers (user_id, active, granted_by, granted_at, revoked_at)
  values (v_user_id, true, auth.uid(), now(), null)
  on conflict (user_id) do update
    set active = true, granted_by = auth.uid(), granted_at = now(), revoked_at = null;
  insert into public.admin_audit_log (actor_id, actor_name, action, target_type, target_id, target_label, reason)
  values (auth.uid(), public.reviewer_actor_name(), 'grant', 'teacher_reviewer', v_user_id::text, btrim(p_email), null);
  return v_user_id;
end;
$$;

create or replace function public.hod_remove_teacher_reviewer(p_user_id uuid)
returns void
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_label text;
begin
  if not public.is_hod() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  update public.teacher_reviewers set active = false, revoked_at = now() where user_id = p_user_id;
  select u.email::text into v_label from auth.users u where u.id = p_user_id;
  insert into public.admin_audit_log (actor_id, actor_name, action, target_type, target_id, target_label, reason)
  values (auth.uid(), public.reviewer_actor_name(), 'revoke', 'teacher_reviewer', p_user_id::text,
          coalesce(v_label, p_user_id::text), null);
end;
$$;

create or replace function public.hod_list_teacher_reviewers()
returns table(user_id uuid, email text, name text, active boolean, granted_at timestamptz)
language plpgsql stable security definer
set search_path to 'public'
as $$
#variable_conflict use_column
begin
  if not public.is_hod() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
    select r.user_id, u.email::text, public.history_actor_from_key(r.user_id::text) ->> 'name',
           r.active, r.granted_at
    from public.teacher_reviewers r
    join auth.users u on u.id = r.user_id
    order by r.active desc, r.granted_at desc;
end;
$$;

-- ---------------------------------------------------------------- reading

create or replace function public.reviewer_list_applications()
returns table(
  id uuid, name text, email text, phone_number text, sir_maam text, subjects text,
  classes_taught_for_backend text, school_boards_catered text, location_v2 text,
  students_home_areas text, tutors_home_areas text, mode_of_teaching text, class_size text,
  description text, qualifications_etc text, years_started_teaching text, featured_subject text,
  whatsapp_link text, hero_image_url text, reference_name text, reference_number text,
  min_fees integer, max_fees integer, mou_consent boolean, status text, texted_status text,
  reviewed_by uuid, reviewed_at timestamptz, rejection_reason text,
  created_at timestamptz, updated_at timestamptz
)
language plpgsql stable security definer
set search_path to 'public'
as $$
#variable_conflict use_column
begin
  if not public.is_teacher_reviewer() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
    select a.id, a.name::text, a.email::text, a.phone_number::text, a.sir_maam::text, a.subjects::text,
           a.classes_taught_for_backend::text, a.school_boards_catered::text, a.location_v2::text,
           a.students_home_areas::text, a.tutors_home_areas::text, a.mode_of_teaching::text, a.class_size::text,
           a.description::text, a.qualifications_etc::text, a.years_started_teaching::text, a.featured_subject::text,
           a.whatsapp_link::text, a.hero_image_url::text, a.reference_name::text, a.reference_number::text,
           a.min_fees::integer, a.max_fees::integer, a.mou_consent, a.status::text, a.texted_status::text,
           a.reviewed_by, a.reviewed_at, a.rejection_reason::text,
           a.created_at, a.updated_at
    from public.teacher_applications a
    order by a.created_at desc;
end;
$$;

create or replace function public.reviewer_list_teachers()
returns table(
  id bigint, slug text, title text, sir_maam text, subjects text, featured_subject text,
  classes_taught_for_backend text, classes_taught text, school_boards_catered text, location_v2 text,
  students_home_areas text, tutors_home_areas text, mode_of_teaching text, class_size text,
  description text, qualifications_etc text, years_started_teaching text,
  min_fees integer, max_fees integer, hero_image text, is_paused boolean,
  email_id text, phone_number text, link text
)
language plpgsql stable security definer
set search_path to 'public'
as $$
#variable_conflict use_column
begin
  if not public.is_teacher_reviewer() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
    select s.id::bigint, s."Slug"::text, s."Title"::text, s."Sir/Ma'am?"::text, s."Subjects"::text,
           s."Featured Subject"::text, s."Classes Taught for Backend"::text, s."Classes Taught"::text,
           s."School Boards Catered"::text, s."LOCATION V2"::text,
           s."STUDENT'S HOME IN THESE AREAS"::text, s."TUTOR'S HOME IN THESE AREAS"::text,
           s."Mode of Teaching"::text, s."Class Size (Group/ Solo)"::text,
           s."Description"::text, s."Qualifications etc"::text, s."Years they started teaching"::text,
           s."Min Fees"::integer, s."Max Fees"::integer, s."Hero Image"::text, s.is_paused,
           s."Email ID"::text, s."Phone Number"::text, s."Link"::text
    from public."Shikshaqmine" s
    order by s."Title";
end;
$$;

-- ---------------------------------------------------------------- applications

create or replace function public.reviewer_reject_application(p_id uuid, p_reason text)
returns void
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_app public.teacher_applications;
begin
  if not public.is_teacher_reviewer() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'A reason is required' using errcode = '22023';
  end if;
  select * into v_app from public.teacher_applications where id = p_id for update;
  if not found then
    raise exception 'Application not found' using errcode = 'P0002';
  end if;
  if v_app.status <> 'pending' then
    raise exception 'Application already processed' using errcode = '22023';
  end if;
  update public.teacher_applications
  set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(),
      rejection_reason = btrim(p_reason), updated_at = now()
  where id = p_id;
  perform public.reviewer_log('reject', 'teacher_application', p_id::text, v_app.name, btrim(p_reason));
end;
$$;

-- One patch object, keys from a fixed list. Anything else is refused by name,
-- so adding a field is a deliberate edit of this list, never an accident.
create or replace function public.reviewer_update_application(p_id uuid, p_patch jsonb)
returns void
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_allowed text[] := array[
    'name', 'sir_maam', 'phone_number', 'whatsapp_link', 'subjects', 'classes_taught_for_backend',
    'school_boards_catered', 'location_v2', 'students_home_areas', 'tutors_home_areas',
    'mode_of_teaching', 'class_size', 'description', 'qualifications_etc',
    'years_started_teaching', 'featured_subject', 'min_fees', 'max_fees'];
  v_bad text;
  v_key text;
  v_app public.teacher_applications;
  v_min integer;
  v_max integer;
  v_digits text;
begin
  if not public.is_teacher_reviewer() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'Nothing to change' using errcode = '22023';
  end if;
  select string_agg(k, ', ') into v_bad from jsonb_object_keys(p_patch) k where k <> all (v_allowed);
  if v_bad is not null then
    raise exception 'Not editable: %', v_bad using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_each(p_patch) e
             where jsonb_typeof(e.value) not in ('string', 'number', 'null')
                or (jsonb_typeof(e.value) = 'string' and length(e.value #>> '{}') > 5000)) then
    raise exception 'A value is the wrong type or too long' using errcode = '22023';
  end if;

  select * into v_app from public.teacher_applications where id = p_id for update;
  if not found then
    raise exception 'Application not found' using errcode = 'P0002';
  end if;
  if v_app.status <> 'pending' then
    raise exception 'Only a pending application can be edited' using errcode = '22023';
  end if;

  foreach v_key in array array['name', 'subjects', 'classes_taught_for_backend'] loop
    if p_patch ? v_key and nullif(btrim(coalesce(p_patch ->> v_key, '')), '') is null then
      raise exception '% cannot be empty', v_key using errcode = '22023';
    end if;
  end loop;
  if p_patch ? 'sir_maam' and coalesce(p_patch ->> 'sir_maam', '') not in ('Sir', 'Ma''am') then
    raise exception 'sir_maam must be Sir or Ma''am' using errcode = '22023';
  end if;
  if p_patch ? 'phone_number' then
    v_digits := regexp_replace(coalesce(p_patch ->> 'phone_number', ''), '[^0-9]', '', 'g');
    if length(v_digits) <> 10 then
      raise exception 'The phone number must be 10 digits' using errcode = '22023';
    end if;
  end if;
  v_min := case when p_patch ? 'min_fees' then (p_patch ->> 'min_fees')::integer else v_app.min_fees end;
  v_max := case when p_patch ? 'max_fees' then (p_patch ->> 'max_fees')::integer else v_app.max_fees end;
  if (v_min is not null and v_min < 0) or (v_max is not null and v_max < 0)
     or (v_min is not null and v_max is not null and v_min > v_max) then
    raise exception 'The fees are not valid' using errcode = '22023';
  end if;

  update public.teacher_applications set
    name = case when p_patch ? 'name' then btrim(p_patch ->> 'name') else name end,
    sir_maam = case when p_patch ? 'sir_maam' then p_patch ->> 'sir_maam' else sir_maam end,
    phone_number = case when p_patch ? 'phone_number' then v_digits else phone_number end,
    whatsapp_link = case when p_patch ? 'whatsapp_link' then nullif(btrim(p_patch ->> 'whatsapp_link'), '') else whatsapp_link end,
    subjects = case when p_patch ? 'subjects' then btrim(p_patch ->> 'subjects') else subjects end,
    classes_taught_for_backend = case when p_patch ? 'classes_taught_for_backend' then btrim(p_patch ->> 'classes_taught_for_backend') else classes_taught_for_backend end,
    school_boards_catered = case when p_patch ? 'school_boards_catered' then nullif(btrim(p_patch ->> 'school_boards_catered'), '') else school_boards_catered end,
    location_v2 = case when p_patch ? 'location_v2' then nullif(btrim(p_patch ->> 'location_v2'), '') else location_v2 end,
    students_home_areas = case when p_patch ? 'students_home_areas' then nullif(btrim(p_patch ->> 'students_home_areas'), '') else students_home_areas end,
    tutors_home_areas = case when p_patch ? 'tutors_home_areas' then nullif(btrim(p_patch ->> 'tutors_home_areas'), '') else tutors_home_areas end,
    mode_of_teaching = case when p_patch ? 'mode_of_teaching' then nullif(btrim(p_patch ->> 'mode_of_teaching'), '') else mode_of_teaching end,
    class_size = case when p_patch ? 'class_size' then nullif(btrim(p_patch ->> 'class_size'), '') else class_size end,
    description = case when p_patch ? 'description' then nullif(btrim(p_patch ->> 'description'), '') else description end,
    qualifications_etc = case when p_patch ? 'qualifications_etc' then nullif(btrim(p_patch ->> 'qualifications_etc'), '') else qualifications_etc end,
    years_started_teaching = case when p_patch ? 'years_started_teaching' then nullif(btrim(p_patch ->> 'years_started_teaching'), '') else years_started_teaching end,
    featured_subject = case when p_patch ? 'featured_subject' then nullif(btrim(p_patch ->> 'featured_subject'), '') else featured_subject end,
    min_fees = v_min,
    max_fees = v_max,
    updated_at = now()
  where id = p_id;

  perform public.reviewer_log('edit', 'teacher_application', p_id::text, v_app.name,
    'changed: ' || (select string_agg(k, ', ' order by k) from jsonb_object_keys(p_patch) k));
end;
$$;

-- ---------------------------------------------------------------- listed teachers

create or replace function public.reviewer_update_teacher(p_id bigint, p_patch jsonb)
returns void
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_allowed text[] := array[
    'title', 'sir_maam', 'subjects', 'featured_subject', 'classes_taught_for_backend', 'classes_taught',
    'school_boards_catered', 'location_v2', 'students_home_areas', 'tutors_home_areas',
    'mode_of_teaching', 'class_size', 'description', 'qualifications_etc',
    'years_started_teaching', 'min_fees', 'max_fees'];
  v_bad text;
  v_key text;
  v_label text;
  v_min integer;
  v_max integer;
  v_row record;
begin
  if not public.is_teacher_reviewer() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'Nothing to change' using errcode = '22023';
  end if;
  select string_agg(k, ', ') into v_bad from jsonb_object_keys(p_patch) k where k <> all (v_allowed);
  if v_bad is not null then
    raise exception 'Not editable: %', v_bad using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_each(p_patch) e
             where jsonb_typeof(e.value) not in ('string', 'number', 'null')
                or (jsonb_typeof(e.value) = 'string' and length(e.value #>> '{}') > 5000)) then
    raise exception 'A value is the wrong type or too long' using errcode = '22023';
  end if;

  select s."Title" as title, s."Min Fees" as min_fees, s."Max Fees" as max_fees
    into v_row from public."Shikshaqmine" s where s.id = p_id for update;
  if not found then
    raise exception 'Teacher not found' using errcode = 'P0002';
  end if;
  v_label := v_row.title;

  foreach v_key in array array['title', 'subjects', 'classes_taught_for_backend'] loop
    if p_patch ? v_key and nullif(btrim(coalesce(p_patch ->> v_key, '')), '') is null then
      raise exception '% cannot be empty', v_key using errcode = '22023';
    end if;
  end loop;
  if p_patch ? 'sir_maam' and coalesce(p_patch ->> 'sir_maam', '') not in ('Sir', 'Ma''am') then
    raise exception 'sir_maam must be Sir or Ma''am' using errcode = '22023';
  end if;
  v_min := case when p_patch ? 'min_fees' then (p_patch ->> 'min_fees')::integer else v_row.min_fees end;
  v_max := case when p_patch ? 'max_fees' then (p_patch ->> 'max_fees')::integer else v_row.max_fees end;
  if (v_min is not null and v_min < 0) or (v_max is not null and v_max < 0)
     or (v_min is not null and v_max is not null and v_min > v_max) then
    raise exception 'The fees are not valid' using errcode = '22023';
  end if;

  -- protect_teacher_fields reverts Title and Sir/Ma'am for anyone who is not an
  -- admin. This flag (transaction-local, only settable from SQL, not through
  -- the API) lets the trigger accept those two from this function alone.
  perform set_config('shikshaq.reviewer_edit', 'on', true);
  update public."Shikshaqmine" set
    "Title" = case when p_patch ? 'title' then btrim(p_patch ->> 'title') else "Title" end,
    "Sir/Ma'am?" = case when p_patch ? 'sir_maam' then p_patch ->> 'sir_maam' else "Sir/Ma'am?" end,
    "Subjects" = case when p_patch ? 'subjects' then btrim(p_patch ->> 'subjects') else "Subjects" end,
    "Featured Subject" = case when p_patch ? 'featured_subject' then nullif(btrim(p_patch ->> 'featured_subject'), '') else "Featured Subject" end,
    "Classes Taught for Backend" = case when p_patch ? 'classes_taught_for_backend' then btrim(p_patch ->> 'classes_taught_for_backend') else "Classes Taught for Backend" end,
    "Classes Taught" = case when p_patch ? 'classes_taught' then nullif(btrim(p_patch ->> 'classes_taught'), '') else "Classes Taught" end,
    "School Boards Catered" = case when p_patch ? 'school_boards_catered' then nullif(btrim(p_patch ->> 'school_boards_catered'), '') else "School Boards Catered" end,
    "LOCATION V2" = case when p_patch ? 'location_v2' then nullif(btrim(p_patch ->> 'location_v2'), '') else "LOCATION V2" end,
    "STUDENT'S HOME IN THESE AREAS" = case when p_patch ? 'students_home_areas' then nullif(btrim(p_patch ->> 'students_home_areas'), '') else "STUDENT'S HOME IN THESE AREAS" end,
    "TUTOR'S HOME IN THESE AREAS" = case when p_patch ? 'tutors_home_areas' then nullif(btrim(p_patch ->> 'tutors_home_areas'), '') else "TUTOR'S HOME IN THESE AREAS" end,
    "Mode of Teaching" = case when p_patch ? 'mode_of_teaching' then nullif(btrim(p_patch ->> 'mode_of_teaching'), '') else "Mode of Teaching" end,
    "Class Size (Group/ Solo)" = case when p_patch ? 'class_size' then nullif(btrim(p_patch ->> 'class_size'), '') else "Class Size (Group/ Solo)" end,
    "Description" = case when p_patch ? 'description' then nullif(btrim(p_patch ->> 'description'), '') else "Description" end,
    "Qualifications etc" = case when p_patch ? 'qualifications_etc' then nullif(btrim(p_patch ->> 'qualifications_etc'), '') else "Qualifications etc" end,
    "Years they started teaching" = case when p_patch ? 'years_started_teaching' then nullif(btrim(p_patch ->> 'years_started_teaching'), '') else "Years they started teaching" end,
    "Min Fees" = v_min,
    "Max Fees" = v_max
  where id = p_id;
  perform set_config('shikshaq.reviewer_edit', 'off', true);

  perform public.reviewer_log('edit', 'teacher', p_id::text, v_label,
    'changed: ' || (select string_agg(k, ', ' order by k) from jsonb_object_keys(p_patch) k));
end;
$$;

-- protect_teacher_fields (trigger on "Shikshaqmine"): unchanged for admins and
-- teachers. A teacher reviewer editing through reviewer_update_teacher (the
-- flag above) may change Title and Sir/Ma'am; Slug, EXPANDED and Email ID stay
-- protected for them too. Without this the trigger silently reverted a
-- reviewer's rename while the audit log said it changed.
create or replace function public.protect_teacher_fields()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_reviewer boolean := coalesce(current_setting('shikshaq.reviewer_edit', true), '') = 'on'
                        and public.is_teacher_reviewer();
begin
  if public.is_admin() then
    return new;
  end if;

  if not v_reviewer and old."Title" is distinct from new."Title" then
    new."Title" := old."Title";
  end if;

  if old."Slug" is distinct from new."Slug" then
    new."Slug" := old."Slug";
  end if;

  if not v_reviewer and old."Sir/Ma'am?" is distinct from new."Sir/Ma'am?" then
    new."Sir/Ma'am?" := old."Sir/Ma'am?";
  end if;

  if old."EXPANDED" is distinct from new."EXPANDED" then
    new."EXPANDED" := old."EXPANDED";
  end if;

  if old."Email ID" is distinct from new."Email ID" then
    new."Email ID" := old."Email ID";
  end if;

  return new;
end;
$function$;
revoke all on function public.protect_teacher_fields() from public, anon, authenticated;

-- ---------------------------------------------------------------- approving

-- Same signature, same body, same checks as 20260812054214. The only change:
-- the "is this an admin" test now also passes a teacher reviewer, and an
-- approval by someone who is not an admin writes its own audit row (the admin
-- page records its own through recordAdminAction, so admins are not doubled).
create or replace function public.approve_teacher_application(application_id uuid, admin_id uuid)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  app_record record;
  generated_slug text;
  shikshaqmine_id integer;
  classes_taught_roman text;
  whatsapp_link text;
  phone_digits text;
begin
  -- The caller IS the user they claim to be, not just a known admin id.
  if auth.uid() is distinct from admin_id then
    raise exception 'Not authorized';
  end if;

  -- Verify admin or teacher reviewer
  if not exists (
    select 1 from public.admins where id = admin_id
  ) and not exists (
    select 1 from public.profiles where id = admin_id and role = 'admin'
  ) and not public.is_teacher_reviewer() then
    raise exception 'User is not an admin or a teacher reviewer';
  end if;

  -- Fetch application
  select * into app_record
  from public.teacher_applications
  where id = application_id and status = 'pending';

  if not found then
    raise exception 'Application not found or already processed';
  end if;

  -- Verify MOU consent
  if app_record.mou_consent is not true then
    raise exception 'Application cannot be approved without MOU consent';
  end if;

  -- Generate unique slug
  generated_slug := public.generate_unique_slug(app_record.name);

  -- Auto-generate WhatsApp link from phone number if not provided
  if app_record.whatsapp_link is null or app_record.whatsapp_link = '' then
    phone_digits := regexp_replace(app_record.phone_number, '[^0-9]', '', 'g');
    whatsapp_link := 'https://wa.me/91' || phone_digits;
  else
    whatsapp_link := app_record.whatsapp_link;
  end if;

  -- Insert into Shikshaqmine
  insert into public."Shikshaqmine" (
    "Title",
    "Slug",
    "Email ID",
    "Phone Number",
    "Sir/Ma'am?",
    "Subjects",
    "Classes Taught for Backend",
    "School Boards Catered",
    "LOCATION V2",
    "STUDENT'S HOME IN THESE AREAS",
    "TUTOR'S HOME IN THESE AREAS",
    "Mode of Teaching",
    "Class Size (Group/ Solo)",
    "Description",
    "Qualifications etc",
    "Years they started teaching",
    "Featured Subject",
    "Link",
    "Hero Image",
    "MOU",
    "Min Fees",
    "Max Fees"
  )
  values (
    app_record.name,
    generated_slug,
    app_record.email,
    app_record.phone_number,
    app_record.sir_maam,
    app_record.subjects,
    app_record.classes_taught_for_backend,
    app_record.school_boards_catered,
    app_record.location_v2,
    app_record.students_home_areas,
    app_record.tutors_home_areas,
    app_record.mode_of_teaching,
    app_record.class_size,
    app_record.description,
    app_record.qualifications_etc,
    app_record.years_started_teaching,
    app_record.featured_subject,
    whatsapp_link,
    app_record.hero_image_url,
    true, -- MOU consent was required to submit
    app_record.min_fees,
    app_record.max_fees
  )
  returning id into shikshaqmine_id;

  -- Update application status
  update public.teacher_applications
  set
    status = 'approved',
    reviewed_by = admin_id,
    reviewed_at = now(),
    updated_at = now()
  where id = application_id;

  -- Update user role to 'teacher' if they already have an account
  update public.profiles
  set
    role = 'teacher',
    email = coalesce(profiles.email, app_record.email),
    updated_at = now()
  where exists (
    select 1 from auth.users u
    where u.id = profiles.id
      and lower(trim(u.email)) = lower(trim(app_record.email))
  );

  if not public.is_admin() then
    perform public.reviewer_log('approve', 'teacher_application', application_id::text, app_record.name, null);
  end if;

  return shikshaqmine_id;
end;
$function$;

-- What the teacher review page calls. Always writes the audit row, including
-- when an admin uses that page (the admin page logs its own approvals, this
-- one does not go through it). Not logged twice: approve_teacher_application
-- only logs for non-admins, and this logs only for admins.
create or replace function public.reviewer_approve_application(p_id uuid)
returns integer
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_new integer;
  v_name text;
begin
  if not public.is_teacher_reviewer() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select a.name into v_name from public.teacher_applications a where a.id = p_id;
  v_new := public.approve_teacher_application(p_id, auth.uid());
  if public.is_admin() then
    perform public.reviewer_log('approve', 'teacher_application', p_id::text, v_name, null);
  end if;
  return v_new;
end;
$$;

-- ---------------------------------------------------------------- lock down

do $lock$
declare
  v_sig text;
  v_oid regprocedure;
begin
  -- Callable by a signed-in user; the role check is inside each body.
  foreach v_sig in array array[
    'public.is_teacher_reviewer()',
    'public.hod_add_teacher_reviewer(text)',
    'public.hod_remove_teacher_reviewer(uuid)',
    'public.hod_list_teacher_reviewers()',
    'public.reviewer_list_applications()',
    'public.reviewer_list_teachers()',
    'public.reviewer_reject_application(uuid, text)',
    'public.reviewer_update_application(uuid, jsonb)',
    'public.reviewer_update_teacher(bigint, jsonb)',
    'public.reviewer_approve_application(uuid)',
    'public.approve_teacher_application(uuid, uuid)'
  ] loop
    v_oid := to_regprocedure(v_sig);
    if v_oid is null then
      raise exception 'function % does not exist', v_sig;
    end if;
    execute format('revoke all on function %s from public, anon, authenticated', v_oid);
    execute format('grant execute on function %s to authenticated', v_oid);
  end loop;

  -- Internal helpers: nobody reaches these through the API.
  foreach v_sig in array array[
    'public.reviewer_actor_name()',
    'public.reviewer_log(text, text, text, text, text)'
  ] loop
    v_oid := to_regprocedure(v_sig);
    if v_oid is null then
      raise exception 'function % does not exist', v_sig;
    end if;
    execute format('revoke all on function %s from public, anon, authenticated', v_oid);
  end loop;
end
$lock$;
