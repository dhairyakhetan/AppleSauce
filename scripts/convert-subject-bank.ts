#!/usr/bin/env tsx
/**
 * CONVERTER: subject question-bank JSON (History & Civics, Economics, English)
 *            -> the flat BankQuestion[] shape import-bank.ts already loads.
 *
 * Why a converter rather than a second importer: import-bank.ts is already
 * the byte-exact, idempotent, verified path into bank_papers/bank_questions.
 * The only thing standing between these files and that path is shape. Two
 * source shapes are handled, auto-detected per input file (isFlatShape()):
 *
 *   - NESTED: { metadata, papers, standalone_questions, context_groups }
 *     (History & Civics, Economics) — handled by convert().
 *   - FLAT: { metadata, papers, stimuli, questions }, linked by paper_id /
 *     stimulus_id rather than nesting (English) — handled by convertFlat().
 *
 * Either way this normalises shape ONLY. Question text is moved by reference
 * (JSON.parse -> assignment -> JSON.stringify), never rebuilt, sliced or
 * re-cased, so the "text is never altered" rule survives the extra hop.
 * verify() at the bottom re-reads the output and asserts every body still
 * matches its source character for character.
 *
 *   npx tsx scripts/convert-subject-bank.ts \
 *     --in "C:/Users/kanis/Downloads/history_civics_bank.json" \
 *     --in "C:/Users/kanis/Downloads/question_bank_economics.json" \
 *     --in "question_bank_english_partial.json" \
 *     --out data/question-bank-subjects.json
 *
 * Then feed the output through the existing importer.
 *
 * NOTE: run this and inspect its report BEFORE importing. It prints the
 * unresolved school names and the OCR split, both of which are decisions a
 * person should make rather than a script.
 */

import * as fs from 'fs';
import * as path from 'path';

import { schoolLabel, hasSchool, isBoardPaper, UNRESOLVED_SCHOOLS } from './school-names';

/* ------------------------------------------------------------------ types */

/** The incoming file's own shape. Only the fields we read are modelled. */
interface SourceFile {
  metadata: { subject: string; papers_included?: number };
  papers: SourcePaper[];
  standalone_questions: SourceQuestion[];
  context_groups: SourceGroup[];
}

interface SourcePaper {
  paper: string;
  school: string;
  class: string;
  year: string;
  exam_type: string;
  extraction: string;
}

interface SourceSrc {
  school?: string;
  class?: string;
  exam_type?: string;
  year?: string;
}

interface SourceQuestion {
  id: string;
  type?: string | null;
  marks?: number | null;
  question: string;
  options?: string[];
  topic?: string | null;
  subtopic?: string | null;
  source?: SourceSrc;
  provenance?: { paper?: string; extraction?: string };
}

interface SourceGroup {
  context_type?: string | null;
  context_description?: string | null;
  topic?: string | null;
  total_marks?: number | null;
  source?: SourceSrc;
  questions: { sub_label?: string | null; marks?: number | null; question: string; id: string }[];
  provenance?: { paper?: string; extraction?: string };
}

/** Matches scripts/bank-source.ts BankQuestion exactly. */
interface BankQuestion {
  i: string;
  p: string;
  n: string | null;
  t: string;
  m: number | null;
  c: string | null;
  s: string | null;
  y: string | null;
  e: string | null;
  k: string | null;
  ty: string | null;
  pg?: number;
  f?: string;
  o?: string[];
  /* Added for multi-subject support. bank_papers.subject already exists in
     the schema (text not null default 'Mathematics'), so this needs no
     migration — but bank-source.ts types it as the literal 'Mathematics'
     and papersOf() hardcodes it, which is what actually has to widen. */
  subj?: string;
}

/* ------------------------------------------------------------- conversion */

/* Paper id MUST be 6 lowercase hex characters.
   App.tsx's PaperRoute discriminates the two readers on the id's SHAPE:
   `/^[0-9a-f]{6}$/` goes to BankPaper, anything else to PaperReader (the
   Supabase `papers` reader). The 193 papers already in bank_papers are all
   6-hex. A filename-shaped id would therefore route every new paper to the
   wrong reader and 404 — so ids are minted as a stable hash of the source
   filename instead, deterministic so re-running upserts the same rows
   rather than duplicating them.

   Collisions are checked and resolved rather than assumed away: 456 ids in
   a 16.7M space is ~0.6% by the birthday bound, and the space is already
   shared with 193 live ids. */
