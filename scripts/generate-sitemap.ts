#!/usr/bin/env tsx
/**
 * AUTOMATIC SITEMAP GENERATOR
 *
 * This script automatically regenerates public/sitemap.xml with:
 * - All approved teacher profiles from database
 * - All subject pages
 * - All board pages
 * - All static pages
 *
 * Run manually: npm run generate-sitemap
 * Or set up as cron job / build step
 *
 * Updates public/sitemap.xml directly
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

/* Imported rather than re-listed: the article set is generated, so hardcoding
   slugs here would be a second copy of it, drifting the moment the bank grows.
   The import is type-only at runtime cost of one small module with no
   browser dependencies. */
import { BLOG_ARTICLES, BLOG_PATH } from '../src/content/blog';
import { LOCALITY_PAGES } from '../src/content/locality-pages.generated';
import { config } from 'dotenv';
/* Imported, not reimplemented. A local copy of this drifted immediately: it
   omitted the `&` -> ' and ' expansion that schoolSlug does before stripping
   non-alphanumerics, so any school with an ampersand would have been listed in
   the sitemap under a slug SchoolPage.tsx cannot resolve — a submitted URL
   that 404s, which is the exact bug already fixed once for /cbse-ncert-. */
import { schoolSlug } from '../src/lib/school-slug';
import { buildBankURLs, dedupeByLoc, type SitemapURL } from './sitemap-bank-urls';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from project root
config({ path: path.join(__dirname, '..', '.env') });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
const SITE_URL = 'https://www.shikshaq.in';
const OUTPUT_PATH = path.join(__dirname, '..', 'public', 'sitemap.xml');

/* This script used to fail open. Every credential check and every query error
   returned [], main() carried on, and a perfectly valid ~50-URL sitemap was
   written with exit code 0 -- so `prebuild` succeeded, `vite build` proceeded,
   and Vercel deployed a sitemap that had just dropped 1,500 URLs.
   Nobody on this team can read Vercel's build logs, so a console.warn reaches
   no one. A red deploy is the only signal that does. */
function fail(message: string): never {
  console.error(`\nSITEMAP BUILD FAILED: ${message}`);
  console.error('Refusing to write a partial sitemap. Fix the cause and rebuild.\n');
  process.exit(1);
}

/* PostgREST caps an unbounded select at 1,000 rows and returns 200 OK. An
   un-paged fetch therefore does not fail -- it silently truncates. That is how
   this sitemap came to advertise 1,000 of 1,282 papers and 250 of 273 schools
   while every build reported success, disproportionately dropping the undated
   English imports because they sort last.
   Commit ae42ce4 diagnosed and fixed exactly this in src/lib/question-bank.ts
   (fetchAllPages / fetchBankSchoolValues) and never touched this file. Same
   loop, same page size, kept here rather than imported because that module
   builds a browser Supabase client. */
const PAGE = 1000;

type Query = { range: (from: number, to: number) => Promise<{ data: unknown[] | null; error: { message: string } | null }> };

/* EVERY URL USED TO CARRY lastmod = TODAY.
   None of the queries even selected a date column; the build stamped its own
   run date onto all 1,830 entries. That tells Google the entire site changed
   on every deploy, which is not true and is not harmless: Google states it
   ignores lastmod values it finds unreliable, so the signal was being spent
   rather than used -- on a 1,830-page site whose pages freeze at build time
   and whose deploys are manual, which is exactly the situation the signal
   exists for. It also made the committed sitemap churn 3,660 lines on every
   build, which is noise in every diff and a hazard around `git add -A`.

   Now each entity page carries its row's own date. Neither table has an
   `updated_at`, so this is `created_at`: right for the many pages that have
   not changed since import, and understating for a teacher who later edits
   their profile. Understating is the safer error -- a date that is wrong in
   one direction for a few rows still leaves the field trustworthy, whereas
   "everything changed today" makes it worthless for all of them. Adding a real
   `updated_at` with a trigger is the proper fix and needs SQL; see
   docs/SUPABASE_RUNBOOK.md. */
