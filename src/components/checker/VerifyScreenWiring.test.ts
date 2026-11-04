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
    expect(screen).toMatch(/await action\(\);\s+if \(dropDraftFor\) clearDraft\(scope, dropDraftFor\)/);
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
    // Only a crop with no verified page of its own gets the toggle, so it never sits beside "See the whole page".
    expect(screen).toContain('const paperToggle = Boolean(!pageToggle && hasCrop && !flipShown);');
    expect(screen).toContain('const pageTileOn = pageViewerOn || flipShown || paperOpen;');
    expect(screen).toContain("{showPaper ? 'Hide the whole paper' : 'See the whole paper'}");
    // Opened by the verifier, so the flip must not say "No page matched this question".
    expect(screen).toContain('title="The whole paper"');
    // A new question starts with it closed, like the whole page.
    expect(screen).toContain('setShowPaper(false);');
  });
});