function hash6(input: string, salt = 0): string {
  // FNV-1a 32-bit, then widened with the salt for collision resolution.
  let h = 0x811c9dc5;
  const s = salt ? `${input}#${salt}` : input;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0').slice(0, 6);
}

/** filename -> 6-hex id, unique within this run and against `taken`. */
function mintPaperId(filename: string, taken: Map<string, string>): string {
  const base = filename.replace(/\.pdf$/i, '');
  for (let salt = 0; salt < 1000; salt += 1) {
    const id = hash6(base, salt);
    const owner = taken.get(id);
    if (!owner) {
      taken.set(id, base);
      return id;
    }
    if (owner === base) return id; // same paper, already minted
  }
  throw new Error(`Could not mint a unique id for ${base}`);
}

/* "chapterwise" is a categorisation, not a sitting. Left as-is here so the
   value stays truthful, but flagged in the report because it will show up in
   any exam-type facet alongside real exams like "Board Examination". */
const isNonExam = (exam: string | null | undefined) =>
  (exam ?? '').trim().toLowerCase() === 'chapterwise';

/* Both source files number their questions from scratch — history has
   MCQ-0001 and economics has SA-0001, and ALL 4,331 economics ids collide
   with a history id. bank_questions.id is the primary key and import-bank.ts
   upserts on it, so importing both unprefixed would have silently
   overwritten 4,331 history questions with economics ones and reported
   success. Prefixing by subject is what keeps them distinct. Paper ids do
   NOT need this — those come from filenames that already carry the subject. */
const subjectPrefix = (subject: string) =>
  subject.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '').slice(0, 12);

function convert(file: SourceFile, srcName: string, takenPaperIds: Map<string, string>) {
  const subject = file.metadata.subject;
  const idPrefix = subjectPrefix(subject);
  const qid = (raw: string) => `${idPrefix}-${raw}`;
  const paperIdOf = (filename: string) => mintPaperId(filename, takenPaperIds);
  const out: BankQuestion[] = [];
  /* Per paper, so `ord` in the DB stays contiguous and unique — the table has
     a `unique (paper_id, ord)` constraint. */
  const ordByPaper = new Map<string, number>();
  const nextOrd = (p: string) => {
    const n = (ordByPaper.get(p) ?? 0) + 1;
    ordByPaper.set(p, n);
    return n;
  };

  const push = (
    id: string,
    paperFile: string,
    src: SourceSrc | undefined,
    number: string | null,
    text: string,
    marks: number | null,
    chapter: string | null,
    qtype: string | null,
    options?: string[],
  ) => {
    const p = paperIdOf(paperFile);
    nextOrd(p);
    out.push({
      i: id,
      p,
      n: number,
      t: text, // by reference, never rebuilt
      m: marks ?? null,
      c: chapter,
      s: src?.school ?? null,
      /* Coerced to string: 2,640 source rows carry `year` as a NUMBER
         (2022) rather than a string ("2023-24"), and papersOf() sorts
         papers with `b.year.localeCompare(a.year)` — which throws on a
         number. The bank's own year field is text (it holds values like
         "2023-24" and "year-unknown"), so string is the right shape. */
      y: src?.year === null || src?.year === undefined ? null : String(src.year),
      e: src?.exam_type ?? null,
      k: src?.class ?? null,
      ty: qtype,
      ...(options && options.length ? { o: options } : {}),
      subj: subject,
    });
  };

  for (const q of file.standalone_questions) {
    const paperFile = q.provenance?.paper ?? 'unknown-paper.pdf';
    push(
      qid(q.id),
      paperFile,
      q.source,
      null,
      q.question,
      q.marks ?? null,
      q.subtopic ?? q.topic ?? null,
      q.type ?? null,
      q.options,
    );
  }

  /* Context groups carry a shared stimulus (a quote, map, image or theme)
     plus sub-questions that only make sense underneath it. The schema has no
     group concept, and the alternative — prepending the stimulus onto each
     sub-question's body — would mean writing text the source never had, which
     the "never altered" rule forbids. So the stimulus becomes its own row
     immediately before its children (qtype 'context'), and each child keeps
     its own verbatim body and printed sub-label. Order does the grouping. */
  for (const g of file.context_groups) {
    const paperFile = g.provenance?.paper ?? 'unknown-paper.pdf';
    const groupId = g.questions[0]?.id?.split('_')[0] ?? `CG-${out.length}`;
    if (g.context_description) {
      push(
        qid(`${groupId}_CTX`),
        paperFile,
        g.source,
        null,
        g.context_description,
        g.total_marks ?? null,
        g.topic ?? null,
        g.context_type ? `context:${g.context_type}` : 'context',
      );
    }
    for (const sub of g.questions) {
      push(
        qid(sub.id),
        paperFile,
        g.source,
        sub.sub_label ?? null,
        sub.question,
        sub.marks ?? null,
        g.topic ?? null,
        'sub',
      );
    }
  }

  /* ------------------------------------------------------------- report */
  const ocrPapers = file.papers.filter((p) => p.extraction !== 'text_layer');
  const rawSchools = new Set(file.papers.map((p) => p.school));
  const unresolved = [...rawSchools].filter(
    (s) => !hasSchool(s) && !isBoardPaper(s),
  );
  const alreadyFlagged = new Set(UNRESOLVED_SCHOOLS.map((s) => s.toLowerCase()));
  const newlyUnresolved = [...rawSchools].filter(
    (s) => hasSchool(s) && alreadyFlagged.has(schoolLabel(s).toLowerCase()),
  );
  const nonExam = new Set(
    file.papers.filter((p) => isNonExam(p.exam_type)).map((p) => p.exam_type),
  );

  return {
    subject,
    srcName,
    rows: out,
    report: {
      papers: file.papers.length,
      standalone: file.standalone_questions.length,
      groups: file.context_groups.length,
      rowsProduced: out.length,
      ocrPapers: ocrPapers.length,
      distinctSchools: rawSchools.size,
      notASchoolOrUnknown: unresolved,
      abbreviationsNeedingExpansion: newlyUnresolved,
      nonExamExamTypes: [...nonExam],
    },
  };
}

