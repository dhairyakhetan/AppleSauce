/**
 * Plain words for the admin Activity page and the version history panel.
 * Pure, so it is tested without a login. No em or en dashes in any copy.
 */

import { ACTION_LABELS, actionWords as sentenceWords, actorLabel, markUndone, modelName, normaliseActorKind } from '@/lib/history-labels';

function sentenceCase(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/** The action with no actor, as a short phrase: "Passed this question". Wording comes from
 *  history-labels (the one dictionary); an unknown code is de-underscored, never shown raw. */
export function actionWords(action: string, questionLabel?: string | null): string {
  const code = (action ?? '').trim();
  if (code && ACTION_LABELS[code]) return sentenceCase(sentenceWords({ action: code, question_label: questionLabel ?? null, at: '' }));
  const words = code.replace(/_/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Something happened';
}

/** A short form of an id for a list: the first 8 characters. Ids only, never a name or an email. */
export function shortId(id: string | null | undefined): string {
  if (!id) return '';
  return id.length > 8 ? id.slice(0, 8) : id;
}

/** Who did it, for a list row: a kind word plus an id or a label. */
export function actorText(row: {
  actor_user_id: string | null;
  actor_label: string | null;
  actor_kind: string;
}): { kind: string; who: string; full: string } {
  const kind = KIND_WORDS[row.actor_kind] ?? row.actor_kind;
  if (row.actor_user_id) return { kind, who: shortId(row.actor_user_id), full: row.actor_user_id };
  const label = row.actor_label ?? row.actor_kind ?? 'system';
  return { kind, who: label, full: label };
}

const KIND_WORDS: Record<string, string> = {
  checker: 'Checker',
  admin: 'Admin',
  ai: 'Computer',
  pipeline: 'Pipeline',
  system: 'System',
  person: 'Person',
};

/** The table a row lives in, said plainly. */
export function tableWords(table: string | null | undefined): string {
  switch (table) {
    case 'audit_questions':
      return 'Draft question';
    case 'bank_questions':
      return 'Live question';
    case 'audit_papers':
      return 'Draft paper';
    case 'bank_papers':
      return 'Live paper';
    default:
      return 'Question';
  }
}

/** True when a version history can be opened for this row (questions only). */
export function canOpenHistory(row: { table_name: string | null; question_id: string | null }): boolean {
  return Boolean(row.question_id) && (row.table_name === 'audit_questions' || row.table_name === 'bank_questions');
}

export function opWords(op: string): string {
  switch (op) {
    case 'backfill':
      return 'As it was before the first recorded change';
    case 'insert':
      return 'Created';
    case 'update':
      return 'Changed';
    case 'revert':
      return 'Reverted';
    case 'delete':
      return 'Deleted';
    default:
      return op;
  }
}

/** Fields whose values differ between two snapshots, in a stable order. */
export function changedFields(
  older: Record<string, unknown> | null | undefined,
  newer: Record<string, unknown> | null | undefined,
): string[] {
  const a = older ?? {};
  const b = newer ?? {};
  const keys = Array.from(new Set([...Object.keys(a), ...Object.keys(b)])).sort();
  return keys.filter((k) => JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null));
}

/** A snapshot value as text, verbatim for strings (question text is never altered for display). */
export function valueText(v: unknown): string {
  if (v === null || v === undefined) return '(empty)';
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/** Fields an admin is shown first in a version, when present. */
export const PRIMARY_FIELDS = ['body', 'display_number', 'marks', 'options'] as const;

/** Whether "revert to this version" is offered: not the current one, not a deletion. */
export function canRevert(row: { is_current: boolean; op: string }): boolean {
  return !row.is_current && row.op !== 'delete';
}

export function revertConfirmText(version: number, currentVersion: number | null): string {
  const next = currentVersion != null ? ` It becomes version ${currentVersion + 1}.` : '';
  return `Put back the text of version ${version}?${next} Nothing is deleted: every version stays in this history.`;
}

// ---------------------------------------------------------------------------
// The Activity list and the pipeline feed, in sentences

/** Lower-case predicate for a code, or the de-underscored code in brackets when no label exists. */
function predicate(row: { action: string; question_label?: string | null }): string {
  const code = (row.action ?? '').trim();
  if (code && ACTION_LABELS[code]) return sentenceWords({ action: code, question_label: row.question_label ?? null, at: '' });
  const words = code.replace(/_/g, ' ').trim();
  return words ? `made a change (${words})` : 'made a change';
}

/** Who did it, by role and never by name: "A student checker", "An admin", "AI check (Sonnet)". */
export function activityWho(row: { actor_kind: string; actor_label: string | null }): string {
  if (row.actor_kind === 'person') return 'Someone';
  return actorLabel({ actor_kind: row.actor_kind, actor_name: null, model: row.actor_label });
}

/** One row as a sentence, with "(undone)" when the person took it back. */
export function activitySentence(row: {
  action: string;
  actor_kind: string;
  actor_label: string | null;
  question_label?: string | null;
  undone?: boolean;
}): string {
  return markUndone(`${activityWho(row)} ${predicate(row)}`, row.undone);
}

/** The same person or machine, whichever stream wrote the row ('ai:sonnet' and 'sonnet' are one actor). */
export function actorIdentity(row: { actor_user_id: string | null; actor_label: string | null; actor_kind: string }): string {
  if (row.actor_user_id) return `u:${row.actor_user_id}`;
  const kind = normaliseActorKind(row.actor_kind);
  return `${kind}:${modelName(row.actor_label) ?? (row.actor_label ?? '').toLowerCase()}`;
}

export interface ActivityGroup<R> {
  /** The row shown as the headline. */
  head: R;
  /** The same edit as seen by the other streams, shown as a small detail. */
  also: R[];
}

type Groupable = {
  at: string;
  stream: string;
  question_id: string | null;
  actor_user_id: string | null;
  actor_label: string | null;
  actor_kind: string;
};

const STREAM_RANK: Record<string, number> = { log: 0, check: 1, version: 2 };

/**
 * One checker edit is written by three streams (audit_review_log,
 * content_versions, content_checks) that never share a key, so it used to
 * appear up to three times. Rows about the same question by the same actor,
 * each within `windowMs` of the last, are one group. The checker action
 * (the log stream) is the headline; the others become "also recorded".
 * A different actor never joins a group, and a row with no question never does.
 * Input is newest first; the output keeps that order.
 */
export function groupActivity<R extends Groupable>(rows: R[], windowMs = 2 * 60_000): ActivityGroup<R>[] {
  const groups: { rows: R[]; last: number }[] = [];
  const open = new Map<string, { rows: R[]; last: number }>();
  for (const row of rows) {
    const t = Date.parse(row.at);
    if (!row.question_id || Number.isNaN(t)) {
      groups.push({ rows: [row], last: t });
      continue;
    }
    const key = `${row.question_id}|${actorIdentity(row)}`;
    const g = open.get(key);
    if (g && Math.abs(g.last - t) <= windowMs) {
      g.rows.push(row);
      g.last = t;
    } else {
      const fresh = { rows: [row], last: t };
      groups.push(fresh);
      open.set(key, fresh);
    }
  }
  return groups.map((g) => {
    const head = [...g.rows].sort((a, b) => (STREAM_RANK[a.stream] ?? 9) - (STREAM_RANK[b.stream] ?? 9))[0];
    return { head, also: g.rows.filter((r) => r !== head) };
  });
}

/** Known actors in the pipeline feed, by the label the database writes. */
const FEED_ACTORS: Record<string, string> = {
  pipeline: 'Pipeline (automatic)',
  system: 'Pipeline (automatic)',
  script: 'Pipeline (automatic)',
  checker: 'A student checker',
  student: 'A student checker',
  kid: 'A student checker',
  admin: 'An admin',
  ai: 'AI check',
};

/** Who did it, for the pipeline feed. Falls back to the de-underscored label, as before. */
export function feedActorWords(label: string | null | undefined, kind: string | null | undefined): string {
  const l = (label ?? '').trim();
  const k = (kind ?? '').trim().toLowerCase();
  const known = FEED_ACTORS[l.toLowerCase()];
  if (known) return known;
  const model = modelName(l);
  if (model) return `AI check (${model})`;
  if (!l && FEED_ACTORS[k]) return FEED_ACTORS[k];
  const raw = l || k || 'pipeline';
  if (/^[0-9a-f]{8}-/i.test(raw)) return FEED_ACTORS[k] ?? 'Someone';
  return raw.replace(/[_:]+/g, ' ').trim();
}

/** What happened, for the pipeline feed: "Fixed this question". */
export function feedActionWords(action: string): string {
  return actionWords(action);
}
