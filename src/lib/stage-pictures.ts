/* Getting a picture the checkers kept onto the site, by itself (13 Nov 2026).

   Owner: "not on the site yet shouldnt happen if you are ready to shwo the clipping there then it can jkust show on
   the paper itself".

   A passed question's picture first sits in a private store. The publish checks want a public copy (the question's
   figure.path), and the database cannot copy storage files itself. So when an HOD opens a paper that is ready, this
   file does the copy from the HOD's own signed-in browser, one question at a time:
     1. list: which pictures still need a public copy (hod_unstaged_pictures, from the database)
     2. copy: download each private picture and add it to the public store at the exact path the database named
     3. confirm: tell the database the question's pictures are there (hod_confirm_staged_picture), which checks them
        and records the public path through the versioned path, so it shows in the question's history.
   The ops (list, copy, confirm) are passed in, so this logic is tested without a network.
   Nothing here edits a question's words. A question that fails is left as it was and the whole run says so. */

import { errorWords } from '@/lib/hod-publish';
import { SLOW_WORDS } from '@/lib/checker-timeout';

export interface StagePictureItem {
  question_id: string;
  question_version: number;
  /** The private picture to copy from (audit-figures bucket). */
  from_path: string;
  /** The public path to copy to (paper-figures bucket). */
  to_path: string;
  /** The question's first picture: its path is the one the question points at. */
  is_first: boolean;
}

export interface StageOps {
  /** The pictures still to copy. null when the server cannot say (the database change has not been pasted yet). */
  list(auditPaperId: string): Promise<StagePictureItem[] | null>;
  /** Copy one private picture to its public path. An "already there" answer counts as done. */
  copy(item: StagePictureItem): Promise<void>;
  /** Tell the database one question's pictures are on the site. */
  confirm(questionId: string, version: number): Promise<void>;
}

export type StageOutcome =
  | { kind: 'nothing' }
  | { kind: 'done'; staged: number }
  | { kind: 'unavailable' }
  | { kind: 'failed'; staged: number; left: number; message: string };

/** How many times the list is read again after a round that did not finish everything. */
export const STAGE_ROUNDS = 3;

export const STAGE_FAILED_WORDS = `Some pictures could not be copied to the site just now. ${SLOW_WORDS}`;

/** The list as one group per question, in the order the database sent them. */
export function groupByQuestion(items: StagePictureItem[]): StagePictureItem[][] {
  const groups = new Map<string, StagePictureItem[]>();
  for (const it of items) {
    const g = groups.get(it.question_id);
    if (g) g.push(it);
    else groups.set(it.question_id, [it]);
  }
  return [...groups.values()];
}

/** The count of questions that still wait for their picture to be copied, from a preview's questions. */
export function unstagedCount(
  questions: { state: string; has_picture: boolean; picture_staged: boolean; figure_path: string | null }[],
): number {
  return questions.filter((q) => q.state !== 'set_aside' && q.has_picture && !q.picture_staged && !q.figure_path).length;
}

/**
 * Copy every picture of the paper that is ready but not yet on the site. Never throws: a problem comes back as
 * `failed` with plain words. `unavailable` means the server cannot say (nothing is changed, and the old behaviour stands).
 */
export async function stagePictures(
  ops: StageOps,
  auditPaperId: string,
  onProgress?: (done: number, total: number) => void,
): Promise<StageOutcome> {
  let staged = 0;
  let message = STAGE_FAILED_WORDS;
  let left = 0;
  for (let round = 0; round < STAGE_ROUNDS; round++) {
    let items: StagePictureItem[] | null;
    try {
      items = await ops.list(auditPaperId);
    } catch (err) {
      return { kind: 'failed', staged, left: Math.max(left, 1), message: errorWords(err, STAGE_FAILED_WORDS) };
    }
    if (items === null) return staged > 0 ? { kind: 'done', staged } : { kind: 'unavailable' };
    if (items.length === 0) return staged > 0 ? { kind: 'done', staged } : { kind: 'nothing' };

    const groups = groupByQuestion(items);
    left = 0;
    let doneThisRound = 0;
    for (const group of groups) {
      try {
        for (const item of group) await ops.copy(item);
        await ops.confirm(group[0].question_id, group[0].question_version);
        staged += 1;
        doneThisRound += 1;
        onProgress?.(doneThisRound, groups.length);
      } catch (err) {
        left += 1;
        message = errorWords(err, STAGE_FAILED_WORDS);
      }
    }
    // Everything went through: the next read of the list should be empty and ends the loop with "done".
  }
  return left > 0 ? { kind: 'failed', staged, left, message } : { kind: 'done', staged };
}
