-- 20261011210000: a checker may read only the pictures of papers they hold (leak audit finding F2, 2026-10-11).
-- The private audit-figures bucket had one SELECT policy: admin, HOD or any active checker, with no path test, so one student
-- could list and download all 4,886 objects (1,705 whole-paper page images) of every paper.
-- Object names are either  pages/<audit_paper_id>/<n>.jpg  or  <audit_paper_id>/<uuid>.png  (checked on 2026-10-11: every
-- question crop's snippet_object and whole_snippet_object starts with its own paper id, and every audit_paper_pages
-- object_path is exactly pages/<paper>/<page>.jpg). The screens only ever ask for those paths, handed out by
-- verifier_next_in_paper, verifier_paper_questions, checker_question_context and paper_page_pictures, so a student holding the
-- paper still gets every picture they were shown.
-- "Holds" matches verifier_paper_questions: assignment status queued, assigned or done (done so a finished paper's
-- "See questions" list keeps its pictures). Returned assignments no longer count. Admins and HODs keep full read.
-- The helper is closed to anon and public; authenticated needs EXECUTE because the policy runs as the caller.

create or replace function public.checker_can_see_audit_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_hod()
      or (public.is_paper_checker() and exists (
            select 1
            from public.checker_assignments a
            where a.user_id = auth.uid()
              and a.status in ('queued', 'assigned', 'done')
              and a.audit_paper_id::text = case when split_part(p_name, '/', 1) = 'pages'
                                                then split_part(p_name, '/', 2)
                                                else split_part(p_name, '/', 1) end));
$$;

revoke all on function public.checker_can_see_audit_object(text) from public, anon, authenticated;
grant execute on function public.checker_can_see_audit_object(text) to authenticated;

drop policy if exists "paper checkers and admins can read audit figures" on storage.objects;
drop policy if exists "audit figures: admin, HOD, holder of the paper" on storage.objects;
create policy "audit figures: admin, HOD, holder of the paper"
  on storage.objects for select to authenticated
  using (bucket_id = 'audit-figures' and (public.is_admin() or public.checker_can_see_audit_object(name)));
