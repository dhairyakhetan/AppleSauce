# ShikshAQ redesign — status, and what is still open

Branch `redesign/handoff-v1`, built against the Claude design handoff
(`Design Redesign & UX Audit (2)/` for docs and `.dc.html` frames,
`Design Redesign & UX Audit (3)/exports/` for the 61 rendered PNGs).

This file exists because the work is large and partly incomplete. Anyone picking
it up should read the "Still open" section first — several items were left
deliberately, with reasons, rather than half-done.

---

## Decisions that were made, and why

**City is Kolkata.** `copy.md` says "Ranchi" and "Lalpur" in a few places while
`design.md` says "Ballygunge"; the handoff contradicts itself. The codebase is
Kolkata in 353 places including all ~35 indexed route slugs, so Kolkata won and
copy strings were substituted. If ShikshAQ is genuinely moving city this needs
revisiting — but it is a business decision, not a code one.

**Pixel-exact over the token scale.** The owner chose to transcribe the mockups'
literal px via arbitrary Tailwind values rather than round to the
`1 2 3 4 6 8 12 16 20 24` scale that `tokens.md §5` and `design.md §0.2`
mandate. The costs were stated first: it breaks those rules and leaves no
spacing system for screens added later. Later screens should follow the mockups.

**Mockup wins over `design.md` on layout conflicts** — also the owner's call.
Three rules were held above the mockup anyway, and should stay that way:
nothing overlaps a teacher's face; every count is real or dropped; 44px tap
targets (grown via the `.tap-44` hit-area utility, not by resizing the design).

**Rebuild the view, keep the machinery.** Editing the old JSX kept producing
screens that still read as the old design, so pages had their render block
replaced while data fetching, state, handlers, routes and SEO stayed untouched.

---

## Data honesty — what is deliberately NOT shown

These come from the handoff's rule that every count shown is a real count. Each
was checked against `src/integrations/supabase/types.ts` before being dropped.

| Not shown | Why |
|---|---|
| Star rating on cards and profiles | `teacher_comments` has NO rating column. Open question O-02 is unresolved. Deriving one from upvotes would put a fabricated number against a named real person. `TeacherCard.rating` exists but no caller sets it. |
| Teacher-dashboard "profile views" / "WhatsApp taps" | No table records them; `WhatsAppRedirect` fires GA4/Clarity events only. O-04. |
| Papers streak pill, "12 new papers", "Most read" panel | No streak table, no per-user new-paper count, no view counter on `papers`. `GoalRing` is built and deliberately unwired. |
| Admin: approved-this-week, sent-back, contacted-this-month, reported, held-for-check, takedown-requests | No backing columns. |
| About's "2 min median reply time" | No backing query. |

If you later add any of these columns, the components are already built and
waiting — wire the data, do not invent it.

---

## Still open

### 1. `Browse.tsx` data layer — mechanics extracted, semantics still in place
**Partly done.** The paging and chunking mechanics now live in
`src/lib/teachers.ts` as `pageAllTeachers()` and `fetchShikshaqmineChunked()`,
along with the load-bearing `is_paused` whole-batch retry. Cache and staleness
are injected, so the helpers know nothing about Browse's cache-key scheme.

The filter semantics stayed in `Browse.tsx` exactly as the note below asks:
`filterShikshaqRecords`, `applyServerPrefilters` and `SHIKSHAQ_COLUMNS` are
`FilterState`-aware and are not generic lookups. `SHIKSHAQ_COLUMNS` is passed
*into* the helper rather than moved.

Verified by result-set identity, cold cache, before and after: 147 on the hub
with the same first five slugs in the same order, and maths 59, science 46,
commerce 29, english 41, bengali 4 all unchanged.

Original note, still true of what remains:


Roughly lines 860–1020. The unfiltered path pages `teachers_list` 500 rows at a
time up to 3000, then chunks slugs 50 at a time and fires ~60 parallel queries
at `Shikshaqmine` to stitch them in the browser. The filtered path does the
inverse.

