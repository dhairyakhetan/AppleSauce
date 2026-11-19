import { describe, expect, it } from 'vitest';
import type { HodAssignment } from '@/lib/hod-api';
import {
  DEFAULT_SORT,
  HEAVY_MIN_QUESTIONS,
  LIGHT_MAX_QUESTIONS,
  PAPERS_PAGE,
  PEOPLE_PAGE,
  applyView,
  buildPeople,
  loadViewState,
  matchesQuery,
  moreLabel,
  oldestText,
  personLine,
  saveViewState,
  sortPeople,
  summarise,
  toggleChip,
  viewStateKey,
  windowRows,
  type PaperFlags,
  type View,
} from '@/lib/who-has-what';

const NOW = new Date('2026-11-13T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

let nextId = 1;
function paper(user: string, name: string, over: Partial<HodAssignment> = {}): HodAssignment {
  const id = nextId++;
  return {
    assignment_id: id,
    status: 'assigned',
    user_id: user,
    checker_name: name,
    paper_id: `paper-${id}`,
    subject: 'History & Civics',
    school: 'Test School',
    cls: 'X',
    exam: 'Board',
    year: '2024',
    remaining: 10,
    given_by_name: 'Automatic',
    assigned_at: daysAgo(2),
    started_at: null,
    ...over,
  };
}

/** Flags come from a lookup by paper id, standing in for paper-status.ts. */
const flagsFrom = (stuck: string[] = [], waiting: string[] = []) => (a: HodAssignment): PaperFlags => ({
  stuck: stuck.includes(a.paper_id) ? 'stuck' : null,
  waiting: waiting.includes(a.paper_id) ? 'waiting' : null,
});
const none = flagsFrom();
const view = (over: Partial<View> = {}): View => ({ query: '', chips: [], sort: 'name', ...over });

describe('Who has what: the people and their totals', () => {
  const a1 = paper('u1', 'Asha', { remaining: 30, assigned_at: daysAgo(11) });
  const a2 = paper('u1', 'Asha', { remaining: 0, assigned_at: daysAgo(3) });
  const b1 = paper('u2', 'Bela', { remaining: 150 });
  const people = buildPeople([a1, a2, b1], [{ user_id: 'u3', name: 'Chitra', why: 'Their details have expired.' }], flagsFrom([a1.paper_id], [a2.paper_id]), NOW);

  it('adds up papers, questions left, the oldest hand-out and the flags', () => {
    const asha = people.find((p) => p.user_id === 'u1')!;
    expect(asha.paperCount).toBe(2);
    expect(asha.questionsLeft).toBe(30);
    expect(asha.oldestDays).toBe(11);
    expect(asha.stuckCount).toBe(1);
    expect(asha.waitingCount).toBe(1);
    // Stuck first, then waiting for an HOD.
    expect(asha.papers.map((p) => p.paper_id)).toEqual([a1.paper_id, a2.paper_id]);
  });

  it('a person with no paper is listed, with the reason', () => {
    const chitra = people.find((p) => p.user_id === 'u3')!;
    expect(chitra.idle).toBe(true);
    expect(chitra.why).toBe('Their details have expired.');
    expect(personLine(chitra)).toBe('No papers yet');
  });

  it('an idle person who also holds a paper is listed once, as a holder', () => {
    const again = buildPeople([b1], [{ user_id: 'u2', name: 'Bela', why: null }], none, NOW);
    expect(again).toHaveLength(1);
    expect(again[0].idle).toBe(false);
  });

  it('the totals add up', () => {
    expect(summarise(people)).toEqual({ people: 3, holding: 2, papers: 3, questionsLeft: 180, stuck: 1, waiting: 1 });
  });

  it('the one-line summary of a person reads in plain words', () => {
    const asha = people.find((p) => p.user_id === 'u1')!;
    expect(personLine(asha)).toBe('2 papers · 30 questions left · oldest given 11 days ago');
    expect(oldestText(0)).toBe('oldest given today');
    expect(oldestText(1)).toBe('oldest given 1 day ago');
    expect(oldestText(null)).toBeNull();
  });
});

describe('Who has what: sorting', () => {
  const people = buildPeople(
    [paper('u1', 'Asha', { remaining: 5, assigned_at: daysAgo(1) }), paper('u2', 'Bela', { remaining: 90, assigned_at: daysAgo(9) }), paper('u2', 'Bela', { remaining: 10 }), paper('u4', 'Dev', { remaining: 40, assigned_at: daysAgo(4) })],
    [{ user_id: 'u3', name: 'Chitra', why: null }],
    none,
    NOW,
  );
  const names = (sort: Parameters<typeof sortPeople>[1]) => sortPeople(people, sort).map((p) => p.name);

  it('most questions left first', () => expect(names('questions')).toEqual(['Bela', 'Dev', 'Asha', 'Chitra']));
  it('most papers first, ties by questions', () => expect(names('papers')).toEqual(['Bela', 'Dev', 'Asha', 'Chitra']));
  it('oldest hand-out first, people with no paper last', () => expect(names('oldest')).toEqual(['Bela', 'Dev', 'Asha', 'Chitra']));
  it('by name', () => expect(names('name')).toEqual(['Asha', 'Bela', 'Chitra', 'Dev']));
  it('the default is the heaviest load first', () => expect(DEFAULT_SORT).toBe('questions'));
  it('sorting never changes the list it was given', () => {
    const before = people.map((p) => p.name);
    sortPeople(people, 'name');
    expect(people.map((p) => p.name)).toEqual(before);
  });
});

describe('Who has what: search and filters', () => {
  const maths = paper('u1', 'Asha', { subject: 'Mathematics', cls: 'X', school: 'St Xavier', remaining: 120 });
  const hist = paper('u1', 'Asha', { subject: 'History & Civics', cls: 'VIII', school: 'Don Bosco', remaining: 4 });
  const eng = paper('u2', 'Bela', { subject: 'English Language', cls: 'X', school: 'La Martiniere', remaining: 8 });
  const people = buildPeople([maths, hist, eng], [{ user_id: 'u3', name: 'Chitra', why: null }], flagsFrom([hist.paper_id], [eng.paper_id]), NOW);
  const flags = flagsFrom([hist.paper_id], [eng.paper_id]);
  const run = (over: Partial<View>) => applyView(people, view(over), flags, NOW);

  it('matches every word typed, in any order', () => {
    expect(matchesQuery('Asha, Mathematics, Class X', 'class maths')).toBe(false);
    expect(matchesQuery('Asha, Mathematics, Class X', 'class math')).toBe(true);
    expect(matchesQuery('anything', '   ')).toBe(true);
  });

  it('a name search keeps all of that person’s papers', () => {
    const out = run({ query: 'asha' });
    expect(out.map((p) => p.name)).toEqual(['Asha']);
    expect(out[0].paperCount).toBe(2);
  });

  it('a paper search keeps only the matching papers and adds them up again', () => {
    const out = run({ query: 'don bosco' });
    expect(out).toHaveLength(1);
    expect(out[0].papers.map((p) => p.paper_id)).toEqual([hist.paper_id]);
    expect(out[0].questionsLeft).toBe(4);
    expect(out[0].paperCount).toBe(1);
  });

  it('a search with no match gives an empty list', () => expect(run({ query: 'zzz' })).toEqual([]));

  it('"Has stuck papers" keeps people with a stuck paper, showing only those papers', () => {
    const out = run({ chips: ['stuck'] });
    expect(out.map((p) => p.name)).toEqual(['Asha']);
    expect(out[0].papers.map((p) => p.paper_id)).toEqual([hist.paper_id]);
  });

  it('"Waiting for an HOD" keeps papers whose checker finished their part', () => {
    expect(run({ chips: ['waiting'] }).map((p) => p.name)).toEqual(['Bela']);
  });

  it('stuck and waiting together need both', () => expect(run({ chips: ['stuck', 'waiting'] })).toEqual([]));

  it('light and heavy load are worked out from questions left, and people with no paper are light', () => {
    expect(LIGHT_MAX_QUESTIONS).toBeLessThan(HEAVY_MIN_QUESTIONS);
    expect(run({ chips: ['heavy'] }).map((p) => p.name)).toEqual(['Asha']);
    expect(run({ chips: ['light'] }).map((p) => p.name)).toEqual(['Bela', 'Chitra']);
  });

  it('a stuck or waiting filter drops people with no paper; a name search keeps them', () => {
    expect(run({ chips: ['stuck'] }).some((p) => p.idle)).toBe(false);
    expect(run({ query: 'chitra' }).map((p) => p.name)).toEqual(['Chitra']);
  });

  it('light and heavy switch each other off; the others stay', () => {
    expect(toggleChip(['stuck'], 'light')).toEqual(['stuck', 'light']);
    expect(toggleChip(['stuck', 'light'], 'heavy')).toEqual(['stuck', 'heavy']);
    expect(toggleChip(['heavy'], 'heavy')).toEqual([]);
    expect(toggleChip(['light'], 'waiting')).toEqual(['light', 'waiting']);
  });
});

describe('Who has what: a long list, a page at a time', () => {
  const rows = Array.from({ length: 40 }, (_, i) => i);

  it('shows the first page and says how many are not shown', () => {
    const w = windowRows(rows, PEOPLE_PAGE);
    expect(w.visible).toHaveLength(25);
    expect(w.hidden).toBe(15);
    expect(windowRows(rows, 100)).toEqual({ visible: rows, hidden: 0 });
    expect(windowRows(rows, -3)).toEqual({ visible: [], hidden: 40 });
  });

  it('"Show more" never offers more than is left', () => {
    expect(moreLabel(15, PEOPLE_PAGE)).toBe('Show 15 more');
    expect(moreLabel(90, PEOPLE_PAGE)).toBe('Show 25 more');
    expect(PAPERS_PAGE).toBe(20);
  });

  it('works on thirty people and a hundred and thirty papers', () => {
    const list = Array.from({ length: 130 }, (_, i) => paper(`u${i % 30}`, `Person ${String(i % 30).padStart(2, '0')}`, { remaining: i % 17 }));
    const people = buildPeople(list, [], none, NOW);
    expect(people).toHaveLength(30);
    expect(summarise(people).papers).toBe(130);
    expect(applyView(people, view({ sort: 'questions' }), none, NOW)).toHaveLength(30);
  });
});

describe('Who has what: remembered choices', () => {
  const store = () => {
    const data = new Map<string, string>();
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  };

  it('saves and reads the sort and the opened people for one tab of the desk', () => {
    const s = store();
    saveViewState(s, 'real', { sort: 'papers', expanded: ['u1', 'u2'] });
    expect(loadViewState(s, 'real')).toEqual({ sort: 'papers', expanded: ['u1', 'u2'] });
    expect(loadViewState(s, 'dummy')).toEqual({ sort: DEFAULT_SORT, expanded: [] });
    expect(viewStateKey('real')).toContain('real');
  });

  it('broken or missing storage never throws and gives the defaults', () => {
    expect(loadViewState(null, 'x')).toEqual({ sort: DEFAULT_SORT, expanded: [] });
    const broken = { getItem: () => '{not json', setItem: () => { throw new Error('private window'); } };
    expect(loadViewState(broken, 'x')).toEqual({ sort: DEFAULT_SORT, expanded: [] });
    expect(() => saveViewState(broken, 'x', { sort: 'name', expanded: [] })).not.toThrow();
    expect(() => saveViewState(null, 'x', { sort: 'name', expanded: [] })).not.toThrow();
  });

  it('a stored sort that is not one of ours, or opened people that are not text, are ignored', () => {
    const s = { getItem: () => JSON.stringify({ sort: 'banana', expanded: ['u1', 7, null] }) };
    expect(loadViewState(s, 'x')).toEqual({ sort: DEFAULT_SORT, expanded: ['u1'] });
  });
});
