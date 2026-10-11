/**
 * W14: the English context a paper checker needs next to a question.
 *
 * English questions are staged with a `source` block (UnlimitedOCR/auditor/
 * pipeline/english_release.py, `source_block`): the passage or extract the
 * question is about, the book / poem / play it is from, and whether the
 * question is already on the website ("shown") or was held back by the
 * owner's release gate ("rescue"). There are no pictures for English, so the
 * passage is what the checker reads the question against.
 *
 * Pure, so it is tested without a checker login. Text is passed through as
 * stored and rendered by MathText; nothing here edits it.
 */

export interface EnglishPassage {
  id: string;
  kind: string | null;
  title: string | null;
  text: string;
}

export interface EnglishContext {
  passage: EnglishPassage | null;
  setText: string | null;
  /** True when the question is not on the website yet. */
  hiddenOnSite: boolean;
}

const KIND_LABEL: Record<string, string> = {
  passage: 'The passage',
  prose_extract: 'The extract',
  poem_extract: 'The poem extract',
  drama_extract: 'The extract from the play',
  extract: 'The extract',
};

export function passageHeading(kind: string | null | undefined): string {
  return (kind && KIND_LABEL[kind]) || 'The passage';
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null;
}

/** Null when the question is not an English W14 row. */
export function englishContext(source: unknown): EnglishContext | null {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  const s = source as Record<string, unknown>;
  if (s.pipeline !== 'english_w14') return null;
  let passage: EnglishPassage | null = null;
  const st = s.stimulus;
  if (st && typeof st === 'object' && !Array.isArray(st)) {
    const o = st as Record<string, unknown>;
    const text = str(o.text);
    const id = str(o.id);
    if (text && id) passage = { id, kind: str(o.kind), title: str(o.title), text };
  }
  return { passage, setText: str(s.set_text), hiddenOnSite: s.role === 'rescue' };
}
