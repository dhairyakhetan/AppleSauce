import { supabase } from '@/integrations/supabase/client';
import type { ContextRow } from '@/lib/checker-context';
import { mergeQueueRows } from '@/lib/paper-review-filter';
import { normaliseExtra, type LibraryExtra } from '@/lib/library-views';
import type { RawOption } from '@/lib/checker-options';
import { checkerSaveRoute, TYPO_NEEDS_VERSION } from '@/lib/checker-save';
import { normaliseAssignment, type MyAssignment } from '@/lib/checker-progress';
import {
  normaliseMyPapers,
  normalisePaperQuestions,
  normaliseProfile,
  type MyPaper,
  type PaperQuestion,
  type VerifierProfile,
} from '@/lib/verifier-papers';
import { normalisePaperPages, type PaperPage } from '@/lib/paper-pages';

/**
 * Client wrapper for the paper-checker (Kid Mode) and paper-admin RPCs added
 * in supabase/migrations/20260928000000_paper_checker_and_admin.sql.
 *
 * These functions are not yet in src/integrations/supabase/types.ts because
 * that file is generated from the LIVE schema, and this migration has not
 * been applied there yet (the orchestrator applies it -- see W1's log note
 * and CLAUDE.md's Supabase rules). Every call below therefore casts the
 * function name `as never`, the same escape hatch already used in this
 * codebase for `site_counts`, `teacher_own_contact` and
 * `admin_teacher_contacts` (see useSiteCounts.ts / teacher-contact.ts) for
 * exactly this reason: a real RPC that predates the generated types. Once
 * `npm run generate-types` is re-run after the migration ships, these casts
 * can be narrowed or removed -- they are not a sign the calls are wrong.
 */

export interface CheckerQuestion {
  id: string;
  paper_id: string;
  ord: number;
  display_number: string | null;
  number_path: string | null;
  body: string;
  options: RawOption[] | null;
  marks: number | null;
  instructions: string | null;
  flag_reasons: string[];
  flag_detail: string | null;
  /* W14: English rows also carry `pipeline`, `role`, `stimulus`, `set_text`
     (read through englishContext() in checker-english.ts). */
  /* snippet_object / align_score / whole_snippet_*: the crop of the printed
     paper and how far to trust it (read through checker-pictures.ts). */
  source: AuditQuestionSource | null;
  subject: string | null;
  school: string | null;
  cls: string | null;
  exam: string | null;
  year: string | null;
  /** audit_questions.version, the one the checker is looking at
   *  (20261002090000). Absent until that migration is applied. */
  version?: number | null;
  /** From verifier_next_in_paper (20261007130000): the page the question sits on
   *  and the storage paths of its page picture and crop, when there are any. */
  page?: number | null;
  page_path?: string | null;
  snippet_path?: string | null;
  /** The computer's first raw reading of this question, before it tidied it
   *  (audit_questions.raw_ocr, returned by verifier_next_in_paper since
   *  20261011120000). Absent on older rows and before that migration is
   *  applied; read through rawReading() in checker-edit-log.ts. */
  raw_ocr?: string | null;
}

/** audit_questions.source (jsonb). The pipeline writes more keys than the
 *  site reads; the named ones are the ones the site does read. Anything else
 *  stays reachable as `unknown`, so a new key never needs a cast. */
export type AuditQuestionSource = {
  page?: number;
  /* where the question sits on the page: pixels at `dpi`, see checker-highlight.ts */
  bbox?: number[];
  dpi?: number;
  page_width?: number;
  page_height?: number;
  /* what the computer changed when it tidied the question (checker-edit-log.ts) */
  edit_log?: { kind?: string; from?: string; to?: string }[];
  snippet_path?: string;
  /* the crop of the printed paper and how far to trust it (checker-pictures.ts) */
  snippet_object?: string;
  align_score?: number;
  /* locate_pages.py: the page was checked against the PDF text (checker-page.ts) */
  page_verified?: boolean;
  page_match_score?: number;
  whole_snippet_object?: string;
  whole_snippet_members?: { located?: number; members?: number; min_align?: number };
  /* W14 English rows (checker-english.ts) */
  pipeline?: string;
  role?: string;
  stimulus?: unknown;
  set_text?: string;
  rescue_decision?: string;
} & Record<string, unknown>;

