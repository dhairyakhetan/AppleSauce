import { describe, expect, it } from 'vitest';
import { coverPaper, coverMeta, pickVariedRecent, type CoverSourcePaper } from './paper-cover-mapping';

function bankPaper(overrides: Partial<CoverSourcePaper> = {}): CoverSourcePaper {
  return {
    id: 'id-1',
    title: 'Class 10 Maths',
    school: 'La Martiniere',
    subject: 'Maths',
    class: '10',
    board: 'ICSE',
    exam_type: 'Half Yearly Examination',
    year: 2025,
    _bankYear: '2025',
    _questions: 42,
    _isBoard: false,
    _needsReview: false,
    ...overrides,
  };
}

describe('coverPaper', () => {
  it('returns the paper unchanged when it is not a bank row', () => {
    const p: CoverSourcePaper = { ...bankPaper(), _questions: undefined };
    expect(coverPaper(p)).toBe(p);
  });

  it('uses the school as the headline for a school paper', () => {
    const shown = coverPaper(bankPaper());
    expect(shown.subject).toBe('La Martiniere');
    expect(shown.board).toBe('ICSE · 2025');
    expect(shown.title).toBe('Half Yearly');
    expect(shown.year).toBe('42 questions');
  });

  it('uses the year as the headline for a board paper, and drops the year from the eyebrow', () => {
    const shown = coverPaper(bankPaper({ _isBoard: true, school: 'ICSE Board' }));
    expect(shown.subject).toBe('2025');
    expect(shown.board).toBe('ICSE');
  });

  it('strips " Examination" and folds any Pre-board variant to one label', () => {
    expect(coverPaper(bankPaper({ exam_type: 'Pre-board 1 Examination' })).title).toBe('Pre-board');
    expect(coverPaper(bankPaper({ exam_type: 'Final Examination' })).title).toBe('Final');
  });

  it('falls back to the raw board when the year is unknown', () => {
    const shown = coverPaper(bankPaper({ _bankYear: 'year-unknown', _isBoard: true }));
    expect(shown.board).toBe('ICSE');
  });
});

describe('coverMeta', () => {
  it('includes the real subject when the headline shows the school instead', () => {
    expect(coverMeta(bankPaper())).toEqual(['Maths', 'Class 10']);
  });

  it('includes the school when the headline shows the year instead (a board paper)', () => {
    const meta = coverMeta(bankPaper({ _isBoard: true, school: 'ICSE Board' }));
    expect(meta).toEqual(['Maths', 'Class 10', 'ICSE Board']);
  });

  it('never repeats a fact the headline or eyebrow already shows', () => {
    // School paper: headline IS the school, so the school must not repeat in meta.
    const meta = coverMeta(bankPaper({ school: 'La Martiniere' }));
    expect(meta).not.toContain('La Martiniere');
  });
});

describe('pickVariedRecent', () => {
  it('returns at most `limit` papers, newest year first', () => {
    const papers = [
      bankPaper({ id: 'a', year: 2020, subject: 'Maths' }),
      bankPaper({ id: 'b', year: 2026, subject: 'English' }),
      bankPaper({ id: 'c', year: 2023, subject: 'Biology' }),
    ];
    const picked = pickVariedRecent(papers, 2);
    expect(picked.map((p) => p.id)).toEqual(['b', 'c']);
  });

  it('never puts two papers with the same subject/class/board combo ahead of an unseen combo', () => {
    // Five ICSE Class 10 Maths papers (same combo, different years) and one
    // English paper buried at the oldest year. A naive year-desc slice(0, 3)
    // would show three identical-looking Maths covers and never reach
    // English; the picker must surface English instead of a second Maths.
    const papers = [
      bankPaper({ id: 'maths-2026', year: 2026, subject: 'Maths' }),
      bankPaper({ id: 'maths-2025', year: 2025, subject: 'Maths' }),
      bankPaper({ id: 'maths-2024', year: 2024, subject: 'Maths' }),
      bankPaper({ id: 'maths-2023', year: 2023, subject: 'Maths' }),
      bankPaper({ id: 'english-2020', year: 2020, subject: 'English' }),
    ];
    const picked = pickVariedRecent(papers, 2);
    expect(picked.map((p) => p.id)).toEqual(['maths-2026', 'english-2020']);
  });

  it('fills remaining slots with leftovers once every combination has one pick', () => {
    const papers = [
      bankPaper({ id: 'maths-2026', year: 2026, subject: 'Maths' }),
      bankPaper({ id: 'english-2025', year: 2025, subject: 'English' }),
      bankPaper({ id: 'maths-2024', year: 2024, subject: 'Maths' }),
    ];
    const picked = pickVariedRecent(papers, 3);
    expect(picked.map((p) => p.id)).toEqual(['maths-2026', 'english-2025', 'maths-2024']);
  });

  it('returns fewer than `limit` when the source itself has fewer papers', () => {
    const papers = [bankPaper({ id: 'only-one' })];
    expect(pickVariedRecent(papers, 10).map((p) => p.id)).toEqual(['only-one']);
  });

  it('prefers an openable paper over a needs_review one when years tie', () => {
    const papers = [
      bankPaper({ id: 'pending', year: 2026, subject: 'Maths', _needsReview: true }),
      bankPaper({ id: 'ready', year: 2026, subject: 'English', _needsReview: false }),
    ];
    // Different combos, so both get picked — but 'ready' must sort first.
    const picked = pickVariedRecent(papers, 2);
    expect(picked.map((p) => p.id)).toEqual(['ready', 'pending']);
  });

  it('is stable across otherwise-identical rows (school, then id)', () => {
    const papers = [
      bankPaper({ id: 'z-paper', year: 2026, subject: 'Maths', school: 'Zed School' }),
      bankPaper({ id: 'a-paper', year: 2026, subject: 'English', school: 'Aaa School' }),
    ];
    const picked = pickVariedRecent(papers, 2);
    expect(picked.map((p) => p.id)).toEqual(['a-paper', 'z-paper']);
  });
});
