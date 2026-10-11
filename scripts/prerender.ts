/**
 * Build-time HTML for every indexable route.
 *
 * The problem this solves: dist/ contained exactly one HTML file, whose body
 * was `<div id="root"></div>`. Every one of the ~1,857 sitemap URLs served
 * byte-identical markup with the homepage's title and description, and (until
 * a7091ac) a hardcoded homepage canonical. Google's renderer usually gets
 * there eventually; Bing, WhatsApp, Facebook, LinkedIn and most LLM crawlers
 * do not run JavaScript at all, so a shared teacher profile unfurled as the
 * homepage -- on a product whose main distribution channel is WhatsApp.
 *
 * Why this approach rather than SSR or SSG: React still boots with
 * createRoot(), exactly as before. Nothing is hydrated, so there is no
 * hydration mismatch to get wrong, no page needs to be made SSR-safe, and the
 * failure mode of a bug here is "a page has worse meta tags", never "the app
 * does not render". For a pre-launch window that trade is worth more than the
 * fidelity true SSG would add.
 *
 * WHAT IS DELIBERATELY NOT HERE: question body text.
 * Nobody searches for the text of question 3. They search "la martiniere class
 * 10 maths 2023 question paper", which is entirely metadata -- school, board,
 * class, subject, year. So question bodies earn no ranking, and putting 1,282
 * papers' worth of them into static HTML would hand a scraper the entire
 * preview corpus over plain HTTP with no account and no rate limit.
 *
 * That exclusion is enforced twice. First structurally: this script
 * authenticates with the PUBLISHABLE (anon) key, and anon has no SELECT on
 * bank_questions.body, Shikshaqmine."Link" or ."Phone Number" -- it is
 * physically incapable of reading them, so no future edit to a template here
 * can leak them. Second by assertion: assertNoQuestionText() below fetches
 * real question text and fails the build if any emitted file contains it.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

import { canonicalPathFor } from '../src/lib/canonical';
import { schoolSlug } from '../src/lib/school-slug';
import { displaySchool, isRealSchoolLabel } from '../src/lib/school-display';
import { buildPaperSeo, paperEducationalLevel } from '../src/lib/paper-seo';
import { bankSubjectToSite } from '../src/lib/subject-vocabulary';
import { isExcludedPaper } from './excluded-papers';
import { extractLeakNeedles, findLeak } from './prerender-leak-check';
import { SUBJECT_CONTENT, BOARD_CONTENT, type SubjectContent } from '../src/content/subject-seo';
import { SUBJECT_META, subjectSeoTitle } from '../src/content/subject-meta';
import { GHAR_PE_HEADING, gharPeParagraph } from '../src/content/ghar-pe';
import { LOCALITY_PAGES } from '../src/content/locality-pages.generated';
import { ROUTE_META, blogDescription } from '../src/content/route-meta';
import { BLOG_ARTICLES, BLOG_PATH, BLOG_SUBJECT_NAMES, BLOG_SUBJECTS } from '../src/content/blog';
import { FAQ_ITEMS } from '../src/content/faq-items';
import { DEFAULT_TITLE, DEFAULT_DESCRIPTION } from '../src/lib/seo-defaults';
import {
  countSubjectTeachers,
  localityFacts,
  localitySeoTitle,
  teachersFor,
  type LocalityTeacher,
} from '../src/lib/locality';
import { fetchLocalityTeachers } from './locality-data';
import {
  generateBreadcrumbSchema,
  generateCollectionPageSchema,
  generateFAQPageSchema,
  generateTeacherPersonSchema,
} from '../src/utils/structuredDataGenerators';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

config({ path: path.join(__dirname, '..', '.env') });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
const SITE_URL = 'https://www.shikshaq.in';
const DIST = path.join(__dirname, '..', 'dist');
const TEMPLATE_PATH = path.join(DIST, 'index.html');
/* The neutral SPA fallback. See the long comment above writeAppShell(). */
const SHELL_PATH = path.join(DIST, 'app-shell.html');
const PAGE = 1000;

/* Same reasoning as scripts/generate-sitemap.ts: nobody on this team can read
   Vercel's build logs, so a warning reaches no one. Prerendering half the
   routes and reporting success is worse than not prerendering at all, because
   the half that silently fell back is invisible. */
function fail(message: string): never {
  console.error(`\nPRERENDER FAILED: ${message}`);
  console.error('Refusing to ship a partially prerendered dist/.\n');
  process.exit(1);
}

