/**
 * Everything a new verifier needs to get started, in one place with
 * no network and no Supabase: the routes, the once-per-account flag for the
 * walkthrough, the walkthrough steps, and the rules in plain words.
 *
 * The rules text quotes the live copy (FIX_RULE_NOTE, TYPO_RULE_NOTE,
 * TYPO_CHECKBOX_LABEL) rather than restating it, so the help page cannot
 * drift from what the Fix screen tells a checker.
 */

import { FIX_RULE_NOTE, MARKS_MOVE_BUTTON } from '@/lib/checker-body';
import { CHECKER_TOOLS } from '@/lib/checker-tools';
import { TYPO_CHECKBOX_LABEL, TYPO_RULE_NOTE } from '@/lib/checker-save';
import { CHECKER_SHORTCUTS, type CheckerAction } from '@/lib/checker-shortcuts';

export const CHECKER_PATH = '/checker';
export const CHECKER_PRACTICE_PATH = '/checker/practice';
export const CHECKER_HELP_PATH = '/checker/help';
/** `/checker?tour=1` replays the walkthrough. */
export const CHECKER_TOUR_PARAM = 'tour';

/* ---- once per account, per browser ------------------------------------ */

const SEEN_PREFIX = 'shikshaq:checker-walkthrough:v1:';

function seenKey(userId: string): string {
  return `${SEEN_PREFIX}${userId}`;
}

/** True when this account has already been shown (or skipped) the walkthrough
 *  in this browser. Storage unavailable counts as seen: never nag on every
 *  load, and never block the page. */
export function hasSeenWalkthrough(userId: string): boolean {
  try {
    return window.localStorage.getItem(seenKey(userId)) === '1';
  } catch {
    return true;
  }
}

export function markWalkthroughSeen(userId: string): void {
  try {
    window.localStorage.setItem(seenKey(userId), '1');
  } catch {
    // Nothing to persist; closing the walkthrough still works.
  }
}

/* ---- walkthrough steps ------------------------------------------------- */

export interface WalkthroughStep {
  /** Matches `data-tour="..."` on the real element in Checker.tsx. */
  target: 'paper' | 'picture' | 'question' | 'tools' | 'changes' | 'pass' | 'fix' | 'help' | 'skip' | 'undo';
  title: string;
  body: string;
}

/** The labels in these steps are the live button labels on the checker. */
export const WALKTHROUGH_STEPS: WalkthroughStep[] = [
  {
    target: 'paper',
    title: 'This is your paper',
    body: 'You get one paper at a time. The bar shows how far through it you are. When it is finished the next paper comes by itself.',
  },
  {
    target: 'picture',
    title: 'This is the printed paper',
    body: 'The orange box holds a photo of the real paper. It is always right. When the whole page is shown, a box on it marks where the computer found this question. Your job is to make the typed words match the photo. On a phone, use the Typed and Printed tabs to switch.',
  },
  {
    target: 'question',
    title: 'This is what the computer typed',
    body: 'Read it against the photo, slowly. The question number and the marks are at the top. Look at the words, the numbers and the marks.',
  },
  {
    target: 'tools',
    title: 'The tools',
    body: 'Fix the words, Split into two questions, Edit a formula, and This is just the OR. Point at one to see what it does. Each one opens the right box for you.',
  },
  {
    target: 'changes',
    title: 'What the computer changed',
    body: 'Open this to see what the computer tidied up, and to look at its very first reading. If a change made the words differ from the paper, fix it.',
  },
  {
    target: 'pass',
    title: 'Looks right',
    body: 'Press this when the typed words match the picture exactly. Most questions are like this.',
  },
  {
    target: 'fix',
    title: 'Fix it',
    body: 'Press this only when something differs from the picture: a wrong number, a missing word, wrong marks. Change just that, nothing else.',
  },
  {
    target: 'help',
    title: 'Ask the HOD',
    body: 'Not sure? Press this instead of guessing. Your HOD will look at it, and you carry on with the rest of your paper.',
  },
  {
    target: 'skip',
    title: 'Skip this question',
    body: 'Press this to skip the question for now. It stays on this paper for later, and you move to the next question.',
  },
  {
    target: 'undo',
    title: 'Undo last',
    body: 'Pressed something by mistake? Press this to take back your last answer. It works for 30 minutes, only on your own answers, and you can press it again to go back further.',
  },
];

/* ---- the rules, in plain words ---------------------------------------- */

export interface CheckerRule {
  title: string;
  body: string;
}

