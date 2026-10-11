/**
 * How a checker's save reaches the server, and the printed-typo rule.
 * Pure, so it is tested without a login.
 *
 * Owner round 24 (2026-09-30): a student checker MAY correct a typo printed on
 * the paper. Everything else stays the old rule: make the text match the
 * printed paper exactly. The printed original is not lost: the save goes
 * through the version lock (20261002090000), so the version before the fix
 * stays in content_versions and an admin can revert to it.
 */

/**
 * 'locked': the question came with a version (20261002090000 applied), so the
 *   save names it and the server refuses with 40001 if the row moved on.
 * 'legacy': no version on the row, so the migration is not applied yet; the
 *   old unlocked RPCs keep the checker working until it is.
 * 'refuse': a printed-typo correction needs version history to keep the
 *   printed original, so without a version it is not sent at all.
 */
export function checkerSaveRoute(
  version: number | null | undefined,
  printedTypo: boolean,
): 'locked' | 'legacy' | 'refuse' {
  if (typeof version === 'number' && Number.isInteger(version) && version >= 1) return 'locked';
  return printedTypo ? 'refuse' : 'legacy';
}

export const TYPO_NEEDS_VERSION =
  'Typo corrections are not switched on yet. Fix only reading mistakes for now, or press Ask the HOD.';

export const TYPO_CHECKBOX_LABEL = 'The printed paper has a typo, and I corrected it';

export const TYPO_RULE_TITLE = 'Correcting a typo on the printed paper';
export const TYPO_RULE_NOTE =
  'Change only the misprinted letters, numbers or symbols. Keep every other word exactly as printed. The printed version is kept, and an admin can put it back.';

export const TYPO_NOTE_LABEL = 'What was the typo? (optional)';

export const TYPO_NEEDS_CHANGE = 'Change the words to correct the typo, or untick the typo box.';

/** The longest typo note the server keeps (checker_fix_locked trims to 500). */
export const TYPO_NOTE_MAX = 500;

/** Why a typo save cannot go yet, or null when it can. */
export function typoSaveProblem(printedTypo: boolean, bodyChanged: boolean): string | null {
  if (printedTypo && !bodyChanged) return TYPO_NEEDS_CHANGE;
  return null;
}
