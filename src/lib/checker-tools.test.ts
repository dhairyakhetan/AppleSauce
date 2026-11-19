import { describe, expect, it } from 'vitest';

import { CHECKER_TOOLS, toolBlockedByUnsavedEdit, toolById, UNSAVED_EDIT_NOTE } from './checker-tools';
import { CHECKER_TOOL_RULES } from './checker-onboarding';

describe('the four tools', () => {
  it('are Fix the words, Split into two questions, Edit a formula and This is just the OR, in that order', () => {
    expect(CHECKER_TOOLS.map((t) => t.label)).toEqual(['Fix the words', 'Split into two questions', 'Edit a formula', 'This is just the OR']);
    expect(CHECKER_TOOLS.map((t) => t.id)).toEqual(['fix', 'split', 'formula', 'or']);
  });

  it('each has a one line explanation, a reason for when it does not apply and a help paragraph', () => {
    for (const t of CHECKER_TOOLS) {
      expect(t.hint.length, t.id).toBeGreaterThan(20);
      expect(t.hint, t.id).not.toMatch(/\n/);
      expect(t.unavailable.length, t.id).toBeGreaterThan(10);
      expect(t.help.length, t.id).toBeGreaterThan(t.hint.length);
    }
  });

  it('are all on the Help page, from the same words', () => {
    expect(CHECKER_TOOL_RULES.map((r) => r.title)).toEqual(CHECKER_TOOLS.map((t) => t.label));
    for (const t of CHECKER_TOOLS) expect(CHECKER_TOOL_RULES.find((r) => r.title === t.label)?.body).toBe(t.help);
  });

  it('has no em or en dashes', () => {
    expect(JSON.stringify(CHECKER_TOOLS)).not.toMatch(/[–—]/);
  });

  it('finds a tool by id', () => {
    expect(toolById('formula').label).toBe('Edit a formula');
  });
});

describe('tools that would throw away an unsaved Fix it draft', () => {
  it('blocks Split and the OR tool while Fix it has typed changes', () => {
    expect(toolBlockedByUnsavedEdit('split', 'fix', true)).toBe(UNSAVED_EDIT_NOTE);
    expect(toolBlockedByUnsavedEdit('or', 'fix', true)).toBe(UNSAVED_EDIT_NOTE);
  });

  it('lets them through when nothing has been typed, or on the plain check view', () => {
    expect(toolBlockedByUnsavedEdit('split', 'fix', false)).toBeNull();
    expect(toolBlockedByUnsavedEdit('or', 'fix', false)).toBeNull();
    expect(toolBlockedByUnsavedEdit('split', 'check', true)).toBeNull();
  });

  it('never blocks the two edit tools', () => {
    expect(toolBlockedByUnsavedEdit('fix', 'fix', true)).toBeNull();
    expect(toolBlockedByUnsavedEdit('formula', 'fix', true)).toBeNull();
  });

  it('says it without dashes', () => {
    expect(UNSAVED_EDIT_NOTE).not.toMatch(/[–—]/);
  });
});
