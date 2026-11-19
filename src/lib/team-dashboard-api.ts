import { supabase } from '@/integrations/supabase/client';

/**
 * Client wrapper for the HOD "Team" dashboard (owner Round 6, "00 Owner
 * Brief and Answers.md"): admin_team_stats, admin_paper_progress and
 * admin_question_history, added in
 * supabase/migrations/20260929120000_checker_order_history_dashboard.sql
 * (written, dry-run tested, NOT yet applied -- see
 * "14 Order History Dashboard.md"). Same `as never` escape hatch the rest
 * of this codebase already uses for a real RPC that predates the generated
 * types (see checker-api.ts's own header comment).
 */

export interface TeamStatsRow {
  user_id: string;
  name: string;
  questions_checked: number;
  passed: number;
  fixed: number;
  asked_help: number;
  skipped: number;
  papers_completed: number;
  /** Null until a future migration logs a lease-start timestamp -- see the
   *  migration's own comment on admin_team_stats. Never fabricated here. */
  median_seconds: number | null;
  admin_overturns: number;
}

export interface PaperProgressRow {
  audit_paper_id: string;
  live_bank_paper_id: string | null;
  subject: string | null;
  cls: string | null;
  school: string | null;
  open_doubts: number;
  cleared: number;
  total: number;
  pct_done: number;
  last_activity: string | null;
  workers: string[];
}

export interface QuestionHistoryRow {
  at: string;
  actor_kind: 'ai' | 'system' | 'rule' | 'admin' | 'checker' | string;
  actor_name: string;
  action: string;
  detail: string | null;
  before: unknown;
  after: unknown;
  /** 'paper' for an event about the whole paper (20260930090000); absent before that migration. */
  scope?: 'question' | 'paper' | string;
  /** ai | checker | admin | pipeline | system, from log_action_catalog. */
  event_kind?: string;
}

function rpcRows<T>(data: unknown): T[] {
  return ((data ?? []) as unknown) as T[];
}

export async function adminTeamStats(from: Date, to: Date): Promise<TeamStatsRow[]> {
  const { data, error } = await supabase.rpc('admin_team_stats' as never, {
    p_from: from.toISOString(),
    p_to: to.toISOString(),
  } as never);
  if (error) throw error;
  return rpcRows<TeamStatsRow>(data).map((r) => ({
    ...r,
    questions_checked: Number(r.questions_checked) || 0,
    passed: Number(r.passed) || 0,
    fixed: Number(r.fixed) || 0,
    asked_help: Number(r.asked_help) || 0,
    skipped: Number(r.skipped) || 0,
    papers_completed: Number(r.papers_completed) || 0,
    median_seconds: r.median_seconds === null || r.median_seconds === undefined ? null : Number(r.median_seconds),
    admin_overturns: Number(r.admin_overturns) || 0,
  }));
}

export async function adminPaperProgress(): Promise<PaperProgressRow[]> {
  const { data, error } = await supabase.rpc('admin_paper_progress' as never);
  if (error) throw error;
  return rpcRows<PaperProgressRow>(data).map((r) => ({
    ...r,
    open_doubts: Number(r.open_doubts) || 0,
    cleared: Number(r.cleared) || 0,
    total: Number(r.total) || 0,
    pct_done: Number(r.pct_done) || 0,
    workers: Array.isArray(r.workers) ? r.workers.filter(Boolean) : [],
  }));
}

export async function adminQuestionHistory(questionId: string): Promise<QuestionHistoryRow[]> {
  const { data, error } = await supabase.rpc('admin_question_history' as never, {
    p_question_id: questionId,
  } as never);
  if (error) throw error;
  return rpcRows<QuestionHistoryRow>(data);
}

export interface TeamDashboardApi {
  teamStats: typeof adminTeamStats;
  paperProgress: typeof adminPaperProgress;
  questionHistory: typeof adminQuestionHistory;
}

export const realTeamDashboardApi: TeamDashboardApi = {
  teamStats: adminTeamStats,
  paperProgress: adminPaperProgress,
  questionHistory: adminQuestionHistory,
};
