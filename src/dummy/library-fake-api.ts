import type { PaperQueueRow, RevisionRow } from '@/lib/checker-api';
import type { LibraryExtra } from '@/lib/library-views';
import type { LibraryApi } from '@/pages/admin/library';

/* In-memory fake of the Library's reads and writes (D75). Every paper and
   school is MADE UP. Hide, restore and undo change this copy only. */

function paper(i: number, over: Partial<PaperQueueRow>): PaperQueueRow {
  return {
    paper_id: `a${i}0001`,
    title: '',
    school: 'Sample Hill School',
    subject: 'Mathematics',
    cls: '10',
    board: 'ICSE',
    year: '2024',
    needs_review: false,
    is_published: true,
    incomplete_note: null,
    audit_paper_id: `f3a00000-0000-4000-8000-00000000000${i}`,
    escalated_count: 0,
    total_questions: 30,
    passed_questions: 30,
    ...over,
  };
}

export function createFakeLibraryApi(): LibraryApi {
  const papers: PaperQueueRow[] = [
    paper(1, {}),
    paper(2, { school: 'Riverside Academy', subject: 'Physics', cls: '12', board: 'CBSE', year: '2023', needs_review: true, passed_questions: 21 }),
    paper(3, { school: 'Lakeview Institute', subject: 'Commerce', cls: '11', year: '2022', needs_review: true, total_questions: 25, passed_questions: 12 }),
    paper(4, { school: 'Greenfield School', subject: 'English', cls: '9', year: '2021', is_published: false, needs_review: true, total_questions: 40, passed_questions: 8 }),
    paper(5, { school: 'Sample Hill School', subject: 'Biology', cls: '10', year: '2020', is_published: false, total_questions: 28, passed_questions: 28 }),
    paper(6, { school: 'Riverside Academy', subject: 'Chemistry', cls: '12', board: 'CBSE', year: '2022', needs_review: true, total_questions: 35, passed_questions: 30 }),
    paper(7, { school: 'Lakeview Institute', subject: 'History', cls: '10', year: '2019', is_published: false, total_questions: 22, passed_questions: 0 }),
  ];
  const extras: LibraryExtra[] = [
    { paper_id: 'a20001', hidden_reason: null, hidden_at: null, hidden_by: null, with_students: 6, with_admin: 0, ready: false },
    { paper_id: 'a30001', hidden_reason: null, hidden_at: null, hidden_by: null, with_students: 9, with_admin: 4, ready: false },
    { paper_id: 'a40001', hidden_reason: 'Half the pages were scanned upside down, so most questions were unreadable.', hidden_at: '2026-09-30T09:00:00Z', hidden_by: 'Priya Sharma', with_students: 0, with_admin: 12, ready: false },
    { paper_id: 'a50001', hidden_reason: 'Duplicate of an earlier upload of the same paper.', hidden_at: '2026-09-29T09:00:00Z', hidden_by: 'Arjun Mehta', with_students: 0, with_admin: 0, ready: true },
    { paper_id: 'a60001', hidden_reason: null, hidden_at: null, hidden_by: null, with_students: 2, with_admin: 3, ready: false },
    { paper_id: 'a70001', hidden_reason: 'Published with no questions; the pipeline hid it.', hidden_at: '2026-09-29T09:00:00Z', hidden_by: 'The pipeline', with_students: 0, with_admin: 0, ready: false },
  ];
  let nextRevision = 10;
  const revisions: RevisionRow[] = [
    { id: 1, table_name: 'bank_papers', row_id: 'a40001', action: 'admin_hide', field: 'is_published', before: true, after: false, actor: 'Priya Sharma', source: 'admin', reason: extras[2].hidden_reason, created_at: '2026-09-30T09:00:00Z' },
    { id: 2, table_name: 'bank_papers', row_id: 'a20001', action: 'admin_edit', field: 'year', before: '2022', after: '2023', actor: 'Arjun Mehta', source: 'admin', reason: null, created_at: '2026-09-28T11:30:00Z' },
    { id: 3, table_name: 'bank_papers', row_id: 'a20001', action: 'live_apply', field: null, before: null, after: null, actor: 'The pipeline', source: 'pipeline', reason: null, created_at: '2026-09-27T08:00:00Z' },
  ];
  return {
    async papers() {
      return papers.map((p) => ({ ...p }));
    },
    async extras() {
      return extras.map((e) => ({ ...e }));
    },
    async hide(id, reason) {
      const p = papers.find((x) => x.paper_id === id);
      if (p) p.is_published = false;
      revisions.unshift({ id: nextRevision++, table_name: 'bank_papers', row_id: id, action: 'admin_hide', field: 'is_published', before: true, after: false, actor: 'You', source: 'admin', reason, created_at: new Date().toISOString() });
      const e = extras.find((x) => x.paper_id === id);
      if (e) {
        e.hidden_reason = reason;
        e.hidden_by = 'You';
      }
    },
    async restore(id) {
      const p = papers.find((x) => x.paper_id === id);
      if (p) p.is_published = true;
      revisions.unshift({ id: nextRevision++, table_name: 'bank_papers', row_id: id, action: 'admin_restore', field: 'is_published', before: false, after: true, actor: 'You', source: 'admin', reason: null, created_at: new Date().toISOString() });
    },
    async history(id) {
      return revisions.filter((r) => r.row_id === id).map((r) => ({ ...r }));
    },
    async undo() {
      /* nothing to undo in the preview */
    },
  };
}
