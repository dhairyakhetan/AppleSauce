import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';

// CI has no Supabase env; the page only needs the client to exist.
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: vi.fn(), from: vi.fn(), auth: { getSession: vi.fn(), onAuthStateChange: vi.fn() } },
}));

import {
  LIVE_UPDATE_RPC,
  canUpdate,
  confirmWords,
  doneWords,
  normalisePending,
  normaliseResult,
  normaliseOpenQuestion,
  solveHref,
  realLiveUpdateApi,
  updateErrorWords,
  type LivePendingRow,
} from './admin-live-update';
import { UpdateLivePapersView } from '@/components/admin/approval/UpdateLivePapers';
import { supabase } from '@/integrations/supabase/client';

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');

const ROW: LivePendingRow = {
  audit_paper_id: 'p1',
  live_bank_paper_id: 'a2b9b0',
  title: 'Class X English, 2025',
  school: 'Example School',
  updated: 15,
  added: 4,
  hidden: 1,
  open: 0,
};
const BLOCKED: LivePendingRow = { ...ROW, audit_paper_id: 'p2', open: 3, updated: 2, added: 0, hidden: 0 };

function render(props: Partial<Parameters<typeof UpdateLivePapersView>[0]> = {}) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <UpdateLivePapersView
        rows={[ROW, BLOCKED]}
        state="idle"
        onAsk={() => {}}
        onCancel={() => {}}
        onConfirm={() => {}}
        onRetry={() => {}}
        {...props}
      />
    </MemoryRouter>,
  );
}

describe('live paper update shapes', () => {
  it('reads a pending row from the RPC columns', () => {
    const r = normalisePending({
      audit_paper_id: 'p1',
      live_bank_paper_id: 'a2b9b0',
      school: 'Example School',
      cls: 'X',
      subject: 'English',
      year: '2025',
      questions_updated: 15,
      questions_added: '4',
      questions_hidden: 1,
      open_questions: 0,
    });
    expect(r).toMatchObject({ audit_paper_id: 'p1', title: 'Class X English, 2025', updated: 15, added: 4, hidden: 1, open: 0 });
    expect(normalisePending({ live_bank_paper_id: 'x' })).toBeNull();
    expect(normalisePending(null)).toBeNull();
  });

  it('only a paper with no open question can be updated', () => {
    expect(canUpdate(ROW)).toBe(true);
    expect(canUpdate(BLOCKED)).toBe(false);
  });

  it('asks in plain words with the counts, and never uses a dash', () => {
    expect(confirmWords(ROW)).toBe(
      'This changes the live paper: 15 questions updated, 4 added, 1 hidden. Logged and reversible.',
    );
    expect(confirmWords({ updated: 1, added: 0, hidden: 0 })).toContain('1 question updated');
    expect(doneWords(normaliseResult({ updated: 2, added: 3, hidden: 0 }))).toBe(
      'Live paper updated: 2 questions updated, 3 added, 0 hidden.',
    );
    for (const w of [confirmWords(ROW), doneWords({ updated: 1, added: 1, hidden: 1 }), updateErrorWords({})]) {
      expect(w).not.toMatch(/[–—]/);
    }
  });

  it('turns a refusal into words and never shows a server code', () => {
    expect(updateErrorWords({ code: '42501', message: 'Not authorized' })).toMatch(/not allowed/);
    expect(updateErrorWords({ code: '55000', message: '3 question(s) on this paper are still open. Pass or set aside each one first.' })).toMatch(
      /still open/,
    );
    expect(updateErrorWords({ message: 'fetch failed' })).toMatch(/not changed/);
  });
});

describe('live paper update calls', () => {
  it('lists through admin_live_paper_pending and pushes through admin_update_live_paper with the paper id only', async () => {
    const rpc = supabase.rpc as unknown as ReturnType<typeof vi.fn>;
    rpc.mockResolvedValueOnce({ data: [{ audit_paper_id: 'p1', questions_updated: 2 }, { nope: 1 }], error: null });
    const list = await realLiveUpdateApi.pending();
    expect(rpc).toHaveBeenLastCalledWith(LIVE_UPDATE_RPC.pending);
    expect(list.map((r) => r.audit_paper_id)).toEqual(['p1']);

    rpc.mockResolvedValueOnce({ data: { updated: 2, added: 1, hidden: 0 }, error: null });
    expect(await realLiveUpdateApi.update('p1')).toEqual({ updated: 2, added: 1, hidden: 0 });
    expect(rpc).toHaveBeenLastCalledWith(LIVE_UPDATE_RPC.update, { p_audit_paper_id: 'p1' });
  });

  it('throws the server error so the page can say why', async () => {
    const rpc = supabase.rpc as unknown as ReturnType<typeof vi.fn>;
    rpc.mockResolvedValueOnce({ data: null, error: { code: '55000', message: 'boom' } });
    await expect(realLiveUpdateApi.update('p1')).rejects.toMatchObject({ code: '55000' });
  });
});

