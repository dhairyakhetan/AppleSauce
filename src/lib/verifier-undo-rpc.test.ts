import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: (...args: unknown[]) => rpc(...args) } }));

import { realCheckerApi, verifierNextInPaper, verifierUndoLast, checkerMarkOrSeparator } from '@/lib/checker-api';

beforeEach(() => rpc.mockReset());

const question = { id: 'q1', paper_id: 'p1', body: 'Find x.', version: 4 };

describe('the real client for the rewind button', () => {
  it('calls verifier_undo_last with the paper and returns the question as it is now', async () => {
    rpc.mockResolvedValue({ data: { question_id: 'q1', undone: 'pass', undone_action: 'checker_pass', question }, error: null });
    const res = await verifierUndoLast('p1');
    expect(rpc).toHaveBeenCalledWith('verifier_undo_last', { p_paper_id: 'p1' });
    expect(res.undone).toBe('pass');
    expect(res.question).toEqual(question);
  });

  it('throws the server refusal as it came, so the screen can show the sentence', async () => {
    const refusal = { code: '22023', message: 'Your last answer was more than 30 minutes ago, so it can no longer be undone.' };
    rpc.mockResolvedValue({ data: null, error: refusal });
    await expect(verifierUndoLast('p1')).rejects.toBe(refusal);
  });

  it('throws when nothing came back', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(verifierUndoLast('p1')).rejects.toThrow();
  });

  it('is on the api object the screen uses', () => {
    expect(realCheckerApi.undoLast).toBe(verifierUndoLast);
    expect(realCheckerApi.markOrSeparator).toBe(checkerMarkOrSeparator);
  });
});

describe('next question in a paper', () => {
  it('asks for skipped questions only when told to', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await verifierNextInPaper('p1');
    expect(rpc).toHaveBeenLastCalledWith('verifier_next_in_paper', { p_paper_id: 'p1', p_include_skipped: false });
    await verifierNextInPaper('p1', { includeSkipped: true });
    expect(rpc).toHaveBeenLastCalledWith('verifier_next_in_paper', { p_paper_id: 'p1', p_include_skipped: true });
  });

  it('calls verifier_or_separator for a row that is only OR', async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    await checkerMarkOrSeparator('q9');
    expect(rpc).toHaveBeenCalledWith('verifier_or_separator', { p_question_id: 'q9' });
  });
});
