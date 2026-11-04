import { describe, expect, it } from 'vitest';
import { describeLanes, FLAG_LANES, LANES, NOT_FOR_STUDENT_LINE, PREFIX_LANES } from './checker-lanes';
import { KID_SENTENCE, kidDetail, studentSafe, whatToCheck } from './checker-kid-reasons';
import { checkerErrorAdvice } from './checker-errors';

// What a student reads on the checker screen, release QA 2026-10-11 (findings
// 4, 5, 9, 10, 18, 19, 22). The lane tables are a copy of the pipeline's file
// and keep its words; these tests pin the words the STUDENT screen shows.

const BLOCKED = /\b(?:AI|A\.I\.)\b|\b(?:haiku|sonnet|opus|claude|gemini|gpt|llm|swarm|pipeline|model|confidence|auditor)\b/i;

describe('the filter on what the computer noticed', () => {
  it('blocks the machine words, whole words only', () => {
    for (const t of [
      'Haiku and Sonnet disagree about the marks',
      'The AI is unsure about this word',
      'Swarm confidence 0.62',
      'The model could not read the table',
      'Opus said pass',
      'A.I. check failed',
    ]) {
      expect(studentSafe(t), t).toBe(false);
      expect(kidDetail(t), t).toBeNull();
    }
  });

  it('lets ordinary sentences through', () => {
    for (const t of ['The marks add up to 100, the paper says 80.', 'The word mains looks wrong.', 'Said it paid well.']) {
      expect(studentSafe(t), t).toBe(true);
      expect(kidDetail(t), t).toBe(t);
    }
  });

  it('keeps machine words out of the lane blocks and the single line too', () => {
    const detail = JSON.stringify({ marks_mismatch: 'Haiku and Sonnet disagree about the marks', ocr_disagreement: 'Swarm confidence 0.62' });
    const lanes = describeLanes(['marks_mismatch', 'ocr_disagreement'], detail);
    expect(lanes.blocks.every((b) => b.detail === null)).toBe(true);
    expect(whatToCheck(['marks_mismatch', 'ocr_disagreement'], detail).detail).toBeNull();
  });
});

describe('every sentence a student can read is free of machine words and dashes', () => {
  it('flag sentences', () => {
    for (const [code, sentence] of Object.entries(KID_SENTENCE)) {
      expect(sentence, code).not.toMatch(BLOCKED);
      expect(sentence, code).not.toMatch(/[–—]/);
    }
  });

  it('lane titles and instructions as shown to a student', () => {
    const codes = [...Object.keys(FLAG_LANES), ...Object.keys(PREFIX_LANES).map((p) => `${p}x`)];
    const all = describeLanes(codes, null);
    expect(all.blocks.length).toBe(Object.keys(LANES).length);
    for (const b of all.blocks.filter((x) => x.asked)) {
      expect(b.title, b.lane.id).not.toMatch(BLOCKED);
      expect(b.text, b.lane.id).not.toMatch(BLOCKED);
      expect(b.title + b.text, b.lane.id).not.toMatch(/[–—]/);
    }
    expect(NOT_FOR_STUDENT_LINE).not.toMatch(BLOCKED);
    expect(NOT_FOR_STUDENT_LINE).not.toMatch(/[–—]/);
  });
});

describe('guidance that used to mislead', () => {
  it('incomplete_text has its own instruction: type the missing words, and look before Looks right', () => {
    const b = describeLanes(['incomplete_text'], null).blocks[0];
    expect(b.text).toContain('type any missing words');
    expect(b.text).not.toContain('If the page itself has a mistake');
    // another read_words code keeps the generic lane text
    expect(describeLanes(['ocr_disagreement'], null).blocks[0].text).toContain('Compare the question with the printed page.');
  });

  it('English questions are asked of the student, in the kid sentences, not "Not for you to settle"', () => {
    const s = describeLanes(['hidden_on_site', 'gate_source'], null);
    expect(s.blocks).toHaveLength(1);
    expect(s.blocks[0].asked).toBe(true);
    expect(s.blocks[0].title).toBe('English question');
    expect(s.blocks[0].text).toContain('press Looks right and it goes live');
    expect(s.blocks[0].text).toContain('Some text printed right after this question may be missing');
    expect(s.blocks[0].title + s.blocks[0].text).not.toMatch(/release check|never reach students|Not for you to settle/i);
  });

  it('the quiet lanes are one plain line, with no admin names', () => {
    expect(NOT_FOR_STUDENT_LINE).toBe('Other things the computer noticed are for your HOD, so you can ignore them.');
    const s = describeLanes(['chapter_unresolved', 'snippet_unaligned'], null);
    expect(s.blocks.every((b) => !b.asked)).toBe(true);
  });

  it('options say plainly that they cannot be edited here and who can', () => {
    const lane = describeLanes(['mcq_malformed'], null).blocks[0];
    expect(lane.text).toContain('You cannot change an option here');
    expect(lane.text).toContain('Ask the HOD');
    expect(KID_SENTENCE.mcq_malformed).toContain('Ask the HOD');
    expect(KID_SENTENCE.gate_mcq).toContain('Ask the HOD');
  });

  it('with no picture, the sentences say the paper cannot be seen; with a picture or page-flip they do not', () => {
    expect(whatToCheck(['display_number_missing'], null, { hasPicture: false }).line).toContain('You cannot see the paper');
    expect(whatToCheck(['display_number_missing'], null, { hasPicture: true }).line).toContain('Fill in the number printed on the paper');
  });

  it('a stale lease says the same question may come back', () => {
    expect(checkerErrorAdvice({ message: 'not currently assigned to you' }).message).toContain('or this one again');
  });
});
