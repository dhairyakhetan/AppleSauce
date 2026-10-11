/**
 * The whole question a sub-part belongs to, for the paper checker.
 *
 * Owner, 2026-09-28: when the flagged question is a sub-part, show the WHOLE
 * parent question (e.g. 3 with all its parts) as text and as a picture, with
 * the flagged part highlighted. The rows come from the
 * checker_question_context RPC (supabase/migrations/
 * 20260928160000_checker_question_context.sql); everything here is pure so
 * it can be tested without a checker login.
 *
 * Question text is never touched here: bodies are passed through as the
 * database holds them and rendered by MathText.
 */

import type { RawOption } from './checker-options';

export interface ContextRow {
  id: string;
  ord: number;
  display_number: string | null;
  number_path: string | null;
  body: string;
  options: RawOption[] | null;
  source: Record<string, unknown> | null;
  is_current: boolean;
  is_parent: boolean;
  depth: number;
}

export interface QuestionContext {
  /** The top-level question (its stem / shared context). Null if the group has none. */
  parent: ContextRow | null;
  /** Every other row of the group, in paper order. */
  parts: ContextRow[];
  currentId: string;
  /** True when the question being checked is the parent itself. */
  currentIsParent: boolean;
}

/**
 * Builds the view model from the RPC rows. Returns null (show nothing extra)
 * when the rows do not describe a real group: fewer than two distinct rows,
 * or the current question is not among them.
 */
export function assembleQuestionContext(
  rows: ContextRow[] | null | undefined,
  currentId: string,
): QuestionContext | null {
  if (!rows || rows.length === 0) return null;
  const byId = new Map<string, ContextRow>();
  for (const r of rows) {
    if (r && r.id && !byId.has(r.id)) byId.set(r.id, r);
  }
  const ordered = [...byId.values()].sort((a, b) => (a.ord ?? 0) - (b.ord ?? 0));
  if (ordered.length < 2) return null;
  if (!ordered.some((r) => r.id === currentId)) return null;

  const parent = ordered.find((r) => r.is_parent) ?? null;
  const parts = ordered.filter((r) => r !== parent);
  return {
    parent,
    parts,
    currentId,
    currentIsParent: parent?.id === currentId,
  };
}

/** The label a checker sees for a part: the printed number, else the machine path, else its position. */
export function partLabel(row: Pick<ContextRow, 'display_number' | 'number_path'>, index: number): string {
  const printed = (row.display_number ?? '').trim();
  if (printed) return printed;
  const path = (row.number_path ?? '').trim();
  if (path) return path;
  return `Part ${index + 1}`;
}

/** Heading for the context block, e.g. "The whole question 3". */
export function contextHeading(ctx: QuestionContext): string {
  const n = ctx.parent ? (ctx.parent.display_number ?? ctx.parent.number_path ?? '').trim() : '';
  return n ? `The whole question ${n}` : 'The whole question';
}
