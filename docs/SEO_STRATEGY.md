# ShikshAQ SEO Strategy

Prepared for: Sourav and Ankit
Scope: organic search growth on top of the existing 35-route SEO layer (subject/board pages,
`src/content/subject-seo.ts`, `src/utils/structuredDataGenerators.ts`, sitemap of 190 URLs)
Branch: redesign/handoff-v1 (strategy only, no code changes)

---

## 1. Where the traffic actually is

Three clusters, in order of what to build for first.

### A. Head terms (subject only, no locality)
"maths tuition kolkata", "physics tutor kolkata", "home tutor kolkata" — high volume, high
competition, mostly already targeted by the 30 subject routes and `/all-tuition-teachers-in-kolkata`.
Intent: broad discovery, often top-of-funnel. **Page: exists.** These pages are doing their job;
the lever left here is off-page (section 4) and structured data, not new pages.

### B. Subject x class x board long tail
"icse class 10 maths tutor kolkata", "cbse class 9 physics home tuition", "isc class 12 chemistry
tutor". Lower volume per term, high intent (a parent who knows the board and class is close to
contacting someone), low competition. Intent: transactional.
**Page: partially exists.** The subject pages carry board and class in body copy and FAQs
(`subject-seo.ts` already answers "is X different for ICSE vs CBSE" per subject) but there is no
URL or H1 that targets "ICSE Class 10 Maths" as its own unit, and the board pages
(`/{board}-tuition-teachers-in-kolkata`) don't cross with subject. Google can still rank the
subject page for these queries via the on-page FAQ content and the `class` filter, but there is no
dedicated landing page competing for the query as an exact match. Recommendation: don't build new
URLs for this tier — extend the FAQ and covers content per subject page to explicitly name every
combination of board x class band it teaches (largely already done), and make sure the class/board
filter state on subject pages is reflected in the URL query string so a filtered view is a
shareable, indexable-adjacent link. This is a content-depth fix, not a new-page fix.

### C. Locality long tail
"maths tutor in ballygunge", "home tuition salt lake", "tutor near jadavpur", "physics tutor new
town". This is the volume nobody is capturing. Intent: high — a parent naming their neighbourhood
is closer to messaging a teacher than one typing a bare subject term. **Page: does not exist.**
This is the single biggest gap and is addressed in full in section 2.

Priority order for the next 90 days: **C first, B as ongoing content maintenance, A is already
adequately served.**

---

## 2. The biggest structural opportunity: locality pages

### The trap
30 subjects x 10 localities (Ballygunge, Salt Lake, Behala, Jadavpur, Howrah, Dum Dum, Garia, New
Town, Tollygunge, Alipore) = 300 pages. Most of those combinations have close to zero search
volume ("environmental science tutor in dum dum" is not a query anyone types) and, worse, most of
them would return the same three or four teachers as the parent subject page filtered by area —
i.e. thin, duplicate-feeling content at scale. That is exactly the pattern Google's Helpful Content
system penalises, and it would dilute crawl budget and internal link equity across the site's 190
URLs for a marginal number of pages that actually rank.

### The recommendation: 8 pages, not 300
Build **locality pages, not subject-x-locality pages**: `/tuition-teachers-in-{locality}` for the
localities where there is real, distinguishable search volume and a real, distinguishable teacher
pool. That is a single new tier of roughly **8 pages**, not 80 or 300:

Ballygunge, Salt Lake, Jadavpur, Behala, New Town, Garia, Tollygunge, Alipore.

(Howrah and Dum Dum: hold. Howrah functions more like an adjacent city than a Kolkata locality in
search behaviour and in the existing LocalBusiness `areaServed` list it already sits alongside
Kolkata rather than nested under it — worth a standalone review, not folded into this launch. Dum
Dum has materially lower query volume than the other eight in every keyword tool check available
to a Kolkata tutoring category; don't build it until a locality already live shows it's earning
traffic, then reassess.)

Do **not** cross subject x locality into the URL. Instead, each locality page:
- Filters the same teacher pool by area (the data already supports an area/locality field per
  the teacher listing components), so it reuses existing filtering logic rather than inventing new
  matching logic.
