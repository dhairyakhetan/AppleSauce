/**
 * Derives the blog's per-subject statistics from the question bank.
 *
 * The blog's whole claim is that its numbers are counted, not asserted: "GST
 * and Banking carried 1,119 marks across 193 papers" is worth reading because
 * nobody else has counted it, and it is worth trusting because this script is
 * the only thing that produces it. Nothing in src/content/blog-stats.ts is
 * typed by hand.
 *
 *   npm run generate-blog-stats
 *
 * Reads every local bank file (the original Maths source of record, plus
 * whatever subject-bank conversions exist alongside it) and writes one
 * generated TS module, grouped by subject. Question TEXT is never read here
 * -- only the metadata fields -- so the "question-paper text is never
 * altered" rule cannot be violated by this path.
 *
 * Topic coverage differs genuinely by subject, and this does not paper over
 * that: Maths carries a small, complete curriculum taxonomy in every row's
 * `c` field. History & Civics carries one too, but with a long tail of
 * single-question labels (some of them literal extraction artifacts, e.g.
 * "Correction: ..." notes that leaked into the field) that would make a
 * "topics ranked by marks" page read as noise rather than a syllabus
 * breakdown -- MIN_TOPIC_QUESTIONS filters those out. English's `c` field
 * holds real content areas (Drama, Poetry, Grammar, Composition) mixed with
 * uninformative bare exam-section letters ("A", "Section B") -- those are
 * filtered separately. Economics carries no topic field at all: rather than
 * inventing one, its TOPIC_STATS is simply empty, and the article generator
 * (src/content/blog.ts) treats an empty topic list as "overview articles
 * only" for that subject, not as a bug to work around.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chapterNameNoDashes } from './chapter-name';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUTPUT = path.join(ROOT, 'src', 'content', 'blog-stats.ts');

/* Each source file, and how to reach it. The original Maths file predates
   the `subj` field (bank-source.ts's own comment: "absent on the original
   maths bank"), so it is the one case DEFAULT_SUBJECT is used instead of
   trusting the row. */
const SOURCES: { file: string; defaultSubject?: string }[] = [
  { file: 'question-bank.json', defaultSubject: 'Mathematics' },
  { file: 'question-bank-subjects.json' }, // History & Civics + Economics
  { file: 'question-bank-subjects-english.json' },
];

/** Only the metadata fields. `t` (question text) is deliberately not read. */
interface BankQuestion {
  p?: string;
  m?: number | null;
  c?: string | null;
  s?: string | null;
  y?: string | null;
  e?: string | null;
  k?: string | null;
  ty?: string | null;
  subj?: string;
}

/* Board/class metadata isn't carried per subject the way BANK_SCOPE assumed
   for Maths-only -- these are what each subject's bank actually is, stated
   so no page can imply wider coverage than it has. */
const SUBJECT_SCOPE: Record<string, { board: string; classLevel: string }> = {
  Mathematics: { board: 'ICSE', classLevel: '10' },
  'History & Civics': { board: 'ICSE/CBSE', classLevel: 'IV-XII' },
  Economics: { board: 'ICSE/ISC', classLevel: 'IX-XII' },
  English: { board: 'ICSE/ISC/CBSE', classLevel: 'IV-XII' },
};

/* A topic list is only worth publishing once it clears this many questions
   -- below it, a single-appearance label is as likely to be extraction noise
   (a stray "Correction: ..." note, an OCR-split duplicate) as a real,
   rarely-set topic, and this blog's whole premise is not asserting things
   it has not actually counted cleanly. Chosen per subject: Maths' bank is
   small and its `c` values are already a clean, complete taxonomy (every
   value earns its place), so it gets no floor at all; the others get one
   large enough to visibly cut the long tail (confirmed against History's
   787 raw values: this drops it to a few dozen while keeping every topic
   that carried real weight in the bank). */
const MIN_TOPIC_QUESTIONS: Record<string, number> = {
  Mathematics: 0,
  'History & Civics': 15,
  Economics: 15,
  English: 15,
};

/* English's `c` field mixes real content areas ("Drama", "Poetry", "Grammar")
   with bare exam-section labels that carry no information on their own. */
const ENGLISH_SECTION_LETTER = /^(section\s*)?[a-d]\.?$/i;

