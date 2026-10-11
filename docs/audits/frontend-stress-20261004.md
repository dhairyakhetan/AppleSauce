# Front end stress test, 2026-10-04

Built (`npm run build`), served the dist on port 4180, walked routes at 375 (mobile preset,
`matchMedia` checked), 768 and 1440 (a Chrome devtools page at 1440, because the in-app pane tops
out near 750). Measured per route: horizontal page scroll, clipped or overflowing text, tap
targets under 40px (elements using `.tap-44` and inline prose links excluded), broken images,
unlabelled controls, half-pixel fonts, console errors and non-2xx requests (bodies read).
The test build carries the preview toggle and intent panel; both are compiled out of live and
were excluded from measurements.

Safety: no form was submitted, nobody signed in, nothing written to the live database.

## Routes covered

Home, teachers list, teacher profile, subject pages, board pages, past-papers library,
results, paper page (live paper, "coming soon" paper, unknown id, UUID id, bad id),
schools, school, subjects, blog, about, contact, faq, more, join, join/apply,
submit-a-paper, recommend-a-teacher, privacy, terms, 404, auth (signed-out gate states).
Result at all three widths: no horizontal page scroll, no broken images, no unlabelled controls,
no half-pixel font sizes, no console errors, no failed Supabase requests (other than the one
below), no dashes in site copy.

## Fixed

| # | Page / viewport | Problem | Fix |
|---|---|---|---|
| 1 | /past-papers/results, all | An unfiltered visit mounted all 1,506 bank papers at once: 31,132 DOM nodes, 195,000px of scroll, on a phone. | Render 48, "Show N more papers" button (44px). Readout still shows the true total. 31k nodes became 2.5k. |
| 2 | /schools, /past-papers, /school/:slug, paper "more papers", 375 | Long school and paper names cut with an ellipsis ("Assembly of Angels Seconda..."). | Wrap to two lines (`line-clamp-2 break-words`). |
| 3 | /past-papers recently-added covers, 375, 768, 1440 | Cover meta lines clipped ("Board · 11 questi..."), and the footer line rendered a bare "· 16 questions" when the title was empty. | Wrap, and join only the non-empty parts. |
| 4 | /past-papers/<garbage>, all | A malformed id reached the UUID reader, Postgres refused it (400, 22P02) and the page said "Unable to load, refresh", which can never work. | Only real UUIDs go to PaperReader; anything else gets the existing "could not find that paper" page with ways forward. |
| 5 | Papers-live announcement, auth hero, onboarding, product tour | Paper count printed as "1506" while the rest of the site prints "1,506". | `toLocaleString("en-IN")`. |
| 6 | Home, "continue where you left off" rows, 375 | Rows 38px tall. | `min-h-[44px]`. |

Commits: see the PR.

## Plumbing

- 195 `supabase.from` calls reviewed. Every `await supabase...` handles or inspects `error`
  except 15 that destructure only `data` (Index x3, Footer x2, TeacherDashboard x2, and one each in
  SchoolPage, TeacherProfile comments, PaperReader siblings, SelectRole, TeacherTermsAgreement,
  Browse subjects, useHelpTopics, GuardianDashboard). All degrade to an empty list rather than
  throwing; none show an error state. Listed for the owner, not changed.
- `select('*')` remains on: `page_content` (Footer, public), `subjects` (public), `teachers_list`
  (view, readable by anon, checked live), admin tables behind admin RLS (`teacher_applications`,
  `admin_audit_log`, `teacher_recommendations`, `teacher_upvote_stats`), and the two documented
  gated ones. No gated table is read with `*` from a public page.
- Live anon check: `bank_paper_questions` returns exactly 2 questions per paper, columns do not
  include `answer_key`, and the string is absent from the payload. Direct `bank_questions` read
  is refused (401, 42501). Unpublished/`needs_review` paper returns 0 rows and the page shows
  "coming soon".

## Round 2 (coordinator follow-ups)

