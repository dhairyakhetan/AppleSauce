import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: vi.fn(), from: vi.fn(), storage: { from: vi.fn() }, auth: { getSession: vi.fn(), onAuthStateChange: vi.fn() } },
}));

import { HandOutCard, OutcomePanel } from '@/components/hod/AssignmentsTab';
import { WaitingForPapersView } from '@/components/hod/WaitingForPapers';
import { givenByLine } from '@/components/hod/WhoHasWhat';
import { SettledLine, undoNote } from '@/components/hod/NeedsYouTab';
import { HodConfirmBox } from '@/components/hod/HodConfirm';
import { AttentionGroup } from '@/components/PaperStatus';
import { autoAssignOffReason, explainLeftovers, summariseAutoAssign, CHECKERS_LINK } from '@/lib/hod-bulk-assign';
import { tabBadge, tabBadgeLabel, tabBadgeText } from '@/lib/hod-tabs';
import { buildMainStops, fetchHandOut, normaliseRoute } from '@/lib/pipeline-route';
import { supabase } from '@/integrations/supabase/client';
import { EXAMPLE_ROUTE_RAW } from '@/lib/pipeline-route.fixture';
import { SLOW_ACTION_WORDS } from '@/lib/checker-timeout';

/* HOD desk, 26 Nov 2026 (owner approved): Auto assign all up front, and no false or risky messages. Rendered to
   markup in node (no DOM), with source-text checks for the wiring, as the other HOD tests do. */

const read = (p: string) => readFileSync(p, 'utf8');
const noop = () => {};

