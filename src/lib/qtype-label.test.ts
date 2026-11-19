import { describe, expect, it } from 'vitest';

import { qtypeLabel } from './qtype-label';

describe('qtypeLabel', () => {
  it('labels the pipeline enum', () => {
    expect(qtypeLabel('mcq')).toBe('MCQ');
    expect(qtypeLabel('short_answer')).toBe('Short answer');
    expect(qtypeLabel('long_answer')).toBe('Long answer');
    expect(qtypeLabel('fill_in_blank')).toBe('Fill in the blank');
    expect(qtypeLabel('true_false')).toBe('True or false');
    expect(qtypeLabel('context_map')).toBe('Map based');
    expect(qtypeLabel('other')).toBe('Other');
  });

  it('still reads the old live vocabulary', () => {
    expect(qtypeLabel('MCQ')).toBe('MCQ');
    expect(qtypeLabel('short')).toBe('Short answer');
    expect(qtypeLabel('Short Answer')).toBe('Short answer');
    expect(qtypeLabel('Long Answer')).toBe('Long answer');
    expect(qtypeLabel('sub')).toBe('Short answer');
    expect(qtypeLabel('Fill in the Blank')).toBe('Fill in the blank');
    expect(qtypeLabel('True/False')).toBe('True or false');
    expect(qtypeLabel('context:image')).toBe('Picture based');
    expect(qtypeLabel('context:poem_extract')).toBe('Poem extract');
  });

  it('returns null when there is nothing to show', () => {
    expect(qtypeLabel(null)).toBeNull();
    expect(qtypeLabel(undefined)).toBeNull();
    expect(qtypeLabel('   ')).toBeNull();
  });

  it('tidies an unknown value instead of printing a raw token', () => {
    expect(qtypeLabel('very_short')).toBe('Very short');
    expect(qtypeLabel('context:something_new')).toBe('Context something new');
  });

  it('never uses an em or en dash in any label', () => {
    const samples = [
      'mcq', 'short_answer', 'long_answer', 'fill_in_blank', 'true_false',
      'definition', 'identify', 'composition', 'context_thematic', 'context_image',
      'context_quote', 'context_map', 'other', 'short', 'long', 'sub',
      'context:passage', 'context:prose_extract', 'context:poem_extract',
      'context:dialogue', 'context:table', 'weird_value',
    ];
    for (const s of samples) {
      expect(qtypeLabel(s)).not.toMatch(/[–—]/);
    }
  });
});
