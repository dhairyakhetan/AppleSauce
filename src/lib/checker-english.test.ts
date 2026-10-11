import { describe, expect, it } from 'vitest';
import { englishContext, passageHeading } from './checker-english';
import { KID_SENTENCE, kidSentence } from './checker-kid-reasons';

describe('englishContext', () => {
  it('ignores rows that are not English W14 rows', () => {
    expect(englishContext(null)).toBeNull();
    expect(englishContext({ snippet_path: 'x.png' })).toBeNull();
    expect(englishContext([])).toBeNull();
    expect(englishContext('english_w14')).toBeNull();
  });

  it('returns the passage verbatim and the set text', () => {
    const text = 'Read the passage :\n  Line two,  kept as is.';
    const ctx = englishContext({
      pipeline: 'english_w14',
      role: 'shown',
      set_text: 'The Tempest',
      stimulus: { id: 'S-abc123-1', kind: 'prose_extract', title: null, text },
    });
    expect(ctx).not.toBeNull();
    expect(ctx!.passage).toEqual({ id: 'S-abc123-1', kind: 'prose_extract', title: null, text });
    expect(ctx!.setText).toBe('The Tempest');
    expect(ctx!.hiddenOnSite).toBe(false);
  });

  it('marks a rescue row as not on the website, with no passage when there is none', () => {
    const ctx = englishContext({ pipeline: 'english_w14', role: 'rescue', stimulus: null, set_text: null });
    expect(ctx).toEqual({ passage: null, setText: null, hiddenOnSite: true });
  });

  it('drops a malformed or empty passage rather than showing a blank box', () => {
    expect(englishContext({ pipeline: 'english_w14', stimulus: { id: 'S-1', text: '   ' } })!.passage).toBeNull();
    expect(englishContext({ pipeline: 'english_w14', stimulus: { text: 'no id' } })!.passage).toBeNull();
    expect(englishContext({ pipeline: 'english_w14', stimulus: 'text' })!.passage).toBeNull();
  });
});

describe('passageHeading', () => {
  it('names the kind in plain words', () => {
    expect(passageHeading('poem_extract')).toBe('The poem extract');
    expect(passageHeading('something_new')).toBe('The passage');
    expect(passageHeading(null)).toBe('The passage');
  });
});

describe('English hide reasons in plain words', () => {
  const codes = [
    'hidden_on_site', 'rescue_ai_doubt', 'gate_not_ready', 'gate_paper', 'gate_flags', 'gate_detect',
    'gate_text', 'gate_source', 'gate_source_before', 'gate_source_extract', 'gate_work', 'gate_extract',
    'gate_reference', 'gate_labels', 'gate_type_marks', 'gate_mcq', 'gate_instruction', 'gate_format',
    'gate_merged', 'gate_needs_context', 'gate_passage', 'gate_prompt_input', 'gate_out_of_scope',
  ];
  it('has a sentence for every code the English stager writes', () => {
    for (const c of codes) expect(KID_SENTENCE[c], c).toBeTruthy();
  });
  it('never shows a raw code or a dash', () => {
    for (const c of codes) {
      const s = kidSentence(c);
      expect(s).not.toContain('_');
      expect(s).not.toMatch(/[–—]/);
    }
  });
});
