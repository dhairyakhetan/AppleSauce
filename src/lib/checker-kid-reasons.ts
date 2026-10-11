/**
 * Plain-words mapping for flag reason codes, for the paper checker (Kid
 * Mode). The reader is a class 9-12 student, so every sentence says what
 * looked wrong AND what to check, with no pipeline vocabulary.
 *
 * The code list is the pipeline's own enum: UnlimitedOCR/auditor/contracts/
 * check.schema.json and verify.schema.json (`reasons`), plus `ocr_fused`
 * and `numbering_gap` which validate_structured.py / numbering_check.py
 * write directly. `ocr_dropout` and `script_unsupported` are deliberately
 * absent: classify_review_buckets.py vetoes both to review_bucket='admin'
 * (GUARDRAILS #34), so they can never reach this screen, and a friendly
 * label here would only hide that something went wrong upstream. If one
 * ever does arrive it gets the readable fallback, not a sentence.
 *
 * `flag_detail` is stored as TEXT, but the pipeline writes a JSON object
 * into it: {"<code>": "<evidence sentence>"} (verify_decide.py,
 * validate_structured.py). parseFlagDetail() handles that shape, a bare
 * string, and anything malformed, and never throws.
 */

export const KID_SENTENCE: Record<string, string> = {
  ocr_disagreement: 'Two computer readings of this question did not agree. Read the words carefully against the paper.',
  marks_mismatch: 'The marks may not match the paper. Check the marks number.',
  incomplete_text: 'The question may be cut off. Check nothing is missing at the end.',
  chapter_unresolved: 'We could not tell which chapter this is from. You do not need to fix that, just check the question reads right.',
  board_class_mismatch: 'This may be filed under the wrong class or board.',
  possible_duplicate: 'This question may already be on the site. Just check it reads right, someone else sorts out repeats.',
  personal_data_suspected: 'This may have a real name, roll number or phone number in it. Check carefully.',
  low_ocr_confidence: 'The computer was not sure it read these words correctly. Compare them with the paper.',
  figure_ambiguous: 'It is not clear which picture or diagram goes with this question.',
  mcq_malformed: 'The answer options may be missing or mixed up. Check each option.',
  type_mismatch: 'This may be marked as the wrong kind of question.',
  numbering_gap: 'A question number seems to be missing near this one.',
  empty_body: 'This question has no words yet.',
  // 340 of 840 kid rows (2026-09-28). The old sentence stated the problem
  // and asked nothing, and a checker cannot attach a picture here.
  figure_missing:
    'This question talks about a picture or diagram that is not attached yet. You cannot add it here, and that is fine. Just check the words read right.',
  short_body: 'This looks too short to be a whole question. Check it was not cut off.',
  missing_marks: 'No marks are set. Fill in the marks if the paper shows them.',
  display_number_missing: 'No question number is set. Fill in the number printed on the paper.',
  unbalanced_math_delim: 'A maths part may be broken, like a bracket or symbol without its pair.',
  ocr_junk: 'Some letters look like random noise, not real words.',
  merged_subparts: 'Two parts of this question may be stuck together.',
  answer_in_question: 'The answer may have been typed into the question by mistake.',
  page_furniture: "Some page text, like 'Page 2 of 9', got mixed into the question. Remove it.",
  snippet_unaligned: 'The computer could not find this question on the page picture.',
  ocr_fused: 'A few questions got stuck together. Split them.',
  figure_text_mixed: 'This may be a picture, real words, or both. Check against the paper.',
  other: 'Something else looked wrong. Read the note below.',

  // W14, English (no pictures; UnlimitedOCR/auditor/pipeline/english_release.py
  // GATE_SENTENCE holds the same words, keep them in sync by hand). A hidden
  // question carries `hidden_on_site` plus one `gate_*` code per reason the
  // owner's release gate hid it for.
  hidden_on_site: 'This question is not on the website yet: an automatic check held it back. If it reads correctly and makes sense, press Looks right and it goes live.',
  rescue_ai_doubt: 'Two computer checks think something may be wrong with this question. Read it very carefully, and only press Looks right if it is really correct.',
  gate_not_ready: 'An earlier check marked this question as not ready. Read it carefully.',
  gate_paper: 'Answer lines were found somewhere in this paper. Make sure no answer is typed into this question or its passage.',
  gate_flags: 'An earlier check put a warning on this question. Read it carefully.',
  gate_detect: 'This question may be cut off, or two questions may be stuck together.',
  gate_text: 'The words may be broken or jumbled. Check it reads cleanly from start to end.',
  gate_source: 'Some text printed right after this question may be missing from it. Check nothing is cut off at the end.',
  gate_source_before: 'Some text printed just above this question may be missing, like the instruction or a word box. Check it makes sense on its own.',
  gate_source_extract: 'The paper had an extract heading here, but no extract is attached. Check the question makes sense without it.',
  gate_work: 'We are not sure which book, poem or play this is from. You do not need to fix that, just check the question reads right.',
  gate_extract: 'The extract (the lines from the book) may be missing or messy. Check the passage shown is clean and complete.',
  gate_reference: "This question says 'he', 'this person' or 'the poem' without saying who or which. Check a student could still tell what it means.",
  gate_labels: 'It may be filed as the wrong kind of question. You do not need to fix that, just check it reads right.',
  gate_type_marks: 'The marks may not fit this kind of question. Check the marks.',
  gate_mcq: 'The answer options may be missing or mixed up. Check every option is there.',
  gate_instruction: "The instruction may be missing (like 'Fill in the blanks'), or this may be only an instruction with no question.",
  gate_format: 'This may need underlining, bold or a blank line that got lost. Check the question still works without it.',
  gate_merged: 'Several separate questions may be stuck together in this one.',
  gate_needs_context: 'This question refers to a passage, box or table. Check it is shown and the question makes sense with it.',
  gate_passage: 'The passage may be missing or messy. Check the passage shown is clean and complete.',
  gate_prompt_input: 'This writing task refers to a notice or input (like a letter or chart). Check that input is included.',
  gate_out_of_scope: 'This kind of question was not covered by the automatic checks. Read it carefully.',
};

