import { useEffect, useRef, type RefObject } from 'react';
import { toast } from 'sonner';
import { usableIn, type GameType, type Item } from '@/lib/games/engine';
import { CROSSWORD } from '@/lib/games/engine/crossword';
import { MATCHING } from '@/lib/games/engine/matching';
import { loose } from '@/lib/games/engine/shared';
import { WORDSEARCH } from '@/lib/games/engine/wordsearch';
import { readMeta } from '@/lib/games/details';
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
  'tap-44 inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full px-4 text-[14px] font-semibold transition-transform duration-150 active:scale-press focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-disabled disabled:active:scale-100 [&_svg]:size-4 [&_svg]:shrink-0';
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
export const LINKISH = 'tap-44 font-semibold text-brand-blue underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus rounded';
/** Text boxes on a muted surface. */
export const FIELD = 'w-full rounded-xl bg-card px-3 text-base text-foreground placeholder:text-warm-label outline-none ring-1 ring-border focus-visible:ring-2 focus-visible:ring-focus sm:text-[15px]';

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

export const GAME_NAMES: Record<GameType, string> = { crossword: 'Crossword', wordsearch: 'Word search', matching: 'Matching', fill: 'Fill in the blank', choice: 'Multiple choice' };

/** Why a game can't be made from these questions, in a sentence; null when it can. */
export function whyNot(type: GameType, items: Item[], made: boolean): string | null {
  if (made) return null;
  const n = items.filter((it) => usableIn(it).includes(type)).length;
  const have = n === 0 ? 'None of these does.' : `Only ${n} ${n === 1 ? 'does' : 'do'}.`;
  if (type === 'crossword') {
    return n < CROSSWORD.min
      ? `Needs ${CROSSWORD.min} answers made only of letters, ${CROSSWORD.minLetters} to ${CROSSWORD.maxLetters} long (an Also answer counts). ${have}`
      : "These answers don't cross each other well enough yet. A few more answers will help.";
  }
  if (type === 'wordsearch') {
    return n < WORDSEARCH.min
      ? `Needs ${WORDSEARCH.min} answers made only of letters, ${WORDSEARCH.minLetters} to ${WORDSEARCH.maxLetters} long (an Also answer counts). ${have}`
      : "These answers don't fit in a word search together yet. A few more answers will help.";
  }
  if (type === 'matching') {
    const k = new Set(items.filter((it) => usableIn(it).includes('matching')).map((i) => loose(i.answer))).size;
    return `Needs ${MATCHING.min} questions with different answers. ${k === 1 ? 'There is 1.' : `There are ${k}.`}`;
  }
  if (type === 'fill') return 'Needs a question with a Fill: line (a sentence with ___ where the answer goes).';
  return 'Needs a question with a Wrong: line (wrong options), or a True/False question.';
}

/** The kinds of line in the Questions box, each with its own colour (`gl-*` in games.css). */
export type LineKind = 'detail' | 'topic' | 'q' | 'a' | 'also' | 'fill' | 'wrong' | 'level';

/** What kind of line it is, for its colour (null: a chatbot's sentence or anything else). */
export function lineKind(line: string): LineKind | null {
  const m = line.match(/^\s*(q|a|also|fill|wrong|level)\s*\d*\s*:/i);
  if (m) return m[1].toLowerCase() as LineKind;
  const meta = readMeta(line);
  if (!meta) return null;
  return meta.key === 'topic' ? 'topic' : meta.key === 'difficulty' ? 'level' : 'detail';
}

/** The last value that was set: a popup closing keeps showing what it showed while it animates out, instead of
 * going blank (or saying something else) for its last fifth of a second. */
export function useLatch<T>(value: T | null | undefined): T | null | undefined {
  const last = useRef(value);
  if (value !== null && value !== undefined) last.current = value;
  return value ?? last.current;
}

/** The site's easing for things that settle (no bounce): quick to start, gentle to land. */
export const EASE_SETTLE = 'cubic-bezier(0.23, 1, 0.32, 1)';
/** True when the person asked for less motion: things then appear and change at once. */
export const lessMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * New content in place (another part, tab or puzzle): it fades and rises in a little each time `key` changes, without
 * being mounted again (so nothing in it loses its state). Not on the first showing, and not with reduced motion.
 */
export function useEnter(ref: RefObject<HTMLElement>, key: string) {
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const el = ref.current;
    if (!el || lessMotion() || typeof el.animate !== 'function') return;
    el.animate([{ opacity: 0, translate: '0 8px' }, { opacity: 1, translate: '0 0' }], { duration: 260, easing: EASE_SETTLE });
  }, [ref, key]);
}

/** What `useSmoothLayout` slides: page blocks and list rows, or anything marked `data-flip`. */
const BLOCKS = 'section, li, [data-flip]';
/** The y of an element's own `translate` (the part a slide adds), so its place in the layout can be read mid-slide. */
const ownShift = (el: Element) => { const t = getComputedStyle(el).translate; return t && t !== 'none' ? parseFloat(t.split(' ')[1] ?? '0') || 0 : 0; };

