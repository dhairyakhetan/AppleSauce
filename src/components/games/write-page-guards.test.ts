import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/* Source checks (tests run in node, with no browser) for behaviour that only shows in a browser. */
const read = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');
const write = read('./WriteQuestions.tsx');
const revise = read('./Revise.tsx');
const css = read('./games.css');

describe('Write questions: guards', () => {
  it('runs the timed autocorrect only while the Questions box itself has focus', () => {
    expect(write).toMatch(/setTimeout\(\(\) => \{ if \(document\.activeElement === boxRef\.current\) runFix\(true\); \}, 1000\)/);
  });

  it('never cuts into a word a phone or Indic keyboard is still composing', () => {
    expect(write).toContain('onCompositionStart={() => { composing.current = true; }}');
    expect(write).toContain('onCompositionEnd={() => { composing.current = false; }}');
    expect(write).toMatch(/if \(focused && composing\.current\) return;/);
  });

  it('brings a removed sent-back question back when "See why" points at it', () => {
    expect(write).toMatch(/const seeWhy = \(ids: string\[\]\) => \{\s*onDismiss\(ids, false\);/);
  });

  it('says under the tabs what a tapped greyed-out game needs (a hover note never shows on a phone)', () => {
    expect(revise).toContain('else setAsked(t);');
    expect(revise).toMatch(/role="status"[\s\S]{0,200}whyNot\(asked, items, false\)/);
  });

  it('colours the Questions box from Shikshaq\'s colour variables only', () => {
    const rules = css.split('\n').filter((l) => /^\.gl-[a-z]+ \{ color:/.test(l));
    expect(rules.length).toBeGreaterThan(5);
    for (const r of rules) expect(r).toMatch(/var\(--/);
  });
});