if (!SUPABASE_URL || !SUPABASE_KEY) {
  fail('Missing VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

type Query = { range: (from: number, to: number) => Promise<{ data: unknown[] | null; error: { message: string } | null }> };

/* PostgREST truncates an unbounded select at 1000 rows and returns 200 OK.
   That bug already shipped once here (the sitemap advertised 1000 of 1282
   papers for weeks) so every read in this file pages explicitly. */
async function fetchAll<T>(build: () => Query, label: string): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) fail(`${label}: ${error.message}`);
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------

/** Escape for HTML text and double-quoted attribute values alike. */
function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* JSON-LD sits inside <script>, where HTML entity escaping does NOT apply --
   the only sequence that can break out is "</script". Escaping the forward
   slash is the standard fix and leaves the JSON valid. */
function jsonLd(schemas: object[]): string {
  if (schemas.length === 0) return '';
  const body = JSON.stringify(schemas.length === 1 ? schemas[0] : schemas).replace(/<\//g, '<\\/');
  return `<script type="application/ld+json">${body}</script>`;
}

interface Meta {
  title: string;
  description: string;
  path: string;
  /** Overrides what the canonical link / og:url are computed from, when the
   *  page is written at a NON-canonical URL (a merged school's non-canonical
   *  raw slug — see schoolRoutes()) that should still declare the canonical
   *  page as the real one. Defaults to `path` itself. */
  canonicalPath?: string;
  ogImage?: string;
  schemas: object[];
  body: string;
}

/**
 * Replace rather than append.
 *
 * The template already carries a title, description and a full og/twitter set
 * for the homepage. Appending would leave two of each in the document, and
 * which one wins is consumer-specific -- Facebook takes the first og:title,
 * Twitter tends to take the last. Replacing in place keeps exactly one.
 */
function render(template: string, meta: Meta): string {
  const url = `${SITE_URL}${canonicalPathFor(meta.canonicalPath ?? meta.path)}`;
  const title = esc(meta.title);
  const description = esc(meta.description);

  let html = template;

  html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${title}</title>`);
  html = html.replace(
    /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/,
    `<meta name="description" content="${description}" />`,
  );
  html = html.replace(
    /<meta\s+property="og:title"\s+content="[^"]*"\s*\/?>/,
    `<meta property="og:title" content="${title}" />`,
  );
  html = html.replace(
    /<meta\s+property="og:description"\s+content="[^"]*"\s*\/?>/,
    `<meta property="og:description" content="${description}" />`,
  );
  html = html.replace(
    /<meta\s+property="og:url"\s+content="[^"]*"\s*\/?>/,
    `<meta property="og:url" content="${esc(url)}" />`,
  );
  html = html.replace(
    /<meta\s+name="twitter:title"\s+content="[^"]*"\s*\/?>/,
    `<meta name="twitter:title" content="${title}" />`,
  );
  html = html.replace(
    /<meta\s+name="twitter:description"\s+content="[^"]*"\s*\/?>/,
    `<meta name="twitter:description" content="${description}" />`,
  );
  if (meta.ogImage) {
    html = html.replace(
      /<meta\s+property="og:image"\s+content="[^"]*"\s*\/?>/,
      `<meta property="og:image" content="${esc(meta.ogImage)}" />`,
    );
    html = html.replace(
      /<meta\s+name="twitter:image"\s+content="[^"]*"\s*\/?>/,
      `<meta name="twitter:image" content="${esc(meta.ogImage)}" />`,
    );
  }

  const head = `<link rel="canonical" href="${esc(url)}" />${jsonLd(meta.schemas)}`;
  html = html.replace('</head>', `${head}</head>`);

  /* A sibling of #root, not a child, and removed by src/main.tsx before
     createRoot() runs. Inside #root it would depend on React's container
     -clearing behaviour; in a <noscript> it would be ambiguous to a crawler
     that does execute JS. A plain sibling is unambiguous in both cases. */
  html = html.replace(
    '<div id="root"></div>',
    `<div id="root"></div>\n<div id="prerender">${meta.body}</div>`,
  );

  return html;
}

function writeRoute(routePath: string, html: string): void {
  const clean = routePath.replace(/^\/+|\/+$/g, '');
  const dir = clean ? path.join(DIST, clean) : DIST;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), html, 'utf8');
}

function links(items: Array<{ href: string; label: string }>): string {
  if (items.length === 0) return '';
  return `<ul>${items.map((i) => `<li><a href="${esc(i.href)}">${esc(i.label)}</a></li>`).join('')}</ul>`;
}

// ---------------------------------------------------------------------------
// Route builders
// ---------------------------------------------------------------------------

interface BankPaper {
  id: string;
  school: string;
  has_school: boolean;
  year: string | null;
  exam: string | null;
  cls: string;
  subject: string;
  board: string;
  question_count: number;
  marks: number;
}

function hasYear(year: string | null): boolean {
  return Boolean(year && year.trim() && year !== 'null');
}

function paperRoutes(papers: BankPaper[], template: string): number {
  const bySchool = new Map<string, BankPaper[]>();
  for (const p of papers) {
    if (!p.has_school) continue;
    const slug = schoolSlug(p.school);
    if (!slug) continue;
    if (!bySchool.has(slug)) bySchool.set(slug, []);
    bySchool.get(slug)!.push(p);
  }

  for (const p of papers) {
    const routePath = `/past-papers/${p.id}`;
    const url = `${SITE_URL}${routePath}`;
    const year = hasYear(p.year) ? p.year : null;
    const slug = p.has_school ? schoolSlug(p.school) : '';
    const displayName = displaySchool(p.school);

    /* Siblings from the same school turn 1,282 near-orphan paper pages into a
       connected graph. Before this, most were reachable only from the sitemap
       and a single /school/:slug listing. */
    const siblings = (slug ? bySchool.get(slug) ?? [] : [])
      .filter((s) => s.id !== p.id)
      .slice(0, 4)
      .map((s) => ({
        href: `/past-papers/${s.id}`,
        label: `${displaySchool(s.school)} Class ${s.cls} ${bankSubjectToSite(s.subject)}${hasYear(s.year) ? ` ${s.year}` : ''}`,
      }));

    /* Title, description and H1 come from the same builder BankPaper.tsx
       calls, so what a crawler reads and what the browser sets are one string. */
    const seo = buildPaperSeo({
      school: p.school,
      board: p.board,
      cls: p.cls,
      subject: p.subject,
      exam: p.exam,
      year: p.year,
      questionCount: p.question_count,
    });
    const heading = seo.heading;

    const body = [
      `<h1>${esc(heading)}</h1>`,
      `<dl>`,
      `<dt>School</dt><dd>${esc(displayName)}</dd>`,
      `<dt>Board</dt><dd>${esc(p.board)}</dd>`,
      `<dt>Class</dt><dd>${esc(p.cls)}</dd>`,
      `<dt>Subject</dt><dd>${esc(bankSubjectToSite(p.subject))}</dd>`,
      year ? `<dt>Year</dt><dd>${esc(year)}</dd>` : '',
      p.exam ? `<dt>Exam</dt><dd>${esc(p.exam)}</dd>` : '',
      `<dt>Questions</dt><dd>${esc(p.question_count)}</dd>`,
      `<dt>Total marks</dt><dd>${esc(p.marks)}</dd>`,
      `</dl>`,
      slug ? `<p><a href="/school/${esc(slug)}">All ${esc(displayName)} question papers</a></p>` : '',
      siblings.length ? `<h2>More from this school</h2>${links(siblings)}` : '',
    ].join('');

    /* isAccessibleForFree:false + hasPart is Google's documented paywall
       markup. Without it, a page that advertises 40 questions in its
       description while showing a signed-out reader two of them reads as
       thin content or a content mismatch, across 1,282 URLs. BankPaper.tsx
       emits no JSON-LD at all today, so this is the whole structured-data
       story for the site's largest URL class. */
    const learningResource = {
      '@context': 'https://schema.org',
      '@type': 'LearningResource',
      '@id': `${url}#resource`,
      url,
      name: heading,
      learningResourceType: 'Exam question paper',
      inLanguage: 'en',
      educationalLevel: paperEducationalLevel(p) || `Class ${p.cls}`,
      about: { '@type': 'Thing', name: bankSubjectToSite(p.subject) },
      isAccessibleForFree: false,
      ...(year ? { datePublished: year } : {}),
      provider: { '@type': 'EducationalOrganization', name: displayName },
      isPartOf: { '@id': `${SITE_URL}/#website` },
      hasPart: {
        '@type': 'WebPageElement',
        isAccessibleForFree: false,
        cssSelector: '.question-list',
      },
    };

    const breadcrumbs = generateBreadcrumbSchema(
      [
        { name: 'Home', url: '/' },
        { name: 'Past papers', url: '/past-papers' },
        ...(slug ? [{ name: displayName, url: `/school/${slug}` }] : []),
        { name: heading, url: routePath },
      ],
      `${url}#breadcrumb`,
    );

    writeRoute(
      routePath,
      render(template, {
        title: seo.title,
        description: seo.description,
        path: routePath,
        schemas: [learningResource, breadcrumbs],
        body,
      }),
    );
  }

  return papers.length;
}

