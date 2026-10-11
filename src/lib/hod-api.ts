import { supabase } from '@/integrations/supabase/client';
import {
  checkerFixQuestion,
  checkerPassQuestion,
  checkerPictureUrl,
  paperPagePictures,
} from '@/lib/checker-api';
import type { RawOption } from '@/lib/checker-options';
import { paperLabel } from '@/lib/checker-progress';
import { isVerifierGrade } from '@/lib/verifier-papers';
import type { PaperPage } from '@/lib/paper-pages';
import { normaliseTrustRows, type TrustDecision, type TrustLevel, type TrustRow } from '@/lib/ai-trust';

/**
 * Client wrapper for the Head of Department (HOD) screens. Every call is one
 * of the functions in 20261007100000_checker_assignments_and_hod.sql, each of
 * which checks is_hod() (admins count) inside. They are not in the generated
 * types yet, hence the `as never` casts, the same as checker-api.ts.
 *
 * Shaping lives here as pure functions so the page and the tests share it.
 */

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
};
const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : [];
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
const rows = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

// ---------------------------------------------------------------- escalations

export interface HodEscalation {
  id: string;
  paper_id: string;
  display_number: string | null;
  number_path: string | null;
  instructions: string | null;
  body: string;
  options: RawOption[] | null;
  marks: number | null;
  version: number;
  flag_reasons: string[];
  subject: string | null;
  school: string | null;
  cls: string | null;
  exam: string | null;
  year: string | null;
  /** 1-based page of the printed paper, when known. */
  page: number | null;
  page_path: string | null;
  snippet_path: string | null;
  escalated_by: string | null;
  escalated_by_name: string | null;
  escalated_at: string | null;
  /** What the checker typed in the Ask the HOD box. */
  reason: string | null;
}

/** One row of hod_escalations(); null when it has no id or paper. */
export function normaliseEscalation(raw: unknown): HodEscalation | null {
  const r = obj(raw);
  const id = str(r.id);
  const paper = str(r.paper_id);
  if (!id || !paper) return null;
  const marks = r.marks === null || r.marks === undefined || r.marks === '' ? null : num(r.marks);
  return {
    id,
    paper_id: paper,
    display_number: str(r.display_number),
    number_path: str(r.number_path),
    instructions: str(r.instructions),
    // The words are passed through untouched: never trimmed, cleaned or re-cased.
    body: typeof r.body === 'string' ? r.body : '',
    options: Array.isArray(r.options) ? (r.options as RawOption[]) : null,
    marks,
    version: num(r.version),
    flag_reasons: strList(r.flag_reasons),
    subject: str(r.subject),
    school: str(r.school),
    cls: str(r.cls),
    exam: str(r.exam),
    year: str(r.year),
    page: r.page === null || r.page === undefined ? null : num(r.page) || null,
    page_path: str(r.page_path),
    snippet_path: str(r.snippet_path),
    escalated_by: str(r.escalated_by),
    escalated_by_name: str(r.escalated_by_name),
    escalated_at: str(r.escalated_at),
    reason: str(r.reason),
  };
}

export function normaliseEscalations(raw: unknown): HodEscalation[] {
  return rows(raw)
    .map(normaliseEscalation)
    .filter((e): e is HodEscalation => e !== null);
}

// ------------------------------------------------------------------- the team

/** One verifier's workload and results (hod_team, 20261007130000). */
export interface HodTeamMember {
  user_id: string;
  name: string | null;
  email: string | null;
  active: boolean;
  subjects: string[];
  classes: string[];
  papers_held: number;
  questions_waiting: number;
  reviewed_today: number;
  reviewed_7d: number;
  reviewed_all: number;
  papers_reviewed: number;
  passed_as_is: number;
  edited: number;
  escalated: number;
  skipped: number;
  overturned: number;
  last_active: string | null;
}

export function normaliseTeamMember(raw: unknown): HodTeamMember | null {
  const r = obj(raw);
  const id = str(r.user_id);
  if (!id) return null;
  return {
    user_id: id,
    name: str(r.name),
    email: str(r.email),
    active: r.active !== false,
    subjects: strList(r.subjects),
    classes: strList(r.classes),
    papers_held: num(r.papers_held),
    questions_waiting: num(r.questions_waiting),
    reviewed_today: num(r.reviewed_today),
    reviewed_7d: num(r.reviewed_7d),
    reviewed_all: num(r.reviewed_all),
    papers_reviewed: num(r.papers_reviewed),
    passed_as_is: num(r.passed_as_is),
    edited: num(r.edited),
    escalated: num(r.escalated),
    skipped: num(r.skipped),
    overturned: num(r.overturned),
    last_active: str(r.last_active),
  };
}

