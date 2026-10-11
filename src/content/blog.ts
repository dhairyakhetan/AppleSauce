/**
 * The blog's article set.
 *
 * Every article here is built from BLOG_SUBJECTS, which scripts/generate-blog-
 * stats.ts counts out of the real question bank -- one entry per subject the
 * bank actually covers. That is the whole editorial position: there is no
 * shortage of pages telling a student that a topic is important, and none of
 * them have counted how many marks it actually carried across real Kolkata
 * papers. This has, for however many subjects the bank holds real data for.
 *
 * Per-subject article shape is NOT uniform, because the underlying data
 * isn't: a subject only gets a topic ranking and per-topic pages when its
 * bank actually carries usable topic-level data (Mathematics, History &
 * Civics, English today). Economics carries exam-structure data (marks,
 * exam types) but no topic field at all, so it gets the "how schools set
 * their papers" article and nothing pretending to rank topics that were
 * never counted. See generate-blog-stats.ts for exactly what each subject's
 * bank does and doesn't carry.
 *
 * Mathematics' three slugs are UNCHANGED from before this file went multi-
 * subject -- they are live, indexed URLs, and changing them would break
 * every existing link and search result pointed at them. New subjects mint
 * their own distinct slug shapes rather than reusing that one.
 *
 * House style (CLAUDE.md): no em or en dashes anywhere in reader-facing copy.
 */
import { BLOG_SUBJECTS, SUBJECT_NAMES, type SubjectStats, type TopicStat } from './blog-stats';

export interface BlogArticle {
  slug: string;
  /** <h1> and card title. */
  title: string;
  /** Meta description and card standfirst. Aim under 160 characters. */
  description: string;
  /** Small routing label above the title. */
  eyebrow: string;
  /** Footer and other cramped link lists. */
  shortTitle: string;
  /** Ordering within the subject. Lower sorts first. */
  order: number;
  /** Which subject's stats this article reads. */
  subject: string;
  /** Which of the three templates BlogPost.tsx renders. */
  kind: 'ranking' | 'structure' | 'topic';
  /** The topic this article is about, if kind is 'topic'. */
  topic?: TopicStat;
  /** Reading estimate, in minutes, from the rendered section count. */
  minutes: number;
}

const nf = new Intl.NumberFormat('en-IN');
export const fmt = (n: number) => nf.format(n);

/** Percent of a subject's papers a topic appeared in, as a whole number. */
export function paperCoverage(subject: string, t: TopicStat): number {
  const total = BLOG_SUBJECTS[subject]?.totals.papers ?? 0;
  return total ? Math.round((t.papers / total) * 100) : 0;
}

/** A topic's share of every mark counted for its subject. */
export function markShare(subject: string, t: TopicStat): number {
  const total = BLOG_SUBJECTS[subject]?.totals.marks ?? 0;
  return total ? Math.round((t.marks / total) * 1000) / 10 : 0;
}

/** The mark value a topic is most often set at, and how often. */
export function commonestMarkValue(t: TopicStat): { value: number; count: number } | null {
  if (!t.markValues.length) return null;
  return t.markValues.reduce((best, m) => (m.count > best.count ? m : best));
}

export function scopeLabel(subject: string): string {
  const s = BLOG_SUBJECTS[subject]?.scope;
  if (!s) return subject;
  // "Maths" everywhere in reader-facing copy, same as before this file went
  // multi-subject, even though the stored/keyed value is "Mathematics".
  const displaySubject = subject === 'Mathematics' ? 'Maths' : s.subject;
  return s.classLevel ? `${s.board} Class ${s.classLevel} ${displaySubject}` : `${s.board} ${displaySubject}`;
}

/* Mathematics keeps its exact original slugs (see file header). Every other
   subject mints `-in-<subject-slug>-papers`. */