| # | Item | Result |
|---|---|---|
| 1 | The 15 reads that ignored `error` | Shared pattern in `src/lib/load-error.ts`: `reportLoadError` (logs, one Retry toast per context per 30 s) for effects, `unwrap` for query functions. Footer x2, help topics, Browse subjects, PaperReader siblings, SelectRole, TeacherTermsAgreement, GuardianDashboard refresh, TeacherProfile (search markup only, logged not toasted) use it; Index quotes x3, SchoolPage and TeacherDashboard x2 now throw so the query reports `isError` (Index adds a Retry toast, SchoolPage's existing failed state engages). Tested in `load-error.test.ts`. |
| 2 | Contact form | Button reads "Open my email app", status says "Opening your email app. Nothing is sent until you press send there", toast "Opening your email app". No claim of sending. |
| 3 | Teacher-card name clip | Name lines use `overflow-wrap:anywhere` instead of a hard clip: a long word wraps instead of losing its ending. Measured at 375 on home: 48 name spans, 0 clipped. |
| 4 | First-visit pop-ups | `src/lib/first-visit-popup.ts`: the first of tour, papers-live announcement and copyright notice to ask gets the visit's slot (tab session); the rest wait for a later visit because their own seen flag is still unset. The notice asks immediately, the tour after 250 ms, the announcement after 900 ms, so on a paper page the notice wins. Dismiss behaviour is unchanged. Verified in the browser: tour alone on first visit, nothing stacked after dismissing it. Trade-off: a first-time reader who got the tour will not see the copyright notice until their next visit. |
| 5 | Blog en dashes | Not site copy. They are generated into `src/content/blog-stats.ts` from the bank's chapter values, so not changed here. Listed below. |
| 6 | Re-verify | Rebuilt and checked at 375 and 1440, screenshots in this folder: `results-show-more-375.png`, `results-show-more-1440.png`, `paper-covers-375.png`, `paper-covers-1440.png`. Results page: 48 cards, 1,489 DOM nodes, "Showing 48 of 1,506", 44px button, no horizontal scroll. Covers wrap with no clipped lines and no stray separator. (The rebuild used `vite build --outDir dist-verify` because Windows refused to empty `dist/past-papers`; the prerender step was not part of this check.) |

Chapter names with an en dash in the data (rename with an UPDATE to `bank_questions.chapter`,
then `npm run generate-blog-stats`): Ancient India (Early Vedic Age, Gupta Empire, Later Vedic
Age, Mauryan Empire), Elections (Election Commission), Medieval India (Delhi Sultanate, Mughal
Architecture, Mughals, Mughals and Akbar, Mughals and Aurangzeb, Sher Shah, South India). Each is
stored as "Topic, dash, Subtopic".

## Left for the owner

1. **"School not recorded"** is printed on many result cards (data: `bank_papers.school` empty).
2. **Blog chapter names with en dashes**: see the list above.
3. **Product-tour step dots** are 10px wide controls. Decorative-plus-navigation; left.
4. Stale-redirect behaviour: `/auth` shows the hero of whatever gate you last hit for five
   minutes (e.g. "Shikshaq admin"). By design (5 minute TTL), noted because it looks wrong when
   testing.

## Not reachable (signed out, no credentials entered)

Code and component tests reviewed instead; all 1,148 tests pass.

- `/account`, `/liked-teachers`, `/my-teachers`, `/dashboard/*`, `/select-role`,
  `/teacher-terms-agreement`, `/signup-success`: render the sign-in gate when signed out; the
  signed-in views were not seen.
- `/checker` (student checker): gate only. (The brief said `/check`; the route is `/checker`.)
- Every `/admin/*` route, including `/admin/library/:id`, `/admin/paper-approvals/:id`,
  `/admin/checker-log/:key` and the admin queue: gate only. `paper-approvals` was not touched
  (another agent owns it).
- `/join/apply` form fields past the signed-out gate, `/submit-a-paper` upload, and
  `/recommend-teacher` submit were not exercised because they write to the live database.
- Offline and Supabase-outage error states were not provoked; read in code only.
