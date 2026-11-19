import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// There is no browser-like test environment in this project, so the React
// wiring that fixed the release-QA blockers is pinned by reading the source;
// the rules themselves are tested as plain functions in lib/checker-drafts.test.ts,
// and the key presses were also exercised in a real browser (dummy mode).

const screen = readFileSync(resolve(__dirname, './VerifyScreen.tsx'), 'utf8');

describe('verify screen wiring (QA 2026-10-11)', () => {
  it('finding 1: the key handler is added once and always reads the latest render', () => {
    expect(screen).toMatch(/const keyHandlerRef = useRef\(onKeyDown\)/);
    expect(screen).toMatch(/keyHandlerRef\.current = onKeyDown/);
    expect(screen).toMatch(/window\.addEventListener\('keydown', listener\)/);
    // no listener bound to a dependency list that left the drafts out
    expect(screen).not.toMatch(/question\?\.id, canPass, splitOffered, answered\.length\]/);
  });

  it('finding 1: the boxes are reset while the new question renders, not in a later effect', () => {
    expect(screen).toMatch(/if \(draftFor !== ownerNow\) \{\s+setDraftFor\(ownerNow\);/);
    expect(screen).toMatch(/draftsFor: draftFor/);
    // the old effect that reset the drafts one render late is gone
    expect(screen).not.toMatch(/setBodyDraft\(lost \?\? question\.body \?\? ''\);\s+setNumberDraft\(question\.display_number \?\? ''\);\s+setMarksDraft\(question\.marks != null \? String\(question\.marks\) : ''\);\s+setShowPage/);
  });

  it('finding 2: a save goes through planAnswer, which leaves untouched words out', () => {
    expect(screen).toContain('planAnswer(');
    expect(screen).not.toContain('stripLeadingNumberPrefix');
    expect(screen).toContain('plan.patch');
  });

  it('finding 7: a failed save shows next to the buttons, in the sticky footer', () => {
    const footer = screen.slice(screen.indexOf('Action footer'));
    expect(footer).toContain('data-testid="save-error"');
    expect(footer.indexOf('save-error')).toBeLessThan(footer.indexOf('{undoButton}'));
  });

  it('finding 8: typed work is autosaved, restored, and dropped only after a successful answer', () => {
    expect(screen).toContain('saveDraft(scope, question, now)');
    expect(screen).toContain('loadDraft(scope, question, lost)');
    expect(screen).toMatch(/await action\(\);\s+if \(dropDraft\) clearDraft\(scope, questionId\)/);
  });

  it('finding 20: a second click in the same tick does not send a second request', () => {
    expect(screen).toContain('if (busyRef.current) return false;');
  });

  it('finding 9: the page-flip counts as a picture for the guidance', () => {
    expect(screen).toContain('const canCompare = hasPicture || flipShown;');
    expect(screen).toContain('{ hasPicture: canCompare }');
  });

  it('finding 10: Fix it says the options cannot be changed, and who can', () => {
    expect(screen).toContain('You cannot change the options here. If one is wrong or missing, press Ask the HOD.');
  });

  it('a closed paper never sends a signed-in verifier to sign in again (Nov 2026)', () => {
    // Every read of the next question goes through nextLoadProblem; a paper that closed behind the
    // verifier answers 42501 "not assigned to you", which is not a sign-in problem.
    expect(screen).toContain('nextLoadProblem(questionQuery.error, questionQuery.data)');
    expect(screen).not.toMatch(/questionQuery\.error as \{ code\?: unknown \} \| null\)\?\.code === '42501'/);
    // "Sign in again" belongs only to the real refusal of the account.
    const signIn = screen.slice(screen.indexOf("nextProblem === 'no_access'"));
    expect(signIn.indexOf('Sign in again')).toBeGreaterThan(-1);
    expect(screen.slice(0, screen.indexOf("nextProblem === 'no_access'"))).not.toContain('Sign in again');
    // The old dead-end branch is gone: only nextIsError may reach an error screen.
    expect(screen).not.toMatch(/\) : questionQuery\.isError \? \(/);
  });

  it('a question with a crop but no verified page still opens the whole paper on a tap (Nov 2026, tracker #3)', () => {
    // A crop with no verified page of its own gets the toggle. So does a question whose verified page
    // could not be loaded (picture not stored): "See the whole page" must never be a dead end.
    expect(screen).toContain('const paperToggle = Boolean(hasCrop && !flipShown && (!pageToggle || pageUnavailable));');
    expect(screen).toContain('const pageTileOn = pageViewerOn || flipShown || paperOpen;');
    // pageUnavailable is read by paperToggle, so it must be declared first (a const is not usable before its line).
    expect(screen.indexOf('const pageUnavailable = Boolean(')).toBeGreaterThan(-1);
    expect(screen.indexOf('const pageUnavailable = Boolean(')).toBeLessThan(screen.indexOf('const paperToggle = Boolean('));
    // While the paper is open the frame header offers "Hide the whole paper", not the page button.
    expect(screen).toMatch(/headerExtra=\{\s+paperOpen\s+\? paperToggleButton\(/);
    // The note says what to do next.
    expect(screen).toContain('you can open the whole paper instead');
    expect(screen).toContain("{showPaper ? 'Hide the whole paper' : 'See the whole paper'}");
    // Opened by the verifier, so the flip must not say "No page matched this question".
    expect(screen).toContain('title="The whole paper"');
    // A new question starts with it closed, like the whole page.
    expect(screen).toContain('setShowPaper(false);');
  });
});

describe('verify screen faults fixed 5 Nov 2026', () => {
  it('fault 1: a refused verdict on a closed paper shows the paper-gone screen, not "check your internet"', () => {
    const load = screen.slice(screen.indexOf('async function loadNext('), screen.indexOf('function ackedVerdict('));
    // the catch keeps the error and classifies it with the shared helper
    expect(load).toMatch(/catch \(err\) \{/);
    expect(load).toContain('nextLoadProblem(err, qc.getQueryData(keyFor(inc)))');
    // the screen reads that kind before it falls back to the query's own error
    expect(screen).toMatch(/const nextProblem =\s+nextFailed && failedKind !== 'failed' \? failedKind : nextLoadProblem\(questionQuery\.error, questionQuery\.data\)/);
    // a refused verdict does not clear the typed Fix text (only an accepted one does)
    const rejected = screen.slice(screen.indexOf('function rejectedVerdict('), screen.indexOf('function retryNext('));
    expect(rejected).not.toContain('clearDraft');
  });

  it('fault 2: the reopen parameter leaves the URL once it has been taken', () => {
    const first = screen.slice(screen.indexOf('async function fetchFirstRow('), screen.indexOf('const questionQuery = useQuery'));
    expect(first).toContain('reopenOnce.current = null;');
    expect(first).toMatch(/if \(id\) \{\s+onReopenTaken\?\.\(\);/);
    const page = readFileSync(resolve(__dirname, '../../pages/Checker.tsx'), 'utf8');
    expect(page).toContain('onReopenTaken={() => setParams((p) => withoutReopen(p), { replace: true })}');
  });

  it('fault 3: Escape on unsaved edits asks twice, and the keys wait while the Menu is open', () => {
    const keys = screen.slice(screen.indexOf('function onKeyDown('), screen.indexOf('const keyHandlerRef'));
    expect(keys).toContain('if (submitting || tourOpen || lightbox || suspended) return;');
    expect(keys).toContain('escapeStep(unsavedEdit, escArmedRef.current, Date.now())');
    expect(keys).toContain('ESC_AGAIN_NOTICE');
    const page = readFileSync(resolve(__dirname, '../../pages/Checker.tsx'), 'utf8');
    // The Menu and the Report a problem box (which opens from it) both stop the keys.
    expect(page).toContain('suspended={menuOpen || reportView !== null}');
  });
});

describe('verify screen wiring (check and fix, Nov 2026)', () => {
  it('B: a refused verdict leaves the Undo list and holds Undo off until the next answer', () => {
    const rejected = screen.slice(screen.indexOf('function rejectedVerdict'), screen.indexOf('function retryNext'));
    expect(rejected).toContain('forgetAnswered(a, entry.questionId)');
    expect(rejected).toContain('setUndoHeld(true)');
    const submit = screen.slice(screen.indexOf('function submitVerdict'), screen.indexOf('const blank = '));
    expect(submit).toContain('recordAnswered(a, question.id, kind)');
    expect(submit).toContain('setUndoHeld(false)');
  });

  it('B: the Undo button, its key and the shortcuts list all read canUndo, not the visit list', () => {
    expect(screen).toContain('canUndoNow(answered, paperRow?.done, undoHeld)');
    expect(screen).toMatch(/disabled=\{submitting \|\| !canUndo\}/);
    expect(screen).toMatch(/action === 'undo' && canUndo/);
    expect(screen).not.toMatch(/answered\.length/);
  });

  it('C: skipping the last question sets skippedLastAt, and the finished screen asks skippedLeft first', () => {
    const acked = screen.slice(screen.indexOf('function ackedVerdict'), screen.indexOf('function rejectedVerdict'));
    expect(acked).toMatch(/!next && entry\.kind === 'skip'\) setSkippedLastAt\(ackAt\)/);
    expect(screen).toContain('!question && skippedLeft.show');
    // the list that has not arrived yet must not turn into "Paper finished" over a skip
    expect(screen).toMatch(/paperGate === 'loading' && !skippedLeft\.show/);
    expect(screen).toMatch(/paperGate === 'error' && !skippedLeft\.show/);
    expect(screen).toContain('listReadAt: papersQuery.dataUpdatedAt');
  });

  it('A and E: a refused fix and an answer from another tab keep the typed words on screen', () => {
    const rejected = screen.slice(screen.indexOf('function rejectedVerdict'), screen.indexOf('function retryNext'));
    expect(rejected).toContain('typedWordsOfVerdict(entry.kind, entry.payload)');
    expect(rejected).toContain('setLostWords(words)');
    expect(screen).toContain('data-testid="kept-words"');
    expect(screen).toContain('readOnly');
    expect(screen).toContain('mayBeMyOtherTabAnswering(event, question.id, userId)');
    const elsewhere = screen.slice(screen.indexOf('async function checkAnsweredElsewhere'), screen.indexOf('const refresh = () =>'));
    // the paper's own list is read before anyone is moved
    expect(elsewhere).toContain('api.paperQuestions(paperId)');
    expect(elsewhere).toContain('answeredElsewhere(row)');
    expect(elsewhere).toContain('setLostWords(typedWordsRef.current)');
  });
});