function subjectSlug(subject: string): string {
  return subject
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/* Mathematics' copy is reproduced byte-for-byte from this file's own
   pre-multi-subject version (git history has the original) rather than run
   through the generic template below: `/blog/which-chapters-carry-the-marks`
   and its sibling pages are live, indexed URLs, and this page's own TITLE
   and body copy are part of what search results and existing links show,
   not just its slug. A generic re-derivation changed "ICSE Class 10 Maths"
   to "ICSE Class 10 Mathematics" and "chapters" to "topics" the first time
   this was tried — same page, quietly different copy, exactly the kind of
   change that looks harmless in a diff and isn't once a page is indexed. */
function mathematicsArticles(stats: SubjectStats): BlogArticle[] {
  const scopeLabelMaths = `${stats.scope.board} Class ${stats.scope.classLevel} Maths`;
  const out: BlogArticle[] = [
    {
      slug: 'which-chapters-carry-the-marks',
      title: `Which ${scopeLabelMaths} chapters actually carry the marks`,
      description:
        `Every chapter in the ${scopeLabelMaths} syllabus, ranked by the marks it really carried ` +
        `across ${fmt(stats.totals.papers)} papers from ${fmt(stats.totals.schools)} schools.`,
      eyebrow: 'Counted from real papers',
      shortTitle: 'Which chapters carry the marks',
      order: 0,
      subject: 'Mathematics',
      kind: 'ranking',
      minutes: 6,
    },
    {
      slug: 'how-kolkata-schools-set-their-papers',
      title: 'How schools actually set their Class 10 Maths papers',
      description:
        `What ${fmt(stats.totals.questions)} questions from ${fmt(stats.totals.schools)} schools show ` +
        `about paper types, mark weights and how much of the syllabus a prelim really covers.`,
      eyebrow: 'Counted from real papers',
      shortTitle: 'How schools set their papers',
      order: 1,
      subject: 'Mathematics',
      kind: 'structure',
      minutes: 5,
    },
  ];

  stats.topics.forEach((chapter, i) => {
    out.push({
      slug: `${chapter.slug}-in-icse-class-10-maths-papers`,
      title: `${chapter.name} in ${scopeLabelMaths} papers`,
      description:
        `${chapter.name} carried ${fmt(chapter.marks)} marks across ${fmt(chapter.papers)} of ` +
        `${fmt(stats.totals.papers)} papers. What that looks like question by question.`,
      eyebrow: chapter.name,
      shortTitle: chapter.name,
      order: 10 + i,
      subject: 'Mathematics',
      kind: 'topic',
      topic: chapter,
      minutes: 4,
    });
  });

  return out;
}

function articlesFor(subject: string, stats: SubjectStats): BlogArticle[] {
  if (subject === 'Mathematics') return mathematicsArticles(stats);

  const label = scopeLabel(subject);
  const hasTopics = stats.topics.length > 0;
  const out: BlogArticle[] = [];

  if (hasTopics) {
    out.push({
      slug: `which-topics-carry-the-marks-in-${subjectSlug(subject)}-papers`,
      title: `Which ${label} topics actually carry the marks`,
      description:
        `Every topic that came up in the ${label} bank, ranked by the marks it really carried ` +
        `across ${fmt(stats.totals.papers)} papers from ${fmt(stats.totals.schools)} schools.`,
      eyebrow: 'Counted from real papers',
      shortTitle: 'Which topics carry the marks',
      order: 0,
      subject,
      kind: 'ranking',
      minutes: 6,
    });
  }

  out.push({
    slug: `how-kolkata-schools-set-their-${subjectSlug(subject)}-papers`,
    title: `How schools actually set their ${label} papers`,
    description:
      `What ${fmt(stats.totals.questions)} questions from ${fmt(stats.totals.schools)} schools show ` +
      `about paper types and how questions are weighted.`,
    eyebrow: 'Counted from real papers',
    shortTitle: 'How schools set their papers',
    order: 1,
    subject,
    kind: 'structure',
    minutes: 5,
  });

  stats.topics.forEach((topic, i) => {
    out.push({
      slug: `${topic.slug}-in-${subjectSlug(subject)}-papers`,
      title: `${topic.name} in ${label} papers`,
      description:
        `${topic.name} carried ${fmt(topic.marks)} marks across ${fmt(topic.papers)} of ` +
        `${fmt(stats.totals.papers)} papers. What that looks like question by question.`,
      eyebrow: topic.name,
      shortTitle: topic.name,
      order: 10 + i,
      subject,
      kind: 'topic',
      topic,
      minutes: 4,
    });
  });

  return out;
}

export const BLOG_ARTICLES: BlogArticle[] = SUBJECT_NAMES.flatMap((subject) =>
  articlesFor(subject, BLOG_SUBJECTS[subject]),
);

export const ARTICLE_BY_SLUG: Record<string, BlogArticle> = Object.fromEntries(
  BLOG_ARTICLES.map((a) => [a.slug, a]),
);

/** Every subject with at least one article, in the bank's own generation
    order (Mathematics first, since it's SUBJECT_NAMES' first entry -- the
    original, largest, most complete bank). */
export const BLOG_SUBJECT_NAMES = SUBJECT_NAMES;

export const BLOG_PATH = '/blog';

export { BLOG_SUBJECTS };
export type { SubjectStats, TopicStat };
