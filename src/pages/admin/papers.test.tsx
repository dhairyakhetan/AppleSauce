import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: vi.fn(), from: vi.fn(), storage: { from: vi.fn() }, auth: { getSession: vi.fn(), onAuthStateChange: vi.fn(), signOut: vi.fn() } },
}));
vi.mock('@/lib/admin-debug', () => ({
  useAdminDebugToggle: () => ({ on: false, canToggle: false, toggle: () => {} }),
  useAdminDebugOn: () => false,
}));

import { ApprovedNotLiveError, buildPaperPayload, listView, realPapersApi, mapSubmittedExamType, missingPaperFields, statusWords, submittedReviewDefaults, type FormState } from '@/pages/admin/papers';
import { createFakePapersApi } from '@/dummy/papers-fake-api';
import { supabase } from '@/integrations/supabase/client';

const FORM: FormState = {
  title: ' Prelims 2025 ',
  school: ' Sample Hill School ',
  subject: 'Mathematics',
  class: '10',
  board: 'ICSE',
  exam_type: 'Prelims',
  year: 2025,
  file_url: 'https://example.invalid/a.pdf',
};

describe('upload form: Publish and Save as draft say what they do', () => {
  it('"Publish this paper" writes is_published true', () => {
    expect(buildPaperPayload(FORM, true).is_published).toBe(true);
  });

  it('"Save as draft" writes is_published false', () => {
    expect(buildPaperPayload(FORM, false).is_published).toBe(false);
  });

  it('trims the title and school and keeps the rest', () => {
    expect(buildPaperPayload(FORM, true)).toEqual({
      title: 'Prelims 2025',
      school: 'Sample Hill School',
      subject: 'Mathematics',
      class: '10',
      board: 'ICSE',
      exam_type: 'Prelims',
      year: 2025,
      file_url: 'https://example.invalid/a.pdf',
      is_published: true,
    });
  });

  it('through the fake api, a draft is stored hidden and a publish is stored live', async () => {
    const api = createFakePapersApi();
    const draftId = await api.insertPaper(buildPaperPayload({ ...FORM, title: 'Draft one' }, false));
    const liveId = await api.insertPaper(buildPaperPayload({ ...FORM, title: 'Live one' }, true));
    const all = await api.papers();
    expect(all.find((p) => p.id === draftId)?.is_published).toBe(false);
    expect(all.find((p) => p.id === liveId)?.is_published).toBe(true);
  });

  it('lists the required fields that are still empty', () => {
    expect(missingPaperFields(FORM)).toEqual([]);
    expect(missingPaperFields({ ...FORM, title: '  ', school: '' })).toEqual(['title', 'school']);
    expect(missingPaperFields({ ...FORM, year: undefined })).toEqual(['year']);
  });
});

describe('the lists never turn a failed read into "No papers yet"', () => {
  it('error is its own state, whatever else is true', () => {
    expect(listView({ state: 'error', total: 0, shown: 0, searching: false })).toBe('error');
    expect(listView({ state: 'error', total: 0, shown: 0, searching: true })).toBe('error');
  });

  it('loading, rows, and the three honest empties are distinct', () => {
    expect(listView({ state: 'loading', total: 0, shown: 0, searching: false })).toBe('loading');
    expect(listView({ state: 'ok', total: 5, shown: 2, searching: false })).toBe('rows');
    expect(listView({ state: 'ok', total: 0, shown: 0, searching: false })).toBe('none-yet');
    expect(listView({ state: 'ok', total: 5, shown: 0, searching: false })).toBe('filter-empty');
    expect(listView({ state: 'ok', total: 5, shown: 0, searching: true })).toBe('search-empty');
  });
});

describe('hide, restore, approve and reject keep their writes (G6)', () => {
  it('hide and restore flip is_published on the same row', async () => {
    const api = createFakePapersApi();
    const first = (await api.papers())[0];
    await api.setPublished(first.id, false);
    expect((await api.papers()).find((p) => p.id === first.id)?.is_published).toBe(false);
    await api.setPublished(first.id, true);
    expect((await api.papers()).find((p) => p.id === first.id)?.is_published).toBe(true);
  });

  it('approve publishes a new paper and marks the upload approved; reject keeps the reason', async () => {
    const api = createFakePapersApi();
    const waiting = (await api.submissions()).filter((s) => s.status === 'pending');
    const [a, b] = waiting;
    const { paperId } = await api.approveSubmission({ target: a, title: 'Physics Prelims', board: 'ICSE', cls: '10', examType: 'Prelims', year: '2025', reviewerId: 'dummy-admin' });
    expect((await api.papers()).find((p) => p.id === paperId)).toMatchObject({ title: 'Physics Prelims', is_published: true });
    expect((await api.submissions()).find((s) => s.id === a.id)?.status).toBe('approved');
    await api.rejectSubmission(b.id, 'Pages are unreadable', 'dummy-admin');
    expect((await api.submissions()).find((s) => s.id === b.id)).toMatchObject({ status: 'rejected', review_note: 'Pages are unreadable' });
  });

  it('keeps the original exam-type mapping that the papers CHECK constraint needs', () => {
    expect(mapSubmittedExamType('Prelim / Pre-board')).toBe('Prelims');
    expect(mapSubmittedExamType('Half-yearly')).toBe('Half-Yearly');
    expect(mapSubmittedExamType('Annual / Final')).toBe('Final');
    expect(mapSubmittedExamType('Unit test')).toBe('Unit Test');
  });

  it('a "Not sure" or UG or Other submission opens the approve dialog blank, not as ICSE, Class 1, Prelims', () => {
    expect(submittedReviewDefaults({ board: null, class: null, exam_type: null })).toEqual({ board: '', cls: '', examType: '' });
    expect(submittedReviewDefaults({ board: 'ICSE', class: 'UG', exam_type: 'Other' })).toEqual({ board: 'ICSE', cls: '', examType: '' });
    expect(submittedReviewDefaults({ board: 'Nonsense', class: '10', exam_type: 'Unit test' })).toEqual({ board: '', cls: '10', examType: 'Unit Test' });
  });

  it('keeps what the sender did give', () => {
    expect(submittedReviewDefaults({ board: 'CBSE', class: '12', exam_type: 'Annual / Final' })).toEqual({ board: 'CBSE', cls: '12', examType: 'Final' });
  });

  it('shows a waiting upload as Pending, as the page help says', () => {
    expect(statusWords('pending')).toBe('Pending');
    expect(statusWords('approved')).toBe('Approved');
    expect(statusWords('rejected')).toBe('Rejected');
  });
});