function rpcRow<T>(data: unknown): T | null {
  const rows = (data ?? []) as unknown;
  const row = Array.isArray(rows) ? rows[0] : rows;
  return (row ?? null) as T | null;
}

function rpcRows<T>(data: unknown): T[] {
  return ((data ?? []) as unknown) as T[];
}

export async function isPaperChecker(): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_paper_checker' as never);
  // A failed call is "could not check", never "not a verifier": throw so the
  // page can offer a retry instead of locking a real verifier out.
  if (error) throw error;
  return Boolean(data);
}

export async function checkerNextQuestion(): Promise<CheckerQuestion | null> {
  const { data, error } = await supabase.rpc('checker_next_question' as never);
  if (error) throw error;
  return rpcRow<CheckerQuestion>(data);
}

export async function checkerPassQuestion(questionId: string, version?: number | null): Promise<void> {
  if (checkerSaveRoute(version, false) === 'locked') {
    const { error } = await supabase.rpc('checker_pass_locked' as never, {
      p_question_id: questionId,
      p_expected_version: version,
    } as never);
    if (error) throw error;
    return;
  }
  const { error } = await supabase.rpc('checker_pass_question' as never, { p_question_id: questionId } as never);
  if (error) throw error;
}

export interface CheckerFixOptions {
  /** The version the checker saw (CheckerQuestion.version). */
  version?: number | null;
  /** Owner round 24: the printed paper itself has a typo and the checker corrected it. */
  printedTypo?: boolean;
  /** What the typo was, in the checker's words (optional, max 500 characters server side). */
  typoNote?: string | null;
}

export async function checkerFixQuestion(
  questionId: string,
  patch: { body?: string | null; display_number?: string | null; marks?: number | null },
  options: CheckerFixOptions = {},
): Promise<void> {
  const route = checkerSaveRoute(options.version, Boolean(options.printedTypo));
  if (route === 'refuse') throw new Error(TYPO_NEEDS_VERSION);
  if (route === 'locked') {
    const { error } = await supabase.rpc('checker_fix_locked' as never, {
      p_question_id: questionId,
      p_expected_version: options.version,
      p_body: patch.body ?? null,
      p_display_number: patch.display_number ?? null,
      p_marks: patch.marks ?? null,
      p_printed_typo: Boolean(options.printedTypo),
      p_typo_note: options.typoNote?.trim() || null,
    } as never);
    if (error) throw error;
    return;
  }
  const { error } = await supabase.rpc('checker_fix_question' as never, {
    p_question_id: questionId,
    p_body: patch.body ?? null,
    p_display_number: patch.display_number ?? null,
    p_marks: patch.marks ?? null,
  } as never);
  if (error) throw error;
}

export async function checkerSplitQuestion(
  questionId: string,
  bodyBefore: string,
  splitAt: number,
): Promise<{ first_id: string; second_id: string } | null> {
  const { data, error } = await supabase.rpc('checker_split_question' as never, {
    p_question_id: questionId,
    p_body_before: bodyBefore,
    p_split_at: splitAt,
  } as never);
  if (error) throw error;
  return rpcRow<{ first_id: string; second_id: string }>(data);
}

export async function checkerAskForHelp(questionId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('checker_ask_for_help' as never, {
    p_question_id: questionId,
    p_reason: reason,
  } as never);
  if (error) throw error;
}

/** A row that is only the word OR (verifier_or_separator, 20261008150000): it is
 *  set aside and the questions either side of it are linked as alternatives. */