Three separate attempts stopped here, for the same reason each time, and that
reason is worth respecting:
- `filterShikshaqRecords` has **three** call sites, not two — the filtered
  fetch, an empty-state diagnostic, and the `EmptyResults` chip-removal recount.
- `applyServerPrefilters` and `SHIKSHAQ_COLUMNS` are `FilterState`-aware, so
  they are not generic slug-lookup helpers and do not move cleanly into
  `src/lib/teachers.ts`.
- The per-chunk cache carries an `is_paused` retry fallback whose semantics are
  load-bearing.
- This file renders ~35 indexed SEO routes via `SubjectPage`/`BoardPage`, so a
  silent change to the result set or its order is an SEO regression, not just a
  bug.

A dedicated pass should: move only the paging/chunking mechanics into
`teachers.ts`, leave the filter semantics in `Browse.tsx`, and verify result
COUNTS before and after on at least two filter combinations plus a subject route.

### 2. Index coverage — checked, correct, nothing to do
Verified against what the app actually queries, so nobody spends a day on it:

| Query | Index |
|---|---|
| Browse's `order('is_featured').order('name')` | `idx_teachers_list_featured_name (is_featured, name)` — composite, matching order |
| `.in('Slug', chunk)` on Shikshaqmine | `idx_shikshaqmine_slug` |
| profile by slug | `teachers_list_slug_key` (unique) |
| likes / upvotes / comments by user and by teacher | indexed both ways, plus unique pairs |
| papers by board / class / school / subject / published | all indexed, plus trigram indexes for search |

Three indexes are technically redundant — `teachers_list_is_featured_idx` and
`idx_teachers_list_slug` are prefixes of, or duplicates of, better ones, and
`profiles_role_idx` duplicates the `(role, email)` composite. **Leave them.**
The largest of these tables is 377 rows and its entire index footprint is 120
kB; dropping them is a production change with no measurable benefit, which is
the definition of optimisation theatre. Revisit if a table passes six figures.

`papers` shows 10,250 index scans against 14 sequential — the paper queries are
using their indexes correctly even with the table empty.

### 3. react-query — fully adopted on the home route
**Done.** The landing query was migrated earlier; the three remaining bare
effects on `Index.tsx` (stats counts, recent papers, the student-quote rail)
are now `useQuery` too. Six requests used to fire on every mount with no cache
and no dedup, so returning home from a teacher profile re-ran all six.

Measured with `fetch` instrumented, first visit versus returning to `/` from
another route: **20 requests down to 10**, with `subjects`,
`teacher_upvote_stats`, `teacher_comments` and `public_profiles` all served from
cache on the second visit. The queries are unchanged; three `useState` hooks and
their setters disappear, because the value IS the query result rather than
something an effect copies into state.

Three keys rather than one, deliberately: they fail independently, and an empty
`papers` table should not cost the page its stats or its quotes.

Old note, no longer accurate:


`QueryClient` was configured app-wide but `useQuery` appeared in zero files.
`PastPapers.tsx` and `TeacherProfile.tsx` are migrated. `Index.tsx` is not — its
effect is ~180 lines with a stale-while-revalidate localStorage cache. Do not
delete `src/utils/cache.ts`; other call sites still use it.

### 4. No audit log exists
Mockup `admin-05-audit-log.png` shows a full page — actor, action, target,
reason, timestamp. Nothing in the schema records any of it. This is a new table
plus instrumentation on every admin mutation, not a UI task.

### 5. Two URLs serve one result set — canonicalised, taxonomy still open
**Half done.** `/commercial-studies-` now declares `/commerce-` as its
canonical, so the two stop competing for the same query. That is the standard
remedy for duplicate content and needed no product decision — it states what is
already true. Both URLs still work and both still serve 29 teachers.

**Taxonomy: settled — stay as one subject, canonicalised.** Splitting them was
considered and rejected on evidence: `select count(*) from "Shikshaqmine" where
"Subjects" ilike '%commercial studies%'` returns **0**. Not one of the 147
teachers lists Commercial Studies; all 29 list Commerce. So a literal split
produces an indexed page with no teachers on it.

