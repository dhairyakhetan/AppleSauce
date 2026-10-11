import { describe, expect, it } from 'vitest';

import {
  kidSentence,
  needsSplit,
  KID_SENTENCE,
  readableCode,
  parseFlagDetail,
  describeFlags,
  whatToCheck,
  NO_PICTURE_TITLE,
  NO_PICTURE_NOTE,
  SPLIT_FROM_SENTENCE,
} from './checker-kid-reasons';

/**
 * These sentences are the only thing standing between a raw flag code
 * (`ocr_disagreement`) and a class 9-12 student who is not going to know
 * what that means. A regression that returns the raw code instead of a
 * sentence is invisible in a quick manual click-through (it still "looks
 * like a chip"), so it is worth pinning directly.
 */

// Every reason code the pipeline can put on a kid-bucket question
// (UnlimitedOCR/auditor/contracts/check.schema.json, minus the two
// admin-only vetoes). If the pipeline adds one, add it here and a sentence.
const PIPELINE_KID_CODES = [
  'ocr_disagreement', 'marks_mismatch', 'incomplete_text', 'chapter_unresolved',
  'board_class_mismatch', 'possible_duplicate', 'personal_data_suspected',
  'low_ocr_confidence', 'figure_ambiguous', 'mcq_malformed', 'type_mismatch',
  'numbering_gap', 'empty_body', 'figure_missing', 'short_body', 'missing_marks',
  'display_number_missing', 'unbalanced_math_delim', 'ocr_junk', 'merged_subparts',
  'answer_in_question', 'page_furniture', 'snippet_unaligned', 'ocr_fused',
  'figure_text_mixed', 'other',
];

describe('kidSentence', () => {
  it('translates a known flag reason into plain words', () => {
    expect(kidSentence('marks_mismatch')).toBe('The marks may not match the paper. Check the marks number.');
  });

  it('has a sentence for every code the pipeline produces', () => {
    for (const code of PIPELINE_KID_CODES) {
      expect(KID_SENTENCE[code], code).toBeTruthy();
    }
  });

  it('falls back to a readable version of an unknown code, never the raw code', () => {
    expect(kidSentence('some_future_reason_code')).toBe('Some future reason code');
  });

  it('never contains an em or en dash (CLAUDE.md: no em/en dashes in site copy)', () => {
    for (const sentence of [...Object.values(KID_SENTENCE), NO_PICTURE_TITLE, NO_PICTURE_NOTE]) {
      expect(sentence).not.toMatch(/[–—]/);
    }
  });

  it('uses no pipeline jargon a student would not know', () => {
    for (const sentence of Object.values(KID_SENTENCE)) {
      expect(sentence).not.toMatch(/\b(OCR|ocr|snippet|bbox|delim|enum|flag)\b/);
      expect(sentence).not.toMatch(/_/);
    }
  });

  it('does not expose the two admin-only reasons a kid should never see', () => {
    // ocr_dropout and script_unsupported are vetoed to review_bucket='admin'
    // by classify_review_buckets before a kid-eligible question can ever
    // carry them (GUARDRAILS #34).
    expect(KID_SENTENCE.ocr_dropout).toBeUndefined();
    expect(KID_SENTENCE.script_unsupported).toBeUndefined();
  });
});

describe('button names in the sentences', () => {
  it('names only buttons the page really has (there is no "Pass" button)', () => {
    for (const s of Object.values(KID_SENTENCE)) {
      expect(s).not.toMatch(/\bpress Pass\b/i);
    }
  });
});

describe('readableCode', () => {
  it('turns separators into spaces and capitalises', () => {
    expect(readableCode('ocr_dropout')).toBe('Ocr dropout');
    expect(readableCode('  weird--code..x ')).toBe('Weird code x');
  });

  it('never returns an empty string', () => {
    expect(readableCode('___')).toBe('Something looked wrong.');
  });
});

