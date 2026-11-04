import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import { PaperSheetCard, type PaperSheetCardPaper } from '@/components/papers/paper-sheet-card';

const PAPER: PaperSheetCardPaper = {
  id: 'p1',
  title: 'Class X Maths',
  school: 'Sample Hill School',
  subject: 'Maths',
  class: '10',
  board: 'ICSE',
  exam_type: 'Prelims',
  year: 2024,
  file_url: 'https://example.invalid/p1.pdf',
};

function html(props: Partial<React.ComponentProps<typeof PaperSheetCard>> = {}, paper = PAPER) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <PaperSheetCard paper={paper} {...props} />
    </MemoryRouter>,
  );
}

describe('PaperSheetCard keyboard and screen-reader shape', () => {
  it('is not a role="link" wrapped around real links', () => {
    expect(html()).not.toContain('role="link"');
  });

  it('has no tab stop of its own: Read and Download are the only ones', () => {
    const out = html();
    expect(out).not.toContain('tabindex');
    expect(out.match(/<a /g)).toHaveLength(2);
    expect(out).toContain('aria-label="Download"');
    expect(out).toContain('href="/past-papers/p1"');
  });

  it('the Read link leads to the paper', () => {
    expect(html()).toMatch(/<a [^>]*href="\/past-papers\/p1"[^>]*>Read<\/a>/);
  });
});

describe('PaperSheetCard label', () => {
  it('reads "Read", with no sign-in wall, unless a caller locks it', () => {
    expect(html()).toContain('>Read</a>');
    expect(html()).not.toContain('Sign in to read');
  });

  it('says Coming soon for a paper under review', () => {
    expect(html({}, { ...PAPER, needsReview: true })).toContain('Coming soon');
  });
});

describe('PaperSheetCard year and source', () => {
  it('prints the year when there is one', () => {
    const out = html();
    expect(out).toContain('aria-label="Year 2024"');
    expect(out).toContain('>2024</span>');
  });

  it('prints no year for an undated paper (year 0 is not a year)', () => {
    const out = html({}, { ...PAPER, year: 0 });
    expect(out).not.toContain('Year 0');
    expect(out).not.toMatch(/>0<\/span>/);
    expect(out).not.toContain('aria-label="Year');
  });

  it('drops the school line when no school is recorded, never "School not recorded"', () => {
    const out = html({}, { ...PAPER, school: 'School not recorded' });
    expect(out).not.toContain('School not recorded');
    expect(out).toContain('>Read</a>');
  });

  it('keeps a board paper\'s source line as stored', () => {
    expect(html({}, { ...PAPER, school: 'ICSE board paper', year: 0 })).toContain('ICSE board paper');
  });
});