function toDay(timestamp: string | null | undefined): string | null {
  if (!timestamp) return null;
  const day = String(timestamp).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

/** The newest date among a set of rows, for a hub page that lists them. */
function newestDay(days: (string | null)[], fallback: string): string {
  const real = days.filter((d): d is string => Boolean(d));
  return real.length ? real.reduce((a, b) => (a > b ? a : b)) : fallback;
}

async function fetchAllRows<T>(build: () => Query, label: string): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) fail(`${label}: ${error.message}`);
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

/**
 * Static pages with fixed URLs
 */
const STATIC_PAGES: Omit<SitemapURL, 'lastmod'>[] = [
  { loc: '/', changefreq: 'daily', priority: 1.0 },
  { loc: '/all-tuition-teachers-in-kolkata', changefreq: 'daily', priority: 0.9 },
  { loc: '/faq', changefreq: 'monthly', priority: 0.6 },
  { loc: '/join', changefreq: 'monthly', priority: 0.7 },
  /* '/join/apply' deliberately omitted: robots.txt disallows it, so listing it
     here produced a "Submitted URL blocked by robots.txt" warning in Search
     Console. Keep the two in agreement. */
  { loc: '/past-papers', changefreq: 'weekly', priority: 0.5 },
  { loc: '/privacy-policy', changefreq: 'yearly', priority: 0.3 },
  { loc: '/terms-of-service', changefreq: 'yearly', priority: 0.3 },
  { loc: '/recommend-teacher', changefreq: 'monthly', priority: 0.5 },
  /* /about and /more were internally linked but absent here. /contact was
     neither — grep found no `to="/contact"` anywhere in src/, so with zero
     inbound links and no sitemap entry it would effectively never be
     crawled, despite being a direct trust signal for a local-services site. */
  { loc: '/about', changefreq: 'monthly', priority: 0.6 },
  { loc: '/more', changefreq: 'monthly', priority: 0.4 },
  { loc: '/contact', changefreq: 'monthly', priority: 0.5 },
  /* Both added with their routes and linked from the footer / papers page, so
     they must be listed here too — an internally linked page absent from the
     sitemap is discoverable but slow to be recrawled. */
  { loc: '/submit-a-paper', changefreq: 'monthly', priority: 0.5 },
  /* Reading. The index plus one page per article, expanded from the same
     generated chapter stats the pages themselves render, so an article added
     by re-running generate-blog-stats is in the sitemap the next build without
     anyone remembering to list it. These change only when the bank does. */
  { loc: BLOG_PATH, changefreq: 'monthly', priority: 0.6 },
  ...BLOG_ARTICLES.map((a) => ({
    loc: `${BLOG_PATH}/${a.slug}`,
    changefreq: 'monthly' as const,
    priority: 0.5,
  })),
];

/**
 * Subject pages
 */
