# ShikshAQ Design Rebuild — Handoff

**Branch:** `feat/dual-search-past-papers`
**Status:** foundation, character pass, Wave 2 (token migration across all pages), and TWO
overnight "visual upgrade" passes are complete. The first pass was reviewed by the owner and
judged too light-touch (devices added but composed timidly, buried deep in pages, too much
wasted spacing); a second pass rebuilt the worst offender (past-papers page) directly, rebuilt
onboarding as a full-bleed dark carousel, did full top-to-bottom redesigns of Home/Browse/About/
Auth, and re-audited every page from the first pass against a higher, more literal bar. Real
bugs were found and fixed along the way (an N+1 query, sequential-query waterfalls, a footer
sticker clipping the mobile nav, a stray hardcoded hex, several TypeScript errors). Zero
TypeScript errors project-wide, zero new hardcoded hex colors anywhere in either pass. See
`VISUAL_UPGRADE_PLAN.md` for the full device-by-device mapping and both passes' findings.
**Date:** 2026-08-16

---

## 1. Why this work exists

The brief was that the design was "lacking, broken and random without intent."

**Root cause, measured:** all 43 files under `src/pages` and `src/components` hardcoded their
own hex colors. There were 33 bespoke animations, 27 of which nothing referenced. There was no
type scale and no spacing scale. Nothing enforced consistency, so every page drifted
independently.

A contributing cause was found later: the original design handoff
(`Shikshaq Search - Build Instructions.md`) explicitly mandated **"styling is inline only"**
and **"MUST NOT re-style with CSS classes or tokens files."** That made a shared token layer
forbidden, so every file re-declared its own values. The drift was the spec working as written.

---

## 2. Governing documents (read these first)

| File | Governs | Authority |
|---|---|---|
| `WAVE2_INSPO.md` | **Reference** — the 5 inspo screenshots from the 2026-08-14 session, saved as actual files in `docs/wave2-inspo/`, each with a written description and a note on what's already applied vs. still open. Read this before starting any Wave 2 task in §5. | Reference only, not a rule source |
| `DESIGN_SYSTEM.md` | **Rules** — tokens, scales, a11y, mobile model, QA | Wins on rules |
| `VISUAL_LANGUAGE.md` | **Look** — exact values from the client handoff | Wins on appearance |

Where they genuinely conflict: **stop and report, do not decide.** See `VISUAL_LANGUAGE.md` §0.

Source handoff (read-only, outside the repo):
`C:\Users\kanis\Downloads\Education website mockups-handoff\education-website-mockups\project\`
— contains `Shikshaq Prototype.dc.html`, `Shikshaq Past Papers.dc.html`, `Shikshaq Search.dc.html`,
the normative build-instructions doc, `screens/`, and `assets/` (logo SVG + three step images).

---

## 3. Owner decisions already made — do not re-litigate

| Decision | Ruling |
|---|---|
| Handoff vs contract authority | **Contract wins on rules; handoff is the visual reference.** Its inline-styles-only and no-CSS-classes mandates are VOID. |
| Scope | Full redesign, all non-admin pages. Admin pages excluded. |
| Logic | **Visual only** — no data fetching, Supabase, routing, or auth changes. Navigation restructuring was later approved as an exception. |
| Mobile | **"Mobile is the design"** — 375px is the primary canvas; app-style patterns. |
| Bottom nav | **Build it.** Four tabs: Home / Browse / Papers / Account. |
| Hero | **Search-first** — dominant search field plus quick chips. |
| Audiences | **Two, equal weight** — parents finding tutors, students finding papers. Home must fork them, not blur them. |
| Success action | **WhatsApp a teacher.** One primary action on every teacher surface. |
| Top bounce cause | **"Unclear what it is."** Must be answerable in 3s, above the fold, at 375px. |
| Color | **Full handoff palette** — saturated slabs, 8-subject system, dark footer. |
| Subject palette | Implement as a **token function**, not hardcoded triples. |
| Character devices | Stripe placeholders, tilted stickers, mixed-weight headlines, sparkles + blur-in hero — **all four approved.** |
| Hero stat cluster | **Build it, desktop only.** Mobile keeps the search-first stack. |
| Step images | Approved for use. Also approved: swap in the handoff logo SVG. |
| Conflicts | **Ask the owner each time.** Agents must not resolve conflicts themselves. |

### Accepted accessibility exceptions (owner-approved, twice raised, deliberately kept)
- White on brand orange `#FF8000` — **~2.1:1**, fails AA. Affects every primary button.
- Warm text scale: `#7B736B` (4.34:1), `#8B837A` (~3.5:1), `#A39A90` (~2.6:1).