interface SchoolSummary { label: string; canonicalSlug: string; count: number }

function schoolRoutes(papers: BankPaper[], template: string): { count: number; schools: SchoolSummary[] } {
  /* Two layers, same shape as src/lib/question-bank.ts's schoolGroupsOfPapers
     (this script has its own BankPaper/lowercase-field shape, so the grouping
     is re-implemented here rather than imported):

     1. bySlug -- raw slug -> that spelling's own papers, exactly as before.
     2. byLabel -- several raw slugs that share a DISPLAY LABEL ("Gregorios" /
        "St Gregorios" / "St. Gregorios High School" are all one real school)
        folded into one group, so the merged page's own count/paper list is
        the school's TRUE total, not one third of it three times over.

     Every raw slug in a group still gets its own prerendered file (an old
     /school/gregorios link must not 404), but all of them render the SAME
     merged content, and only the canonical slug's version omits an
     overriding canonical link. */
  const bySlug = new Map<string, { name: string; papers: BankPaper[] }>();
  for (const p of papers) {
    if (!p.has_school) continue;
    const slug = schoolSlug(p.school);
    if (!slug) continue;
    if (!bySlug.has(slug)) bySlug.set(slug, { name: p.school, papers: [] });
    bySlug.get(slug)!.papers.push(p);
  }

  interface SchoolGroup { label: string; canonicalSlug: string; slugs: string[]; papers: BankPaper[] }
  const bySlugsForLabel = new Map<string, string[]>();
  for (const [slug, { name }] of bySlug) {
    const label = displaySchool(name);
    if (!isRealSchoolLabel(label)) continue;
    const list = bySlugsForLabel.get(label) ?? [];
    list.push(slug);
    bySlugsForLabel.set(label, list);
  }

  const byLabel = new Map<string, SchoolGroup>();
  for (const [label, slugs] of bySlugsForLabel) {
    /* Canonical: the raw spelling whose OWN display equals the label (no
       lookup table needed to justify the URL), else the raw spelling with
       the most papers -- same rule SchoolsPage.tsx and question-bank.ts's
       schoolGroupsOfPapers use, kept in sync by hand across the three since
       this script cannot import browser-facing modules that pull in
       supabase-js. */
    const selfCanonicalSlug = slugs.find((s) => displaySchool(bySlug.get(s)!.name) === bySlug.get(s)!.name);
    const canonicalSlug = selfCanonicalSlug
      ?? slugs.reduce((best, s) => (
        bySlug.get(s)!.papers.length > bySlug.get(best)!.papers.length ? s : best
      ));
    byLabel.set(label, {
      label,
      canonicalSlug,
      slugs,
      papers: slugs.flatMap((s) => bySlug.get(s)!.papers),
    });
  }

  for (const { label: name, canonicalSlug, slugs, papers: list } of byLabel.values()) {
    const canonicalPath = `/school/${canonicalSlug}`;
    const canonicalUrl = `${SITE_URL}${canonicalPath}`;
    const years = [...new Set(list.map((p) => p.year).filter(hasYear))].sort().reverse();
    const subjects = [...new Set(list.map((p) => p.subject))];

    /* Every paper, not a sample. This listing is what makes the 1,282 paper
       URLs crawlable without relying on the sitemap alone. */
    const paperLinks = list.map((p) => ({
      href: `/past-papers/${p.id}`,
      label: `Class ${p.cls} ${p.subject}${hasYear(p.year) ? ` ${p.year}` : ''}${p.exam ? ` ${p.exam}` : ''}`,
    }));

    const body = [
      `<h1>${esc(name)} question papers</h1>`,
      `<p>${esc(list.length)} past papers`,
      subjects.length ? ` across ${esc(subjects.join(', '))}` : '',
      years.length ? `, from ${esc(years[years.length - 1])} to ${esc(years[0])}` : '',
      `.</p>`,
      `<h2>All papers</h2>`,
      links(paperLinks),
    ].join('');

    const schemas = [
      generateCollectionPageSchema({
        url: canonicalUrl,
        name: `${name} question papers`,
        description: `Past question papers from ${name}, Kolkata.`,
        about: name,
        numberOfItems: list.length,
      }),
      generateBreadcrumbSchema(
        [
          { name: 'Home', url: '/' },
          { name: 'Schools', url: '/schools' },
          { name, url: canonicalPath },
        ],
        `${canonicalUrl}#breadcrumb`,
      ),
    ];

    const description =
      `${list.length} past question papers from ${name}`
      + `${subjects.length ? `, covering ${subjects.join(', ')}` : ''}`
      + `${years.length ? `, ${years[years.length - 1]} to ${years[0]}` : ''}. Free to read with an account.`;

    /* One physical file per raw slug the group covers -- an old
       /school/gregorios link renders the same merged page rather than
       404ing -- but every one of them (including the canonical slug's own,
       harmlessly: canonicalPath === its own path there) declares the
       canonical URL via canonicalPath. */
    for (const slug of slugs) {
      const routePath = `/school/${slug}`;
      writeRoute(
        routePath,
        render(template, {
          title: `${name} Question Papers | Shikshaq`,
          description,
          path: routePath,
          canonicalPath,
          schemas,
          body,
        }),
      );
    }
  }

  return {
    count: byLabel.size,
    schools: [...byLabel.values()]
      .map((g) => ({ label: g.label, canonicalSlug: g.canonicalSlug, count: g.papers.length }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
  };
}

interface TeacherRow {
  slug: string;
  name: string;
  image_url: string | null;
}

interface ShikshaqmineRow {
  Slug: string;
  Title: string | null;
  "Sir/Ma'am?": string | null;
  Subjects: string | null;
  'Classes Taught': string | null;
  Area: string | null;
  'School Boards Catered': string | null;
  Description: string | null;
  'Qualifications etc': string | null;
  'Mode of Teaching': string | null;
}

function teacherRoutes(teachers: TeacherRow[], mine: Map<string, ShikshaqmineRow>, template: string): number {
  for (const t of teachers) {
    const m = mine.get(t.slug.toLowerCase());
    const routePath = `/tuition-teachers/${t.slug}`;
    const url = `${SITE_URL}${routePath}`;
    const honorific = m?.["Sir/Ma'am?"] ?? '';
    const displayName = honorific ? `${t.name} ${honorific}` : t.name;
    const subjects = (m?.Subjects ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const classes = (m?.['Classes Taught'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const boards = (m?.['School Boards Catered'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const area = m?.Area ?? null;
    const primary = subjects[0] ?? 'Tuition';

    /* NO Description and NO "Qualifications etc" here, deliberately.
       Those two are the teacher's own prose, and they are the blocks marked
       [data-protected] on the profile, where selection and copying are
       blocked. Emitting them into static HTML would have made that protection
       theatre: the browser would refuse to let you select the bio while
       `curl https://www.shikshaq.in/tuition-teachers/<slug>` handed over the
       same paragraph in full, to anyone, with no account and no JavaScript.
       What stays is structured metadata -- subjects, boards, classes, areas,
       mode. That is what these pages actually rank for ("maths tuition teacher
       in Ballygunge"), it is factual rather than authored, and it is the half
       a competitor could reconstruct from a directory anyway. The prose is the
       part that took work, so it now comes only from the API, behind the same
       gates as everything else. */
    const body = [
      `<h1>${esc(displayName)}</h1>`,
      `<p>${esc(primary)} tuition teacher in ${esc(area ?? 'Kolkata')}.</p>`,
      `<dl>`,
      subjects.length ? `<dt>Subjects</dt><dd>${esc(subjects.join(', '))}</dd>` : '',
      classes.length ? `<dt>Classes</dt><dd>${esc(classes.join(', '))}</dd>` : '',
      boards.length ? `<dt>Boards</dt><dd>${esc(boards.join(', '))}</dd>` : '',
      area ? `<dt>Area</dt><dd>${esc(area)}</dd>` : '',
      m?.['Mode of Teaching'] ? `<dt>Mode</dt><dd>${esc(m['Mode of Teaching'])}</dd>` : '',
      `</dl>`,
    ].join('');

    /* No telephone passed, deliberately. generateTeacherPersonSchema accepts
       phoneNumber, and this script could not supply it even if a template
       asked -- anon has no SELECT on Shikshaqmine."Phone Number". Contact
       stays behind the sign-in gate on the profile itself. */
    /* The bio and qualifications are withheld from the JSON-LD for the same
       reason they are withheld from the body block above -- a <script
       type="application/ld+json"> is plain text in the served HTML, so putting
       the prose there would have leaked exactly what removing it from the body
       was meant to stop. Easy thing to miss: the visible markup looks clean
       and the paragraph is still sitting in the page source. */
    const person = generateTeacherPersonSchema({
      url,
      name: displayName,
      area,
      subjects,
      classesTaught: classes,
    });

    const description =
      `${displayName} teaches ${subjects.length ? subjects.join(', ') : 'tuition'}`
      + `${classes.length ? ` for ${classes.join(', ')}` : ''}`
      + `${area ? ` in ${area}` : ' in Kolkata'}. `
      + 'See experience, fees and reviews on Shikshaq.';

    const ogImage = t.image_url && /^https?:\/\//.test(t.image_url) ? t.image_url : undefined;

    writeRoute(
      routePath,
      render(template, {
        title: `${displayName} - ${primary} Tuition Teacher in ${area ?? 'Kolkata'} | Shikshaq`,
        description,
        path: routePath,
        ogImage,
        schemas: [
          person,
          generateBreadcrumbSchema(
            [
              { name: 'Home', url: '/' },
              { name: 'Tuition teachers', url: '/all-tuition-teachers-in-kolkata' },
              { name: displayName, url: routePath },
            ],
            `${url}#breadcrumb`,
          ),
        ],
        body,
      }),
    );
  }

  return teachers.length;
}

/**
 * The 35 subject and board landing pages.
 *
 * These carry 1,127 lines of genuinely good, route-specific copy in
 * src/content/subject-seo.ts -- and every word of it has been invisible to any
 * crawler that does not execute JavaScript. They are also the pages that
 * inherit Browse's generic <h1>, so all 35 of the highest-intent commercial
 * URLs currently share one heading.
 *
 * Same objects the client renders through SEOContentBlock, so there is one
 * source of truth and no possibility of the static HTML and the rendered page
 * disagreeing.
 */
/** The locality pages hanging off one subject page, as a crawlable link list. */
function localityLinksFor(subjectPath: string): Array<{ href: string; label: string }> {
  const subject = SUBJECT_META[subjectPath]?.label;
  return LOCALITY_PAGES
    .filter((p) => p.subjectPath === subjectPath)
    .map((p) => ({ href: p.path, label: `${subject} tuition in ${p.area}` }));
}

function subjectRoutes(template: string, teachers: LocalityTeacher[]): number {
  const entries: Array<[string, SubjectContent, 'subject' | 'board']> = [
    ...Object.entries(SUBJECT_CONTENT).map(([k, v]) => [k, v, 'subject'] as [string, SubjectContent, 'subject']),
    ...Object.entries(BOARD_CONTENT).map(([k, v]) => [k, v, 'board'] as [string, SubjectContent, 'board']),
  ];

  for (const [routePath, content, kind] of entries) {
    const url = `${SITE_URL}${canonicalPathFor(routePath)}`;
    /* Subject pages read title, description and label from SUBJECT_META, the
       table SubjectPage.tsx reads too, so crawler and browser agree. (The label
       used to be title-cased out of the URL, which turned "sat" into "Sat".)
       Board pages are unchanged. */
    const meta = kind === 'subject' ? SUBJECT_META[routePath] : undefined;
    if (kind === 'subject' && !meta) fail(`No SUBJECT_META entry for ${routePath}`);
    const label = meta
      ? meta.label
      : routePath
        .replace(/^\//, '')
        .replace(/-tuition-teachers-in-kolkata$/, '')
        .split('-')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');

    const heading = `${label} tuition teachers in Kolkata`;
    const localityLinks = kind === 'subject' ? localityLinksFor(routePath) : [];

    const body = [
      `<h1>${esc(heading)}</h1>`,
      `<p>${esc(content.intro)}</p>`,
      content.covers.length
        ? `<h2>What tutors cover</h2><ul>${content.covers.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`
        : '',
      kind === 'subject'
        ? `<h2>${esc(GHAR_PE_HEADING)}</h2><p>${esc(gharPeParagraph(label))}</p>`
        : '',
      localityLinks.length ? `<h2>${esc(label)} tuition by area</h2>${links(localityLinks)}` : '',
      content.faqs.length
        ? `<h2>Common questions</h2>${content.faqs
            .map((f) => `<h3>${esc(f.question)}</h3><p>${esc(f.answer)}</p>`)
            .join('')}`
        : '',
      content.internalLinks.length ? `<h2>Related</h2>${links(content.internalLinks)}` : '',
    ].join('');

    writeRoute(
      routePath,
      render(template, {
        title: meta ? subjectSeoTitle(label) : `${heading} | Shikshaq`,
        description: meta ? meta.description : content.intro.slice(0, 300).replace(/\s+\S*$/, ''),
        path: routePath,
        schemas: [
          generateCollectionPageSchema({
            url,
            name: heading,
            description: content.intro.slice(0, 200),
            about: label,
            /* A real count for subject pages, from the same rows the locality
               pages use; omitted for boards, where no count is computed. It
               used to be a hardcoded 0 on all of them. */
            numberOfItems: kind === 'subject' ? countSubjectTeachers(teachers, routePath) : undefined,
          }),
          ...(content.faqs.length ? [generateFAQPageSchema({ url, faqs: content.faqs })] : []),
          generateBreadcrumbSchema(
            [
              { name: 'Home', url: '/' },
              { name: 'Tuition teachers', url: '/all-tuition-teachers-in-kolkata' },
              { name: heading, url: routePath },
            ],
            `${url}#breadcrumb`,
          ),
        ],
        body,
      }),
    );
  }

  return entries.length;
}

/**
 * Locality x subject pages: /maths-tuition-teachers-in-salt-lake.
 *
 * Which pages exist is decided by src/content/locality-pages.generated.ts
 * (5+ real published teachers for that subject and area), so the client
 * bundle, this prerender and the sitemap all agree. The body is built from
 * the live teacher rows: their names, classes and boards, and the class and
 * board mix across them. No bio, no contact, nothing gated: the same columns
 * the public teacher pages above already read.
 */
function localityRoutes(template: string, teachers: LocalityTeacher[]): number {
  for (const entry of LOCALITY_PAGES) {
    const meta = SUBJECT_META[entry.subjectPath];
    if (!meta) fail(`Locality page ${entry.path} points at unknown subject ${entry.subjectPath}`);
    const list = teachersFor(teachers, entry.subjectPath, entry.area);
    /* The generated list is from the prebuild step; this read is seconds
       later. A teacher joining or pausing in between would change the count by
       one, which is worth a warning and not a failed deploy. */
    if (list.length !== entry.count) {
      console.warn(`   ${entry.path}: generated count ${entry.count}, live count ${list.length}`);
    }
    const facts = localityFacts(list);
    const url = `${SITE_URL}${entry.path}`;
    const heading = `${meta.label} tuition teachers in ${entry.area}, Kolkata`;

    const cards = list.map((t) => ({
      href: `/tuition-teachers/${t.slug}`,
      label: [
        t.honorific ? `${t.name} ${t.honorific}` : t.name,
        t.classes,
        t.boards,
      ].filter(Boolean).join(', '),
    }));

    const nearby = LOCALITY_PAGES
      .filter((p) => p.subjectPath === entry.subjectPath && p.path !== entry.path)
      .map((p) => ({ href: p.path, label: `${meta.label} tuition in ${p.area}` }));
    const otherSubjects = LOCALITY_PAGES
      .filter((p) => p.area === entry.area && p.path !== entry.path)
      .map((p) => ({ href: p.path, label: `${SUBJECT_META[p.subjectPath].label} tuition in ${entry.area}` }));

    const body = [
      `<h1>${esc(heading)}</h1>`,
      `<p>${esc(entry.count)} verified ${esc(meta.label)} teachers in ${esc(entry.area)} on Shikshaq.</p>`,
      facts.boards.length
        ? `<p>Boards they teach: ${esc(facts.boards.map((b) => `${b.board} (${b.count})`).join(', '))}.</p>`
        : '',
      facts.bands.length
        ? `<p>Classes covered: ${esc(facts.bands.map((b) => `${b.band} (${b.count})`).join(', '))}.</p>`
        : '',
      `<h2>${esc(meta.label)} teachers in ${esc(entry.area)}</h2>`,
      links(cards),
      `<h2>${esc(GHAR_PE_HEADING)}</h2><p>${esc(gharPeParagraph(meta.label))}</p>`,
      `<p><a href="${esc(entry.subjectPath)}">All ${esc(meta.label)} tuition teachers in Kolkata</a></p>`,
      nearby.length ? `<h2>${esc(meta.label)} tuition in other areas</h2>${links(nearby)}` : '',
      otherSubjects.length ? `<h2>More tuition in ${esc(entry.area)}</h2>${links(otherSubjects)}` : '',
    ].join('');

    writeRoute(
      entry.path,
      render(template, {
        title: localitySeoTitle(meta.label, entry.area, entry.count),
        description: entry.description,
        path: entry.path,
        schemas: [
          generateCollectionPageSchema({
            url,
            name: heading,
            description: entry.description,
            about: `${meta.label} tutors in ${entry.area}`,
            numberOfItems: list.length,
          }),
          generateBreadcrumbSchema(
            [
              { name: 'Home', url: '/' },
              { name: `${meta.label} tuition teachers`, url: entry.subjectPath },
              { name: heading, url: entry.path },
            ],
            `${url}#breadcrumb`,
          ),
        ],
        body,
      }),
    );
  }

  return LOCALITY_PAGES.length;
}

// ---------------------------------------------------------------------------
// The six top-level routes that used to ship an empty page
// ---------------------------------------------------------------------------

const BOARD_LINKS: Array<{ href: string; label: string }> = [
  { href: '/cbse-ncert-tuition-teachers-in-kolkata', label: 'CBSE tuition teachers' },
  { href: '/icse-tuition-teachers-in-kolkata', label: 'ICSE tuition teachers' },
  { href: '/igcse-tuition-teachers-in-kolkata', label: 'IGCSE tuition teachers' },
  { href: '/international-board-tuition-teachers-in-kolkata', label: 'International board tuition teachers' },
  { href: '/state-board-tuition-teachers-in-kolkata', label: 'State board tuition teachers' },
];

function tally<T>(items: T[], key: (item: T) => string): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const k = key(item);
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function schoolLinks(list: SchoolSummary[]): Array<{ href: string; label: string }> {
  return list.map((s) => ({
    href: `/school/${s.canonicalSlug}`,
    label: `${s.label}: ${s.count} paper${s.count === 1 ? '' : 's'}`,
  }));
}

/**
 * Home, /past-papers, /all-tuition-teachers-in-kolkata, /schools, /faq, /blog.
 *
 * Until now these reached any crawler that does not run JavaScript with the
 * homepage's meta and an empty page. Each now gets its own title, description,
 * canonical, H1 and a short crawlable link list, built from rows the anon key
 * can already read. Titles and descriptions come from content/route-meta.ts
 * and lib/seo-defaults.ts, which the page components read too.
 */
function siteRoutes(
  template: string,
  papers: BankPaper[],
  schools: SchoolSummary[],
  teachers: TeacherRow[],
): number {
  const subjectLinks = Object.keys(SUBJECT_META)
    .filter((p) => p !== '/commercial-studies-tuition-teachers-in-kolkata')
    .map((p) => ({ href: p, label: `${SUBJECT_META[p].label} tuition teachers in Kolkata` }));
  const popularAreas = [...LOCALITY_PAGES]
    .sort((a, b) => b.count - a.count || a.path.localeCompare(b.path))
    .slice(0, 12)
    .map((p) => ({ href: p.path, label: `${SUBJECT_META[p.subjectPath].label} tuition in ${p.area}` }));

  const boards = tally(papers, (p) => (p.board && p.board !== 'Board' ? p.board : ''));
  const paperSubjects = tally(papers, (p) => bankSubjectToSite(p.subject));
  const boardText = boards.map(([b]) => b).join(', ');

  let count = 0;
  const write = (routePath: string, meta: Omit<Meta, 'path'>) => {
    writeRoute(routePath, render(template, { ...meta, path: routePath }));
    count++;
  };

  // Home. Written to dist/index.html; the neutral fallback is app-shell.html.
  write('/', {
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    schemas: [],
    body: [
      '<h1>Find a home tutor in Kolkata</h1>',
      `<p>Shikshaq lists ${esc(teachers.length)} verified tuition teachers across Kolkata. `
        + 'Filter by subject, class, board and area, then message the teacher directly on WhatsApp. It is free.</p>',
      `<h2>Tuition teachers by subject</h2>${links(subjectLinks)}`,
      `<h2>Tuition teachers by board</h2>${links(BOARD_LINKS)}`,
      popularAreas.length ? `<h2>Popular areas</h2>${links(popularAreas)}` : '',
      `<h2>Free past papers</h2><p>${esc(papers.length)} question papers from ${esc(schools.length)} schools`
        + `${boardText ? `, ${esc(boardText)}` : ''}.</p>`,
      links([
        { href: '/past-papers', label: 'All past papers' },
        { href: '/schools', label: 'Papers by school' },
        ...schoolLinks(schools.slice(0, 10)),
      ]),
      `<h2>More</h2>${links([
        { href: '/all-tuition-teachers-in-kolkata', label: 'All tuition teachers in Kolkata' },
        { href: '/faq', label: 'Questions and answers' },
        { href: BLOG_PATH, label: 'The papers, counted' },
        { href: '/join', label: 'Teach with Shikshaq' },
      ])}`,
    ].join(''),
  });

  write('/past-papers', {
    ...ROUTE_META.pastPapers,
    schemas: [
      generateBreadcrumbSchema(
        [{ name: 'Home', url: '/' }, { name: 'Past papers', url: '/past-papers' }],
        `${SITE_URL}/past-papers#breadcrumb`,
      ),
    ],
    body: [
      '<h1>Free past year question papers</h1>',
      `<p>${esc(papers.length)} question papers from ${esc(schools.length)} schools, read question by question.</p>`,
      boards.length
        ? `<h2>By board</h2><ul>${boards.map(([b, n]) => `<li>${esc(b)}: ${esc(n)} papers</li>`).join('')}</ul>`
        : '',
      paperSubjects.length
        ? `<h2>By subject</h2><ul>${paperSubjects.map(([sub, n]) => `<li>${esc(sub)}: ${esc(n)} papers</li>`).join('')}</ul>`
        : '',
      `<h2>By school</h2>${links(schoolLinks(schools.slice(0, 40)))}`,
      '<p><a href="/schools">See every school</a></p>',
    ].join(''),
  });

  write('/schools', {
    ...ROUTE_META.schools,
    schemas: [
      generateBreadcrumbSchema(
        [{ name: 'Home', url: '/' }, { name: 'Schools', url: '/schools' }],
        `${SITE_URL}/schools#breadcrumb`,
      ),
    ],
    body: [
      '<h1>Past papers by school</h1>',
      `<p>${esc(schools.length)} schools, ${esc(papers.length)} papers.</p>`,
      links(schoolLinks(schools)),
    ].join(''),
  });

  write('/all-tuition-teachers-in-kolkata', {
    ...ROUTE_META.allTeachers,
    schemas: [
      generateBreadcrumbSchema(
        [{ name: 'Home', url: '/' }, { name: 'Tuition teachers', url: '/all-tuition-teachers-in-kolkata' }],
        `${SITE_URL}/all-tuition-teachers-in-kolkata#breadcrumb`,
      ),
    ],
    body: [
      '<h1>Tuition teachers in Kolkata</h1>',
      `<p>${esc(teachers.length)} verified tuition teachers. Filter by subject, class, board, area, mode of teaching and fees.</p>`,
      `<h2>By subject</h2>${links(subjectLinks)}`,
      `<h2>By board</h2>${links(BOARD_LINKS)}`,
      `<h2>All teachers</h2>${links(teachers.map((t) => ({ href: `/tuition-teachers/${t.slug}`, label: t.name })))}`,
    ].join(''),
  });

  write('/faq', {
    ...ROUTE_META.faq,
    schemas: [
      generateFAQPageSchema({ url: `${SITE_URL}/faq`, faqs: FAQ_ITEMS }),
      generateBreadcrumbSchema(
        [{ name: 'Home', url: '/' }, { name: 'FAQ', url: '/faq' }],
        `${SITE_URL}/faq#breadcrumb`,
      ),
    ],
    body: [
      '<h1>Tuition FAQs for students and parents in Kolkata</h1>',
      FAQ_ITEMS.map((f) => `<h2>${esc(f.question)}</h2><p>${esc(f.answer)}</p>`).join(''),
    ].join(''),
  });

  const totals = BLOG_SUBJECT_NAMES.reduce(
    (acc, name) => {
      const t = BLOG_SUBJECTS[name]?.totals;
      return t ? { papers: acc.papers + t.papers, questions: acc.questions + t.questions } : acc;
    },
    { papers: 0, questions: 0 },
  );
  const blogIntro = blogDescription(totals.questions, totals.papers);
  write(BLOG_PATH, {
    title: ROUTE_META.blog.title,
    description: blogIntro,
    schemas: [
      generateBreadcrumbSchema(
        [{ name: 'Home', url: '/' }, { name: 'Reading', url: BLOG_PATH }],
        `${SITE_URL}${BLOG_PATH}#breadcrumb`,
      ),
    ],
    body: [
      '<h1>The papers, counted</h1>',
      `<p>${esc(blogIntro)}</p>`,
      links(BLOG_ARTICLES.map((a) => ({ href: `${BLOG_PATH}/${a.slug}`, label: a.title }))),
    ].join(''),
  });

  return count;
}

// ---------------------------------------------------------------------------
// The SPA fallback
// ---------------------------------------------------------------------------

/**
 * dist/index.html does two jobs, and they pull in opposite directions.
 *
 * 1. It is the page served at "/". The home page wants its own canonical and a
 *    crawlable body.
 * 2. vercel.json used to rewrite EVERY unprerendered URL to it (/about,
 *    /contact, /join, a typo, a route added tomorrow). Anything route-specific
 *    in this file, above all a canonical pointing at "/", would be served at
 *    all of those and tell Google each one is a duplicate of the home page.
 *
 * So the two jobs get two files. The pristine, route-neutral template (home
 * title and description, NO canonical, no body) is saved here as
 * dist/app-shell.html, and vercel.json rewrites the fallback to THAT. Vercel
 * serves a real file before it applies rewrites, so "/" still resolves to
 * dist/index.html, which siteRoutes() overwrites with the prerendered home page.
 *
 * Asserted rather than trusted: if the shell ever gains a canonical or a
 * prerender block, the build fails.
 */
function writeAppShell(pristineTemplate: string): void {
  if (/rel="canonical"/.test(pristineTemplate) || pristineTemplate.includes('id="prerender"')) {
    fail('The neutral app shell must carry no canonical link and no prerender block.');
  }
  fs.writeFileSync(SHELL_PATH, pristineTemplate, 'utf8');
}

// ---------------------------------------------------------------------------
// The assertion that makes the exclusion real
// ---------------------------------------------------------------------------

/**
 * Fetch real question text and prove none of it reached dist/.
 *
 * The structural guarantee (anon cannot read bank_questions.body) is the
 * primary defence, but it is invisible -- someone could add a service-role key
 * here in six months without realising what it unlocks. This makes the rule
 * enforceable by the build instead of by memory.
 */
/**
 * question_count counts every row; the Maths hold keeps flagged questions off
 * the page, so the "All N questions" a crawler reads uses the visible count,
 * the same number the browser shows (src/lib/question-bank.ts). Counts only,
 * anon key. A failure keeps question_count and says so: a slightly high number
 * beats a failed deploy nobody here can read the logs of.
 */
async function applyVisibleCounts(papers: BankPaper[]): Promise<void> {
  const { data, error } = await supabase.rpc('bank_paper_visible_counts' as never, {} as never);
  if (error || !Array.isArray(data)) {
    console.warn(`   Visible counts unavailable (${error?.message ?? 'no data'}); using question_count`);
    return;
  }
  const visible = new Map((data as Array<{ paper_id: string; visible: number }>).map((r) => [r.paper_id, r.visible]));
  let changed = 0;
  for (const p of papers) {
    const v = visible.get(p.id);
    if (typeof v === 'number' && v !== p.question_count) { p.question_count = v; changed += 1; }
  }
  console.log(`   Visible question counts applied (${changed} papers differ from question_count)`);
}

async function assertNoQuestionText(paperId: string, emitted: string[]): Promise<void> {
  const { data, error } = await supabase.rpc('bank_paper_questions', { p_paper_id: paperId });
  if (error || !Array.isArray(data) || data.length === 0) {
    console.warn('   Could not fetch sample question text; skipping leak assertion');
    return;
  }

  const needles = extractLeakNeedles((data as Array<{ body: string }>).map((q) => q.body));
  if (needles.length === 0) return;

  const files = emitted.map((file) => ({ path: file, html: fs.readFileSync(file, 'utf8') }));
  const leak = findLeak(needles, files);
  if (leak) {
    fail(
      `Question body text found in ${path.relative(DIST, leak.path)}.\n`
      + `  Matched: "${leak.needle}"\n`
      + '  Prerendered HTML is served to anyone over plain HTTP, with no account and no rate limit.\n'
      + '  Question text belongs behind bank_paper_questions(), never in a static file.',
    );
  }
  console.log(`   Leak assertion passed (${needles.length} samples vs ${emitted.length} files)`);
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('\nPrerendering routes...\n');

  if (!fs.existsSync(TEMPLATE_PATH)) {
    fail(`No dist/index.html at ${TEMPLATE_PATH}. Run vite build first.`);
  }
  let template = fs.readFileSync(TEMPLATE_PATH, 'utf8');

  /* A second run over the same dist/ would find the prerendered home page here
     instead of the pristine template, and bake its canonical and body into
     every other route. Go back to the pristine shell saved on the first run. */
  if (template.includes('id="prerender"')) {
    if (!fs.existsSync(SHELL_PATH)) {
      fail('dist/index.html is already prerendered and there is no dist/app-shell.html to start from. Run vite build again.');
    }
    template = fs.readFileSync(SHELL_PATH, 'utf8');
  }

  if (!template.includes('<div id="root"></div>')) {
    fail('dist/index.html has no <div id="root"></div> to anchor the prerender block to.');
  }
  writeAppShell(template);

  const allPapers = await fetchAll<BankPaper>(
    () => supabase
      .from('bank_papers')
      .select('id, school, has_school, year, exam, cls, subject, board, question_count, marks')
      .eq('is_published', true).gt('question_count', 0) as unknown as Query,
    'bank_papers',
  );
  if (allPapers.length === 0) fail('bank_papers returned zero rows');

  /* Filter before deriving schools, not after. A school whose only papers are
     all excluded then drops out on its own, instead of getting a hub page
     listing nothing -- which would trade one thin page for another. */
  const papers = allPapers.filter((p) => !isExcludedPaper(p.id));
  await applyVisibleCounts(papers);
  const skipped = allPapers.length - papers.length;
  if (skipped > 0) console.log(`   Skipped ${skipped} papers with placeholder question text`);

  const teachers = await fetchAll<TeacherRow>(
    () => supabase.from('teachers_list').select('slug, name, image_url').order('name') as unknown as Query,
    'teachers_list',
  );
  if (teachers.length === 0) fail('teachers_list returned zero rows');

  /* No "Link", no "Phone Number", no "Email ID" -- anon has no SELECT on any
     of them, and naming one here would fail the whole query with a
     permission error rather than omitting the column. */
  const mineRows = await fetchAll<ShikshaqmineRow>(
    () => supabase
      .from('Shikshaqmine')
      .select('"Slug","Title","Sir/Ma\'am?","Subjects","Classes Taught","Area","School Boards Catered","Description","Qualifications etc","Mode of Teaching"') as unknown as Query,
    'Shikshaqmine',
  );
  const mine = new Map(mineRows.filter((r) => r.Slug).map((r) => [r.Slug.toLowerCase(), r]));

  const localityTeachers = await fetchLocalityTeachers(supabase, fail);
  if (localityTeachers.length === 0) fail('no teachers readable for locality pages');

  const schoolResult = schoolRoutes(papers, template);
  const counts = {
    papers: paperRoutes(papers, template),
    schools: schoolResult.count,
    teachers: teacherRoutes(teachers, mine, template),
    subjects: subjectRoutes(template, localityTeachers),
    localities: localityRoutes(template, localityTeachers),
    site: siteRoutes(template, papers, schoolResult.schools, teachers),
  };

  const total = counts.papers + counts.schools + counts.teachers + counts.subjects
    + counts.localities + counts.site;

  console.log('   Paper pages:        ' + counts.papers);
  console.log('   School pages:       ' + counts.schools);
  console.log('   Teacher profiles:   ' + counts.teachers);
  console.log('   Subject/board:      ' + counts.subjects);
  console.log('   Locality pages:     ' + counts.localities);
  console.log('   Top-level routes:   ' + counts.site);
  console.log('   ─────────────────────────────');
  console.log('   Total prerendered:  ' + total);

  const sample = [
    path.join(DIST, 'past-papers', papers[0].id, 'index.html'),
    path.join(DIST, 'tuition-teachers', teachers[0].slug, 'index.html'),
    TEMPLATE_PATH,
    SHELL_PATH,
    path.join(DIST, 'past-papers', 'index.html'),
    path.join(DIST, 'schools', 'index.html'),
    ...LOCALITY_PAGES.slice(0, 3).map((p) => path.join(DIST, p.path.replace(/^\//, ''), 'index.html')),
  ].filter((f) => fs.existsSync(f));

  await assertNoQuestionText(papers[0].id, sample);

  console.log('\nPrerender complete.\n');
}

main().catch((err) => fail(String(err)));
