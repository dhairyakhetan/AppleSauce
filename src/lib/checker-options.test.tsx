import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { normaliseOptions } from './checker-options';
// MathText applies glyph substitution to letters (owner decision), so the
// rendering tests use digits, which it leaves alone.
import { OptionList } from '@/components/checker/OptionList';

describe('checker option normalising', () => {
  it('reads plain string options, the shape 15,657 rows use', () => {
    expect(normaliseOptions(['a. Dominion status', '(c) 1947'])).toEqual([
      { label: null, text: 'a. Dominion status' },
      { label: null, text: '(c) 1947' },
    ]);
  });

  it('reads label/text objects and keeps the printed order, not label order', () => {
    const out = normaliseOptions([
      { label: 'b', text: '- 30' },
      { label: 'a', text: '- 31' },
      { label: 'd', text: '31' },
    ]);
    expect(out.map((o) => o.label)).toEqual(['b', 'a', 'd']);
    expect(out[0].text).toBe('- 30');
  });

  it('never invents a label and drops only empty entries', () => {
    expect(normaliseOptions(['x', '  ', null, undefined, {}])).toEqual([{ label: null, text: 'x' }]);
    expect(normaliseOptions(null)).toEqual([]);
    expect(normaliseOptions(undefined)).toEqual([]);
  });

  it('keeps text verbatim, LaTeX and odd spacing included', () => {
    const t = String.raw`\(\frac{1}{2}\)  x`;
    expect(normaliseOptions([t])[0].text).toBe(t);
  });
});

describe('OptionList rendering', () => {
  it('lists every string option under the question', () => {
    const html = renderToStaticMarkup(<OptionList options={['1111', '2222']} />);
    expect(html).toContain('1111');
    expect(html).toContain('2222');
    expect(html.indexOf('1111')).toBeLessThan(html.indexOf('2222'));
    expect(html.match(/<li/g)).toHaveLength(2);
  });

  it('shows the label of an object option', () => {
    const html = renderToStaticMarkup(<OptionList options={[{ label: 'c', text: '3030' }]} />);
    expect(html).toContain('>c<');
    expect(html).toContain('3030');
  });

  it('renders nothing when there are no options', () => {
    expect(renderToStaticMarkup(<OptionList options={null} />)).toBe('');
    expect(renderToStaticMarkup(<OptionList options={[]} />)).toBe('');
  });
});
