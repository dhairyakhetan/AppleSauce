-- 20261005140000_paper_registry.sql
--
-- Owner, 2026-10-05: "you maintain an active database of which papers have
-- been processed and which have not been processed and that is also data on
-- the papers dashboard of the website".
--
-- public.paper_registry is one row per source PDF the pipeline knows about,
-- processed or not. The pipeline (service_role, from the desk) is the ONLY
-- writer: RLS is on with no policies and every privilege is revoked from
-- public, anon and authenticated by name, so no browser session can read or
-- write it directly. The site reads it through two admin-only SECURITY DEFINER
-- functions below.
--
-- Names, ids and counts only. Never question text, never an answer key.
--
-- Excluded rows (excluded = true) are papers deliberately left out of scope;
-- they are not shown in the list or counted in the summary, only reported as
-- a number so the gap is visible.
--
-- The functions follow admin_pipeline_stats / admin_live_paper_open_questions:
-- is_admin() first (42501 otherwise), explicit columns, search_path pinned,
-- EXECUTE revoked from public, anon AND authenticated by name, then granted
-- to authenticated only (Supabase grants new functions to anon by role name).

create table if not exists public.paper_registry (
  registry_key text primary key,
  pdf_name text,
  board text,
  class text,
  subject text,
  year text,
  school text,
  ocr_state text,
  processed_state text
    check (processed_state in (
      'not_started', 'ocr_queued', 'ocr_done', 'loaded',
      'ai_checked', 'fully_checked', 'awaiting_approval', 'live'
    )),
  audit_paper_id uuid,
  bank_paper_id text,
  source text,
  questions_total integer,
  questions_passed integer,
  open_student integer,
  open_admin integer,
  approval_state text,
  frozen boolean default false,
  excluded boolean default false,
  updated_at timestamptz default now()
);

alter table public.paper_registry enable row level security;
revoke all on table public.paper_registry from public, anon, authenticated;

create index if not exists paper_registry_state_idx
  on public.paper_registry (processed_state);
create index if not exists paper_registry_subject_idx
  on public.paper_registry (subject);

-- ---------------------------------------------------------------------------
-- admin_paper_registry_summary(): counts for the dashboard bar and filters.
-- ---------------------------------------------------------------------------
create or replace function public.admin_paper_registry_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v jsonb;
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'total', (select count(*) from public.paper_registry r where not coalesce(r.excluded, false)),
    'by_state', coalesce((
      select jsonb_object_agg(s.processed_state, s.n)
      from (
        select coalesce(r.processed_state, 'not_started') as processed_state, count(*) as n
        from public.paper_registry r
        where not coalesce(r.excluded, false)
        group by 1
      ) s
    ), '{}'::jsonb),
    'by_subject', coalesce((
      select jsonb_agg(
        jsonb_build_object('subject', t.subject, 'total', t.total, 'by_state', t.by_state)
        order by t.total desc, t.subject)
      from (
        select x.subject, sum(x.n)::integer as total, jsonb_object_agg(x.processed_state, x.n) as by_state
        from (
          select coalesce(nullif(r.subject, ''), 'Not recorded') as subject,
                 coalesce(r.processed_state, 'not_started') as processed_state,
                 count(*) as n
          from public.paper_registry r
          where not coalesce(r.excluded, false)
          group by 1, 2
        ) x
        group by x.subject
      ) t
    ), '[]'::jsonb),
    'by_board', coalesce((
      select jsonb_object_agg(b.board, b.n)
      from (
        select coalesce(nullif(r.board, ''), 'Not recorded') as board, count(*) as n
        from public.paper_registry r
        where not coalesce(r.excluded, false)
        group by 1
      ) b
    ), '{}'::jsonb),
    'frozen', (select count(*) from public.paper_registry r
               where coalesce(r.frozen, false) and not coalesce(r.excluded, false)),
    'excluded', (select count(*) from public.paper_registry r where coalesce(r.excluded, false)),
    'last_updated_at', (select max(r.updated_at) from public.paper_registry r)
  ) into v;

  return v;
end;
$function$;

revoke all on function public.admin_paper_registry_summary() from public, anon, authenticated;
grant execute on function public.admin_paper_registry_summary() to authenticated;

-- ---------------------------------------------------------------------------
-- admin_paper_registry(...): a page of rows plus the total that match.
-- Not-started papers sort first, then by how far along they are, then name.
-- ---------------------------------------------------------------------------
create or replace function public.admin_paper_registry(
  p_state text default null,
  p_search text default null,
  p_subject text default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_pattern text;
  v_total integer;
  v_rows jsonb;
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  if v_search is not null then
    v_pattern := '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  select count(*) into v_total
  from public.paper_registry r
  where not coalesce(r.excluded, false)
    and (nullif(p_state, '') is null or coalesce(r.processed_state, 'not_started') = p_state)
    and (nullif(p_subject, '') is null
         or coalesce(nullif(r.subject, ''), 'Not recorded') = p_subject)
    and (v_pattern is null
         or r.pdf_name ilike v_pattern
         or r.registry_key ilike v_pattern
         or r.bank_paper_id ilike v_pattern
         or r.audit_paper_id::text ilike v_pattern);

  select coalesce(jsonb_agg(to_jsonb(p) - 'state_rank' order by p.state_rank, p.pdf_name nulls last, p.registry_key), '[]'::jsonb)
  into v_rows
  from (
    select r.registry_key, r.pdf_name, r.board, r.class, r.subject, r.year, r.school,
           r.ocr_state, coalesce(r.processed_state, 'not_started') as processed_state,
           r.audit_paper_id, r.bank_paper_id, r.source,
           r.questions_total, r.questions_passed, r.open_student, r.open_admin,
           r.approval_state, coalesce(r.frozen, false) as frozen,
           coalesce(r.excluded, false) as excluded, r.updated_at,
           case coalesce(r.processed_state, 'not_started')
             when 'not_started' then 0 when 'ocr_queued' then 1 when 'ocr_done' then 2
             when 'loaded' then 3 when 'ai_checked' then 4 when 'fully_checked' then 5
             when 'awaiting_approval' then 6 else 7 end as state_rank
    from public.paper_registry r
    where not coalesce(r.excluded, false)
      and (nullif(p_state, '') is null or coalesce(r.processed_state, 'not_started') = p_state)
      and (nullif(p_subject, '') is null
           or coalesce(nullif(r.subject, ''), 'Not recorded') = p_subject)
      and (v_pattern is null
           or r.pdf_name ilike v_pattern
           or r.registry_key ilike v_pattern
           or r.bank_paper_id ilike v_pattern
           or r.audit_paper_id::text ilike v_pattern)
    order by state_rank, r.pdf_name nulls last, r.registry_key
    limit v_limit offset v_offset
  ) p;

  return jsonb_build_object('total', v_total, 'rows', v_rows);
end;
$function$;

revoke all on function public.admin_paper_registry(text, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.admin_paper_registry(text, text, text, integer, integer) to authenticated;
