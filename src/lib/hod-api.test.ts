import { describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: vi.fn(), from: vi.fn(), storage: { from: vi.fn() }, auth: { getSession: vi.fn(), onAuthStateChange: vi.fn() } },
}));

import {
  groupByVerifier,
  memberName,
  normaliseAssignments,
  normaliseEscalation,
  normaliseEscalations,
  normaliseHistory,
  normaliseHods,
  normaliseTeam,
  normaliseUnassigned,
  normaliseVerifierProfiles,
  passRate,
  profileFlag,
  profileInputProblem,
  roleWord,
  sortProfiles,
  TEAM_COLUMNS,
} from '@/lib/hod-api';

describe('hod_escalations mapping', () => {
  const row = {
    id: 'q1',
    paper_id: 'p1',
    display_number: '4(ii)',
    marks: '3',
    version: 2,
    body: '  Solve   $x^2$  \n',
    options: [{ label: 'a', text: 'one' }],
    flag_reasons: ['ocr_junk', 7],
    page: 3,
    page_path: 'pages/p1/3.jpg',
    snippet_path: null,
    escalated_by_name: 'Asha',
    escalated_at: '2026-10-07T10:00:00Z',
    reason: 'I cannot read the words',
    subject: 'Mathematics',
    cls: 'X',
  };

  it('keeps the question words byte for byte', () => {
    expect(normaliseEscalation(row)?.body).toBe('  Solve   $x^2$  \n');
  });

  it('reads numbers, lists and the asker', () => {
    const e = normaliseEscalation(row)!;
    expect(e.marks).toBe(3);
    expect(e.version).toBe(2);
    expect(e.flag_reasons).toEqual(['ocr_junk']);
    expect(e.page).toBe(3);
    expect(e.page_path).toBe('pages/p1/3.jpg');
    expect(e.snippet_path).toBeNull();
    expect(e.escalated_by_name).toBe('Asha');
    expect(e.reason).toBe('I cannot read the words');
  });

  it('drops rows with no id or paper, and tolerates a non-array', () => {
    expect(normaliseEscalation({ paper_id: 'p' })).toBeNull();
    expect(normaliseEscalation({ id: 'q' })).toBeNull();
    expect(normaliseEscalations(null)).toEqual([]);
    expect(normaliseEscalations([row, {}, 'x'])).toHaveLength(1);
  });

  it('a question with no page and no snippet has neither path', () => {
    const e = normaliseEscalation({ id: 'q', paper_id: 'p', body: 'x', page: null })!;
    expect(e.page).toBeNull();
    expect(e.page_path).toBeNull();
    expect(e.snippet_path).toBeNull();
  });
});

describe('hod_team mapping', () => {
  const m = normaliseTeam([
    {
      user_id: 'u1',
      name: null,
      email: 'a@example.com',
      active: true,
      papers_held: '2',
      questions_waiting: 17,
      reviewed_today: 4,
      reviewed_7d: 30,
      reviewed_all: 100,
      papers_reviewed: 5,
      passed_as_is: 80,
      edited: 20,
      escalated: 3,
      skipped: 1,
      overturned: 2,
      last_active: '2026-10-07T09:00:00Z',
    },
    { name: 'no id' },
  ]);

  it('maps a row and drops the one with no user', () => {
    expect(m).toHaveLength(1);
    expect(m[0].papers_held).toBe(2);
    expect(m[0].questions_waiting).toBe(17);
    expect(m[0].reviewed_7d).toBe(30);
    expect(m[0].papers_reviewed).toBe(5);
    expect(m[0].overturned).toBe(2);
  });

  it('missing numbers become zero', () => {
    const [x] = normaliseTeam([{ user_id: 'u2' }]);
    expect(x.papers_held).toBe(0);
    expect(x.reviewed_all).toBe(0);
    expect(x.last_active).toBeNull();
  });

  it('names a person by name, else email, else a fallback', () => {
    expect(memberName(m[0])).toBe('a@example.com');
    expect(memberName({ name: 'Asha', email: null })).toBe('Asha');
    expect(memberName({ name: null, email: null })).toBe('Unnamed verifier');
  });

  it('works out the share passed as is', () => {
    expect(passRate(m[0])).toBe(80);
    expect(passRate({ passed_as_is: 0, edited: 0 })).toBeNull();
  });

  it('has the table columns in plain words, with no database names', () => {
    expect(TEAM_COLUMNS.map((c) => c.label)).toEqual([
      'Papers held',
      'Waiting',
      'Today',
      'Last 7 days',
      'All time',
      'Papers done',
      'Passed as is',
      'Fixed',
      'Sent to HOD',
      'Skipped',
      'Later corrected',
      'Last active',
    ]);
    expect(JSON.stringify(TEAM_COLUMNS)).not.toMatch(/[–—]|_id\b|rpc|audit_/i);
  });

  it('every column key is a real field of a team row', () => {
    for (const c of TEAM_COLUMNS) expect(Object.keys(m[0])).toContain(c.key);
  });
});

