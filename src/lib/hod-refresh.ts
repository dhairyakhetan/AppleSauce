import type { QueryClient } from '@tanstack/react-query';

/* After an HOD action, re-read only the lists that action can have changed.

   Before this, every action invalidated the whole ['hod', scope] tree. The strip of counts at the top is always
   on screen, so that re-read the desk counts (about 5 seconds on the database), the team (about 4.6 seconds) and
   every list on screen after every single tap. Now each kind of action names what it touches:

   - `now`: re-read straight away (these are on screen, or about to be).
   - `later`: mark out of date without reading; they are read the next time they are opened.

   A key is a prefix, so ['hod', scope, 'needs-you'] also covers each paper's own question list. */

export type HodChange =
  /** Give out, move, take back, hand out all free papers. */
  | 'assignments'
  /** Pass, send back, leave out, reopen or edit a question that was sent to the HOD. */
  | 'needs-you'
  /** Say yes or no to a student's "send back to the AI" request, from the Send to AI tab. */
  | 'ai-redo'
  /** Send a question, or a whole paper, to the AI from Needs you, or take that send back. */
  | 'send-to-ai'
  /** Send a paper back from Ready to the student checkers. */
  | 'send-back-checking'
  /** Approve a paper, edit its details or pictures on the approval sheet. */
  | 'publish'
  /** Hide, restore or edit a paper that is live. */
  | 'live'
  /** Accept or decline a student upload. */
  | 'uploads'
  /** Decide a bug or edit request, or raise one. */
  | 'requests'
  /** Edit a verifier's details or preferred subjects. */
  | 'verifiers';

type Key = readonly unknown[];

export interface HodRefreshPlan {
  now: Key[];
  later: Key[];
}

export function hodRefreshPlan(scope: string, change: HodChange): HodRefreshPlan {
  const k = (...rest: string[]): Key => ['hod', scope, ...rest];
  switch (change) {
    case 'assignments':
      return {
        now: [k('assignments'), k('unassigned'), k('held-back'), k('timeline')],
        // Names, grades and "last did something" do not change when a paper is given out.
        later: [k('team'), k('profiles'), k('activity')],
      };
    case 'needs-you':
      return {
        now: [k('needs-you'), k('ready'), k('trail'), k('counts'), k('timeline')],
        later: [k('assignments'), k('unassigned'), k('preview'), k('live'), k('ai-redo')],
      };
    case 'ai-redo':
      // A yes or no changes the Send to AI list (on screen) and the question's mark in Needs you; the counts move too.
      return {
        now: [k('ai-redo'), k('ai-redo-count'), k('counts')],
        later: [k('needs-you'), k('trail'), k('timeline')],
      };
    case 'send-to-ai':
      // The questions stay on the Needs you list (marked "needs AI review"); the Send to AI list and its number change.
      return {
        now: [k('needs-you'), k('ai-redo'), k('ai-redo-count'), k('counts')],
        later: [k('trail'), k('timeline')],
      };
    case 'send-back-checking':
      // The paper leaves Ready; its questions are open for the students, and it waits to be handed out.
      return {
        now: [k('ready'), k('trail'), k('counts'), k('preview'), k('timeline'), k('needs-you')],
        later: [k('assignments'), k('unassigned'), k('held-back'), k('unqueued'), k('live')],
      };
    case 'publish':
      return {
        now: [k('ready'), k('trail'), k('counts'), k('preview'), k('timeline')],
        later: [k('needs-you'), k('live'), k('assignments'), k('unassigned'), k('held-back'), k('unqueued')],
      };
    case 'live':
      return { now: [k('live'), k('counts'), k('timeline')], later: [k('history')] };
    case 'uploads':
      return { now: [k('uploads'), k('counts')], later: [] };
    case 'requests':
      return { now: [k('requests'), k('request-counts')], later: [] };
    case 'verifiers':
      // The team list (names, counts) does not change when details or subjects do.
      return { now: [k('profiles')], later: [k('team'), k('why'), k('unassigned')] };
  }
}

/**
 * Re-reads what `change` touches and marks the rest of that action's neighbours out of date.
 * `alreadyFresh` names lists the caller has just read itself (for example the read-back after a give-out), so
 * they are not read a second time straight after.
 */
export function refreshHod(qc: QueryClient, scope: string, change: HodChange, alreadyFresh: readonly string[] = []): void {
  const plan = hodRefreshPlan(scope, change);
  const wanted = (key: Key) => !alreadyFresh.includes(String(key[2]));
  for (const queryKey of plan.now.filter(wanted)) void qc.invalidateQueries({ queryKey: queryKey as unknown[] });
  for (const queryKey of plan.later.filter(wanted)) void qc.invalidateQueries({ queryKey: queryKey as unknown[], refetchType: 'none' });
}