export const CHECKER_RULES: CheckerRule[] = [
  {
    title: 'The printed page is always right',
    body: 'Fix only what is different from the picture of the printed page. If the typed words already match it, press Looks right.',
  },
  {
    title: 'Never retype or improve the words',
    body: `${FIX_RULE_NOTE} If the paper itself says it that way, so do we.`,
  },
  {
    title: 'If the paper has a typo',
    body: `Normally leave it as printed. If it is a misprinted letter, number or symbol, open Fix it and tick "${TYPO_CHECKBOX_LABEL}". ${TYPO_RULE_NOTE}`,
  },
  {
    title: 'Not sure? Ask the HOD, do not guess',
    body: 'A wrong guess is worse than a question. If the words are scrambled, there are no words, or the picture shows a different question, press Ask the HOD.',
  },
  {
    title: 'If you cannot read the picture, skip it',
    body: 'Press Skip this question, or Hand this paper back if the whole paper is unreadable. Never fill in words you cannot see.',
  },
  {
    title: 'Two questions in one box',
    body: 'If the typed text is really two questions joined together, press "Split into two questions", tap where the second one starts and press Split here. If the two are joined by the word OR, tap just before or just after that OR: the OR is left out and the two questions are kept together as an either/or pair. A row that is only the word OR has its own button, "This is just the OR".',
  },
  {
    title: 'Marks go in the Marks box',
    body: `If the marks are written inside the typed words, like [3] at the end, a note says so. Press ${MARKS_MOVE_BUTTON}. It takes just the marks out of the words and puts the number in the Marks box. Nothing else changes.`,
  },
  {
    title: 'Fix formulas with the formula keypad',
    body: 'Press Edit a formula to change a fraction, a power or a root without typing any code. Select some words first to turn them into a formula. A box under the keypad shows how readers will see it.',
  },
];

/* ---- going back, skipping, and OR ---------------------------------------- */

/** Shown on the help page under "Taking back, skipping and OR". */
export const CHECKER_HELP_EXTRAS: CheckerRule[] = [
  {
    title: 'Undo last',
    body: 'Pressed the wrong button? Press Undo last (or the U key) to take back your last answer. It works for 30 minutes after you pressed, and only on your own answers. If anyone else has touched that question since, or the HOD has already dealt with it, it cannot be undone and you will be told why. Press it again to go back one more answer.',
  },
  {
    title: 'Skip for later',
    body: 'Press Skip this question when you want to leave one for now. It stays on this paper and you move to the next question. Skipped questions wait for you: when the others are done you can go through them, or go to another paper first. You can skip the last question on a paper too.',
  },
  {
    title: 'Split at the OR',
    body: 'When two questions are joined by the word OR, press "Split into two questions" and tap just before or just after the OR. The word OR is left out, and the two questions are kept together as an either/or pair. Nothing else in the words changes.',
  },
  {
    title: 'This is just the OR',
    body: 'If a row contains only the word OR and nothing else, press "This is just the OR". The row is set aside, and the question above and the one below are linked as an either/or pair.',
  },
  {
    title: 'What the computer changed',
    body: 'Under the typed words, "What the computer changed" lists what the computer tidied up before you got the question, like joining broken lines or fixing a word. "Show the computer\'s first reading" shows what it read from the picture before it tidied anything. Older questions do not have this. Always check against the printed paper, not against this list.',
  },
  {
    title: 'The box on the printed page',
    body: 'When the whole page is shown, a box on it marks where the computer found the question. It can be a little off, so read the whole area. If there is no box, the computer does not know where the question is, so find it yourself.',
  },
];

/* ---- the tools, read from checker-tools.ts ------------------------------- */

/** One entry per tool under the typed words, for the help page. */
export const CHECKER_TOOL_RULES: CheckerRule[] = CHECKER_TOOLS.map((t) => ({ title: t.label, body: t.help }));

/* ---- the shortcut table, read from checker-shortcuts.ts ---------------- */

export const ACTION_LABELS: Record<CheckerAction, string> = {
  pass: 'Looks right',
  fix: 'Fix it',
  split: 'Split into two questions',
  help: 'Ask the HOD',
  skip: 'Skip this question',
  undo: 'Undo last',
};

/** One row per action, in the order the shortcuts file lists them, with the
 *  key text exactly as the checker's own hint shows it. */
export function shortcutRows(): { action: CheckerAction; label: string; keys: string }[] {
  const seen = new Set<CheckerAction>();
  const rows: { action: CheckerAction; label: string; keys: string }[] = [];
  for (const s of CHECKER_SHORTCUTS) {
    if (seen.has(s.action)) continue;
    seen.add(s.action);
    rows.push({ action: s.action, label: ACTION_LABELS[s.action], keys: s.keys });
  }
  return rows;
}

/* ---- the admin guide on /admin/checkers -------------------------------- */

export function addVerifierSteps(origin: string): string[] {
  return [
    'The verifier signs up on the Shikshaq site with their own email address.',
    'Type that same email in the search box below. Their name appears. Press Add.',
    `Send them the link to ${origin}${CHECKER_PATH}. The first time they open it, a short walkthrough shows them around, and there is a practice round they can try.`,
  ];
}

export const NO_ACCOUNT_EXPLAINED =
  'If it says no account has that email, either the person has not signed up yet, or they signed up with a different email than the one you typed. Ask them which email they used.';

/* ---- the HODs section on /admin/checkers ------------------------------- */

export const HOD_PATH = '/hod';

export function addHodSteps(origin: string): string[] {
  return [
    'The person signs up on the Shikshaq site with their own email address, the same way a verifier does.',
    'Search for them below by name or email and press Make HOD. One HOD leads every verifier.',
    `Send them the link to ${origin}${HOD_PATH}. It shows the questions verifiers sent up, how each verifier is doing, and who holds which paper.`,
  ];
}

export const HOD_NOTE =
  'An HOD does not need to be a verifier. Removing an HOD only takes away the HOD desk; their earlier decisions stay. Admins can always open the HOD desk.';