These are recorded in `DESIGN_SYSTEM.md` §1 and in comments at the token definitions.
**Do not "fix" them.** Anything not on this list still must meet 4.5:1.

---

## 4. What is done

### Foundation (`tailwind.config.ts`, `src/index.css`, `src/lib/subject-palette.ts`)
- Brand tokens: `bg/text/border/ring-brand`, `-brand-blue`, `-brand-deep`, `-brand-blue-deep`,
  `-brand-subtle`, `-brand-blue-subtle`.
- Warm neutrals: `warm-page`, `-card`, `-muted`, `-band`, `-hairline`, `-hairline-raised`,
  `-hairline-strong`, `-prose`, plus `panel` (`#1B1A18`) and `mint` (`#E3F7EC`).
- Warm text scale: `text-warm-prose` / `-warm-secondary` / `-warm-meta` / `-warm-label`.
- Shadows: `shadow-border`, `shadow-border-hover`, `shadow-glow-brand`,
  `shadow-glow-brand-blue`, `shadow-card-bone`, `shadow-card-mint`.
- `rounded-4xl` = 32px for saturated slabs.
- `.stripe-placeholder` — the single definition of the diagonal-stripe missing-photo gradient.
- **Subject palette function:** `import { getSubjectPalette } from "@/lib/subject-palette"`
  → `{ tint, solid, text, meta, badgeText }`. All 32 generated hexes verified against the spec
  table. Alias matching handles the real (messy) data: case, punctuation, `&` vs `and`,
  comma-joined combos like `Physics,Chemistry,Biology`, `Computers` vs `computer science`.
  Mirrors the folding rules in `src/utils/subjectColors.ts` so the two cannot disagree.
  **Inline `style` with these values is the one sanctioned exception to the no-inline-style rule.**
- Animations: 27 unused ones deleted. Whitelist is `fade-slide-up`, `card-reveal`, `shimmer`,
  `accordion-down/up`, `route-fade`, plus `hero-swap`, `sparkle`, `fan-in`, `bob`.
- Ambient motion (`sparkle`, `bob`) is hard-disabled below `lg:` at the token layer, and
  `prefers-reduced-motion` kills everything. Both guards ship outside `@layer` so they cannot
  be purged.

### App shell
- `src/components/BottomNav.tsx` (new) — fixed mobile tab bar, `lg:hidden`, safe-area padding,
  role-aware Account tab reading `useAuth()` read-only.
- `src/App.tsx` — mounts BottomNav, adds `pb-20 lg:pb-0` at layout level.
- `Navbar.tsx` — `h-14` mobile bar + bottom sheet; full nav at `lg:`. All destinations preserved.
- `Footer.tsx` — token surfaces, `<details>` accordions on mobile, three CTA tiles.
- `Logo.tsx` — focus ring, `aria-label`, intrinsic dimensions.
- `Chatbot.tsx` — offset so the launcher clears the new tab bar on mobile.

### Primitives
`SearchControl`, `FilterChips`, `TeacherCard`, `SubjectCard`, `EmptyResults` rebuilt on tokens.
**All props APIs unchanged.** SearchControl's search/query/navigation logic is byte-identical —
presentation only. Its dropdown z-order was deliberately left untouched (documented stacking
hazard around `.route-fade` in `index.css`).

### Home page
`Index.tsx` rebuilt: search-first hero, two forked path tiles, proof strip, quick chips,
featured teachers, bento subject grid. `HowItWorks.tsx` is a snap-scroll carousel at 375px.
Verified live at 375×812: no horizontal overflow, one h1, hero fits the fold (chips bottom at
707px of 812), search field 56px / 16px font.

### Fixes applied directly
- Papers tile showed "0 papers, 0 schools" — zero now falls back to generic copy.
- Fork tiles were misaligned when one title wrapped — now a fixed three-row stack.
- `vite.config.ts` port is env-overridable so a second dev server can run alongside the first.

---

## 5. What is NOT done

### Done since the last handoff (2026-08-13 → 2026-08-14)

**Character pass (3 agents, ran directly against the main checkout — see the worktree note
below).** All landed and verified:
- **Home** (`Index.tsx`, `HowItWorks.tsx`): mixed-weight H1, desktop-only 2×2 stat cluster
  (fan-in/bob per the `index.css` DOM-structure comment), sparkles, blur-in entrance, saturated
  `rounded-4xl` slabs.
