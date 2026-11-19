/**
 * Where a paper is on its way to the site, in one set of words, for every screen that shows a paper:
 * the HOD desk lists, a checker's My papers cards and the admin publish screen.
 *
 * Pure (no Supabase, no React), so the words and the rules are tested without a login. The look (colour,
 * icon) is in src/components/PaperStatus.tsx; this file only says WHICH stage a paper is at, WHY it is stuck,
 * and which key moments it has been through.
 *
 * Nothing here reads the database. Each screen passes in the rows it already has.
 *
 * Who is right when two lists disagree (owner, 13 Nov 2026): for "approved" and "live" the WEBSITE's own paper data is
 * right (the ready list's is_live, the library's is_published, the approval dates); the laptop's list is only right for
 * reading, loading and pictures. So "Checked, waiting to go live" and "Live" are worked out from website rows alone,
 * and no laptop file is ever read here.
 */

import { checkShort, type HodCheck } from '@/lib/hod-publish';

/** A paper given to a checker with nothing done on it for this many days is "stuck". The only place the number lives. */
export const STUCK_DAYS = 7;

const DAY_MS = 86_400_000;

/** The five stages, in the order a paper moves through them. */
export type PaperStage = 'not_ready' | 'ready' | 'checking' | 'waiting' | 'live';

export const STAGE_ORDER: PaperStage[] = ['not_ready', 'ready', 'checking', 'waiting', 'live'];

export interface StageMeta {
  key: PaperStage;
  /** The words on a paper's label. */
  label: string;
  /** The shorter words on the strip of counts. */
  short: string;
  /** One plain sentence, shown as a tooltip and to screen readers. */
  hint: string;
}

export const STAGES: Record<PaperStage, StageMeta> = {
  not_ready: {
    key: 'not_ready',
    label: 'Not ready',
    short: 'Not ready',
    hint: 'Some pictures or printed pages are missing, so it cannot be given out yet.',
  },
  ready: {
    key: 'ready',
    label: 'Ready, waiting for a checker',
    short: 'Ready',
    hint: 'Every picture and page is in. Nobody has it yet, so it can be given out now.',
  },
  checking: {
    key: 'checking',
    label: 'Being checked',
    short: 'Being checked',
    hint: 'A checker has it and is going through the questions.',
  },
  waiting: {
    key: 'waiting',
    label: 'Checked, waiting to go live',
    short: 'Waiting approval',
    hint: 'Every question is settled. It waits for a yes before it goes on the site.',
  },
  live: {
    key: 'live',
    label: 'Live',
    short: 'Live',
    hint: 'On the site for visitors.',
  },
};

export function isPaperStage(v: unknown): v is PaperStage {
  return typeof v === 'string' && (STAGE_ORDER as string[]).includes(v);
}

/* ------------------------------------------------------------------ which stage, from rows a screen already has */

/** A paper in "Not ready to give out" (missing pictures or printed pages). */
export const stageOfHeldBack = (): PaperStage => 'not_ready';

/** A paper in "Papers nobody has": complete, waiting for a checker. */
export const stageOfFree = (): PaperStage => 'ready';

/** A paper a verifier holds. */
export const stageOfAssignment = (): PaperStage => 'checking';

/** A row of "Ready to go live": waiting for a yes, unless it is already on the site (an old paper being recorded). */
export function stageOfReady(p: { is_live?: boolean }): PaperStage {
  return p.is_live ? 'live' : 'waiting';
}

/** A paper in the library. Hidden papers have no stage: they are off the site on purpose. */
export function stageOfLive(p: { is_published: boolean }): PaperStage | null {
  return p.is_published ? 'live' : null;
}

/** A checker's own card: still questions to do is "Being checked"; nothing left to do waits for the HOD. */
export function stageOfCheckerCard(p: { remaining: number }): PaperStage {
  return p.remaining > 0 ? 'checking' : 'waiting';
}

const questionWord = (n: number) => `${n} ${n === 1 ? 'question' : 'questions'}`;

/** The plain line on a checker's card: how close it is, and what it is waiting for. */
export function checkerCardLine(p: { remaining: number; with_hod: number }): string {
  if (p.remaining > 0) {
    return p.with_hod > 0 ? `${questionWord(p.remaining)} left for you. ${questionWord(p.with_hod)} waiting for the HOD.` : `${questionWord(p.remaining)} left for you.`;
  }
  return p.with_hod > 0
    ? `Your part is done. ${questionWord(p.with_hod)} waiting for the HOD.`
    : 'Your part is done. It waits for approval before it goes live.';
}