export async function checkerMarkOrSeparator(questionId: string): Promise<void> {
  const { error } = await supabase.rpc('verifier_or_separator' as never, { p_question_id: questionId } as never);
  if (error) throw error;
}

export async function checkerCheckedTodayCount(): Promise<number> {
  const { data, error } = await supabase.rpc('checker_checked_today_count' as never);
  if (error) return 0;
  return Number(data) || 0;
}

export async function checkerSkipQuestion(questionId: string): Promise<void> {
  const { error } = await supabase.rpc('checker_skip_question' as never, { p_question_id: questionId } as never);
  if (error) throw error;
}

export interface CheckerStats {
  today_count: number;
  total_count: number;
}

export async function checkerMyStats(): Promise<CheckerStats> {
  const { data, error } = await supabase.rpc('checker_my_stats' as never);
  if (error) throw error;
  return rpcRow<CheckerStats>(data) ?? { today_count: 0, total_count: 0 };
}

export interface LeaderboardRow {
  rank: number;
  first_name: string;
  weekly_count: number;
}

export async function checkerLeaderboard(): Promise<LeaderboardRow[]> {
  const { data, error } = await supabase.rpc('checker_leaderboard' as never);
  if (error) throw error;
  return rpcRows<LeaderboardRow>(data);
}

export interface CheckerPreferences {
  subjects: string[] | null;
  classes: string[] | null;
  /** True once the checker has saved a choice, even "All" (which stores
   *  nulls). Absent before 20260929013000 is applied. */
  chosen?: boolean;
}

export async function checkerGetPreferences(): Promise<CheckerPreferences> {
  const { data, error } = await supabase.rpc('checker_get_preferences' as never);
  if (error) throw error;
  return rpcRow<CheckerPreferences>(data) ?? { subjects: null, classes: null };
}

export async function checkerSetPreferences(subjects: string[], classes: string[]): Promise<void> {
  const { error } = await supabase.rpc('checker_set_preferences' as never, {
    p_subjects: subjects,
    p_classes: classes,
  } as never);
  if (error) throw error;
}

/**
 * The whole question a sub-part belongs to (parent + every part, in paper
 * order), from checker_question_context in
 * 20260928160000_checker_question_context.sql. Same gate as the other
 * checker RPCs: only the lease holder or an admin. Returns [] when the
 * question is not part of a larger one, AND when the call fails (for
 * example before that migration is applied): the extra context is a help,
 * never a reason to block checking.
 */
export async function checkerQuestionContext(questionId: string): Promise<ContextRow[]> {
  const { data, error } = await supabase.rpc('checker_question_context' as never, {
    p_question_id: questionId,
  } as never);
  if (error) return [];
  return rpcRows<ContextRow>(data);
}

export interface QueueFacetRow {
  subject: string | null;
  cls: string | null;
  waiting: number;
}

/**
 * What is actually waiting in the kid queue, by subject and class
 * (checker_queue_facets, 20260929013000_checker_queue_hygiene.sql). The
 * "My subjects" picker is built from this so a chip can only name a value
 * the queue really holds. It used to be built from the SITE's facet lists
 * ('Maths', '10'), which never equal the audit values ('Mathematics', 'X'):
 * choosing Maths or class 10 emptied the queue. Returns null when the RPC is
 * not deployed yet, so the page falls back to a static list of audit values.
 */
export async function checkerQueueFacets(): Promise<QueueFacetRow[] | null> {
  const { data, error } = await supabase.rpc('checker_queue_facets' as never);
  if (error) return null;
  return rpcRows<QueueFacetRow>(data).map((r) => ({ ...r, waiting: Number(r.waiting) || 0 }));
}

/** A 10-minute signed URL for one object in the private audit-figures
 *  bucket (a path planned by planCheckerPicture in checker-pictures.ts).
 *  Null on any failure: the page then shows the "no picture" note. */
