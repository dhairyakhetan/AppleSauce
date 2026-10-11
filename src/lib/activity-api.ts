import { supabase } from '@/integrations/supabase/client';

/**
 * Client wrapper for the admin Activity page and the per-question version
 * history (20261002090000_checker_versions_and_activity.sql, plus
 * admin_revert_to_version from 20261001090000_content_versions_lock.sql).
 * Same `as never` escape hatch as checker-api.ts: these RPCs predate the
 * generated types.
 *
 * Nothing here carries a name or an email: the feed returns actor ids and
 * labels only, and version snapshots never include answer_key.
 */

export type ActivityScope = 'people' | 'ai' | 'all';

export type VersionedTable = 'bank_questions' | 'bank_papers' | 'audit_questions' | 'audit_papers';

export interface ActivityRow {
  at: string;
  /** 'log' (audit_review_log), 'version' (content_versions), 'check' (content_checks). */
  stream: 'log' | 'version' | 'check' | string;
  event_id: string;
  actor_user_id: string | null;
  /** 'ai:sonnet', 'system', 'pipeline', 'haiku_pdf' ... only when there is no user id. */
  actor_label: string | null;
  actor_kind: 'checker' | 'admin' | 'ai' | 'pipeline' | 'system' | 'person' | string;
  action: string;
  table_name: VersionedTable | string | null;
  row_id: string | null;
  paper_id: string | null;
  question_id: string | null;
  version: number | null;
  detail: string | null;
  /** "5", "5(a)": the question's number on the paper, when the feed carries it. */
  question_label?: string | null;
  /** The paper's title, when the feed carries it. Shown beside the question. */
  paper_title?: string | null;
  /** True when the person who did this took it back. The feed does not send it yet; the page shows it when it does. */
  undone?: boolean;
}

export interface VersionRow {
  version: number;
  op: 'backfill' | 'insert' | 'update' | 'delete' | 'revert' | string;
  content_sha256: string;
  /** The content fields of that version. Never includes answer_key. */
  snapshot: Record<string, unknown>;
  has_answer_key: boolean;
  actor: string | null;
  actor_user_id: string | null;
  source: string | null;
  reason: string | null;
  created_at: string;
  is_current: boolean;
}

function rows<T>(data: unknown): T[] {
  return ((data ?? []) as unknown) as T[];
}

/**
 * The cursor for "Show older". The server reads rows strictly BEFORE the cursor,
 * so passing the last row's own timestamp would drop any other row that shares
 * that exact instant and did not fit on the previous page. One microsecond past
 * it makes the server include them; rows already shown are removed by their
 * stream and id. Timestamps arrive with microseconds, so this is exact. A value
 * that is not a timestamp is returned unchanged.
 */
export function olderCursor(at: string): string {
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}(?::?\d{2})?)$/.exec(at);
  if (!m) return at;
  const tz = m[3] === 'Z' ? 'Z' : m[3].length === 3 ? `${m[3]}:00` : m[3].includes(':') ? m[3] : `${m[3].slice(0, 3)}:${m[3].slice(3)}`;
  const wholeSecond = Date.parse(`${m[1]}${tz}`);
  if (Number.isNaN(wholeSecond)) return at;
  const micros = Number((m[2] ?? '').padEnd(6, '0').slice(0, 6)) + 1;
  const carry = micros >= 1_000_000 ? 1000 : 0;
  const seconds = new Date(wholeSecond + carry).toISOString().slice(0, 19);
  return `${seconds}.${String(micros % 1_000_000).padStart(6, '0')}Z`;
}

export async function adminActivityFeed(scope: ActivityScope, before: string | null, limit = 200): Promise<ActivityRow[]> {
  const { data, error } = await supabase.rpc('admin_activity_feed' as never, {
    p_limit: limit,
    p_before: before,
    p_scope: scope,
  } as never);
  if (error) throw error;
  return rows<ActivityRow>(data).map((r) => ({ ...r, version: r.version == null ? null : Number(r.version) }));
}

export async function adminVersionHistory(table: VersionedTable, rowId: string): Promise<VersionRow[]> {
  const { data, error } = await supabase.rpc('admin_version_history' as never, {
    p_table: table,
    p_row_id: rowId,
  } as never);
  if (error) throw error;
  return rows<VersionRow>(data).map((r) => ({ ...r, version: Number(r.version), snapshot: r.snapshot ?? {} }));
}

/** Writes the chosen version back as a NEW version; history is never rewritten. Returns the new version. */
export async function adminRevertToVersion(
  table: VersionedTable,
  rowId: string,
  version: number,
  reason: string | null,
): Promise<number | null> {
  const { data, error } = await supabase.rpc('admin_revert_to_version' as never, {
    p_table: table,
    p_row_id: rowId,
    p_version: version,
    p_reason: reason?.trim() || null,
  } as never);
  if (error) throw error;
  return data == null ? null : Number(data);
}

export interface ActivityApi {
  feed: typeof adminActivityFeed;
  versionHistory: typeof adminVersionHistory;
  revert: typeof adminRevertToVersion;
}

export const realActivityApi: ActivityApi = {
  feed: adminActivityFeed,
  versionHistory: adminVersionHistory,
  revert: adminRevertToVersion,
};
