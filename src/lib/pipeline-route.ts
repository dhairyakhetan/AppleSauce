import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { PROCESSED_STATES, STATE_LOOK, type ProcessedState } from '@/lib/paper-registry';

/* The papers route on the pipeline overview: where every paper is right now,
   from the PDF saved on the main computer to the live site (owner, 11 and 12
   October 2026).

   One RPC, admin_pipeline_route(), returns counts only. It is open to HODs and
   admins (the function checks is_hod(), an admin counts). No question text, no
   names, no contacts reach this page. This file is the shapes and the small
   pure helpers (normalising, the list of stops for each audience, lane motion,
   the number tween, the freshness words), kept out of the components so the
   arithmetic has tests.

   The route reads in the words the HOD desk uses:
     PDFs saved on the main computer -> Read by the AI -> Pictures waiting ->
     Checking by students -> Needs you -> Ready to go live -> Live
   Papers copied from the earlier library are kept back and are never in those
   counts; they are set aside.

   The rule for a number that did not load: it is never shown as 0. A payload
   that is not an object, or that is missing one of its four core sections,
   throws in normaliseRoute, so the page keeps the last numbers it had and says
   so. A newer section that an older database does not send (pictures, trust,
   the drive count) comes back as null and its stop shows "?". */

/** The machine the desk runs on, in plain words. One place, so every screen says it the same way. */
export const COMPUTER_LABEL = 'the main computer';

/** Which desk is looking: admins see every link, HODs only the ones they can open. */
export type Audience = 'admin' | 'hod';

/* ------------------------------------------------------------------ shapes */

export type PileKey = 'kid' | 'escalated' | 'admin' | 'data' | 'renderer' | 'none';
export const PILE_KEYS: readonly PileKey[] = ['kid', 'escalated', 'admin', 'data', 'renderer', 'none'];

export type BandKey = '1-5' | '6-15' | '16-40' | '41+';
export const BAND_KEYS: readonly BandKey[] = ['1-5', '6-15', '16-40', '41+'];

export type DeskStatus = 'pending' | 'in_review' | 'passed' | 'red';

type StateCounts = Record<ProcessedState, number>;
type PileCounts = Record<PileKey, number>;

export interface TrustLevel {
  level: string;
  decision: string;
  checked: number;
  agreed: number;
  waiting: number;
  trusted: boolean;
}

export interface PictureQueue {
  queuedPapers: number;
  queuedPictures: number;
  queuedBytes: number;
  awaitingRouteQuestions: number;
  awaitingRoutePictures: number;
  awaitingRouteBytes: number;
  storageUsedBytes: number | null;
  storageCapBytes: number | null;
}

export interface DriveSummary {
  totalPdfs: number;
  classified: number;
  unclassified: number;
  setAside: number;
  bytesTotal: number | null;
}