- **Primitives** (`TeacherCard`, `SubjectCard`, `PaperCard`, `FilterChips`, `EmptyResults`):
  subject-tinted cards via `getSubjectPalette`, `.stripe-placeholder` for missing photos, tilted
  "Featured" stickers, designed empty states. Note: the handoff's "FilterChips" is
  `src/components/FilterChips.tsx` (not `FilterPanel.tsx`, which is a separate older advanced
  filters sheet, untouched). `PaperCard.tsx` was migrated off the superseded
  `src/utils/subjectColors.ts` onto the canonical `src/lib/subject-palette.ts`.
- **Chrome** (`Navbar.tsx`, `Footer.tsx`): nav track dissolve past 48px scroll, active-tab
  orange nub, dark `#1B1A18` footer panel. Caught and fixed a real contrast bug in the process
  (brand-blue text on the new dark panel was ~3.2:1; swapped to `brand-blue-subtle`).

**⚠ Worktree isolation does not work on this branch.** The entire foundation (tokens,
`DESIGN_SYSTEM.md`, the rebuilt `Index.tsx`, etc.) exists only as **uncommitted** working-tree
state. A fresh `git worktree` only carries committed history, so it comes up empty — three
agents independently hit this and had to be relaunched to work directly against
`C:\Users\kanis\Shikshaq` instead. **Do not isolate agents in worktrees on this branch until
this work is committed.** Multiple agents can still safely work in parallel in the same
checkout as long as their file lists are disjoint.

**BottomNav rebuilt twice, per owner direction mid-session:**
1. First pass: warm-card bar with a scalloped orange notch lifting the active icon.
2. Replaced with: a dark (`bg-panel`) floating pill, detached from the screen edge, with an
   expand-on-select interaction — the active tab grows via a `flex-grow` transition to reveal
   its label next to the icon on a solid brand-orange background. No `framer-motion`/
   `usehooks-ts` — reimplemented with Tailwind/CSS transitions only, matching the rest of the
   codebase's no-animation-library convention.
3. **Superseded again, owner-approved, later session**: BottomNav and Navbar's desktop nav
   links were both replaced with a shared `src/components/ui/expandable-tabs.tsx` primitive
   (mobile bottom, desktop top), which *does* use `framer-motion` + `usehooks-ts` for the
   label-reveal animation and click-outside collapse. This is a deliberate reversal of point 2
   above, approved by the owner when asked directly — not a silent drift back to an animation
   library. It remains the only place in the codebase using either dependency; do not treat
   this as blanket permission to reach for framer-motion elsewhere.

**New feature — Recently Visited / Favourites on the home page** (owner-requested mid-session,
not in the original contract):
- `src/lib/recently-visited.ts` — device-local only (`localStorage`, capped at 8, deduped).
  **Not account-linked.** A fresh browser/device starts empty even for a signed-in user.
  Account-level sync would need a new Supabase table — deliberately out of scope, flagged for a
  separate decision if wanted.
- Wired via `recordVisit()` in `TeacherProfile.tsx` and `PaperReader.tsx`.
- Favourites reuses the **existing**, already account-linked `src/lib/likes-context.tsx`
  (Supabase + localStorage cache, same pattern as `LikedTeachers.tsx`) — nothing new to build
  there.
- New `src/components/HomeActivitySection.tsx`, inserted into `Index.tsx` right before
  "Featured teachers". Renders `null` entirely (skips both sub-sections) for a signed-out
  visitor with no visit history, rather than showing two empty states.

**Logo fix:** the mark is authored dark-on-transparent and was going invisible on the new dark
footer panel. Added an `onDark` prop to `Logo.tsx` (`brightness-0 invert` filter, forces solid
white) and applied it in `Footer.tsx`. The pre-existing `#FF8B16` vs brand `#FF8000` sparkle-dot
discrepancy noted in §6 is unchanged — still not resolved, still flagged, do not touch without
asking.

**Inspo images reviewed this session** (structural/pattern reference only — brand orange
`#FF8000` / blue `#4351FF` are locked regardless of what colors appear in any reference image;
this was an explicit owner instruction, treat it as durable):
- Course-app dashboard → informed the BottomNav rebuild above (dark floating pill, circular/pill
  active-tab highlight).
- Ruang Edit (design-class landing page) → reviewed against the finished Home agent output;
  sparkles/mixed-weight headline/saturated slabs/color-blocked cards already cover most of it.
  Deliberately did not add: an icon inline mid-headline (not in `VISUAL_LANGUAGE.md`, would be
  new unreviewed scope on an already-verified hero).