The only real-world distinction available is that Commercial Studies is the ICSE
Class 9–10 name for the subject — scoping to ICSE + classes 9–10 yields 22
teachers against Commerce's 29, with 22 of them the same people. Two overlapping
views of one group is not two subjects, and would likely still read as duplicate
content.

Revisit only if teachers are ever tagged with the two subjects separately in
`Shikshaqmine`. At that point delete the entry in `src/lib/canonical.ts` and add
a distinct mapping in `src/utils/subjectMapping.ts` — both are one line.

Original note:


`/commerce-tuition-teachers-in-kolkata` and
`/commercial-studies-tuition-teachers-in-kolkata` both map to the filter value
`Commerce` in `src/utils/subjectMapping.ts` and return an **identical
29-teacher list in identical order** (verified against live data). Same pattern:
`Science` = `Physics,Chemistry,Biology`, `Social Studies` =
`History & Civics,Geography` — though those two do return distinct sets.

The prose now differs per route; the results do not. Options are differentiate,
canonicalise one to the other, or leave — see `docs/SEO_STRATEGY.md`. This is a
product decision.

### 6. Paper reader and gate — verified once, against seeded test data
The gate (`core-06-paper-gate.png`) and the reader route were verified by
inserting two clearly-marked throwaway rows into `papers`, checking the screens,
and deleting them again. `papers` is back to 0 rows; the deletion was confirmed
by re-querying.

What that proved: `/past-papers/:id` resolves and renders the paper's title,
school, board, class and exam type; the signed-out gate matches its mockup —
heading, sub-line, all three benefit lines, indigo Continue-with-Google,
copyright strip, blurred page behind; `/past-papers` swaps its "DAY ONE" empty
state for a real "2 past papers, free to read" and "From 1 school", correctly
singular; and `/past-papers/results?filter_classes=10` reports "1 paper found"
with the matching card. The count guards fixed earlier behave correctly in both
directions — suppressed at zero, present with data.

Still unverified: the reader's SIGNED-IN state, which needs a session. The gate
is what a signed-out visitor sees, and that is the state now checked.

One deliberate deviation confirmed as correct: the mockup's secondary button
reads "Use a phone number"; the build says "More ways to sign in", because phone
sign-in does not exist. The build is the honest label.

### 7. Screens not compared against their mockup
Most were. Not compared: the admin console frames (need an admin session), the
dashboards (need a session), the paper reader shell and gate, and the desktop
grid card stickers.

On the reader specifically: `select count(*) from papers` returns **0** — the
table is empty, not merely unpublished, and this is the live project, the only
one. So `/past-papers/:id` cannot resolve for anybody. Seeding rows to make the
screen render would put invented school papers in the production database, so
it was not done. Upload one real paper through `/admin/papers` and the reader
becomes verifiable in a minute.

Landmark audit, added after the fact: a sweep of 14 public routes at 390px and
1440px checked h1 count, heading skips, horizontal scroll **and `<main>`** —
the last of which earlier passes never checked. It found four legal/help routes
with no main landmark at all (shared shell), `RecommendTeacher` likewise, and
two sibling `<main>` elements plus an h1→h3 jump on `/join`. All fixed. Re-run
that sweep after adding a route; the check that catches this is cheap.

### 8. Legal copy has never been reviewed by a lawyer
Open question O-06. The operative clauses were restored after a rebuild
replaced them with the mockup's short summary copy — Terms and Privacy each
carry the plain-English answer AND the original clause beneath it. Both files
open with a `TODO(O-06)`.

### 9. Two nav items have no index page to point at
The desktop top bar carries "Subjects" and "Schools" per desktop-01-home.png,
but neither index exists as a route. They previously pointed at
`/maths-tuition-teachers-in-kolkata` and `/cbse-ncert-tuition-teachers-in-kolkata`
— one arbitrary subject, and a *board* page under a Schools label. Both now
point at the surface where the concept actually lives (browse hub, papers page),
which is honest but leaves "Subjects" sharing a destination with "Find
teachers". A subjects index and a schools index are the real fix;
`secondary-02-school-page.png` is the design for the latter and is unbuilt.