/* -------------------------------------------------------- flat source shape */

/** English's own shape: flat, linked by id rather than nested. */
interface SourceFileFlat {
  metadata: { subject: string };
  papers: SourcePaperFlat[];
  stimuli: SourceStimulus[];
  questions: SourceQuestionFlat[];
}

interface SourcePaperFlat {
  paper: string; // source filename
  paper_id: string; // NOT the app's minted 6-hex scheme — see convertFlat()
  role: string; // 'question_paper' | 'marking_scheme'
}

interface SourceQuestionFlat {
  id: string;
  paper_id: string;
  school: string | null;
  class: string | null;
  exam_type: string | null;
  number: string | null;
  text: string;
  options?: string[];
  /* Typed as the extraction output's stated type, not trusted as it: 6 of
     10,070 rows carry a garbled non-numeric value ("s1", or "2" as a string
     rather than 2) — an OCR artifact, not real data. papersOf() sums this
     field with `+=` to get a paper's total marks; hitting one non-number
     silently switches that to string concatenation for the rest of the
     paper ("148" + "s1" + ... -> "148s1s1s10"), which then fails the
     numeric column on insert. See the coercion in pushRow() below. */
  marks: unknown;
  type: string | null;
  section: string | null;
  section_name: string | null;
  stimulus_id: string | null;
}

/** Same value if it's a real, finite number; null for anything else
    (including the garbled non-numeric marks values noted above) — the
    "never invent data" rule applies to nulling out garbage the same way it
    applies to leaving text alone. */
function numericOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/* Found live: a handful of "questions" turned out to be the paper's own
   front-matter rules ("This Question Paper contains 13 questions. All
   questions are compulsory.") extracted and numbered as if they were real
   sub-questions (1a, 1b, 1c, 1d) — confirmed on screen, tagged "SHORT" next
   to genuine content. Hand-verified against the full question set: 6 other
   entries mention similar phrases ("This paper consists of 7 printed
   pages...") but are page-footer boilerplate trailing AFTER a real
   question's actual text, not standing alone -- those stay untouched, since
   editing them would mean altering verbatim question text, which nothing
   here does. The distinguishing signal is structural, not just textual: the
   entry is short AND the instructional phrase sits at the very start (after
   stripping a leading numbering marker), meaning the ENTRY IS the
   instruction, not a real question with noise appended to it. Precision
   checked against all 10,070 questions before this was wired in: exactly 5
   matches, all 5 hand-confirmed as pure instructions, zero false positives
   against the 6 known noisy-but-real questions. */
