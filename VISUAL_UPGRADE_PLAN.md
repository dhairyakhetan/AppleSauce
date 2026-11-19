# Visual upgrade — overnight multi-agent plan

**Owner directive, verbatim intent:** the token system, brand colors, and fonts are correct and
done. What's still "boring and horrible" is the **UI — layout, composition, visual confidence**.
The job is to reverse-engineer the *layout DNA* of every reference image shared this session and
rebuild Shikshaq's actual page layouts around that same energy — same data, same objectives, same
colors (`#FF8000` / `#4351FF` / existing warm neutrals), same font (Geist) — but composed with
the boldness these references show. This is not a token pass. It's a layout pass.

Three more references arrived after `WAVE2_INSPO.md` was written (pasted inline again, no files
to save — described below). Read `WAVE2_INSPO.md` first for the original 5; this doc adds the
new 3 and maps **all 8** to concrete target files.

---

## New references (2026-08-16, no files — described only)

### `mobile-vibes-event-app` (3 phones: yellow/pink/green event-discovery app)
Big soft-organic blob shapes (rounded blobs, not just rounded rectangles) as background/card
decoration behind bold type. Cards overlap and peek out from behind each other at an angle
("Events with Friends" stack). A dark floating bottom nav with a **circular + button breaking
out of the bar's top edge**. Heavy, oversized display type ("Discover, Create, Enjoy" / "Activities
just for your taste") set in a tight, confident sans, mixing weights. Small circular icon-buttons
(back/search/notification) float over the hero rather than sitting in a flat nav bar. A
horizontal stat/detail panel ("Audience Flow") with a small inline sparkline-bar-chart.

### `first-time-popup-design` (5-screen dark onboarding carousel)
Full-bleed **dark** onboarding, not a light bottom sheet. Each screen: a large flat-color abstract
shape (arrow, swirl, leaf) as the hero graphic, bold 2-line headline below it, one-line grey
subtitle, pagination dots, a pill "Next →" / "Start →" button in a bright accent color. Toggle
switch top-center (dark/light mode toggle in the reference — not relevant to us, skip).

### `learning-education-squircles` (6 education-app screens)
The most directly relevant set — same "progress/learning" domain as us. Recurring devices:
- **Squircle stat tiles**: two side-by-side rounded-square cards, big number + label ("78 Lessons"
  / "43 Hours"), each a different flat color.
- **Circular progress ring** with a play button in the center, timestamp below (00:42/02:32).
- **Horizontal bar-chart mini-stat**: day-of-week bars (Mon–Fri) with one bar highlighted/
  hatched, a big percentage number above, "Weekly/Month" segmented toggle.
