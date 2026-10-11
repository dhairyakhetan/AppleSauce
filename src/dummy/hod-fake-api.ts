/**
 * In-memory fake of the HOD functions for dummy mode (D75). Test builds only
 * (see src/lib/dummy-mode.ts), reached solely through the PREVIEW_TOOLS-gated
 * lazy import in src/pages/Hod.tsx. Every person, school and question here is
 * MADE UP; nothing is copied from a real paper and nothing touches Supabase.
 *
 * It copies the rules the screens lean on: Pass and Fix refuse a stale
 * version, Set aside needs a reason, assigning a paper to someone who is busy
 * queues it, moving a paper takes it off whoever held it, and the AI trust
 * switch refuses a level that has not earned the bar.
 */

import type {
  HistoryRow,
  HodAdminApi,
  HodApi,
  HodAssignment,
  HodEscalation,
  HodRow,
  HodTeamMember,
  HodVerifierProfile,
  UnassignedPaper,
} from '@/lib/hod-api';
import type { PaperPage } from '@/lib/paper-pages';
import type { TrustRow } from '@/lib/ai-trust';
import { formatGrade, isVerifierGrade } from '@/lib/verifier-papers';
import { dummyPageDataUrl, dummyPictureDataUrl } from '@/dummy/checker-fixtures';

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const P = {
  maths: 'e1000000-0000-4000-8000-000000000001',
  physics: 'e1000000-0000-4000-8000-000000000002',
  commerce: 'e1000000-0000-4000-8000-000000000003',
  history: 'e1000000-0000-4000-8000-000000000004',
  chem: 'e1000000-0000-4000-8000-000000000005',
  eco: 'e1000000-0000-4000-8000-000000000006',
  nopic: 'e1000000-0000-4000-8000-000000000007',
};

function pgError(message: string) {
  return Object.assign(new Error(message), { code: '22023', message, details: null, hint: null });
}

export interface FakeHodApi extends HodApi {
  reset(): void;
  /** Every decision the fake accepted, newest last, so a test can see what was sent. */
  log: string[];
}

