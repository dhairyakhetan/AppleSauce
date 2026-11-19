-- 20261011180000: stop the verifier RPCs returning the owner's local path (leak audit finding F5, 2026-10-11).
-- audit_questions.source carries snippet_path = a Windows path on the owner's machine (24,851 rows). verifier_next_in_paper,
-- checker_question_context and verifier_undo_last returned the whole source jsonb to the student. The screens read only
-- page, page_verified, align_score, bbox, dpi, page_width/height/page_size, edit_log, snippet_object, whole_snippet_object,
-- whole_snippet_members, container, swarm and so on; none reads source.snippet_path. The returned top-level snippet_path
-- column (a storage object path) is a different thing and is unchanged.
--
-- Each function is patched from its own live definition (pg_get_functiondef), so signature, SECURITY DEFINER, search_path
-- and every other line stay exactly as they are. The patch raises if the expected text is not found exactly as many times
-- as expected, and does nothing if it was already applied. No data row is touched.

do $patch$
declare
  v_def text;
  v_new text;
  v_hits int;
  r record;
begin
  for r in
    select * from (values
      ('public.verifier_next_in_paper(uuid, boolean)', 'aq.flag_detail, aq.source,',
                                                        'aq.flag_detail, (aq.source - ''snippet_path''),', 1),
      ('public.checker_question_context(uuid)',        'aq.options, aq.source,',
                                                        'aq.options, (aq.source - ''snippet_path''),', 2),
      ('public.verifier_undo_last(uuid)',              '''source'', aq.source,',
                                                        '''source'', (aq.source - ''snippet_path''),', 1)
    ) as t(fn, needle, repl, expected)
  loop
    v_def := pg_get_functiondef(r.fn::regprocedure);
    if position(r.repl in v_def) > 0 and position(r.needle in v_def) = 0 then
      continue; -- already patched
    end if;
    v_hits := (length(v_def) - length(replace(v_def, r.needle, ''))) / length(r.needle);
    if v_hits <> r.expected then
      raise exception 'patch did not apply: % (found % of %)', r.fn, v_hits, r.expected;
    end if;
    v_new := replace(v_def, r.needle, r.repl);
    execute v_new;
  end loop;
end
$patch$;

-- Re-assert the grants exactly as they were: authenticated only (service_role keeps its default).
revoke all on function public.verifier_next_in_paper(uuid, boolean) from public, anon, authenticated;
grant execute on function public.verifier_next_in_paper(uuid, boolean) to authenticated;
revoke all on function public.checker_question_context(uuid) from public, anon, authenticated;
grant execute on function public.checker_question_context(uuid) to authenticated;
revoke all on function public.verifier_undo_last(uuid) from public, anon, authenticated;
grant execute on function public.verifier_undo_last(uuid) to authenticated;
