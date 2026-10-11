import { supabase } from '@/integrations/supabase/client';
import { PROCESSED_STATES, STATE_LOOK, type ProcessedState } from '@/lib/paper-registry';

/* The papers route on /admin/pipeline: where every paper is right now, from
   the folder to the live site (owner, 11 October 2026).

   One admin-only RPC, admin_pipeline_route(), returns counts only. No question
   text, no names, no contacts reach this page. This file is the shapes and the
   small pure helpers (normalising, the list of stops, lane motion, the number
   tween, the "updated ... ago" words), kept out of the components so the
   arithmetic has tests.

   The rule for a number that did not load: it is never shown as 0. A payload
   that is not an object, or that is missing one of its four sections, throws
   in normaliseRoute, so the page keeps the last numbers it had and says so. */

/* ------------------------------------------------------------------ shapes */

export type PileKey = 'kid' | 'admin' | 'data' | 'renderer' | 'none';
export const PILE_KEYS: readonly PileKey[] = ['kid', 'admin', 'data', 'renderer', 'none'];

export type BandKey = '1-5' | '6-15' | '16-40' | '41+';
export const BAND_KEYS: readonly BandKey[] = ['1-5', '6-15', '16-40', '41+'];

export type DeskStatus = 'pending' | 'in_review' | 'passed' | 'red';

type StateCounts = Record<ProcessedState, number>;
type PileCounts = Record<PileKey, number>;

/** The route, every number a whole number of 0 or more. A key the database left out is 0. */
export interface PipelineRoute {
  generatedAt: string | null;
  registry: {
    total: number;
    excluded: number;
    byState: StateCounts;
    frozenByState: StateCounts;
    lastUpdatedAt: string | null;
  };
  desk: {
    papers: number;
    byStatus: Record<DeskStatus, number>;
    swarmPapers: number;
    swarmQuestions: number;
    questions: number;
    questionsPassed: number;
  };
  open: {
    questionsByPile: PileCounts;
    papersByPile: PileCounts;
    studentBands: Record<BandKey, number>;
  };
  checkers: {
    papersAssigned: number;
    activeVerifiers: number;
  };
}

export interface PipelineRouteApi {
  route(): Promise<PipelineRoute>;
}