export function createFakeHodApi(): FakeHodApi {
  const checkers = [
    { user_id: 'c1000000-0000-4000-8000-000000000001', name: 'Asha Reviewer', email: 'asha.reviewer@example.com', active: true },
    { user_id: 'c1000000-0000-4000-8000-000000000002', name: 'Nikhil K', email: 'nikhil.k@example.com', active: true },
    { user_id: 'c1000000-0000-4000-8000-000000000003', name: 'Tara Bose', email: 'tara.bose@example.com', active: true },
    { user_id: 'c1000000-0000-4000-8000-000000000004', name: 'Ravi Menon', email: 'ravi.m@example.com', active: false },
  ];
  const [asha, nikhil, tara] = checkers;
  // The fifth verifier has no details yet, which is the state an admin leaves
  // a fresh account in until the profile form is filled.
  const imran = { user_id: 'c1000000-0000-4000-8000-000000000005', name: 'Imran Shaikh', email: 'imran.s@example.com', active: true };
  checkers.push(imran);

  type Stats = Pick<
    HodTeamMember,
    'reviewed_today' | 'reviewed_7d' | 'reviewed_all' | 'papers_reviewed' | 'passed_as_is' | 'edited' | 'escalated' | 'skipped' | 'overturned' | 'last_active'
  >;
  const stats: Record<string, Stats> = {
    [asha.user_id]: { reviewed_today: 14, reviewed_7d: 96, reviewed_all: 812, papers_reviewed: 31, passed_as_is: 690, edited: 92, escalated: 18, skipped: 12, overturned: 3, last_active: ago(4) },
    [nikhil.user_id]: { reviewed_today: 3, reviewed_7d: 21, reviewed_all: 47, papers_reviewed: 2, passed_as_is: 31, edited: 14, escalated: 2, skipped: 0, overturned: 1, last_active: ago(95) },
    [tara.user_id]: { reviewed_today: 0, reviewed_7d: 0, reviewed_all: 0, papers_reviewed: 0, passed_as_is: 0, edited: 0, escalated: 0, skipped: 0, overturned: 0, last_active: null },
    [checkers[3].user_id]: { reviewed_today: 0, reviewed_7d: 0, reviewed_all: 220, papers_reviewed: 9, passed_as_is: 170, edited: 40, escalated: 6, skipped: 4, overturned: 9, last_active: ago(60 * 24 * 12) },
    [imran.user_id]: { reviewed_today: 0, reviewed_7d: 0, reviewed_all: 0, papers_reviewed: 0, passed_as_is: 0, edited: 0, escalated: 0, skipped: 0, overturned: 0, last_active: null },
  };

  // Details an HOD has filled in (grade, school, board, valid until, subjects).
  const GRADE_OF: Record<string, number> = { IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12 };
  let profiles: Record<string, HodVerifierProfile> = {};
  const prof = (who: (typeof checkers)[number], over: Partial<HodVerifierProfile>): HodVerifierProfile => ({
    user_id: who.user_id,
    email: who.email,
    name: who.name,
    active: who.active,
    full_name: who.name,
    grade: null,
    school: null,
    board: null,
    valid_until: null,
    expired: false,
    missing: true,
    preferred_subjects: [],
    requested_subjects: [],
    requested_at: null,
    ...over,
  });

  const paperBits = {
    [P.maths]: { subject: 'Mathematics', school: 'Sample Hill School', cls: 'X', exam: 'Prelims', year: '2024' },
    [P.physics]: { subject: 'Physics', school: 'Riverside Academy', cls: 'XII', exam: 'Pre-board', year: '2023' },
    [P.commerce]: { subject: 'Commerce', school: 'Lakeview Institute', cls: 'XI', exam: 'Final', year: '2022' },
    [P.history]: { subject: 'History & Civics', school: 'Greenfield School', cls: 'X', exam: 'Prelims', year: '2025' },
    [P.chem]: { subject: 'Chemistry', school: 'Sample Hill School', cls: 'IX', exam: 'Annual', year: '2024' },
    [P.eco]: { subject: 'Economics', school: 'Riverside Academy', cls: 'XII', exam: 'Prelims', year: '2025' },
    [P.nopic]: { subject: 'Geography', school: 'Greenfield School', cls: 'X', exam: 'Prelims', year: '2021' },
  } as const;

  let assignments: HodAssignment[] = [];
  let unassigned: UnassignedPaper[] = [];
  let escalations: HodEscalation[] = [];
  let trust: TrustRow[] = [];
  let nextId = 100;
  const log: string[] = [];
  let history: HistoryRow[] = [];

  // About 130 made-up actions, so Load older has something to load.
  function seedHistory(): HistoryRow[] {
    const people: { id: string; name: string; role: string }[] = [
      { id: asha.user_id, name: asha.name, role: 'verifier' },
      { id: nikhil.user_id, name: nikhil.name, role: 'verifier' },
      { id: 'f3000000-0000-4000-8000-000000000001', name: 'Meena Roy', role: 'hod' },
      { id: 'f3000000-0000-4000-8000-000000000009', name: 'Kanishk', role: 'admin' },
    ];
    const kinds = [
      { action: 'checker_pass', role: 'verifier', note: null },
      { action: 'checker_fix', role: 'verifier', note: null },
      { action: 'checker_ask_help', role: 'verifier', note: 'The words are scrambled' },
      { action: 'hod_assign_paper', role: 'hod', note: null },
      { action: 'hod_send_back', role: 'hod', note: 'Look again at the second line' },
      { action: 'hod_set_verifier_profile', role: 'hod', note: null },
      { action: 'admin_add_hod', role: 'admin', note: null },
    ];
    const out: HistoryRow[] = [];
    for (let i = 0; i < 130; i++) {
      const k = kinds[i % kinds.length];
      const who = people.find((x) => x.role === k.role && (k.role !== 'verifier' || x.id === (i % 2 ? asha.user_id : nikhil.user_id))) ?? people[0];
      out.push({
        at: ago(5 + i * 37),
        actor_id: who.id,
        actor_name: who.name,
        actor_role: who.role,
        action: k.action,
        meaning: null,
        paper_id: P.maths,
        paper_label: 'Mathematics Class X Sample Hill School 2024',
        question_id: null,
        question_number: k.role === 'verifier' || k.action === 'hod_send_back' ? String((i % 12) + 1) : null,
        note: k.note,
      });
    }
    return out;
  }


  function seed() {
    nextId = 100;
    log.length = 0;
    const a = (id: number, status: 'assigned', who: (typeof checkers)[number], paper: string, remaining: number, by: string | null, mins: number): HodAssignment => ({
      assignment_id: id,
      status,
      user_id: who.user_id,
      checker_name: who.name,
      paper_id: paper,
      ...paperBits[paper as keyof typeof paperBits],
      remaining,
      given_by_name: by ?? 'Automatic',
      assigned_at: ago(mins),
      started_at: ago(mins),
    });
    assignments = [
      a(1, 'assigned', asha, P.maths, 7, null, 180),
      a(2, 'assigned', asha, P.commerce, 22, 'Kanishk', 60),
      a(3, 'assigned', nikhil, P.physics, 11, 'Kanishk', 240),
    ];
    const free = (paper: string, open: number): UnassignedPaper => ({ paper_id: paper, ...paperBits[paper as keyof typeof paperBits], open_count: open });
    unassigned = [free(P.history, 14), free(P.chem, 9), free(P.eco, 31), { ...free(P.nopic, 5), cls: null }];

    profiles = {
      [asha.user_id]: prof(asha, { grade: 12, school: 'Sample Hill School', board: 'ISC', valid_until: '2027-03-31', missing: false, preferred_subjects: ['Mathematics', 'Physics'] }),
      [nikhil.user_id]: prof(nikhil, { grade: 10, school: 'Riverside Academy', board: 'ICSE', valid_until: '2027-03-31', missing: false, preferred_subjects: ['Physics'], requested_subjects: ['Chemistry', 'Mathematics'], requested_at: ago(60 * 5) }),
      [tara.user_id]: prof(tara, { grade: 8, school: 'Greenfield School', board: 'CBSE', valid_until: '2026-09-30', expired: true, missing: false }),
      [checkers[3].user_id]: prof(checkers[3], { grade: 11, school: 'Lakeview Institute', board: 'ISC', valid_until: '2027-03-31', missing: false }),
      [imran.user_id]: prof(imran, {}),
    };
    history = seedHistory();

    const esc = (e: Partial<HodEscalation> & Pick<HodEscalation, 'id' | 'paper_id' | 'body'>): HodEscalation => ({
      display_number: null,
      number_path: null,
      instructions: null,
      options: null,
      marks: null,
      version: 1,
      flag_reasons: [],
      subject: null,
      school: null,
      cls: null,
      exam: null,
      year: null,
      page: null,
      page_path: null,
      snippet_path: null,
      escalated_by: null,
      escalated_by_name: null,
      escalated_at: null,
      reason: null,
      ...paperBits[e.paper_id as keyof typeof paperBits],
      ...e,
    });
    escalations = [
      esc({
        id: 'e2000000-0000-4000-8000-000000000001',
        paper_id: P.maths,
        display_number: '4(ii)',
        marks: 3,
        version: 2,
        body: '(ii) Solve for $x$ and verify your answer: $$2x^2 - 7x + 3 = 0$$',
        snippet_path: 'dummy/q-quadratic.png',
        page: 2,
        escalated_by: asha.user_id,
        escalated_by_name: asha.name,
        escalated_at: ago(12),
        reason: 'The picture is of a different question',
      }),
      esc({
        id: 'e2000000-0000-4000-8000-000000000002',
        paper_id: P.physics,
        display_number: '7',
        marks: 2,
        body: '7. State two uses of a lever in daily life. [2] 8. Define power. Give its unit. [2]',
        page: 2,
        page_path: `pages/${P.physics}/2.jpg`,
        escalated_by: nikhil.user_id,
        escalated_by_name: nikhil.name,
        escalated_at: ago(70),
        reason: 'There is no question here',
      }),
      esc({
        id: 'e2000000-0000-4000-8000-000000000004',
        paper_id: P.nopic,
        display_number: '2',
        marks: 2,
        body: 'Define latitude and longitude in one sentence each.',
        escalated_by: nikhil.user_id,
        escalated_by_name: nikhil.name,
        escalated_at: ago(60 * 3),
        reason: 'The page pictures are missing',
      }),
      esc({
        id: 'e2000000-0000-4000-8000-000000000003',
        paper_id: P.eco,
        display_number: '5',
        marks: 4,
        body: 'Name the three main types of rainfall and give one example of a place where each is found.',
        escalated_by: asha.user_id,
        escalated_by_name: asha.name,
        escalated_at: ago(60 * 26),
        reason: 'I cannot read the words',
      }),
    ];

    const row = (level: TrustRow['level'], decision: TrustRow['decision'], subject: string | null, checked: number, asIs: number, waiting: number, over: Partial<TrustRow> = {}): TrustRow => ({
      level,
      decision,
      subject,
      checked,
      as_is: asIs,
      rate: checked > 0 ? Math.round((asIs / checked) * 10000) / 10000 : null,
      waiting,
      trusted: false,
      eligible: checked >= 100 && asIs / Math.max(checked, 1) >= 0.97,
      auto_off_at: null,
      auto_off_reason: null,
      min_rate: 0.97,
      min_checked: 100,
      spot_check_every: 20,
      ...over,
    });
    trust = [
      row('high', 'pass', null, 312, 305, 410),
      row('high', 'pass', 'Mathematics', 180, 178, 220),
      row('high', 'pass', 'Physics', 132, 127, 190),
      row('high', 'fix', null, 260, 256, 38, { trusted: true }),
      row('high', 'fix', 'Mathematics', 260, 256, 38, { trusted: true }),
      row('medium', 'pass', null, 210, 196, 530),
      row('medium', 'pass', 'Mathematics', 120, 116, 300),
      row('medium', 'pass', 'Commerce', 90, 80, 230),
      row('medium', 'fix', null, 74, 58, 61),
      row('low', 'pass', null, 31, 20, 88),
      row('low', 'fix', null, 140, 129, 24, { auto_off_at: ago(60 * 30), auto_off_reason: 'it fell to 91% over the last 50 checks' }),
    ];
  }
  seed();

  /** The rules verifier_can_take applies, as the sentence it would raise (or null). */
  function cannotTake(userId: string, cls: string | null): string | null {
    const p = profiles[userId];
    if (p?.expired) return `This verifier's details expired on ${p.valid_until}; update them first`;
    // 20261008100000: no details or no grade = no class limit.
    if (!p || p.missing || p.grade === null) return null;
    const need = cls ? GRADE_OF[cls] : undefined;
    if (need && need > p.grade) return `This paper is Class ${need}; the verifier is in ${formatGrade(p.grade)}`;
    return null;
  }

  function note(action: string, paperId: string | null) {
    history.unshift({
      at: new Date().toISOString(),
      actor_id: 'f3000000-0000-4000-8000-000000000009',
      actor_name: 'You',
      actor_role: 'hod',
      action,
      meaning: null,
      paper_id: paperId,
      paper_label: paperId ? 'a paper' : null,
      question_id: null,
      question_number: null,
      note: null,
    });
  }

  const api: FakeHodApi = {
    log,
    reset: seed,
    async isHod() {
      return true;
    },
    async escalations() {
      return escalations.map((e) => ({ ...e }));
    },
    async team() {
      return checkers.map((c) => {
        const mine = assignments.filter((x) => x.user_id === c.user_id);
        return {
          user_id: c.user_id,
          name: c.name,
          email: c.email,
          active: c.active,
          subjects: [],
          classes: [],
          papers_held: mine.length,
          questions_waiting: mine.reduce((n, x) => n + x.remaining, 0),
          ...stats[c.user_id],
        };
      });
    },
    async assignments() {
      return assignments.map((x) => ({ ...x }));
    },
    async unassignedPapers() {
      return unassigned.map((x) => ({ ...x }));
    },
    async assignPaper(paperId, userId) {
      // The real server lets an HOD name themselves without being a listed verifier.
      const who = userId === 'dummy-me' ? { name: 'You' } : checkers.find((c) => c.user_id === userId && c.active);
      if (!who) throw pgError('That person is not an active verifier');
      const prev = assignments.find((x) => x.paper_id === paperId);
      const free = unassigned.find((x) => x.paper_id === paperId);
      if (prev && prev.user_id === userId) return;
      const bits = prev ?? free;
      if (!bits) throw pgError('Paper not found');
      const block = cannotTake(userId, bits.cls);
      if (block) throw pgError(block);
      assignments = assignments.filter((x) => x !== prev);
      unassigned = unassigned.filter((x) => x !== free);
      assignments.push({
        assignment_id: nextId++,
        status: 'assigned',
        user_id: userId,
        checker_name: who.name,
        paper_id: paperId,
        subject: bits.subject,
        school: bits.school,
        cls: bits.cls,
        exam: bits.exam,
        year: bits.year,
        remaining: prev ? prev.remaining : (free as UnassignedPaper).open_count,
        given_by_name: 'You',
        assigned_at: new Date().toISOString(),
        started_at: new Date().toISOString(),
      });
      log.push(`assign ${paperId} -> ${who.name}`);
      note('hod_assign_paper', paperId);
    },
    async distribute() {
      let given = 0;
      for (const paper of [...unassigned]) {
        // A paper whose class is not known is handed out as Class 12 (20261007140000).
        const cls = paper.cls ?? 'XII';
        const candidates = checkers
          .filter((c) => c.active && !cannotTake(c.user_id, cls))
          .sort((a, b) => assignments.filter((x) => x.user_id === a.user_id).length - assignments.filter((x) => x.user_id === b.user_id).length);
        const pick = candidates[0];
        if (!pick) continue;
        unassigned = unassigned.filter((x) => x !== paper);
        assignments.push({
          assignment_id: nextId++,
          status: 'assigned',
          user_id: pick.user_id,
          checker_name: pick.name,
          paper_id: paper.paper_id,
          subject: paper.subject,
          school: paper.school,
          cls: paper.cls,
          exam: paper.exam,
          year: paper.year,
          remaining: paper.open_count,
          given_by_name: 'Automatic',
          assigned_at: new Date().toISOString(),
          started_at: new Date().toISOString(),
        });
        given++;
      }
      log.push(`distribute ${given}`);
      return given;
    },
    async profiles() {
      return Object.values(profiles).map((x) => ({ ...x }));
    },
    async setProfile(userId, input) {
      // The admin page can add a made-up person after this fake was built, so an
      // unknown id is taken as a verifier added a moment ago.
      const who = checkers.find((c) => c.user_id === userId) ?? { user_id: userId, name: input.full_name, email: 'new.verifier@example.com', active: true };
      if (!isVerifierGrade(input.grade)) throw pgError('Grade is out of range');
      profiles[userId] = {
        ...(profiles[userId] ?? prof(who, {})),
        full_name: input.full_name,
        grade: input.grade,
        school: input.school,
        board: input.board,
        valid_until: input.valid_until,
        expired: input.valid_until < new Date().toISOString().slice(0, 10),
        missing: false,
      };
      log.push(`profile ${who.name} grade ${input.grade}`);
      note('hod_set_verifier_profile', null);
    },
    async setPreferred(userId, subjects) {
      const cur = profiles[userId];
      if (!cur) throw pgError('That person is not a verifier');
      // Approving a request clears it.
      profiles[userId] = { ...cur, preferred_subjects: subjects, requested_subjects: [], requested_at: null };
      log.push(`preferred ${cur.name} ${subjects.join('|')}`);
      note('hod_set_preferred_subjects', null);
    },
    async history({ actor, role, before, limit = 100 }) {
      return history
        .filter((r) => (!actor || r.actor_id === actor) && (!role || r.actor_role === role) && (!before || r.at < before))
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, limit)
        .map((r) => ({ ...r }));
    },
    async unassign(assignmentId) {
      const a = assignments.find((x) => x.assignment_id === assignmentId);
      if (!a) return;
      assignments = assignments.filter((x) => x !== a);
      unassigned.push({ paper_id: a.paper_id, subject: a.subject, school: a.school, cls: a.cls, exam: a.exam, year: a.year, open_count: a.remaining });
      note('hod_unassign', a.paper_id);
      log.push(`unassign ${a.paper_id}`);
    },
    async pass(id, version) {
      const e = escalations.find((x) => x.id === id);
      if (!e) throw pgError('This question is not waiting for the HOD');
      if (e.version !== version) throw Object.assign(new Error('stale question'), { code: '40001' });
      escalations = escalations.filter((x) => x !== e);
      log.push(`pass ${id}`);
    },
    async fix(id, version, patch) {
      const e = escalations.find((x) => x.id === id);
      if (!e) throw pgError('This question is not waiting for the HOD');
      if (e.version !== version) throw Object.assign(new Error('stale question'), { code: '40001' });
      if (patch.body !== undefined && patch.body !== null && patch.body.trim() === '') throw pgError('This question has no words; it cannot be passed');
      escalations = escalations.filter((x) => x !== e);
      log.push(`fix ${id} ${JSON.stringify(patch)}`);
    },
    async sendBack(id, noteText) {
      escalations = escalations.filter((x) => x.id !== id);
      log.push(`send back ${id} ${noteText}`);
      note('hod_send_back', null);
    },
    async setAside(id, reason) {
      if (!reason.trim()) throw pgError('Say why it is being set aside');
      escalations = escalations.filter((x) => x.id !== id);
      log.push(`set aside ${id} ${reason}`);
      note('hod_set_aside', null);
    },
    async pictureUrl(path) {
      return dummyPageDataUrl(path) ?? dummyPictureDataUrl(path);
    },
    async paperPages(paperId): Promise<PaperPage[]> {
      if (paperId === P.nopic) return [];
      return [1, 2, 3, 4].map((n) => ({ page: n, object_path: `pages/${paperId}/${n}.jpg` }));
    },
    async aiTrust() {
      return trust.map((t) => ({ ...t }));
    },
    async setAiTrust(level, decision, trusted) {
      const row = trust.find((t) => t.level === level && t.decision === decision && t.subject === null);
      if (!row) throw pgError(`Unknown level ${level}/${decision}`);
      if (trusted && !row.eligible) {
        throw pgError(`Not earned yet: ${row.checked} checked, ${Math.round((row.rate ?? 0) * 1000) / 10}% agreed (needs ${row.min_checked} checked and 97% agreed)`);
      }
      for (const t of trust) {
        if (t.level === level && t.decision === decision) {
          t.trusted = trusted;
          if (trusted) {
            t.auto_off_at = null;
            t.auto_off_reason = null;
          }
        }
      }
      log.push(`trust ${level}/${decision} ${trusted}`);
      note('admin_set_ai_trust', null);
    },
  };
  return api;
}

