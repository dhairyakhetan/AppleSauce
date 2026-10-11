import { describe, expect, it } from 'vitest';
import { buildPaperSeo, paperEducationalLevel, shortenSchool, TITLE_SOFT_LIMIT } from './paper-seo';

const base = {
  school: 'La Martiniere For Boys',
  board: 'ICSE',
  cls: 'X',
  subject: 'Mathematics',
  exam: 'Pre-board Examination',
  year: '2024',
  questionCount: 40,
};

describe('buildPaperSeo', () => {
  it('puts board and exam in the title and uses the site subject name', () => {
    const { title } = buildPaperSeo({ ...base, school: 'Loreto House', exam: 'Sample Paper' });
    expect(title).toContain('Loreto House ICSE Class X Maths Sample Paper 2024 Question Paper');
  });

  it('omits an empty exam, an Unknown exam, the generic Board and a null year', () => {
    expect(buildPaperSeo({ ...base, exam: null }).title).not.toMatch(/Examination/);
    expect(buildPaperSeo({ ...base, exam: 'Unknown', school: 'Loreto House' }).title)
      .toBe('Loreto House ICSE Class X Maths 2024 Question Paper | Shikshaq');
    expect(buildPaperSeo({ ...base, board: 'Board', exam: 'Unknown', school: 'Loreto House' }).title)
      .toBe('Loreto House Class X Maths 2024 Question Paper | Shikshaq');
    expect(buildPaperSeo({ ...base, year: 'null', exam: 'Unknown', school: 'Loreto House' }).title)
      .toBe('Loreto House ICSE Class X Maths Question Paper | Shikshaq');
  });

  it('never writes PDF or Solved and never a double space', () => {
    const { title, description, heading } = buildPaperSeo({ ...base, exam: '', board: '' });
    for (const text of [title, description, heading]) {
      expect(text).not.toMatch(/pdf|solved/i);
      expect(text).not.toMatch(/ {2}/);
    }
  });

  it('drops the suffix first when the title is over the soft limit', () => {
    const { title } = buildPaperSeo({ ...base, school: 'Don Bosco', exam: 'Test' });
    expect(title).toBe('Don Bosco ICSE Class X Maths Test 2024 Question Paper | Shikshaq');
    const over = buildPaperSeo({ ...base, school: 'Loreto House', exam: 'Half Yearly Examination' });
    expect(over.title.endsWith('| Shikshaq')).toBe(false);
    expect(over.title).toBe('Loreto House ICSE Class X Maths Half Yearly Examination 2024 Question Paper');
    expect(TITLE_SOFT_LIMIT).toBe(65);
  });

  it('then shortens the school by whole words, never mid-word', () => {
    const long = buildPaperSeo({
      ...base,
      school: 'Mahadevi Birla World Academy Senior Secondary School',
      exam: 'Pre-board Examination',
    });
    expect(long.title.endsWith('Question Paper')).toBe(true);
    expect(long.title.startsWith('Mahadevi Birla')).toBe(true);
    for (const word of long.title.split(' ')) expect(word.length).toBeGreaterThan(0);
    expect(long.heading).toContain('Mahadevi Birla World Academy Senior Secondary School');
  });

  it('leaves out a school that is not a real school', () => {
    expect(buildPaperSeo({ ...base, school: 'ICSE board paper', exam: 'Unknown' }).title)
      .toBe('ICSE Class X Maths 2024 Question Paper | Shikshaq');
    expect(buildPaperSeo({ ...base, school: null, exam: 'Unknown' }).school).toBe('');
  });

  it('builds the approved description', () => {
    const { description } = buildPaperSeo({ ...base, school: 'Loreto House', exam: 'Unknown' });
    expect(description).toBe(
      'All 40 questions from the Loreto House ICSE Class X Maths 2024 question paper, with marks and chapters. First two open to everyone, the rest free with an account.',
    );
    expect(buildPaperSeo({ ...base, questionCount: 1 }).description).toMatch(/^The 1 question from .*, open to everyone.$/);
  });

  it('H1 gains the board but not the exam', () => {
    expect(buildPaperSeo({ ...base, school: 'Loreto House' }).heading)
      .toBe('Loreto House ICSE Class X Maths 2024 question paper');
  });
});

describe('paperEducationalLevel', () => {
  it('joins board and class, skipping the generic board', () => {
    expect(paperEducationalLevel({ board: 'ICSE', cls: 'X' })).toBe('ICSE Class X');
    expect(paperEducationalLevel({ board: 'Board', cls: 'X' })).toBe('Class X');
  });
});

describe('shortenSchool', () => {
  it('keeps at least two words', () => {
    expect(shortenSchool('A B C D', () => false)).toBe('A B');
    expect(shortenSchool('Solo', () => false)).toBe('Solo');
  });
});