export function checkerPictureUrl(path: string): Promise<string | null> {
  return supabase.storage
    .from('audit-figures')
    .createSignedUrl(path, 600)
    .then(({ data, error }) => (error ? null : data?.signedUrl ?? null))
    .catch(() => null);
}

/** The verifier's papers, with progress (verifier_my_papers). It hands out
 *  papers first when the verifier has none, so an empty list means nothing is
 *  available for them yet. */
export async function verifierMyPapers(): Promise<MyPaper[]> {
  const { data, error } = await supabase.rpc('verifier_my_papers' as never);
  if (error) throw error;
  return normaliseMyPapers(data);
}

/** Every question of one paper the caller holds, with a state each (verifier_paper_questions). */
export async function verifierPaperQuestions(paperId: string): Promise<PaperQuestion[]> {
  const { data, error } = await supabase.rpc('verifier_paper_questions' as never, { p_paper_id: paperId } as never);
  if (error) throw error;
  return normalisePaperQuestions(data);
}

/** "Start verifying": the next question of one paper, leased for 10 minutes
 *  (verifier_next_in_paper). Null when nothing is left in it. */
export async function verifierNextInPaper(
  paperId: string,
  options: { includeSkipped?: boolean } = {},
): Promise<CheckerQuestion | null> {
  // Skipped questions wait for later (20261008160000): they are served only
  // when the verifier asks to go through them.
  const { data, error } = await supabase.rpc('verifier_next_in_paper' as never, {
    p_paper_id: paperId,
    p_include_skipped: Boolean(options.includeSkipped),
  } as never);
  if (error) throw error;
  return rpcRow<CheckerQuestion>(data);
}

/** What verifier_undo_last (20261008140000) hands back: which kind of answer
 *  was undone and the question as it is now, leased to the caller again. */
export interface UndoResult {
  question_id: string;
  undone: 'pass' | 'fix' | 'ask_help' | 'skip';
  /** The log action that was undone, e.g. checker_pass. */
  undone_action: string;
  question: CheckerQuestion;
}

/** Undo the caller's most recent answer on this paper (Looks right, Fix it,
 *  Ask the HOD or Skip), within 30 minutes and while nobody else has touched
 *  the question. A refusal comes back as an error whose message is a plain
 *  sentence for the verifier (errcode 22023). */
export async function verifierUndoLast(paperId: string): Promise<UndoResult> {
  const { data, error } = await supabase.rpc('verifier_undo_last' as never, { p_paper_id: paperId } as never);
  if (error) throw error;
  const raw = data as unknown;
  const row = (Array.isArray(raw) ? raw[0] : raw) as UndoResult | null | undefined;
  if (!row || !row.question) throw new Error('Nothing came back from the undo. Try again.');
  return row;
}

/** The verifier's own details, read only (verifier_my_profile). */
export async function verifierMyProfile(): Promise<VerifierProfile | null> {
  const { data, error } = await supabase.rpc('verifier_my_profile' as never);
  if (error) throw error;
  return normaliseProfile(data);
}

/** The verifier's own name, grade, school and board (verifier_set_my_profile,
 *  20261008100000). Grade may be blank. The HOD can still change them; the
 *  valid-until date and preferred subjects stay the HOD's. */
export async function verifierSetMyProfile(input: { full_name: string | null; grade: number | null; school: string | null; board: string | null }): Promise<void> {
  const { error } = await supabase.rpc('verifier_set_my_profile' as never, {
    p_full_name: input.full_name,
    p_grade: input.grade,
    p_school: input.school,
    p_board: input.board,
  } as never);
  if (error) throw error;
}

/** Ask the HOD for preferred subjects (verifier_request_subjects). Only an HOD can set them. */
export async function verifierRequestSubjects(subjects: string[]): Promise<void> {
  const { error } = await supabase.rpc('verifier_request_subjects' as never, { p_subjects: subjects } as never);
  if (error) throw error;
}

/** The caller's current paper and how far through it they are
 *  (checker_my_assignment, 20261007100000). Null when nothing is assigned;
 *  call checkerNextQuestion first, because that is what assigns. */