describe('assignments', () => {
  const list = normaliseAssignments([
    { assignment_id: 3, status: 'assigned', user_id: 'b', checker_name: 'Bela', paper_id: 'p3', remaining: 9 },
    { assignment_id: 1, status: 'assigned', user_id: 'a', checker_name: 'Asha', paper_id: 'p1', remaining: 5, given_by_name: 'Automatic' },
    { assignment_id: 2, status: 'assigned', user_id: 'a', checker_name: 'Asha', paper_id: 'p2', remaining: 12 },
    { status: 'assigned' },
  ]);

  it('drops a row with no verifier or paper', () => {
    expect(list).toHaveLength(3);
  });

  it('groups by verifier, every paper held whole, sorted by name', () => {
    const g = groupByVerifier(list);
    expect(g.map((x) => x.name)).toEqual(['Asha', 'Bela']);
    expect(g[0].papers.map((p) => p.paper_id)).toEqual(['p1', 'p2']);
    expect(g[1].papers).toHaveLength(1);
  });

  it('there is no queue: an old queued status reads as assigned', () => {
    const [x] = normaliseAssignments([{ assignment_id: 9, status: 'queued', user_id: 'a', paper_id: 'p' }]);
    expect(x.status).toBe('assigned');
  });

  it('reads the papers nobody holds', () => {
    const u = normaliseUnassigned([{ paper_id: 'p9', subject: 'Physics', open_count: '14' }, { subject: 'x' }]);
    expect(u).toHaveLength(1);
    expect(u[0].open_count).toBe(14);
    expect(u[0].cls).toBeNull();
  });
});

describe('hod_verifier_profiles mapping', () => {
  const list = normaliseVerifierProfiles([
    { user_id: 'u1', name: 'Zed', full_name: 'Zed Z', grade: 9, school: 'S', board: 'ICSE', valid_until: '2027-03-31', expired: false, missing: false, preferred_subjects: ['Maths'], requested_subjects: ['Physics', 3] },
    { user_id: 'u2', name: 'Amy', missing: true },
    { user_id: 'u3', name: 'Bo', grade: 7, expired: true },
    { user_id: 'u4', name: 'Cy', grade: 12, expired: false, missing: false },
    { name: 'no id' },
  ]);

  it('maps rows and drops the one with no user', () => {
    expect(list).toHaveLength(4);
    expect(list[0].requested_subjects).toEqual(['Physics']);
  });

  it('a grade outside 1 to 17 counts as missing, 13 to 17 are real grades', () => {
    expect(normaliseVerifierProfiles([{ user_id: 'x', grade: 18 }])[0].missing).toBe(true);
    expect(normaliseVerifierProfiles([{ user_id: 'x', grade: 18 }])[0].grade).toBeNull();
    expect(normaliseVerifierProfiles([{ user_id: 'x', grade: 14 }])[0]).toMatchObject({ grade: 14, missing: false });
    expect(normaliseVerifierProfiles([{ user_id: 'x', grade: 17 }])[0]).toMatchObject({ grade: 17, missing: false });
  });

  it('flags missing first, then expired, then a request', () => {
    expect(profileFlag(list[1])).toBe('missing');
    expect(profileFlag(list[2])).toBe('expired');
    expect(profileFlag(list[0])).toBe('request');
    expect(profileFlag(list[3])).toBeNull();
  });

  it('sorts people who need attention to the top, then by name', () => {
    expect(sortProfiles(list).map((p) => p.name)).toEqual(['Amy', 'Bo', 'Zed', 'Cy']);
  });
});

describe('the verifier details form check', () => {
  const ok = { full_name: 'Asha', grade: '10', school: 'Sample Hill', board: 'ICSE', valid_until: '2027-03-31' };
  it('passes a complete form', () => {
    expect(profileInputProblem(ok)).toBeNull();
  });
  it('names the first thing wrong', () => {
    expect(profileInputProblem({ ...ok, full_name: ' ' })).toMatch(/name/i);
    expect(profileInputProblem({ ...ok, grade: '0' })).toMatch(/Pick their grade/);
    expect(profileInputProblem({ ...ok, grade: '13' })).toBeNull();
    expect(profileInputProblem({ ...ok, grade: '17' })).toBeNull();
    expect(profileInputProblem({ ...ok, grade: '18' })).toMatch(/Pick their grade/);
    expect(profileInputProblem({ ...ok, grade: '9.5' })).toMatch(/Pick their grade/);
    expect(profileInputProblem({ ...ok, school: '' })).toMatch(/school/i);
    expect(profileInputProblem({ ...ok, board: '' })).toMatch(/board/i);
    expect(profileInputProblem({ ...ok, valid_until: '' })).toMatch(/date/i);
  });
});

describe('hod_action_history mapping', () => {
  it('maps rows, drops ones with no time or action, and words the roles', () => {
    const h = normaliseHistory([
      { at: '2026-10-07T10:00:00Z', action: 'hod_assign_paper', actor_name: 'Meena', actor_role: 'hod', paper_label: 'Maths X' },
      { action: 'x' },
      { at: '2026-10-07T09:00:00Z' },
    ]);
    expect(h).toHaveLength(1);
    expect(h[0].actor_name).toBe('Meena');
    expect(roleWord('checker')).toBe('Verifier');
    expect(roleWord('hod')).toBe('HOD');
    expect(roleWord('admin')).toBe('Admin');
  });
});

describe('the HODs list', () => {
  it('maps admin_list_hods rows and keeps the inactive flag', () => {
    const h = normaliseHods([
      { user_id: 'u1', email: 'a@example.com', name: 'Asha', active: true, granted_at: '2026-10-07T00:00:00Z' },
      { user_id: 'u2', email: 'b@example.com', active: false },
    ]);
    expect(h.map((x) => x.active)).toEqual([true, false]);
    expect(h[1].name).toBeNull();
  });
});