/**
 * When the page's height changes (a list appears, a part opens, a batch leaves), the blocks below the change slide to
 * their new place instead of jumping (a FLIP: each block remembers where it was on screen, and on a change starts from
 * there and eases to where it now is). A change above what is on screen moves nothing there: the browser keeps the view
 * steady, and so does this. A block inside another moves only by its own change, so nothing moves twice. A new change
 * mid-slide carries on from where things are. Nothing moves with reduced motion or on resizing the window. `root` is
 * the element itself (not a ref), so it starts watching once the element is on the page, and again for another one.
 */
export function useSmoothLayout(root: HTMLElement | null) {
  useEffect(() => {
    if (!root || typeof ResizeObserver === 'undefined') return;
    /** Where each block was: its top in its tracked parent, or in the part (at the top level). */
    const last = new Map<Element, number>();
    /** How far the page was scrolled then: the browser scrolls to keep the view steady when something above it
     * changes, and a block that moved by exactly that amount hasn't moved on screen. */
    let lastScroll = scrollY;
    const parentOf = (el: Element) => { const p = el.parentElement?.closest(BLOCKS); return p && root.contains(p) ? p : null; };
    const blocks = () => [...root.querySelectorAll(BLOCKS)].filter((el) => (el as HTMLElement).offsetParent !== null);
    // its place now, without its own slide: in its parent block (which may itself be sliding), or in the part
    const placeOf = (el: Element) => (el.getBoundingClientRect().top - ownShift(el)) - (parentOf(el) ?? root).getBoundingClientRect().top;
    const record = () => { last.clear(); for (const el of blocks()) last.set(el, placeOf(el)); lastScroll = scrollY; };
    record();

    let still = false; // a window resize: take note, don't slide
    // a part opening or closing in place (Reveal) already moves what is below it smoothly, a frame at a time: take note,
    // don't slide it again
    const growing = () => root.getAnimations({ subtree: true }).some((a) => a.id === 'reveal');
    const flip = () => {
      if (growing()) { record(); return; }
      const now = blocks();
      const moves: [Element, number][] = [];
      for (const el of now) {
        const was = last.get(el);
        const at = placeOf(el);
        last.set(el, at);
        if (was === undefined || still || lessMotion()) continue;
        const shift = ownShift(el);
        const steadied = parentOf(el) ? 0 : scrollY - lastScroll; // the browser's own scroll to keep the view steady
        const from = was - at + steadied + shift; // where it showed, from where it now is (its slide so far included)
        if (Math.abs(from) > 1) moves.push([el, from]);
      }
      still = false;
      lastScroll = scrollY;
      for (const [el, from] of moves) {
        for (const a of el.getAnimations()) if (a.id === 'flip') a.cancel();
        (el as HTMLElement).animate([{ translate: `0 ${from}px` }, { translate: '0 0' }], { duration: 340, easing: EASE_SETTLE, id: 'flip' });
      }
    };
    const ro = new ResizeObserver(flip);
    // the blocks watched; a block that has left the page is let go, so nothing holds on to it
    const watched = new Set<Element>();
    const watch = () => {
      ro.observe(root);
      for (const el of watched) if (!root.contains(el)) { ro.unobserve(el); watched.delete(el); last.delete(el); }
      for (const el of blocks()) if (!watched.has(el)) { ro.observe(el); watched.add(el); }
    };
    watch();
    // blocks that arrive or leave (a batch approved, a list opened): watch the new ones too
    const mo = new MutationObserver(() => { watch(); flip(); });
    mo.observe(root, { childList: true, subtree: true });
    // scrolling moves nothing in the layout: only take note of how far
    const onScroll = () => { lastScroll = scrollY; };
    // a resize: what it moves isn't slid; two frames on (after this frame's ResizeObserver), sliding is back on, even if
    // the part itself didn't change size (a phone keyboard opening)
    const onResize = () => { still = true; requestAnimationFrame(() => requestAnimationFrame(() => { still = false; })); };
    // a press or a key may change the page: take a fresh note of where everything is just before it does, so the slide
    // starts from exactly where things were on screen (not from a note taken before the page last settled)
    const beforeInput = () => { if (!root.getAnimations({ subtree: true }).some((a) => a.id === 'reveal')) record(); };
    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('resize', onResize);
    addEventListener('pointerdown', beforeInput, true);
    addEventListener('keydown', beforeInput, true);
    return () => {
      ro.disconnect(); mo.disconnect();
      removeEventListener('scroll', onScroll); removeEventListener('resize', onResize);
      removeEventListener('pointerdown', beforeInput, true); removeEventListener('keydown', beforeInput, true);
    };
  }, [root]);
}