export async function checkerMyAssignment(): Promise<MyAssignment | null> {
  const { data, error } = await supabase.rpc('checker_my_assignment' as never);
  if (error) throw error;
  return normaliseAssignment(data);
}

/** Hand the current paper back (checker_return_paper). */
export async function checkerReturnPaper(reason: string): Promise<void> {
  const { error } = await supabase.rpc('checker_return_paper' as never, { p_reason: reason } as never);
  if (error) throw error;
}

/** Every page picture of a paper, in page order (paper_page_pictures,
 *  20261007110000): an HOD or admin for any paper, a checker for a paper they
 *  hold. Throws on a refusal or failure; an empty list means no pictures. */
export async function paperPagePictures(auditPaperId: string): Promise<PaperPage[]> {
  const { data, error } = await supabase.rpc('paper_page_pictures' as never, { p_audit_paper_id: auditPaperId } as never);
  if (error) throw error;
  return normalisePaperPages(data);
}

/**
 * Everything the checker page calls, as one object, so the page can run
 * against the real RPCs or, in dummy mode (test builds only, see
 * src/lib/dummy-mode.tsx), against an in-memory fake with the same shape.
 */
export interface CheckerApi {
  isPaperChecker: typeof isPaperChecker;
  nextQuestion: typeof checkerNextQuestion;
  passQuestion: typeof checkerPassQuestion;
  fixQuestion: typeof checkerFixQuestion;
  splitQuestion: typeof checkerSplitQuestion;
  askForHelp: typeof checkerAskForHelp;
  skipQuestion: typeof checkerSkipQuestion;
  markOrSeparator: typeof checkerMarkOrSeparator;
  checkedTodayCount: typeof checkerCheckedTodayCount;
  myStats: typeof checkerMyStats;
  leaderboard: typeof checkerLeaderboard;
  getPreferences: typeof checkerGetPreferences;
  setPreferences: typeof checkerSetPreferences;
  questionContext: typeof checkerQuestionContext;
  queueFacets: typeof checkerQueueFacets;
  pictureUrl: typeof checkerPictureUrl;
  myPapers: typeof verifierMyPapers;
  paperQuestions: typeof verifierPaperQuestions;
  nextInPaper: typeof verifierNextInPaper;
  undoLast: typeof verifierUndoLast;
  myProfile: typeof verifierMyProfile;
  setMyProfile: typeof verifierSetMyProfile;
  requestSubjects: typeof verifierRequestSubjects;
  myAssignment: typeof checkerMyAssignment;
  returnPaper: typeof checkerReturnPaper;
  paperPages: typeof paperPagePictures;
}

export const realCheckerApi: CheckerApi = {
  isPaperChecker,
  nextQuestion: checkerNextQuestion,
  passQuestion: checkerPassQuestion,
  fixQuestion: checkerFixQuestion,
  splitQuestion: checkerSplitQuestion,
  askForHelp: checkerAskForHelp,
  skipQuestion: checkerSkipQuestion,
  markOrSeparator: checkerMarkOrSeparator,
  checkedTodayCount: checkerCheckedTodayCount,
  myStats: checkerMyStats,
  leaderboard: checkerLeaderboard,
  getPreferences: checkerGetPreferences,
  setPreferences: checkerSetPreferences,
  questionContext: checkerQuestionContext,
  queueFacets: checkerQueueFacets,
  pictureUrl: checkerPictureUrl,
  myPapers: verifierMyPapers,
  paperQuestions: verifierPaperQuestions,
  nextInPaper: verifierNextInPaper,
  undoLast: verifierUndoLast,
  myProfile: verifierMyProfile,
  setMyProfile: verifierSetMyProfile,
  requestSubjects: verifierRequestSubjects,
  myAssignment: checkerMyAssignment,
  returnPaper: checkerReturnPaper,
  paperPages: paperPagePictures,
};