describe('B1, B2, B4: the hand-out card at the top of Assignments', () => {
  const card = (over: Partial<Parameters<typeof HandOutCard>[0]> = {}) =>
    renderToStaticMarkup(
      <HandOutCard
        gate="ready"
        count={12}
        capped={false}
        busy={false}
        giving={false}
        onAutoAssign={noop}
        failure={null}
        onDismissFailure={noop}
        outcome={null}
        onDismissOutcome={noop}
        {...over}
      />,
    );

  it('says how many papers wait to be handed out, with the button beside it', () => {
    const out = card();
    expect(out).toContain('12</span> papers waiting to be handed out');
    expect(out).toContain('Auto assign all');
    expect(out).not.toMatch(/data-testid="auto-assign-all"[^>]*disabled/);
    expect(out).not.toContain('auto-assign-off');
  });

  it('reads 200+ when the list is longer than the screen asks for, and 1 paper in the singular', () => {
    expect(card({ count: 201, capped: true })).toContain('200+</span> papers waiting');
    expect(card({ count: 1 })).toContain('1</span> paper waiting');
  });

  it('is switched off, with the reason shown, while loading, on a failed count and at 0', () => {
    for (const [gate, count] of [
      ['loading', 0],
      ['error', 0],
      ['ready', 0],
    ] as const) {
      const out = card({ gate, count });
      expect(out).toMatch(/<button[^>]*disabled=""[^>]*data-testid="auto-assign-all"|<button[^>]*data-testid="auto-assign-all"[^>]*disabled=""/);
      expect(out).toContain('data-testid="auto-assign-off"');
      expect(out).toContain('aria-describedby="auto-assign-off"');
      expect(out).toContain(autoAssignOffReason(gate, count) as string);
    }
    expect(autoAssignOffReason('ready', 3)).toBeNull();
  });

  it('shows a failure right under the button, as an alert, with a 44 px Dismiss', () => {
    const out = card({ failure: 'That did not work. Try again.' });
    const button = out.indexOf('data-testid="auto-assign-all"');
    const failure = out.indexOf('data-testid="auto-assign-failure"');
    expect(failure).toBeGreaterThan(button);
    expect(out).toContain('role="alert"');
    expect(out).toMatch(/tap-44 inline-flex min-h-11[^"]*">Dismiss/);
  });

  it('sits first on the tab, before Needs attention, Waiting for papers and the lists', () => {
    const src = read('src/components/hod/AssignmentsTab.tsx');
    const top = src.indexOf('<HandOutCard');
    expect(top).toBeGreaterThan(-1);
    expect(src.indexOf('<AttentionGroup')).toBeGreaterThan(top);
    expect(src.indexOf('<WaitingForPapers ')).toBeGreaterThan(top);
    expect(src.indexOf('aria-labelledby="who-has-what"')).toBeGreaterThan(top);
    // Only one Auto assign all button now.
    expect(src.match(/onAutoAssign=\{/g)?.length).toBe(1);
    expect(src).not.toMatch(/onClick=\{\(\) => void autoAssignAll\(\)\}/);
  });

  it('a failed Auto assign also pops up a message, not only a banner', () => {
    const src = read('src/components/hod/AssignmentsTab.tsx');
    const run = src.slice(src.indexOf('async function autoAssignAll'), src.indexOf('function giveTo'));
    expect(run).toContain('setAutoFailure(reason)');
    expect(run).toContain('toast.error(reason');
  });
});

describe('B1: the number on the Assignments tab', () => {
  it('is the count of papers waiting to be handed out, 200+ past the cap', () => {
    expect(tabBadge('assignments', null, 0, 7)).toBe(7);
    expect(tabBadge('assignments', null)).toBe(0);
    expect(tabBadgeText('assignments', 201)).toBe('200+');
    expect(tabBadgeText('needs-you', 204)).toBe('204');
    expect(tabBadgeLabel('assignments', null, 0, 1)).toBe('1 paper waiting to be handed out');
    expect(tabBadgeLabel('assignments', null, 0, 201)).toBe('200+ papers waiting to be handed out');
  });

  it('reads the same list (and key) as the strip and the tab, so it costs no extra call', () => {
    const src = read('src/pages/Hod.tsx');
    expect(src).toContain('queryKey: UNASSIGNED_KEY(scope)');
    expect(src).toContain("const badge = t.key === 'assignments' ? freePapers : tabBadge(t.key, countsQ.data, requestsWaiting);");
    expect(src).toContain('tabBadgeText(t.key, shown)');
  });
});

describe('B3: why papers or people got nothing', () => {
  const profile = (user_id: string, over: Partial<{ grade: number | null; expired: boolean; preferred_subjects: string[] }> = {}) => ({
    user_id,
    grade: 12 as number | null,
    expired: false,
    preferred_subjects: ['Physics'],
    ...over,
  });

  it('counts papers blocked because everyone is full at 10', () => {
    const held = Array.from({ length: 10 }, () => ({ user_id: 'a', remaining: 5 }));
    const why = explainLeftovers({ leftPapers: [{ grade: 9 }, { grade: 10 }], people: [{ user_id: 'a' }], profiles: [profile('a')], held, gotSome: [] });
    expect(why.lines[0]).toBe('2 papers: every checker who can take papers already holds 10 papers with work, the most anyone can hold.');
    expect(why.lines).toContain('1 checker already holds 10 papers with work, the most anyone can hold.');
  });

  it('counts papers above every grade, and people below every paper left', () => {
    const why = explainLeftovers({
      leftPapers: [{ grade: 12 }],
      people: [{ user_id: 'a' }, { user_id: 'b' }],
      profiles: [profile('a', { grade: 9 }), profile('b', { grade: 10 })],
      held: [],
      gotSome: [],
    });
    expect(why.lines).toContain('1 paper: the class is above the grade of every checker who has room.');
    expect(why.lines).toContain('2 checkers are below the class of every paper left.');
  });

  it('names expired details and links to Checkers', () => {
    const why = explainLeftovers({ leftPapers: [{ grade: 8 }], people: [{ user_id: 'a' }], profiles: [profile('a', { expired: true })], held: [], gotSome: [] });
    expect(why.lines[0]).toContain('no checker can take papers right now');
    expect(why.lines).toContain('1 checker got nothing because their details have expired. Update them on Checkers.');
    expect(why.fixOnCheckers).toBe(true);
    const o = summariseAutoAssign({ gave: 0, perPerson: [], left: 1, why });
    expect(o.link).toEqual({ ...CHECKERS_LINK });
    const out = renderToStaticMarkup(
      <MemoryRouter>
        <OutcomePanel outcome={o} onDismiss={noop} />
      </MemoryRouter>,
    );
    expect(out).toContain('href="/hod?tab=verifiers"');
    expect(out).toContain('Open Checkers to fix their details');
  });

  it('says subjects not set, honestly: it does not stop papers', () => {
    const why = explainLeftovers({ leftPapers: [], people: [{ user_id: 'a' }], profiles: [profile('a', { preferred_subjects: [] })], held: [], gotSome: [] });
    expect(why.lines).toContain('1 checker got nothing because no paper was left to give.');
    expect(why.lines.join(' ')).toContain('no subjects set. That does not stop papers');
  });

  it('never guesses: a paper blocked only by rules the screen cannot see is said so', () => {
    const why = explainLeftovers({ leftPapers: [{ grade: 8 }], people: [{ user_id: 'a' }], profiles: [profile('a')], held: [], gotSome: ['a'] });
    expect(why.lines).toEqual([
      '1 paper: no rule we can see here stops it. The hand-out also keeps a paper from a checker at its own school, and from one who let it sit for 7 days.',
    ]);
  });

  it('says so when the details did not load, instead of inventing reasons', () => {
    const why = explainLeftovers({ leftPapers: [], people: [{ user_id: 'a' }], profiles: null, held: [], gotSome: [] });
    expect(why.lines).toEqual(['The details of the checkers did not load, so why each person got nothing is not shown.']);
  });

  it('the tab works it out from the lists it already holds (no new call)', () => {
    const src = read('src/components/hod/AssignmentsTab.tsx');
    expect(src).toContain('why = explainLeftovers({');
    expect(src).toContain('summariseAutoAssign({ gave, perPerson, left, leftIsAtLeast, why })');
  });
});

describe('B5: Waiting for papers', () => {
  const ask = { ask_id: 'a1', user_id: 'u1', name: 'Rohan Verma', asked_at: null, finished_recently: 0 };

  it('offers "Give papers to <name>" when the tab can pick the person', () => {
    const out = renderToStaticMarkup(<WaitingForPapersView state={{ kind: 'list', asks: [ask] }} onDismiss={noop} onRetry={noop} onGive={noop} />);
    expect(out).toContain('Give papers to Rohan Verma');
    expect(renderToStaticMarkup(<WaitingForPapersView state={{ kind: 'list', asks: [ask] }} onDismiss={noop} onRetry={noop} />)).not.toContain('Give papers to');
  });

  it('a failed clear never blames the connection', () => {
    const src = read('src/components/hod/WaitingForPapers.tsx');
    expect(src).not.toContain('Check your connection');
    expect(src).toContain('setProblem(SLOW_ACTION_WORDS)');
    expect(SLOW_ACTION_WORDS).not.toMatch(/connection/i);
  });

  it('the tab picks the person in the assign bar and brings the list into view', () => {
    const src = read('src/components/hod/AssignmentsTab.tsx');
    expect(src).toContain('<WaitingForPapers api={asksApi} scope={scope} onGive={giveTo} />');
    const give = src.slice(src.indexOf('function giveTo'), src.indexOf('async function bulkAssign'));
    expect(give).toContain('setBulkTarget(userId)');
    expect(give).toContain("getElementById('papers-nobody-has')");
  });
});

describe('B6: the Auto assign confirm box', () => {
  it('no longer promises a one-tap take back, and says Cancel', () => {
    const src = read('src/components/hod/AssignmentsTab.tsx');
    expect(src).not.toContain('one tap on its row');
    expect(src).toContain('open it under Who has what and press Unassign');
    expect(src).toContain("cancelLabel: 'Cancel'");
  });

  it('confirms in the normal orange, and keeps the pale red only for taking away', () => {
    // The dialog is a portal and draws nothing on the server; its button classes are checked in the source.
    const src = read('src/components/hod/HodConfirm.tsx');
    expect(src).toContain("export const HOD_CONFIRM_BRAND = 'bg-brand text-foreground shadow-solid");
    expect(src).toContain("className={(options?.tone ?? 'brand') === 'brand' ? HOD_CONFIRM_BRAND : undefined}");
    expect(src).toContain("{options?.cancelLabel ?? 'Cancel'}");
    expect(renderToStaticMarkup(<HodConfirmBox options={null} onAnswer={noop} />)).toBe('');
    expect(read('src/components/hod/AssignmentsTab.tsx')).toMatch(/confirmLabel: 'Unassign',\s+tone: 'danger'/);
  });
});

describe('B7: who gave a paper', () => {
  it('says Auto assign all, never "automatically"', () => {
    expect(givenByLine('Automatic')).toBe('Given by Auto assign all');
    expect(givenByLine(null)).toBe('Given by Auto assign all');
    expect(givenByLine('Asha')).toBe('Given by Asha');
    expect(read('src/components/hod/WhoHasWhat.tsx')).not.toContain('Given automatically');
  });
});

describe('B8: the pipeline page', () => {
  const stops = (handOut?: { papers: number; capped: boolean } | null) =>
    Object.fromEntries(buildMainStops({ ...normaliseRoute(EXAMPLE_ROUTE_RAW), handOut }, 'hod').map((s) => [s.id, s]));

  it('Checking by students shows how many wait for you to hand out, and links to that list', () => {
    const s = stops({ papers: 14, capped: false }).students;
    expect(s.figures).toContainEqual({ label: 'Waiting for you to hand out', value: '14 papers' });
    expect(s.action).toMatchObject({ kind: 'link', href: '/hod?tab=assignments&stage=ready' });
    expect(stops({ papers: 200, capped: true }).students.figures).toContainEqual({ label: 'Waiting for you to hand out', value: '200+ papers' });
  });

  it('reads the count from the desk list itself: 200+ past the cap, null (shown as "?") on any failure', async () => {
    const rpc = supabase.rpc as unknown as ReturnType<typeof vi.fn>;
    rpc.mockResolvedValueOnce({ data: [{}, {}], error: null });
    expect(await fetchHandOut()).toEqual({ papers: 2, capped: false });
    expect(rpc).toHaveBeenLastCalledWith('hod_unassigned_papers', { p_limit: 201 });
    rpc.mockResolvedValueOnce({ data: Array.from({ length: 201 }, () => ({})), error: null });
    expect(await fetchHandOut()).toEqual({ papers: 200, capped: true });
    rpc.mockResolvedValueOnce({ data: null, error: { code: '42501' } });
    expect(await fetchHandOut()).toBeNull();
    rpc.mockRejectedValueOnce(new Error('offline'));
    expect(await fetchHandOut()).toBeNull();
  });

  it('a count that did not load is "?", never 0', () => {
    expect(stops(null).students.figures).toContainEqual({ label: 'Waiting for you to hand out', value: '?' });
    expect(stops(undefined).students.figures).toContainEqual({ label: 'Waiting for you to hand out', value: '?' });
  });

  it('no longer says questions go to students "first", as if by themselves', () => {
    const meaning = stops(null).students.meaning;
    expect(meaning).not.toMatch(/first/);
    expect(meaning).toContain('once an HOD hands their paper out');
  });
});

describe('A1: no false "nothing is waiting" while offline', () => {
  it('the six screens wait for an answer with loadGate, not isLoading', () => {
    for (const f of ['NeedsYouTab', 'SendToAiTab', 'LiveTab', 'UploadsTab', 'VerifiersTab', 'HistoryTab']) {
      const src = read(`src/components/hod/${f}.tsx`);
      expect(src, f).not.toMatch(/\.isLoading\b/);
    }
    expect(read('src/lib/hod-desk.ts')).not.toMatch(/s\.isLoading/);
  });
});

describe('A2 and A3: Needs you is honest about live papers and Undo', () => {
  const src = read('src/components/hod/NeedsYouTab.tsx');

  it('on a live paper Pass asks first, saying it goes on the site now', () => {
    expect(src).toContain("goesLiveOnPass ? setPanel('golive')");
    expect(src).toContain('This goes on the site now.');
    expect(src).toContain("'Pass, put it on the site'");
  });

  it('on a live paper there is no Set aside and no Undo (the server refuses both)', () => {
    expect(src).toMatch(/\{paperLive \? null : \(\s*<button type="button" className=\{quietButton\} disabled=\{busy\} onClick=\{\(\) => setPanel\('aside'\)\}>/);
    const out = renderToStaticMarkup(<SettledLine s={{ what: 'Question 3 passed.', undo: 'none-live' }} busy={false} onUndo={noop} />);
    expect(out).not.toContain('Undo</button>');
    expect(out).toContain('It is on the site now.');
  });

  it('after a send back there is no Undo, and it says why', () => {
    const out = renderToStaticMarkup(<SettledLine s={{ what: 'Question 3 sent back to the students.', undo: 'none-with-students' }} busy={false} onUndo={noop} />);
    expect(out).not.toContain('>Undo<');
    expect(out).toContain('It is with the students now');
    expect(src).toContain("`Question ${label} sent back to the students.`, 'none-with-students'");
  });

  it('after a Fix, Undo says the word changes stay', () => {
    expect(undoNote('reopen-words-stay')).toBe('Undo puts it back in the list, but your word changes stay. Fix them again if needed.');
    const out = renderToStaticMarkup(<SettledLine s={{ what: 'Question 3 fixed and passed.', undo: 'reopen-words-stay' }} busy={false} onUndo={noop} />);
    expect(out).toContain('>Undo<');
    expect(out).toContain('your word changes stay');
    expect(undoNote('reopen')).toBeNull();
  });
});

describe('A4: Needs attention', () => {
  const items = Array.from({ length: 8 }, (_, i) => ({ key: `stuck-${i}`, stage: 'checking' as const, label: `Paper ${i}`, reason: 'Nothing done for 9 days.' }));

  it('each item opens its paper, and the "more" line is a real button', () => {
    const out = renderToStaticMarkup(<AttentionGroup id="x" items={items} onOpen={noop} onMore={noop} moreLabel="See all 8 stuck papers in Who has what" />);
    expect(out.match(/data-testid="attention-open"/g)?.length).toBe(6);
    expect(out).toContain('aria-label="Open Paper 0"');
    expect(out).toMatch(/<button[^>]*data-testid="attention-more"[^>]*>See all 8 stuck papers in Who has what<\/button>/);
  });

  it('without handlers it reads as before (Ready to go live still uses it that way)', () => {
    const out = renderToStaticMarkup(<AttentionGroup id="x" items={items} />);
    expect(out).not.toContain('attention-open');
    expect(out).toContain('and 2 more below');
  });

  it('on Assignments it lists only papers checkers are stuck on', () => {
    const src = read('src/components/hod/AssignmentsTab.tsx');
    const block = src.slice(src.indexOf('const stuckRows'), src.indexOf('const openAttention'));
    expect(block).toContain('stuckReason(a, lookup, now) !== null');
    expect(block).not.toContain('waitingForHodReason');
    expect(block).not.toContain('heldQ');
    expect(src).toContain("setWhoRequest({ kind: 'stuck', n: Date.now() })");
  });
});

describe('A5, A6, A7', () => {
  it('A5: the Not ready list says when it stopped at 200', () => {
    const src = read('src/components/hod/AssignmentsTab.tsx');
    expect(src).toContain('(heldQ.data ?? []).length >= UNASSIGNED_SHOWN ? (');
    expect(src).toContain('This list stops at the first {UNASSIGNED_SHOWN}.');
  });

  it('A6: the error banner Dismiss is a 44 px button, not a tiny underline', () => {
    const src = read('src/components/hod/AssignmentsTab.tsx');
    expect(src).toMatch(/onClick=\{\(\) => setRefusal\(null\)\} className=\{DISMISS\}/);
    expect(src).not.toContain('className="shrink-0 font-semibold underline"');
  });

  it('A7: the Live papers timeline uses the same key Hide, Restore and Edit refresh', () => {
    const src = read('src/components/hod/LiveTab.tsx');
    expect(src).toContain("queryKey={['hod', scope, 'timeline', p.audit_paper_id]}");
    expect(src).not.toContain("queryKey={['hod', 'timeline'");
    expect(read('src/lib/hod-refresh.ts')).toMatch(/case 'live':\s+return \{ now: \[k\('live'\), k\('counts'\), k\('timeline'\)\]/);
  });
});

describe('copy rules', () => {
  it('no em or en dashes in anything this change added', () => {
    for (const f of [
      'src/components/hod/AssignmentsTab.tsx',
      'src/components/hod/HodConfirm.tsx',
      'src/components/hod/NeedsYouTab.tsx',
      'src/components/hod/WaitingForPapers.tsx',
      'src/components/hod/WhoHasWhat.tsx',
      'src/lib/hod-bulk-assign.ts',
      'src/lib/hod-tabs.ts',
    ]) {
      expect(read(f), f).not.toMatch(/[–—]/);
    }
  });
});
