# Craft guardrails

The bar every audit is judged against and every fix must meet. CLAUDE.md's
standing constraints still win where the two touch; this file is about
making the product feel **crafted, intentional, fast and fun**, not about
what it is allowed to do.

**The one sentence:** a Kolkata parent reaches the right teacher, and a
student reads the right paper, with the fewest taps, zero doubt, and a
little delight on the way.

---

## 1. Speed is a feature

| Budget | Target |
|---|---|
| Tap to visual response | < 100 ms (press state, route change starts) |
| Route switch, chunk already prefetched | next page's shell paints in < 150 ms |
| Skeleton to content | crossfade, never a jump; no layout shift (CLS ~0) |
| Repeat visit to a page | from cache, no skeleton at all |

- **Prefetch on intent.** Hover, focus or touchstart on a link warms that
  route's chunk and its first query (`src/lib/route-prefetch.ts`).
- **Skeletons are the final layout,** same boxes and radii, so content
  settles into them rather than pushing them.
- **Cache before network.** React Query `staleTime` and placeholder data
  for anything already seen; never re-skeleton data we already hold.
- **Nothing blocks the first paint** that is not on screen.

## 2. Motion: snappy, fluid, never in the way

- Interactions: 120 to 180 ms. Enter: 200 to 300 ms. Exits are softer and
  shorter than enters.
- Easing `cubic-bezier(0.2, 0, 0, 1)` for UI, springs with no bounce for
  anything spatial.
- Animate `opacity` and `transform` only. Never `transition: all`.
- Stagger list and card entrances around 30 to 50 ms each, capped so a
  long list is never slow to finish.
- Press: `scale(0.96)`. Hover lifts on cards are subtle (1 to 2 px, shadow).
- `prefers-reduced-motion`: keep the fades, drop the movement.
- **Fun, not noise.** Delight sits at moments of success: saving a
  teacher, first paper read, a search that finds results. Not on every
  element.

## 3. Visual system

- Radii only from the scale: 2, 6, 8, 10, 12, 14, 16, 18, 20, 24, 28, 30, 32.
  Nested corners are concentric: inner = outer minus inset.
- No half-pixel font sizes. Headings `text-wrap: balance`, body `pretty`.
- Dynamic numbers use `tabular-nums`.
- Shadows over hard borders for depth; one elevation language sitewide.
- Colour through tokens only. Tailwind `/opacity` does not work on
  `var(--x)` raw hex (CLAUDE.md).
- Same component, same look, on every page it appears (chips, cards,
  buttons, empty states, section headers).

## 4. Affordances

- Every interactive element has hover, focus-visible, pressed and
  disabled states, and a hit area of at least 40x40 px.
- Every async surface has four designed states: loading (skeleton),
  empty (says what to do next, with a button), error (says what happened,
  with a retry), and success.
- Links look like links; buttons look like buttons; nothing clickable is
  a bare `div`.
- Filters show what is applied and how to undo it, one tap each.

## 5. Flows (each must be short, obvious and recoverable)

1. **Parent:** search (subject, class, area) -> results -> profile -> WhatsApp.
2. **Student:** papers -> filter or search -> paper -> read two free ->
   sign in -> keep reading.
3. **Teacher:** join -> apply -> approval -> dashboard -> edit profile.
4. **Contributor:** submit a paper -> upload -> confirmation.
5. **Admin:** review queues with counts, one-tap actions, audit trail.

Back always returns you to where you were. Every dead end offers a way
forward.

## 6. Content

- Every number is live and true (`useSiteCounts`). No inflated claims, no
  "Kolkata schools" count (see the 2026-09-26 audit).
- Question text is never altered. No em or en dashes in site copy.
- Voice: warm, plain, local, short. Say what happens next.
- SEO: every route has its own title, description and canonical;
  prerendered pages match what React renders.

## 7. Stakeholders to audit as

Parent · student (ICSE, CBSE, ISC; Classes IV to XII) · teacher (applying,
live, paused) · paper contributor · admin · a school that set a paper ·
Google (crawl, prerender, schema) · a phone on patchy 4G · a screen-reader
user · a verifier (a student checking papers) · the HOD · a teacher reviewer
(approves, rejects and edits teachers without being an admin).

