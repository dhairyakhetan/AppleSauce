import { toast } from 'sonner';
import type { GameType, Item } from '@/lib/games/engine';
import { CROSSWORD } from '@/lib/games/engine/crossword';
import { MATCHING } from '@/lib/games/engine/matching';
import { gridWord, loose } from '@/lib/games/engine/shared';
import { WORDSEARCH } from '@/lib/games/engine/wordsearch';
import { cn } from '@/lib/utils';

/* Plain helpers the games pages share (no components here): button looks, dates, saving and copying, "Undo", and the
   games' names with what each one needs. */

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** "9 Oct, 4:05 pm". */
export const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
/** "9 Oct 2026". */
export const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** Pill buttons, as on the HOD desk and the checker. One `brand` button per screen: the main action. */
const BTN =
  'tap-44 inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full px-4 text-[14px] font-semibold transition-transform duration-150 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50 disabled:active:scale-100 [&_svg]:size-4 [&_svg]:shrink-0';
const TONES = {
  brand: 'bg-brand text-foreground',
  dark: 'bg-panel text-background',
  /** On a card. */
  quiet: 'bg-muted text-warm-prose hover:text-foreground',
  /** On a muted surface. */
  card: 'bg-card text-foreground',
  danger: 'bg-destructive text-destructive-foreground',
  mint: 'bg-mint text-foreground',
} as const;
export const btn = (tone: keyof typeof TONES, extra?: string) => cn(BTN, TONES[tone], extra);
/** Smaller chips for actions under each row. */
export const chip = (tone: keyof typeof TONES, extra?: string) => cn(BTN, 'min-h-9 px-3 text-[13px]', TONES[tone], extra);
/** A text link that is a button. */
export const LINKISH = 'tap-44 font-semibold text-brand-blue underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded';
/** Text boxes on a muted surface. */
export const FIELD = 'w-full rounded-xl bg-card px-3 text-base text-foreground placeholder:text-warm-label outline-none ring-1 ring-border focus-visible:ring-2 focus-visible:ring-brand sm:text-[15px]';

/** Saves text as a file on the person's device. */
export function download(name: string, text: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

/** "Undo" for a few seconds after an action, instead of asking "are you sure?". */
export function offerUndo(what: string, restore: () => void) {
  toast(`${what}.`, { duration: 7000, action: { label: 'Undo', onClick: restore } });
}

export const GAME_NAMES: Record<GameType, string> = { crossword: 'Crossword', wordsearch: 'Word search', matching: 'Matching', fill: 'Fill in the blank' };

/** Why a game can't be made from these questions, in a sentence; null when it can. */
export function whyNot(type: GameType, items: Item[], made: boolean): string | null {
  if (made) return null;
  const letters = (min: number, max: number) => new Set(items.map((i) => gridWord(i.answer)).filter((w): w is string => !!w && w.length >= min && w.length <= max)).size;
  if (type === 'crossword') {
    const n = letters(CROSSWORD.minLetters, CROSSWORD.maxLetters);
    return n < CROSSWORD.min
      ? `Needs ${CROSSWORD.min} answers made only of letters, ${CROSSWORD.minLetters} to ${CROSSWORD.maxLetters} long. ${n === 0 ? 'None of these is.' : `Only ${n} ${n === 1 ? 'is' : 'are'}.`}`
      : "These answers don't cross each other well enough yet. A few more answers will help.";
  }
  if (type === 'wordsearch') {
    const n = letters(WORDSEARCH.minLetters, WORDSEARCH.maxLetters);
    return n < WORDSEARCH.min
      ? `Needs ${WORDSEARCH.min} answers made only of letters, ${WORDSEARCH.minLetters} to ${WORDSEARCH.maxLetters} long. ${n === 0 ? 'None of these is.' : `Only ${n} ${n === 1 ? 'is' : 'are'}.`}`
      : "These answers don't fit in a word search together yet. A few more answers will help.";
  }
  if (type === 'matching') {
    const n = new Set(items.map((i) => loose(i.answer))).size;
    return `Needs ${MATCHING.min} questions with different answers. ${n === 1 ? 'There is 1.' : `There are ${n}.`}`;
  }
  return 'Needs at least one question.';
}

