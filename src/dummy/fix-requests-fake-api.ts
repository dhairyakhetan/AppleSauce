/**
 * In-memory fake of the bug and edit request functions for dummy mode. Test builds only (see
 * src/lib/dummy-mode.ts), reached solely through the PREVIEW_TOOLS-gated lazy imports of the HOD
 * desk and the checker page. Every person and request here is MADE UP and nothing touches Supabase.
 *
 * It copies the rules the screens lean on: a member's request waits for the HOD, an HOD's is approved
 * at once, titles and details have limits, ten a day is the most, a rejection needs a reason, and a
 * request that was already decided cannot be decided again.
 */

import type { FixRequestsApi } from '@/lib/fix-requests-api';
import { DAILY_LIMIT, decisionProblem, draftProblem, groupOf, groupStatuses, newestFirst, type FixRequest, type RequestCounts } from '@/lib/fix-requests';

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

function pgError(message: string, code = '22023') {
  return Object.assign(new Error(message), { code, details: null, hint: null });
}

export interface FakeFixRequestsApi extends FixRequestsApi {
  reset(): void;
}

/** `role` is who is using the preview: a checker ("member") or an HOD. */
export function createFakeFixRequestsApi(role: 'member' | 'hod'): FakeFixRequestsApi {
  const ME = 'Asha Reviewer';
  const seed = (): FixRequest[] => {
    const base = {
      raised_as: 'member' as const,
      decided_by_name: null,
      decided_at: null,
      decision_note: null,
      claude_note: null,
      done_at: null,
    };
    return [
      {
        ...base,
        id: 'f5000000-0000-4000-8000-000000000001',
        created_at: ago(35),
        raised_by_name: 'Nikhil K',
        kind: 'bug',
        title: 'The Skip button does nothing on my phone',
        details: 'I press Skip on question 4 and the same question stays. It worked yesterday.',
        page_path: '/checker?paper=e1000000-0000-4000-8000-000000000001&verify=1',
        status: 'waiting_for_hod',
      },
      {
        ...base,
        id: 'f5000000-0000-4000-8000-000000000002',
        created_at: ago(60 * 5),
        raised_by_name: role === 'member' ? ME : 'Tara Bose',
        kind: 'edit',
        title: 'Show the school name on the paper card',
        details: 'Two papers look alike in the list. The school name would tell them apart.',
        page_path: '/checker',
        status: 'waiting_for_hod',
      },
      {
        ...base,
        id: 'f5000000-0000-4000-8000-000000000003',
        created_at: ago(60 * 30),
        raised_by_name: role === 'member' ? ME : 'Imran Shaikh',
        kind: 'bug',
        title: 'Progress bar stays at zero',
        details: '',
        page_path: '/checker',
        status: 'approved',
        decided_by_name: 'Priya HOD',
        decided_at: ago(60 * 26),
        decision_note: 'Yes, please look at this.',
      },
      {
        ...base,
        id: 'f5000000-0000-4000-8000-000000000004',
        created_at: ago(60 * 52),
        raised_by_name: role === 'member' ? ME : 'Nikhil K',
        kind: 'edit',
        title: 'Make the text bigger in Rules and shortcuts',
        details: 'It is hard to read on a small phone.',
        page_path: '/checker/help',
        status: 'in_progress',
        decided_by_name: 'Priya HOD',
        decided_at: ago(60 * 50),
      },
      {
        ...base,
        id: 'f5000000-0000-4000-8000-000000000005',
        created_at: ago(60 * 80),
        raised_by_name: role === 'member' ? ME : 'Tara Bose',
        kind: 'edit',
        title: 'Add a dark colour scheme',
        details: 'Easier on the eyes at night.',
        page_path: '/checker',
        status: 'rejected',
        decided_by_name: 'Priya HOD',
        decided_at: ago(60 * 79),
        decision_note: 'Not now. We are keeping one look while papers are being checked.',
      },
      {
        ...base,
        id: 'f5000000-0000-4000-8000-000000000006',
        created_at: ago(60 * 120),
        raised_by_name: role === 'member' ? ME : 'Asha Reviewer',
        kind: 'bug',
        title: 'The picture does not load on question 12',
        details: 'A grey box stays where the picture should be.',
        page_path: '/checker?paper=e1000000-0000-4000-8000-000000000002&verify=1',
        status: 'done',
        decided_by_name: 'Priya HOD',
        decided_at: ago(60 * 118),
        claude_note: 'The picture link was out of date. It now loads again for every paper.',
        done_at: ago(60 * 100),
      },
    ];
  };

  let rows = seed();
  // Requests this preview user sent, newest first. Seed rows with their name count as theirs.
  let mineIds: string[] = [];
  let sentToday = 0;

  const isMine = (r: FixRequest) => mineIds.includes(r.id) || (role === 'member' && r.raised_by_name === ME);

  return {
    reset() {
      rows = seed();
      mineIds = [];
      sentToday = 0;
    },
    async submit(input) {
      const problem = draftProblem({ kind: input.kind, title: input.title, details: input.details });
      if (problem) throw pgError(problem);
      if (sentToday >= DAILY_LIMIT) throw pgError(`You have already sent ${DAILY_LIMIT} requests in the last day. Please try again tomorrow.`, '54000');
      sentToday += 1;
      const id = crypto.randomUUID();
      const fromHod = role === 'hod';
      rows = [
        {
          id,
          created_at: new Date().toISOString(),
          raised_by_name: fromHod ? 'Priya HOD' : ME,
          raised_as: fromHod ? 'hod' : 'member',
          kind: input.kind,
          title: input.title.trim(),
          details: input.details.trim(),
          page_path: input.page || null,
          status: fromHod ? 'approved' : 'waiting_for_hod',
          decided_by_name: null,
          decided_at: null,
          decision_note: null,
          claude_note: null,
          done_at: null,
        },
        ...rows,
      ];
      mineIds = [id, ...mineIds];
      return id;
    },
    async mine() {
      return newestFirst(rows.filter(isMine)).map((r) => ({ ...r }));
    },
    async list(group) {
      const statuses = groupStatuses(group);
      return newestFirst(rows.filter((r) => statuses.includes(r.status))).map((r) => ({ ...r }));
    },
    async counts() {
      const c: RequestCounts = { waiting_for_hod: 0, approved: 0, in_progress: 0, rejected: 0, done: 0 };
      for (const r of rows) c[r.status] += 1;
      return c;
    },
    async decide(id, approve, note) {
      const problem = decisionProblem(approve, note);
      if (problem) throw pgError(problem);
      const row = rows.find((r) => r.id === id);
      if (!row) throw pgError('That request was not found.');
      if (groupOf(row.status) !== 'waiting') throw pgError('This request has already been dealt with.', '55000');
      const status = approve ? 'approved' : 'rejected';
      rows = rows.map((r) =>
        r.id === id
          ? { ...r, status, decided_by_name: 'Priya HOD', decided_at: new Date().toISOString(), decision_note: note.trim() === '' ? null : note.trim() }
          : r,
      );
      return status;
    },
  };
}
