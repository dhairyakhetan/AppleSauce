/* The HOD desk checks itself after it gives a paper to someone (single, bulk or move).
   Owner, 12 Nov 2026: "the HOD screen shows a paper as assigned but the member never gets it".
   That could not be reproduced, so the screen no longer trusts the answer "done": it reads the assignments
   list back from the database (hod_assignments) and looks for the paper under the person it was given to.

   Pure: compares the read-back list with what was meant to happen. No network, no screen. */

import { summariseBulk, type BulkResult, type Outcome } from '@/lib/hod-bulk-assign';

/**
 * The only parts of an assignment row the check needs (a HodAssignment fits). hod_assignments lists only papers held
 * ('assigned') or waiting their turn ('queued'); a row that says anything else is not holding the paper.
 */
export interface HeldRow {
  paper_id: string;
  user_id: string;
  status?: string;
}

/** One give the screen meant to make: this paper, to this person. */
export interface IntendedGive {
  paperId: string;
  userId: string;
}

/** What to tell the person who looks after the website. Said the same way every time. */
export const NOT_LANDED_HELP = 'Nothing was lost. Try again, or tell the person who looks after the website.';

/** Said when the read-back could not be done, so the screen does not claim more than it knows. */
export const UNCHECKED_NOTE = 'We could not double-check that it arrived just now. Look for it under their name.';

/** True when the list shows this paper held (working on it, or waiting its turn) by this person. */
export function didLand(list: readonly HeldRow[], give: IntendedGive): boolean {
  return list.some((a) => a.paper_id === give.paperId && a.user_id === give.userId && (a.status === undefined || a.status === 'assigned' || a.status === 'queued'));
}

/** Which of the intended gives really landed, in the same order. */
export function landedFlags(list: readonly HeldRow[], gives: readonly IntendedGive[]): boolean[] {
  return gives.map((g) => didLand(list, g));
}

/** "you" (the HOD gave a paper to themself) reads "you do not have it", anyone else "<name> does not have it". */
function doesNot(name: string): string {
  return name === 'you' ? 'do not' : 'does not';
}

/** The red message for a single give that did not land. */
export function notLandedMessage(name: string): string {
  return `The system said it gave this paper to ${name}, but ${name} ${doesNot(name)} have it. ${NOT_LANDED_HELP}`;
}

/** The reason shown beside one paper in a bulk result. */
export function notLandedReason(name: string): string {
  return `The system said it gave this paper to ${name}, but ${name} ${doesNot(name)} have it.`;
}

const papers = (n: number) => `${n} ${n === 1 ? 'paper' : 'papers'}`;

export interface CheckedBulk {
  outcome: Outcome;
  /** Each paper's result, with a paper that did not land marked as not ok, in the order given. */
  results: BulkResult[];
  /** The red message to show in the alert box, or null when nothing went missing. */
  alert: string | null;
}

/**
 * The honest result of a bulk give. `results` is what the server said (ok or refused, per paper);
 * `list` is the assignments read back afterwards, or null when that read failed.
 * A paper the server said yes to but that is not under `userId` in the list is counted as "did not land".
 */
export function checkBulk(results: readonly BulkResult[], list: readonly HeldRow[] | null, userId: string, targetName: string): CheckedBulk {
  if (!list) {
    const base = summariseBulk(results, targetName);
    const gaveSome = results.some((r) => r.ok);
    return { outcome: gaveSome ? { ...base, lines: [...base.lines, UNCHECKED_NOTE] } : base, results: [...results], alert: null };
  }
  const missingIds = new Set(results.filter((r) => r.ok && !didLand(list, { paperId: r.paperId, userId })).map((r) => r.paperId));
  const checked: BulkResult[] = results.map((r) => (missingIds.has(r.paperId) ? { ...r, ok: false, error: notLandedReason(targetName) } : r));
  const missing = checked.filter((r) => missingIds.has(r.paperId));
  if (missing.length === 0) return { outcome: summariseBulk(checked, targetName), results: checked, alert: null };

  const landed = checked.filter((r) => r.ok).length;
  const refused = checked.length - landed - missing.length;
  const parts = [`${landed} of ${papers(checked.length)} really landed with ${targetName}.`];
  if (refused > 0) parts.push(`${refused} ${refused === 1 ? 'was' : 'were'} refused by the server.`);
  parts.push(`${missing.length} did not land: the system said it gave ${missing.length === 1 ? 'it' : 'them'}, but ${targetName} ${doesNot(targetName)} have ${missing.length === 1 ? 'it' : 'them'}.`);
  const headline = parts.join(' ');
  return {
    outcome: {
      tone: landed === 0 ? 'bad' : 'mixed',
      headline,
      lines: [NOT_LANDED_HELP, 'The papers that did not land are still ticked and still in the list.'],
      failures: checked.filter((r) => !r.ok).map((r) => ({ label: r.label, reason: r.error ?? 'That did not work.' })),
    },
    results: checked,
    alert: headline,
  };
}
