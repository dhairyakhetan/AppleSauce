---
target: Home + PastPapers + Browse + TeacherProfile + Footer
total_score: 25
max_score: 40
na_heuristics: 
p0_count: 2
p1_count: 2
timestamp: 2026-08-16T07-02-16Z
slug: src-pages-index-tsx
---
Method: dual-agent (A: design-review · B: detector/browser-evidence)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Loading skeletons and honest "—" zero-fallback work well |
| 2 | Match System / Real World | 3 | Copy is plain, Kolkata-specific, good |
| 3 | User Control and Freedom | 3 | Back links, clearable filters present |
| 4 | Consistency and Standards | 1 | BottomNav active-tab color ignores page mode (orange on the blue-mode Papers page); PastPapers itself mixes orange hero + blue filter pills on one screen |
| 5 | Error Prevention | 3 | Standard patterns, no traps |
| 6 | Recognition Rather Than Recall | 3 | Clear nav labels |
| 7 | Flexibility and Efficiency | 2 | No saved search, limited recall |
| 8 | Aesthetic and Minimalist Design | 1 | TeacherProfile's ~12 unedited testimonials before the primary CTA; PastPapers stacks 3 redundant trust-copy sections saying the same thing |
| 9 | Error Recovery | 3 | EmptyResults component is genuinely designed |
| 10 | Help and Documentation | 3 | FAQ present, relevant |
| **Total** | | **25/40** | **Acceptable band, dragged down by two concrete, fixable defects** |

## Design Specificity Verdict

**Partially specific — the specificity lives in copy and data, not composition.** Strip "Kolkata," "WhatsApp," subject names out of the home page and what's left is a generic marketplace-landing skeleton: hero + search, two mode tiles, stat cluster, carousel, bento grid, three-step explainer, FAQ. The **subject-pastel card system** (8 real subjects, real counts, disciplined tint/solid/text/meta tokens) is the one place the product's actual content is doing non-swappable visual work. Everything else wears brand colors on a template.

Deterministic scan (Assessment B): CLI static detector returned zero findings (false negative — treat with suspicion). The **live DOM-rendered detector** found real, measured defects: 32 on Home, 19 on PastPapers, **45 on Browse**, 24 on TeacherProfile — contrast failures, extreme negative letter-spacing, icon-tile size drift (35px vs 40px for the same pattern between Home and PastPapers), clipped-overflow containers, all-caps body text runs, and one severe layout defect: **TeacherProfile's two-column grid has one column running 507% of viewport height against a sibling at 83%** — a real, broken asymmetry, not a taste call.

## Reference-Fidelity, Image by Image

- **01 Ruang-Edit landing** — mixed-weight headline + inline sparkle-pill: **present, genuinely well-executed**, the site's best evidence the references were absorbed. 4-tile subject icon row: present but desktop-only, buried after the stat cluster — the reference puts it right under the headline as an anchor; here it's an afterthought on a "mobile is the design" product.
- **02 Truus footer** — wordmark present at scale, but rendered in the same Geist Black as every other heading — the reference's power is the *typographic contrast* between clean nav and loose cursive wordmark; here there is none. Stickers present and technically correct but generic ("Verified", "0% fee") vs. the reference's characterful icons.
- **03 course-app bottom nav** — dark floating pill: solid on mobile. **Real bug, confirmed live via screenshot**: the active tab renders brand-orange on `/past-papers` too, when VISUAL_LANGUAGE §2.2 assigns blue as the Papers-mode color. This is the exact "doesn't feel like one product" failure in the room.
- **04 monday favourites/recently-visited** — the stacked-card-with-pagination-dots device (built earlier tonight) **could not be verified live** — no test account, and logged-out correctly shows a sign-in prompt instead. Unconfirmed, not disproven.
- **05 books-app shelf** — **the single worst gap.** At 375px, scrolling the entire `/past-papers` page top to bottom shows zero paper covers, zero shelf carousel — because `recentPapers.length` is 0 in this dev environment (no seed data, a known limitation all session), and the shelf section is conditionally hidden when empty. The code exists; its entire payoff is invisible under real (empty-data) conditions. What a visitor sees instead: a hero, one giant orange slab of 12 class pills + 5 board pills as the *first* decision point (a direct ≤4-choices cognitive-load violation), then four redundant trust-copy cards repeating "it's free" three different ways. For a page whose whole job is "find a paper fast," there is no paper-shaped content anywhere on load.

## What's Working

1. Hero mixed-weight headline + inline sparkle badge — specific, well-executed, not swappable onto another product.
2. Subject-pastel token system — disciplined, consistently applied, the strongest piece of design-system craft on the site.
3. The two-path fork (teacher vs. papers) directly under the hero — correctly implements the contract's own information architecture.

