import type { ApprovalApi } from '@/lib/admin-approval-shape';
import {
  normaliseOpenQuestion,
  type LivePendingRow,
  type LiveUpdateApi,
  type OpenQuestion,
} from '@/lib/admin-live-update';
import { FIXTURE_PAPER_ID } from '@/dummy/approval-fake-api';

/**
 * In-memory fake of the "Update live paper" RPCs (dummy mode, test builds
 * only). It reads the SAME fake paper the review page edits, so passing or
 * setting aside a question there lowers the count here: the loop the owner
 * asked for ("see which are open and solve them") works end to end without a
 * sign-in. The paper, school and questions are all made up.
 */
export function createFakeLiveUpdateApi(approval: ApprovalApi, delayMs = 200): LiveUpdateApi {
  const tick = () => new Promise((r) => setTimeout(r, delayMs));
  let pushed = false;

  async function openRows(): Promise<OpenQuestion[]> {
    const review = await approval.review(FIXTURE_PAPER_ID);
    return review.rows
      .filter((r) => r.kind === 'question' && r.state === 'open')
      .map((r, i) =>
        normaliseOpenQuestion(
          {
            audit_question_id: r.id,
            display_number: r.display_number,
            number_path: r.number_path,
            review_bucket: r.review_bucket,
            flag_reasons: r.flag_reasons,
            flag_detail: r.flag_detail,
          },
          i,
        ),
      )
      .filter((q): q is OpenQuestion => q !== null);
  }

  return {
    async pending() {
      await tick();
      if (pushed) return [];
      const row: LivePendingRow = {
        audit_paper_id: FIXTURE_PAPER_ID,
        live_bank_paper_id: 'dummy-live-1',
        title: 'Class X Physics, 2025',
        school: 'Example Public School',
        updated: 2,
        added: 1,
        hidden: 0,
        open: (await openRows()).length,
      };
      return [row];
    },
    async openQuestions() {
      await tick();
      return openRows();
    },
    async update() {
      await tick();
      if ((await openRows()).length > 0) throw { code: '55000', message: 'Questions are still open' };
      pushed = true;
      return { updated: 2, added: 1, hidden: 0 };
    },
  };
}

let shared: LiveUpdateApi | null = null;
export function sharedFakeLiveUpdateApi(approval: ApprovalApi): LiveUpdateApi {
  shared ??= createFakeLiveUpdateApi(approval);
  return shared;
}
