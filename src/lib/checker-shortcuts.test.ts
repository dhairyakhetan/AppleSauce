import { describe, expect, it } from 'vitest';

import { matchCheckerShortcut, CHECKER_SHORTCUTS, shortcutHint } from './checker-shortcuts';

describe('matchCheckerShortcut, browser shortcuts and focused buttons', () => {
  it('never fires while Ctrl, Cmd or Alt is held (Ctrl+F is find, Ctrl+P is print)', () => {
    for (const key of ['f', 'p', 'k', 'h', 's', 'Enter']) {
      expect(matchCheckerShortcut(key, { isTyping: false, hasModifier: true })).toBeNull();
    }
  });

  it('lets a focused button handle Enter itself instead of also passing', () => {
    expect(matchCheckerShortcut('Enter', { isTyping: false, onActivatable: true })).toBeNull();
    expect(matchCheckerShortcut('p', { isTyping: false, onActivatable: true })).toBe('pass');
  });
});

describe('shortcutHint', () => {
  it('only mentions split when split is available', () => {
    expect(shortcutHint({ canSplit: false, canPass: true })).not.toMatch(/split/i);
    expect(shortcutHint({ canSplit: true, canPass: true })).toMatch(/S split/);
  });

  it('drops the pass hint when the question cannot be passed as it is', () => {
    expect(shortcutHint({ canSplit: false, canPass: false })).not.toMatch(/looks right/);
  });

  it('has no em or en dash', () => {
    expect(shortcutHint({ canSplit: true, canPass: true })).not.toMatch(/[–—]/);
  });
});

/**
 * Kid Mode's keyboard shortcuts are a class 9-12 student's main input on a
 * laptop -- a regression here silently breaks "press Enter to pass" for
 * every checker, which is easy to miss in manual testing because clicking
 * the button still works fine.
 */

describe('matchCheckerShortcut', () => {
  it('maps Enter and P to pass', () => {
    expect(matchCheckerShortcut('Enter', false)).toBe('pass');
    expect(matchCheckerShortcut('p', false)).toBe('pass');
    expect(matchCheckerShortcut('P', false)).toBe('pass');
  });

  it('maps F to fix, S to split, H to help, K to skip', () => {
    expect(matchCheckerShortcut('f', false)).toBe('fix');
    expect(matchCheckerShortcut('s', false)).toBe('split');
    expect(matchCheckerShortcut('h', false)).toBe('help');
    expect(matchCheckerShortcut('k', false)).toBe('skip');
  });

  it('returns null for an unmapped key', () => {
    expect(matchCheckerShortcut('x', false)).toBeNull();
    expect(matchCheckerShortcut('1', false)).toBeNull();
  });

  it('suppresses every shortcut while typing, so editing a body never fires an action', () => {
    for (const key of ['Enter', 'p', 'f', 's', 'h', 'k']) {
      expect(matchCheckerShortcut(key, true)).toBeNull();
    }
  });

  it('has no duplicate key bindings in the registry', () => {
    // 'enter' and 'p' both map to 'pass' by design (two keys, one action),
    // but no single KEY should ever be bound to two different actions.
    const keys = CHECKER_SHORTCUTS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);

    const passBindings = CHECKER_SHORTCUTS.filter((s) => s.action === 'pass');
    expect(passBindings.map((b) => b.key).sort()).toEqual(['enter', 'p']);
  });
});
