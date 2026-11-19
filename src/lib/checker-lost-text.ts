/**
 * Lost text: a question whose words were lost (body blank, for example because
 * an answer was printed inside it) that the AI transcribed from the page.
 *
 * The transcription is not in its own column. The pipeline writes it into
 * audit_questions.flag_detail, which holds a JSON object {"<code>": "<text>"}
 * whose text for the code ends " | suggestion: {"body": "..."}". The student
 * sees that text next to the page picture and confirms it (Looks right) or
 * corrects it (Fix it). Either way it is saved through the ordinary checker
 * fix, which logs, versions and refuses a blank body, so nothing here writes.
 *
 * The text is shown and saved verbatim. It is never cleaned or re-cased.
 *
 * Pure: no React, no network.
 */

import { isBlankBody } from '@/lib/checker-body';
import { parseFlagDetail } from '@/lib/checker-kid-reasons';

const MARK = 'suggestion:';

/** The balanced {...} object that starts at `from`, or null. String-aware. */
function balancedObject(text: string, from: number): string | null {
  if (text[from] !== '{') return null;
  let depth = 0;
  let inString = false;
  for (let i = from; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return text.slice(from, i + 1);
  }
  return null;
}

/** The suggested body inside one evidence string, or null. */
export function suggestionFromText(text: string | null | undefined): string | null {
  const t = text ?? '';
  const at = t.indexOf(MARK);
  if (at === -1) return null;
  let i = at + MARK.length;
  while (t[i] === ' ') i++;
  const obj = balancedObject(t, i);
  if (!obj) return null;
  try {
    const parsed = JSON.parse(obj) as { body?: unknown };
    return typeof parsed.body === 'string' && !isBlankBody(parsed.body) ? parsed.body : null;
  } catch {
    return null;
  }
}

/**
 * The AI's transcription for a question with no words, or null. Only for a
 * blank body: a question that already has words never gets one offered.
 */
export function lostTextSuggestion(
  body: string | null | undefined,
  flagDetail: string | null | undefined,
): string | null {
  if (!isBlankBody(body)) return null;
  const { byCode, general } = parseFlagDetail(flagDetail);
  for (const text of [...Object.values(byCode), general ?? '']) {
    const s = suggestionFromText(text);
    if (s) return s;
  }
  return null;
}

/** Evidence text without its machine tail: no "| suggestion: {...}", and nothing that starts "AI check". */
export function studentEvidence(text: string | null | undefined): string | null {
  if (!text) return null;
  const at = text.indexOf(MARK);
  const cut = (at === -1 ? text : text.slice(0, at)).replace(/[\s|]+$/, '').trim();
  if (!cut || /^ai check\b/i.test(cut)) return null;
  return cut;
}

export const LOST_TEXT_TITLE = 'The words on this question were lost';
export const LOST_TEXT_NOTE =
  'The computer read them from the page. Compare them with the page picture. If they match, press Yes, these words match. If anything is different, press Fix it and correct it.';
export const LOST_TEXT_HEADING = 'The computer read this from the page';
export const LOST_TEXT_CONFIRM = 'Yes, these words match the page';
