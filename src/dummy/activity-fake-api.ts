import type { ActivityApi, ActivityRow, VersionRow, VersionedTable } from '@/lib/activity-api';

/**
 * In-memory fake of the admin Activity and version-history RPCs (D75), for
 * previewing /admin/activity without an admin sign-in. Test builds only:
 * reached solely through the PREVIEW_TOOLS-gated lazy import in
 * admin/activity.tsx. Every id, person and question here is MADE UP; nothing
 * is copied from a real paper or a real account.
 */

const Q1 = 'd1000000-0000-4000-8000-000000000001';
const Q2 = 'd2000000-0000-4000-8000-000000000002';
const P1 = 'd1000000-0000-4000-8000-0000000000a1';
const CHECKER_A = 'c0ffee00-0000-4000-8000-000000000001';
const CHECKER_B = 'c0ffee00-0000-4000-8000-000000000002';
const ADMIN = 'adadad00-0000-4000-8000-000000000001';

function at(minutesAgo: number): string {
  return new Date(Date.UTC(2026, 9, 2, 10, 0) - minutesAgo * 60_000).toISOString();
}

function row(r: Partial<ActivityRow> & Pick<ActivityRow, 'at' | 'stream' | 'event_id' | 'action'>): ActivityRow {
  return {
    actor_user_id: null,
    actor_label: null,
    actor_kind: 'system',
    table_name: 'audit_questions',
    row_id: null,
    paper_id: P1,
    question_id: null,
    version: null,
    detail: null,
    question_label: null,
    paper_title: null,
    ...r,
  };
}

function seedFeed(): ActivityRow[] {
  return [
    row({ at: at(2), stream: 'log', event_id: '9001', action: 'checker_printed_typo', actor_user_id: CHECKER_A, actor_kind: 'checker', question_id: Q1, row_id: Q1, version: 4, question_label: '8', paper_title: 'ICSE Class 10 Maths, 2025', detail: "the paper printed 'compleetly'" }),
    row({ at: at(2), stream: 'version', event_id: '801', action: 'version_update', actor_user_id: CHECKER_A, actor_kind: 'checker', question_id: Q1, row_id: Q1, version: 4, detail: "printed typo corrected by a checker: the paper printed 'compleetly'" }),
    row({ at: at(2), stream: 'check', event_id: '701', action: 'check_printed_typo', actor_user_id: CHECKER_A, actor_kind: 'checker', question_id: Q1, row_id: Q1, version: 3, paper_id: null }),
    row({ at: at(9), stream: 'log', event_id: '9000', action: 'checker_pass', actor_user_id: CHECKER_B, actor_kind: 'checker', question_id: Q2, row_id: Q2, version: 1, question_label: '3(b)', paper_title: 'ICSE Class 10 Maths, 2025', undone: true }),
    row({ at: at(9), stream: 'check', event_id: '700', action: 'check_pass', actor_user_id: CHECKER_B, actor_kind: 'checker', question_id: Q2, row_id: Q2, version: 1, paper_id: null }),
    row({ at: at(40), stream: 'version', event_id: '800', action: 'version_update', actor_label: 'ai:sonnet', actor_kind: 'ai', question_id: Q1, row_id: Q1, version: 3, detail: 'ai-check' }),
    row({ at: at(41), stream: 'check', event_id: '699', action: 'check_fix', actor_label: 'sonnet', actor_kind: 'ai', question_id: Q1, row_id: Q1, version: 2, paper_id: null, detail: 'confidence 0.91' }),
    row({ at: at(300), stream: 'version', event_id: '799', action: 'version_revert', actor_user_id: ADMIN, actor_kind: 'admin', question_id: Q1, row_id: Q1, version: 2, detail: 'revert to version 1' }),
    row({ at: at(2000), stream: 'log', event_id: '8000', action: 'reclassify', actor_label: 'pipeline', actor_kind: 'pipeline', question_id: Q2, row_id: Q2, detail: 'review_bucket' }),
  ];
}

function snap(body: string, marks = 2): Record<string, unknown> {
  return { body, display_number: '8', marks, options: null, paper_id: P1, ord: 7, kind: 'question' };
}

function seedVersions(): Map<string, VersionRow[]> {
  const v = (version: number, op: string, body: string, actor: string | null, actorUserId: string | null, source: string | null, reason: string | null, minutesAgo: number): VersionRow => ({
    version,
    op,
    content_sha256: `${version}f3a9c2e7b1d4${version}0aa`,
    snapshot: snap(body),
    has_answer_key: false,
    actor,
    actor_user_id: actorUserId,
    source,
    reason,
    created_at: at(minutesAgo),
    is_current: false,
  });
  const q1 = [
    v(4, 'update', 'Factorise completely: $3x^2 - 12$', 'checker', CHECKER_A, 'checker', "printed typo corrected by a checker: the paper printed 'compleetly'", 2),
    v(3, 'update', 'Factorise compleetly: $3x^2 - 12$', 'ai:sonnet', null, 'ai-check', 'restored the missing power', 40),
    v(2, 'revert', 'Factorise compleetly: $3x - 12$', ADMIN, ADMIN, 'admin', 'revert to version 1', 300),
    v(1, 'backfill', 'Factorise compleetly: $3x - 12$', 'system', null, 'backfill', 'state before its first recorded change', 2000),
  ];
  q1[0].is_current = true;
  const q2 = [v(1, 'backfill', 'Find the mean of the first five prime numbers.', 'system', null, 'backfill', 'state before its first recorded change', 2000)];
  q2[0].is_current = true;
  return new Map([
    [`audit_questions:${Q1}`, q1],
    [`audit_questions:${Q2}`, q2],
  ]);
}

export function createFakeActivityApi(): ActivityApi & { reset: () => void } {
  let feed = seedFeed();
  let versions = seedVersions();

  return {
    reset() {
      feed = seedFeed();
      versions = seedVersions();
    },

    async feed(scope, before, limit = 200) {
      const keep = feed.filter((r) => {
        if (before && r.at >= before) return false;
        if (scope === 'people') return r.actor_user_id !== null;
        if (scope === 'ai') return r.actor_kind === 'ai';
        return true;
      });
      return keep.slice(0, limit);
    },

    async versionHistory(table: VersionedTable, rowId: string) {
      return (versions.get(`${table}:${rowId}`) ?? []).map((r) => ({ ...r, snapshot: { ...r.snapshot } }));
    },

    async revert(table: VersionedTable, rowId: string, version: number, reason: string | null) {
      const list = versions.get(`${table}:${rowId}`);
      const target = list?.find((r) => r.version === version && r.op !== 'delete');
      if (!list || !target) throw Object.assign(new Error('Version not found'), { code: 'P0002' });
      const top = Math.max(...list.map((r) => r.version));
      list.forEach((r) => (r.is_current = false));
      const next: VersionRow = {
        ...target,
        version: top + 1,
        op: 'revert',
        actor: ADMIN,
        actor_user_id: ADMIN,
        source: 'admin',
        reason: reason?.trim() || `revert to version ${version}`,
        created_at: new Date().toISOString(),
        is_current: true,
      };
      list.unshift(next);
      feed.unshift(
        row({ at: next.created_at, stream: 'version', event_id: String(Date.now()), action: 'version_revert', actor_user_id: ADMIN, actor_kind: 'admin', question_id: rowId, row_id: rowId, version: next.version, detail: next.reason }),
      );
      return next.version;
    },
  };
}
