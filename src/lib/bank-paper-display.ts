/**
 * D66: pure rendering-decision helpers for BankPaper.tsx's new fields
 * (allowed time, general instructions, display_number, question-level
 * instructions, incomplete_note). Extracted so the fallback/gating logic is
 * testable without mounting the page (which needs a live Supabase session).
 */

/** The number shown on a question's badge: the recorded display_number wins
 *  over the client-derived a/b/c run lettering, which in turn wins over the
 *  raw printed number. Returns null when none of the three exist, meaning
 *  the badge should not render at all. */
export function resolveDisplayNumber(
  displayNumber: string | null | undefined,
  computedFallback: string | undefined,
  rawNumber: string | null,
): string | null {
  return displayNumber || computedFallback || rawNumber || null;
}

/** Whether the paper-level "allowed time / general instructions" block
 *  should render at all -- most papers have neither. */
export function showPaperExtras(
  allowedTimeMinutes: number | null,
  generalInstructions: string | null,
): boolean {
  return Boolean(allowedTimeMinutes) || Boolean(generalInstructions);
}

/** The small incomplete-paper note shows only when the source paper itself
 *  was recorded as incomplete -- never inferred from anything else. */
export function showIncompleteNote(incompleteNote: string | null): boolean {
  return Boolean(incompleteNote);
}

/** Whether a question's own instructions line should render -- distinct
 *  from the paper-level ones above, and from the question's body text. */
export function showQuestionInstructions(instr: string | null | undefined): boolean {
  return Boolean(instr);
}

/** Many papers print their own marks inline, "Find: [3]". The marks pill
 *  then says the same number twice on one card, so the pill stands down;
 *  the paper's own marker is the source and is never touched. Shared by
 *  BankPaper.tsx and the admin paper edit page, which must look the same. */
export function marksShownInText(marks: number | null | undefined, text: string | null | undefined): boolean {
  if (marks === null || marks === undefined) return false;
  // Escaped brackets: an unescaped [...] here is a character class, which
  // matches the whitespace in every question and would hide every pill.
  return new RegExp(`\\[\\s*${marks}\\s*\\]`).test(text ?? '');
}

/* ---------------------------------------------------------------------------
   Pipeline fields, round two: suggested_time_minutes, section_label,
   alternative_group/alternative_label, parent_question_id (sub-parts).

   All four are pure, order-preserving passes over the paper's own ordered
   question list -- none of them re-sort or filter, so they compose safely
   with the chapter/search filter BankPaper.tsx already applies to `visible`
   before calling these.
--------------------------------------------------------------------------- */

/** Whether a question's own suggested-time chip should render. */
export function showSuggestedTime(minutes: number | null | undefined): boolean {
  return Boolean(minutes) && minutes! > 0;
}

export interface SectionRow {
  i: string;
  sec?: string | null;
}

/** The ids that should carry a section heading immediately above them: the
 *  FIRST row of a run of consecutive rows sharing the same non-blank
 *  section_label. A blank section_label never gets a heading, and a label
 *  identical to the one already showing is not repeated. Maps id -> label. */
export function sectionHeadings(rows: SectionRow[]): Map<string, string> {
  const out = new Map<string, string>();
  let last: string | null = null;
  for (const row of rows) {
    const label = row.sec?.trim() || null;
    if (label && label !== last) out.set(row.i, label);
    last = label;
  }
  return out;
}

export interface AlternativeRow {
  i: string;
  ag?: string | null;
}

/** Consecutive rows sharing the same non-blank alternative_group, grouped
 *  into an ordered run of ids. A "group" of one row (its neighbours carry a
 *  different group or none) is not returned -- there is nothing to divide
 *  with "OR" -- so the caller renders it as an ordinary standalone question. */
export function alternativeRuns(rows: AlternativeRow[]): Map<string, string[]> {
  const runs = new Map<string, string[]>();
  let currentKey: string | null = null;
  let currentIds: string[] = [];
  const flush = () => {
    if (currentKey && currentIds.length > 1) runs.set(currentIds[0], [...currentIds]);
    currentKey = null;
    currentIds = [];
  };
  for (const row of rows) {
    const key = row.ag?.trim() || null;
    if (key && key === currentKey) {
      currentIds.push(row.i);
    } else {
      flush();
      currentKey = key;
      currentIds = key ? [row.i] : [];
    }
  }
  flush();
  return runs;
}

/** The set of ids that are absorbed into an alternative run started by a
 *  DIFFERENT (earlier) id -- i.e. every id in a run except its first. The
 *  caller skips rendering these on their own; they render inside the group
 *  started by the run's first id. */
export function alternativeFollowerIds(runs: Map<string, string[]>): Set<string> {
  const out = new Set<string>();
  for (const ids of runs.values()) {
    for (const id of ids.slice(1)) out.add(id);
  }
  return out;
}

export interface ParentRow {
  i: string;
  pid?: string | null;
}

/** Every row's printed sub-parts, in paper order: parent id -> ordered list
 *  of child ids. A parent_question_id that does not match any row in this
 *  paper (bad data, or a parent on a different page of results) is ignored
 *  rather than nesting a question under nothing. */
export function subPartsOf(rows: ParentRow[]): Map<string, string[]> {
  const known = new Set(rows.map((r) => r.i));
  const out = new Map<string, string[]>();
  for (const row of rows) {
    const parent = row.pid;
    if (!parent || parent === row.i || !known.has(parent)) continue;
    const list = out.get(parent) ?? [];
    list.push(row.i);
    out.set(parent, list);
  }
  return out;
}

/** The ids that render at the top level: everything that is not itself a
 *  recorded sub-part of another row IN THIS SET. A dangling parent_question_id
 *  (parent absent from this paper's rows) leaves the row at the top level
 *  rather than dropping it. */
export function topLevelIds<T extends ParentRow>(rows: T[]): string[] {
  const known = new Set(rows.map((r) => r.i));
  const nested = new Set<string>();
  for (const row of rows) {
    if (row.pid && row.pid !== row.i && known.has(row.pid)) nested.add(row.i);
  }
  return rows.filter((r) => !nested.has(r.i)).map((r) => r.i);
}
