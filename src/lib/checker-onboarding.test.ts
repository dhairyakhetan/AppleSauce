import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ACTION_LABELS,
  CHECKER_RULES,
  HOD_NOTE,
  NO_ACCOUNT_EXPLAINED,
  WALKTHROUGH_STEPS,
  addHodSteps,
  addVerifierSteps,
  hasSeenWalkthrough,
  markWalkthroughSeen,
  shortcutRows,
} from '@/lib/checker-onboarding';
import { CHECKER_SHORTCUTS } from '@/lib/checker-shortcuts';


function fakeStorage(initial: Record<string, string> = {}) {
  const store = { ...initial };
  return {
    store,
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('walkthrough seen flag', () => {
  it('is per account', () => {
    const ls = fakeStorage();
    vi.stubGlobal('window', { localStorage: ls });
    expect(hasSeenWalkthrough('a')).toBe(false);
    markWalkthroughSeen('a');
    expect(hasSeenWalkthrough('a')).toBe(true);
    expect(hasSeenWalkthrough('b')).toBe(false);
  });

  it('never nags and never throws when storage is blocked', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    vi.stubGlobal('window', { localStorage: blocked });
    expect(hasSeenWalkthrough('a')).toBe(true);
    expect(() => markWalkthroughSeen('a')).not.toThrow();
  });
});

describe('shortcut table on the help page', () => {
  it('has one row per action and the keys come straight from checker-shortcuts.ts', () => {
    const rows = shortcutRows();
    const actions = new Set(CHECKER_SHORTCUTS.map((s) => s.action));
    expect(rows.map((r) => r.action).sort()).toEqual([...actions].sort());
    for (const r of rows) {
      const def = CHECKER_SHORTCUTS.find((s) => s.action === r.action)!;
      expect(r.keys).toBe(def.keys);
      expect(r.label).toBe(ACTION_LABELS[r.action]);
    }
  });
});

describe('walkthrough steps', () => {
  it('point at the real elements, in reading order', () => {
    expect(WALKTHROUGH_STEPS.map((s) => s.target)).toEqual(['paper', 'picture', 'question', 'tools', 'changes', 'pass', 'fix', 'help', 'skip', 'undo']);
  });

  it('every target exists as data-tour in the checker page', () => {
    const page = readFileSync(resolve(__dirname, '../pages/Checker.tsx'), 'utf8') + readFileSync(resolve(__dirname, '../components/checker/VerifyScreen.tsx'), 'utf8') + readFileSync(resolve(__dirname, '../components/checker/TypedBits.tsx'), 'utf8');
    for (const s of WALKTHROUGH_STEPS) {
      const direct = page.includes(`data-tour="${s.target}"`) || page.includes(`tourId="${s.target}"`);
      const viaExpr = s.target === 'picture' && page.includes("'picture'");
      expect(direct || viaExpr, s.target).toBe(true);
    }
  });

  it('uses the live button labels in its titles', () => {
    const page = readFileSync(resolve(__dirname, '../pages/Checker.tsx'), 'utf8') + readFileSync(resolve(__dirname, '../components/checker/VerifyScreen.tsx'), 'utf8');
    for (const label of ['Looks right', 'Fix it', 'Ask the HOD', 'Skip this question', 'Undo last']) {
      expect(page).toContain(label);
      expect(WALKTHROUGH_STEPS.some((s) => s.title === label)).toBe(true);
    }
  });
});

describe('copy', () => {
  it('has no em or en dashes anywhere in the onboarding copy', () => {
    const all = JSON.stringify([WALKTHROUGH_STEPS, CHECKER_RULES, addVerifierSteps('https://x.test'), NO_ACCOUNT_EXPLAINED]);
    expect(all).not.toMatch(/[–—]/);
  });

  it('quotes the live fix rule instead of restating it', () => {
    const rules = CHECKER_RULES.map((r) => r.body).join(' ');
    expect(rules).toContain('Do not reword it, fix its grammar or make it better');
    expect(rules).toContain('The printed paper has a typo, and I corrected it');
  });

  it('the admin guide gives the three steps and explains the no-account error', () => {
    const steps = addVerifierSteps('https://x.test');
    expect(steps).toHaveLength(3);
    expect(steps[2]).toContain('https://x.test/checker');
    expect(NO_ACCOUNT_EXPLAINED).toMatch(/not signed up/);
    expect(NO_ACCOUNT_EXPLAINED).toMatch(/different email/);
  });

  it('calls them verifiers, never students or checkers, in the admin guides', () => {
    const words = JSON.stringify([addVerifierSteps('https://x.test'), NO_ACCOUNT_EXPLAINED, addHodSteps('https://x.test'), HOD_NOTE]);
    expect(words.replace(/https:\/\/x\.test\/\w+/g, '')).not.toMatch(/student|checker/i);
  });
});
