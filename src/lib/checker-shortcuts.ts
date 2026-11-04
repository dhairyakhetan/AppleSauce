/**
 * Keyboard shortcuts for the paper-checker (Kid Mode) screen. Ported from
 * the standalone auditor's `shortcuts.ts` / `lib/useShortcuts.ts`
 * (UnlimitedOCR/auditor/web/src), trimmed to the actions Kid Mode
 * actually has: Looks right / Fix it / Split / Ask the HOD / Skip / Undo. Kept as
 * pure functions (no DOM/React here) so they can be unit tested directly --
 * `matchCheckerShortcut` is the one thing a test needs to call.
 */

export type CheckerAction = 'pass' | 'fix' | 'split' | 'help' | 'skip' | 'undo';

export interface CheckerShortcutDef {
  action: CheckerAction;
  keys: string; // display form, shown in the small hint under the buttons
  key: string; // KeyboardEvent.key, lowercased
}

export const CHECKER_SHORTCUTS: CheckerShortcutDef[] = [
  { action: 'pass', keys: 'Enter / P', key: 'enter' },
  { action: 'pass', keys: 'Enter / P', key: 'p' },
  { action: 'fix', keys: 'F', key: 'f' },
  { action: 'split', keys: 'S', key: 's' },
  { action: 'help', keys: 'H', key: 'h' },
  { action: 'skip', keys: 'K', key: 'k' },
];

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/** A focused button or link already acts on Enter by itself, except the view-only buttons (a picture tile,
 *  See the whole page) that mark themselves `data-enter-passes`: after tapping one, Enter still means
 *  Looks right, as the checker expects. */
function isActivatableTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.closest('[data-enter-passes]')) return false;
  const tag = el.tagName;
  return tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY' || el.getAttribute('role') === 'button';
}

export interface ShortcutContext {
  /** Focus is in a text field: every shortcut is off. */
  isTyping: boolean;
  /** Ctrl, Cmd or Alt is held: the browser's own shortcut (Ctrl+F find,
   *  Ctrl+P print) must never also fire a checker action. It did: Ctrl+F
   *  opened Fix it, Ctrl+P passed the question. */
  hasModifier?: boolean;
  /** Focus is on a button or link: Enter already clicks it, so Enter must
   *  not ALSO pass the question (Cancel, then Enter, ran both). */
  onActivatable?: boolean;
}

/**
 * Pure matcher: given a key and where focus is, returns the action to run,
 * or null. No modifier keys are used (deliberately -- these are one-handed,
 * one-key presses for a class 9-12 student), which is exactly why shortcuts
 * are suppressed while typing in the Fix/Split text areas -- otherwise
 * typing the letter "f" while editing a body would fire "Fix it" -- and
 * whenever a modifier is held.
 *
 * The second argument may be a bare boolean (isTyping) for older callers.
 */
export function matchCheckerShortcut(key: string, ctx: boolean | ShortcutContext): CheckerAction | null {
  const c: ShortcutContext = typeof ctx === 'boolean' ? { isTyping: ctx } : ctx;
  if (c.isTyping || c.hasModifier) return null;
  const lower = key.toLowerCase();
  if (lower === 'enter' && c.onActivatable) return null;
  const hit = CHECKER_SHORTCUTS.find((s) => s.key === lower);
  return hit ? hit.action : null;
}

/** Real DOM entry point. Also ignores auto-repeat, so holding Enter down
 *  cannot pass a run of questions nobody read. */
export function matchCheckerKeyboardEvent(e: KeyboardEvent): CheckerAction | null {
  if (e.repeat) return null;
  return matchCheckerShortcut(e.key, {
    isTyping: isTypingTarget(e.target),
    hasModifier: e.ctrlKey || e.metaKey || e.altKey,
    onActivatable: isActivatableTarget(e.target),
  });
}

/** The hint under the buttons, naming only what works on this question. */
export function shortcutHint(opts: { canSplit: boolean; canPass: boolean; canUndo?: boolean }): string {
  const parts: string[] = [];
  if (opts.canPass) parts.push('Enter or P looks right');
  parts.push('F fix it');
  if (opts.canSplit) parts.push('S split');
  parts.push('H ask the HOD', 'K skip');
  return parts.join(', ');
}

export interface ShortcutRow {
  keys: string;
  does: string;
}

/**
 * The same shortcuts as {@link shortcutHint}, as rows for the "?" popover (the
 * long hint line under the buttons was too much on the screen). Only what works
 * on this question is listed; while a fix or a split is open the one key that
 * works is Escape.
 */
export function shortcutRows(opts: { canSplit: boolean; canPass: boolean; canUndo?: boolean; editing?: boolean }): ShortcutRow[] {
  if (opts.editing) return [{ keys: 'Esc', does: 'Cancel and go back' }];
  const rows: ShortcutRow[] = [];
  if (opts.canPass) rows.push({ keys: 'Enter or P', does: 'Looks right' });
  rows.push({ keys: 'F', does: 'Fix it' });
  if (opts.canSplit) rows.push({ keys: 'S', does: 'Split into two questions' });
  rows.push({ keys: 'H', does: 'Ask the HOD' }, { keys: 'K', does: 'Skip' });
  return rows;
}
