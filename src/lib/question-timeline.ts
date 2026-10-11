import type { QuestionHistoryRow } from '@/lib/team-dashboard-api';

/**
 * Pure formatting for the per-question timeline (owner Round 6: "a neat
 * per-question tracker ... who/what/when, plain words"). Kept separate from
 * the component so it can be unit tested without React or Supabase.
 */

export interface TimelineEntry {
  at: string;
  /** "You are checking this part"-style plain label, not a raw enum. */
  who: string;
  what: string;
  detail: string | null;
  /** Present only when the row actually carries a before/after value. */
  diff: { before: unknown; after: unknown } | null;
  /** True for an event about the whole paper, not this question alone. */
  paperLevel: boolean;
}

const ACTION_LABEL: Record<string, string> = {
  created: 'Question added',
  ai_flagged: 'Flagged by the computer',
  ai_verdict: 'The computer check changed',
  checker_pass: 'Marked as right',
  checker_fix: 'Fixed',
  checker_split: 'Split into two questions',
  checker_ask_help: 'Asked for help',
  checker_skip: 'Skipped',
  verifier_undo: 'Undid the last answer',
  verifier_or_separator: 'Marked as just the OR between two questions',
  published: 'Published to the live site',
  live_apply: 'Copied onto the live site',
  live_clear: 'Paper marked complete',
  admin_hide: 'Hidden by an admin',
  admin_edit_bank_question: 'Edited by an admin',
  admin_edit_bank_paper: 'Paper edited by an admin',
  admin_resolve_escalation: 'Resolved by an admin',
  admin_undo_revision: 'Undone by an admin',
  admin_merge_bank_questions: 'Merged with another question by an admin',
  admin_delete_bank_question: 'Deleted by an admin',
  admin_english_rescue_publish: 'Hidden English questions published by an admin (whole paper)',
  admin_reapply_paper_to_live: 'Paper re-applied to the live site by an admin (whole paper)',
};

/** Plain word for an action the map above does not name -- "reclassified",
 *  a future action, etc. -- so a new action never renders as a raw enum
 *  with underscores. */
export function actionLabel(action: string): string {
  if (ACTION_LABEL[action]) return ACTION_LABEL[action];
  return action.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

const ACTOR_KIND_LABEL: Record<string, string> = {
  ai: 'The computer',
  system: 'The system',
  rule: 'A rule',
  admin: 'An admin',
  checker: 'A checker',
};

export function actorKindLabel(kind: string): string {
  return ACTOR_KIND_LABEL[kind] ?? 'Someone';
}

/** A real person's name is shown when one is known; otherwise fall back to
 *  what kind of actor it was ("The computer", "The system"). The database
 *  returns 'system' as the literal name for a null actor -- never shown to
 *  a human as the word "system" when a kind-based label reads better. */
export function actorDisplayName(row: Pick<QuestionHistoryRow, 'actor_kind' | 'actor_name'>): string {
  if (row.actor_name && row.actor_name !== 'system') return row.actor_name;
  return actorKindLabel(row.actor_kind);
}

/** Merges rows from admin_question_history (already time-ordered by the
 *  database) into display-ready entries. Kept a no-op re-sort here too
 *  (stable on `at`) so a caller that merges two sources itself still gets
 *  a correctly ordered timeline. */
export function buildTimeline(rows: QuestionHistoryRow[]): TimelineEntry[] {
  return [...rows]
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
    .map((r) => ({
      at: r.at,
      who: actorDisplayName(r),
      what: actionLabel(r.action),
      detail: r.detail && r.detail.trim() ? r.detail : null,
      diff: r.before !== null || r.after !== null ? { before: r.before, after: r.after } : null,
      paperLevel: r.scope === 'paper',
    }));
}