// ---------------------------------------------------------------------------
// Admin

export interface PaperQueueRow {
  paper_id: string;
  title: string;
  school: string;
  subject: string;
  cls: string;
  board: string;
  year: string;
  needs_review: boolean;
  is_published: boolean;
  incomplete_note: string | null;
  audit_paper_id: string | null;
  escalated_count: number;
  total_questions: number;
  passed_questions: number;
}

export async function adminPaperQueue(): Promise<PaperQueueRow[]> {
  // PostgREST caps every response at 1000 rows, RPCs included, so one call
  // silently returned 1000 of the 1,960 papers ("Needs review: 1000" instead
  // of 1,341). Page until a short page comes back.
  //
  // Paging needs a total order, or a page boundary can drop or repeat a row:
  // the function's own order tied on two audit copies of one paper. So the
  // pages are cut over an explicit (paper_id, audit_paper_id) order, and the
  // rows are merged to one per paper before anyone counts them
  // (paper-review-filter.ts has the whole story).
  const PAGE = 1000;
  const all: PaperQueueRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .rpc('admin_paper_queue' as never)
      .order('paper_id' as never, { ascending: true })
      .order('audit_paper_id' as never, { ascending: true, nullsFirst: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = rpcRows<PaperQueueRow>(data);
    all.push(...rows);
    if (rows.length < PAGE) return mergeQueueRows(all);
  }
}

export interface EscalationRow {
  question_id: string;
  paper_id: string;
  live_bank_paper_id: string | null;
  display_number: string | null;
  body: string;
  flag_reasons: string[];
  school: string | null;
  subject: string | null;
  cls: string | null;
  updated_at: string;
}

export async function adminEscalationQueue(): Promise<EscalationRow[]> {
  const { data, error } = await supabase.rpc('admin_escalation_queue' as never);
  if (error) throw error;
  return rpcRows<EscalationRow>(data);
}

export async function adminResolveEscalation(
  questionId: string,
  patch: { body?: string | null; display_number?: string | null; marks?: number | null } = {},
): Promise<void> {
  const { error } = await supabase.rpc('admin_resolve_escalation' as never, {
    p_question_id: questionId,
    p_body: patch.body ?? null,
    p_display_number: patch.display_number ?? null,
    p_marks: patch.marks ?? null,
  } as never);
  if (error) throw error;
}

export interface CheckerRow {
  user_id: string;
  email: string | null;
  active: boolean;
  granted_at: string;
  passed_count: number;
  fixed_count: number;
  split_count: number;
  escalated_count: number;
}

export interface CheckerLogRow {
  at: string;
  actor_user_id: string;
  actor_name: string;
  action: string;
  school: string | null;
  subject: string | null;
  cls: string | null;
  year: string | null;
  live_bank_paper_id: string | null;
  question_number: string | null;
  note: string | null;
}

/** Who did what, newest first (admin_checker_log, admin-only). */
export async function adminCheckerLog(limit = 300): Promise<CheckerLogRow[]> {
  const { data, error } = await supabase.rpc('admin_checker_log' as never, { p_limit: limit } as never);
  if (error) throw error;
  return rpcRows<CheckerLogRow>(data);
}

export async function adminListCheckers(): Promise<CheckerRow[]> {
  const { data, error } = await supabase.rpc('admin_list_checkers' as never);
  if (error) throw error;
  return rpcRows<CheckerRow>(data);
}

export async function adminGrantPaperChecker(userId: string): Promise<void> {
  const { error } = await supabase.rpc('admin_grant_paper_checker' as never, { p_user_id: userId } as never);
  if (error) throw error;
}

export async function adminRevokePaperChecker(userId: string): Promise<void> {
  const { error } = await supabase.rpc('admin_revoke_paper_checker' as never, { p_user_id: userId } as never);
  if (error) throw error;
}

export async function adminEditBankPaper(paperId: string, field: string, value: string): Promise<void> {
  const { error } = await supabase.rpc('admin_edit_bank_paper' as never, {
    p_paper_id: paperId,
    p_field: field,
    p_value: value,
  } as never);
  if (error) throw error;
}

export async function adminEditBankQuestion(questionId: string, field: string, value: string): Promise<void> {
  const { error } = await supabase.rpc('admin_edit_bank_question' as never, {
    p_question_id: questionId,
    p_field: field,
    p_value: value,
  } as never);
  if (error) throw error;
}

export async function adminHideBankPaper(paperId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('admin_hide_bank_paper' as never, {
    p_paper_id: paperId,
    p_reason: reason,
  } as never);
  if (error) throw error;
}

export async function adminRestoreBankPaper(paperId: string): Promise<void> {
  const { error } = await supabase.rpc('admin_restore_bank_paper' as never, { p_paper_id: paperId } as never);
  if (error) throw error;
}

export interface RevisionRow {
  id: number;
  table_name: 'bank_papers' | 'bank_questions';
  row_id: string;
  action: string;
  field: string | null;
  before: unknown;
  after: unknown;
  actor: string;
  source: string;
  reason: string | null;
  created_at: string;
}

export async function adminPaperHistory(paperId: string): Promise<RevisionRow[]> {
  const { data, error } = await supabase.rpc('admin_paper_history' as never, { p_paper_id: paperId } as never);
  if (error) throw error;
  return rpcRows<RevisionRow>(data);
}

export async function adminUndoRevision(revisionId: number, force = false): Promise<void> {
  const { error } = await supabase.rpc('admin_undo_revision' as never, {
    p_revision_id: revisionId,
    p_force: force,
  } as never);
  if (error) throw error;
}

export async function adminReapplyPaperToLive(auditPaperId: string): Promise<void> {
  const { error } = await supabase.rpc('admin_reapply_paper_to_live' as never, {
    p_audit_paper_id: auditPaperId,
  } as never);
  if (error) throw error;
}

export interface UserSearchRow {
  user_id: string;
  full_name: string | null;
  email: string | null;
  role: string | null;
  is_checker: boolean;
  checker_active: boolean;
}

export async function adminSearchUsers(query: string): Promise<UserSearchRow[]> {
  const { data, error } = await supabase.rpc('admin_search_users' as never, { p_query: query } as never);
  if (error) throw error;
  return rpcRows<UserSearchRow>(data);
}

export async function adminMergeBankQuestions(firstId: string, secondId: string): Promise<void> {
  const { error } = await supabase.rpc('admin_merge_bank_questions' as never, {
    p_first_id: firstId,
    p_second_id: secondId,
  } as never);
  if (error) throw error;
}

export async function adminDeleteBankQuestion(questionId: string): Promise<void> {
  const { error } = await supabase.rpc('admin_delete_bank_question' as never, { p_question_id: questionId } as never);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Admin paper edit page (W12, supabase/migrations/20260928170000_admin_paper_edit.sql).
// Edits go to the draft (audit_questions), never to bank_questions: Verify
// carries them to readers through the chokepoint.

export interface DraftRow {
  paper_id: string;
  school: string | null;
  subject: string | null;
  cls: string | null;
  board: string | null;
  year: string | null;
  exam: string | null;
  needs_review: boolean;
  is_published: boolean;
  incomplete_note: string | null;
  general_instructions: string | null;
  allowed_time_minutes: number | null;
  audit_paper_id: string | null;
  paper_passed: boolean | null;
  is_red: boolean | null;
  red_reason: string | null;
  /** File name of the printed paper (20260928230000); undefined before that migration. */
  source_pdf?: string | null;
  question_id: string | null;
  ord: number | null;
  kind: string | null;
  parent_id: string | null;
  number_path: string | null;
  display_number: string | null;
  body: string | null;
  options: { label?: string; text?: string }[] | null;
  marks: number | null;
  instructions: string | null;
  question_passed: boolean | null;
  status: string | null;
  review_bucket: string | null;
  flag_reasons: string[] | null;
  flag_detail: string | null;
  source: AuditQuestionSource | null;
  live_bank_question_id: string | null;
  updated_at: string | null;
}

export async function adminPaperDraft(paperId: string): Promise<DraftRow[]> {
  const { data, error } = await supabase.rpc('admin_paper_draft' as never, { p_paper_id: paperId } as never);
  if (error) throw error;
  return rpcRows<DraftRow>(data);
}

export interface SavedDraftQuestion {
  id: string;
  body: string;
  display_number: string | null;
  marks: number | null;
  updated_at: string;
}

/** Postgres SQLSTATE the save RPC raises when the stored text no longer
 *  matches what the page last saw (someone else changed it). */
export const DRAFT_CONFLICT_CODE = '40001';

export async function adminSaveDraftQuestion(
  questionId: string,
  fields: { body: string; display_number: string | null; marks: number | null },
  bodyBefore: string,
): Promise<SavedDraftQuestion | null> {
  const { data, error } = await supabase.rpc('admin_save_draft_question' as never, {
    p_question_id: questionId,
    p_body: fields.body,
    p_display_number: fields.display_number,
    p_marks: fields.marks,
    p_body_before: bodyBefore,
  } as never);
  if (error) throw error;
  return rpcRow<SavedDraftQuestion>(data);
}

export interface VerifyPaperResult {
  audit_paper_id: string;
  questions_total: number;
  questions_newly_passed: number;
  is_live: boolean;
  needs_review: boolean;
  is_published: boolean;
  skipped_count: number;
  unplaced_count: number;
  not_on_live_count: number;
  reason: string | null;
}

export async function adminVerifyPaper(paperId: string): Promise<VerifyPaperResult | null> {
  const { data, error } = await supabase.rpc('admin_verify_paper' as never, { p_paper_id: paperId } as never);
  if (error) throw error;
  return rpcRow<VerifyPaperResult>(data);
}

/** Signed URLs for many question snippets in ONE request (the Kid Mode page
 *  signs one at a time; a paper can have fifty questions). A missing file
 *  simply has no entry. Path shape '<paper_id>/<question_id>.png', as in
 *  audit_questions.source.snippet_object. */
export async function snippetUrls(auditPaperId: string, questionIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (questionIds.length === 0) return out;
  const paths = questionIds.map((id) => `${auditPaperId}/${id}.png`);
  const { data, error } = await supabase.storage.from('audit-figures').createSignedUrls(paths, 600);
  if (error || !data) return out;
  data.forEach((d, i) => {
    if (!d.error && d.signedUrl) out.set(questionIds[i], d.signedUrl);
  });
  return out;
}

/** True when a PostgREST error means the function is not on the server: the
 *  schema cache does not know it (PGRST202) or Postgres says it does not exist
 *  (42883). Anything else is a real failure, not a missing function. */
export function isMissingFunctionError(error: { code?: string | null } | null | undefined): boolean {
  const code = error?.code ?? '';
  return code === 'PGRST202' || code === '42883';
}

/** The Library's extra columns, one row per paper that has any: why it is
 *  hidden, how many questions wait with students and with an admin, and
 *  whether it is waiting in Ready to go live. Null ONLY when the server does
 *  not have admin_library_extras() yet (20261003130000_admin_queue_library.sql),
 *  so the Library still opens and says the extras are not available. Any other
 *  failure (a dropped connection, a refusal) throws, so the page can say the
 *  counts did not load instead of blaming a missing database change. */
export async function adminLibraryExtras(): Promise<LibraryExtra[] | null> {
  const { data, error } = await supabase.rpc('admin_library_extras' as never);
  if (error) {
    if (isMissingFunctionError(error)) return null;
    throw error;
  }
  return rpcRows<unknown>(data).map(normaliseExtra).filter((e): e is LibraryExtra => e !== null);
}
