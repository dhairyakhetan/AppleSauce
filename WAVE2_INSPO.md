# Wave 2 — reference material

Five inspo screenshots from the 2026-08-14 session now live in `docs/wave2-inspo/` (moved out
of `public/`, which is served as site static assets — wrong place for internal reference docs).
**Colors in all five are reference-only for layout/interaction patterns.** Brand orange
`#FF8000` and blue `#4351FF` are locked regardless of what hues appear in any inspo image — this
was an explicit, repeated owner instruction this session, treat it as durable across all of
Wave 2, not just what's already built.

---

## `01-ruang-edit-landing.png` — reviewed against Home agent output, mostly covered

Desktop-width design-class landing page, white background, purple accent. Bold mixed-weight
headline "Level Up Your / Design [pill-icon] with Our / Design Class" — the pill-icon is a small
rounded-rectangle orange badge containing a white sparkle icon, sitting inline mid-sentence.
Scattered purple sparkle decorations around the headline. Row of 4 rounded-square colorful icon
tiles with 3D illustrations. A card grid ("Our Class") with 3 sub-cards, one highlighted solid
purple. Centered testimonial block with a highlighted-color word inline.

**Reviewed against the finished Home agent output** — sparkles, mixed-weight headline, saturated
rounded slabs, and subject-tinted color-blocked cards (via `getSubjectPalette`) already cover
most of this independently. **Deliberately not applied**: the inline icon-pill sitting
mid-headline-text — not in `VISUAL_LANGUAGE.md`, would be new unreviewed scope on an
already-verified, owner-facing hero. Worth a specific ask if wanted (Home is done, not currently
in the Wave 2 table).

---

## `02-truus-footer.png` — reviewed against Chrome agent output, partially applied

Desktop-width agency footer on a periwinkle-blue page background. A saturated blue rounded card
with 3 columns (job posting / office address / contact + "send us a whatsapp*" line + social
icons). Below that, a huge script/cursive wordmark "truus" spanning the card width, in off-white,
with several tilted circular/blob sticker badges scattered across and overlapping the lettering
(smiley face, "BAM!" comic burst, heart, hand-heart gesture, camera-with-crown).

**Applied**: one tilted "Free" sticker badge on the Teachers CTA tile in `Footer.tsx`, reusing
the already-approved sticker pattern (same rotation/shadow treatment as `TeacherCard`'s
"Featured" badge). **Not applied**: the giant script wordmark spanning the footer, and a
prominent "send us a whatsapp" text CTA line (we currently only have a WhatsApp icon-button) —
both are larger additions than a footer touch-up; flag to the owner before adding, since a large
wordmark is new visual real estate not in `VISUAL_LANGUAGE.md`.

---

## `03-course-app-bottomnav.png` — this is the one that shaped BottomNav, already applied

Three mobile app screens side by side ("Hello, Jacob" progress-tracking app), warm cream/orange
background with star/swoosh decorations. Each phone shows a **dark, floating, rounded bottom
navigation bar**, detached from the screen edges with visible margin — 5 icon tabs, the active
one lifted on a **solid indigo/purple circular highlight**, the rest plain grey-white icons on
the dark ground. (Card content above the nav — progress stats, course tiles, bar charts — is not
what's relevant here; it's the nav bar treatment that mattered.)

**Already applied** to `src/components/BottomNav.tsx`: dark floating pill (`bg-panel`), detached
from screen edges. Adapted rather than copied 1:1 — instead of a static solid-circle highlight,
built an **expand-on-select** interaction where the active tab grows via a `flex-grow`
transition to reveal its label next to the icon, since our nav has only 4 destinations and can
afford the extra width a label needs (a 5-tab nav like this reference can't).

---

## `04-monday-recently-visited-favourites.png` — informed the home-page activity section, already applied

Mobile app screen (monday.com), warm off-white background. Top: logomark + wordmark, search/
add-person icon buttons. A large rounded indigo "My favorites" card with a stacked-card preview
and pagination dots. Below it, a white "Recently visited" card: plain list rows, each with a
small square thumbnail icon, title, subtitle ("Main workspace"), timestamp ("Changed an hour
ago"), and a star (filled/unfilled) on the right, divided by hairlines. A "Workspaces" pill row
below, with a floating indigo (+) action button overlapping it. **Note**: this screenshot's own
bottom nav is a plain light pill (Home/My work/Notifications/More, blue active icon+label on
white) — not dark, unlike `03-course-app-bottomnav.png`. Don't conflate the two; only image 03
is the BottomNav source.

**Already applied**: `src/components/HomeActivitySection.tsx` on the home page, built off this
card layout but simplified — icon-in-circle instead of a square thumbnail, no "changed X ago"
timestamp, no per-item star toggle (favouriting happens on the teacher's own profile/card, not
inline in this list). Worth a side-by-side compare if revisiting: could add the timestamp and
an inline unfavourite action to close the gap with this reference.

---

## `05-books-app-shelf.png` — logged for Wave 2 past-papers flow, not yet applied

Mobile library/reading-app screen, purple gradient header fading to white. Bold headline "You
Have 12 New Books Design". A section header "Design" + "‹ 16 books ›" pager. A **horizontal
shelf of book covers** sitting on a visible shelf-ledge line, drop-shadowed, angled as if
standing upright. Below: **filter pills with live counts** — "All 23" (selected, indigo bg +
count badge), "Design 10", "Fantasy 5", "Mystery 8" (unselected). A white card below with a
"Collections/Books" segmented toggle, a 2×2 grid of small book-cover thumbnails, and a **large
bold numeric stat "250"** with a small "Top" label beside it.

**Not yet applied** — logged against Wave 2's `PastPapers.tsx`/`PaperResults.tsx`/
`PaperReader.tsx` task. Relevant devices to extract when that agent runs:
- **(a)** horizontal-scroll paper-cover shelf for a subject/board — `PaperCard.tsx` already has
  subject-tinted styling and stickers from the Primitives pass, so this is a new horizontal-
  scroll *container* reusing the existing card, not a new card design.
- **(b)** filter chips showing live counts next to each label — check against
  `subjectCounts` state, which already exists in `PastPapers.tsx`.
- **(c)** a bold numeric stat callout style, similar to the "250 Top" treatment —
  `PastPapers.tsx` already has a "Browse all X papers →" line that could be restyled this way
  rather than adding a net-new element.

**Do not** adopt the purple/pink/olive palette shown — subject tints already come from
`getSubjectPalette`, brand orange/blue everywhere else, per the standing color-lock rule.

---

## How to use this on resume

Each Wave 2 task in the session's task list (`TaskList` tool, tasks #15–20 as of 2026-08-14) has
a one-line description of its file scope. Cross-reference against the relevant image above
before implementing — in most cases the finished character-pass work (subject-palette tinting,
sticker pattern, saturated slabs, dark-panel-safe tokens) already gives you the pieces; the job
is assembling them into these new page layouts, not inventing new visual language. Read
`DESIGN_SYSTEM.md` and `VISUAL_LANGUAGE.md` in full before starting any Wave 2 file, same as the
character-pass agents were briefed. Work directly against the checkout, not an isolated
worktree, until this commit and all following ones are in — worktrees only carry committed
history (see `HANDOFF.md` §5 for the incident this caused earlier in the session).