### 10. Verification documents (O-07)
The join form deliberately does not build the mockup's ID/degree upload block:
where those documents live, who can read them and what deletes them after a
decision is undecided.

---

## Traps worth knowing about

- **`cn()` silently dropped classes.** `tailwind-merge` does not know this
  project's custom fontSize keys, so `text-body-secondary` and friends were
  bucketed as text-*colour* and clobbered real colour utilities. Fixed in
  `src/lib/utils.ts` with `extendTailwindMerge`. **If you add a fontSize key to
  `tailwind.config.ts`, add it there too** or it will start eating colours.
- **`display:none` does not remove text** from `textContent` or the accessible
  name. Rendering two copies of a string and hiding one per breakpoint puts the
  duplicate in every search snippet — this happened on Contact's h1.
- **HMR goes stale** in this repo after concurrent edits. Restart the dev server
  before trusting a screenshot; several "defects" were stale modules.
- **Do not `git stash` or create a worktree** while other work is in flight. A
  stash once clobbered a whole rebuilt page (recovered from a dangling commit);
  a worktree once reset to a stale pre-redesign commit.
- **`spacing` sits under `extend`**, so the ten-step scale merges with
  Tailwind's defaults rather than replacing them. `h-11` (44px) depends on that.

---

## Verified state at time of writing

Typecheck (`npx tsc --noEmit -p tsconfig.app.json`) and `npm run build` both
clean. Across 11 routes at 390px: exactly one `h1` each, no heading-level skips,
exactly one `banner` landmark, zero horizontal scroll. Desktop 1440px: one top
bar, bottom nav correctly hidden.

Supabase: every `SECURITY DEFINER` function is `anon=false` except the six
sign-in helpers deliberately left open. Migration applied and verified against
`pg_proc.proacl`.

---

## Fidelity sweep — screens and rules compared

Mockups opened and compared against the running site, with defects fixed and
verified in the same pass. Roughly half the export set; what is missing and why
is at the bottom.

**Compared, defects fixed:** core-01 browse, core-02 filters, core-03 profile,
core-04 papers, desktop-01 home, desktop-04 papers, account-01 sign-in,
secondary-01 subject page, secondary-03 assistant, secondary-04 onboarding,
secondary-06 product tour, secondary-07 about, contact-01, join-01,
prefooter-01 to -04, legal-01 terms, legal-02 privacy, desktop-03 profile,
desktop-04 papers, micro-01 to -06, fun-01 sticker family, account-06 recommend,
secondary-05 success/hand-off, core-06 paper gate, contact-02 desktop,
reviews-01 desktop fan, admin-01 (statically).

**Deliberately not built, with the reasoning** — so these are not mistaken for
oversights and not added blindly:

- `account-08-help-faq-legal` shows a "Search help" field and audience tabs
  ("For guardians / For students / For teachers") on the FAQ shell. Neither is
  built. Search would filter eight questions that all fit on one screen, and the
  shell already carries an "ON THIS PAGE" contents list doing the same job. The
  tabs need every FAQ tagged by audience; `FAQ_ITEMS` has only `question` and
  `answer`, so adding them means inventing a taxonomy for eight items. Worth
  revisiting past roughly twenty questions — not before.
- `fun-03` specifies a reactive result count: "only the numeral animates — a
  150ms vertical roll per digit… the count turns brand-deep for one beat when it
  changes." The count updates correctly but does not animate. Left unbuilt
  rather than half-built: a partial motion spec reads worse than none, and a
  careless digit-roll is exactly the kind of thing that ends up firing on page
  load, which rule 7 forbids. Its pull-to-refresh half is not applicable to
  mobile web.

**Compared and found already correct, no change needed** — recorded so the same
ground is not re-walked:

- `contact-02-desktop` — hours, location, the orange band, the WhatsApp card at
  #25D366, email and location cards, "before you write", all four topic chips.
