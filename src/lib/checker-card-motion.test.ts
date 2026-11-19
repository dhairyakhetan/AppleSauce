import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CARD_ENTER_MS,
  CARD_FADE_CLASS,
  CARD_REDUCED_MS,
  CARD_SWIPE_CLASS,
  cardEnterClass,
  cardId,
  isPaperChange,
  paperStripInfo,
} from '@/lib/checker-card-motion';

describe('paper change detection', () => {
  it('is a change only when both papers are known and differ', () => {
    expect(isPaperChange('A', 'B')).toBe(true);
    expect(isPaperChange('A', 'A')).toBe(false);
    // the first question of a visit is not a change
    expect(isPaperChange(null, 'A')).toBe(false);
    expect(isPaperChange(undefined, 'A')).toBe(false);
    expect(isPaperChange('A', null)).toBe(false);
    expect(isPaperChange('', 'A')).toBe(false);
  });
});

describe('paper strip', () => {
  const paper = { subject: 'Mathematics', cls: 'X', school: 'Dummy School', exam: 'Prelims', year: '2025' };

  it('names the paper, the class and subject, and where it is in the list', () => {
    const info = paperStripInfo(paper, [{ paper_id: 'p1' }, { paper_id: 'p2' }, { paper_id: 'p3' }], 'p2');
    expect(info.title).toBe('Dummy School, Prelims, 2025');
    expect(info.facts).toEqual(['Mathematics', 'Class X']);
    expect(info.position).toBe('Paper 2 of 3');
    expect(info.announcement).toBe('Next paper: Dummy School, Prelims, 2025');
  });

  it('leaves "Paper 2 of N" out when the list does not say', () => {
    expect(paperStripInfo(paper, undefined, 'p2').position).toBeNull();
    expect(paperStripInfo(paper, [{ paper_id: 'p1' }], 'p1').position).toBeNull();
    expect(paperStripInfo(paper, [{ paper_id: 'p1' }, { paper_id: 'p3' }], 'p2').position).toBeNull();
  });

  it('falls back to the usual paper label and ignores an unknown year', () => {
    const info = paperStripInfo({ subject: 'English', cls: 'IX', year: 'year-unknown' }, null, 'p');
    expect(info.title).toBe('English, Class IX');
  });
});

describe('card identity: the entrance plays once per question', () => {
  it('is the question id, so a refetch of the same question keeps the same card', () => {
    const q = { id: 'q1' };
    expect(cardId(q, null)).toBe('q1');
    expect(cardId({ id: 'q1' }, null)).toBe(cardId(q, null));
    expect(cardId({ id: 'q2' }, null)).not.toBe(cardId(q, null));
  });

  it('the card waiting for a question takes that question\'s id, so its words arrive without a second swipe', () => {
    expect(cardId(null, 'q2')).toBe(cardId({ id: 'q2' }, null));
    expect(cardId(null, null)).toBe('waiting');
  });
});

describe('motion: swipe in, or only fade under reduced motion', () => {
  it('picks the swipe normally and the fade for reduced motion', () => {
    expect(cardEnterClass(false)).toBe(CARD_SWIPE_CLASS);
    expect(cardEnterClass(true)).toBe(CARD_FADE_CLASS);
    expect(CARD_ENTER_MS).toBe(180);
    expect(CARD_REDUCED_MS).toBe(120);
  });

  const css = readFileSync(resolve(__dirname, '../components/checker/checker-motion.css'), 'utf8');

  it('the swipe moves 24px and fades, 180 ms, ease-out, transform and opacity only', () => {
    const swipe = css.slice(css.indexOf('@keyframes checkerCardSwipe'), css.indexOf('@keyframes checkerCardFade'));
    expect(swipe).toContain('translateX(24px)');
    expect(swipe).toContain('opacity: 0');
    expect(swipe.match(/^\s+([a-z-]+):/gm)?.map((m) => m.trim())).toEqual(['opacity:', 'transform:', 'opacity:', 'transform:']);
    expect(css).toMatch(/\.checker-card-swipe \{\s+animation: checkerCardSwipe 180ms cubic-bezier\(0\.2, 0, 0, 1\)/);
  });

  it('the reduced-motion fade has no movement', () => {
    const fade = css.slice(css.indexOf('@keyframes checkerCardFade'), css.indexOf('.checker-card-swipe {'));
    expect(fade).not.toContain('transform');
    expect(css).toMatch(/\.checker-card-fade \{\s+animation: checkerCardFade 120ms/);
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toContain('animation-name: checkerCardFade !important');
    expect(reduced).toContain('animation-duration: 120ms !important');
    expect(reduced).not.toContain('translate');
  });

  it('the card that leaves is not animated out', () => {
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(rules).not.toMatch(/exit|leave|fade-out/i);
  });
});