const INSTRUCTION_OPENERS = [
  'this question paper contains',
  'this question paper is divided',
  'attempt all questions based on specific instructions',
  'write the correct question number',
  'internal choice has been given',
  'all questions are compulsory',
];
const LEADING_MARKER = /^[([]?[ivxIVX0-9]{1,4}[)\].]?\s*/;

function isStandaloneInstruction(text: string | null | undefined): boolean {
  const t = (text ?? '').trim();
  if (!t || t.length > 250) return false;
  const body = t.replace(LEADING_MARKER, '').trim().toLowerCase();
  return INSTRUCTION_OPENERS.some((o) => body.startsWith(o));
}

/** A shared reading passage referenced by one or more questions. */
interface SourceStimulus {
  id: string;
  paper_id: string;
  kind: string | null;
  title: string | null;
  text: string;
}

function isFlatShape(file: unknown): file is SourceFileFlat {
  const f = file as { questions?: unknown; stimuli?: unknown };
  return Array.isArray(f.questions) && Array.isArray(f.stimuli);
}

/* -------------------------------------------------- school from filename */

/* This source carries no school field anywhere — not on a question, not on
   its own paper record (checked by hand against all 503 paper entries: the
   `school` key is null on every one). The name only survives in the raw
   filename ("030_Don_Bosco_School_Siliguri_2024_12_English_Language_
   (ICSE).pdf"), and those filenames are inconsistent enough — abbreviations,
   missing years, reordered segments, board-only papers, regional-language
   specimen papers with no school at all — that only a fraction match one
   clean shape. Prototyped separately against all 403 filenames and reviewed
   by hand (345/403 resolved) before being ported here; see the session
   notes for the review. This extracts a best-effort RAW candidate only —
   messy on purpose, matching how the other three subjects' school strings
   already arrive ("Avm Juhu Icse10 Preprelim", per school-names.ts's own
   comment) — and leans on the existing schoolLabel()/CODE_FRAGMENTS/
   SCHOOL_ALIASES pipeline to do the actual cleanup, same as every other
   subject. A wrong school name is worse than a terse one (school-names.ts's
   own rule), so this is deliberately conservative: it leaves a filename
   unresolved (null) rather than guess through it. */

const CLASS_NUMERALS = new Set(['IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII']);
const LANGUAGE_TOKENS = new Set([
  'kannada', 'malayalam', 'manipuri', 'mizo', 'odia', 'tamang', 'tangkhul',
  'tibetan', 'lepcha', 'sherpa', 'bhutia', 'assamese', 'nepali', 'french', 'fre',
]);
const GENERIC_LEADERS = new Set([
  'class', 'board', 'semester', 'sem', 'ms', 'sqp', 'unknown', 'eng', 'english',
  'lit', 'literature', 'language', 'lang', 'i10', 'x', 'xii', 'xi', 'ix', 'viii',
  'vii', 'vi', 'iv', 'v', 'the', 'a', 'an', 'grade', 'paper', 'term', 'ut', 'pb', 'hy',
]);
// Underscores/dots/dashes are separators here, not word characters — \b does
// not fire between "_" and a letter (both count as \w), which silently
// swallowed a trigger word into the "school" half until this was found by
// running the prototype against all 403 filenames and reading the output.
const TRIGGER = /\b(eng\.?|english|lit\.?|literature|language|lang|sqp|board|semester|sem\d?|prelim|preboard|assmnt|exam|term\d?|class|grade\d?|i10|icse|cbse|isc|igcse|wk|sheet|sht|marks?\d|ms)\b/i;
const ORDINAL_ONLY = /^\d+(st|nd|rd|th)?$/i;
const BOARD_LEADER = /^(icse|cbse|isc|igcse|ib)\b/i;

const normalizeSeps = (s: string) => s.replace(/[_-]+/g, ' ');
const hasTrigger = (s: string) => TRIGGER.test(normalizeSeps(s));

function tierBoard(base: string): string | null {
  const m = BOARD_LEADER.exec(normalizeSeps(base));
  return m ? m[1].toUpperCase() : null;
}