const SUBJECT_PAGES: Omit<SitemapURL, 'lastmod'>[] = [
  { loc: '/maths-tuition-teachers-in-kolkata', changefreq: 'weekly', priority: 0.8 },
  { loc: '/english-tuition-teachers-in-kolkata', changefreq: 'weekly', priority: 0.8 },
  { loc: '/science-tuition-teachers-in-kolkata', changefreq: 'weekly', priority: 0.8 },
  { loc: '/physics-tuition-teachers-in-kolkata', changefreq: 'weekly', priority: 0.8 },
  { loc: '/chemistry-tuition-teachers-in-kolkata', changefreq: 'weekly', priority: 0.8 },
  { loc: '/biology-tuition-teachers-in-kolkata', changefreq: 'weekly', priority: 0.8 },
  { loc: '/computer-tuition-teachers-in-kolkata', changefreq: 'weekly', priority: 0.7 },
  { loc: '/hindi-tuition-teachers-in-kolkata', changefreq: 'weekly', priority: 0.7 },
  { loc: '/bengali-tuition-teachers-in-kolkata', changefreq: 'weekly', priority: 0.7 },
  { loc: '/history-tuition-teachers-in-kolkata', changefreq: 'weekly', priority: 0.7 },
  { loc: '/geography-tuition-teachers-in-kolkata', changefreq: 'weekly', priority: 0.7 },
  { loc: '/economics-tuition-teachers-in-kolkata', changefreq: 'weekly', priority: 0.7 },
  { loc: '/accounts-tuition-teachers-in-kolkata', changefreq: 'weekly', priority: 0.7 },
  { loc: '/business-studies-tuition-teachers-in-kolkata', changefreq: 'weekly', priority: 0.7 },
  { loc: '/commerce-tuition-teachers-in-kolkata', changefreq: 'weekly', priority: 0.7 },
  { loc: '/commercial-studies-tuition-teachers-in-kolkata', changefreq: 'weekly', priority: 0.6 },
  { loc: '/psychology-tuition-teachers-in-kolkata', changefreq: 'weekly', priority: 0.6 },
  { loc: '/sociology-tuition-teachers-in-kolkata', changefreq: 'weekly', priority: 0.6 },
  { loc: '/political-science-tuition-teachers-in-kolkata', changefreq: 'weekly', priority: 0.6 },
  { loc: '/environmental-science-tuition-teachers-in-kolkata', changefreq: 'weekly', priority: 0.6 },
  { loc: '/drawing-tuition-teachers-in-kolkata', changefreq: 'weekly', priority: 0.6 },
  { loc: '/sat-tuition-teachers-in-kolkata', changefreq: 'weekly', priority: 0.7 },
  { loc: '/act-tuition-teachers-in-kolkata', changefreq: 'weekly', priority: 0.7 },
  { loc: '/cat-tuition-teachers-in-kolkata', changefreq: 'weekly', priority: 0.7 },
  { loc: '/nmat-tuition-teachers-in-kolkata', changefreq: 'weekly', priority: 0.6 },
  { loc: '/gmat-tuition-teachers-in-kolkata', changefreq: 'weekly', priority: 0.6 },
  { loc: '/ca-tuition-teachers-in-kolkata', changefreq: 'weekly', priority: 0.7 },
  { loc: '/cfa-tuition-teachers-in-kolkata', changefreq: 'weekly', priority: 0.6 },
  /* Both routes are live (App.tsx) with their own copy in SubjectPage.tsx and
     are linked from the footer, but were missing here — crawlable, yet given no
     sitemap signal. */
  { loc: '/clat-tuition-teachers-in-kolkata', changefreq: 'weekly', priority: 0.7 },
  { loc: '/social-studies-tuition-teachers-in-kolkata', changefreq: 'weekly', priority: 0.6 },
];

/**
 * Locality x subject pages. The list is written by generate-locality-pages.ts
 * (the step before this one in `prebuild`) from real teacher counts, so the
 * sitemap, the client routes and the prerender all name the same URLs.
 */
const LOCALITY_SITEMAP_PAGES: Omit<SitemapURL, 'lastmod'>[] = LOCALITY_PAGES.map((p) => ({
  loc: p.path,
  changefreq: 'weekly' as const,
  priority: 0.6,
}));

/**
 * Board pages
 */
const BOARD_PAGES: Omit<SitemapURL, 'lastmod'>[] = [
  /* Must match the route registered in App.tsx exactly. This was
     '/cbse-tuition-teachers-in-kolkata', which has no route and fell through to
     the catch-all 404 — a submitted sitemap URL that returned 404 to crawlers. */
  { loc: '/cbse-ncert-tuition-teachers-in-kolkata', changefreq: 'weekly', priority: 0.8 },
  { loc: '/icse-tuition-teachers-in-kolkata', changefreq: 'weekly', priority: 0.8 },
  { loc: '/igcse-tuition-teachers-in-kolkata', changefreq: 'weekly', priority: 0.7 },
  { loc: '/international-board-tuition-teachers-in-kolkata', changefreq: 'weekly', priority: 0.7 },
  { loc: '/state-board-tuition-teachers-in-kolkata', changefreq: 'weekly', priority: 0.7 },
];

/**
 * Fetch all approved teacher slugs from Supabase
 */
