/* The shape admin_pipeline_stats() returns (supabase/migrations/
   20261002120000_admin_pipeline_stats.sql), and the small pure helpers the
   /admin/pipeline dashboard draws from it. Kept out of the page so the
   arithmetic has tests and the page stays layout. The page reads through
   one PipelineApi object (real one in pipeline-api.ts) so dummy mode (D75)
   can hand it a fake. */

/** One row of admin_activity_feed(). */
export interface FeedRow {
  at: string;
  stream: string;
  event_id: string;
  actor_label: string | null;
  actor_kind: string | null;
  action: string;
  paper_id: string | null;
  detail: string | null;
}

export interface PipelineApi {
  stats(): Promise<PipelineStats>;
  /** Rejects when the log cannot be read: an empty log and a failed read are different things. */
  feed(limit: number): Promise<FeedRow[]>;
}

/** One read of the page: the numbers must load, the log may fail without blanking them (feed is null then, never []). */
export async function readPipeline(api: PipelineApi, feedLimit: number): Promise<{ stats: PipelineStats; feed: FeedRow[] | null }> {
  const [stats, feed] = await Promise.all([api.stats(), api.feed(feedLimit).then((rows) => rows, () => null)]);
  return { stats, feed };
}


export interface LibraryStats {
  papers: number;
  published: number;
  verified: number;
  needs_review: number;
  hidden: number;
  questions: number;
  maths_papers: number;
  maths_verified: number;
  maths_needs_review: number;
  maths_hidden: number;
}

export interface SubjectStats {
  subject: string;
  published: number;
  verified: number;
  needs_review: number;
  hidden: number;
}

export interface DeskStats {
  papers: number;
  new_scans: number;
  live_copies: number;
  passed: number;
  red: number;
  by_status: Record<string, number>;
}

export interface QueueStats {
  questions: number;
  passed: number;
  student_queue: number;
  admin_queue: number;
  other_open: number;
  with_figure: number;
}

export interface RecentPaper {
  id: string;
  subject: string;
  cls: string;
  board: string | null;
  school: string | null;
  year: string | null;
  exam: string | null;
  questions: number | null;
  published: boolean;
  needs_review: boolean;
  created_at: string;
}

export interface DailyPoint {
  day: string;
  papers_added: number;
  desk_papers: number;
  questions_cleared: number;
}

export interface PipelineStats {
  generated_at: string;
  library: LibraryStats;
  by_subject: SubjectStats[];
  by_board: Record<string, number>;
  desk: DeskStats;
  queues: QueueStats;
  recent_papers: RecentPaper[];
  daily: DailyPoint[];
}

/** Whole-number percent of part in whole; 0 when whole is 0, never NaN. */
export function pct(part: number, whole: number): number {
  if (!whole || whole <= 0) return 0;
  return Math.round((Math.max(0, part) / whole) * 100);
}

/** Largest value of one series, at least 1 so a bar height never divides by 0. */
export function seriesMax(points: DailyPoint[], key: keyof Omit<DailyPoint, 'day'>): number {
  return points.reduce((m, p) => Math.max(m, Number(p[key]) || 0), 1);
}

/** Sum of one series over the window. */
export function seriesTotal(points: DailyPoint[], key: keyof Omit<DailyPoint, 'day'>): number {
  return points.reduce((s, p) => s + (Number(p[key]) || 0), 0);
}

/** A paper's status as the library shows it. */
export function paperState(p: Pick<RecentPaper, 'published' | 'needs_review'>): 'Verified' | 'Needs review' | 'Hidden' {
  if (!p.published) return 'Hidden';
  return p.needs_review ? 'Needs review' : 'Verified';
}