/** A row of the admin publish queue: an old live paper stays "Live"; a new one with questions open is still being checked. */
export function stageOfApprovalRow(p: { open: number; kind: 'new' | 'retro' }): PaperStage {
  if (p.kind === 'retro') return 'live';
  return p.open > 0 ? 'checking' : 'waiting';
}

/* ------------------------------------------------------------------ why it is stuck, in plain words */

/** Whole days from `iso` to `now`; null for a missing or unreadable date. */
export function daysSince(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / DAY_MS));
}

const dayWord = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;

/** One paper's last action by its holder (hod_paper_activity): null when the holder has done nothing on it yet. */
export interface PaperActivity {
  audit_paper_id: string;
  user_id: string;
  last_action_at: string | null;
}

/** paper:holder -> last action time. */
export type ActivityLookup = Map<string, string | null>;

export const activityKey = (paperId: string, userId: string) => `${paperId}:${userId}`;

export function activityLookup(rows: PaperActivity[]): ActivityLookup {
  return new Map(rows.map((r) => [activityKey(r.audit_paper_id, r.user_id), r.last_action_at]));
}

/**
 * Why a paper a checker holds is stuck, or null when it is not.
 * "Stuck" means nothing done on it for STUCK_DAYS days.
 *
 * With `activity` (the server's last-action times) the answer is exact. Without it (the server function is
 * not there yet) only a paper the holder has never started can be judged, because a started paper may well
 * have been worked on last night; saying "stuck" about it would be a false alarm.
 */
export function stuckReason(
  a: { paper_id: string; user_id: string; checker_name: string | null; assigned_at: string | null; started_at: string | null; remaining?: number },
  activity: ActivityLookup | null,
  now: Date,
): string | null {
  // Nothing left for the checker to do: the rest waits for an HOD, so it is never the checker who is stuck
  // (found 13 Nov 2026: 32 papers were blamed on checkers who had finished their part; see waitingForHodReason).
  if (a.remaining === 0) return null;
  const who = a.checker_name?.trim() || 'The checker';
  let lastAction: string | null;
  let baseline: string | null;
  if (activity) {
    lastAction = activity.get(activityKey(a.paper_id, a.user_id)) ?? null;
    baseline = lastAction ?? a.assigned_at;
  } else {
    if (a.started_at) return null;
    lastAction = null;
    baseline = a.assigned_at;
  }
  const days = daysSince(baseline, now);
  if (days === null || days < STUCK_DAYS) return null;
  return lastAction ? `${who} has done nothing on this for ${dayWord(days)}.` : `${who} was given this ${dayWord(days)} ago and has not started it.`;
}

/**
 * A paper a checker holds, with nothing left for the checker, for STUCK_DAYS days or more: the checker has finished their
 * part and the questions still open wait for an HOD to decide (the "Needs you" tab). The 7-day automatic return leaves
 * these alone on purpose, so this is the HOD's to clear, not the checker's fault. Null when it does not apply.
 */
export function waitingForHodReason(
  a: { checker_name: string | null; assigned_at: string | null; remaining?: number },
  now: Date,
): string | null {
  if (a.remaining !== 0) return null;
  const days = daysSince(a.assigned_at, now);
  if (days === null || days < STUCK_DAYS) return null;
  const who = a.checker_name?.trim() || 'The checker';
  return `${who} has finished their part. The questions that are left wait for an HOD to decide (open Needs you).`;
}

/** Why a paper waiting for a yes is held up, or null. A failing check or a long wait. */
export function waitingReason(p: { checks?: HodCheck[]; queued_at: string | null; is_live?: boolean }, now: Date): string | null {
  if (p.is_live) return null;
  const parts: string[] = [];
  const failing = (p.checks ?? []).filter((c) => !c.ok).map((c) => checkShort(c.key));
  if (failing.length > 0) parts.push(`These checks are not passing yet: ${failing.join(', ')}.`);
  const days = daysSince(p.queued_at, now);
  if (days !== null && days >= STUCK_DAYS) parts.push(`It has waited for a yes for ${dayWord(days)}.`);
  return parts.length > 0 ? parts.join(' ') : null;
}

/** One line in a "Needs attention" group. */
export interface AttentionItem {
  key: string;
  stage: PaperStage;
  label: string;
  reason: string;
}

