import { Link, Navigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight } from 'lucide-react';

import { SEOHead } from '@/components/SEOHead';
import { BentoStack, BentoPanel, PageContainer } from '@/components/layout/PageContainer';
import { useChromeConfig } from '@/components/layout/AppShell';
import { PAST_PAPERS_PATH, BROWSE_PATH } from '@/lib/nav-config';
import { FREE_PREVIEW_WORD } from '@/lib/free-preview';
import {
  ARTICLE_BY_SLUG,
  BLOG_ARTICLES,
  BLOG_PATH,
  BLOG_SUBJECTS,
  commonestMarkValue,
  fmt,
  markShare,
  paperCoverage,
  scopeLabel,
  type BlogArticle,
} from '@/content/blog';

/* ---------------------------------------------------------------------------
   Shared pieces
--------------------------------------------------------------------------- */

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex h-[96px] flex-col-reverse justify-center rounded-[18px] bg-muted p-[14px]">
      <dt className="mt-0.5 text-[13px] leading-[1.4] text-warm-label">{label}</dt>
      <dd className="font-display text-[24px] font-black tabular-nums tracking-[-0.04em] text-foreground">
        {value}
      </dd>
    </div>
  );
}

/** A bar row. Width is a share of the largest value, so the eye compares. */
function BarRow({
  label,
  value,
  max,
  suffix,
  href,
}: {
  label: string;
  value: number;
  max: number;
  suffix: string;
  href?: string;
}) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  const inner = (
    <>
      <span className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate font-semibold text-foreground">{label}</span>
        <span className="flex-none text-meta font-bold tabular-nums text-warm-label">
          {fmt(value)} {suffix}
        </span>
      </span>
      <span aria-hidden className="mt-1.5 block h-2 rounded-full bg-brand-subtle">
        <span className="block h-2 rounded-full bg-brand" style={{ width: `${pct}%` }} />
      </span>
    </>
  );

  return (
    <li>
      {href ? (
        <Link
          to={href}
          className="-mx-2 block rounded-lg px-2 py-2 transition-colors duration-hover hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {inner}
        </Link>
      ) : (
        <span className="-mx-2 block px-2 py-2">{inner}</span>
      )}
    </li>
  );
}

function MethodNote({ subject }: { subject: string }) {
  const t = BLOG_SUBJECTS[subject]?.totals;
  if (!t) return null;
  return (
    <p className="mt-8 border-t border-border pt-4 text-meta leading-[1.6] text-warm-label">
      Counted from {fmt(t.questions)} questions in {fmt(t.papers)} {scopeLabel(subject)} papers set by{' '}
      {fmt(t.schools)} schools{t.firstYear && t.lastYear ? ` between ${t.firstYear} and ${t.lastYear}` : ''}.
      Topic labels are the ones carried in the paper bank. Papers are the property of the schools that set them.
    </p>
  );
}

/* ---------------------------------------------------------------------------
   The two per-subject overview articles
--------------------------------------------------------------------------- */