function tierA(base: string): string | null {
  const parts = base.split('_');
  if (parts.length < 3) return null;
  for (let i = 1; i < parts.length; i += 1) {
    const tok = parts[i].trim().toUpperCase();
    if (CLASS_NUMERALS.has(tok) || tok === 'UNKNOWN') {
      const candidate = parts.slice(0, i).join('_').trim();
      return candidate && !hasTrigger(candidate) ? candidate : null;
    }
  }
  return null;
}

function tierB(base: string): string | null {
  const m = /^\d+_(.+?)_(19|20)\d{2}_\d{1,2}_/.exec(base);
  return m ? m[1].trim() : null;
}

function tierC(base: string): string | null {
  const norm = normalizeSeps(base);
  const m = TRIGGER.exec(norm);
  if (!m || m.index === 0) return null;
  return norm.slice(0, m.index).trim() || null;
}

function cleanCandidate(raw: string | null): string | null {
  if (!raw) return null;
  let s = raw.replace(/[_-]+/g, ' ').trim();
  s = s.replace(/\s{2,}/g, ' ');
  if (!s) return null;
  const low = s.toLowerCase();
  if (GENERIC_LEADERS.has(low) || LANGUAGE_TOKENS.has(low)) return null;
  if (ORDINAL_ONLY.test(s)) return null;
  if (/^class\s?\d+$/i.test(s)) return null;
  if (!/[a-zA-Z]/.test(s)) return null;
  if (s.replace(/[^a-zA-Z]/g, '').length <= 1) return null;
  return s;
}

/** Best-effort raw school string from a source filename, or null if nothing
    reliable enough was found. Never guesses — see the file-level comment. */
function schoolFromFilename(filename: string): string | null {
  const base = filename.replace(/\.pdf$/i, '');
  const raw = tierBoard(base) ?? tierA(base) ?? tierB(base) ?? tierC(base);
  return cleanCandidate(raw);
}

/* English (and any future subject shipped this way) arrives flat rather than
   nested, with paper_id/stimulus_id links instead of standalone_questions/
   context_groups. Each question is already a complete, verbatim record —
   its `parts` array (not modelled above; unused) is a list of the sub-part
   LABELS ("i", "ii", "a") that already appear inline in its own `text`, not
   separate sub-question bodies — so this is a flatter mapping than convert()
   above: one row per question, plus one row per stimulus, pushed once,
   immediately before the first question that needs it. Same "shared context
   becomes its own row" resolution convert() already uses for context_groups,
   so a paper still reads passage-then-questions in its original order. */
