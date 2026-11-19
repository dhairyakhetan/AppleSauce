# Design pass, 5 November 2026

Written for the owner. Plain words on purpose.

## What this is

Every page of the website was read through, one page at a time, against the 16 "Nudge" design principles (the `nudge`
skill you supplied) and the accessibility skill. Four helpers each took a group of pages. I checked their work, put it
together on one branch (`design-pass-2026-11-05`) and ran every check on the combined result:

- type check clean
- all 194 test files and 2,977 tests pass
- lint: 0 errors (219 old warnings were already there)

## The honest limit

**Nobody saw these pages drawn on a screen.** This was a careful read of the code, not a look at the site. Every change
is small and can be proven from the code (a missing label, an input too small for phones, a button nobody can reach with
a keyboard). Colour measurements are my arithmetic from the colour codes, not measured on screen. So please open a few
pages on your phone before or after merging. The list is at the bottom.

## What was changed (small, safe things only)

**Public pages (home, about, join, contact, help, FAQ, sign in, role picker, legal)**
- Four pages had no "main" landmark, so the skip-to-content link did nothing. Fixed.
- Teacher application form: pressing Enter on a subject chip jumped to the next step instead of selecting it, so a
  keyboard user could not choose subjects. The photo upload could not be reached by keyboard. Both fixed. Group labels
  added to the chip groups. Focus now moves to the new step heading.
- Sign in: error messages are now announced, tied to their fields, and readable (they were 2.7 to 1 on the dark panel;
  now 4.4 to 1).
- Home: section number "02" appeared twice; the last one is now "05" (checked: 04 exists as written text).
- About and Join: card titles are real headings now.
- Help and FAQ and legal pages: bigger clear-search button, no em dash in a message (your rule), contents list no longer
  cuts long titles. **No legal wording was changed anywhere.**

**Finding teachers and reading papers (browse, school, teacher profile, blog, recommend)**
- "All subjects" back link went to home; it now goes to the subjects page.
- Teacher profile: the "verified" shield is now read out loud; Save says whether it is pressed; loading is announced.
- Long school and paper lines wrap on phones instead of being cut off.
- Recommend a teacher: an empty name now shows its error on the field and moves focus there.
- Blog pages got the missing main landmark.

**Papers, account, dashboards, games**
- Teacher dashboard: the twelve form fields had their keyboard focus ring switched off; it is back. The profile photo
  upload is reachable by keyboard; the remove button has a name; five checkbox groups have names.
- Past papers: the search box is 16 px so iPhones do not zoom in. The subject/board switch no longer pretends to be tabs.
- Account: "Privacy and terms" is a real link; the grade box matches the others.
- Several pages now announce "Loading..." to screen readers. The upload-failed notice is announced.

**The internal tools (HOD desk and admin)**
- HOD "Needs you": if a question's picture lookup failed, the screen pulsed forever. It now opens the whole paper.
- Admin paper editor: one proper page title; the click-to-edit boxes now read out their value.
- About 40 form fields on HOD and admin screens are 16 px on phones (no iPhone zoom).

## One change I took back

The sign-in page hero: a helper raised the strength of the small grey-on-colour text for readability. The original
design handoff fixes those values exactly ("same hue at 60%") and it is the most visible page, so **I put the file back
exactly as it was** (zero difference). If you want the better contrast, the numbers are: orange 3.1 to 1, green 3.05,
indigo 3.5, mint 2.6; raising the text strength to 80 to 90 percent gets most of them above 4.5.

## Things I did NOT change (your calls)

1. **DONE on 6 Nov, at your word ("Darken it a little everywhere").** The three greys are now `#6F675F` (5.12 to 1 on
   the page), `#776F67` (4.55) and `#8A8279` (3.49). The smallest, lightest grey (uppercase labels) is only a small step
   darker, so it still sits a little under the usual bar. This reverses the old "do not darken" note in `src/index.css`,
   which was rewritten. Please look at a few pages on your phone; the whole site gets a touch darker.
2. **DONE on 6 Nov ("No, remove it").** The personal email was in the Grievance Officer block, which has to keep a
   contact. It now shows the NGO address instead. The name, phone and postal address there are unchanged.
3. **Teacher dashboard checkboxes are about 20 px tall** (fine for a mouse, small for thumbs). Making them 44 px would
   make the 33-subject list very long on phones.
4. **Tab bars on Account, Teacher review, Admin and HOD** do not respond to arrow keys. A small shared fix, not a page fix.
5. **Result counts are not announced** on the past-papers results and in-paper search.
6. **"Continue" on the role picker is greyed out with no reason stated.**
7. **The teacher application and sign-in screens use a fixed full-height layout.** On a short landscape phone or at 200%
   zoom the scrolling part may be tiny. Needs a real device.
8. **Shared pieces I was told not to touch:** the form label wraps badly on narrow screens (`ui/field.tsx`, `eyebrow.tsx`);
   filter sliders say "500", not "500 rupees"; the filter rail is marked as navigation.
9. **Wording that looks off but is yours:** About repeats "No commission..." twice; the recommend page says "Three
   fields" over five; My teachers says "No teachers yet" twice; the checker help line "Point at one, or tab to it"
   makes no sense on a phone.
10. **Dead code to tidy:** unused lines in About; two unrouted dashboard pages.

## A quick look worth doing on your phone (about 10 minutes)

Sign in, the teacher application (all five steps), a teacher profile, a school page, a blog article, the past-papers
search, and the Teacher dashboard. Look for anything that wraps oddly or overlaps.

## How to undo any of it

Every change is its own small commit. If anything looks wrong, tell me which page and I can revert just that commit.