/* ------------------------------------------------------------- normalising */

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function isObject(v: unknown): boolean {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function counts<K extends string>(keys: readonly K[], raw: unknown): Record<K, number> {
  const r = rec(raw);
  return Object.fromEntries(keys.map((k) => [k, num(r[k])])) as Record<K, number>;
}

function text(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null;
}

const DESK_STATUSES: readonly DeskStatus[] = ['pending', 'in_review', 'passed', 'red'];

/** Turns the RPC's jsonb into a PipelineRoute. Throws when the payload is not the route at all. */
export function normaliseRoute(raw: unknown): PipelineRoute {
  const r = rec(raw);
  if (!isObject(r.registry) || !isObject(r.desk) || !isObject(r.open) || !isObject(r.checkers)) {
    throw new Error('The pipeline route came back incomplete.');
  }
  const registry = rec(r.registry);
  const desk = rec(r.desk);
  const open = rec(r.open);
  const checkers = rec(r.checkers);
  return {
    generatedAt: text(r.generated_at),
    registry: {
      total: num(registry.total),
      excluded: num(registry.excluded),
      byState: counts(PROCESSED_STATES, registry.by_state),
      frozenByState: counts(PROCESSED_STATES, registry.frozen_by_state),
      lastUpdatedAt: text(registry.last_updated_at),
    },
    desk: {
      papers: num(desk.papers),
      byStatus: counts(DESK_STATUSES, desk.papers_by_status),
      swarmPapers: num(desk.swarm_papers),
      swarmQuestions: num(desk.swarm_questions),
      questions: num(desk.questions),
      questionsPassed: num(desk.questions_passed),
    },
    open: {
      questionsByPile: counts(PILE_KEYS, open.questions_by_pile),
      papersByPile: counts(PILE_KEYS, open.papers_by_pile),
      studentBands: counts(BAND_KEYS, open.student_papers_by_questions_left),
    },
    checkers: {
      papersAssigned: num(checkers.papers_assigned),
      activeVerifiers: num(checkers.active_verifiers),
    },
  };
}

/** The real read. A refusal comes back as a 42501 error and is thrown, so the page keeps its last numbers. */
export async function fetchPipelineRoute(): Promise<PipelineRoute> {
  const { data, error } = await supabase.rpc('admin_pipeline_route' as never);
  if (error) throw error;
  return normaliseRoute(data);
}

export const realPipelineRouteApi: PipelineRouteApi = { route: fetchPipelineRoute };

/* ------------------------------------------------------------------- stops */

export type MainStopId =
  | 'folder'
  | 'waiting'
  | 'read'
  | 'swarm'
  | 'desk'
  | 'ai'
  | 'students'
  | 'admin'
  | 'approval'
  | 'live';
export type SideStopId = 'data' | 'renderer' | 'none';
export type StopId = MainStopId | 'leftOut' | SideStopId;

export type RouteAction =
  /** Filters the paper list on this page to these states (none = every paper) and scrolls to it. */
  | { kind: 'filter'; states: ProcessedState[]; label: string }
  /** Opens the admin page that lists these papers. */
  | { kind: 'link'; href: string; label: string };

export interface StopLook {
  /** Solid colour: the dots on the lane and the stripe. */
  bar: string;
  /** Badge fill and text (readable pairs). */
  pill: string;
}

const SLATE: StopLook = { bar: 'bg-slate-400', pill: 'bg-slate-100 text-slate-900' };

export const STOP_LOOK: Record<StopId, StopLook> = {
  folder: { bar: 'bg-slate-500', pill: 'bg-slate-100 text-slate-900' },
  leftOut: SLATE,
  waiting: STATE_LOOK.ocr_queued,
  read: STATE_LOOK.ocr_done,
  swarm: { bar: 'bg-teal-500', pill: 'bg-teal-100 text-teal-900' },
  desk: STATE_LOOK.loaded,
  ai: STATE_LOOK.ai_checked,
  students: { bar: 'bg-orange-400', pill: 'bg-orange-100 text-orange-900' },
  admin: { bar: 'bg-pink-500', pill: 'bg-pink-100 text-pink-900' },
  data: SLATE,
  renderer: SLATE,
  none: SLATE,
  approval: STATE_LOOK.awaiting_approval,
  live: STATE_LOOK.live,
};

export interface BandRow {
  key: BandKey;
  /** "1 to 5 left": how many questions are left on each paper in this group. */
  label: string;
  count: number;
}

export interface RouteStop {
  id: StopId;
  track: 'main' | 'siding' | 'side';
  /** 1 to 10 along the main route; null for the siding and the side stops. */
  step: number | null;
  title: string;
  /** One line in plain words. */
  meaning: string;
  count: number;
  unit: 'papers';
  /** Small lines under the number. */
  facts: string[];
  look: StopLook;
  action: RouteAction | null;
  /** Only the student checkers stop: how many papers have how many questions left. */
  bands?: BandRow[];
}

const BAND_LABEL: Record<BandKey, string> = {
  '1-5': '1 to 5 left',
  '6-15': '6 to 15 left',
  '16-40': '16 to 40 left',
  '41+': '41 or more left',
};

/** "1 paper", "2 papers". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${fmt(n)} ${n === 1 ? one : many}`;
}

/** 26665 -> "26,665". Fixed locale so the same number reads the same everywhere. */
export function fmt(n: number): string {
  return n.toLocaleString('en-IN');
}

/** The ten stops of the main route, in order. */
export function buildMainStops(route: PipelineRoute): RouteStop[] {
  const { registry, desk, open, checkers } = route;
  const s = registry.byState;
  const studentsPapers = open.papersByPile.kid;

  const deskFacts = (
    [
      ['pending', 'waiting for a first check'],
      ['in_review', 'in review'],
      ['passed', 'passed'],
      ['red', 'flagged red'],
    ] as const
  )
    .filter(([k]) => desk.byStatus[k] > 0)
    .map(([k, w]) => `${fmt(desk.byStatus[k])} ${w}`);

  return [
    {
      id: 'folder',
      track: 'main',
      step: 1,
      title: 'In the folder',
      meaning: 'Every paper PDF we know about, started or not.',
      count: registry.total,
      unit: 'papers',
      facts: registry.excluded > 0 ? [`${fmt(registry.excluded)} not real papers, not counted`] : [],
      look: STOP_LOOK.folder,
      action: { kind: 'filter', states: [], label: 'Show every paper in the list' },
    },
    {
      id: 'waiting',
      track: 'main',
      step: 2,
      title: 'Waiting to be read',
      meaning: 'Nobody has started them, or they are in the reading queue.',
      count: s.not_started + s.ocr_queued,
      unit: 'papers',
      facts: [`${fmt(s.not_started)} not started`, `${fmt(s.ocr_queued)} in the reading queue`],
      look: STOP_LOOK.waiting,
      action: { kind: 'filter', states: ['not_started', 'ocr_queued'], label: 'Show the not started papers and the reading queue in the list' },
    },
    {
      id: 'read',
      track: 'main',
      step: 3,
      title: 'Read',
      meaning: 'The pages are read. They are not on the checking desk yet.',
      count: s.ocr_done,
      unit: 'papers',
      facts: [],
      look: STOP_LOOK.read,
      action: { kind: 'filter', states: ['ocr_done'], label: 'Show these papers in the list' },
    },
    {
      id: 'swarm',
      track: 'main',
      step: 4,
      title: 'Cleaned by the Haiku swarm',
      meaning: 'The Haiku helpers have tidied these papers.',
      count: desk.swarmPapers,
      unit: 'papers',
      facts: [`${plural(desk.swarmQuestions, 'question')} cleaned`],
      look: STOP_LOOK.swarm,
      action: null,
    },
    {
      id: 'desk',
      track: 'main',
      step: 5,
      title: 'On the checking desk',
      meaning: 'Loaded and waiting for checks, or being checked.',
      count: desk.papers,
      unit: 'papers',
      facts: deskFacts,
      look: STOP_LOOK.desk,
      action: null,
    },
    {
      id: 'ai',
      track: 'main',
      step: 6,
      title: 'AI checked',
      meaning: 'The AI pass is done. People still have questions to clear.',
      count: s.ai_checked,
      unit: 'papers',
      facts: [],
      look: STOP_LOOK.ai,
      action: { kind: 'filter', states: ['ai_checked'], label: 'Show these papers in the list' },
    },
    {
      id: 'students',
      track: 'main',
      step: 7,
      title: 'With student checkers',
      meaning: 'Students are working through the questions left.',
      count: studentsPapers,
      unit: 'papers',
      facts: [
        `${plural(open.questionsByPile.kid, 'question')} left`,
        `${plural(checkers.activeVerifiers, 'checker')} active`,
        `${plural(checkers.papersAssigned, 'paper')} handed out`,
      ],
      look: STOP_LOOK.students,
      action: { kind: 'link', href: '/admin/checkers', label: 'Open the checkers page' },
      bands: BAND_KEYS.map((key) => ({ key, label: BAND_LABEL[key], count: open.studentBands[key] })),
    },
    {
      id: 'admin',
      track: 'main',
      step: 8,
      title: 'With the admin',
      meaning: 'Questions only an admin can settle.',
      count: open.papersByPile.admin,
      unit: 'papers',
      facts: [`${plural(open.questionsByPile.admin, 'question')} left`],
      look: STOP_LOOK.admin,
      action: { kind: 'link', href: '/admin/admin-queue', label: 'Open the admin queue' },
    },
    {
      id: 'approval',
      track: 'main',
      step: 9,
      title: 'Waiting for your approval',
      meaning: 'Fully checked. They need you to approve them before they go live.',
      count: s.awaiting_approval + s.fully_checked,
      unit: 'papers',
      facts: [`${fmt(s.awaiting_approval)} ready to approve`, `${fmt(s.fully_checked)} fully checked`],
      look: STOP_LOOK.approval,
      action: { kind: 'link', href: '/admin/paper-approvals', label: 'Open the approvals page' },
    },
    {
      id: 'live',
      track: 'main',
      step: 10,
      title: 'Live',
      meaning: 'On the site for visitors to read.',
      count: s.live,
      unit: 'papers',
      facts: [],
      look: STOP_LOOK.live,
      action: { kind: 'link', href: '/admin/library', label: 'Open the library' },
    },
  ];
}

/** Total of a frozen_by_state map. */
export function frozenTotal(route: PipelineRoute): number {
  return PROCESSED_STATES.reduce((n, k) => n + route.registry.frozenByState[k], 0);
}

/** The siding: papers set aside on purpose (the Maths hold). It never joins the counts on the main route. */
export function buildSiding(route: PipelineRoute): RouteStop {
  const f = route.registry.frozenByState;
  return {
    id: 'leftOut',
    track: 'siding',
    step: null,
    title: 'Left out',
    meaning: 'Maths papers held back on purpose. They are not in the counts on the route.',
    count: frozenTotal(route),
    unit: 'papers',
    facts: [`${fmt(f.live)} of them are already live`, `${fmt(f.not_started + f.ocr_queued)} not read yet`],
    look: STOP_LOOK.leftOut,
    action: null,
  };
}

/** The three smaller piles beside the admin stop: questions that cannot go to students or the admin yet. */
export function buildSideStops(route: PipelineRoute): RouteStop[] {
  const { papersByPile, questionsByPile } = route.open;
  const side = (id: SideStopId, title: string, meaning: string): RouteStop => ({
    id,
    track: 'side',
    step: null,
    title,
    meaning,
    count: papersByPile[id],
    unit: 'papers',
    facts: [`${plural(questionsByPile[id], 'question')}`],
    look: STOP_LOOK[id],
    action: null,
  });
  return [
    side('data', 'Held for data fixes', 'Waiting for a fix to the data behind them.'),
    side('renderer', 'Held for the renderer', 'Waiting for the page drawing to be fixed.'),
    side('none', 'Not yet sorted', 'Nobody has decided who checks these yet.'),
  ];
}

/* ------------------------------------------------------------ the progress */

export interface QuestionsProgress {
  cleared: number;
  total: number;
  /** Whole percent, never above 100, 0 when there are no questions. */
  percent: number;
}

export function questionsProgress(route: PipelineRoute): QuestionsProgress {
  const total = route.desk.questions;
  const cleared = Math.min(route.desk.questionsPassed, total);
  return { cleared, total, percent: total > 0 ? Math.round((cleared / total) * 100) : 0 };
}

/* -------------------------------------------------------------------- lanes */

/** The biggest count on the main route, the yardstick every lane is measured against. */
export function maxFlow(stops: RouteStop[]): number {
  return stops.reduce((m, s) => Math.max(m, s.count), 0);
}

export interface LaneMotion {
  /** Parcels travelling along the lane. 0 = the lane is still. */
  dots: number;
  /** Seconds one parcel takes to cross. Longer is calmer. */
  seconds: number;
}

/** More papers means a few more parcels, a little quicker. Log scale, so 8,000 does not drown out 80. Always calm: 1 to 4 parcels, 3 to 7 seconds. */
export function laneMotion(count: number, max: number): LaneMotion {
  if (!(count > 0) || !(max > 0)) return { dots: 0, seconds: 0 };
  const share = Math.min(1, Math.log1p(count) / Math.log1p(max));
  return { dots: 1 + Math.round(share * 3), seconds: Math.round((7 - share * 4) * 10) / 10 };
}

/* -------------------------------------------------------------------- tween */

/** Starts quick and settles, so a changed number lands rather than jumps. */
export function easeOutCubic(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - c, 3);
}

/** The whole number shown part-way (progress 0 to 1) from one count to the next. Lands exactly on `to`. */
export function tweenValue(from: number, to: number, progress: number): number {
  if (progress >= 1) return to;
  if (progress <= 0) return from;
  return Math.round(from + (to - from) * easeOutCubic(progress));
}

/* ------------------------------------------------------------------ "ago" */

/** "just now", "12 seconds ago", "3 minutes ago". For the line under the title, ticked once a second. */
export function updatedWords(elapsedMs: number): string {
  const s = Math.max(0, Math.floor(elapsedMs / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s} seconds ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return m === 1 ? '1 minute ago' : `${m} minutes ago`;
  const h = Math.floor(m / 60);
  return h === 1 ? '1 hour ago' : `${h} hours ago`;
}
