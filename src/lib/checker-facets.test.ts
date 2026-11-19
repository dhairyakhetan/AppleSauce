import { describe, expect, it } from 'vitest';

import { facetChoices, keepOffered, waitingFor, classLabel, shouldAskForPreferences, FALLBACK_CLASSES, FALLBACK_SUBJECTS } from './checker-facets';


// The shape of the live kid queue on 2026-09-28: Roman classes, full
// subject names (audit_papers values), never the site's 'Maths' or '10'.
const ROWS = [
  { subject: 'Mathematics', cls: 'X', waiting: 180 },
  { subject: 'Mathematics', cls: 'XII', waiting: 80 },
  { subject: 'Economics', cls: 'XII', waiting: 216 },
  { subject: 'English', cls: 'VII', waiting: 20 },
];

describe('facetChoices', () => {
  it('offers exactly the values waiting in the queue, with counts', () => {
    const c = facetChoices(ROWS);
    expect(c.subjects).toEqual([
      { value: 'Economics', waiting: 216 },
      { value: 'English', waiting: 20 },
      { value: 'Mathematics', waiting: 260 },
    ]);
    expect(c.classes.map((x) => x.value)).toEqual(['VII', 'X', 'XII']);
  });

  it('falls back to the audit vocabulary, never the site facets', () => {
    const c = facetChoices(null);
    expect(c.subjects.map((s) => s.value)).toContain('Mathematics');
    expect(c.subjects.map((s) => s.value)).not.toContain('Maths');
    expect(c.classes.map((s) => s.value)).toContain('X');
    expect(c.classes.map((s) => s.value)).not.toContain('10');
    expect(FALLBACK_SUBJECTS.length).toBeGreaterThan(0);
    expect(FALLBACK_CLASSES).toContain('XII');
  });
});

describe('keepOffered', () => {
  it('drops stale picks the queue cannot match (the old site values)', () => {
    const offered = facetChoices(ROWS).subjects;
    expect(keepOffered(['Maths', 'Economics'], offered)).toEqual(['Economics']);
  });
  it('keeps everything when the offer is unknown', () => {
    expect(keepOffered(['Maths'], null)).toEqual(['Maths']);
  });
});

describe('waitingFor', () => {
  it('counts what a choice would serve', () => {
    expect(waitingFor(ROWS, [], [])).toBe(496);
    expect(waitingFor(ROWS, ['Mathematics'], [])).toBe(260);
    expect(waitingFor(ROWS, ['Mathematics'], ['XII'])).toBe(80);
    expect(waitingFor(ROWS, [], ['10'])).toBe(0);
    expect(waitingFor(null, ['Mathematics'], [])).toBeNull();
  });
});

describe('classLabel', () => {
  it('adds the number a student may think in', () => {
    expect(classLabel('X')).toBe('X (10)');
    expect(classLabel('XII')).toBe('XII (12)');
    expect(classLabel('UG')).toBe('UG');
  });
});

describe('shouldAskForPreferences', () => {
  it('does not ask again after the checker chose All (stored as two nulls)', () => {
    expect(shouldAskForPreferences({ subjects: null, classes: null, chosen: true })).toBe(false);
    expect(shouldAskForPreferences({ subjects: null, classes: null, chosen: false })).toBe(true);
  });
  it('falls back to the old rule before the migration adds `chosen`', () => {
    expect(shouldAskForPreferences({ subjects: null, classes: null })).toBe(true);
    expect(shouldAskForPreferences({ subjects: ['English'], classes: null })).toBe(false);
  });
});
