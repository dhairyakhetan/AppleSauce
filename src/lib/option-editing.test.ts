import { describe, expect, it } from 'vitest';
import { addOption, fromEditable, moveOption, optionsChange, removeOption, toEditable, updateOption } from '@/lib/option-editing';
import { buildQuestionChanges, buildRowChanges } from '@/lib/hod-publish';

/* Owner, 25 Nov 2026: "I can't edit the options" (a typo in option c) of a multiple-choice question). */

const strings = ['a. Having reached on time, the children escaped punishment.', 'b. The children escaped punishment when they reached in time.', 'c. Having leached in time, the children escaped punishment.', 'd. Having reached in time, the children escaped punishment.'];
const pairs = [
  { label: 'a', text: 'Dominion status' },
  { label: 'b', text: 'Full independence', extra: 1 },
];

describe('toEditable / fromEditable', () => {
  it('round-trips plain lines and label-and-text pairs unchanged, keeping fields it does not show', () => {
    expect(fromEditable(toEditable(strings))).toEqual(strings);
    expect(fromEditable(toEditable(pairs))).toEqual(pairs);
  });

  it('drops blank entries, like the screens that show options', () => {
    expect(fromEditable(toEditable(['x', '  ', '', 'y']))).toEqual(['x', 'y']);
  });

  it('is an empty list for no options at all', () => {
    expect(toEditable(null)).toEqual([]);
    expect(toEditable(undefined)).toEqual([]);
    expect(toEditable('not a list')).toEqual([]);
  });
});

describe('optionsChange', () => {
  it('is null when nothing was edited, even if the stored list had blank entries', () => {
    expect(optionsChange(strings, toEditable(strings))).toBeNull();
    expect(optionsChange(['x', '', 'y'], toEditable(['x', '', 'y']))).toBeNull();
  });

  it('sends the whole new list when one option was fixed, words exactly as typed', () => {
    const list = toEditable(strings);
    const fixed = updateOption(list, list[2].id, { text: 'c. Having reached in time, the children escaped punishment.' });
    const out = optionsChange(strings, fixed);
    expect(out).toEqual([strings[0], strings[1], 'c. Having reached in time, the children escaped punishment.', strings[3]]);
    expect(out?.[0]).toBe(strings[0]);
  });

  it('keeps each option in the shape it came in', () => {
    const list = toEditable(pairs);
    const out = optionsChange(pairs, updateOption(list, list[0].id, { text: 'Dominion Status' }));
    expect(out).toEqual([{ label: 'a', text: 'Dominion Status' }, { label: 'b', text: 'Full independence', extra: 1 }]);
  });

  it('does not trim or re-case what was typed', () => {
    const list = toEditable(['one']);
    expect(optionsChange(['one'], updateOption(list, list[0].id, { text: '  Two  ' }))).toEqual(['  Two  ']);
  });

  it('adds, removes and moves options', () => {
    let list = toEditable(['a', 'b', 'c']);
    list = addOption(list);
    list = updateOption(list, list[3].id, { text: 'd' });
    expect(fromEditable(list)).toEqual(['a', 'b', 'c', 'd']);
    list = removeOption(list, list[0].id);
    expect(fromEditable(list)).toEqual(['b', 'c', 'd']);
    list = moveOption(list, list[2].id, -1);
    expect(fromEditable(list)).toEqual(['b', 'd', 'c']);
    expect(moveOption(list, list[0].id, -1)).toBe(list);
  });

  it('an added option takes the shape the others use', () => {
    expect(addOption(toEditable(pairs))[2].shape).toBe('object');
    expect(addOption(toEditable(strings))[4].shape).toBe('string');
    expect(addOption([])[0].shape).toBe('string');
  });

  it('a new option left empty is not sent', () => {
    expect(optionsChange(strings, addOption(toEditable(strings)))).toBeNull();
  });

  it('can empty the list, which stores an empty list', () => {
    const list = toEditable(['a']);
    expect(optionsChange(['a'], removeOption(list, list[0].id))).toEqual([]);
  });
});

describe('the Fix and the paper-line edits carry the options', () => {
  const orig = { body: 'The children reached in time. (Grammatical error)', display_number: '5(iii)(4)', marks: 1, options: strings };

  it('Needs you: a fixed option is sent as options, nothing else', () => {
    const list = toEditable(strings);
    const options = updateOption(list, list[2].id, { text: 'c. Having reached in time, the children escaped punishment.' });
    const r = buildQuestionChanges(orig, { body: orig.body, number: '5(iii)(4)', marks: '1', options });
    expect('changes' in r && Object.keys(r.changes)).toEqual(['options']);
  });

  it('Needs you: no option edit means no options key', () => {
    const r = buildQuestionChanges(orig, { body: orig.body, number: '5(iii)(4)', marks: '1', options: toEditable(strings) });
    expect(r).toEqual({ changes: {} });
  });

  it('ready-to-go-live: the same, through the row editor', () => {
    const row = { kind: 'question', body: orig.body, display_number: '5(iii)(4)', marks: 1, instructions: null, section_label: null, options: strings };
    const list = toEditable(strings);
    const r = buildRowChanges(row, {
      body: orig.body,
      number: '5(iii)(4)',
      marks: '1',
      instructions: '',
      sectionLabel: '',
      options: updateOption(list, list[2].id, { text: 'c. fixed' }),
    });
    expect('changes' in r && r.changes.options).toEqual([strings[0], strings[1], 'c. fixed', strings[3]]);
  });
});
