-- Page pictures saved sideways. Owner, 12 Nov 2026: "papers are rotated + not visible (entirely)".
-- Some scanned PDFs hold one upright photo per page that is drawn turned a quarter turn, so the stored page picture
-- reads sideways (found on paper d18e788e, pages 2 to 5). The question pictures (crops) are already cut upright.
-- The whole-page view on the checking screen draws a highlight box measured in the SIDEWAYS picture, so the picture
-- cannot simply be re-saved upright; instead each page records how far to turn it, and the site turns the picture and
-- the box together.
--
-- WHAT THIS DOES
--   1. audit_paper_pages gets a column rotation: smallint, nullable, default 0, only 0, 90, 180 or 270. It is the number
--      of degrees CLOCKWISE the stored picture must be turned to read upright. 0 (or empty) = leave the page as it is.
--      Existing rows become 0 for free (the default), so nothing changes for any paper until the pipeline writes a turn.
--   2. paper_page_pictures(uuid) returns that value as a third column, rotation. The return type changes, so the
--      function is dropped and made again, then its grants are put back exactly as 20261007110000_paper_page_pictures.sql
--      had them: closed to public and anon, open to signed-in users, and the caller is checked inside
--      (an HOD or admin for any paper, a checker only for a paper they hold, current or queued). Same body otherwise.
--   Old site code that does not know the column ignores it (it reads page and object_path only).
--
-- ROLLBACK (the column is harmless to leave; put the function back first, then drop the column if you want it gone):
--   begin;
--   drop function if exists public.paper_page_pictures(uuid);
--   create function public.paper_page_pictures(p_audit_paper_id uuid)
--    returns table(page integer, object_path text) language plpgsql stable security definer
--    set search_path to 'public', 'pg_temp' as $$ #variable_conflict use_column
--    begin
--      if not (public.is_hod() or (public.is_paper_checker() and exists (select 1 from public.checker_assignments a
--        where a.audit_paper_id = p_audit_paper_id and a.user_id = auth.uid() and a.status in ('assigned', 'queued'))))
--      then raise exception 'Not authorized' using errcode = '42501'; end if;
--      return query select pg.page, pg.object_path from public.audit_paper_pages pg
--        where pg.audit_paper_id = p_audit_paper_id and coalesce(pg.object_path, '') <> '' order by pg.page;
--    end; $$;
--   revoke all on function public.paper_page_pictures(uuid) from public, anon, authenticated;
--   grant execute on function public.paper_page_pictures(uuid) to authenticated;
--   alter table public.audit_paper_pages drop column if exists rotation;
--   commit;
--
-- Safe to run twice. Writes no data. NOT APPLIED (a person pastes it in the Supabase SQL editor).

begin;

alter table public.audit_paper_pages
  add column if not exists rotation smallint default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.audit_paper_pages'::regclass and conname = 'audit_paper_pages_rotation_check'
  ) then
    alter table public.audit_paper_pages
      add constraint audit_paper_pages_rotation_check check (rotation in (0, 90, 180, 270));
  end if;
end $$;

drop function if exists public.paper_page_pictures(uuid);

create function public.paper_page_pictures(p_audit_paper_id uuid)
returns table(page integer, object_path text, rotation smallint)
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
    select pg.page, pg.object_path, coalesce(pg.rotation, 0)::smallint
    from public.audit_paper_pages pg
    where pg.audit_paper_id = p_audit_paper_id
      and coalesce(pg.object_path, '') <> ''
    order by pg.page;
end;
$$;

revoke all on function public.paper_page_pictures(uuid) from public, anon, authenticated;
grant execute on function public.paper_page_pictures(uuid) to authenticated;

commit;
