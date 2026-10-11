import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';

import { PanelTabs, PrintedFrame, TypedFrame } from '@/components/checker/Panels';

/* The tabs on a phone point at the two sides; the two sides must be real tab
   panels named by their tab, or a screen reader never hears the link. */

describe('the Typed and Printed sides are tab panels', () => {
  it('each side is a tabpanel named by its tab', () => {
    const html = renderToStaticMarkup(
      <>
        <PanelTabs value="typed" onChange={() => undefined} />
        <TypedFrame>x</TypedFrame>
        <PrintedFrame>y</PrintedFrame>
      </>,
    );
    for (const id of ['typed', 'printed']) {
      expect(html).toMatch(new RegExp(`id="verify-panel-${id}"[^>]*role="tabpanel"[^>]*aria-labelledby="verify-tab-${id}"`));
      expect(html).toContain(`id="verify-tab-${id}"`);
      expect(html).toContain(`aria-controls="verify-panel-${id}"`);
    }
  });
});

describe('small fixes in the verifier screens', () => {
  const read = (p: string) => readFileSync(p, 'utf8');

  it('the scrolling page boxes are named regions', () => {
    expect(read('src/components/checker/PageImageViewer.tsx')).toMatch(/tabIndex=\{0\}\s+role="region"\s+aria-label/);
    expect(read('src/components/checker/PaperPageFlip.tsx')).toMatch(/tabIndex=\{0\}\s+role="region"\s+aria-label/);
  });

  it('the formula editor heading uses no dash stand-in', () => {
    const src = read('src/components/checker/MathFieldEditor.tsx');
    expect(src).toContain('Edit the maths. No code, just how it looks.');
    expect(src).not.toContain('maths -- no code');
  });

  it('the practice Fix it button opens the typed side like the keyboard does', () => {
    const src = read('src/pages/CheckerPractice.tsx');
    expect(src).toMatch(/onClick=\{\(\) => startFix\('fix'\)\}>\s*Fix it/);
    expect(src).not.toMatch(/onClick=\{\(\) => setMode\('fix'\)\}/);
  });

  it('a picture lookup that rejects is treated as "no picture", not a skeleton forever', () => {
    expect(read('src/components/checker/CheckerBits.tsx')).toMatch(/\.pictureUrl\(path\)\s+\.catch\(\(\) => null\)/);
  });

  it('the walkthrough and the dialog both keep Tab inside themselves', () => {
    expect(read('src/components/checker/CheckerWalkthrough.tsx')).toContain("e.key !== 'Tab'");
    const bits = read('src/components/checker/CheckerBits.tsx');
    expect(bits).toContain("e.key !== 'Tab'");
    expect(bits).toContain('opener.focus');
  });

  it('the verify screen waits for the papers list before saying a paper is finished', () => {
    const src = read('src/components/checker/VerifyScreen.tsx');
    expect(src).toContain("paperGate === 'loading'");
    expect(src).toContain("paperGate === 'error'");
    expect(src).toContain('toolBlockedByUnsavedEdit(id, mode, edited)');
  });
});