/**
 * /school/:slug pages are generated the same way teacher profiles are. They
 * existed and were linked from exactly one place (PastPapers.tsx), with no
 * sitemap entry at all — yet this is the URL shape that ranks for queries like
 * "la martiniere question paper", which SEO_STRATEGY.md names as the highest
 * value untapped pattern. There is no schools table, so the slugs are derived
 * from the papers rows, matching how SchoolPage.tsx resolves them.
 */
async function fetchSchoolSlugs(): Promise<SitemapURL[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    fail('Missing VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY (schools)');
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  {
    console.log('Fetching school data from Supabase...');
    const data = await fetchAllRows<{ school: string | null; created_at: string | null }>(
      () => supabase.from('papers').select('school, created_at').eq('is_published', true) as unknown as Query,
      'papers.school',
    );
    const currentDate = new Date().toISOString().split('T')[0];
    /* Dates collected per slug, not per source name: a hub page's real last
       change is the newest paper on it, and two spellings of one school are
       one page. */
    const daysBySlug = new Map<string, (string | null)[]>();
    for (const row of data || []) {
      const name = row.school;
      if (!name || !name.trim()) continue;
      const slug = schoolSlug(name);
      if (!slug) continue;
      daysBySlug.set(slug, [...(daysBySlug.get(slug) ?? []), toDay(row.created_at)]);
    }
    const urls: SitemapURL[] = [];
    for (const [slug, days] of daysBySlug) {
      urls.push({
        loc: `/school/${slug}`,
        changefreq: 'weekly',
        priority: 0.5,
        lastmod: newestDay(days, currentDate),
      });
    }
    console.log(`Found ${urls.length} schools`);
    return urls;
  }
}

async function fetchTeacherSlugs(): Promise<SitemapURL[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    fail('Missing VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY (teachers)');
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  {
    console.log('Fetching teacher data from Supabase...');

    const teachers = await fetchAllRows<{ slug: string; created_at: string | null }>(
      () => supabase.from('teachers_list').select('slug, created_at').order('name') as unknown as Query,
      'teachers_list',
    );

    /* Zero teachers means the query succeeded against the wrong project, or
       RLS changed, or the table is empty -- none of which should ship a
       sitemap missing every teacher profile. */
    if (teachers.length === 0) fail('teachers_list returned zero rows');

    const today = new Date().toISOString().split('T')[0];
    console.log(`Found ${teachers.length} teachers`);

    return teachers.map((teacher) => ({
      loc: `/tuition-teachers/${teacher.slug}`,
      lastmod: toDay(teacher.created_at) ?? today,
      changefreq: 'weekly' as const,
      priority: 0.7,
    }));
  }
}

/**
 * Generate sitemap XML
 */
