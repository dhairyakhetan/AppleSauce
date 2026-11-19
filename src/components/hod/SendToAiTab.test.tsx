import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: vi.fn(), from: vi.fn(), storage: { from: vi.fn() }, auth: { getSession: vi.fn(), onAuthStateChange: vi.fn(), signOut: vi.fn() } },
}));

import { AI_REDO_KEY, SendToAiTab } from '@/components/hod/SendToAiTab';
import type { HodApi } from '@/lib/hod-api';
import type { HodAiRedoItem } from '@/lib/hod-publish';

/* The Send to AI tab as the HOD sees it (owner, 19 Nov 2026: "show them" for requests on frozen live Maths copies).
   The list is put straight into the query cache, so this draws exactly what a loaded tab draws. */

const base: HodAiRedoItem = {
  id: 'q1',
  paper_id: 'p1',
  paper_title: 'Beccon X Maths',
  ord: 1,
  display_number: '7',
  number_path: '7',
  body: 'Made up question words',
  marks: 2,
  state: 'requested',
  reason: 'Two questions are joined',
  note: null,
  asked_by_name: 'Asha',
  asked_at: '2026-11-19T08:07:57Z',
  decided_by_name: null,
  decided_at: null,
  set_aside: false,
  live_copy: false,
  trail: [{ at: '2026-11-19T08:07:57Z', action: 'checker_ask_ai_redo', who: 'Asha', note: 'Two questions are joined', before: null, after: null, undone: false }],
};

function draw(items: HodAiRedoItem[]): string {
  const qc = new QueryClient();
  qc.setQueryData(AI_REDO_KEY('t'), items);
  const api = { aiRedoList: async () => items } as unknown as HodApi;
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client: qc }, createElement(MemoryRouter, null, createElement(SendToAiTab, { api, scope: 't' }))),
  );
}

describe('the Send to AI tab', () => {
  it('shows a waiting request with its reason, Yes and No, Open paper and the story button', () => {
    const html = draw([base]);
    expect(html).toContain('Waiting for your yes or no');
    expect(html).toContain('Asha said: Two questions are joined');
    expect(html).toContain('Yes, it needs AI review');
    expect(html).toContain('No, keep it with the HOD');
    expect(html).toContain('Open paper');
    expect(html).toContain('See the whole story');
    expect(html).not.toContain('ai-redo-frozen-note');
  });

  it('shows a request on a frozen live Maths copy with a note, in its own group, and offers no yes, no or Open paper', () => {
    const html = draw([{ ...base, id: 'q2', live_copy: true }]);
    expect(html).toContain('On frozen live Maths copies (cannot be decided here)');
    expect(html).toContain('ai-redo-frozen-note');
    expect(html).toContain('Live Maths copy, frozen');
    expect(html).toContain('Asha said: Two questions are joined');
    expect(html).toContain('See the whole story');
    expect(html).not.toContain('Yes, it needs AI review');
    expect(html).not.toContain('No, keep it with the HOD');
    expect(html).not.toContain('Open paper');
    expect(html).not.toContain('Waiting for your yes or no');
  });

  it('counts a frozen request on its own and not as waiting for the HOD', () => {
    const html = draw([base, { ...base, id: 'q2', live_copy: true }]);
    expect(html).toContain('1 question is waiting for your yes or no.');
    expect(html).toContain('1 is on frozen live Maths copies.');
  });

  it('keeps an agreed question on the list with no buttons', () => {
    const html = draw([{ ...base, state: 'approved', decided_at: '2026-11-19T09:00:00Z', decided_by_name: 'Dev' }]);
    expect(html).toContain('Agreed, waiting for the AI');
    expect(html).toContain('Agreed');
    expect(html).not.toContain('Yes, it needs AI review');
  });

  it('says plainly when nothing has been asked', () => {
    expect(draw([])).toContain('No student has asked to send a question back to the AI yet.');
  });
});