function TopicsByMarks({ subject }: { subject: string }) {
  const stats = BLOG_SUBJECTS[subject];
  const topics = stats?.topics ?? [];
  const totals = stats?.totals;
  const max = topics[0]?.marks ?? 0;
  const top = topics[0];
  const topFive = topics.slice(0, 5);
  const topFiveShare = totals?.marks
    ? Math.round((topFive.reduce((n, c) => n + c.marks, 0) / totals.marks) * 100)
    : 0;
  /* Compared against, not asserted over: the comparison below is derived
     from both numbers rather than stated as if it were obviously true. */
  const topFiveTopicShare = totals?.topics ? Math.round((topFive.length / totals.topics) * 100) : 0;

  if (!totals || !top) return null;

  return (
    <>
      <p className="text-lede text-warm-prose">
        Every revision guide ranks topics by opinion. This one ranks them by the marks they actually
        carried in {fmt(totals.papers)} papers.
      </p>

      <dl className="mt-6 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Stat value={fmt(totals.marks)} label="marks counted" />
        <Stat value={fmt(totals.topics)} label="topics" />
        <Stat value={`${topFiveShare}%`} label="carried by the top five" />
        <Stat value={fmt(totals.papers)} label="papers read" />
      </dl>

      <h2 className="mt-10 font-display text-section-head font-extrabold tracking-[-0.03em] text-foreground">
        All {totals.topics} topics, by marks carried
      </h2>
      <ul className="mt-4 space-y-1">
        {topics.map((t) => {
          const topicArticle = BLOG_ARTICLES.find((a) => a.subject === subject && a.topic?.slug === t.slug);
          return (
            <BarRow
              key={t.slug}
              label={t.name}
              value={t.marks}
              max={max}
              suffix="marks"
              href={topicArticle ? `${BLOG_PATH}/${topicArticle.slug}` : undefined}
            />
          );
        })}
      </ul>

      <h2 className="mt-10 font-display text-section-head font-extrabold tracking-[-0.03em] text-foreground">
        What the ranking shows
      </h2>
      <p className="mt-3 max-w-prose text-body-secondary text-warm-prose">
        {top.name} carried more marks than any other topic, {fmt(top.marks)} of {fmt(totals.marks)},
        which is {markShare(subject, top)}% of every mark in the bank. The five heaviest topics
        carried {topFiveShare}% of the marks between them, which is{' '}
        {topFiveShare > topFiveTopicShare ? 'more' : 'less'} than their {topFiveTopicShare}% share of
        the topics: five of {totals.topics}.
      </p>
      <p className="mt-3 max-w-prose text-body-secondary text-warm-prose">
        Weight is not the same as reliability. A topic can carry a large total simply by appearing in
        most papers at a small size, so each topic page below also gives the share of papers it
        appeared in and the mark value it was most often set at.
      </p>

      <MethodNote subject={subject} />
    </>
  );
}

function HowSchoolsSetPapers({ subject }: { subject: string }) {
  const stats = BLOG_SUBJECTS[subject];
  const totals = stats?.totals;
  const topics = stats?.topics ?? [];
  if (!totals) return null;

  /* Exam types/mark values are recorded per topic, so summing across topics
     gives the bank's real distribution -- but Economics carries no topics at
     all, so this also needs a topic-less path: same numbers, read straight
     off every row instead of aggregated from a list that's empty for it. */
  const byExam = new Map<string, number>();
  const byMark = new Map<number, number>();
  let totalLong = 0;
  let totalShort = 0;
  for (const t of topics) {
    for (const e of t.examTypes) byExam.set(e.label, (byExam.get(e.label) ?? 0) + e.count);
    for (const m of t.markValues) byMark.set(m.value, (byMark.get(m.value) ?? 0) + m.count);
    totalLong += t.longQuestions;
    totalShort += t.shortQuestions;
  }
  const exams = [...byExam.entries()].sort((a, b) => b[1] - a[1]);
  const examMax = exams[0]?.[1] ?? 0;
  const marks = [...byMark.entries()].sort((a, b) => a[0] - b[0]);
  const markMax = Math.max(...marks.map(([, n]) => n), 0);
  const longShare = totalLong + totalShort > 0 ? Math.round((totalLong / (totalLong + totalShort)) * 100) : 0;

  return (
    <>
      <p className="text-lede text-warm-prose">
        {fmt(totals.schools)} schools, {fmt(totals.papers)} papers, and a fairly consistent
        shape underneath them.
      </p>

      {exams.length > 0 && (
        <>
          <h2 className="mt-10 font-display text-section-head font-extrabold tracking-[-0.03em] text-foreground">
            What kind of paper these are
          </h2>
          <ul className="mt-4 space-y-1">
            {exams.map(([label, n]) => (
              <BarRow key={label} label={label} value={n} max={examMax} suffix="questions" />
            ))}
          </ul>
          <p className="mt-4 max-w-prose text-body-secondary text-warm-prose">
            Prelims and board papers dominate the bank, which matters when you use it: a prelim is a
            school setting its own paper in the board's shape, so it tells you what your school tends
            to ask as much as what the board does.
          </p>
        </>
      )}

      {marks.length > 0 && (
        <>
          <h2 className="mt-10 font-display text-section-head font-extrabold tracking-[-0.03em] text-foreground">
            How questions are weighted
          </h2>
          <ul className="mt-4 space-y-1">
            {marks.map(([value, n]) => (
              <BarRow key={value} label={`${value} mark${value === 1 ? '' : 's'}`} value={n} max={markMax} suffix="questions" />
            ))}
          </ul>
          {(totalLong > 0 || totalShort > 0) && (
            <p className="mt-4 max-w-prose text-body-secondary text-warm-prose">
              Of the questions the bank labels by length, {longShare}% are long-form. The rest are
              short, which is where most of the paper's volume sits even when the marks are elsewhere.
            </p>
          )}
        </>
      )}

      <MethodNote subject={subject} />
    </>
  );
}

