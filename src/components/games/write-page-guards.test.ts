import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/* Source checks (tests run in node, with no browser) for behaviour that only shows in a browser. */
const read = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');
const write = read('./WriteQuestions.tsx');
const revise = read('./Revise.tsx');
const css = read('./games.css');
const bulk = read('./BulkAdd.tsx');

describe('Write questions: guards', () => {
  it('runs the timed autocorrect only while the Questions box itself has focus', () => {
    expect(write).toMatch(/setTimeout\(\(\) => \{ if \(document\.activeElement === boxRef\.current\) runFix\(true\); \}, 1000\)/);
  });

  it('never cuts into a word a phone or Indic keyboard is still composing', () => {
    expect(write).toContain('onCompositionStart={() => { composing.current = true; }}');
    expect(write).toContain('onCompositionEnd={() => { composing.current = false; }}');
    expect(write).toMatch(/if \(focused && composing\.current\) return;/);
  });

  it('brings a removed sent-back question back only when it is sent again unchanged', () => {
    expect(write).toContain('if (result.sentBackIds.length) onDismiss(result.sentBackIds, false);');
    expect(write.match(/onDismiss\([^)]*, false\)/g)).toHaveLength(2); // that, and the cross's own Undo
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

  it('keeps a fix the writer took back with Ctrl+Z taken back', () => {
    expect(write).toMatch(/ta\.value === lastFix\.current\.before/);
    expect(write).toContain('leave.current.add(l)');
    expect(write).toMatch(/if \(ta\.value === declined\.current\) return;/);
    // and the restored text isn't left selected for the next key to replace
    expect(write).toMatch(/inputType === 'historyUndo'[\s\S]{0,200}setSelectionRange\(c, c\)/);
  });

  it('forgets the old chapter lines when the whole text is pasted over or emptied', () => {
    expect(write).toContain("if (!t.trim()) keep.current = {};");
    expect(write).toMatch(/if \(all\) \{ setExample\(false\); keep\.current = \{\}; \}/);
  });

  it('moves the caret with the lines a fix adds when the box is left', () => {
    expect(write).toMatch(/setCaret\(next\.slice\(0, c1\)\.split\('\\n'\)\.length\)/);
  });

  it('gives Bulk remove its own text, and disarms it when the list changes', () => {
    expect(bulk).toContain('text={removeText} setText={setRemoveText}');
    expect(bulk).toContain('useEffect(() => setArmed(false), [text, list]);');
  });

  it('gives a fix made when the box is left its own Undo, which also stops it being made again', () => {
    expect(write).toMatch(/offerUndo\('Tidied the questions', \(\) => \{\s*for \(const l of lines\) leave\.current\.add\(l\);/);
  });

  it('puts the replaced text\'s chapter lines away when Try an example, Fix it or Clear is undone', () => {
    expect(write).toContain('setRaw(remember(before));');
  });

  it('keeps a Chapter line written with its number only when Board, Class or Subject is picked again', () => {
    expect(write).toContain('c.chapter_no === typedCh.no && (!typedCh.name || sameName(c.name, typedCh.name))');
  });

  it('asks twice again after a failed Bulk remove', () => {
    expect(bulk).toMatch(/catch \(e\) \{\s*setError\(\(e as Error\)\.message\);\s*setArmed\(false\);/);
  });
});