function convertFlat(file: SourceFileFlat, srcName: string, takenPaperIds: Map<string, string>) {
  const subject = file.metadata.subject;
  const idPrefix = subjectPrefix(subject);
  const qid = (raw: string) => `${idPrefix}-${raw}`;

  /* Source paper_ids are not the app's hash6(filename) scheme — verified by
     hand, they don't reproduce it — so they're re-minted here exactly like
     every other subject rather than trusted as collision-safe against the
     live table. Only minted for papers something actually references: the
     100 marking-scheme entries in this file carry zero questions and would
     otherwise burn id-mint attempts for rows nothing will ever use. */
  const neededPaperIds = new Set<string>();
  file.questions.forEach((q) => neededPaperIds.add(q.paper_id));
  file.stimuli.forEach((s) => neededPaperIds.add(s.paper_id));

  const paperIdMap = new Map<string, string>(); // source paper_id -> minted id
  // source paper_id -> best-effort school, from the filename (see schoolFromFilename above)
  const schoolByPaperId = new Map<string, string | null>();
  for (const p of file.papers) {
    if (neededPaperIds.has(p.paper_id)) {
      paperIdMap.set(p.paper_id, mintPaperId(p.paper, takenPaperIds));
      schoolByPaperId.set(p.paper_id, schoolFromFilename(p.paper));
    }
  }

  const out: BankQuestion[] = [];
  const ordByPaper = new Map<string, number>();
  const nextOrd = (p: string) => {
    const n = (ordByPaper.get(p) ?? 0) + 1;
    ordByPaper.set(p, n);
    return n;
  };

  const pushRow = (
    id: string, mintedPaperId: string, number: string | null, text: string,
    marks: number | null, chapter: string | null, school: string | null,
    examType: string | null, cls: string | null, qtype: string | null,
    options?: string[],
  ) => {
    nextOrd(mintedPaperId);
    out.push({
      i: id, p: mintedPaperId, n: number, t: text, m: marks ?? null,
      c: chapter, s: school ?? null, y: null, // this source carries no year field at all
      e: examType ?? null, k: cls ?? null, ty: qtype,
      ...(options && options.length ? { o: options } : {}),
      subj: subject,
    });
  };

  const emittedStimuli = new Set<string>();
  const stimulusById = new Map(file.stimuli.map((s) => [s.id, s]));
  const pushStimulus = (
    s: SourceStimulus, mintedPaperId: string,
    school: string | null, examType: string | null, cls: string | null,
  ) => {
    if (emittedStimuli.has(s.id)) return; // one paper's questions can share it
    emittedStimuli.add(s.id);
    pushRow(
      qid(`stim-${s.id}`), mintedPaperId, null, s.text, null,
      s.title ?? null, school, examType, cls,
      s.kind ? `context:${s.kind}` : 'context',
    );
  };

  /* File order is page order within a paper (extraction emits top to
     bottom), so walking `questions` as given and pushing a not-yet-seen
     stimulus right before the question that needs it reproduces the
     original passage-then-questions order without any re-sorting. */
  const skippedInstructions: string[] = [];
  for (const q of file.questions) {
    const mintedPaperId = paperIdMap.get(q.paper_id);
    if (!mintedPaperId) continue; // defensive; every question's paper_id resolved in a dry run

    if (isStandaloneInstruction(q.text)) {
      // Not a question at all -- see isStandaloneInstruction()'s own
      // comment. Dropped entirely rather than imported and numbered
      // alongside real questions.
      skippedInstructions.push(qid(q.id));
      continue;
    }

    // The source's own q.school is null on every row (checked by hand) —
    // schoolFromFilename()'s per-paper result is the only signal there is.
    const school = schoolByPaperId.get(q.paper_id) ?? null;

    if (q.stimulus_id) {
      const stim = stimulusById.get(q.stimulus_id);
      if (stim) pushStimulus(stim, mintedPaperId, school, q.exam_type, q.class);
    }

    pushRow(
      qid(q.id), mintedPaperId, q.number ?? null, q.text, numericOrNull(q.marks),
      q.section_name ?? q.section ?? null, school, q.exam_type, q.class,
      q.type ?? null, q.options,
    );
  }

  /* ------------------------------------------------------------- report */
  if (skippedInstructions.length) {
    console.log(`  dropped ${skippedInstructions.length} standalone-instruction "questions" (not real content): ` +
      skippedInstructions.join(', '));
  }
  const questionPapers = file.papers.filter((p) => p.role === 'question_paper');
  const rawSchools = new Set(schoolByPaperId.values());
  const unresolved = [...rawSchools].filter((s) => !hasSchool(s) && !isBoardPaper(s));
  const alreadyFlagged = new Set(UNRESOLVED_SCHOOLS.map((s) => s.toLowerCase()));
  const newlyUnresolved = [...rawSchools].filter(
    (s) => hasSchool(s) && alreadyFlagged.has(schoolLabel(s).toLowerCase()),
  );

  return {
    subject,
    srcName,
    rows: out,
    report: {
      papers: questionPapers.length,
      standalone: file.questions.length,
      groups: file.stimuli.length,
      rowsProduced: out.length,
      ocrPapers: 0, // this source's extraction field is per-question, not summarised here
      distinctSchools: rawSchools.size,
      notASchoolOrUnknown: unresolved,
      abbreviationsNeedingExpansion: newlyUnresolved,
      nonExamExamTypes: [] as string[],
    },
  };
}

/* ------------------------------------------------------------------ main */

function parseArgs() {
  const args = process.argv.slice(2);
  const ins: string[] = [];
  let out = 'data/question-bank-subjects.json';
  let reserved = '';
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--in') ins.push(args[i + 1]);
    if (args[i] === '--out') out = args[i + 1];
    // A newline/comma list of ids already live in bank_papers, so minted ids
    // cannot collide with production rows.
    if (args[i] === '--reserve') reserved = args[i + 1];
  }
  return { ins, out, reserved };
}