## Priority Issues

**[P0] BottomNav ignores page mode color.** `/past-papers`'s active tab renders brand orange (teacher-mode) instead of blue (papers-mode per VISUAL_LANGUAGE §2.2). Confirmed live via screenshot. Directly undermines the one color-coded wayfinding cue the product's own contract requires. **Fix**: `/impeccable layout` or a direct patch to `BottomNav.tsx`/`expandable-tabs.tsx` to key the active-fill color off route mode, not a hardcoded brand constant.

**[P0] PastPapers shows no paper content on load, ever, in this environment.** The shelf/carousel device exists in code but is fully gated behind `recentPapers.length > 0`, which is 0 with no seed data. Real users may hit the same wall if papers genuinely aren't populated yet in production. **Fix**: either seed real data (blocked tonight — no Pro-plan branch) or design an honest, non-empty "coming soon" / "browse by subject instead" state for this exact condition, since right now the fallback is generic filter chrome, not a designed empty state. `/impeccable onboard` or `/impeccable layout`.

**[P1] TeacherProfile buries its one primary action (WhatsApp CTA) under ~12 unedited testimonials.** Contract explicitly says nothing should compete with this button; right now a wall of raw pasted text does, and wins. **Fix**: `/impeccable distill` — truncate to 3 with "show more," or restructure so the CTA is fixed/sticky above the fold regardless of scroll depth.

**[P1] TeacherProfile's two-column grid is structurally broken** — one column 507% of viewport height vs. a sibling at 83%. This reads as a real layout bug (likely an image-aspect or positioning issue), not a design opinion. **Fix**: direct investigation and patch, not a design pass.

**[P2] PastPapers' first decision point is 17 ungrouped pills** (12 classes + 5 boards) in one slab — a direct violation of the ≤4-choices-per-decision-point guidance. **Fix**: `/impeccable layout` — group into a segmented toggle or progressive disclosure.

**[P2] Sitewide contrast failures beyond the one documented/approved exception.** White-on-orange (~2.5:1) is already an owner-approved exception — do not touch. But the live detector also found white-on-green (~2.7-2.8:1) and white-on-blue (4.4:1, just under 4.5) failing on accent badges that are **not** on that approved list. **Fix**: `/impeccable audit` to enumerate every instance, then targeted contrast fixes only on the un-approved pairs.

**[P3] Footer wordmark has no typographic contrast with the rest of the page** (same Geist Black as headings) — reads as "big word," not "designed flourish" like the reference. **Fix**: `/impeccable typeset`.

## Persona Red Flags

**Jordan (confused first-timer parent)**: reaches a real teacher profile, trust signals look good (real photo, real subjects) — then must scroll past a dozen uncurated testimonials before finding the one button that matters. Very plausibly bounces first.

**Casey (distracted mobile user)**: opens Past Papers expecting speed, is shown 17 filter choices and zero visible papers, then four cards of trust copy before anything resembling content. Nothing rewards impatience here.

**Riley (stress-tester)**: the bottom-nav color bug is exactly what a stress-tester finds in the first two minutes — navigates to Papers, sees the "wrong" active-tab color, concludes the design system isn't actually enforced, distrusts the rest of the polish on sight.

## Minor Observations

- Icon-tile size drifts 35px→40px for the same subject-tile pattern between Home and PastPapers.
- Extreme negative letter-spacing (-0.06em) on multiple H1s — worth a second look at whether it's actually reading as confident or just cramped.
- Home's gap between the shortcut-chip row and the Favourites section at 1280px reads as an unintentional leftover, not a deliberate section break.
- Browse (`/all-tuition-teachers-in-kolkata`) — one of the two most-trafficked pages in the product — has **zero** reference devices applied and no shared spacing-rhythm constant at all (confirmed via source grep). It's the most generic-feeling page on the site.
- AquaTerra's own logo (blue/green globe) is the one place a non-brand color legitimately appears — a real brand-constraint exception, flagged for awareness not action.

## Questions to Consider

- When you said "doesn't look like my references" — is that reaction to the **Home page** (which has genuinely absorbed 2-3 real devices) or to **Past Papers / Browse / Teacher Profile**, where almost none of the reference language survived and where users actually spend most of a session? The evidence points to the second driving the complaint even when Home is what gets reviewed first.
- Is the empty Past Papers page (no seed data) something you've actually seen yourself, or were you judging from Home? If you haven't scrolled Past Papers on a fresh session, that's worth doing before any more code changes — it may explain a lot of the "boring" reaction on its own.