const YEAR_RE = /^\d{4}(-\d{2})?$/;
const isYear = (v: string | null | undefined): v is string => !!v && YEAR_RE.test(v);

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function loadRows(): BankQuestion[] {
  const all: BankQuestion[] = [];
  for (const { file, defaultSubject } of SOURCES) {
    const p = path.join(ROOT, 'data', file);
    if (!fs.existsSync(p)) continue;
    const rows: BankQuestion[] = JSON.parse(fs.readFileSync(p, 'utf-8'));
    for (const r of rows) all.push({ ...r, subj: r.subj ?? defaultSubject });
  }
  return all;
}

function main() {
  const rows = loadRows();
  if (!rows.length) {
    console.error('\n[blog-stats] No bank files found under data/ -- nothing written.');
    process.exit(1);
  }

  const bySubject = new Map<string, BankQuestion[]>();
  for (const r of rows) {
    const subj = r.subj ?? 'Mathematics';
    if (!bySubject.has(subj)) bySubject.set(subj, []);
    bySubject.get(subj)!.push(r);
  }

  const subjects: Record<string, unknown> = {};

  for (const [subject, subjRows] of bySubject) {
    const byTopic = new Map<
      string,
      {
        questions: number;
        marks: number;
        papers: Set<string>;
        schools: Set<string>;
        years: Set<string>;
        examTypes: Map<string, number>;
        markValues: Map<number, number>;
        unspecifiedMarks: number;
        long: number;
        short: number;
        nameVariants: Map<string, number>;
      }
    >();

    const allPapers = new Set<string>();
    const allSchools = new Set<string>();
    const allYears = new Set<string>();
    let totalMarks = 0;

    const minTopicQuestions = MIN_TOPIC_QUESTIONS[subject] ?? 15;

    for (const q of subjRows) {
      if (q.p) allPapers.add(q.p);
      if (q.s) allSchools.add(q.s);
      if (isYear(q.y)) allYears.add(q.y);
      totalMarks += q.m ?? 0;

      const rawTopic = q.c;
      if (!rawTopic) continue;
      if (subject === 'English' && ENGLISH_SECTION_LETTER.test(rawTopic.trim())) continue;

      /* Grouped by a case/spacing-normalised key, not the raw string: this
         source spells the same topic multiple ways ("Prose" / "PROSE",
         "Prose - Short Stories" / "Prose-Short Stories"), which slugify()
         collapses to the SAME URL regardless -- so treating them as
         distinct topics here produced two BlogArticle entries claiming the
         same slug (confirmed live: a duplicate-React-key warning on
         /blog/prose-in-english-papers). Grouping first avoids that instead
         of discovering it downstream. */
      const key = rawTopic.trim().toLowerCase().replace(/[\s-]+/g, ' ');

      let e = byTopic.get(key);
      if (!e) {
        e = {
          questions: 0,
          marks: 0,
          papers: new Set(),
          schools: new Set(),
          years: new Set(),
          examTypes: new Map(),
          markValues: new Map(),
          unspecifiedMarks: 0,
          long: 0,
          short: 0,
          nameVariants: new Map(),
        };
        byTopic.set(key, e);
      }
      // The most common raw spelling becomes the display name.
      e.nameVariants.set(rawTopic, (e.nameVariants.get(rawTopic) ?? 0) + 1);

      e.questions += 1;
      e.marks += q.m ?? 0;
      if (q.p) e.papers.add(q.p);
      if (q.s) e.schools.add(q.s);
      if (isYear(q.y)) e.years.add(q.y);
      if (q.e) e.examTypes.set(q.e, (e.examTypes.get(q.e) ?? 0) + 1);
      if (typeof q.m === 'number' && q.m > 0) {
        e.markValues.set(q.m, (e.markValues.get(q.m) ?? 0) + 1);
      } else {
        // No usable mark value recorded for this question -- counted in
        // `questions` but deliberately not folded into any mark bucket, so
        // the "usually worth" breakdown never silently invents a value.
        e.unspecifiedMarks += 1;
      }
      if (q.ty === 'long') e.long += 1;
      else if (q.ty === 'short') e.short += 1;
    }

    const topics = [...byTopic.entries()]
      .filter(([, e]) => e.questions >= minTopicQuestions)
      .map(([, e]) => {
        // The most common raw spelling among this key's variants wins.
        const name = [...e.nameVariants.entries()].sort((a, b) => b[1] - a[1])[0][0];
        // Slug from the ORIGINAL name so existing URLs never move; the
        // displayed name has its dashes removed.
        return { name: chapterNameNoDashes(name), slug: slugify(name), e };
      })
      .map(({ name, slug, e }) => ({
        name,
        slug,
        questions: e.questions,
        marks: e.marks,
        papers: e.papers.size,
        schools: e.schools.size,
        firstYear: [...e.years].sort()[0] ?? null,
        lastYear: [...e.years].sort().slice(-1)[0] ?? null,
        averageMarks: e.questions ? Math.round((e.marks / e.questions) * 10) / 10 : 0,
        longQuestions: e.long,
        shortQuestions: e.short,
        examTypes: [...e.examTypes.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([label, count]) => ({ label, count })),
        markValues: [...e.markValues.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([value, count]) => ({ value, count })),
        unspecifiedMarks: e.unspecifiedMarks,
      }))
      .sort((a, b) => b.marks - a.marks);

    // The "usually worth" breakdown must always reconcile with `questions`:
    // every question is either in a mark bucket or counted as unspecified,
    // never both and never neither.
    for (const t of topics) {
      const sum = t.markValues.reduce((acc, m) => acc + m.count, 0) + t.unspecifiedMarks;
      if (sum !== t.questions) {
        throw new Error(
          `[blog-stats] ${subject} / ${t.name}: markValues (${sum}) does not reconcile with questions (${t.questions})`,
        );
      }
    }

    const years = [...allYears].sort();
    const scope = SUBJECT_SCOPE[subject] ?? { board: 'ICSE', classLevel: '' };

    subjects[subject] = {
      scope: { subject, ...scope },
      totals: {
        questions: subjRows.length,
        marks: totalMarks,
        papers: allPapers.size,
        schools: allSchools.size,
        topics: topics.length,
        firstYear: years[0] ?? null,
        lastYear: years[years.length - 1] ?? null,
      },
      topics,
    };
  }

  const banner = `/* GENERATED by scripts/generate-blog-stats.ts -- do not edit by hand.
 * Run \`npm run generate-blog-stats\` after changing a data/question-bank*.json file.
 *
 * Every number here was counted from the question bank. Nothing is estimated,
 * rounded up for effect, or carried over from a previous version of the file.
 */`;

  const out = `${banner}

export interface TopicStat {
  name: string;
  slug: string;
  questions: number;
  marks: number;
  papers: number;
  schools: number;
  firstYear: string | null;
  lastYear: string | null;
  averageMarks: number;
  longQuestions: number;
  shortQuestions: number;
  examTypes: Array<{ label: string; count: number }>;
  markValues: Array<{ value: number; count: number }>;
  /** Questions with no usable mark value recorded in the bank. Always
      \`questions - sum(markValues[].count)\`, carried explicitly so a reader
      adding up the visible bars gets the same total as the "questions set"
      stat, never less. */
  unspecifiedMarks: number;
}

export interface SubjectScope {
  subject: string;
  board: string;
  classLevel: string;
}

export interface SubjectTotals {
  questions: number;
  marks: number;
  papers: number;
  schools: number;
  topics: number;
  firstYear: string | null;
  lastYear: string | null;
}

export interface SubjectStats {
  scope: SubjectScope;
  totals: SubjectTotals;
  /** Ordered by total marks, heaviest first. Empty when the bank carries no
      topic-level field for this subject (Economics, today) -- an empty
      list, not an invented one. */
  topics: TopicStat[];
}

/** One entry per subject the bank actually covers. */
export const BLOG_SUBJECTS: Record<string, SubjectStats> = ${JSON.stringify(subjects, null, 2)};

export const SUBJECT_NAMES: string[] = ${JSON.stringify([...bySubject.keys()])};
`;

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, out, 'utf-8');

  console.log(`[blog-stats] wrote ${bySubject.size} subjects -> ${path.relative(ROOT, OUTPUT)}`);
  for (const [subject, stats] of Object.entries(subjects) as [string, any][]) {
    console.log(
      `  ${subject}: ${stats.topics.length} topics, ${stats.totals.papers} papers, ` +
        `${stats.totals.questions} questions, ${stats.totals.schools} schools`,
    );
  }
}

main();