- Carries unique prose the way `subject-seo.ts` does per subject: what tuition demand looks like
  in that specific neighbourhood (walk-to-home-tuition norms, which schools cluster there — e.g.
  La Martiniere and South Point notably serve the Ballygunge/Alipore catchment, which is also a
  natural bridge into the past-papers tier in section 3), 3-4 FAQ pairs, and internal links back
  to the 2-3 subject pages with the highest demand in that area.
- Handles the subject question with an **on-page subject filter, not a URL**. A visitor to
  `/tuition-teachers-in-ballygunge` who wants maths specifically filters in-page; that filtered
  state does not need or deserve its own crawlable URL at 300-page scale. If, after 90 days of
  data, two or three specific subject x locality pairs show real query volume in Search Console
  (most likely maths and physics, the two subjects parents search hardest by neighbourhood), build
  those specific pages one at a time as evidenced expansions, not as a blanket combinatorial tier.

### Interlinking
- Add a "Localities" row to the master `/all-tuition-teachers-in-kolkata` page and to each subject
  page's existing `internalLinks` array in `subject-seo.ts` (e.g. the Maths page should link to
  Ballygunge and Salt Lake, its two highest-demand areas).
- Each locality page links back to `/all-tuition-teachers-in-kolkata` and to the 2-3 subject pages
  most searched from that area.
- Update `generateBreadcrumbSchema` calls so locality pages sit as `Home > Localities > {area}`,
  matching the pattern boards and subjects already use in `structuredDataGenerators.ts`.
- Add all 8 URLs to `scripts/generate-sitemap.ts` (190 → 198 URLs).

**The number: build 8 locality pages. Do not build subject x locality pages until Search Console
data names the 2-3 pairs worth it.**

---

## 3. Past papers: per-school and per-subject-per-class tier

`/past-papers` is one page carrying all boards, subjects, classes and schools in a single browse
experience. Real queries are far more specific: "icse class 10 maths prelim paper 2024", "la
martiniere question paper", "south point school class 12 physics question paper". These are
high-intent, low-competition, and — unlike the tutor-directory queries — genuinely informational,
which is good for building topical authority and inbound links from school forums and parent
groups that a commercial tutor-matching page would never earn on its own.

### What the data already supports
`PastPapers.tsx` already queries the `papers` table with `school, subject, class, board, exam_type,
year, file_url` — every field needed for two new page tiers already exists in the schema. No new
data collection is required, only new routing and templating on top of what's already queried.

### Recommended tiers
1. **Per-school pages**: `/past-papers/{school-slug}` — e.g. `/past-papers/la-martiniere-for-boys`.
   One page per school that has a meaningful paper count (set a floor, e.g. 5+ published papers,
   so a school with two uploads doesn't get a near-empty page). This is the highest-value tier:
   "la martiniere question paper" is a real, recurring query pattern and a school-branded URL is
   exactly what ranks for it.
2. **Per-board-per-class-per-subject pages**: `/past-papers/{board}-class-{n}-{subject}` — e.g.
   `/past-papers/icse-class-10-maths`. This is the second tier, matching "icse class 10 maths
   prelim paper 2024" directly. Scope this to the boards actually represented (CBSE, ICSE, ISC, WB
   state board) x classes 9-12 x the handful of core subjects (maths, physics, chemistry, biology,
   English) — roughly 4 boards x 4 classes x 5 subjects = up to 80 combinations, but build only the
   ones with published papers behind them (query the `papers` table for actual populated
   combinations rather than pre-building empty shells — this avoids the same thin-page trap as
   section 2).

Both tiers should carry `year` as an in-page filter, not a separate URL — "icse class 10 maths
2024" and "icse class 10 maths 2023" should be one crawlable page with a year picker, not two
near-duplicate pages.

### Copyright framing
State plainly, once, in a footer note on `/past-papers` and on every per-school/per-subject page:
papers belong to the originating school; ShikshAQ hosts them for student revision only, not for
redistribution or commercial use, and any school can request removal. This is already implied by
the "Removed on request" empty-state copy seen in `PastPapers.tsx` — make it an explicit, visible
statement on every page in this tier, not just the top-level page, since each new URL is a new
entry point a school (or a search crawler assessing trust signals) might land on directly without
ever seeing the top-level page's framing.

### Schema
Apply `FAQSchema`/`generateFAQPageSchema` the same way subject pages do, with FAQs like "where can
I find [school] previous year question papers" and "are these papers official." For the paper
listing itself, a `CreativeWork` or `LearningResource`-typed entry per paper (title, educationalLevel,
about) is worth adding to `structuredDataGenerators.ts` as a new generator — nothing in the file
currently covers papers as an entity, only teachers and pages.