export function normaliseTeam(raw: unknown): HodTeamMember[] {
  return rows(raw)
    .map(normaliseTeamMember)
    .filter((m): m is HodTeamMember => m !== null);
}

export function memberName(m: Pick<HodTeamMember, 'name' | 'email'>): string {
  return m.name ?? m.email ?? 'Unnamed verifier';
}

export interface TeamColumn {
  key: keyof HodTeamMember;
  /** The heading, in plain words. */
  label: string;
  /** One line explaining the number, shown on hover and to screen readers. */
  hint: string;
}

/** The verifier analytics table, left to right. Plain words, no database names. */
export const TEAM_COLUMNS: TeamColumn[] = [
  { key: 'papers_held', label: 'Papers held', hint: 'Papers given to them that are not finished.' },
  { key: 'questions_waiting', label: 'Waiting', hint: 'Questions in those papers still to verify.' },
  { key: 'reviewed_today', label: 'Today', hint: 'Questions they dealt with today.' },
  { key: 'reviewed_7d', label: 'Last 7 days', hint: 'Questions they dealt with in the last seven days.' },
  { key: 'reviewed_all', label: 'All time', hint: 'Every question they have dealt with.' },
  { key: 'papers_reviewed', label: 'Papers done', hint: 'Papers they have been through.' },
  { key: 'passed_as_is', label: 'Passed as is', hint: 'Questions they said looked right without changing anything.' },
  { key: 'edited', label: 'Fixed', hint: 'Questions where they changed the words, number or marks.' },
  { key: 'escalated', label: 'Sent to HOD', hint: 'Questions they asked the HOD about.' },
  { key: 'skipped', label: 'Skipped', hint: 'Questions they skipped. They wait on the paper until the verifier goes back to them.' },
  { key: 'overturned', label: 'Later corrected', hint: 'Questions they passed that someone else later fixed.' },
  { key: 'last_active', label: 'Last active', hint: 'When they last checked a question.' },
];

/** The share of a verifier's settled questions they passed with no change, 0 to 100, or null when there are none. */
export function passRate(m: Pick<HodTeamMember, 'passed_as_is' | 'edited'>): number | null {
  const n = m.passed_as_is + m.edited;
  return n > 0 ? Math.round((m.passed_as_is / n) * 100) : null;
}

// ----------------------------------------------------------------- the profiles

/** A verifier's details and subject wishes (hod_verifier_profiles). */
export interface HodVerifierProfile {
  user_id: string;
  email: string | null;
  name: string | null;
  active: boolean;
  full_name: string | null;
  grade: number | null;
  school: string | null;
  board: string | null;
  valid_until: string | null;
  expired: boolean;
  missing: boolean;
  preferred_subjects: string[];
  requested_subjects: string[];
  requested_at: string | null;
}

/**
 * A paper's class as a grade, the same reading as public.class_grade
 * (20261007160000): upper-case, drop GRADE/CLASS/STD/TH/ST/ND/RD and
 * anything not a letter or digit, then 1-12 or I-XII. Unknown -> null.
 */
export function classGrade(cls: string | null | undefined): number | null {
  const s = (cls ?? '').toUpperCase().replace(/(GRADE|CLASS|STD|TH|ST|ND|RD|[^A-Z0-9])/g, '');
  if (/^[0-9]{1,2}$/.test(s)) {
    const n = Number(s);
    return n >= 1 && n <= 12 ? n : null;
  }
  const i = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'].indexOf(s);
  return i >= 0 ? i + 1 : null;
}

/**
 * Why the server would refuse to give this paper to this verifier, before
 * the HOD presses the button (verifier_can_take). null = allowed. A paper
 * whose class is unknown is the HOD's call. Since 20261008100000 a verifier
 * with no details or no grade can take any paper; only expiry and a recorded
 * grade below the paper's class refuse.
 */
export function pickBlock(profile: HodVerifierProfile | undefined, paperClass: string | null | undefined): string | null {
  if (profile?.expired) return 'details expired';
  if (!profile || profile.missing || profile.grade == null) return null;
  const need = classGrade(paperClass);
  if (need != null && need > profile.grade) return 'paper above their grade';
  return null;
}

