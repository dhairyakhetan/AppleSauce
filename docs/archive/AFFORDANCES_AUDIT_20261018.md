# Affordances audit, 18 October 2026

**What this is.** A hunt for information gaps: any place where a person does something and the screen does not say what happened, why a control is off, what comes next, or how to recover. Judged against `docs/CRAFT.md` section 4 (affordances) and 5 (flows).

**How it was done.** Three read-only Haiku auditors read the checker, the HOD desk plus Admin, and the public site, against the code as of `cf0b14f` (Undo last removed, Enter after a tile tap, enlarge icon moved, whole-page failure explained, HOD Move keeps its pick). They produced 72 candidate findings. Every one listed below as FIXED or OWNER was checked against the code by hand. Haiku over-reports, so several were dropped (see the end).

Status key: **FIXED** in this branch, **OWNER** needs a decision or a database/server change, **LATER** real but not yet done. The owner decisions are now recorded below.

## Top findings, ranked

| # | Surface | Gap | Status |
|---|---|---|---|
| 1 | Checker | Marks field with a non-number turned "Looks right" off and Enter did nothing, with only a red ring and no words | FIXED: message under the field, and the button's tooltip says why |
| 2 | Checker | "Looks right" or Save did nothing at all when the drafts belonged to a different question | FIXED: says the question changed and nothing was saved |
| 3 | Checker | No offline state anywhere in the checker | FIXED: a banner by the buttons says answers stay on the device and send on reconnect |
| 4 | Checker | Paper's question list failed to load with no retry, and blamed "not yours any more" for a plain network error | FIXED: Try again button, copy covers both causes |
| 5 | Checker | Looks right disabled for an empty question gave no reason on the button | FIXED: tooltip carries the reason |
| 6 | HOD | Any 42501 refusal showed raw server text or a generic line, so a non-HOD account could not tell it was a permission problem | FIXED: `errorWords` maps 42501 to a plain sentence |
| 7 | HOD | "Pass" greyed out for a blank question with no reason | FIXED: line under the buttons |
| 8 | Admin | Verifier Details opened a blank form when the profile load failed; Save would then overwrite real data with blanks | FIXED: the form is not opened, and a message says nothing was changed |
| 9 | Admin | Approve, reject application and remove verifier failures dropped the reason | FIXED: use `writeErrorWords` (handles 42501, 40001 and so on) |
| 10 | Public | Question report stayed on "Sending..." for ever if the network threw | FIXED: try/catch routes to the error state |
| 11 | Public | Search overlay could not recover if the index failed to load | FIXED: message and Try again button |
| 12 | Public | Google sign-in failure on both gate sheets was silent | FIXED: toast |
| 13 | Public | Past papers "Load more" failure was silent | FIXED: toast says results are still there |
| 14 | Public | Feedback "Send it" disabled with no hint | FIXED: line says to pick how it felt |

## Owner decisions, 18 October 2026 (asked and answered)

| Question | Answer | Result |
|---|---|---|
| Checker says "Saved." before the server confirms | Keep as is | No change. Offline banner and the not-saved chip cover failures. |
| WhatsApp lookup failed, parent sent to Shikshaq's number | Show error and retry | DONE. A failed lookup now shows "could not get the number" with Try again and nothing is recorded. A teacher with no number still opens Shikshaq support, and the screen says so. |
| Sign-in says "Invalid email or password" for everything | Add a confirm-email message | DONE. An unconfirmed email gets a standing panel with Send it again and Use a different email. Wrong password stays generic. |
| "Live and verified" pill and footer fallback claim | Keep | No change. |
| Sign-up success page | Build | DONE, in the Auth page itself (the existing SignUpSuccess page needs a signed-in user, and email sign-up has no session yet): a standing "Check your inbox" panel with resend, replacing the vanishing toast and cleared form. |
| Teacher application draft | Build | DONE. Kept in this browser tab only (sessionStorage, gone when the tab closes), restored on refresh, cleared on send. Consent is never restored. The page says so. |
| Auto assign all | Build a confirm | DONE. Asks "Hand out N free papers now?" first. |
| Smaller gaps | Do all | Mostly DONE, see below. |

Note on the draft: it includes the phone number and reference number typed into the form, held only in that tab. If you would rather those two fields are never stored, say so and they will be dropped from the draft.

## Smaller gaps, status after the second pass

DONE: checker next-question failure for an expired sign-in (Sign in again link), warn notices last 20 seconds instead of 8, the not-a-verifier page offers Browse past papers, a picture loader announces itself; HOD refusals say nothing was changed (verifier details, trust switch, add reviewer, publish), Publish says why it is off when the paper is not waiting, "Save, keep open" with no changes says so, Check again says it ran, undo failure also toasts, tab badges say when counts failed; Admin activity feed refusal, Verify-this-paper reason, conflict reload failure, and the four reviews failure toasts now give the reason; public: paper page and paper reader Try again, diagrams, teacher card photos and profile photos that fail to load fall back, recommend-a-teacher plain failure copy, saved pages keep the return path through sign-in, terms checkbox hint, pause button shows Saving, magic-link sent has resend and a spam note, copy-link failure shows the link, guardian dashboard turns Save off when its load failed, and a site-wide offline banner (the checker keeps its own).

THIRD PASS (owner said do all leftovers): Admin sign-out now stays on the page with a toast when sign-out fails; a failed saved-teachers load says so once instead of showing empty hearts; unknown HOD history actions say details are in the admin log; an upload file link that fails says to reload the list; the checker profile card shows a loading bar. Upvote counts needed no change: no screen displays them.

Left as is: "Load older feedback" retry (already a toast and the button stays), Uploads card error placement (the error is on the card; the list refresh can still move it).

## Auditor claims checked and dropped or softened

- "Split here is off with no reason": the split preview already says it.
- "Search stays on Searching forever": only true if the request throws; the fix handles that case, and a plain error still shows "no results".
- Findings about Undo last, Enter, the tile enlarge icon and Move refusals: already handled by `cf0b14f`, not counted.

## Checks run

`npx tsc -b` clean. `npx eslint .` 0 errors (212 existing warnings). `npx vitest run --dir src`: 2564 pass, 1 fails (`verifier-peek-migration.test.ts`), which compares SQL text and fails on this Windows checkout because the migration file has CRLF line endings; it reads a file this branch did not touch. Dummy-mode checker in the browser: the marks message, the disabled button's tooltip and the offline banner (and its removal on reconnect) were confirmed by reading the page. Screenshots timed out because the browser pane was hidden.