- `reviews-01-desktop-fan` — the section renders real reviews with a real count.
  Everything absent from it is absent on purpose and already documented: the
  4.9-star rating (no rating column, O-02), the derived tag chips
  ("Explains clearly 31") and "Read all 38" (no tag data to count). "Add your
  review" is the single CTA; "Sign in to leave a review" beside it is helper
  text, not a second button.
- `secondary-05` sign-up-success panel and the feedback sheet — both verified
  earlier; only its middle panel needed the coaching line.

**fun-01 sticker family — audited, all four rules hold.** Worth recording as
checked rather than assumed, since three of the four are the kind that rot
quietly as data grows: one sticker per card (no card carries two); never on a
result row (24 row-shaped browse cards, zero stickers); never on more than a
third of a grid (home featured grid runs 1 of 8, 13%); and Verified is a mark
beside the name, not a sticker — there is no "Verified" sticker text anywhere in
the DOM. Re-check the third rule if featured selection ever widens.

**The rules sheet was the highest-yield source.** micro-06 is not a screen, it
is seven rules, and auditing against it found four systemic violations spanning
many files that no single screen comparison would have surfaced:

| Rule | Outcome |
|---|---|
| 1 optimistic-first | already correct |
| 2 one motion per action | Button did colour + lift + shadow on one hover. Fixed; whole tree re-audited to zero. |
| 3 no springy overshoot | **Unresolved conflict.** `--ease-pop` is cubic-bezier(0.34, 1.56, 0.64, 1) — an overshoot — but tailwind.config.ts documents it as deliberate. Rules sheet and an earlier decision disagree; needs an owner, not a sweep. |
| 4 no browser alerts | 5 window.confirm calls. The public one (review delete) now uses AlertDialog. Four remain in admin: AdminComments:273, AdminFeedback:185, AdminPapers:274, AdminTeachers:556. |
| 5 failure + Retry | Retry added to retryable toggle failures. Reasoned, NOT observed — the path needs a session. |
| 6 hover desktop-only | Every Tailwind hover: emitted a bare :hover, which sticks after a tap on touch. Fixed globally via future.hoverOnlyWhenSupported; 75 of 76 :hover selectors in the built CSS now sit inside @media(hover:hover). |
| 7 no load animation | All 24 browse cards animated on load, most far off screen. Now the first row of three. |

**A recurring class of defect worth naming: counts.** Five surfaces printed a
zero or an invented number — "0 free papers" on sign-in, "0 past papers" in the
tour, an invented 846 plus two zero tiles on About, "0 verified teachers" under
"Why this list is trustworthy", "0 filters active" in the filter sheet. All came
from guarding on `!= null` or `!== undefined`, which asks "has it loaded" rather
than "is there anything to say". **Guard counts on `> 0`.** A search result
honestly reporting "0 papers found" is the exception — that is an answer to a
question, not a claim about the product.

**Link and anchor audit — clean.** Every internal `href` gathered by walking ten
routes (48 distinct non-teacher paths) resolves to a declared route in App.tsx,
parameterised ones included. All 190 sitemap URLs are routable. In-page anchors
resolve on both legal pages. The skip link was the only dead anchor on the site,
and it was on every page — fixed separately.

**`scrollWidth - clientWidth` is NOT "the page scrolls sideways".** This was the
overflow check used throughout the audit. It reads 0 on every route but `/`,
where it reports 66px — and on `/` the page still cannot be scrolled sideways at
all, because `html` carries `overflow-x: hidden`. The 66px came from a
`position: fixed` product-tour overlay left mounted from an earlier interaction.
Nothing was ever wrong, but the check is weaker than it sounds: the honest test
is `window.scrollTo(300, 0)` and then reading `window.scrollX`, which is what a
user can actually do.

