import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CheckGuidance } from '@/components/checker/CheckerBits';
import { describeLanes } from '@/lib/checker-lanes';

// Owner, 2026-10-08: the "What to check" box and the question box looked like
// equals, so the comparison (what we have against the printed paper) did not
// read as the main job. The guidance is now quiet text, not a filled card.
// Rendered with renderToStaticMarkup (no jsdom in this project's tests); with
// no `window` the "hide tips" choice reads as shown, which is the default.

describe('CheckGuidance', () => {
  it('is quiet guidance: no fill, no border, no card radius', () => {
    const html = renderToStaticMarkup(<CheckGuidance summary={describeLanes(['ocr_disagreement'], null)} />);
    const section = html.slice(0, html.indexOf('>') + 1);
    expect(section).not.toMatch(/\bbg-|\bborder\b|\bborder-|\brounded/);
    expect(html).not.toMatch(/bg-brand-subtle/);
  });

  it('puts the lane name in the label line and the instruction in secondary text', () => {
    const html = renderToStaticMarkup(<CheckGuidance summary={describeLanes(['ocr_disagreement'], null)} />);
    expect(html).toContain('How to check: Read the words against the page');
    expect(html).toContain('Compare the question with the printed page.');
    expect(html).toContain('text-warm-secondary');
    expect(html).toContain('Hide tips');
    expect(html).not.toContain('What to check');
  });

  it('shows the older single sentence in the same quiet style', () => {
    const html = renderToStaticMarkup(<CheckGuidance line="Check the marks." detail="The paper says 80." />);
    expect(html).toContain('How to check');
    expect(html).toContain('Check the marks.');
    expect(html).toContain('What the computer noticed: The paper says 80.');
    expect(html).not.toMatch(/bg-brand-subtle/);
  });

  it('renders nothing when there is nothing to say', () => {
    expect(renderToStaticMarkup(<CheckGuidance summary={describeLanes([], null)} />)).toBe('');
    expect(renderToStaticMarkup(<CheckGuidance line={null} />)).toBe('');
  });
});