function generateSitemapXML(urls: SitemapURL[]): string {
  const urlElements = urls
    .map(
      (url) => `  <url>
    <loc>${SITE_URL}${url.loc}</loc>
    <lastmod>${url.lastmod}</lastmod>
    <changefreq>${url.changefreq}</changefreq>
    <priority>${url.priority.toFixed(1)}</priority>
  </url>`
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml"
        xmlns:mobile="http://www.google.com/schemas/sitemap-mobile/1.0"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"
        xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
${urlElements}
</urlset>`;
}

/**
 * The question bank's own URLs.
 *
 * 193 paper pages, and the schools that exist only in the bank, are real,
 * linked, indexable pages and belong here. They are read from bank_papers,
 * which is where the bank lives — a sitemap built from a copy of the data
 * would start advertising URLs the app no longer serves the moment the two
 * diverged.
 *
 * has_school is the database's own answer to "is this a school page at all",
 * so board papers and unreadable school names are excluded at the query
 * rather than re-decided here.
 */
async function readBankURLs(currentDate: string): Promise<{ schools: SitemapURL[]; papers: SitemapURL[] }> {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    fail('Missing VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY (question bank)');
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const allRows = await fetchAllRows<{ id: string; school: string; has_school: boolean; created_at: string | null }>(
    () => supabase.from('bank_papers').select('id, school, has_school, created_at').eq('is_published', true).gt('question_count', 0) as unknown as Query,
    'bank_papers',
  );

  /* Row -> URL transformation (exclusion filtering, per-school slug dedup,
     paper/school counts) lives in ./sitemap-bank-urls.ts, tested directly
     against fixture rows in sitemap-bank-urls.test.ts. This function's own
     job is just the network fetch above. */
  const { schools, papers, skipped } = buildBankURLs(allRows, currentDate);
  if (skipped > 0) console.log(`   Skipped ${skipped} papers with placeholder question text`);
  return { schools, papers };
}

/**
 * Main execution
 */
async function main() {
  console.log('🚀 Starting sitemap generation...\n');

  const currentDate = new Date().toISOString().split('T')[0];

  // Fetch dynamic teacher pages
  const teacherPages = await fetchTeacherSlugs();
  const schoolPages = await fetchSchoolSlugs();
  const bankURLs = await readBankURLs(currentDate);

  // Combine all URLs. Deduped because a school with papers in both the table
  // and the bank is one page and must be listed once.
  /* Index and landing pages are assembled from the rows above, so the honest
     answer for "when did this last change" is when the newest of those rows
     arrived -- not when this script happened to run. On a build that adds no
     content, every date in the file now stays exactly where it was. */
  const contentDate = newestDay(
    [...teacherPages, ...schoolPages, ...bankURLs.schools, ...bankURLs.papers].map((u) => u.lastmod),
    currentDate,
  );

  const allURLs: SitemapURL[] = dedupeByLoc([
    ...STATIC_PAGES.map((url) => ({ ...url, lastmod: contentDate })),
    ...SUBJECT_PAGES.map((url) => ({ ...url, lastmod: contentDate })),
    ...BOARD_PAGES.map((url) => ({ ...url, lastmod: contentDate })),
    ...LOCALITY_SITEMAP_PAGES.map((url) => ({ ...url, lastmod: contentDate })),
    ...teacherPages,
    ...schoolPages,
    ...bankURLs.schools,
    ...bankURLs.papers,
  ]);

  console.log('\n📊 Sitemap Statistics:');
  console.log(`   Static pages:       ${STATIC_PAGES.length}`);
  console.log(`   Subject pages:      ${SUBJECT_PAGES.length}`);
  console.log(`   Board pages:        ${BOARD_PAGES.length}`);
  console.log(`   Locality pages:     ${LOCALITY_SITEMAP_PAGES.length}`);
  console.log(`   Teacher profiles:   ${teacherPages.length}`);
  console.log(`   School pages:       ${schoolPages.length} (table) + ${bankURLs.schools.length} (bank)`);
  console.log(`   Bank paper pages:   ${bankURLs.papers.length}`);
  console.log(`   ─────────────────────────────────`);
  console.log(`   Total URLs:         ${allURLs.length}`);

  /* A floor, not just a ceiling. The 50,000 check below guards a limit we are
     nowhere near; the failure that actually happened was the opposite one --
     shipping far too few URLs and reporting success. This is deliberately well
     under the real count (1,560+) so ordinary content changes never trip it,
     while a truncation or a silently-empty table still does. */
  const MIN_EXPECTED_URLS = 1200;
  if (allURLs.length < MIN_EXPECTED_URLS) {
    fail(`Only ${allURLs.length} URLs, expected at least ${MIN_EXPECTED_URLS}. `
      + 'Likely a truncated query or an unreachable table.');
  }

  if (allURLs.length > 50000) {
    console.warn('\n⚠️  WARNING: More than 50,000 URLs!');
    console.warn('   Consider implementing sitemap index for better performance.');
  }

  // Generate XML
  const sitemapXML = generateSitemapXML(allURLs);

  // Write to file
  try {
    fs.writeFileSync(OUTPUT_PATH, sitemapXML, 'utf-8');
    console.log(`\n✅ Sitemap generated successfully!`);
    console.log(`   Output: ${OUTPUT_PATH}`);
    console.log(`   Size: ${(sitemapXML.length / 1024).toFixed(2)} KB`);
  } catch (err) {
    console.error('\n❌ Failed to write sitemap file:', err);
    process.exit(1);
  }

  console.log('\n🎉 Done!\n');
}

// Run
main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