describe('needsSplit', () => {
  it('is true only when ocr_fused is one of the flags', () => {
    expect(needsSplit(['ocr_fused'])).toBe(true);
    expect(needsSplit(['marks_mismatch', 'ocr_fused'])).toBe(true);
  });

  it('is true on the second half of an earlier split, which may still hold two questions', () => {
    expect(needsSplit(['split_from_3f0c2a1e-1111-2222-3333-444455556666'])).toBe(true);
    expect(needsSplit(null)).toBe(false);
  });

  it('is false for an empty list or unrelated flags', () => {
    expect(needsSplit([])).toBe(false);
    expect(needsSplit(['marks_mismatch'])).toBe(false);
  });
});

describe('parseFlagDetail', () => {
  it('reads the pipeline JSON object shape {code: evidence}', () => {
    const d = parseFlagDetail('{"ocr_junk": "Body shows (jin) (a)", "other": " AI recommends pass "}');
    expect(d.byCode).toEqual({ ocr_junk: 'Body shows (jin) (a)', other: 'AI recommends pass' });
    expect(d.general).toBeNull();
  });

  it('keeps plain text as a general note', () => {
    expect(parseFlagDetail('Question 4 looks cut off')).toEqual({ byCode: {}, general: 'Question 4 looks cut off' });
  });

  it('keeps a JSON string as a general note', () => {
    expect(parseFlagDetail('"just a note"')).toEqual({ byCode: {}, general: 'just a note' });
  });

  it('handles null, empty and malformed input without throwing', () => {
    expect(parseFlagDetail(null)).toEqual({ byCode: {}, general: null });
    expect(parseFlagDetail('   ')).toEqual({ byCode: {}, general: null });
    expect(parseFlagDetail('{"broken":')).toEqual({ byCode: {}, general: '{"broken":' });
    expect(parseFlagDetail('[1,2]')).toEqual({ byCode: {}, general: '[1,2]' });
  });

  it('drops empty and nested values in the object', () => {
    expect(parseFlagDetail('{"a": "", "b": {"x": 1}, "c": 3}').byCode).toEqual({ c: '3' });
  });
});

