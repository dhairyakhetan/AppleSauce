import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

import { SEOHead } from '@/components/SEOHead';
import { ROUTE_META, blogDescription } from '@/content/route-meta';
import { BentoStack, BentoPanel, PageContainer } from '@/components/layout/PageContainer';
import { useChromeConfig } from '@/components/layout/AppShell';
import {
  BLOG_ARTICLES,
  BLOG_PATH,
  BLOG_SUBJECT_NAMES,
  BLOG_SUBJECTS,
  fmt,
  paperCoverage,
  scopeLabel,
  type BlogArticle,
} from '@/content/blog';

/**
 * The reading index.
 *
 * Grouped by subject, one section per subject the bank actually covers.
 * Two things it deliberately does not do. It does not claim a posting
 * cadence, because these are not posts and nothing is scheduled. And it does
 * not paginate, because each subject's list is short enough to read in full
 * and a second page would only bury the topic list that is the actual reason
 * to be here.
 */

function SubjectSection({ subject, lead, others, topics }: {
  subject: string;
  lead: BlogArticle;
  others: BlogArticle[];
  topics: BlogArticle[];
}) {
  const totals = BLOG_SUBJECTS[subject]?.totals;
  return (
    <div className="mt-12 first:mt-0">
      <h2 className="font-display text-section-head font-extrabold tracking-[-0.03em] text-foreground">
        {scopeLabel(subject)}
      </h2>
      {totals && (
        <p className="mt-1.5 text-body-secondary text-warm-prose">
          {fmt(totals.papers)} papers, {fmt(totals.questions)} questions, {fmt(totals.schools)} schools.
        </p>
      )}

      <Link
        to={`${BLOG_PATH}/${lead.slug}`}
        className="group mt-4 block rounded-2xl bg-brand-subtle p-6 transition-transform duration-hover hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 active:scale-[0.99] sm:p-8"
      >
        <span className="text-label uppercase text-brand-deep">{lead.eyebrow}</span>
        <h3 className="mt-2 max-w-[24ch] font-display text-card-title-lg font-extrabold leading-[1.05] tracking-[-0.03em] text-brand-deep">
          {lead.title}
        </h3>
        <p className="mt-3 max-w-prose text-body-secondary text-brand-deep/90">{lead.description}</p>
        <span className="mt-4 inline-flex items-center gap-1.5 text-[14px] font-bold text-brand-deep">
          Read it
          <ArrowRight className="h-4 w-4 transition-transform duration-hover group-hover:translate-x-0.5" aria-hidden />
        </span>
      </Link>

      {others.length > 0 && (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {others.map((a) => (
            <li key={a.slug}>
              <Link
                to={`${BLOG_PATH}/${a.slug}`}
                className="group flex h-full flex-col rounded-2xl bg-muted p-5 transition-transform duration-hover hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-[0.98]"
              >
                <span className="text-label uppercase text-warm-label">{a.eyebrow}</span>
                <span className="mt-1.5 block font-bold leading-[1.25] text-foreground">{a.title}</span>
                <span className="mt-2 block text-body-secondary text-warm-prose">{a.description}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {topics.length > 0 && (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {topics.map((a) => (
            <li key={a.slug}>
              <Link
                to={`${BLOG_PATH}/${a.slug}`}
                className="flex h-full flex-col rounded-2xl bg-muted p-5 transition-transform duration-hover hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-[0.98]"
              >
                <span className="text-label uppercase text-warm-label">{a.eyebrow}</span>
                <span className="mt-1.5 block font-bold leading-[1.25] text-foreground">{a.shortTitle}</span>
                {a.topic && (
                  <span className="mt-auto flex flex-wrap gap-x-3 gap-y-1 pt-4 text-meta tabular-nums text-warm-label">
                    <span>{fmt(a.topic.marks)} marks</span>
                    <span>{paperCoverage(subject, a.topic)}% of papers</span>
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function Blog() {
  /* Handoff (this session): B3 ("How the paper library works") is a shared
     pre-footer also used by /past-papers, and it's deliberately a full-
     bleed, unrounded fill (PreFooter.tsx's own comment: "B2 and B3 are
     fills and must reach the viewport edges") — the opposite of this page's
     own all-bento, rounded-edge-to-edge content. Rather than restyle a
     component /past-papers also relies on, this page just doesn't use a
     pre-footer: its own last BentoPanel already ends the page correctly
     rounded, straight into Footer. */
  useChromeConfig({ preFooter: 'none' });

  const bySubject = BLOG_SUBJECT_NAMES.map((subject) => {
    const articles = BLOG_ARTICLES.filter((a) => a.subject === subject).sort((a, b) => a.order - b.order);
    const overview = articles.filter((a) => a.kind !== 'topic');
    const topics = articles.filter((a) => a.kind === 'topic');
    const [lead, ...others] = overview;
    return { subject, lead, others, topics };
  }).filter((s) => s.lead);

  const allTotals = BLOG_SUBJECT_NAMES.reduce(
    (acc, s) => {
      const t = BLOG_SUBJECTS[s]?.totals;
      if (!t) return acc;
      return { papers: acc.papers + t.papers, questions: acc.questions + t.questions };
    },
    { papers: 0, questions: 0 },
  );

  return (
    <>
      <SEOHead
        title={ROUTE_META.blog.title}
        description={blogDescription(allTotals.questions, allTotals.papers)}
        canonical={BLOG_PATH}
      />

      <BentoStack>
        <BentoPanel fill="papers" edge="top">
          <PageContainer className="px-0">
            <span className="text-label uppercase text-white/75">Reading</span>
            <h1 className="mt-2 max-w-[18ch] font-display text-display-hero font-black leading-[0.95] tracking-[-0.04em] text-white">
              The papers, counted.
            </h1>
            <p className="mt-4 max-w-[52ch] text-lede text-white/90">
              Every number on these pages was counted from real papers, across{' '}
              {BLOG_SUBJECT_NAMES.length} subjects. Nothing here is estimated.
            </p>

            <dl className="mt-6 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {[
                { value: fmt(allTotals.papers), label: 'papers read' },
                { value: fmt(allTotals.questions), label: 'questions counted' },
                { value: String(BLOG_SUBJECT_NAMES.length), label: 'subjects covered' },
                { value: fmt(BLOG_ARTICLES.length), label: 'pages of it' },
              ].map((s) => (
                <div
                  key={s.label}
                  className="flex h-[92px] flex-col-reverse justify-center rounded-[18px] bg-white/10 p-[14px]"
                >
                  <dt className="mt-0.5 text-[13px] leading-[1.4] text-white/75">{s.label}</dt>
                  <dd className="font-display text-[24px] font-black tabular-nums tracking-[-0.04em] text-white">
                    {s.value}
                  </dd>
                </div>
              ))}
            </dl>
          </PageContainer>
        </BentoPanel>

        <BentoPanel fill="card">
          <PageContainer className="px-0">
            {bySubject.map((s) => (
              <SubjectSection key={s.subject} {...s} />
            ))}
          </PageContainer>
        </BentoPanel>
      </BentoStack>
    </>
  );
}