---

## 4. Cannibalisation decisions

All three pairs map to identical filter values in `src/utils/subjectMapping.ts` — confirmed by
reading the file: `'/commercial-studies-tuition-teachers-in-kolkata': 'Commerce'`,
`'/science-tuition-teachers-in-kolkata': 'Physics,Chemistry,Biology'`,
`'/social-studies-tuition-teachers-in-kolkata': 'History & Civics,Geography'`. Same result set,
different prose. Decisions:

**Commerce vs Commercial Studies — leave, do not canonicalise.**
The `subject-seo.ts` content for these two pages already differentiates by student age and board:
Commercial Studies is framed explicitly as ICSE Class 9-10, Commerce as the Class 11-12 stream
across boards. That's a real audience distinction even though the filter maps both to the same
underlying teacher tag. A Class 9 ICSE parent and a Class 11 commerce-stream parent are different
searchers with different intent, and merging the URLs would mean the FAQ answering "is Commercial
Studies the same as Commerce" (already written, already correct) has nowhere to live. Evidence that
would change this call: if Search Console shows near-identical query sets landing on both pages
(not just near-identical impressions) — that would mean the age/board distinction isn't actually
how people search, and canonicalising Commercial Studies → Commerce would then be correct.

**Science vs Physics/Chemistry/Biology — leave, do not canonicalise.**
Same logic, cleaner distinction: Science is explicitly Class 6-8 combined-subject search intent,
the three individual pages are explicitly Class 9-12 split-subject intent. The existing FAQ content
on the Science page ("should I look for a Science tutor or a Physics/Chemistry/Biology tutor")
already handles the overlap for users. No change needed. Evidence that would change this call: if
the majority of organic clicks to `/science-tuition-teachers-in-kolkata` are for Class 9+ queries
(check via the Search Console query-to-landing-page report filtered by that URL) — that would mean
the page is absorbing demand that belongs on the split-subject pages, and a stronger in-page
redirect prompt (not a URL merge) would be the fix, not cannibalisation resolution.

**Social Studies vs History & Civics + Geography — differentiate further, don't merge yet, but
watch this one.**
This pair is the weakest of the three: unlike Commerce/Commercial Studies (age split) or
Science/PCB (age split), History and Geography split from Social Studies at the *same* age (Class
10 to 11), driven by stream choice rather than age. That's a thinner distinction and more likely to
actually confuse both users and Google about which page to rank. Recommendation: keep three URLs
for now (the content is already written and differentiated reasonably well — see the existing FAQ
"what is the difference between this page and Social Studies tuition" on both History and
Geography), but this is the pair most likely to need consolidation if data doesn't support three
audiences. Evidence that would change this call: if Search Console shows `/social-studies-...`
getting materially fewer impressions than either History or Geography alone over a full quarter —
that would indicate the split isn't earning its keep and Social Studies should 301 into whichever
of History/Geography gets more of its residual traffic, with a canonical tag in the interim.

General rule applied across all three: none of these get merged on a hunch. The prose difference
already exists and is genuinely non-duplicate; the decision bar for touching any of them is
Search Console query-level evidence that users aren't actually distinguishing by the same logic the
copy assumes.

---

## 5. Measurement

Clarity and GA4 are wired; here's what to actually watch, not just what's available.

### GA4 — set up first
- **Landing page x organic sessions x conversion event**, segmented by the three tiers (subject
  pages, board pages, and once built, locality/paper pages). Conversion event = WhatsApp click-through
  (confirm this is already firing as a GA4 event off the teacher-contact CTA; if not, that is the
  single highest-priority instrumentation gap on the whole site — without it, none of this strategy
  can be scored).
- **Non-branded vs branded organic split.** "shikshaq" branded queries will inflate GA4's organic
  channel numbers and mask whether the SEO content layer is doing anything. Filter branded queries
  out of every report used to judge this strategy.

### Search Console — queries and pages to track first
- Query-level report filtered to `/{subject}-tuition-teachers-in-kolkata` for every subject page,
  watching specifically for locality terms already appearing in the query list (queries like "...in
  ballygunge" landing on a non-locality page is the strongest possible internal evidence the
  section 2 locality tier will work — check this before building, not just after).