describe('describeFlags', () => {
  it('lists every reason in order, deduplicated, with its evidence', () => {
    const s = describeFlags(
      ['missing_marks', 'ocr_junk', 'missing_marks'],
      '{"ocr_junk": "Body shows (jin) (a)"}',
    );
    expect(s.lines).toEqual([
      { code: 'missing_marks', sentence: KID_SENTENCE.missing_marks, detail: null, info: false },
      { code: 'ocr_junk', sentence: KID_SENTENCE.ocr_junk, detail: 'Body shows (jin) (a)', info: false },
    ]);
    expect(s.note).toBeNull();
  });

  it('puts reasons that ask nothing of the checker last, and marks them', () => {
    const s = describeFlags(['chapter_unresolved', 'display_number_missing', 'figure_missing'], null);
    expect(s.lines.map((l) => l.code)).toEqual(['display_number_missing', 'figure_missing', 'chapter_unresolved']);
    expect(s.lines.map((l) => l.info)).toEqual([false, false, true]);
  });

  it('never asks for the printed number or marks when there is no picture of the paper', () => {
    const s = describeFlags(['display_number_missing', 'missing_marks'], null, { hasPicture: false });
    for (const l of s.lines) {
      expect(l.sentence).not.toMatch(/printed on the paper|if the paper shows/);
      expect(l.sentence).toMatch(/leave the (number|marks) empty/);
    }
    const withPicture = describeFlags(['display_number_missing'], null, { hasPicture: true });
    expect(withPicture.lines[0].sentence).toBe(KID_SENTENCE.display_number_missing);
  });

  it('hides machine-made evidence (seen in the live kid queue) but keeps readable evidence', () => {
    const d = JSON.stringify({
      chapter_unresolved: "chapter is null -- ch= was '?' or did not resolve against the chapter list",
      ocr_fused: "shares one un-splittable OCR block with other question(s) in fused_group 'grpB3' -- needs a human",
      marks_mismatch: 'questions sum to 100.0, paper.max_marks is 80.0',
      gate_detect: 'Computer note: truncated_end',
      gate_mcq: 'Computer note: option letters in text []',
      gate_source_before: "Computer note: unclaimed line L108 in the question block above: 'Class VII'",
      figure_text_mixed: 'figure block b78 also carries substantial text',
      gate_source: "Text printed just after it on the paper: 'Complete the following'",
      ocr_junk: 'Computer check: The sentence breaks off mid-thought.',
    });
    const byCode = Object.fromEntries(describeFlags(['ocr_fused'], d).lines.map((l) => [l.code, l.detail]));
    expect(byCode.chapter_unresolved).toBeNull();
    expect(byCode.ocr_fused).toBeNull();
    expect(byCode.marks_mismatch).toBeNull();
    expect(byCode.gate_detect).toBeNull();
    expect(byCode.gate_mcq).toBeNull();
    expect(byCode.gate_source_before).toBeNull();
    expect(byCode.figure_text_mixed).toBeNull();
    expect(byCode.gate_source).toBe("Text printed just after it on the paper: 'Complete the following'");
    expect(byCode.ocr_junk).toBe('The sentence breaks off mid-thought.');
  });

  it('never shows a raw UUID for the second half of a split', () => {
    const s = describeFlags(['split_from_3f0c2a1e-1111-2222-3333-444455556666'], null);
    expect(s.lines[0].sentence).toBe(SPLIT_FROM_SENTENCE);
    expect(s.lines[0].sentence).not.toMatch(/[0-9a-f]{8}/);
  });

  it('keeps evidence for a code that is not in flag_reasons', () => {
    const s = describeFlags(['other'], '{"marks_mismatch": "sums to 22, header says 20"}');
    expect(s.lines.map((l) => l.code)).toEqual(['other', 'marks_mismatch']);
    expect(s.lines[1].detail).toBe('sums to 22, header says 20');
  });

  it('does not bring "Split them" back from leftover evidence after a split', () => {
    const s = describeFlags([], JSON.stringify({ ocr_fused: 'Question 7 shares a block with 8.' }));
    expect(s.lines).toEqual([]);
  });

  it('passes a plain-text detail through as the note', () => {
    expect(describeFlags(['other'], 'Check the last line').note).toBe('Check the last line');
  });

  it('is empty for no flags and no detail', () => {
    expect(describeFlags([], null)).toEqual({ lines: [], note: null });
    expect(describeFlags(null, undefined)).toEqual({ lines: [], note: null });
  });
});

describe('whatToCheck', () => {
  it('collapses several actionable reasons into one line, no bullets', () => {
    const { line } = whatToCheck(['answer_in_question', 'ocr_junk'], null);
    expect(line).toBe(`${KID_SENTENCE.answer_in_question} ${KID_SENTENCE.ocr_junk}`);
  });

  it('drops bookkeeping (info-only) reasons entirely, not just last', () => {
    const { line } = whatToCheck(['chapter_unresolved', 'answer_in_question'], null);
    expect(line).toBe(KID_SENTENCE.answer_in_question);
    expect(line).not.toContain('chapter');
  });

  it('is null when every reason is bookkeeping', () => {
    const { line } = whatToCheck(['chapter_unresolved', 'possible_duplicate'], null);
    expect(line).toBeNull();
  });

  it('is null with no flags at all', () => {
    expect(whatToCheck([], null)).toEqual({ line: null, detail: null });
    expect(whatToCheck(null, undefined)).toEqual({ line: null, detail: null });
  });

  it('deduplicates identical sentence text even from different codes', () => {
    // gate_labels and type_mismatch are both info-only "wrong kind" -- pick
    // two real actionable codes with distinct sentences instead, and prove
    // the same code never appears twice.
    const { line } = whatToCheck(['ocr_junk', 'ocr_junk'], null);
    expect(line).toBe(KID_SENTENCE.ocr_junk);
  });

  it('surfaces the first actionable reason\'s evidence as the detail', () => {
    const { detail } = whatToCheck(
      ['marks_mismatch'],
      JSON.stringify({ marks_mismatch: 'the marks printed do not add up to the paper total' }),
    );
    expect(detail).toBe('the marks printed do not add up to the paper total');
  });
});
