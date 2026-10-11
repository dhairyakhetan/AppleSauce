/**
 * Checker lanes: every flag the pipeline can put on a question, and the lane
 * that settles it, in plain English.
 *
 * The data below is a copy of the pipeline's lanes.json
 * (Shikshaq Papers/pipeline/auditor/pipeline/lanes.json, version 1), kept
 * as a committed JSON copy in src/content/checker-lanes.json. A test
 * (checker-lanes.test.ts) asserts this file matches that copy and that every
 * flag in it maps to a lane. To update: copy lanes.json over
 * src/content/checker-lanes.json, regenerate the tables below to match, and
 * the test says if they drifted.
 *
 * Owners:
 *   student_with_picture  a student settles it, looking at the page picture
 *   admin                 an admin settles it, a student is never asked
 *   ai_then_admin         the AI settles it; a student is never asked
 *
 * A code with no lane is NOT hidden: it renders the readableCode fallback and
 * unmappedCodes() reports it so a test (and a console warning) can see it.
 *
 * Pure: no React, no network.
 */

import { kidSentence, parseFlagDetail, kidDetail } from '@/lib/checker-kid-reasons';
import { studentEvidence } from '@/lib/checker-lost-text';

export type LaneOwner = 'student_with_picture' | 'admin' | 'ai_then_admin';

export interface Lane {
  id: string;
  name: string;
  owner: LaneOwner;
  what_to_do: string;
}

export const LANE_OWNERS: Record<LaneOwner, string> = {
  "student_with_picture": "A student settles it, looking at the page picture. Without a picture it goes to an admin instead.",
  "admin": "An admin settles it. A student is never asked.",
  "ai_then_admin": "The AI settles it on its own; whatever it cannot settle waits for an admin. A student is never asked."
};

const LANE_TABLE: Record<string, Omit<Lane, 'id'>> = {
  "read_words": {
    "name": "Read the words against the page",
    "owner": "student_with_picture",
    "what_to_do": "Compare the question with the printed page. Fix any word, number or symbol that differs. If the page itself has a mistake, say so, do not correct it."
  },
  "joined_or_split": {
    "name": "Joined or split questions",
    "owner": "student_with_picture",
    "what_to_do": "Two questions may be stuck together, or one question may be cut in two. Split or join them so each question stands on its own."
  },
  "page_clutter": {
    "name": "Page clutter in the question",
    "owner": "student_with_picture",
    "what_to_do": "Remove text that belongs to the page, such as a page number or a header, and leave only the question."
  },
  "options": {
    "name": "Answer options",
    "owner": "student_with_picture",
    "what_to_do": "Check that every option is there, in order, and matches the page."
  },
  "marks": {
    "name": "Marks",
    "owner": "student_with_picture",
    "what_to_do": "Check the marks against the page. If the page prints no marks for this question, leave the marks empty."
  },
  "number": {
    "name": "Question number",
    "owner": "student_with_picture",
    "what_to_do": "Fill in the number printed beside the question. If none is printed, leave it empty."
  },
  "figure": {
    "name": "Picture or diagram not attached",
    "owner": "student_with_picture",
    "what_to_do": "The question mentions a picture or diagram that is not attached. Check that the words read right. The figure itself is attached separately."
  },
  "empty_question": {
    "name": "Question with no words yet",
    "owner": "ai_then_admin",
    "what_to_do": "The words were lost, for example because an answer was printed inside the question. The AI transcribes them from the page, then a student checks the result."
  },
  "label": {
    "name": "Label tidy-up",
    "owner": "ai_then_admin",
    "what_to_do": "The chapter or kind of question is missing or unsure. The AI fills it from the paper; an admin settles what is left. Nothing is asked of a student."
  },
  "find_on_page": {
    "name": "Question not found on the page",
    "owner": "admin",
    "what_to_do": "The computer could not find this question on the page picture. An admin finds it, or sets the question aside."
  },
  "duplicate": {
    "name": "Possible duplicate",
    "owner": "admin",
    "what_to_do": "This question may already be on the site. An admin compares the two and keeps one."
  },
  "personal_data": {
    "name": "Possible personal details",
    "owner": "admin",
    "what_to_do": "The question may hold a real name, roll number or phone number. An admin checks and removes it."
  },
  "board_class": {
    "name": "Board or class may be wrong",
    "owner": "admin",
    "what_to_do": "The paper may be filed under the wrong board or class. An admin checks the paper's heading."
  },
  "rescan": {
    "name": "Needs a rescan",
    "owner": "admin",
    "what_to_do": "A page came back unreadable. The paper has to be scanned again, so no one can check it yet."
  },
  "other_script": {
    "name": "Needs a different reader",
    "owner": "admin",
    "what_to_do": "The page is in a script the reading software cannot handle. It needs a different reader."
  },
  "english_release": {
    "name": "English release check",
    "owner": "ai_then_admin",
    "what_to_do": "English questions are checked by the AI first and never reach students. An admin sees only what the AI could not settle."
  }
};