/** The admin side: the HODs list for /admin/checkers. */
export function createFakeHodAdminApi(): HodAdminApi {
  let hods: HodRow[] = [
    { user_id: 'f3000000-0000-4000-8000-000000000001', email: 'meena.roy@example.com', name: 'Meena Roy', active: true, granted_at: ago(60 * 24 * 5) },
  ];
  const known: Record<string, { id: string; name: string | null }> = {
    'tara.bose@example.com': { id: 'd2222222-0000-4000-8000-000000000001', name: 'Tara Bose' },
    'tarun.g@example.com': { id: 'd2222222-0000-4000-8000-000000000002', name: 'Tarun Gupta' },
    'ravi.k@example.com': { id: 'd2222222-0000-4000-8000-000000000004', name: null },
  };
  return {
    async listHods() {
      return hods.map((h) => ({ ...h }));
    },
    async addHod(email) {
      const key = email.trim().toLowerCase();
      if (key.startsWith('nobody')) throw new Error(`No account with the email ${email}; they must sign up first`);
      const who = known[key];
      const id = who?.id ?? crypto.randomUUID();
      hods = [{ user_id: id, email: email.trim(), name: who?.name ?? null, active: true, granted_at: new Date().toISOString() }, ...hods.filter((h) => h.user_id !== id)];
      return id;
    },
    async removeHod(userId) {
      hods = hods.map((h) => (h.user_id === userId ? { ...h, active: false } : h));
    },
  };
}
