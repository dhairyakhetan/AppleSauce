import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { PageImageViewer } from '@/components/checker/PageImageViewer';
import { UprightImage } from '@/components/checker/UprightImage';
import { readFileSync } from 'node:fs';

/* The whole-page view: a page saved sideways is turned upright and its highlight box is turned with it.
   Turn 0 is the page exactly as before. bbox_norm is used so the box needs no picture size (nothing loads in a static render). */

const source = { page: 2, page_verified: true, bbox_norm: [0.1, 0.2, 0.4, 0.3] };
const SRC = 'https://example.test/page.jpg';

function view(rotation?: 0 | 90 | 180 | 270) {
  return renderToStaticMarkup(
    <PageImageViewer src={SRC} alt="Page 2" note="Find question 4 on this page." onError={() => undefined} source={source} rotation={rotation} />,
  );
}

function boxStyle(html: string): Record<string, number> {
  const m = html.match(/data-testid="highlight-box"[^>]*style="([^"]*)"/);
  expect(m).not.toBeNull();
  const out: Record<string, number> = {};
  for (const part of m![1].split(';')) {
    const [k, v] = part.split(':').map((s) => s.trim());
    if (k && v) out[k] = parseFloat(v);
  }
  return out;
}

describe('PageImageViewer with no turn', () => {
  it('is the plain picture with the box where the question is', () => {
    const html = view();
    expect(html).not.toContain('upright-stage');
    expect(html).not.toContain('rotate(');
    expect(html).toContain('class="block h-auto w-full"');
    const b = boxStyle(html);
    expect(b.left).toBeCloseTo(10 - 0.6, 1);
    expect(b.top).toBeCloseTo(20 - 0.6, 1);
  });
  it('turn 0 given explicitly is the same markup', () => {
    expect(view(0)).toBe(view());
  });
});

describe('PageImageViewer with a quarter turn', () => {
  it('turns the picture and gives it an upright frame, and keeps the page named for a screen reader', () => {
    const html = view(270);
    expect(html).toContain('data-testid="upright-stage"');
    expect(html).toContain('rotate(270deg)');
    expect(html).toContain('alt="Page 2"');
    expect(html).toContain('role="region"');
  });
  it('turns the box with the picture (270: the stored left becomes the top)', () => {
    const plain = boxStyle(view());
    const turned = boxStyle(view(270));
    // stored box: left 9.4, top 19.4, width 31.2, height 11.2 (percent, with padding)
    expect(turned.left).toBeCloseTo(plain.top, 1);
    expect(turned.top).toBeCloseTo(100 - (plain.left + plain.width), 1);
    expect(turned.width).toBeCloseTo(plain.height, 1);
    expect(turned.height).toBeCloseTo(plain.width, 1);
  });
  it('90 puts the box on the other side from 270', () => {
    const t90 = boxStyle(view(90));
    const t270 = boxStyle(view(270));
    expect(t90.left).toBeCloseTo(100 - (t270.left + t270.width), 1);
    expect(t90.top).toBeCloseTo(100 - (t270.top + t270.height), 1);
  });
  it('180 turns the picture without swapping its frame', () => {
    const html = view(180);
    expect(html).not.toContain('upright-stage');
    expect(html).toContain('rotate(180deg)');
  });
  it('still says what the box is, and shows no box when there is nothing to draw', () => {
    expect(view(90)).toContain('data-testid="highlight-note"');
    const none = renderToStaticMarkup(
      <PageImageViewer src={SRC} alt="Page 2" note="n" onError={() => undefined} source={{ page: 2, page_verified: true }} rotation={90} />,
    );
    expect(none).not.toContain('highlight-box');
  });
});

describe('UprightImage', () => {
  it('a turn of 90 sizes its frame as the upright page (the fallback shape until the picture has loaded)', () => {
    const html = renderToStaticMarkup(<UprightImage src={SRC} alt="x" rotation={90} />);
    expect(html).toMatch(/aspect-ratio:\s*1\s*\/\s*0\.77/);
    expect(html).toContain('rotate(90deg)');
  });
});

describe('Enlarge (the lightbox)', () => {
  // The lightbox renders into the page body, which a static render does not have; its picture is the same component.
  it('is built from the same upright picture, handed the page turn from the screen', () => {
    expect(readFileSync('src/components/checker/BentoParts.tsx', 'utf8')).toMatch(/<UprightImage[\s\S]{0,120}rotation=\{rotation\}/);
    expect(readFileSync('src/components/checker/VerifyScreen.tsx', 'utf8')).toMatch(/setLightbox\(\{ src: pageShown, alt: pageAlt, rotation: pageRotation \}\)/);
  });
  it('is the plain picture with no turn and a turned picture with one', () => {
    const plain = renderToStaticMarkup(<UprightImage src={SRC} alt="x" className="max-h-full" stageClassName="h-full" />);
    expect(plain).not.toContain('rotate(');
    const turned = renderToStaticMarkup(<UprightImage src={SRC} alt="x" rotation={270} className="max-h-full" stageClassName="h-full" />);
    expect(turned).toContain('rotate(270deg)');
    expect(turned).toContain('h-full');
  });
});
