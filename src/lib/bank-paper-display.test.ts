import { describe, expect, it } from 'vitest';
import {
  resolveDisplayNumber,
  showPaperExtras,
  showIncompleteNote,
  showQuestionInstructions,
  marksShownInText,
  showSuggestedTime,
  sectionHeadings,
  alternativeRuns,
  alternativeFollowerIds,
  subPartsOf,
  topLevelIds,
} from './bank-paper-display';

describe('resolveDisplayNumber (D66)', () => {
  it('prefers the recorded display_number over everything else', () => {
    expect(resolveDisplayNumber('2a', '1', '1')).toBe('2a');
  });

  it('falls back to the computed a/b/c run lettering when no display_number', () => {
    expect(resolveDisplayNumber(null, '1a', '1')).toBe('1a');
    expect(resolveDisplayNumber(undefined, '1a', '1')).toBe('1a');
  });

  it('falls back to the raw printed number when neither of the above exist', () => {
    expect(resolveDisplayNumber(null, undefined, '3')).toBe('3');
  });

  it('returns null (no badge) when nothing is known', () => {
    expect(resolveDisplayNumber(null, undefined, null)).toBeNull();
    expect(resolveDisplayNumber('', undefined, null)).toBeNull();
  });
});

describe('showPaperExtras (D66)', () => {
  it('is true when allowed time is set', () => {
    expect(showPaperExtras(45, null)).toBe(true);
  });

  it('is true when general instructions are set', () => {
    expect(showPaperExtras(null, 'Answer all questions in Section A.')).toBe(true);
  });

  it('is false when neither is set', () => {
    expect(showPaperExtras(null, null)).toBe(false);
  });
});

describe('showIncompleteNote (D66)', () => {
  it('is true only when a note is recorded', () => {
    expect(showIncompleteNote('Pages 4-5 are missing from the source scan.')).toBe(true);
    expect(showIncompleteNote(null)).toBe(false);
    expect(showIncompleteNote('')).toBe(false);
  });
});

describe('showQuestionInstructions (D66)', () => {
  it('is true only when the question carries its own instructions', () => {
    expect(showQuestionInstructions('Answer any three of the following.')).toBe(true);
    expect(showQuestionInstructions(null)).toBe(false);
    expect(showQuestionInstructions(undefined)).toBe(false);
  });
});

describe('marksShownInText', () => {
  it('hides the pill when the paper prints the same marks inline', () => {
    expect(marksShownInText(3, 'Find x. [3]')).toBe(true);
    expect(marksShownInText(3, 'Find x. [ 3 ]')).toBe(true);
  });
  it('keeps the pill otherwise, and never matches plain whitespace', () => {
    expect(marksShownInText(3, 'Find x in 3 steps.')).toBe(false);
    expect(marksShownInText(null, 'Find x. [3]')).toBe(false);
    expect(marksShownInText(2, null)).toBe(false);
  });
});

describe('showSuggestedTime (D77)', () => {
  it('is true only for a positive number', () => {
    expect(showSuggestedTime(5)).toBe(true);
    expect(showSuggestedTime(0)).toBe(false);
    expect(showSuggestedTime(null)).toBe(false);
    expect(showSuggestedTime(undefined)).toBe(false);
  });
});

describe('sectionHeadings (D77)', () => {
  it('places a heading on the first row of a run and never repeats it', () => {
    const map = sectionHeadings([
      { i: 'a', sec: 'Section A' },
      { i: 'b', sec: 'Section A' },
      { i: 'c', sec: 'Section B' },
      { i: 'd', sec: 'Section B' },
    ]);
    expect(map.get('a')).toBe('Section A');
    expect(map.get('b')).toBeUndefined();
    expect(map.get('c')).toBe('Section B');
    expect(map.get('d')).toBeUndefined();
  });

  it('is empty for a paper with no section_label at all', () => {
    const map = sectionHeadings([{ i: 'a', sec: null }, { i: 'b', sec: undefined }]);
    expect(map.size).toBe(0);
  });

  it('re-shows a heading if the same label returns after a different one', () => {
    const map = sectionHeadings([
      { i: 'a', sec: 'Section A' },
      { i: 'b', sec: 'Section B' },
      { i: 'c', sec: 'Section A' },
    ]);
    expect([...map.keys()]).toEqual(['a', 'b', 'c']);
  });
});

describe('alternativeRuns / alternativeFollowerIds (D77)', () => {
  it('groups consecutive rows sharing a non-blank alternative_group', () => {
    const runs = alternativeRuns([
      { i: 'q1', ag: null },
      { i: 'q7', ag: 'g1' },
      { i: 'q8', ag: 'g1' },
      { i: 'q9', ag: null },
    ]);
    expect(runs.get('q7')).toEqual(['q7', 'q8']);
    expect(runs.size).toBe(1);
    const followers = alternativeFollowerIds(runs);
    expect([...followers]).toEqual(['q8']);
  });

  it('does not group a lone row -- nothing to divide with OR', () => {
    const runs = alternativeRuns([{ i: 'q1', ag: 'g1' }, { i: 'q2', ag: null }]);
    expect(runs.size).toBe(0);
  });

  it('is empty for a paper with no alternative_group at all', () => {
    const runs = alternativeRuns([{ i: 'a', ag: null }, { i: 'b', ag: undefined }]);
    expect(runs.size).toBe(0);
    expect(alternativeFollowerIds(runs).size).toBe(0);
  });
});

describe('subPartsOf / topLevelIds (D77)', () => {
  it('maps a parent to its ordered sub-parts', () => {
    const rows = [{ i: '5', pid: null }, { i: '5a', pid: '5' }, { i: '5b', pid: '5' }, { i: '6', pid: null }];
    expect(subPartsOf(rows).get('5')).toEqual(['5a', '5b']);
    expect(topLevelIds(rows)).toEqual(['5', '6']);
  });

  it('ignores a parent_question_id that is not in this paper', () => {
    const rows = [{ i: 'a', pid: 'missing' }];
    expect(subPartsOf(rows).size).toBe(0);
    expect(topLevelIds(rows)).toEqual(['a']);
  });

  it('is a no-op for a paper with no parent_question_id at all', () => {
    const rows = [{ i: 'a', pid: null }, { i: 'b', pid: undefined }];
    expect(subPartsOf(rows).size).toBe(0);
    expect(topLevelIds(rows)).toEqual(['a', 'b']);
  });
});
