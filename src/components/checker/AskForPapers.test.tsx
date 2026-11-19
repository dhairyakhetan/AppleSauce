import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AskForPapersView, askedMessage } from '@/components/checker/AskForPapers';

const noop = () => {};

describe('AskForPapersView', () => {
  it('shows a warm line and the button when nothing was asked yet', () => {
    const out = renderToStaticMarkup(<AskForPapersView state={{ kind: 'ready' }} onAsk={noop} />);
    expect(out).toContain('data-testid="ask-ready"');
    expect(out).toContain('You are all caught up');
    expect(out).toContain('Ask my HOD for more papers');
    // The button's style names mention "disabled:", so look for the real attribute.
    expect(out).not.toContain('disabled=""');
    expect(out).not.toContain('ask-problem');
  });

  it('disables the button and says Asking while the request is out, so it cannot be tapped twice', () => {
    const out = renderToStaticMarkup(<AskForPapersView state={{ kind: 'ready' }} busy onAsk={noop} />);
    expect(out).toContain('Asking...');
    expect(out).toContain('disabled=""');
  });

  it('shows the reason in plain words when the ask failed, and keeps the button', () => {
    const out = renderToStaticMarkup(<AskForPapersView state={{ kind: 'ready', problem: 'That did not go through.' }} onAsk={noop} />);
    expect(out).toContain('role="alert"');
    expect(out).toContain('That did not go through.');
    expect(out).toContain('Ask my HOD for more papers');
  });

  it('shows the thank-you instead of the button once asked, so there is nothing to tap again', () => {
    const out = renderToStaticMarkup(<AskForPapersView state={{ kind: 'asked', message: 'Thank you. Your HOD can see you are free.' }} onAsk={noop} />);
    expect(out).toContain('data-testid="ask-done"');
    expect(out).toContain('Thank you');
    expect(out).not.toContain('<button');
  });

  it('says it is not switched on yet, with no button and no error', () => {
    const out = renderToStaticMarkup(<AskForPapersView state={{ kind: 'off' }} onAsk={noop} />);
    expect(out).toContain('data-testid="ask-off"');
    expect(out).toContain('not switched on yet');
    expect(out).not.toContain('<button');
    expect(out).not.toContain('role="alert"');
  });

  it('writes when the ask was made in words', () => {
    expect(askedMessage(new Date(Date.now() - 2 * 3600_000).toISOString())).toMatch(/^You asked about 2 hours ago\. Your HOD can see you are free\.$/);
    expect(askedMessage('garbage')).toBe('You asked. Your HOD can see you are free.');
  });

  it('is drawn inside the empty My papers list and nowhere else', () => {
    const checker = readFileSync('src/pages/Checker.tsx', 'utf8');
    const at = checker.indexOf('<AskForPapers ');
    expect(at).toBeGreaterThan(-1);
    expect(checker.slice(Math.max(0, at - 700), at)).toContain('data-testid="no-papers"');
    expect(checker.match(/<AskForPapers /g)?.length).toBe(1);
  });
});
