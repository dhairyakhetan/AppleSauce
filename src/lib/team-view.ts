import type { TeamStatsRow } from '@/lib/team-dashboard-api';

/* Pure helpers for /admin/team (Verifier progress): the totals, the one-line
   summary, and the "Showing 30 of N papers" window. Kept out of the page so
   they can be tested without rendering it. */

export interface TeamTotals {
  checked: number;
  passed: number;
  fixed: number;
  askedHelp: number;
  changedByAdmin: number;
}

export function totalsOf(stats: TeamStatsRow[]): TeamTotals {
  const sum = (pick: (r: TeamStatsRow) => number) => stats.reduce((n, r) => n + pick(r), 0);
  return {
    checked: sum((r) => r.questions_checked),
    passed: sum((r) => r.passed),
    fixed: sum((r) => r.fixed),
    askedHelp: sum((r) => r.asked_help),
    changedByAdmin: sum((r) => r.admin_overturns),
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** One line instead of five tiles: the figures the table rows do not add up for you. */
export function summaryLine(t: TeamTotals): string {
  const parts = [`${plural(t.checked, 'question', 'questions')} checked`, `${t.passed} passed`, `${t.fixed} fixed`, `${t.askedHelp} asked the HOD for help`];
  if (t.changedByAdmin > 0) parts.push(`${t.changedByAdmin} changed by an admin`);
  return parts.join(', ') + '.';
}

/** "2 of 3 verifiers checked a question": the header line. Active means checked at least one question in the range; the other listed verifiers are shown too, with zeros. */
export function activeWords(stats: TeamStatsRow[]): string {
  const active = stats.filter((r) => r.questions_checked > 0).length;
  return `${active} of ${plural(stats.length, 'verifier', 'verifiers')} checked a question`;
}

/** What a paper's progress says: nothing assigned when it has no questions, otherwise "2 open · 90% done". */
export function progressWords(row: { total: number; open_doubts: number; pct_done: number }): string {
  if (row.total === 0) return 'Nothing assigned';
  return `${row.open_doubts} open · ${row.pct_done}% done`;
}

export const PAPER_PAGE = 30;

/** "Showing 30 of 47 papers", or "47 papers" when everything is shown. */
export function papersShownText(shown: number, total: number): string {
  if (total === 0) return '';
  return shown >= total ? plural(total, 'paper', 'papers') : `Showing ${shown} of ${total} papers`;
}

/** How many to show after pressing Show more, never past the total. */
export function nextPaperLimit(limit: number, total: number): number {
  return Math.min(total, limit + PAPER_PAGE);
}

/** How many more the Show more button will add. */
export function moreCount(limit: number, total: number): number {
  return Math.max(0, Math.min(PAPER_PAGE, total - limit));
}