function main() {
  const { ins, out, reserved } = parseArgs();
  if (!ins.length) {
    console.error('Usage: --in <file.json> [--in <file2.json>] [--out <dest.json>] [--reserve <ids.txt>]');
    process.exit(1);
  }

  /* Seeded with every id already in bank_papers so a minted id can never
     land on a live paper and silently overwrite it on upsert. */
  const takenPaperIds = new Map<string, string>();
  if (reserved && fs.existsSync(reserved)) {
    const ids = fs.readFileSync(reserved, 'utf-8').split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
    ids.forEach((id) => takenPaperIds.set(id, '__live__'));
    console.log(`Reserved ${ids.length} existing paper ids against collision.`);
  } else if (reserved) {
    console.error(`--reserve file not found: ${reserved}`);
    process.exit(1);
  }

  const all: BankQuestion[] = [];
  const sources: { text: string; id: string }[] = [];

  for (const inPath of ins) {
    if (!fs.existsSync(inPath)) {
      console.error(`Not found: ${inPath}`);
      process.exit(1);
    }
    const parsed: unknown = JSON.parse(fs.readFileSync(inPath, 'utf-8'));
    const flat = isFlatShape(parsed);
    const { subject, rows, report } = flat
      ? convertFlat(parsed, path.basename(inPath), takenPaperIds)
      : convert(parsed as SourceFile, path.basename(inPath), takenPaperIds);

    console.log(`\n=== ${path.basename(inPath)} — ${subject} (${flat ? 'flat' : 'nested'} shape) ===`);
    console.log(flat
      ? `  papers ${report.papers}  questions ${report.standalone}  stimuli ${report.groups}`
      : `  papers ${report.papers}  standalone ${report.standalone}  groups ${report.groups}`);
    console.log(`  -> ${report.rowsProduced} question rows`);
    // Flat-shape sources carry extraction per question, not per paper —
    // convertFlat() doesn't summarise it, so there's nothing real to print.
    if (!flat) {
      console.log(`  OCR-derived papers: ${report.ocrPapers}/${report.papers}` +
        (report.ocrPapers === report.papers ? '  <-- ALL of them' : ''));
    }
    console.log(`  distinct raw school values: ${report.distinctSchools}`);
    if (report.notASchoolOrUnknown.length) {
      console.log(`  NOT a school / unknown (${report.notASchoolOrUnknown.length}):`);
      report.notASchoolOrUnknown.forEach((s) => console.log(`     - ${JSON.stringify(s)}`));
    }
    if (report.abbreviationsNeedingExpansion.length) {
      console.log(`  already on UNRESOLVED_SCHOOLS (${report.abbreviationsNeedingExpansion.length}): ` +
        report.abbreviationsNeedingExpansion.join(', '));
    }
    if (report.nonExamExamTypes.length) {
      console.log(`  exam_type values that are not sittings: ${report.nonExamExamTypes.join(', ')}`);
    }

    rows.forEach((r) => sources.push({ text: r.t, id: r.i }));
    all.push(...rows);
  }

  const dest = path.isAbsolute(out) ? out : path.join(process.cwd(), out);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(all), 'utf-8');

  /* Verify positionally, not through an id map. The first version of this
     check built a Map keyed on id and reported 4,508 "changed" bodies — not
     corruption, but every colliding id resolving to whichever row was
     written last. Comparing index-for-index tests what this script actually
     claims (that text survives the hop) without depending on ids being
     unique, which is a separate property checked below. */
  const written: BankQuestion[] = JSON.parse(fs.readFileSync(dest, 'utf-8'));
  let mismatches = 0;
  if (written.length !== sources.length) {
    console.log(`FAILED: wrote ${written.length} rows but held ${sources.length} sources.`);
    process.exit(1);
  }
  for (let i = 0; i < sources.length; i += 1) {
    if (written[i].t !== sources[i].text) mismatches += 1;
  }

  console.log(`\nWrote ${all.length} rows -> ${dest}`);
  console.log(mismatches === 0
    ? 'Byte-exactness verified: every question body round-tripped unchanged.'
    : `FAILED: ${mismatches} bodies changed in the round trip.`);
  if (mismatches) process.exit(1);

  const ids = new Set(all.map((r) => r.i));
  if (ids.size !== all.length) {
    console.log(`WARNING: ${all.length - ids.size} duplicate question ids across files — ` +
      'the importer upserts on id, so duplicates would silently overwrite each other.');
  }
}

main();
