import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { DisclaimerStrip } from '@/components/papers/disclaimer-strip';

function text(props: Parameters<typeof DisclaimerStrip>[0]) {
  return renderToStaticMarkup(<DisclaimerStrip {...props} />).replace(/<[^>]+>/g, '');
}

describe('DisclaimerStrip source line', () => {
  it('names a school as the property of that school', () => {
    expect(text({ school: 'La Martiniere for Girls', tone: 'dark' })).toContain(
      'This paper is the property of La Martiniere for Girls.',
    );
  });

  it('names a board paper as the source, never as property', () => {
    const out = text({ school: 'ICSE board paper', isBoard: true, tone: 'dark' });
    expect(out).toContain('Source: ICSE board paper.');
    expect(out).not.toContain('property of');
  });

  it('with no recorded school, says nothing about a school and never prints the gap', () => {
    const out = text({ school: null, tone: 'dark' });
    expect(out).not.toContain('property of');
    expect(out).not.toContain('School not recorded');
    expect(out).toContain('Shikshaq claims no ownership over this paper.');
  });

  it('keeps the reading and downloading terms on every variant', () => {
    for (const props of [
      { school: 'Don Bosco School, Park Circus' },
      { school: 'ICSE board paper', isBoard: true },
      { school: null },
    ]) {
      expect(text(props)).toContain('Reading is free, downloading and reposting are not.');
    }
  });
});