/* ---------------------------------------------------------------------------
   A topic article
--------------------------------------------------------------------------- */

function TopicArticle({ article }: { article: BlogArticle }) {
  const t = article.topic!;
  const subject = article.subject;
  const topics = BLOG_SUBJECTS[subject]?.topics ?? [];
  const totals = BLOG_SUBJECTS[subject]?.totals;
  const rank = topics.findIndex((x) => x.slug === t.slug) + 1;
  const common = commonestMarkValue(t);
  const markMax = Math.max(...t.markValues.map((m) => m.count), t.unspecifiedMarks, 0);
  const examMax = Math.max(...t.examTypes.map((e) => e.count), 0);

  if (!totals) return null;

  return (
    <>
      <p className="text-lede text-warm-prose">
        {t.name} carried {fmt(t.marks)} marks across the bank, which ranks it {rank} of{' '}
        {totals.topics} topics and is {markShare(subject, t)}% of every mark counted.
      </p>

      <dl className="mt-6 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Stat value={fmt(t.marks)} label="marks carried" />
        <Stat value={fmt(t.questions)} label="questions set" />
        <Stat value={`${paperCoverage(subject, t)}%`} label="of papers" />
        <Stat value={String(t.averageMarks)} label="marks per question" />
      </dl>

      <h2 className="mt-10 font-display text-section-head font-extrabold tracking-[-0.03em] text-foreground">
        How often it comes up
      </h2>
      <p className="mt-3 max-w-prose text-body-secondary text-warm-prose">
        It appeared in {fmt(t.papers)} of {fmt(totals.papers)} papers, set by {fmt(t.schools)}{' '}
        different schools{t.firstYear && t.lastYear ? `, in papers dated ${t.firstYear} to ${t.lastYear}` : ''}.{' '}
        {paperCoverage(subject, t) >= 75
          ? 'At that rate it is close to a certainty rather than a topic to gamble on.'
          : paperCoverage(subject, t) >= 40
            ? 'That is frequent enough to prepare for, and infrequent enough that a single paper may skip it.'
            : 'That is infrequent, so a given paper may well not set it at all.'}
      </p>

      {(t.markValues.length > 0 || t.unspecifiedMarks > 0) && (
        <>
          <h2 className="mt-10 font-display text-section-head font-extrabold tracking-[-0.03em] text-foreground">
            What it is usually worth
          </h2>
          <ul className="mt-4 space-y-1">
            {t.markValues.map((m) => (
              <BarRow key={m.value} label={`${m.value} mark${m.value === 1 ? '' : 's'}`} value={m.count} max={markMax} suffix="questions" />
            ))}
            {t.unspecifiedMarks > 0 && (
              <BarRow
                key="unspecified"
                label="mark not recorded in the bank"
                value={t.unspecifiedMarks}
                max={markMax}
                suffix="questions"
              />
            )}
          </ul>
          {common && (
            <p className="mt-4 max-w-prose text-body-secondary text-warm-prose">
              Most often it is set as a {common.value}-mark question, {fmt(common.count)} of the{' '}
              {fmt(t.questions)} counted here.
            </p>
          )}
        </>
      )}

      {t.examTypes.length > 0 && (
        <>
          <h2 className="mt-10 font-display text-section-head font-extrabold tracking-[-0.03em] text-foreground">
            Which papers set it
          </h2>
          <ul className="mt-4 space-y-1">
            {t.examTypes.map((e) => (
              <BarRow key={e.label} label={e.label} value={e.count} max={examMax} suffix="questions" />
            ))}
          </ul>
        </>
      )}

      <div className="mt-8 rounded-2xl bg-brand-blue-subtle p-6">
        <h2 className="font-display text-card-title-lg font-extrabold text-brand-blue-deep">
          Read the questions themselves
        </h2>
        <p className="mt-2 max-w-prose text-body-secondary text-brand-blue-deep/90">
          The counting above comes from papers you can open. The first {FREE_PREVIEW_WORD} questions of any paper
          need no account.
        </p>
        <Link
          to={PAST_PAPERS_PATH}
          className="mt-4 inline-flex h-11 items-center gap-2 rounded-full bg-brand-blue px-5 text-[15px] font-extrabold text-white transition-transform duration-tap hover:-translate-y-0.5 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue focus-visible:ring-offset-2"
        >
          Browse the papers
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>

      <MethodNote subject={subject} />
    </>
  );
}

