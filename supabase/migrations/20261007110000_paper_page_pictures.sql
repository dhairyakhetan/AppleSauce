-- Whole-paper fallback. Owner, 7 Oct 2026: "all papers are showing- there is
-- no paper associated to this question, judge from words alone". When a
-- question's own page cannot be matched, the screen shows every page of the
-- paper instead, so it needs the list of a paper's page pictures.
--
-- Admins and the HOD may list any paper; a checker only a paper they hold
-- (current or queued). HODs may also read the audit-figures bucket.

create or replace function public.paper_page_pictures(p_audit_paper_id uuid)
returns table(page integer, object_path text)
language plpgsql stable security definer
set search_path to 'public', 'pg_temp'
as $$
#variable_conflict use_column
begin
  if not (
    public.is_hod()
    or (public.is_paper_checker() and exists (
          select 1 from public.checker_assignments a
          where a.audit_paper_id = p_audit_paper_id and a.user_id = auth.uid()
            and a.status in ('assigned', 'queued')))
  ) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
    select pg.page, pg.object_path
    from public.audit_paper_pages pg
    where pg.audit_paper_id = p_audit_paper_id
      and coalesce(pg.object_path, '') <> ''
    order by pg.page;
end;
$$;

revoke all on function public.paper_page_pictures(uuid) from public, anon, authenticated;
grant execute on function public.paper_page_pictures(uuid) to authenticated;

drop policy if exists "paper checkers and admins can read audit figures" on storage.objects;
create policy "paper checkers and admins can read audit figures"
  on storage.objects for select to authenticated
  using (bucket_id = 'audit-figures' and (public.is_admin() or public.is_paper_checker() or public.is_hod()));