export function normaliseVerifierProfile(raw: unknown): HodVerifierProfile | null {
  const r = obj(raw);
  const id = str(r.user_id);
  if (!id) return null;
  const grade = num(r.grade);
  return {
    user_id: id,
    email: str(r.email),
    name: str(r.name),
    active: r.active !== false,
    full_name: str(r.full_name),
    grade: isVerifierGrade(grade) ? grade : null,
    school: str(r.school),
    board: str(r.board),
    valid_until: str(r.valid_until),
    expired: r.expired === true,
    missing: r.missing === true || !isVerifierGrade(grade),
    preferred_subjects: strList(r.preferred_subjects),
    requested_subjects: strList(r.requested_subjects),
    requested_at: str(r.requested_at),
  };
}

export function normaliseVerifierProfiles(raw: unknown): HodVerifierProfile[] {
  return rows(raw)
    .map(normaliseVerifierProfile)
    .filter((m): m is HodVerifierProfile => m !== null);
}

export type ProfileFlag = 'missing' | 'expired' | 'request' | null;

/** What needs the HOD first: missing details, then expired ones, then a pending subject request. */
export function profileFlag(p: Pick<HodVerifierProfile, 'missing' | 'expired' | 'requested_subjects'>): ProfileFlag {
  if (p.missing) return 'missing';
  if (p.expired) return 'expired';
  if (p.requested_subjects.length > 0) return 'request';
  return null;
}

export const PROFILE_FLAG_LABEL: Record<Exclude<ProfileFlag, null>, string> = {
  missing: 'No details yet (papers still given)',
  expired: 'Details expired, no new papers',
  request: 'Asked for subjects',
};

/** Profiles that need attention first, then by name. */
export function sortProfiles(list: HodVerifierProfile[]): HodVerifierProfile[] {
  const rank = (p: HodVerifierProfile) => ({ missing: 0, expired: 1, request: 2 } as Record<string, number>)[profileFlag(p) ?? ''] ?? 3;
  return [...list].sort((a, b) => rank(a) - rank(b) || (a.full_name ?? a.name ?? a.email ?? '').localeCompare(b.full_name ?? b.name ?? b.email ?? ''));
}

export const BOARDS = ['ICSE', 'ISC', 'CBSE', 'WBBSE', 'WBCHSE', 'IB', 'IGCSE', 'Other'];

export interface ProfileInput {
  full_name: string;
  grade: number;
  school: string;
  board: string;
  valid_until: string;
}

/** The first problem with a profile form, in plain words, or null. */
export function profileInputProblem(i: { full_name: string; grade: string | number; school: string; board: string; valid_until: string }): string | null {
  if (!i.full_name.trim()) return 'Enter their name.';
  const g = Number(i.grade);
  if (!isVerifierGrade(g)) return 'Pick their grade.';
  if (!i.school.trim()) return 'Enter their school.';
  if (!i.board.trim()) return 'Pick their board.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.valid_until)) return 'Pick the date these details are valid until.';
  return null;
}

// ---------------------------------------------------------------------- history

export interface HistoryRow {
  at: string;
  actor_id: string | null;
  actor_name: string | null;
  actor_role: string | null;
  action: string;
  meaning: string | null;
  paper_id: string | null;
  paper_label: string | null;
  question_id: string | null;
  question_number: string | null;
  note: string | null;
  /** The verifier took this action back (Undo last). Only present when true. */
  undone?: boolean;
}

export function normaliseHistory(raw: unknown): HistoryRow[] {
  const out: HistoryRow[] = [];
  for (const x of rows(raw)) {
    const r = obj(x);
    const at = str(r.at);
    const action = str(r.action);
    if (!at || !action) continue;
    out.push({
      at,
      actor_id: str(r.actor_id),
      actor_name: str(r.actor_name),
      actor_role: str(r.actor_role),
      action,
      meaning: str(r.meaning),
      paper_id: str(r.paper_id),
      paper_label: str(r.paper_label),
      question_id: str(r.question_id),
      question_number: str(r.question_number),
      note: str(r.note),
      ...(r.undone === true ? { undone: true } : {}),
    });
  }
  return out;
}

export const HISTORY_ROLES: { value: string; label: string }[] = [
  { value: '', label: 'Everyone' },
  { value: 'admin', label: 'Admins' },
  { value: 'hod', label: 'HODs' },
  { value: 'verifier', label: 'Verifiers' },
];