/* ---------------------------------------------------------------------------
   The route
--------------------------------------------------------------------------- */

export default function BlogPost() {
  const { slug } = useParams<{ slug: string }>();
  const article = slug ? ARTICLE_BY_SLUG[slug] : undefined;

  /* A missing slug redirects to the index rather than rendering a 404 body,
     because every link into this route comes from a generated list: a slug
     that misses means the article set changed, and the index is the honest
     next step for a reader following an old link. */
  // Same reasoning as Blog.tsx: B3 is a shared, deliberately unrounded
  // full-bleed fill (also used by /past-papers) that breaks this page's own
  // all-bento rounded content right before the footer. No pre-footer here.
  useChromeConfig(article ? { preFooter: 'none' } : null);

  if (!article) return <Navigate to={BLOG_PATH} replace />;

  const subjectArticles = BLOG_ARTICLES.filter((a) => a.subject === article.subject);
  const i = subjectArticles.findIndex((a) => a.slug === article.slug);
  const next = subjectArticles[i + 1];

  return (
    <>
      <SEOHead
        title={`${article.title} | Shikshaq`}
        description={article.description}
        canonical={`${BLOG_PATH}/${article.slug}`}
        ogType="article"
        schema={{
          '@context': 'https://schema.org',
          '@type': 'Article',
          headline: article.title,
          description: article.description,
          about: article.topic ? article.topic.name : scopeLabel(article.subject),
          isAccessibleForFree: true,
          publisher: { '@type': 'Organization', name: 'Shikshaq' },
          mainEntityOfPage: {
            '@type': 'WebPage',
            '@id': `https://shikshaq.in${BLOG_PATH}/${article.slug}`,
          },
        }}
      />

      <BentoStack>
        <BentoPanel fill="card" edge="top">
          <PageContainer className="px-0">
            <Link
              to={BLOG_PATH}
              className="-m-1 mb-3 flex h-11 w-fit items-center gap-1.5 p-1 text-[13px] font-semibold text-warm-label transition-colors duration-tap hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ArrowLeft className="h-4 w-4" strokeWidth={2.25} aria-hidden />
              All reading
            </Link>

            <span className="text-label uppercase text-brand-deep">{article.eyebrow}</span>
            <h1 className="mt-2 max-w-[20ch] font-display text-display-hero font-black leading-[0.95] tracking-[-0.04em] text-foreground">
              {article.title}
            </h1>
            <p className="mt-3 text-meta tabular-nums text-warm-label">{article.minutes} min read</p>
          </PageContainer>
        </BentoPanel>

        <BentoPanel fill="card">
          <PageContainer className="px-0">
            {article.kind === 'topic' ? (
              <TopicArticle article={article} />
            ) : article.kind === 'ranking' ? (
              <TopicsByMarks subject={article.subject} />
            ) : (
              <HowSchoolsSetPapers subject={article.subject} />
            )}

            {next && (
              <Link
                to={`${BLOG_PATH}/${next.slug}`}
                className="group mt-10 flex items-center justify-between gap-4 rounded-2xl bg-muted p-5 transition-transform duration-hover hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-[0.99]"
              >
                <span className="min-w-0">
                  <span className="block text-label uppercase text-warm-label">Next</span>
                  <span className="mt-1 block truncate font-bold text-foreground">{next.title}</span>
                </span>
                <ArrowRight className="h-5 w-5 flex-none text-warm-label transition-transform duration-hover group-hover:translate-x-0.5" aria-hidden />
              </Link>
            )}

            <p className="mt-6 text-body-secondary text-warm-prose">
              Looking for a teacher instead?{' '}
              <Link to={BROWSE_PATH} className="font-semibold text-brand-blue underline underline-offset-4">
                Every verified tutor in Kolkata
              </Link>{' '}
              is free to search and free to contact.
            </p>
          </PageContainer>
        </BentoPanel>
      </BentoStack>
    </>
  );
}