- **Rank/leaderboard rows**: numbered badge (#1/#2/#3 in medal colors), circular avatar stack,
  percentage, all on pill-shaped rows.
- **Segmented pill toggle** ("Weekly / Month", "Literature / Math / Bio...") as the dominant
  filter pattern, not dropdowns.
- The "Hello, Jacob" panel already logged as `03-course-app-bottomnav.png` in `WAVE2_INSPO.md`
  reappears here too — same source, already mapped to BottomNav.

---

## Full mapping: all 8 references → target files

| Reference | Devices to extract | Target files |
|---|---|---|
| `01-ruang-edit-landing.png` | Inline icon-pill mid-headline, scattered sparkles, 4-tile colorful icon row, highlighted-word-in-sentence | `src/pages/Index.tsx` (hero refinement pass — go further than the current mixed-weight H1) |
| `02-truus-footer.png` | Giant wordmark + tilted sticker cluster (partially done — wordmark shipped in Geist italic, one sticker shipped) | `src/components/Footer.tsx` (add 2–3 more tilted stickers around the wordmark, per the reference's cluster) |
| `03-course-app-bottomnav.png` | Dark floating nav (done via `ExpandableTabs`) | `src/components/BottomNav.tsx`, `src/components/Navbar.tsx` — verify desktop nav carries equivalent visual confidence, not just mobile |
| `04-monday-...favourites.png` | Card-stack preview (peeking card behind a fuller one), pagination dots | `src/components/HomeActivitySection.tsx` — Favourites section could show a stacked-card preview instead of a flat grid |
| `05-books-app-shelf.png` | Horizontal shelf carousel, filter pills w/ counts (done), bold numeric stat callout | `src/pages/PastPapers.tsx`, `src/pages/PaperResults.tsx` — add the horizontal-scroll shelf for "Recently added" (currently a static grid) |
| `mobile-vibes-event-app` | Organic blob shapes as decoration, overlapping angled card stack, floating circular icon-buttons over hero, breakout circular action button on nav | `src/pages/TeacherProfile.tsx` hero, `src/pages/Join.tsx`/`JoinApply.tsx` |
| `first-time-popup-design` | Full-bleed dark onboarding (vs. current light bottom sheet) | `src/components/OnboardingModal.tsx` — consider a bolder full-screen variant, or at minimum bigger/bolder icon treatment per step |
| `learning-education-squircles` | Squircle stat-tile pairs, circular progress ring, weekday bar-chart mini-stat, rank/leaderboard rows, segmented pill toggles | `src/pages/StudentDashboard.tsx`, `src/pages/GuardianDashboard.tsx`, `src/pages/TeacherDashboard.tsx` — these are stat-heavy pages that currently render as plain lists/tables; squircle tiles + bar-chart + segmented toggle are a direct fit |

**Locked, no exceptions:** brand orange `#FF8000`, brand blue `#4351FF`, existing warm-neutral
scale, Geist font. Every device above is a *shape/composition/motion* borrow, never a *color*
borrow. Subject tints continue to come from `getSubjectPalette` only.

**Scope override, owner call, 2026-08-16:** admin pages — previously excluded from the design
rebuild since the very first `HANDOFF.md` (§3, "Scope: ... Admin pages excluded") — are now
**included** for this overnight pass. Also included: fixing the 10 pre-existing TypeScript
errors that have been flagged as out-of-scope since the first handoff (`auth-context.tsx`,
`AdminApplications.tsx`, `AdminRecommendations.tsx`, `GuardianDashboard.tsx`,
`StudentDashboard.tsx`, `TeacherDashboard.tsx`). **Push cadence:** hold everything locally, one
final commit + push after the full pass and QA — not incremental.

---

## Execution — 6 parallel agents, disjoint files, working directly against the checkout

Same lesson as the character pass: **do not isolate in git worktrees** — this branch's state is
committed now (fast-forwarded to `0af1b1c`), so worktrees would actually work this time, but
there's no need to add that complexity when disjoint file lists already prevent collisions and
direct-checkout work has already proven reliable this session.

| # | Agent | Owns | Primary reference |
|---|---|---|---|
| 1 | Home hero + activity | `Index.tsx`, `HomeActivitySection.tsx`, `HomeGreeting.tsx` | 01, 04 |
| 2 | Nav chrome | `BottomNav.tsx`, `Navbar.tsx`, `ui/expandable-tabs.tsx` | 03, mobile-vibes |
| 3 | Footer | `Footer.tsx` | 02 |
| 4 | Past-papers flow | `PastPapers.tsx`, `PaperResults.tsx`, `PaperReader.tsx`, `PaperCard.tsx` | 05 |
| 5 | Dashboards | `StudentDashboard.tsx`, `GuardianDashboard.tsx`, `TeacherDashboard.tsx` | learning-squircles |
| 6 | Onboarding + profile/join hero | `OnboardingModal.tsx`, `TeacherProfile.tsx`, `Join.tsx`, `JoinApply.tsx` | first-time-popup, mobile-vibes |
| 7 | Admin pages (scope added 2026-08-16) | `AdminApplications.tsx`, `AdminRecommendations.tsx`, `AdminTeachers.tsx`, `AdminPapers.tsx`, `AdminComments.tsx`, `AdminFeedback.tsx`, `AdminUpvotes.tsx`, `AdminConsole.tsx` | learning-squircles (stat tiles, segmented toggles — admin is data-dense, same fit as dashboards) — also fix the `AdminApplications.tsx`/`AdminRecommendations.tsx` TS errors (`sir_maam`/`status` literal-type mismatches) while in these files |
| 8 | Pre-existing bugfix: `auth-context.tsx` | `src/lib/auth-context.tsx` only | n/a — isolated bugfix, not a visual task. `.catch()` on a non-Promise-typed `PromiseLike`; kept as its own single-file task since this is imported broadly and any mistake here is high-blast-radius |

**Note on task 5/26 (dashboards):** also fix the `GuardianDashboard.tsx`/`StudentDashboard.tsx`/
`TeacherDashboard.tsx` TS errors (`role` literal-type mismatch ×2, a `number`-vs-`string` arg
mismatch ×2) while already in those files for the visual pass — don't spin up a separate task
that would collide on the same files.

Each agent must: read `DESIGN_SYSTEM.md` + `VISUAL_LANGUAGE.md` + this doc's mapping row for its
own reference(s) first; make no data/auth/routing changes; verify visually at 375 and 1280 in the
Browser pane before reporting; run `npx tsc --noEmit -p tsconfig.app.json` and confirm no new
errors beyond the 10 pre-existing ones. Report conflicts rather than deciding them.

---

## Final phase — full-product reconciliation audit (owner directive, 2026-08-16, expanded)

After all 8 upgrade agents land, this is not just a visual spot-check. The owner explicitly
granted latitude to review the whole product with fresh eyes and fix what doesn't hold up —
"this is anyway gonna be your branch at the end... think about things from a fresh perspective."
That authority covers judgment calls on this audit's findings, not a blank check to redesign
arbitrarily — stay inside the locked colors/fonts and the established component patterns.

The audit covers, in order:

1. **Visual reconciliation** — do the 8 agents' independent passes actually feel like one
   product when navigated in sequence, or do some pages now look more "upgraded" than
   neighbors they link to? Fix jarring seams between an upgraded page and an untouched one it
   flows into.
2. **UX flow clarity** — walk the real user journeys end to end (find-a-teacher → profile →
   WhatsApp; find-a-paper → reader; sign-up → dashboard; teacher → join → apply) and confirm each
   step is obvious, nothing dead-ends, nothing requires backtracking to understand.
3. **Data connectivity** — grep for any UI element added or touched tonight that renders
   without a real data source behind it (a stat, a count, a list) — every number on screen must
   trace back to a real Supabase query or explicit, honest fallback copy, never a hardcoded
   placeholder left behind from scaffolding.
4. **Design intent + "exciting, not boring"** — the owner's original complaint. For each major
   page, ask: does this look like a considered decision, or does it look default? Cut anything
   that reads as filler rather than a deliberate device.
5. **Code-based performance** — bundle size sanity check (`npm run build`, look for any single
   chunk that ballooned unexpectedly from tonight's work), unnecessary re-renders introduced by
   new state/effects, images without lazy-loading where the existing pattern uses it elsewhere.
6. **Responsiveness** — every touched page at 375 / 768 / 1280 minimum, actually interacted
   with (click, scroll, open a modal), not just screenshotted statically.
7. **Regressions** — confirm nothing that worked before tonight broke (auth, routing, existing
   Supabase queries, the character-pass and Wave 2 work from earlier in this project).

More reference images may still arrive before this phase starts — fold them into the mapping
table above the same way as the existing 8 if they do; don't block the audit waiting for them if
they haven't shown up by the time all 8 upgrade agents finish.

---

## Second reference batch (2026-08-16, ~20 images, no accompanying text)

Most of this batch (nightclub/event flyers — Mershe, Classico, Coffee Rave; band/K-pop posters —
RIIZE; a furniture-brand poster — dröm; street-sign clipart; several graphic-design portfolio
title cards) is poster/flyer/branding work, not app UI — there's no page layout, data density, or
interaction pattern to reverse-engineer from a single static poster. Treating 20 posters as 20
target-mapped devices the way the first 8 were would be scope-inappropriate for a tuition
marketplace app. Not spawning dedicated agents for these. Instead, cataloging only the handful of
genuinely portable devices, to be applied opportunistically during the final audit phase
(the section directly above this one) wherever they fit a real page, not forced onto one:

- **Linkedist calendar/photo-collage** — tilted photo cards with a small hand-drawn-style arrow
  annotation and a pin/dot marker, scattered across a calendar-grid background. Portable idea:
  the tilted-card-with-annotation device could enhance `TeacherCard`'s "Featured" sticker
  treatment (already tilted) with a small connecting line/arrow to what it's flagging — minor,
  optional, only if it doesn't add visual noise.
- **"Chuckle" pitch deck** — bold oversized number stat blocks on solid color cards ("85%",
  "78%", "470"), a highlighted/underlined word inline within a sentence (already applied to
  Index.tsx's headline by the Home agent — this batch just reinforces that device is a good
  instinct, no new action needed).
- **"bitesized" burger site** — a wavy/scalloped divider between a colored band and the page
  background, a pill-shaped CTA button with a handwritten-style label. This app's `WaveDivider.tsx`
  component already exists (per the original foundation work) — **confirmed dead code**, grep
  shows zero imports anywhere else in `src/`. Delete it during the final audit's cleanup pass,
  or repurpose it for a real scalloped-divider moment if one of the redesigned pages wants it —
  don't leave it as unreferenced dead weight either way.
- **Connecting numbered steps** ("dröm" poster's copyright-circle numerals is unrelated, but the
  general idea of numbered-step connection) — already applied to `JoinApply.tsx`'s stepper rail
  by the onboarding agent tonight, no new action needed.

Everything else in this batch (nightclub color/typography, K-pop merch stickers, generic
portfolio title-card layouts) has no reusable device for this product — reviewed and
deliberately not applied.

---

## Final audit results (2026-08-16)

All 8 visual-upgrade agents completed (one dashboard agent and one home-hero agent each stalled
on the first attempt and were relaunched directly — see git history / task notes for detail, no
work was lost, both retries verified the final state cleanly). Audit findings:

- **Typecheck:** zero errors project-wide (all 10 pre-existing errors fixed tonight, per owner's
  scope-expansion call, on top of zero new errors from the visual work).
- **Build:** succeeds clean, bundle sizes grew proportionally to the new code (~1% on the main
  chunk, modest growth on the three dashboard chunks from the new stat tiles/rings) — nothing
  ballooned.
- **Color lock:** zero new hardcoded hex colors anywhere in the night's diff (grepped the full
  `git diff` against every touched file) — every agent stayed on tokens.
- **Data connectivity:** no fabricated stats found — agents that considered a device requiring
  data the app doesn't have (weekday bar-chart, leaderboard rows) correctly declined rather than
  inventing numbers.
- **Real bug found and fixed during audit:** the footer's new sticker cluster (`Footer.tsx`) had
  a bottom-anchored sticker sitting flush at its container's edge with no clearance, which
  visually clipped into the fixed mobile BottomNav pill. Fixed with `pb-6` on the wordmark
  wrapper and nudging the sticker from `bottom-0` to `bottom-2`. Verified fixed live at 375px.
- **Confirmed dead code, not removed:** `WaveDivider.tsx` — zero imports anywhere. Left in place
  since removing it wasn't blocking anything and is a trivial future cleanup, not a functional
  issue.
- **Live-verified pages:** Home (375/1280), Past papers (375/1280, no overflow), TeacherProfile
  (375, floating buttons don't compete with WhatsApp CTA) — all clean, zero console errors beyond
  one pre-existing unrelated `fetchPriority` casing warning.
- **Not live-verified (flagged for a real account check):** Student/Guardian/TeacherDashboard's
  new squircle tiles and completeness rings (agents used code review + temporarily-injected-then-
  reverted mock data, no test credentials available), and all 8 admin pages (no admin account
  available). Both flagged clearly by their respective agents and again here — do a real
  signed-in pass on these before considering the dashboards/admin work fully done.

---

## Second overnight pass (2026-08-16, same day — owner review + fixes)

The owner reviewed the first pass live and pushed back hard: devices were technically present
but composed too lightly, buried too deep in the page (past-papers specifically was called
"nothing like" its reference), and there was too much wasted spacing site-wide. This pass:

**Rebuilt directly by the orchestrator (not delegated):**
- `PastPapers.tsx` — added a `bg-gradient-to-b from-brand-blue-subtle to-background` hero band
  (recreates the reference's colored-header energy with locked tokens), moved the "Recently
  added" shelf to sit directly under the headline (was buried after two full-bleed colored
  slabs), consolidated two redundant stat devices into one, tightened `SECTION` from
  `py-16/20/24` to `py-8/10/12` (dense utility page, not a marketing page).
- `OnboardingModal.tsx` — full rebuild from a small dialog/bottom-sheet to a full-bleed
  `fixed inset-0` dark carousel per the "first-time-popup-design" reference: dominant flat-color
  organic shape per screen (not a small blob tucked behind a tiny icon), centered layout,
  full-width bright pill CTA. Also fixed a real bug in the process: the light-sheet version's
  "neutral" screen used a `bg-white/10` blob at `blur-md`, which on the dark panel read as a
  grey smudge rather than a shape (white loses almost all presence at 10% opacity there) — the
  full rebuild uses brand-tinted shapes at higher opacity throughout.

**8 parallel agents** — 4 full top-to-bottom redesigns (Home, Browse, About, Auth — About had
never been touched before and was still 100% raw inline hex) plus 4 re-audits of the first
pass's already-"completed" work (Footer+Nav, Dashboards+Admin+performance, TeacherProfile+Join,
PaperResults+PaperReader) against the same higher bar the PastPapers rebuild set. Every agent
was explicitly told to open and look at the actual reference image files, not just read
descriptions, and to judge the first pass critically rather than assume it was sufficient.

**Real bugs found and fixed along the way** (beyond the visual work):
- N+1 query in `AdminFeedback.tsx` (one profile fetch per row) → batched into one `.in()` query.
- Sequential (non-parallel) independent Supabase queries in `StudentDashboard.tsx` and
  `GuardianDashboard.tsx` → `Promise.all()`.
- Missing `loading="lazy"` on a `TeacherDashboard.tsx` image.
- A real §13 a11y/data-honesty violation in `About.tsx` (bare "0" instead of the em-dash
  fallback for a zero stat).
- A stray hardcoded hex in `AdminTeachers.tsx` → swapped for the existing `ACCENT_TOKENS`.
- `BottomNav` overlapping page content on `Auth.tsx` at short viewport heights (no bottom
  clearance) — fixed as a byproduct of the spacing pass there.

**Documented but not fixed** (flagged for a human, not urgent enough for a same-night fix):
- `TeacherDashboard.tsx` fetches the signed-in user's profile row twice across two separate
  effects — redundant round-trip, left alone since combining touches auth-redirect timing that
  needs a real account to verify against.
- `AdminTeachers.tsx` has its own duplicate admin-check instead of using the shared
  `useAdminGuard` hook other admin pages use — not a bug, just inconsistent, worth consolidating.

**Infrastructure note:** attempted to set up a Supabase dev branch with seed data so data-
dependent sections (paper shelves, stat callouts) could be visually verified with real content
instead of guessing from empty states — blocked, branching requires the Pro plan and this
project isn't on it. Owner chose to continue without it; the safe workaround (inject mock data
client-side, screenshot, fully revert, confirm via `git diff` nothing debug-related remains) was
used throughout by every agent that needed to see a populated state.

**Verification, this pass:** typecheck zero errors, build succeeds clean, zero new hardcoded hex
anywhere in the diff (re-confirmed via full grep), zero leftover debug/mock markers in the
codebase. Browser-pane screenshot tool had intermittent rendering artifacts tonight (screenshots
occasionally showed cropped/cut-off content) — confirmed independently by at least 4 different
agents to be a tool-side capture bug, not real DOM state, by cross-checking with
`getBoundingClientRect()`/`elementFromPoint()` every time it happened. Trust the DOM checks over
a suspicious screenshot in this codebase's session history.

**Still not live-verified with a real account:** dashboards and admin pages (same limitation as
the first pass — no test credentials, no seed-data branch available). This is the one thing a
human still needs to do that no amount of further agent work can substitute for.
