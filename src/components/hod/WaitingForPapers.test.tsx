import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WaitingForPapersView, type WaitingState } from '@/components/hod/WaitingForPapers';
import type { PaperAsk } from '@/lib/paper-asks';

const noop = () => {};
const ask = (over: Partial<PaperAsk> = {}): PaperAsk => ({
  ask_id: 'a1',
  user_id: 'u1',
  name: 'Rohan Verma',
  asked_at: new Date(Date.now() - 3 * 3600_000).toISOString(),
  finished_recently: 3,
  ...over,
});
const draw = (state: WaitingState, extra: { busyId?: string | null; problem?: string | null } = {}) =>
  renderToStaticMarkup(<WaitingForPapersView state={state} onDismiss={noop} onRetry={noop} {...extra} />);

describe('WaitingForPapersView', () => {
  it('draws nothing while it loads, so the screen does not jump', () => {
    expect(draw({ kind: 'loading' })).toBe('');
  });

  it('lists who is free, since when and how many papers they finished lately', () => {
    const out = draw({ kind: 'list', asks: [ask(), ask({ ask_id: 'a2', name: 'Meera Iyer', finished_recently: 0 })] });
    expect(out).toContain('Waiting for papers');
    expect(out).toContain('2 people');
    expect(out).toContain('Rohan Verma');
    expect(out).toContain('finished 3 papers in the last two weeks');
    expect(out).toContain('Meera Iyer');
    expect(out.match(/data-testid="waiting-person"/g)?.length).toBe(2);
    // The second person finished nothing lately: that part of the line is left out, not shown as zero.
    expect(out).not.toContain('finished 0');
  });

  it('gives every person a Clear button named for them', () => {
    const out = draw({ kind: 'list', asks: [ask()] });
    expect(out).toContain('Clear');
    expect(out).toContain("aria-label=\"Clear Rohan Verma&#x27;s ask\"");
  });

  it('disables the Clear button of the person being cleared', () => {
    const out = draw({ kind: 'list', asks: [ask()] }, { busyId: 'a1' });
    expect(out).toContain('disabled=""');
    expect(draw({ kind: 'list', asks: [ask()] })).not.toContain('disabled=""');
  });

  it('says nobody is waiting when the list is empty', () => {
    const out = draw({ kind: 'list', asks: [] });
    expect(out).toContain('data-testid="waiting-empty"');
    expect(out).toContain('Nobody is waiting for papers right now.');
    expect(out).not.toContain('Clear');
  });

  it('shows a friendly note, not an error, when the database part is not pasted yet', () => {
    const out = draw({ kind: 'off' });
    expect(out).toContain('data-testid="waiting-off"');
    expect(out).toContain('not switched on yet');
    expect(out).not.toContain('role="alert"');
  });

  it('offers Try again when the list could not be read for another reason', () => {
    const out = draw({ kind: 'error' });
    expect(out).toContain('data-testid="waiting-error"');
    expect(out).toContain('Try again');
  });

  it('shows a problem line when a clear did not go through', () => {
    const out = draw({ kind: 'list', asks: [ask()] }, { problem: 'That did not clear.' });
    expect(out).toContain('data-testid="waiting-problem"');
    expect(out).toContain('That did not clear.');
  });

  it('sits on the Assignments screen right after Needs attention and before Who has what', () => {
    const src = readFileSync('src/components/hod/AssignmentsTab.tsx', 'utf8');
    const attention = src.indexOf('<AttentionGroup id="assign-attention"');
    const waiting = src.indexOf('<WaitingForPapers ');
    const who = src.indexOf('aria-labelledby="who-has-what"');
    expect(attention).toBeGreaterThan(-1);
    expect(waiting).toBeGreaterThan(attention);
    expect(who).toBeGreaterThan(waiting);
  });
});