/** `some_future_code` -> "Some future code". Never returns the raw code. */
export function readableCode(code: string): string {
  const words = code
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (!words) return 'Something looked wrong.';
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The flag checker_split_question puts on the second half of a split:
 *  'split_from_<uuid>'. Read through readableCode it showed a checker a raw
 *  UUID ("Split from 3f0c..."). */
export const SPLIT_FROM_SENTENCE =
  'Someone split this off from the question before it. Check it reads as one whole question, with nothing missing at the start or end.';

export function kidSentence(reason: string): string {
  if (reason.startsWith('split_from_')) return SPLIT_FROM_SENTENCE;
  return KID_SENTENCE[reason] ?? readableCode(reason);
}

/**
 * Picture-aware sentences. "Fill in the number printed on the paper" is an
 * impossible instruction when the page shows no picture of the paper (139
 * of the 306 display_number_missing rows in the kid queue on 2026-09-28 had
 * no trustworthy crop), so without a picture the checker is told plainly to
 * leave it empty.
 */
const NO_PICTURE_SENTENCE: Record<string, string> = {
  display_number_missing:
    'No question number is set. You cannot see the paper for this one, so leave the number empty. That is fine.',
  missing_marks: 'No marks are set. You cannot see the paper for this one, so leave the marks empty. That is fine.',
  marks_mismatch: 'The marks on this paper may not add up. You cannot see the paper for this one, so leave the marks as they are.',
};

/** Reasons that ask nothing of the checker. Shown last, and muted. */
export const INFO_ONLY_CODES = new Set([
  'chapter_unresolved',
  'possible_duplicate',
  'gate_work',
  'gate_labels',
  'board_class_mismatch',
  'type_mismatch',
  'numbering_gap',
]);

/**
 * The pipeline's evidence, only when a student can read it. A lot of it is
 * written for engineers ("chapter is null -- ch= was '?'", "fused_group
 * 'grpB3'", "paper.max_marks is 80.0", "Computer note: truncated_end",
 * "unclaimed line L108"); shown under "What the computer noticed" that is
 * noise at best. Returns null for anything that looks machine-made, and
 * drops a leading "Computer check:" / "Computer note:" (the page already
 * says the computer noticed it).
 */
export function kidDetail(detail: string | null | undefined): string | null {
  if (!detail) return null;
  const text = detail.replace(/^\s*computer (check|note)\s*:\s*/i, '').trim();
  if (!text) return null;
  const machine = [
    /\b[a-z]+_[a-z0-9_]+\b/, // snake_case identifiers
    /\s--\s/, // engineer's dash
    /\bL\d+\b/, // line numbers
    /\bgrp[A-Z0-9]/,
    /\bblock b\d+/i,
    /\bq\d+_\d+/,
    /\bnull\b/,
    /\[\s*\]/,
    /\bOCR\b/i,
    /\bch=/,
    /\bparse|regex|segment map\b/i,
  ];
  if (machine.some((re) => re.test(text))) return null;
  return text;
}

/** Shows the "Split here" affordance for the reason that means the OCR fused
 * printed questions into one row, and on the second half of an earlier
 * split (it may still hold more than one question when three were fused). */
export function needsSplit(flagReasons: string[] | null | undefined): boolean {
  return (flagReasons ?? []).some((r) => r === 'ocr_fused' || r.startsWith('split_from_'));
}

export interface ParsedFlagDetail {
  /** Evidence keyed by reason code, from the pipeline's JSON object. */
  byCode: Record<string, string>;
  /** Free text that is not tied to one code (a bare string, or malformed JSON). */
  general: string | null;
}

export function parseFlagDetail(detail: string | null | undefined): ParsedFlagDetail {
  const text = (detail ?? '').trim();
  if (!text) return { byCode: {}, general: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { byCode: {}, general: text };
  }
  if (typeof parsed === 'string') {
    const s = parsed.trim();
    return { byCode: {}, general: s || null };
  }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const byCode: Record<string, string> = {};
    for (const [code, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string' && value.trim()) byCode[code] = value.trim();
      else if (typeof value === 'number' || typeof value === 'boolean') byCode[code] = String(value);
    }
    return { byCode, general: null };
  }
  // A number, array or null: not a shape the pipeline writes. Show the raw
  // text rather than silently dropping whatever someone put there.
  return { byCode: {}, general: text };
}

export interface FlagLine {
  code: string;
  sentence: string;
  /** The pipeline's own evidence for this code, when it gave any a student can read. */
  detail: string | null;
  /** True when the reason asks nothing of the checker (shown last, muted). */
  info: boolean;
}

export interface DescribeOptions {
  /** Whether the page is showing a picture of the printed paper. */
  hasPicture?: boolean;
}

export interface FlagSummary {
  lines: FlagLine[];
  /** A note not tied to one reason. */
  note: string | null;
}

/**
 * Every flag reason as a plain sentence, in the order stored, deduplicated,
 * each with its evidence when flag_detail has it. Evidence for a code that
 * is not in flag_reasons is still shown (as its own line) rather than lost.
 */
export function describeFlags(
  flagReasons: string[] | null | undefined,
  flagDetail: string | null | undefined,
  opts: DescribeOptions = {},
): FlagSummary {
  const { byCode, general } = parseFlagDetail(flagDetail);
  const hasPicture = opts.hasPicture ?? true;
  const sentenceFor = (code: string) =>
    (!hasPicture && NO_PICTURE_SENTENCE[code]) || kidSentence(code);
  const seen = new Set<string>();
  const lines: FlagLine[] = [];
  const push = (code: string, detail: string | null | undefined) =>
    lines.push({ code, sentence: sentenceFor(code), detail: kidDetail(detail), info: INFO_ONLY_CODES.has(code) });
  for (const raw of flagReasons ?? []) {
    const code = (raw ?? '').trim();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    push(code, byCode[code]);
  }
  for (const [code, detail] of Object.entries(byCode)) {
    // A split removes 'ocr_fused' from flag_reasons but leaves its evidence
    // in flag_detail; "Split them" must not come back without its button.
    if (seen.has(code) || code === 'ocr_fused') continue;
    seen.add(code);
    push(code, detail);
  }
  // What the checker must look at first; "you do not need to fix that" last.
  // Stable: equal groups keep the stored order.
  lines.sort((a, b) => Number(a.info) - Number(b.info));
  return { lines, note: kidDetail(general) };
}

/**
 * One plain "What to check" line, not a bulleted list. `describeFlags`
 * already keeps one sentence per distinct code; a question flagged for four
 * reasons at once used to show four bullet points, which reads like four
 * separate jobs when a checker only needs to read the question once and
 * keep all of them in mind. Bookkeeping reasons (INFO_ONLY_CODES -- "you do
 * not need to fix that") are dropped entirely here, not just shown last:
 * they ask nothing of the checker, so they are not part of what to check.
 * Sentences are deduplicated by their exact text, so two codes that read
 * the same (e.g. two "may be filed as the wrong kind" reasons) do not
 * repeat themselves.
 */
export function whatToCheck(
  flagReasons: string[] | null | undefined,
  flagDetail: string | null | undefined,
  opts: DescribeOptions = {},
): { line: string | null; detail: string | null } {
  const { lines, note } = describeFlags(flagReasons, flagDetail, opts);
  const actionable = lines.filter((l) => !l.info);
  const seenText = new Set<string>();
  const sentences: string[] = [];
  for (const l of actionable) {
    const key = l.sentence.trim().toLowerCase();
    if (seenText.has(key)) continue;
    seenText.add(key);
    sentences.push(l.sentence.trim());
  }
  if (sentences.length === 0) return { line: null, detail: note };
  // First sentence's evidence is the one shown -- the most specific thing
  // the pipeline noticed, not a wall of unrelated evidence strings.
  const firstDetail = actionable.find((l) => !l.info && l.detail)?.detail ?? null;
  return { line: sentences.join(' '), detail: firstDetail ?? note };
}

/** Shown in place of the picture when a question has none, or it failed to load. */
export const NO_PICTURE_TITLE = 'There is no picture for this question';
export const NO_PICTURE_NOTE = 'Just check that it reads correctly and makes sense. All the buttons still work.';