- Truus.co footer → reviewed against the finished Chrome agent output; added one tilted "Free"
  sticker badge to the Teachers CTA tile (reused the already-approved sticker pattern). Did
  *not* add a giant script wordmark — too large an addition to introduce unreviewed.
- Books-app shelf/filter-pill layout → relevant to the past-papers flow; logged against Wave 2
  (`PastPapers.tsx`/`PaperResults.tsx`), not yet applied — see below.

### Wave 2 — planned, not started

Was about to be launched as 6 parallel agents (directly against the main checkout, per the
worktree note above) when this session was interrupted to push and hand off instead:

| Agent | Owns |
|---|---|
| Browse | `Browse.tsx` (+ `FilterPanel.tsx` if in scope) |
| TeacherProfile | `TeacherProfile.tsx` — preserve the `recordVisit` call added this session |
| Past papers flow | `PastPapers.tsx`, `PaperResults.tsx`, `PaperReader.tsx` — pre-token legacy code (raw inline hex styles from the original build-instructions doc). Migrate onto the token system; apply the books-app shelf/filter-pill inspo where it fits. Preserve `recordVisit` in `PaperReader.tsx`. |
| Auth/Join flow | `Auth.tsx`, `Join.tsx`, `JoinApply.tsx`, `RecommendTeacher.tsx`, `TeacherTermsAgreement.tsx`, `SelectRole.tsx`, `SignUpSuccess.tsx` — visual only, no auth logic changes |
| Dashboards | `StudentDashboard.tsx`, `GuardianDashboard.tsx`, `TeacherDashboard.tsx`, `MyTeachers.tsx`, `LikedTeachers.tsx` — visual only. Admin pages stay excluded. |
| Legal/utility | `FAQ.tsx`, `Help.tsx`, `PrivacyPolicy.tsx`, `TermsOfService.tsx`, `NotFound.tsx`, `WhatsAppRedirect.tsx`, `BoardPage.tsx`, `SubjectPage.tsx` |

### Then
1. **Owner review of the home page** — the direction changed substantially after the handoff
   arrived; the last approval predates it. Also review the BottomNav rebuild and the new
   Recently Visited/Favourites feature specifically, since both were added mid-session beyond
   the original contract.
2. **Wave 2**, per the table above.
3. **QA pass** — `DESIGN_SYSTEM.md` §13, at 375/768/1280 in a real browser.

---

## 6. Open items and risks

- **Pre-existing typecheck failures block the contract's "tsc passes" bar.** 10 errors in
  `src/integrations/supabase/types.ts` (generated), `auth-context.tsx`, and four admin/dashboard
  pages. None are from this work; no design agent can fix them without touching off-limits
  files. **Needs a separate owner.**
  Correct command: `npx tsc --noEmit -p tsconfig.app.json` — plain `tsc --noEmit` is a silent
  no-op in this repo.
- **Subjects outside the eight seeds** (Sanskrit, Bengali, JEE) fall back to neutral grey and
  will read as the dull cards in a colorful grid. Add seeds if they are common in real data.
- **Past papers data appears empty** in the dev environment — the teachers count works, so
  Supabase is reachable. Owner said the data is genuinely not populated yet.
- **Logo SVG uses `#FF8B16`**, not brand `#FF8000`. Approved for use; the discrepancy was not
  resolved. Flag before editing the asset.
- **Step images** (`assets/step-01/02/03.jpg`) are dark, fisheye, saturated-green classroom
  renders. The handoff crops them to a 210px letterbox strip keeping only the chalkboard band,
  which defuses most of the darkness problem. They do not obviously communicate
  search → choose → contact; only step 3 reads as its step.
- **Handoff self-contradictions** — logged in `VISUAL_LANGUAGE.md` §0 with rulings. More may
  surface; route them to the owner rather than deciding.
- **Sub-44px targets remaining:** the logo (40px) and a "Read our full position" footer link (38px).
- Nothing is committed. The branch also carries unrelated pre-existing changes from earlier work.

---

## 7. Running and verifying

```bash
npm run dev
```

Port 8080 by default; set `PORT` to run a second instance. The Browser-pane preview could not
render screenshots in the last session (pane not displayed), so verification was done by direct
DOM measurement via injected JS — that approach works and is reliable for geometry, alignment,
overflow, and computed styles.

Verify at **375, 768, 1280**. The §13 checklist is the definition of done.