describe('approving an upload never leaves a live paper behind a pending upload', () => {
  const target = {
    id: 'sub-1', school: 'Sample Hill School', subject: 'Physics', board: 'ICSE', class: '10', exam_type: 'Prelim / Pre-board', year: '2025',
    file_paths: [], status: 'pending', created_at: '2026-10-01T00:00:00Z',
  } as unknown as Parameters<typeof realPapersApi.approveSubmission>[0]['target'];
  const input = { target, title: 'Physics Prelims', board: 'ICSE', cls: '10', examType: 'Prelims', year: '2025', reviewerId: 'admin-1' };

  /** Records each write in order; `failOn` names the one that errors. */
  function wire(failOn: 'review' | 'live' | null) {
    const log: string[] = [];
    vi.mocked(supabase.from).mockImplementation(((table: string) => {
      if (table === 'papers') {
        return {
          insert: (row: { is_published: boolean }) => {
            log.push(`insert papers published=${row.is_published}`);
            return { select: () => ({ single: () => Promise.resolve({ data: { id: 'paper-1' }, error: null }) }) };
          },
          update: (row: { is_published: boolean }) => ({
            eq: () => {
              log.push(`update papers published=${row.is_published}`);
              return Promise.resolve({ error: failOn === 'live' ? { message: 'boom' } : null });
            },
          }),
          delete: () => ({
            eq: () => {
              log.push('delete papers');
              return Promise.resolve({ error: null });
            },
          }),
        };
      }
      return {
        update: (row: { status: string }) => ({
          eq: () => {
            log.push(`update submission ${row.status}`);
            return Promise.resolve({ error: failOn === 'review' ? { message: 'boom' } : null });
          },
        }),
      };
    }) as unknown as typeof supabase.from);
    return log;
  }

  it('creates a draft, marks the upload approved, and only then goes live', async () => {
    const log = wire(null);
    const out = await realPapersApi.approveSubmission(input);
    expect(log).toEqual(['insert papers published=false', 'update submission approved', 'update papers published=true']);
    expect(out.paperId).toBe('paper-1');
  });

  it('if the upload cannot be marked approved, nothing went live and the draft is removed', async () => {
    const log = wire('review');
    await expect(realPapersApi.approveSubmission(input)).rejects.toThrow();
    expect(log).toEqual(['insert papers published=false', 'update submission approved', 'delete papers']);
    expect(log.some((l) => l.includes('published=true'))).toBe(false);
  });

  it('if going live fails, the upload stays approved and the error says the paper is a draft', async () => {
    wire('live');
    await expect(realPapersApi.approveSubmission(input)).rejects.toBeInstanceOf(ApprovedNotLiveError);
  });
});

describe('the Student uploads page source', () => {
  const src = readFileSync('src/pages/admin/papers.tsx', 'utf8');

  it('Approve stays off until board, class and exam type are chosen', () => {
    expect(src).toContain('disabled={!approveTitle.trim() || !approveBoard || !approveClass || !approveExamType || reviewTarget.file_paths.length === 0}');
  });

  it('uses Hide, Restore and Hidden, never Unpublish or Taken down', () => {
    expect(src).not.toMatch(/Unpublish|Taken down|Take down/);
  });

  it('has no leftover "publish immediately" checkbox', () => {
    expect(src).not.toContain('Publish immediately');
    expect(src).not.toContain('u-is-published');
  });

  it('reads papers and uploads with explicit column lists', () => {
    expect(src).not.toMatch(/\.select\(\s*['"`]\*['"`]/);
  });

  it('the PDF picker can be reached by keyboard (visually hidden, not display:none)', () => {
    expect(src).toMatch(/type="file"[\s\S]{0,120}className="sr-only"/);
    expect(src).not.toMatch(/type="file"[\s\S]{0,120}className="hidden"/);
  });

  it('Publish and Save as draft wait for a PDF that is still uploading', () => {
    expect(src).toMatch(/if \(uploadingFile\) \{[\s\S]{0,120}return;/);
    expect(src).toContain("disabled={saving === 'publish' || uploadingFile}");
    expect(src).toContain("disabled={saving === 'draft' || uploadingFile}");
  });

  it('a failed publish clears the form link to the PDF it just deleted', () => {
    expect(src).toMatch(/removeUploaded\(formData\.file_url\);[\s\S]{0,200}handleChange\('file_url', null\)/);
  });

  it('Approve and publish is closed for an upload with no files', () => {
    expect(src).toContain('reviewTarget.file_paths.length === 0}');
    expect(src).toMatch(/file_paths\.length === 0\) \{\s*adminToast\(/);
  });

  it('late signed links for an earlier upload are dropped', () => {
    expect(src).toContain('signGuard.current.isCurrent(token)');
  });
});
