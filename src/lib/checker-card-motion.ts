/**
 * The verify screen's card motion and the "the paper changed" cue, as plain
 * functions so the rules are tested without a browser (checker speed plan,
 * 12 Oct 2026).
 *
 * Motion (docs/CRAFT.md section 2): the question card swipes in from the
 * right, translateX(24px) to 0 with opacity 0 to 1, 180 ms, ease-out
 * cubic-bezier(0.2, 0, 0, 1), transform and opacity only. The card that is
 * leaving is NOT animated out: nothing waits for it. Under
 * prefers-reduced-motion the card only fades, 120 ms, and does not move.
 *
 * The CSS lives in checker-motion.css; this file picks the class.
 */

import { paperLabel } from '@/lib/checker-progress';
import type { MyPaper } from '@/lib/verifier-papers';

export const CARD_ENTER_MS = 180;
export const CARD_REDUCED_MS = 120;
export const CARD_EASE = 'cubic-bezier(0.2, 0, 0, 1)';
export const CARD_OFFSET_PX = 24;

export const CARD_SWIPE_CLASS = 'checker-card-swipe';
export const CARD_FADE_CLASS = 'checker-card-fade';

/** The class that plays when a new question card appears. */
export function cardEnterClass(reducedMotion: boolean): string {
  return reducedMotion ? CARD_FADE_CLASS : CARD_SWIPE_CLASS;
}

/**
 * What identifies a card. Only a change of this plays the entrance, so a
 * background refetch of the same question (same id, new fetch time) does not
 * replay it. The "waiting for the next question" card has no id of its own yet:
 * it takes the id of the question it is waiting for, when that is known, so
 * the real question then takes its place without a second swipe.
 */
export function cardId(question: { id: string } | null, waitingFor: string | null): string {
  return question?.id ?? waitingFor ?? 'waiting';
}

/** True when the question now on screen belongs to a different paper than the one before it. */
export function isPaperChange(previousPaperId: string | null | undefined, nextPaperId: string | null | undefined): boolean {
  return Boolean(previousPaperId) && Boolean(nextPaperId) && previousPaperId !== nextPaperId;
}

export interface PaperStripInfo {
  /** The paper's name, as everywhere else on the screen. */
  title: string;
  /** Small facts beside it: subject and class. */
  facts: string[];
  /** "Paper 2 of 3", only when the checker's list says where this paper is. */
  position: string | null;
  /** What a screen reader hears. */
  announcement: string;
}

type PaperFacts = { subject?: string | null; cls?: string | null; school?: string | null; exam?: string | null; year?: string | null };

const clean = (v: string | null | undefined) => (typeof v === 'string' && v.trim() !== '' && v !== 'year-unknown' ? v.trim() : '');

export function paperStripInfo(paper: PaperFacts, papers: readonly Pick<MyPaper, 'paper_id'>[] | null | undefined, paperId: string): PaperStripInfo {
  const named = [clean(paper.school), clean(paper.exam), clean(paper.year)].filter(Boolean).join(', ');
  const title = named || paperLabel(paper);
  const facts = [clean(paper.subject), clean(paper.cls) ? `Class ${clean(paper.cls)}` : ''].filter(Boolean);
  const at = papers ? papers.findIndex((p) => p.paper_id === paperId) : -1;
  const position = papers && at >= 0 && papers.length > 1 ? `Paper ${at + 1} of ${papers.length}` : null;
  return { title, facts, position, announcement: `Next paper: ${title}` };
}