- Impressions-but-low-CTR pages: any page with meaningful impressions and CTR under ~2% is a
  title/description problem, not a content problem — fix the meta tag before touching the content.
- Position 4-20 queries ("low-hanging fruit"): these are the queries GSC calls out on the Kolkata
  tutoring long tail already ranking but not on page 1. Pull this list monthly and feed it directly
  into which subject/locality page gets its FAQ or covers list extended next.

### Clarity
- Watch session recordings specifically on the new locality pages once built, and on `/past-papers`
  — the past-papers page mixes browse and search UX, so recordings are the fastest way to see if
  visitors from a "school name + question paper" search actually find the paper they came for
  or bounce off the general browse view.
- Rage clicks / dead clicks on the subject/board filter controls — since section 2's
  recommendation depends on in-page filtering (not new URLs) carrying the subject x locality
  intent, if Clarity shows people can't find or use that filter, the "don't build 300 pages"
  call gets weaker and should be revisited.

---

## 6. 90-day roadmap

### Weeks 1-2 — low effort, name-your-price impact
1. Confirm WhatsApp-click GA4 event is firing per teacher card / profile (effort: low if already
   wired, high-priority blocker if not — do this before anything else, since nothing downstream
   can be measured without it).
2. Pull Search Console query report per subject page; identify which locality terms are already
   surfacing on non-locality pages (effort: low, evidence-gathering for section 2 and 4).
3. Add the copyright/removal-on-request statement explicitly to every past-papers surface, not just
   the top-level page (effort: low, risk mitigation).
4. Add "Localities" internal link row to `/all-tuition-teachers-in-kolkata` and top 2-3 subject
   pages, pointing at placeholder anchors if the pages aren't live yet — cheap way to signal
   structure to Google early (effort: low).

### Weeks 3-6 — medium effort, the two structural bets
5. Build the 8 locality pages (section 2): content per the `subject-seo.ts` pattern, filtered
   teacher listing, breadcrumb + CollectionPage + FAQPage schema per the existing generators,
   added to sitemap (effort: medium — 8 pages of genuinely unique prose plus one new component,
   reusing all existing filtering/schema infrastructure).
6. Build the per-school past-papers tier for schools with 5+ published papers (section 3, tier 1)
   (effort: medium — routing plus one new schema generator; content is templated off existing
   `papers` table data, not hand-written).
7. Extend subject-page FAQ/covers content for the board x class long tail (section 1B) on the 5-8
   highest-traffic subject pages first (maths, physics, chemistry, English, science) (effort:
   low-medium, ongoing).

### Weeks 7-12 — measurement-gated expansion
8. Build the per-board-per-class-per-subject past-papers tier (section 3, tier 2), scoped only to
   combinations with actual published papers (effort: medium, data-gated).
9. Reassess Dum Dum and Howrah locality pages using traffic data from the 8 pages launched in
   weeks 3-6 (effort: low, decision only).
10. Reassess Social Studies vs History/Geography using a full quarter of Search Console data per
    section 4 (effort: low, decision only — may trigger a 301 + canonical, which is a follow-up
    engineering task outside this strategy doc).
11. If Search Console (from step 2 and ongoing monitoring) has named 2-3 specific subject x
    locality pairs with real volume, build those specific pages only (effort: low per page, strictly
    evidence-gated — do not build any subject x locality page without this data).

---

## Top three calls

1. **8 locality pages, not 300 subject x locality pages.** Ballygunge, Salt Lake, Jadavpur, Behala,
   New Town, Garia, Tollygunge, Alipore — each a standalone page with real prose and an in-page
   subject filter, not a URL. Expand into specific subject x locality URLs only where Search
   Console data names the pair.
2. **Past papers is the fastest topical-authority win on the site.** The `papers` table already has
   every field needed (school, board, class, subject, year); build the per-school tier first
   (highest, most specific search intent — "la martiniere question paper" is a real, ownable
   query), then the per-board-per-class-per-subject tier gated to combinations with real data.
3. **Leave Commerce/Commercial Studies and Science/PCB alone — they're genuinely differentiated by
   age and board already.** Social Studies vs History/Geography is the one cannibalisation pair
   actually worth watching; give it one full quarter of Search Console data before deciding whether
   to merge.