**Verification traps hit six times.** Six apparent defects were artifacts of how
I looked, not of the build: PreFooter B2 "missing" (route still loading at
3.6s), B1 "missing" (searched "Shikshaq" against a sticker reading "ShikshAQ"),
the filter CTA "stuck" at the wrong count (it settles ~4s later), the papers
mode pill "transparent" (measured the inner truncate span, not the pill), and
thirty "unnamed controls" per page that turned out to be footer links inside a
COLLAPSED accordion — `innerText` is empty for hidden content while
`textContent` is not, which is the display:none trap listed below met from the
opposite direction, and it breaks any a11y scan that reads innerText as the
accessible name. A negative result needs a longer wait, a case-insensitive
match, a check that you measured the element you meant, and suspicion of
anything hidden. Six artifacts is a high enough rate to state plainly: on this
codebase, confirm a negative twice before acting on it.

**Also worth knowing:** comparing a component to its mockup proves nothing until
a route renders it. PreFooter B3 was matched to its mockup while mounted
nowhere; HowItWorks.tsx and Nudge.tsx were deleted for the same reason.

**Dev sandbox for the admin shell: `/__sandbox`.** The console is behind an
admin login, so its layout could never be looked at. `src/pages/Sandbox.tsx`
renders the shell components — rail, toolbar, stat cards, table — against fixed
mock props. It touches no Supabase, renders none of the real Admin* pages, and
is registered behind `import.meta.env.DEV`, so the route does not exist in a
production build (verified: the mock strings appear in no built chunk). It is a
component gallery, not a way past the admin gate.

It paid for itself immediately: every `/admin` route was rendering the public
marketing TopBar above its own rail, so the console carried two navigations
disagreeing about where you are, and started 68px down the page. `admin-01..05`
show no public nav at all. `/admin` and the sandbox are now chromeless like
`/auth` and `/select-role` already were.

**Gated screens — statically compared, since running them needs a session.**
Weaker than seeing them render, and not a substitute, but strong enough for
hardcoded strings and missing queries. It found one real defect: the admin rail
displayed the mockup's placeholder name "Sourav · owner" to every admin, sitting
directly under "Every approve, reject and edit is logged with your name" — and
contradicting the audit log, which records the real actor id. Fixed.

The rest of that sweep came back clean and is recorded so nobody repeats it:
no other mockup placeholder survives in any admin or dashboard file (no sample
applicant names, no "oldest is 2 days old" captions, no Ranchi-era areas); the
teacher dashboard's unbacked "Profile views" and "WhatsApp taps" tiles were
removed rather than faked, with the reasoning in-file; all three dashboards
handle their empty state with `ListEmpty`; and the `All {likedCount}` links are
gated on `hasMoreSavedTeachers`, so none can render "All 0".

**Audit coverage verified:** every mutating call in every Admin page is followed
by `recordAdminAction` — approvals, edits, inserts, deletes, publish toggles.
The one unaudited write is AdminPapers' revert-on-failure, which is a rollback
rather than an admin action. RLS on `admin_audit_log` is on with exactly two
policies, SELECT and INSERT, both admin-only: no UPDATE or DELETE policy exists
for anyone, so the log stays append-only as designed.

**How far the sandbox can go, and where it stops.** `/__sandbox` renders the
admin SHELL because those are pure presentational components taking props.
Extending it to the real `Admin*` and `*Dashboard` page components is possible
but was judged not worth it, and the reasoning matters if someone tries:

- those components fetch their own data and redirect signed-out users in an
  effect, so rendering them needs a fake session;
- `AuthContext` is not exported, so faking one means widening a production
  module's API purely to serve a test fixture;
- and the payoff is small — RLS still blocks anon reads, so they would render
  their EMPTY state, not the populated layout the mockups show.

Verifying the shell was worth a fixture. Verifying an empty state that code
review already confirms (`ListEmpty` is present in all three dashboards) is not.
Anyone with a real session should just sign in — five minutes there beats any
amount of scaffolding here.

**Not compared, and why:** the five admin frames and three dashboards need a
signed-in session; the paper reader, its gate and the school page need one real
row in `papers`; reviews R3 needs both. The remaining sheets (fun-01 to -05,
micro-01 to -05, feedback-01/03, baseline) are pattern references rather than
screens.
