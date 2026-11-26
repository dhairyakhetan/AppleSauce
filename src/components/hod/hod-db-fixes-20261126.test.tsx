import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

const rpc = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a), from: vi.fn(), storage: { from: vi.fn() }, auth: { getSession: vi.fn(), onAuthStateChange: vi.fn() } },
}));

import { PaperSheet } from '@/components/hod/PaperSheet';
import { createFakeHodApi } from '@/dummy/hod-fake-api';
import { realHodApi } from '@/lib/hod-api';
import { explainLeftovers, normaliseHandoutReasons, summariseAutoAssign } from '@/lib/hod-bulk-assign';
import { aiOnlyIds, aiOnlyText, canLeaveOut, markedIds, normaliseChecks, normalisePreview } from '@/lib/hod-publish';

/* Four HOD fixes that need a database change (owner, 26 Nov 2026: "finish all tasks fixes"). The owner pastes the SQL,
   so every screen must keep working on the OLD function shape too. Each fix is tested both ways: with the new fields,
   and with the answer the database gives before the paste. The SQL cannot run in CI (no database), so its
   load-bearing lines are pinned from the migration files. */

const migration = (name: string) =>
  readFileSync(`supabase/migrations/${name}`, 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

const q = (over: Record<string, unknown>) => ({ id: `q${String(over.ord)}`, kind: 'question', state: 'passed', body: 'Words', version: 1, ...over });

const CHECKS_OLD = [
  { key: 'questions_checked', label: 'Every question is checked', ok: false, detail: '1 question checked by the AI only.', ai_only: 1 },
  { key: 'pictures_present', label: 'Pictures are in place', ok: true, detail: '' },
  { key: 'header_complete', label: 'Paper details are complete', ok: true, detail: '' },
  { key: 'scanner_junk_gone', label: 'No scanner junk left', ok: true, detail: '' },
];
const CHECKS_NEW = CHECKS_OLD.map((c) => (c.key === 'questions_checked' ? { ...c, ai_only_ids: ['q2'] } : c));

/** The preview as the database sends it: `fresh` = after the paste (new keys), otherwise the old shape. */
function previewOf(fresh: boolean) {
  const extra = (o: Record<string, unknown>) => (fresh ? o : {});
  return normalisePreview({
    paper: {
      audit_paper_id: 'p1',
      title: 'Physics',
      approval_state: 'awaiting',
      kind: 'new',
      is_live: false,
      page_count: 4,
      header: { school: 'A School', cls: 'X', subject: 'Physics', board: 'ICSE', year: '2024' },
      ...extra({ leave_out_any: true }),
    },
    questions: [
      q({ ord: 1, display_number: '1', review_bucket: 'kid', body: 'State Ohm law.' }),
      q({ ord: 2, display_number: '2', review_bucket: 'kid', body: 'Define power.', ...extra({ alternative_group: 'g2', alternative_label: 'Either' }) }),
      q({ ord: 3, display_number: '2', review_bucket: 'kid', body: 'Define work.', ...extra({ alternative_group: 'g2', alternative_label: 'Or' }) }),
      q({ ord: 4, display_number: '3', review_bucket: 'escalated', state: 'open', body: 'Sent up by a student.' }),
    ],
    counts: { total: 4, passed: 3, open: 1, set_aside: 0 },
    pages: [],
    checks: fresh ? CHECKS_NEW : CHECKS_OLD,
  });
}

const sheet = (fresh: boolean) =>
  renderToStaticMarkup(
    <MemoryRouter>
      <PaperSheet preview={previewOf(fresh)} api={createFakeHodApi()} editable onChanged={() => undefined} />
    </MemoryRouter>,
  );

// ------------------------------------------------------------------ 1. OR lines

describe('1. OR lines between choices in the go-live preview', () => {
  const sql = migration('20261126320000_hod_preview_or_lines.sql');

  it('the preview function sends the OR group and label of every question, and the leave-out flag', () => {
    expect(sql).toContain("'alternative_group', q.alternative_group,");
    expect(sql).toContain("'alternative_label', q.alternative_label");
    expect(sql).toContain("'leave_out_any', v_p.approval_state is not distinct from 'awaiting'");
  });

  it('keeps the doors: HOD only inside, closed to visitors, open to signed-in people only', () => {
    expect(sql).toContain('security definer');
    expect(sql).toContain('set search_path = public, pg_temp');
    expect(sql).toContain('if not public.is_hod() then');
    expect(sql).toContain("using errcode = '42501'");
    expect(sql).toContain('revoke all on function public.hod_paper_preview(uuid) from public, anon, authenticated;');
    expect(sql).toContain('grant execute on function public.hod_paper_preview(uuid) to authenticated;');
    // The live Maths copies stay frozen.
    expect(sql).toContain("if v_p.source = 'live_copy' then");
  });

  it('after the paste, draws one OR between the two choices and shows the paper\'s own word for each', () => {
    const html = sheet(true);
    expect(html.match(/>OR</g)?.length).toBe(1);
    // Question words are drawn through the page's text cipher, so the rows are found by their ids.
    expect(html.indexOf('id="q-q2"')).toBeLessThan(html.indexOf('>OR<'));
    expect(html.indexOf('>OR<')).toBeLessThan(html.indexOf('id="q-q3"'));
    expect(html).toMatch(/data-testid="paper-question-meta">Either</);
    expect(previewOf(true).questions[1].alternative_label).toBe('Either');
  });

  it('before the paste (old shape), draws no OR line and does not fail', () => {
    const html = sheet(false);
    expect(html).not.toContain('>OR<');
    expect(html).toContain('id="q-q3"');
    expect(html).not.toContain('paper-question-meta');
  });
});

// ------------------------------------------------------------ 2. AI-only questions

describe('2. Questions checked by the AI only are marked and can be shown', () => {
  const sql = migration('20261126310000_hod_checks_ai_only_ids.sql');

  it('the checks function lists the ids from the same query that counts them, and stays internal', () => {
    expect(sql).toContain("select count(*), coalesce(array_agg(q.id order by q.ord, q.id), '{}'::uuid[]) into v_ai_only, v_ai_only_ids");
    expect(sql).toContain("'ai_only_ids', to_jsonb(v_ai_only_ids)");
    expect(sql).toContain('and not public.approval_person_verdict(q.id, q.checked_by_user);');
    expect(sql).toContain('revoke all on function public.approval_paper_checks(uuid) from public, anon, authenticated;');
    expect(sql).not.toMatch(/grant execute on function public\.approval_paper_checks/);
  });

  it('keeps the old keys and the same pass rule', () => {
    expect(sql).toContain("'left_out', v_aside, 'open', v_open_eff, 'ai_only', v_ai_only,");
    expect(sql).toContain("'ok', v_total > 0 and v_open_eff = 0 and v_passed > 0, 'detail', v_d1,");
  });

  it('after the paste, each AI-only question carries a mark and Show me walks through them', () => {
    const p = previewOf(true);
    expect(aiOnlyIds(p.checks)).toEqual(['q2']);
    expect(p.questions.find((x) => x.id === 'q2')?.ai_only).toBe(true);
    expect(markedIds('ai_only', p.questions)).toEqual(['q2']);
    expect(sheet(true).match(/data-testid="ai-only-chip"/g)?.length).toBe(1);
    expect(aiOnlyText(1, true)).toBe(
      '1 question was passed by the AI with no person checking. It is marked "AI only" on the paper. Leave it out, or use Publish anyway if the paper cannot wait.',
    );
  });

  it('before the paste, only the count is known: no marks, and the old words', () => {
    const p = previewOf(false);
    expect(aiOnlyIds(p.checks)).toBeNull();
    expect(markedIds('ai_only', p.questions)).toEqual([]);
    expect(sheet(false)).not.toContain('ai-only-chip');
    expect(aiOnlyText(1, false)).toContain('This screen cannot point to it yet.');
  });

  it('an empty list is read as "none", not as "not known"', () => {
    const [c] = normaliseChecks([{ ...CHECKS_OLD[0], ai_only: 0, ai_only_ids: [] }]);
    expect(c.ai_only_ids).toEqual([]);
  });

  it('the check links to them, and the red chip goes there when nothing is open', () => {
    const src = readFileSync('src/components/hod/PublishFlow.tsx', 'utf8');
    expect(src).toContain("onClick={() => showMarked('ai_only')}");
    expect(src).toContain('Show me the questions checked by the AI only');
    expect(src).toContain("else if (key === 'questions_checked' && ids('ai_only').length > 0) void showMarked('ai_only');");
  });
});

// ------------------------------------------------------------ 3. Leave it out on every question

describe('3. Leave it out on every question of a paper waiting to go live', () => {
  const sql = migration('20261126300000_hod_leave_out_any_question.sql');

  it('the server accepts set aside on any question of a waiting paper, with a note, before the old bucket rule', () => {
    expect(sql).toContain("if p_state = 'set_aside' and v_approval = 'awaiting' then");
    expect(sql).toContain("raise exception 'Say why the question is left out.' using errcode = '22023';");
    expect(sql.indexOf("v_approval = 'awaiting'")).toBeLessThan(sql.indexOf("v_q.review_bucket not in ('escalated', 'admin')"));
    // Same logged path as before: content_checks + audit_review_log via approval_set_question_state.
    expect(sql.match(/return public\.approval_set_question_state\(p_question_id, p_state, p_note\);/g)?.length).toBe(2);
  });

  it('keeps pass on the old rule and the doors', () => {
    expect(sql).toContain("if p_state in ('pass', 'set_aside')");
    expect(sql).toContain("raise exception 'This question is still with the student checkers.' using errcode = '55000';");
    expect(sql).toContain('if not public.is_hod() then');
    expect(sql).toContain('revoke all on function public.hod_set_question_state(uuid, text, text) from public, anon, authenticated;');
    expect(sql).toContain('grant execute on function public.hod_set_question_state(uuid, text, text) to authenticated;');
  });

  it('the publish confirmation for left-out questions is untouched', () => {
    const src = readFileSync('src/components/hod/PublishFlow.tsx', 'utf8');
    expect(src).toContain('api.approvePaper(paperId, note, leftOutCount > 0 ? confirmedLeftOut : undefined)');
  });

  it('after the paste, every question that is not left out gets the button', () => {
    expect(canLeaveOut({ review_bucket: 'kid', state: 'passed' }, true)).toBe(true);
    expect(canLeaveOut({ review_bucket: null, state: 'open' }, true)).toBe(true);
    expect(canLeaveOut({ review_bucket: 'kid', state: 'set_aside' }, true)).toBe(false);
    const html = sheet(true);
    for (const n of ['1', '2', '3']) expect(html).toContain(`aria-label="Leave question ${n} out"`);
  });

  it('before the paste, only questions that came to the HOD get it (the old rule)', () => {
    expect(previewOf(false).paper.leave_out_any).toBe(false);
    const html = sheet(false);
    expect(html).not.toContain('aria-label="Leave question 1 out"');
    expect(html).toContain('aria-label="Leave question 3 out"');
  });
});

// ------------------------------------------------------------ 4. Full hand-out reasons

describe('4. Auto assign says the full reason a paper or checker got nothing', () => {
  const sql = migration('20261126330000_hod_handout_reasons.sql');

  it('is a read-only HOD function, closed to visitors, open to signed-in people only', () => {
    expect(sql).toContain('create or replace function public.hod_handout_reasons(p_paper_ids uuid[])');
    expect(sql).toContain('stable');
    expect(sql).toContain('security definer');
    expect(sql).toContain("set search_path to 'public', 'pg_temp'");
    expect(sql).toContain("raise exception 'Only HODs and admins can use this.' using errcode = '42501';");
    expect(sql).toContain('revoke all on function public.hod_handout_reasons(uuid[]) from public, anon, authenticated;');
    expect(sql).toContain('grant execute on function public.hod_handout_reasons(uuid[]) to authenticated;');
    expect(sql).not.toMatch(/\b(insert into|update public\.|delete from|create temp|truncate)\b/i);
  });

  it('is bounded: at most 200 papers, and the costly work check runs only for a checker at the limit', () => {
    expect(sql).toContain('limit 200');
    expect(sql).toMatch(/a\.status in \('queued', 'assigned'\)\) < v_cap\s+then false\s+else \(select count\(\*\)/);
  });

  it('uses the hand-out\'s own rules, including the two the screen cannot see', () => {
    expect(sql).toContain('d.school is not distinct from p.school_a');
    expect(sql).toContain("public.school_norm(ap.publish_meta ->> 'school')");
    expect(sql).toContain("x.status = 'returned' and x.closed_reason like 'nothing done for %'");
    expect(sql).toContain('make_interval(days => v_idle)');
    expect(sql).toContain('coalesce(vp.grade, 12)');
    expect(sql).toContain('not exists (select 1 from public.admins ad where ad.id = pc.user_id)');
  });

  const people = [{ user_id: 'a' }, { user_id: 'b' }, { user_id: 'c' }];
  const profiles = people.map((p) => ({ user_id: p.user_id, grade: 12, expired: false, preferred_subjects: ['Physics'] }));
  const server = normaliseHandoutReasons({
    papers: [
      { paper_id: 'p1', reason: 'own_school' },
      { paper_id: 'p2', reason: 'own_school' },
      { paper_id: 'p3', reason: 'let_it_sit' },
      { paper_id: 'p4', reason: 'something new' },
    ],
    checkers: [
      { user_id: 'a', reason: 'own_school' },
      { user_id: 'b', reason: 'let_it_sit' },
      { user_id: 'c', reason: 'full' },
      { user_id: 'zz', reason: 'full' },
    ],
    cap: 10,
    idle_days: 7,
  });

  it('after the paste, every paper and checker gets its real reason', () => {
    expect(server?.papers[3].reason).toBe('other');
    const why = explainLeftovers({ server, leftPapers: [{ grade: 9 }, { grade: 9 }, { grade: 9 }, { grade: 9 }], people, profiles, held: [], gotSome: [] });
    expect(why.lines).toEqual([
      "2 papers: every checker who could take them is at the paper's own school, and nobody checks a paper from their own school.",
      '1 paper: the checkers who could take it let it sit for 7 days before, so it is not given back to them yet.',
      '1 paper: a checker could take it now. Press Auto assign all again.',
      '1 checker already holds 10 papers with work, the most anyone can hold.',
      '1 checker got nothing because every paper left that suits their class is from their own school.',
      '1 checker got nothing because they let the papers left that suit them sit for 7 days before.',
    ]);
    expect(why.lines.join(' ')).not.toContain('no rule we can see');
    const o = summariseAutoAssign({ gave: 0, perPerson: [], left: 4, why });
    expect(o.lines).toEqual(expect.arrayContaining([why.lines[0]]));
  });

  it('before the paste (no answer), the old words come back unchanged', () => {
    const why = explainLeftovers({ server: null, leftPapers: [{ grade: 9 }], people, profiles, held: [], gotSome: [] });
    expect(why.lines[0]).toContain('no rule we can see here stops it');
  });

  it('a wrong-shaped answer is ignored rather than trusted', () => {
    expect(normaliseHandoutReasons(null)).toBeNull();
    expect(normaliseHandoutReasons([])).toBeNull();
    expect(normaliseHandoutReasons({ papers: [] })).toBeNull();
  });

  it('the screen asks the database, and falls back on any failure', async () => {
    const src = readFileSync('src/components/hod/AssignmentsTab.tsx', 'utf8');
    expect(src).toContain('await api.handoutReasons(leftShown.map((p) => p.paper_id)).catch(() => null)');
    expect(src).toContain('why = explainLeftovers({\n          server,');
    // A server without the function answers null (not an error), so the old message shows.
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
    await expect(realHodApi.handoutReasons(['p1'])).resolves.toBeNull();
    rpc.mockResolvedValueOnce({ data: { papers: [{ paper_id: 'p1', reason: 'grade' }], checkers: [], cap: 10, idle_days: 7 }, error: null });
    await expect(realHodApi.handoutReasons(['p1'])).resolves.toEqual({ papers: [{ paper_id: 'p1', reason: 'grade' }], checkers: [], cap: 10, idleDays: 7 });
    expect(rpc).toHaveBeenLastCalledWith('hod_handout_reasons', { p_paper_ids: ['p1'] });
  });
});

// ------------------------------------------------------------ the fake desk follows the new rule

describe('the go-live fake follows the new leave-out rule', () => {
  it('flags leave_out_any only for a paper waiting to go live', async () => {
    const api = createFakeHodApi();
    const ready = await api.readyPapers();
    if (ready.length === 0) return;
    const p = await api.paperPreview(ready[0].audit_paper_id);
    expect(p.paper.leave_out_any).toBe(p.paper.approval_state === 'awaiting');
  });
});
