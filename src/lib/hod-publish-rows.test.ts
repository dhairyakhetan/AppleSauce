import { describe, expect, it } from 'vitest';
import { buildRowChanges, isQuestionRow, type RowDraft, type RowOriginal } from '@/lib/hod-publish';

const question: RowOriginal = {
  kind: 'question',
  body: 'What is the normal term of office of the Lok Sabha?',
  display_number: '1(a)',
  marks: 1,
  instructions: 'Attempt all questions from this Part QUESTION 1',
  section_label: null,
};
const same = (o: RowOriginal): RowDraft => ({
  body: o.body,
  number: o.display_number ?? '',
  marks: o.marks != null ? String(o.marks) : '',
  instructions: o.instructions ?? '',
  sectionLabel: o.section_label ?? '',
});

describe('buildRowChanges', () => {
  it('sends nothing when nothing changed', () => {
    expect(buildRowChanges(question, same(question))).toEqual({ changes: {} });
  });

  it("lets a question's own instructions be fixed, and nothing else is sent", () => {
    const r = buildRowChanges(question, { ...same(question), instructions: 'Attempt all questions from this Part.' });
    expect(r).toEqual({ changes: { instructions: 'Attempt all questions from this Part.' } });
  });

  it('clears instructions and heading with null', () => {
    const r = buildRowChanges({ ...question, section_label: 'PART I' }, { ...same(question), instructions: '  ', sectionLabel: '' });
    expect(r).toEqual({ changes: { instructions: null, section_label: null } });
  });

  it('sets a heading above a question', () => {
    expect(buildRowChanges(question, { ...same(question), sectionLabel: 'PART I' })).toEqual({ changes: { section_label: 'PART I' } });
  });

  it('keeps the words exactly as typed, with no trimming', () => {
    const r = buildRowChanges(question, { ...same(question), body: ' What  is it? ' });
    expect(r).toEqual({ changes: { body: ' What  is it? ' } });
  });

  it('refuses to empty a question', () => {
    expect('error' in buildRowChanges(question, { ...same(question), body: '   ' })).toBe(true);
  });

  it('lets a heading or instruction line be emptied, so a stray line can be removed', () => {
    const line: RowOriginal = { kind: 'section_break', body: 'PART I ATTEMPT ALL ... QUESTION 1 (A)', display_number: null, marks: null, instructions: null, section_label: null };
    expect(buildRowChanges(line, { ...same(line), body: '' })).toEqual({ changes: { body: '' } });
  });

  it('does not send a number or marks for a heading line', () => {
    const line: RowOriginal = { kind: 'section_break', body: 'PART I', display_number: null, marks: null, instructions: null, section_label: null };
    const r = buildRowChanges(line, { ...same(line), body: 'PART II', number: '9', marks: '4' });
    expect(r).toEqual({ changes: { body: 'PART II' } });
  });

  it('refuses a bad marks box on a question', () => {
    expect('error' in buildRowChanges(question, { ...same(question), marks: 'abc' })).toBe(true);
  });

  it('knows which lines are real questions', () => {
    expect(isQuestionRow('question')).toBe(true);
    expect(isQuestionRow('section_break')).toBe(false);
    expect(isQuestionRow('master_instruction')).toBe(false);
  });
});