/* ------------------------------------------------------------------ key moments of one paper */

export type MomentKey = 'loaded' | 'pictures' | 'given' | 'finished' | 'approved' | 'live';

/** The dates of the key moments. A moment not recorded (or not reached yet) is null. */
export type PaperMoments = Record<`${MomentKey}_at`, string | null>;

export const EMPTY_MOMENTS: PaperMoments = {
  loaded_at: null,
  pictures_at: null,
  given_at: null,
  finished_at: null,
  approved_at: null,
  live_at: null,
};

/** The six key moments, in order. Not every click: only these. */
export const MOMENTS: { key: MomentKey; label: string }[] = [
  { key: 'loaded', label: 'Loaded' },
  { key: 'pictures', label: 'Pictures complete' },
  { key: 'given', label: 'Given to a checker' },
  { key: 'finished', label: 'Finished by checkers' },
  { key: 'approved', label: 'Approved' },
  { key: 'live', label: 'Live' },
];

export interface TimelineStep {
  key: MomentKey;
  label: string;
  /** The date, when it is recorded. A step can be done without one. */
  at: string | null;
  state: 'done' | 'current' | 'later';
}

/** How many steps a stage has already passed (the index of the last one done). */
const REACHED: Record<PaperStage, number> = { not_ready: 0, ready: 1, checking: 2, waiting: 3, live: 5 };

/**
 * The key moments with each one marked done, current or later. A step is done when it has a date, or when the
 * paper's stage shows it must have happened (a paper being checked has certainly been loaded and had its pictures
 * stored, even if the date was not kept). The first step not done is the current one: where the paper is stuck or moving.
 */
export function buildTimeline(moments: PaperMoments, stage: PaperStage): TimelineStep[] {
  const reached = REACHED[stage];
  let currentSet = false;
  return MOMENTS.map((m, i) => {
    const at = moments[`${m.key}_at`] ?? null;
    const done = at !== null || i <= reached;
    if (done) return { key: m.key, label: m.label, at, state: 'done' as const };
    if (!currentSet) {
      currentSet = true;
      return { key: m.key, label: m.label, at: null, state: 'current' as const };
    }
    return { key: m.key, label: m.label, at: null, state: 'later' as const };
  });
}

/** True when a finished step has no date to show, so the screen can say the date was not kept. */
export function hasUndatedSteps(steps: TimelineStep[]): boolean {
  return steps.some((s) => s.state === 'done' && s.at === null);
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

/** One row of hod_paper_timeline(). A missing or odd answer is null, so the screen falls back to what it already has. */
export function normaliseMoments(raw: unknown): PaperMoments | null {
  const row = Array.isArray(raw) ? raw[0] : raw;
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  const out: PaperMoments = {
    loaded_at: str(r.loaded_at),
    pictures_at: str(r.pictures_at),
    given_at: str(r.given_at),
    finished_at: str(r.finished_at),
    approved_at: str(r.approved_at),
    live_at: str(r.live_at),
  };
  return Object.values(out).some((v) => v !== null) ? out : null;
}

/** The rows of hod_paper_activity(). Rows without both ids are skipped. */
export function normaliseActivity(raw: unknown): PaperActivity[] {
  const out: PaperActivity[] = [];
  if (!Array.isArray(raw)) return out;
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue;
    const r = x as Record<string, unknown>;
    const paper = str(r.audit_paper_id);
    const user = str(r.user_id);
    if (!paper || !user) continue;
    out.push({ audit_paper_id: paper, user_id: user, last_action_at: str(r.last_action_at) });
  }
  return out;
}

/** A short date for a timeline step, for example "12 Nov". Empty for a missing or unreadable date. */
export function shortDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/* ------------------------------------------------------------------ the strip of counts */

/** The ?stage= in the address, so a filtered list can be linked to and Back works. Unknown values mean "no filter". */
export const STAGE_PARAM = 'stage';

export function parseStageParam(v: string | null): PaperStage | null {
  return isPaperStage(v) ? v : null;
}

/** Which desk tab lists each stage. The first three are lists on the Assignments tab; the other two have their own. */
export const STAGE_TAB: Record<PaperStage, 'assignments' | 'ready' | 'live'> = {
  not_ready: 'assignments',
  ready: 'assignments',
  checking: 'assignments',
  waiting: 'ready',
  live: 'live',
};