The verify flow is judged as a place a person works for an hour, on a phone as
well as a laptop. Mistakes must be cheap and say so in plain words:

- **Undo last** is always in reach, switched off only when there is nothing to
  take back, and a refusal says why in a sentence (it works for 30 minutes, on
  your own answers only).
- **Skip for later** is never refused, not even on the last question. A skipped
  question stays on its paper; the screen says how many are waiting and offers
  to go through them or move to another paper.
- **OR between two questions** has one obvious path for each case: Split at the
  OR when two questions are joined, and "This is just the OR" for a row that is
  only the word. The preview says the OR is left out.
- The help page, the first-visit tour and the practice round all teach these
  three, and the practice round stays local (no network, nothing saved).
- **Two sides that cannot be mixed up** (owner, 11 October 2026: "not clear as
  to which is the picture"). The typed words sit in a plain neutral card with the
  chip "Typed by the computer"; the printed paper sits in a brand-framed box with
  the chip "Photo of the printed paper". On a phone they are two big tabs, Typed
  and Printed (Typed first, and back on Typed for every new question, so the words being checked are never hidden), over the same question. Question number and marks
  are chips at the top of the typed card and become boxes in Fix mode.
- **The tools are in words, always visible**: Fix the words, Split into two
  questions, Edit a formula, This is just the OR, each with a one-line
  explanation on hover and focus (`src/lib/checker-tools.ts`, also on the Help page).
- **The box on the printed page is only drawn when it can be trusted**
  (`src/lib/checker-highlight.ts`): a verified page, a matched crop, a bbox that
  fits the page. Otherwise the page shows with no box and says nothing about one.
- **What the computer changed** and its first reading are shown only when the row
  has them (`raw_ocr`, `source.edit_log`); older rows show nothing extra.

## 8. The papers route (`/admin/pipeline`)

The owner's picture of where every paper is. `PipelineRoute.tsx` draws it from
one admin RPC, `admin_pipeline_route()`; the maths and the words are in
`src/lib/pipeline-route.ts`. The rules:

- **Numbers first, motion second.** Every stop is a real list item with its
  count as text; lanes, parcels, the dashed elbow and the live dot are
  `aria-hidden`. Under `prefers-reduced-motion` the parcels, the dash march,
  the ping and the number count all stop and the numbers stay.
- **Calm, and honest about flow.** A lane shows 1 to 4 parcels, crossing in 3
  to 7 seconds, scaled on a log of the count flowing in (`laneMotion`). Nothing
  flowing means a faint, still lane. Parcels animate `transform` and `opacity`
  only.
- **No layout shift.** A changed number counts to its new value
  (`tweenValue`); while it counts, the final number is laid invisibly in the
  same cell so the width never moves.
- **Never a false zero.** A payload that is not the route throws, so the page
  keeps the last numbers and says "Could not refresh, showing the last
  numbers." in a quiet status line. With nothing yet to show it is a plain
  error with Try again, never a row of zeros.
- **Refresh by itself.** Every 20 seconds while the tab is visible, nothing
  while it is hidden, straight away on return or focus, one read at a time
  (`createPoller`). "Updated 12 seconds ago" ticks on its own.
- **The siding never joins the counts.** Papers left out on purpose (the Maths
  hold) hang off the first stop with their own count. The desk, swarm and
  checker stops count papers already on the desk, so the stops are not meant to
  add up; the page says so.
- **Phone first.** One column, top to bottom, lanes between cards. Two rows of
  five from `lg`. No horizontal scroll at 375px.
- **A stop leads somewhere only if a list exists.** Filter stops open the paper
  list below (folded away until needed); the rest link to Checkers, Admin queue,
  Ready to go live or Library. A stop with no list has no link.

## Severity

- **P0**: broken, wrong or untrue (bug, false number, dead flow).
- **P1**: visibly unpolished or slow (layout shift, missing state, janky
  motion, inconsistent component).
- **P2**: delight and craft (micro-interactions, transitions, copy polish).