/** "Admin", "HOD", "Verifier" for a role value; the raw value for any other. */
export function roleWord(role: string | null): string {
  // hod_action_history labels a verifier 'verifier'; 'checker' is the older word.
  if (role === 'verifier' || role === 'checker') return 'Verifier';
  if (role === 'hod') return 'HOD';
  if (role === 'admin') return 'Admin';
  return role ?? '';
}

// ---------------------------------------------------------------- assignments

export interface HodAssignment {
  assignment_id: number;
  status: 'assigned';
  user_id: string;
  checker_name: string | null;
  paper_id: string;
  subject: string | null;
  school: string | null;
  cls: string | null;
  exam: string | null;
  year: string | null;
  remaining: number;
  given_by_name: string | null;
  assigned_at: string | null;
  started_at: string | null;
}

export function normaliseAssignmentRow(raw: unknown): HodAssignment | null {
  const r = obj(raw);
  const user = str(r.user_id);
  const paper = str(r.paper_id);
  if (!user || !paper) return null;
  return {
    assignment_id: num(r.assignment_id),
    status: 'assigned',
    user_id: user,
    checker_name: str(r.checker_name),
    paper_id: paper,
    subject: str(r.subject),
    school: str(r.school),
    cls: str(r.cls),
    exam: str(r.exam),
    year: str(r.year),
    remaining: num(r.remaining),
    given_by_name: str(r.given_by_name),
    assigned_at: str(r.assigned_at),
    started_at: str(r.started_at),
  };
}

export function normaliseAssignments(raw: unknown): HodAssignment[] {
  return rows(raw)
    .map(normaliseAssignmentRow)
    .filter((a): a is HodAssignment => a !== null);
}

export interface UnassignedPaper {
  paper_id: string;
  subject: string | null;
  school: string | null;
  cls: string | null;
  exam: string | null;
  year: string | null;
  open_count: number;
}

export function normaliseUnassigned(raw: unknown): UnassignedPaper[] {
  const out: UnassignedPaper[] = [];
  for (const x of rows(raw)) {
    const r = obj(x);
    const id = str(r.paper_id);
    if (!id) continue;
    out.push({
      paper_id: id,
      subject: str(r.subject),
      school: str(r.school),
      cls: str(r.cls),
      exam: str(r.exam),
      year: str(r.year),
      open_count: num(r.open_count),
    });
  }
  return out;
}

/** What one verifier holds, grouped from the flat assignment list. A paper goes whole to one verifier, so there is no queue. */
export interface VerifierLoad {
  user_id: string;
  name: string;
  papers: HodAssignment[];
}

