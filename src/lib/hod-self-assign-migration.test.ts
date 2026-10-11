import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = (name: string) => readFileSync(`supabase/migrations/${name}`, 'utf8');

describe('20261011110000 hod_assign_to_self', () => {
  const s = sql('20261011110000_hod_assign_to_self.sql');
  it('lets only the caller themself skip the verifier list', () => {
    expect(s).toMatch(/p_user_id is distinct from auth\.uid\(\)/);
    expect(s).toMatch(/That person is not an active verifier/);
  });
  it('still gates on is_hod and the grade rule', () => {
    expect(s).toMatch(/if not public\.is_hod\(\)/);
    expect(s).toMatch(/verifier_can_take\(p_user_id, p_paper_id\)/);
  });
  it('makes an active HOD a paper checker without listing them in paper_checkers', () => {
    expect(s).toMatch(/paper_hods h where h\.user_id = auth\.uid\(\) and h\.active/);
    expect(s).not.toMatch(/insert into public\.paper_checkers/);
  });
});

describe('20261011100000 throttle_paper_distribution', () => {
  const s = sql('20261011100000_throttle_paper_distribution.sql');
  it('closes the new functions and the table to browser roles', () => {
    expect(s).toMatch(/revoke all on function public\.distribute_unassigned_papers_throttled\(\) from public, anon, authenticated/);
    expect(s).toMatch(/revoke all on function public\.distribute_unassigned_papers_cron\(\) from public, anon, authenticated/);
    expect(s).toMatch(/revoke all on public\.distribution_throttle from public, anon, authenticated/);
  });
  it('lists no longer runs the full hand-out directly', () => {
    const list = s.slice(s.indexOf('function public.verifier_my_papers()'));
    expect(list).toMatch(/distribute_unassigned_papers_throttled\(\)/);
    expect(list).not.toMatch(/perform public\.distribute_unassigned_papers\(\)/);
  });
  it('schedules the background hand-out', () => {
    expect(s).toMatch(/cron\.schedule\('distribute-unassigned-papers', '\*\/2 \* \* \* \*'/);
  });
});
