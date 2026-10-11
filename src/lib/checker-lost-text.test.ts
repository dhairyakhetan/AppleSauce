import { describe, expect, it } from 'vitest';

import { lostTextSuggestion, studentEvidence, suggestionFromText } from './checker-lost-text';

const detail = (body: string, extra = 'AI check: disagree (flag vs fix); Sonnet fix at 0.70') =>
  JSON.stringify({ other: `${extra} | suggestion: ${JSON.stringify({ body })}` });

describe('lost text suggestion', () => {
  it('reads the transcription from flag_detail for a blank body, verbatim', () => {
    const body = 'Question 6.\n(a) Mention a { brace } and a "quote". [2]\nUnicode ‘Inflation’ ?';
    expect(lostTextSuggestion('', detail(body))).toBe(body);
    expect(lostTextSuggestion('  \n ', detail(body))).toBe(body);
  });

  it('offers nothing when the question already has words', () => {
    expect(lostTextSuggestion('Define demand.', detail('Something else'))).toBeNull();
  });

  it('offers nothing when there is no usable suggestion', () => {
    expect(lostTextSuggestion('', null)).toBeNull();
    expect(lostTextSuggestion('', JSON.stringify({ other: 'AI check: disagree' }))).toBeNull();
    expect(lostTextSuggestion('', JSON.stringify({ other: 'x | suggestion: {"body": "   "}' }))).toBeNull();
    expect(lostTextSuggestion('', JSON.stringify({ other: 'x | suggestion: {"body": "cut off' }))).toBeNull();
    expect(lostTextSuggestion('', JSON.stringify({ other: 'x | suggestion: {"marks": 3}' }))).toBeNull();
    expect(lostTextSuggestion('', 'not json at all')).toBeNull();
  });

  it('finds the suggestion under any code, or in a bare string', () => {
    expect(lostTextSuggestion('', JSON.stringify({ empty_body: 'x | suggestion: {"body": "Name it."}' }))).toBe('Name it.');
    expect(suggestionFromText('note | suggestion: {"body": "Name it."}')).toBe('Name it.');
  });

  it('strips the machine tail from evidence, and drops AI check text', () => {
    expect(studentEvidence('The marks look wrong | suggestion: {"body": "x"}')).toBe('The marks look wrong');
    expect(studentEvidence('AI check: guardrail G1 | suggestion: {"body": "x"}')).toBeNull();
    expect(studentEvidence('plain')).toBe('plain');
    expect(studentEvidence(null)).toBeNull();
  });
});