describe('Update live paper panel', () => {
  it('lists each paper with its counts and an Update live paper button', () => {
    const t = text(render());
    expect(t).toContain('Live papers with changes waiting');
    expect(t).toContain('Class X English, 2025');
    expect(t).toContain('15 questions updated, 4 added, 1 hidden');
    expect(t).toContain('Update live paper');
  });

  it('disables the button and says why while questions are open', () => {
    const html = render({ rows: [BLOCKED] });
    expect(text(html)).toContain('3 questions are still open. Pass or set aside each one first.');
    expect(html).toMatch(/<button[^>]*disabled[^>]*>\s*Update live paper/);
  });

  it('shows the plain-English confirm for the paper being asked about', () => {
    const t = text(render({ confirmingId: 'p1' }));
    expect(t).toContain('This changes the live paper: 15 questions updated, 4 added, 1 hidden. Logged and reversible.');
    expect(t).toContain('Yes, update the live paper');
    expect(t).toContain('Cancel');
  });

  it('shows the busy, error, empty, loading and load-failed states', () => {
    expect(text(render({ confirmingId: 'p1', busyId: 'p1' }))).toContain('Updating...');
    const err = render({ errorFor: { id: 'p1', message: 'The live paper was not changed. Check your internet and try again.' } });
    expect(err).toContain('role="alert"');
    expect(text(err)).toContain('The live paper was not changed');
    expect(text(render({ rows: [] }))).toContain('No live paper has changes waiting.');
    expect(render({ rows: null, state: 'loading' })).toContain('role="status"');
    const failed = render({ rows: null, state: 'error' });
    expect(text(failed)).toContain('The list of live papers did not load');
    expect(text(failed)).toContain('Try again');
  });
});

describe('copy has no em or en dashes', () => {
  it('in the live update page pieces', () => {
    for (const f of ['src/lib/admin-live-update.ts', 'src/components/admin/approval/UpdateLivePapers.tsx']) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/[–—]/);
    }
  });
});

describe('open questions list', () => {
  it('names the RPC and sends only the paper id', async () => {
    expect(LIVE_UPDATE_RPC.openQuestions).toBe('admin_live_paper_open_questions');
    (supabase.rpc as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: [{ audit_question_id: 'q1', display_number: '4(b)', review_bucket: 'kid', flag_reasons: ['marks_mismatch'], flag_detail: null }],
      error: null,
    });
    const list = await realLiveUpdateApi.openQuestions('p2');
    expect(supabase.rpc).toHaveBeenLastCalledWith('admin_live_paper_open_questions', { p_audit_paper_id: 'p2' });
    expect(list).toHaveLength(1);
    expect(list[0].label).toBe('4(b)');
    expect(list[0].where).toBe('Student queue');
    expect(list[0].reasons[0]).toMatch(/marks/i);
  });

  it('puts every non-student row in the Admin queue and survives missing fields', () => {
    const q = normaliseOpenQuestion({ audit_question_id: 'q2', review_bucket: 'admin', number_path: '7', flag_reasons: null }, 0);
    expect(q?.where).toBe('Admin queue');
    expect(q?.label).toBe('7');
    expect(q?.reasons.length).toBe(1);
    expect(normaliseOpenQuestion({}, 0)).toBeNull();
  });

  it('Solve links to that question on the paper review page', () => {
    expect(solveHref('p2', 'q9')).toBe('/admin/paper-approvals/p2#q-q9');
  });

  it('the badge is a button that lists each question with a Solve link', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <UpdateLivePapersView
          rows={[BLOCKED]}
          state="idle"
          expandedId="p2"
          openList={[{ id: 'q1', label: '3(a)', where: 'Admin queue', reasons: ['The marks may not match the paper.'] }]}
          onAsk={() => {}}
          onCancel={() => {}}
          onConfirm={() => {}}
          onRetry={() => {}}
        />
      </MemoryRouter>,
    );
    const t = text(html);
    expect(html).toContain('aria-expanded="true"');
    expect(t).toContain('Question 3(a)');
    expect(t).toContain('Waits in: Admin queue');
    expect(html).toContain('href="/admin/paper-approvals/p2#q-q1"');
    expect(html).toContain('disabled=""');
  });
});