export function groupByVerifier(list: HodAssignment[]): VerifierLoad[] {
  const map = new Map<string, VerifierLoad>();
  for (const a of list) {
    let g = map.get(a.user_id);
    if (!g) {
      g = { user_id: a.user_id, name: a.checker_name ?? 'Unnamed verifier', papers: [] };
      map.set(a.user_id, g);
    }
    g.papers.push(a);
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export { paperLabel };

// ----------------------------------------------------------------- the HODs

export interface HodRow {
  user_id: string;
  email: string | null;
  name: string | null;
  active: boolean;
  granted_at: string | null;
}

export function normaliseHods(raw: unknown): HodRow[] {
  const out: HodRow[] = [];
  for (const x of rows(raw)) {
    const r = obj(x);
    const id = str(r.user_id);
    if (!id) continue;
    out.push({
      user_id: id,
      email: str(r.email),
      name: str(r.name),
      active: r.active !== false,
      granted_at: str(r.granted_at),
    });
  }
  return out;
}

// ------------------------------------------------------------------ the API

export interface HodFixPatch {
  body?: string | null;
  display_number?: string | null;
  marks?: number | null;
}

export interface HodApi {
  isHod(): Promise<boolean>;
  escalations(): Promise<HodEscalation[]>;
  team(): Promise<HodTeamMember[]>;
  assignments(): Promise<HodAssignment[]>;
  unassignedPapers(limit?: number): Promise<UnassignedPaper[]>;
  assignPaper(paperId: string, userId: string): Promise<void>;
  unassign(assignmentId: number): Promise<void>;
  /** distribute_unassigned_papers(): hands out what it can by the rules; returns how many papers were given. */
  distribute(): Promise<number>;
  profiles(): Promise<HodVerifierProfile[]>;
  setProfile(userId: string, input: ProfileInput): Promise<void>;
  setPreferred(userId: string, subjects: string[]): Promise<void>;
  /** hod_action_history(): newest first; pass the oldest `at` seen as `before` for the next page. */
  history(filter: { actor?: string | null; role?: string | null; before?: string | null; limit?: number }): Promise<HistoryRow[]>;
  pass(questionId: string, version: number): Promise<void>;
  fix(questionId: string, version: number, patch: HodFixPatch): Promise<void>;
  sendBack(questionId: string, note: string): Promise<void>;
  setAside(questionId: string, reason: string): Promise<void>;
  pictureUrl(path: string): Promise<string | null>;
  paperPages(paperId: string): Promise<PaperPage[]>;
  /** ai_trust_meter(): how far each AI confidence level has got toward the trust bar. */
  aiTrust(): Promise<TrustRow[]>;
  /** admin_set_ai_trust(): admin only; the server refuses to trust a level that has not earned it. */
  setAiTrust(level: TrustLevel, decision: TrustDecision, trusted: boolean): Promise<void>;
}

async function call(fn: string, args?: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await supabase.rpc(fn as never, (args ?? {}) as never);
  if (error) throw error;
  return data;
}

/** True or false when the server answered; throws when the call failed, so a broken
 *  connection is not read as "this account is not an HOD". */
export async function isHod(): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_hod' as never);
  if (error) throw error;
  return Boolean(data);
}

export const realHodApi: HodApi = {
  isHod,
  async escalations() {
    return normaliseEscalations(await call('hod_escalations'));
  },
  async team() {
    return normaliseTeam(await call('hod_team'));
  },
  async assignments() {
    return normaliseAssignments(await call('hod_assignments'));
  },
  async unassignedPapers(limit = 200) {
    return normaliseUnassigned(await call('hod_unassigned_papers', { p_limit: limit }));
  },
  async assignPaper(paperId, userId) {
    await call('hod_assign_paper', { p_paper_id: paperId, p_user_id: userId });
  },
  async distribute() {
    return num(await call('distribute_unassigned_papers'));
  },
  async profiles() {
    return normaliseVerifierProfiles(await call('hod_verifier_profiles'));
  },
  async setProfile(userId, i) {
    await call('hod_set_verifier_profile', {
      p_user_id: userId,
      p_full_name: i.full_name.trim(),
      p_grade: i.grade,
      p_school: i.school.trim(),
      p_board: i.board.trim(),
      p_valid_until: i.valid_until,
    });
  },
  async setPreferred(userId, subjects) {
    await call('hod_set_preferred_subjects', { p_user_id: userId, p_subjects: subjects });
  },
  async history({ actor = null, role = null, before = null, limit = 100 }) {
    return normaliseHistory(
      await call('hod_action_history', { p_actor: actor, p_role: role || null, p_limit: limit, p_before: before }),
    );
  },
  async unassign(assignmentId) {
    await call('hod_unassign', { p_assignment_id: assignmentId });
  },
  // The HOD settles an escalation with the same versioned functions a checker
  // uses; the server lets an HOD act on an escalated question.
  pass: (id, version) => checkerPassQuestion(id, version),
  fix: (id, version, patch) =>
    checkerFixQuestion(
      id,
      { body: patch.body ?? null, display_number: patch.display_number ?? null, marks: patch.marks ?? null },
      { version },
    ),
  async sendBack(questionId, note) {
    await call('hod_send_back', { p_question_id: questionId, p_note: note });
  },
  async setAside(questionId, reason) {
    await call('hod_set_aside', { p_question_id: questionId, p_reason: reason });
  },
  pictureUrl: checkerPictureUrl,
  paperPages: paperPagePictures,
  async aiTrust() {
    return normaliseTrustRows(await call('ai_trust_meter'));
  },
  async setAiTrust(level, decision, trusted) {
    await call('admin_set_ai_trust', { p_level: level, p_decision: decision, p_trusted: trusted });
  },
};

// ---------------------------------------------------------- admin: the HODs

export interface HodAdminApi {
  listHods(): Promise<HodRow[]>;
  addHod(email: string): Promise<string>;
  removeHod(userId: string): Promise<void>;
}

export const realHodAdminApi: HodAdminApi = {
  async listHods() {
    return normaliseHods(await call('admin_list_hods'));
  },
  async addHod(email) {
    const out = await call('admin_add_hod', { p_email: email.trim() });
    return out as string;
  },
  async removeHod(userId) {
    await call('admin_remove_hod', { p_user_id: userId });
  },
};
