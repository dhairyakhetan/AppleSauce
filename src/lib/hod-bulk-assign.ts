/* Bulk assigning on the HOD desk: which papers are ticked, running the existing
   one-paper assign call over them, and the plain-words result. Pure, so it is
   tested without a screen. Nothing here talks to the database: the caller hands
   in the assign function (api.assignPaper). */

/** At most this many papers go in one bulk assign. */
export const MAX_BULK = 50;
/** How many assign calls run at the same time. */
export const BULK_CONCURRENCY = 4;

// ------------------------------------------------------------------ selection

/** Tick or untick one paper. Ticking is refused (selection returned as it was) once the limit is reached. */
export function toggleSelected(selected: ReadonlySet<string>, id: string, max = MAX_BULK): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) {
    next.delete(id);
  } else if (next.size < max) {
    next.add(id);
  }
  return next;
}

/** Tick the first `max` papers of the list, in the order shown. */
export function selectFirst(ids: readonly string[], max = MAX_BULK): Set<string> {
  return new Set(ids.slice(0, max));
}

/** Drop ticks for papers that are no longer on the list (given out, or taken by someone else). */
export function pruneSelected(selected: ReadonlySet<string>, available: readonly string[]): Set<string> {
  const here = new Set(available);
  const next = new Set<string>();
  selected.forEach((id) => {
    if (here.has(id)) next.add(id);
  });
  return next;
}

export type SelectAllState = 'none' | 'some' | 'all';

/** State of the "Select all" box: all means every paper that can be ticked is ticked. */
export function selectAllState(selectedCount: number, listLength: number, max = MAX_BULK): SelectAllState {
  if (selectedCount === 0) return 'none';
  return selectedCount >= Math.min(listLength, max) ? 'all' : 'some';
}

/** "Select all 12", or "Select the first 50 of 213" when the list is longer than one bulk run allows. */
export function selectAllLabel(listLength: number, max = MAX_BULK): string {
  return listLength > max ? `Select the first ${max} of ${listLength}` : `Select all ${listLength}`;
}

// ------------------------------------------------------------------- the run

export interface BulkItem {
  paperId: string;
  /** What the paper is called on screen, for the result. */
  label: string;
}

export interface BulkResult extends BulkItem {
  ok: boolean;
  /** The server's reason, as written, when it refused. */
  error?: string;
}

function reasonOf(err: unknown): string {
  const m = err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message).trim() : '';
  return m || 'That did not work.';
}

/**
 * Runs `assign` for every item, at most `concurrency` at once, and never stops
 * early: one refusal does not cancel the others. Every item comes back with its
 * own ok or error, in the order given. More than `max` items is an error: the
 * screen never offers that, so it is a bug if it happens.
 */
export async function runBulkAssign(
  items: readonly BulkItem[],
  assign: (paperId: string) => Promise<unknown>,
  opts: { concurrency?: number; max?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<BulkResult[]> {
  const { concurrency = BULK_CONCURRENCY, max = MAX_BULK, onProgress } = opts;
  if (items.length > max) throw new Error(`Assign at most ${max} papers at once.`);
  const results: BulkResult[] = new Array(items.length);
  let next = 0;
  let done = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      const item = items[i];
      try {
        await assign(item.paperId);
        results[i] = { ...item, ok: true };
      } catch (err) {
        results[i] = { ...item, ok: false, error: reasonOf(err) };
      }
      done++;
      onProgress?.(done, items.length);
    }
  }
  const workers = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

/** "Assigning 3 of 12..." */
export function progressText(done: number, total: number): string {
  return `Assigning ${Math.min(done, total)} of ${total} ${total === 1 ? 'paper' : 'papers'}...`;
}

const papers = (n: number) => `${n} ${n === 1 ? 'paper' : 'papers'}`;

export interface Outcome {
  tone: 'good' | 'mixed' | 'bad';
  headline: string;
  /** Extra plain lines under the headline. */
  lines: string[];
  /** One entry per paper that was refused, with the server's reason. */
  failures: { label: string; reason: string }[];
}

/** The honest result of a bulk assign: how many went, and each refusal by name. */
export function summariseBulk(results: readonly BulkResult[], targetName: string): Outcome {
  const ok = results.filter((r) => r.ok);
  const bad = results.filter((r) => !r.ok);
  const failures = bad.map((r) => ({ label: r.label, reason: r.error ?? 'That did not work.' }));
  if (bad.length === 0) {
    return { tone: 'good', headline: `Gave ${papers(ok.length)} to ${targetName}.`, lines: [], failures };
  }
  if (ok.length === 0) {
    return {
      tone: 'bad',
      headline: `None of the ${papers(bad.length)} could be given to ${targetName}.`,
      lines: ['They are still ticked, so you can pick someone else and try again.'],
      failures,
    };
  }
  return {
    tone: 'mixed',
    headline: `Gave ${ok.length} of ${results.length} papers to ${targetName}. ${bad.length} ${bad.length === 1 ? 'was' : 'were'} refused.`,
    lines: ['The refused papers are still ticked.'],
    failures,
  };
}

// ---------------------------------------------------------------- auto assign

export interface HeldPaper {
  paper_id: string;
  user_id: string;
  /** The holder's name as shown. */
  name: string;
}

/**
 * The automatic hand-out only returns how many papers it gave. Who got what is
 * worked out by comparing what each verifier held before and after, so it is
 * exactly what the list now shows. A paper that moved between people counts for
 * the person it moved to.
 */
export function newlyHeld(before: readonly HeldPaper[], after: readonly HeldPaper[]): { name: string; count: number }[] {
  const was = new Set(before.map((b) => `${b.paper_id}|${b.user_id}`));
  const tally = new Map<string, { name: string; count: number }>();
  for (const a of after) {
    if (was.has(`${a.paper_id}|${a.user_id}`)) continue;
    const t = tally.get(a.user_id) ?? { name: a.name, count: 0 };
    t.count++;
    tally.set(a.user_id, t);
  }
  return [...tally.values()].sort((x, y) => y.count - x.count || x.name.localeCompare(y.name));
}

/**
 * What to say after "Auto assign all". `gave` is the number the server returned;
 * `perPerson` and `left` come from a fresh read afterwards (null when that read
 * failed, in which case only the server's number is shown). `leftIsAtLeast`
 * means the list is longer than the screen asks for.
 */
export function summariseAutoAssign(input: {
  gave: number;
  perPerson: { name: string; count: number }[] | null;
  left: number | null;
  leftIsAtLeast?: boolean;
}): Outcome {
  const { gave, perPerson, left, leftIsAtLeast } = input;
  const lines: string[] = [];
  if (perPerson && perPerson.length > 0) {
    lines.push(perPerson.map((p) => `${p.name}: ${papers(p.count)}`).join(', '));
  }
  if (left !== null) {
    if (left === 0) {
      lines.push('No paper is left without a verifier.');
    } else {
      const count = leftIsAtLeast ? `At least ${papers(left)}` : papers(left);
      lines.push(`${count} could not be given out by the rules, so ${left === 1 && !leftIsAtLeast ? 'it is' : 'they are'} still listed below. You can assign them yourself.`);
    }
  }
  if (gave <= 0) {
    return { tone: 'bad', headline: 'Nothing could be given out by the rules right now.', lines, failures: [] };
  }
  return { tone: left === 0 || left === null ? 'good' : 'mixed', headline: `Gave out ${papers(gave)}.`, lines, failures: [] };
}
