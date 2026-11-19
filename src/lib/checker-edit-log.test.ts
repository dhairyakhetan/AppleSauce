import { describe, expect, it } from 'vitest';

import {
  CHANGES_HEADING,
  CHANGES_NONE_WRITTEN,
  CHANGES_NOTE,
  EDIT_KINDS,
  RAW_HIDE,
  RAW_NOTE,
  RAW_SHOW,
  clipText,
  describeEdit,
  describeEditLog,
  hasChangesToShow,
  rawReading,
  readEditLog,
} from './checker-edit-log';

describe('readEditLog', () => {
  it('reads the list the pipeline writes', () => {
    const source = { edit_log: [{ kind: 'joined_lines', from: 'a\nb', to: 'a b' }, { kind: 'fixed_ocr_word', from: 'rn', to: 'm' }] };
    expect(readEditLog(source)).toEqual([
      { kind: 'joined_lines', from: 'a\nb', to: 'a b' },
      { kind: 'fixed_ocr_word', from: 'rn', to: 'm' },
    ]);
  });

  it('gives an empty list for older rows and for odd shapes, and never throws', () => {
    for (const s of [null, undefined, 'x', 3, [], {}, { edit_log: null }, { edit_log: 'oops' }, { edit_log: {} }]) {
      expect(readEditLog(s)).toEqual([]);
    }
  });

  it('drops entries with no kind and fills missing from/to with empty text', () => {
    const source = { edit_log: [null, 4, 'x', { from: 'a' }, { kind: '' }, { kind: 'moved_marks' }, { kind: 'fixed_ocr_word', from: 1, to: null }] };
    expect(readEditLog(source)).toEqual([
      { kind: 'moved_marks', from: '', to: '' },
      { kind: 'fixed_ocr_word', from: '1', to: '' },
    ]);
  });
});

describe('describeEdit: every kind has a plain-language label', () => {
  const expected: Record<string, string> = {
    joined_lines: 'Joined broken lines',
    moved_marks: 'Moved the marks out',
    reattached_label: 'Put the question number back where it belongs',
    reordered_options: 'Put the answer options in order',
    split_fused: 'Pulled two questions apart',
    removed_noise: 'Removed stray marks from the page',
    restored_blank: 'Put a blank line back',
    normalised_format: 'Tidied spaces and punctuation',
  };

  it('knows all nine kinds the pipeline writes', () => {
    expect([...EDIT_KINDS].sort()).toEqual(
      ['fixed_ocr_word', ...Object.keys(expected)].sort(),
    );
  });

  it('labels each kind', () => {
    for (const [kind, label] of Object.entries(expected)) {
      expect(describeEdit({ kind, from: '', to: '' }).text).toBe(label);
    }
  });

  it('names the word for a fixed word', () => {
    const line = describeEdit({ kind: 'fixed_ocr_word', from: 'rn', to: 'm' });
    expect(line.text).toBe('Fixed a word: rn became m');
    expect(line.from).toBe('rn');
    expect(line.to).toBe('m');
  });

  it('falls back to a plain label when a fixed word has no before or after', () => {
    expect(describeEdit({ kind: 'fixed_ocr_word', from: '', to: 'm' }).text).toBe('Fixed a word');
  });

  it('names what was removed as noise, when it says', () => {
    expect(describeEdit({ kind: 'removed_noise', from: 'L1', to: '' }).text).toBe('Removed stray marks from the page: L1');
    expect(describeEdit({ kind: 'removed_noise', from: '', to: '' }).text).toBe('Removed stray marks from the page');
  });

  it('does not dump a whole joined paragraph into the list', () => {
    const long = 'word '.repeat(60);
    const line = describeEdit({ kind: 'joined_lines', from: long, to: long });
    expect(line.text).toBe('Joined broken lines');
    expect(line.from).toBeNull();
  });

  it('gives an unknown kind a generic label instead of the code', () => {
    const line = describeEdit({ kind: 'something_new', from: 'a', to: 'b' });
    expect(line.text).toBe('Made a small change');
    expect(line.text).not.toContain('something_new');
  });
});

describe('describeEditLog', () => {
  it('counts repeats of a change that names no word', () => {
    const source = { edit_log: [{ kind: 'joined_lines' }, { kind: 'joined_lines' }, { kind: 'joined_lines' }, { kind: 'moved_marks' }] };
    const { lines, hidden } = describeEditLog(source);
    expect(lines.map((l) => l.text)).toEqual(['Joined broken lines (3 times)', 'Moved the marks out']);
    expect(hidden).toBe(0);
  });

  it('keeps each fixed word on its own line', () => {
    const source = { edit_log: [{ kind: 'fixed_ocr_word', from: 'rn', to: 'm' }, { kind: 'fixed_ocr_word', from: 'l', to: '1' }] };
    expect(describeEditLog(source).lines.map((l) => l.text)).toEqual(['Fixed a word: rn became m', 'Fixed a word: l became 1']);
  });

  it('caps a very long list and says how many were left out', () => {
    const source = { edit_log: Array.from({ length: 60 }, (_, i) => ({ kind: 'fixed_ocr_word', from: `a${i}`, to: `b${i}` })) };
    const { lines, hidden } = describeEditLog(source);
    expect(lines).toHaveLength(40);
    expect(hidden).toBe(20);
  });

  it('totals every change, also the ones past the cap, for the count badge', () => {
    const source = { edit_log: Array.from({ length: 60 }, (_, i) => ({ kind: 'fixed_ocr_word', from: `a${i}`, to: `b${i}` })) };
    expect(describeEditLog(source).total).toBe(60);
    const repeats = { edit_log: [{ kind: 'joined_lines' }, { kind: 'joined_lines' }, { kind: 'moved_marks' }] };
    expect(describeEditLog(repeats).total).toBe(3);
  });

  it('is empty for a row with no log', () => {
    expect(describeEditLog(null)).toEqual({ lines: [], hidden: 0, total: 0 });
  });
});

describe('rawReading and hasChangesToShow', () => {
  it('returns the raw text exactly as stored', () => {
    expect(rawReading('  Find the rnean  \n')).toBe('  Find the rnean  \n');
  });

  it('returns null for missing or blank readings', () => {
    for (const r of [null, undefined, '', '   \n', 4, {}]) expect(rawReading(r)).toBeNull();
  });

  it('shows the section when there is a log or a raw reading, and not otherwise', () => {
    expect(hasChangesToShow({ edit_log: [{ kind: 'moved_marks' }] }, null)).toBe(true);
    expect(hasChangesToShow(null, 'raw text')).toBe(true);
    expect(hasChangesToShow({}, '')).toBe(false);
    expect(hasChangesToShow(null, undefined)).toBe(false);
  });
});

describe('clipText', () => {
  it('flattens spaces and adds an ellipsis only when cut', () => {
    expect(clipText('a   b\n c')).toBe('a b c');
    expect(clipText('x'.repeat(50), 10)).toBe('xxxxxxxxxx...');
  });
});

describe('copy', () => {
  it('has no em or en dashes and reads like plain speech', () => {
    const all = [CHANGES_HEADING, CHANGES_NOTE, CHANGES_NONE_WRITTEN, RAW_SHOW, RAW_HIDE, RAW_NOTE, ...EDIT_KINDS.map((k) => describeEdit({ kind: k, from: 'a', to: 'b' }).text)].join(' ');
    expect(all).not.toMatch(/[–—]/);
    expect(CHANGES_HEADING).toBe('What the computer changed');
    expect(RAW_SHOW).toBe("Show the computer's first reading");
  });
});
