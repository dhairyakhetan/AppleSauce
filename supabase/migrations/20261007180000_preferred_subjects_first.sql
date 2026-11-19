-- Preferred subjects did almost nothing (found in the 7 Oct edge-case run):
-- a verifier whose HOD set "English" got 1 English paper in 10 while 8 were
-- waiting. Two reasons, both fixed here:
--   - papers were handed out subject by subject in turn, so the verifier hit
--     the cap of 10 on other subjects before the English ones came round.
--     Papers some eligible verifier prefers now go first.
--   - the even-load band ("within one paper of the lightest load") ruled the
--     preferring verifier out. A preferred subject is an HOD's decision, so
--     it now beats the band (the cap of 10 and the grade rule still hold).
-- Verifiers with no preferred subjects are unchanged: spread across subjects
-- and grades, even load. Rehearsed: the English verifier got 8/10 English
-- (every English paper waiting), the two others 10 papers over 10 subjects
-- each, 0 above grade.
--
-- The function is patched in place (pg_get_functiondef + replace) so this
-- file states only the change; it refuses to run if either line is missing.

do $$
declare src text;
begin
  src := pg_get_functiondef('public.distribute_unassigned_papers()'::regprocedure);
  src := replace(src, 'and d.load <= v_min + greatest(p.n, 15)',
    'and (d.load <= v_min + greatest(p.n, 15) or (coalesce(array_length(d.preferred, 1), 0) > 0 and p.subject = any(d.preferred)))');
  src := replace(src, 'for p in select * from _dist_papers order by rank loop',
    'for p in select * from _dist_papers dp order by (exists (select 1 from _dist_load d where dp.subject = any(d.preferred) and dp.grade <= d.grade)) desc, rank loop');
  if position('any(d.preferred)))' in src) = 0 or position('_dist_papers dp order by' in src) = 0 then
    raise exception 'patch did not apply';
  end if;
  execute src;
end $$;