export const FLAG_LANES: Record<string, string> = {
  ocr_disagreement: "read_words",
  low_ocr_confidence: "read_words",
  incomplete_text: "read_words",
  short_body: "read_words",
  ocr_junk: "read_words",
  answer_in_question: "read_words",
  unbalanced_math_delim: "read_words",
  figure_text_mixed: "read_words",
  snippet_ocr_mismatch: "read_words",
  other: "read_words",
  ocr_fused: "joined_or_split",
  merged_subparts: "joined_or_split",
  page_furniture: "page_clutter",
  mcq_malformed: "options",
  marks_mismatch: "marks",
  missing_marks: "marks",
  display_number_missing: "number",
  numbering_gap: "number",
  cross_question_numbering_gap: "number",
  figure_missing: "figure",
  figure_ambiguous: "figure",
  empty_body: "empty_question",
  or_only_body: "joined_or_split",
  chapter_unresolved: "label",
  type_mismatch: "label",
  snippet_unaligned: "find_on_page",
  possible_duplicate: "duplicate",
  personal_data_suspected: "personal_data",
  board_class_mismatch: "board_class",
  ocr_dropout: "rescan",
  script_unsupported: "other_script",
  hidden_on_site: "english_release",
  rescue_ai_doubt: "english_release",
};

export const PREFIX_LANES: Record<string, string> = {
  split_from_: "joined_or_split",
  gate_: "english_release",
};


export const LANES: Record<string, Lane> = Object.fromEntries(
  Object.entries(LANE_TABLE).map(([id, l]) => [id, { id, ...l }]),
);

/** The lane for one flag code, or null when the code has none. */
export function laneForCode(code: string): Lane | null {
  const c = (code ?? '').trim();
  if (!c) return null;
  const id = FLAG_LANES[c] ?? Object.entries(PREFIX_LANES).find(([p]) => c.startsWith(p))?.[1];
  return (id && LANES[id]) || null;
}

/** Codes that have no lane (rendered by the readableCode fallback). */
export function unmappedCodes(codes: readonly string[] | null | undefined): string[] {
  return [...new Set((codes ?? []).map((c) => (c ?? '').trim()).filter((c) => c && !laneForCode(c)))];
}

/** A student is asked to do something about this lane (it has a picture to check against). */
export function askedOfStudent(lane: Lane): boolean {
  return lane.owner === 'student_with_picture';
}

export interface LaneBlock {
  lane: Lane;
  /** The flag codes on the question that fall in this lane. */
  codes: string[];
  /** The pipeline's own evidence, only when a student can read it. */
  detail: string | null;
  /** False when nothing is asked of a student here (shown muted, last). */
  asked: boolean;
}

export interface LaneSummary {
  blocks: LaneBlock[];
  /** Codes with no lane: plain fallback sentences, never silent. */
  unmapped: { code: string; sentence: string }[];
  /** A note not tied to one reason. */
  note: string | null;
}

/**
 * The lanes a question is in, in the order its flags are stored, asked
 * lanes first. Lost-text questions (blank body) show the transcription lane
 * only by the caller; this function only reads flags.
 */
export function describeLanes(
  flagReasons: readonly string[] | null | undefined,
  flagDetail: string | null | undefined,
): LaneSummary {
  const { byCode, general } = parseFlagDetail(flagDetail);
  const blocks = new Map<string, LaneBlock>();
  const unmapped: { code: string; sentence: string }[] = [];
  const seen = new Set<string>();
  for (const raw of flagReasons ?? []) {
    const code = (raw ?? '').trim();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    const lane = laneForCode(code);
    if (!lane) {
      unmapped.push({ code, sentence: kidSentence(code) });
      continue;
    }
    const block = blocks.get(lane.id) ?? { lane, codes: [], detail: null, asked: askedOfStudent(lane) };
    block.codes.push(code);
    block.detail = block.detail ?? kidDetail(studentEvidence(byCode[code]));
    blocks.set(lane.id, block);
  }
  const ordered = [...blocks.values()].sort((a, b) => Number(!a.asked) - Number(!b.asked));
  return { blocks: ordered, unmapped, note: kidDetail(studentEvidence(general)) };
}