/** The route, every number a whole number of 0 or more. A key the database left out is 0; a whole section it left out is null. */
export interface PipelineRoute {
  generatedAt: string | null;
  registry: {
    total: number;
    excluded: number;
    /** Current stage only: each paper of the new route is in exactly one of these. */
    byState: StateCounts;
    frozenByState: StateCounts;
    /** Papers read and on the checking desk but not fully checked yet (loaded or checked by the AI), split by whether the swarm has read them. null = the database did not send it. */
    swarmRead: { papers: number; deskWithoutSwarm: number } | null;
    lastUpdatedAt: string | null;
  };
  /** Papers the desk has no PDF for: desk papers with no PDF recorded, and live library papers no desk paper points at. null = not sent. These are never part of the PDF count on the computer. */
  noPdf: { auditPapers: number; liveOnly: number } | null;
  desk: {
    papers: number;
    byStatus: Record<DeskStatus, number>;
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
  checking: { questions: number; papers: number } | null;
  needsYou: { questions: number; papers: number; escalatedQuestions: number; adminQuestions: number } | null;
  ready: { papers: number; canGoLive: number; leftOutQuestions: number } | null;
  live: { total: number; hidden: number; onRoute: number } | null;
  trust: {
    checksDone: number;
    agreed: number;
    changed: number;
    threshold: number;
    reached: boolean;
    agreementRate: number | null;
    levels: TrustLevel[];
  } | null;
  /** The picture backlog the desk synced, or null when it has not synced yet. */
  pictures: PictureQueue | null;
  /** The PDFs the desk counted on the computer, or null when it has not synced yet. */
  drive: DriveSummary | null;
  synced: {
    deskSyncedAt: string | null;
    driveSyncedAt: string | null;
    registryChangedAt: string | null;
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

/** A number that may be missing: null stays null (a size the desk could not read is not 0 bytes). */
function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
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

function normaliseTrust(raw: unknown): PipelineRoute['trust'] {
  if (!isObject(raw)) return null;
  const t = rec(raw);
  const levels = Array.isArray(t.levels) ? t.levels : [];
  const rawRate = t.agreement_rate === null || t.agreement_rate === undefined ? NaN : Number(t.agreement_rate);
  const rate = Number.isFinite(rawRate) && rawRate >= 0 && rawRate <= 1 ? rawRate : null;
  return {
    checksDone: num(t.checks_done),
    agreed: num(t.agreed),
    changed: num(t.changed),
    threshold: num(t.threshold) || 100,
    reached: t.reached === true,
    agreementRate: rate,
    levels: levels.filter(isObject).map((l) => {
      const r = rec(l);
      return {
        level: typeof r.level === 'string' ? r.level : '',
        decision: typeof r.decision === 'string' ? r.decision : '',
        checked: num(r.checked),
        agreed: num(r.agreed),
        waiting: num(r.waiting),
        trusted: r.trusted === true,
      };
    }),
  };
}

function normalisePictures(raw: unknown): PictureQueue | null {
  if (!isObject(raw)) return null;
  const p = rec(raw);
  return {
    queuedPapers: num(p.queued_papers),
    queuedPictures: num(p.queued_pictures),
    queuedBytes: num(p.queued_bytes),
    awaitingRouteQuestions: num(p.awaiting_route_questions),
    awaitingRoutePictures: num(p.awaiting_route_pictures),
    awaitingRouteBytes: num(p.awaiting_route_bytes),
    storageUsedBytes: numOrNull(p.storage_used_bytes),
    storageCapBytes: numOrNull(p.storage_cap_bytes),
  };
}

function normaliseDrive(raw: unknown): DriveSummary | null {
  if (!isObject(raw)) return null;
  const d = rec(raw);
  // A row without a total is not a count of anything.
  const total = numOrNull(d.total_pdfs);
  if (total === null) return null;
  return {
    totalPdfs: total,
    classified: num(d.classified),
    unclassified: num(d.unclassified),
    setAside: num(d.set_aside),
    bytesTotal: numOrNull(d.bytes_total),
  };
}

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
  const checking = isObject(r.checking) ? rec(r.checking) : null;
  const needs = isObject(r.needs_you) ? rec(r.needs_you) : null;
  const ready = isObject(r.ready) ? rec(r.ready) : null;
  const live = isObject(r.live) ? rec(r.live) : null;
  const synced = rec(r.synced);
  return {
    generatedAt: text(r.generated_at),
    registry: {
      total: num(registry.total),
      excluded: num(registry.excluded),
      byState: counts(PROCESSED_STATES, registry.by_state),
      frozenByState: counts(PROCESSED_STATES, registry.frozen_by_state),
      swarmRead: isObject(registry.swarm_read)
        ? { papers: num(rec(registry.swarm_read).papers), deskWithoutSwarm: num(rec(registry.swarm_read).desk_without_swarm) }
        : null,
      lastUpdatedAt: text(registry.last_updated_at),
    },
    noPdf: isObject(r.no_pdf) ? { auditPapers: num(rec(r.no_pdf).audit_papers), liveOnly: num(rec(r.no_pdf).live_only) } : null,
    desk: {
      papers: num(desk.papers),
      byStatus: counts(DESK_STATUSES, desk.papers_by_status),
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
    checking: checking ? { questions: num(checking.questions), papers: num(checking.papers) } : null,
    needsYou: needs
      ? {
          questions: num(needs.questions),
          papers: num(needs.papers),
          escalatedQuestions: num(needs.escalated_questions),
          adminQuestions: num(needs.admin_questions),
        }
      : null,
    ready: ready
      ? { papers: num(ready.papers), canGoLive: num(ready.can_go_live), leftOutQuestions: num(ready.left_out_questions) }
      : null,
    live: live ? { total: num(live.total), hidden: num(live.hidden), onRoute: num(live.on_route) } : null,
    trust: normaliseTrust(r.trust),
    pictures: normalisePictures(r.pictures),
    drive: normaliseDrive(r.drive),
    synced: {
      deskSyncedAt: text(synced.desk_synced_at),
      driveSyncedAt: text(synced.drive_synced_at),
      registryChangedAt: text(synced.registry_changed_at) ?? text(registry.last_updated_at),
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

export type MainStopId = 'computer' | 'read' | 'pictures' | 'students' | 'needsYou' | 'ready' | 'live';
export type SideStopId = 'data' | 'renderer' | 'none';
export type StopId = MainStopId | 'leftOut' | SideStopId;

export type RouteAction =
  /** Filters the paper list on this page to these states (none = every paper) and scrolls to it. The list is on the admin and the HOD pipeline pages. */
  | { kind: 'filter'; states: ProcessedState[]; label: string }
  /** Opens the page that lists these papers. */
  | { kind: 'link'; href: string; label: string };

export interface StopLook {
  /** Solid colour: the dots on the lane and the stripe. */
  bar: string;
  /** Badge fill and text (readable pairs). */
  pill: string;
}

const SLATE: StopLook = { bar: 'bg-slate-400', pill: 'bg-slate-100 text-slate-900' };

export const STOP_LOOK: Record<StopId, StopLook> = {
  computer: { bar: 'bg-slate-500', pill: 'bg-slate-100 text-slate-900' },
  leftOut: SLATE,
  read: { bar: 'bg-teal-500', pill: 'bg-teal-100 text-teal-900' },
  pictures: STATE_LOOK.ocr_queued,
  students: { bar: 'bg-orange-400', pill: 'bg-orange-100 text-orange-900' },
  needsYou: { bar: 'bg-pink-500', pill: 'bg-pink-100 text-pink-900' },
  data: SLATE,
  renderer: SLATE,
  none: SLATE,
  ready: STATE_LOOK.awaiting_approval,
  live: STATE_LOOK.live,
};

export interface BandRow {
  key: BandKey;
  /** "1 to 5 left": how many questions are left on each paper in this group. */
  label: string;
  count: number;
}

/** A label and a figure under the stop's headline number. */
export interface Figure {
  label: string;
  value: string;
  /** A smaller line under the label (a breakdown of the value). */
  note?: string;
}

/** The one AI trust counter and the state of each confidence level, ready to draw. */
export interface TrustView {
  done: number;
  threshold: number;
  /** Whole percent of the way to the threshold, never above 100. */
  percent: number;
  reached: boolean;
  headline: string;
  /** What reaching it does, one sentence. */
  meaning: string;
  levels: { key: string; label: string; state: string; trusted: boolean }[];
  href: string;
  hrefLabel: string;
}

export type StopUnit = 'PDF' | 'paper' | 'question';

export interface RouteStop {
  id: StopId;
  track: 'main' | 'siding' | 'side';
  /** 1 to 7 along the main route; null for the siding and the side stops. */
  step: number | null;
  title: string;
  /** One line in plain words. */
  meaning: string;
  /** null = the number did not arrive (shown as "?", never as 0). */
  count: number | null;
  unit: StopUnit;
  /** Small lines under the number. */
  facts: string[];
  /** Labelled figures under the number: the other numbers the owner asked for at this stop. */
  figures?: Figure[];
  /** A short row of labelled values drawn side by side (two or three columns), under the headline. */
  sideBySide?: Figure[];
  look: StopLook;
  action: RouteAction | null;
  /** Only the student checkers stop: how many papers have how many questions left. */
  bands?: BandRow[];
  /** Only the student checkers stop: AI trust, X of 100 checks. */
  trust?: TrustView | null;
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

/** "52 MB", "9.3 GB". Binary units, one decimal for gigabytes. */
export function bytesWords(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  if (mb >= 10) return `${Math.round(mb).toLocaleString('en-IN')} MB`;
  return `${(Math.round(mb * 10) / 10).toString()} MB`;
}

/** "paper" or "papers" for a stop's headline number; a number that did not arrive reads as the plural. */
export function unitWord(unit: StopUnit, n: number | null): string {
  return n === 1 ? unit : `${unit}s`;
}

/** Where each stop leads. The HOD desk is the home of the work, so both desks open its tabs. */
const HOD_DESK = {
  assignments: '/hod?tab=assignments',
  needsYou: '/hod?tab=needs-you',
  ready: '/hod?tab=ready',
  live: '/hod?tab=live',
  aiTrust: '/hod?tab=ai-trust',
} as const;

function trustView(route: PipelineRoute): TrustView | null {
  const t = route.trust;
  if (!t) return null;
  const done = Math.min(t.checksDone, t.threshold);
  const levelWords = (l: TrustLevel) => `${l.level.charAt(0).toUpperCase()}${l.level.slice(1)} confidence, says ${l.decision === 'fix' ? 'fix' : 'pass'}`;
  return {
    done,
    threshold: t.threshold,
    percent: t.threshold > 0 ? Math.min(100, Math.round((done / t.threshold) * 100)) : 0,
    reached: t.reached,
    // Never print past the bar: at or above it, "100 of 100 checks, reached" (same rule as overallProgress and checksNeeded).
    headline: t.checksDone >= t.threshold
      ? `AI trust: ${fmt(t.threshold)} of ${fmt(t.threshold)} checks, reached`
      : `AI trust: ${fmt(t.checksDone)} of ${fmt(t.threshold)} checks`,
    meaning: t.reached
      ? 'Reached. The AI can pass clean questions by itself. People still read the flagged ones.'
      : 'Until it is reached, every question the AI reads still goes to students first.',
    levels: t.levels.map((l) => ({
      key: `${l.level}-${l.decision}`,
      label: levelWords(l),
      state: l.trusted ? `Trusted, ${fmt(l.checked)} checked` : `Not trusted yet, ${fmt(l.checked)} checked`,
      trusted: l.trusted,
    })),
    href: HOD_DESK.aiTrust,
    hrefLabel: 'Open AI trust',
  };
}

/** The seven stops of the main route, in order. `audience` is kept for the links an audience may not open; today both audiences are offered the same ones. */
export function buildMainStops(route: PipelineRoute, audience: Audience = 'admin'): RouteStop[] {
  const { registry, open, checkers, drive, pictures, checking, needsYou, ready, live } = route;
  const s = registry.byState;
  const waitingToOcr = s.not_started + s.ocr_queued;

  // PDFs on the disk only (owner, 12 Oct): when the desk has not counted them the number is "?", never the desk's list.
  const computerCount = drive ? drive.totalPdfs : null;
  const computerFacts: string[] = [];
  if (drive) {
    computerFacts.push(`${fmt(drive.classified)} sorted by class and subject`);
    if (drive.unclassified > 0) computerFacts.push(`${fmt(drive.unclassified)} not sorted yet`);
    if (drive.bytesTotal !== null) computerFacts.push(`${bytesWords(drive.bytesTotal)} in all`);
  } else {
    computerFacts.push('The desk has not counted the PDFs on the main computer yet.');
  }
  const computerFigures: Figure[] = [];
  if (route.noPdf) {
    const none = route.noPdf.auditPapers + route.noPdf.liveOnly;
    computerFigures.push({
      label: 'Papers with no PDF here, not counted above',
      value: fmt(none),
      ...(none > 0 ? { note: `${fmt(route.noPdf.auditPapers)} on the checking desk, ${fmt(route.noPdf.liveOnly)} live on the site only` } : {}),
    });
  }

  const swarm = registry.swarmRead;
  const readFigures: Figure[] = [
    { label: "OCR'd, waiting for the AI", value: fmt(s.ocr_done) },
    { label: "Still waiting to be OCR'd", value: fmt(waitingToOcr) },
  ];
  if (swarm && swarm.deskWithoutSwarm > 0) {
    readFigures.push({ label: 'On the checking desk, not read by the AI', value: fmt(swarm.deskWithoutSwarm) });
  }

  const pictureFigures: Figure[] = [];
  const pictureFacts: string[] = [];
  const pictureColumns: Figure[] = [];
  if (pictures) {
    pictureColumns.push(
      { label: 'Papers', value: fmt(pictures.queuedPapers) },
      { label: 'Pictures', value: fmt(pictures.queuedPictures) },
      { label: 'Size', value: bytesWords(pictures.queuedBytes) },
    );
    if (pictures.awaitingRoutePictures > 0) {
      pictureFigures.push({
        label: 'More, once their questions are sorted',
        value: `${fmt(pictures.awaitingRoutePictures)} (${bytesWords(pictures.awaitingRouteBytes)})`,
      });
    }
    if (pictures.storageUsedBytes !== null && pictures.storageCapBytes !== null) {
      pictureFacts.push(`Storage: ${bytesWords(pictures.storageUsedBytes)} of ${bytesWords(pictures.storageCapBytes)} used`);
    }
  }

  const trust = trustView(route);
  const studentFacts: string[] = [];
  if (checking) studentFacts.push(`${plural(checking.papers, 'paper')} with questions open`);
  studentFacts.push(`${plural(checkers.activeVerifiers, 'checker')} active`, `${plural(checkers.papersAssigned, 'paper')} handed out`);

  const needsFacts: string[] = [];
  if (needsYou) {
    needsFacts.push(`${plural(needsYou.papers, 'paper')} to open`);
    needsFacts.push(`${fmt(needsYou.escalatedQuestions)} sent up by students`, `${fmt(needsYou.adminQuestions)} only an HOD or admin can settle`);
  }

  const readyFigures: Figure[] = [];
  if (ready) {
    readyFigures.push({ label: 'Can go live now', value: `${fmt(ready.canGoLive)} ${ready.canGoLive === 1 ? 'paper' : 'papers'}` });
    if (ready.leftOutQuestions > 0) {
      readyFigures.push({ label: 'Questions left out', value: `${fmt(ready.leftOutQuestions)}` });
    }
  }

  const liveFigures: Figure[] = [];
  if (live) {
    liveFigures.push({ label: 'Made on this route', value: `${fmt(live.onRoute)}` });
    liveFigures.push({ label: 'From the earlier library', value: `${fmt(Math.max(0, live.total - live.onRoute))}` });
    if (live.hidden > 0) liveFigures.push({ label: 'Hidden, not visible', value: `${fmt(live.hidden)}` });
  }

  return [
    {
      id: 'computer',
      track: 'main',
      step: 1,
      title: `PDFs saved on ${COMPUTER_LABEL}`,
      meaning: drive
        ? 'Every paper PDF counted on the main computer, started or not. Papers that have no PDF here are counted apart.'
        : 'The desk has not sent the PDF count yet.',
      count: computerCount,
      unit: 'PDF',
      facts: computerFacts,
      figures: computerFigures,
      look: STOP_LOOK.computer,
      // Admins and HODs both have the paper list on their pipeline page (hod_registry), so both get the filter.
      action: { kind: 'filter', states: [], label: 'Show every paper in the list' },
    },
    {
      id: 'read',
      track: 'main',
      step: 2,
      title: 'Read by the AI',
      meaning: 'Papers the AI has read, counted where they are now. A paper that has moved on is counted at the stop it has reached.',
      count: swarm ? swarm.papers : null,
      unit: 'paper',
      facts: [],
      figures: readFigures,
      look: STOP_LOOK.read,
      action: null,
    },
    {
      id: 'pictures',
      track: 'main',
      step: 3,
      title: 'Pictures waiting',
      meaning: pictures
        ? 'Pictures of cleared questions, queued on the main computer. They go up only when you say so.'
        : 'The desk has not sent the picture numbers yet.',
      count: pictures ? pictures.queuedPapers : null,
      unit: 'paper',
      facts: pictureFacts,
      sideBySide: pictureColumns,
      figures: pictureFigures,
      look: STOP_LOOK.pictures,
      action: null,
    },
    {
      id: 'students',
      track: 'main',
      step: 4,
      title: 'Checking by students',
      meaning: 'Every question the AI reads goes to student checkers first. These are still open.',
      count: checking ? checking.questions : null,
      unit: 'question',
      facts: studentFacts,
      look: STOP_LOOK.students,
      action: { kind: 'link', href: HOD_DESK.assignments, label: 'Open assignments on the HOD desk' },
      bands: BAND_KEYS.map((key) => ({ key, label: BAND_LABEL[key], count: open.studentBands[key] })),
      trust,
    },
    {
      id: 'needsYou',
      track: 'main',
      step: 5,
      title: 'Needs you',
      meaning: 'Questions students sent up, and the ones only an HOD or admin can settle.',
      count: needsYou ? needsYou.questions : null,
      unit: 'question',
      facts: needsFacts,
      look: STOP_LOOK.needsYou,
      action: { kind: 'link', href: HOD_DESK.needsYou, label: 'Open Needs you on the HOD desk' },
    },
    {
      id: 'ready',
      track: 'main',
      step: 6,
      title: 'Ready to go live',
      meaning: 'Every question settled. Waiting for a person to run the four checks and publish.',
      count: ready ? ready.papers : null,
      unit: 'paper',
      facts: [],
      figures: readyFigures,
      look: STOP_LOOK.ready,
      action: { kind: 'link', href: HOD_DESK.ready, label: 'Open Ready to go live on the HOD desk' },
    },
    {
      id: 'live',
      track: 'main',
      step: 7,
      title: 'Live',
      meaning: 'On the site for visitors to read.',
      count: live ? live.total : null,
      unit: 'paper',
      facts: [],
      figures: liveFigures,
      look: STOP_LOOK.live,
      action: { kind: 'link', href: HOD_DESK.live, label: 'Open Live papers on the HOD desk' },
    },
  ];
}

/** Total of a frozen_by_state map. */
export function frozenTotal(route: PipelineRoute): number {
  return PROCESSED_STATES.reduce((n, k) => n + route.registry.frozenByState[k], 0);
}

/** The siding: papers copied from the earlier library, held back on purpose. It never joins the counts on the main route. */
export function buildSiding(route: PipelineRoute): RouteStop {
  const f = route.registry.frozenByState;
  return {
    id: 'leftOut',
    track: 'siding',
    step: null,
    title: 'Left out',
    meaning: 'Papers from the earlier library, kept back on purpose. They are not in the counts on the route, except the PDF count.',
    count: frozenTotal(route),
    unit: 'paper',
    facts: [`${fmt(f.live)} of them are already live`, `${fmt(f.not_started + f.ocr_queued)} not read yet`],
    look: STOP_LOOK.leftOut,
    action: null,
  };
}

/** The three smaller piles beside Needs you: questions that cannot go to students or a person yet. */
export function buildSideStops(route: PipelineRoute): RouteStop[] {
  const { papersByPile, questionsByPile } = route.open;
  const side = (id: SideStopId, title: string, meaning: string): RouteStop => ({
    id,
    track: 'side',
    step: null,
    title,
    meaning,
    count: papersByPile[id],
    unit: 'paper',
    facts: [`${plural(questionsByPile[id], 'question')}`],
    look: STOP_LOOK[id],
    action: null,
  });
  return [
    side('data', 'Waiting for data fixes', 'Waiting for a fix to the data behind them.'),
    side('renderer', 'Waiting for a layout fix', 'Waiting for the page layout to be fixed.'),
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

/** The biggest count on the main route, the yardstick every lane is measured against. A count that did not arrive is 0 here. */
export function maxFlow(stops: RouteStop[]): number {
  return stops.reduce((m, s) => Math.max(m, s.count ?? 0), 0);
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

/* -------------------------------------------------------------- freshness */

/** After this long without a sync the numbers are called out of date. The desk syncs when it runs, so a day and a half is a missed day. */
export const STALE_AFTER_MS = 36 * 3_600_000;

export interface DataAsOf {
  /** The latest time the desk wrote anything the page shows, or null if it never has. */
  at: string | null;
  /** Reads "8 Oct, 11:24 pm". */
  when: string;
  /** "4 days ago" style words for the same moment. */
  ago: string;
  stale: boolean;
}

function agoWords(elapsedMs: number): string {
  const h = Math.floor(Math.max(0, elapsedMs) / 3_600_000);
  if (h < 48) return updatedWords(elapsedMs);
  return `${Math.floor(h / 24)} days ago`;
}

/** When the desk last sent numbers: the newest of its picture sync, its PDF count and the last registry change. This is not the time the browser read the page. */
export function dataAsOf(route: PipelineRoute, nowMs: number): DataAsOf {
  const times = [route.synced.deskSyncedAt, route.synced.driveSyncedAt, route.synced.registryChangedAt]
    .map((t) => (t ? Date.parse(t) : NaN))
    .filter((t) => Number.isFinite(t));
  if (times.length === 0) return { at: null, when: '', ago: '', stale: true };
  const latest = Math.max(...times);
  const elapsed = nowMs - latest;
  return {
    at: new Date(latest).toISOString(),
    when: format(new Date(latest), 'd MMM, h:mm a'),
    ago: agoWords(elapsed),
    stale: elapsed > STALE_AFTER_MS,
  };
}
