/**
 * "What the computer changed": the pipeline writes a change log beside every
 * question it cleaned up (audit_questions.source.edit_log, an array of
 * {kind, from, to}) and keeps the computer's first raw reading in
 * audit_questions.raw_ocr. Older rows have neither, so every function here
 * takes whatever it is given and degrades to "nothing to show".
 *
 * Pure and import-free: the practice round uses it too, and the practice
 * round must stay clear of Supabase (checker-practice.test.ts walks the graph).
 *
 * Copy is for a 12 year old: short, plain, no dashes.
 */

export const EDIT_KINDS = [
  'joined_lines',
  'moved_marks',
  'reattached_label',
  'reordered_options',
  'split_fused',
  'fixed_ocr_word',
  'removed_noise',
  'restored_blank',
  'normalised_format',
] as const;

export type EditKind = (typeof EDIT_KINDS)[number];

export interface EditEntry {
  /** The kind as the pipeline wrote it (may be one this file does not know). */
  kind: string;
  from: string;
  to: string;
}

export interface EditLine {
  kind: string;
  /** Plain-language line, ready to read: "Fixed a word: rn became m". */
  text: string;
  /** The short heading part, without the word that changed. */
  label: string;
  /** Set only where showing the before and after helps (a fixed word). */
  from: string | null;
  to: string | null;
  /** How many identical entries this line stands for (1 for most). */
  count: number;
}

export const CHANGES_HEADING = 'What the computer changed';
export const CHANGES_NOTE =
  'The computer tidied this question before you got it. Look at the printed paper, not at this list: if a change made the words differ from the paper, fix it.';
export const CHANGES_NONE_WRITTEN = 'The computer did not write down any changes for this one.';
export const RAW_SHOW = "Show the computer's first reading";
export const RAW_HIDE = "Hide the computer's first reading";
export const RAW_HEADING = "The computer's first reading";
export const RAW_NOTE = 'This is what the computer read from the picture before it tidied anything.';

const LABELS: Record<EditKind, string> = {
  joined_lines: 'Joined broken lines',
  moved_marks: 'Moved the marks out',
  reattached_label: 'Put the question number back where it belongs',
  reordered_options: 'Put the answer options in order',
  split_fused: 'Pulled two questions apart',
  fixed_ocr_word: 'Fixed a word',
  removed_noise: 'Removed stray marks from the page',
  restored_blank: 'Put a blank line back',
  normalised_format: 'Tidied spaces and punctuation',
};

/** The kinds where the word that changed is worth showing. */
const SHOWS_WORDS: ReadonlySet<string> = new Set<EditKind>(['fixed_ocr_word', 'removed_noise']);

const GENERIC_LABEL = 'Made a small change';
const MAX_SHOWN = 40;
const CLIP = 40;

function isKnownKind(kind: string): kind is EditKind {
  return (EDIT_KINDS as readonly string[]).includes(kind);
}

function asText(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return '';
}

/** Cuts a long piece of text for a one-line list, with an ellipsis. */
export function clipText(s: string, max = CLIP): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  const chars = Array.from(flat);
  return chars.length > max ? `${chars.slice(0, max).join('')}...` : flat;
}

/** The change log out of a question's `source`. Anything that is not a list of
 *  objects with a kind is dropped; nothing here throws. */
export function readEditLog(source: unknown): EditEntry[] {
  if (!source || typeof source !== 'object') return [];
  const raw = (source as Record<string, unknown>).edit_log;
  if (!Array.isArray(raw)) return [];
  const out: EditEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const kind = asText(o.kind).trim();
    if (!kind) continue;
    out.push({ kind, from: asText(o.from), to: asText(o.to) });
  }
  return out;
}

/** One entry as a plain sentence, for tests, screen readers and the list. */
export function describeEdit(entry: EditEntry): EditLine {
  const label = isKnownKind(entry.kind) ? LABELS[entry.kind] : GENERIC_LABEL;
  const from = clipText(entry.from);
  const to = clipText(entry.to);
  if (isKnownKind(entry.kind) && SHOWS_WORDS.has(entry.kind)) {
    if (entry.kind === 'fixed_ocr_word' && from && to) {
      return { kind: entry.kind, label, from, to, count: 1, text: `${label}: ${from} became ${to}` };
    }
    if (entry.kind === 'removed_noise' && from) {
      return { kind: entry.kind, label, from, to: null, count: 1, text: `${label}: ${from}` };
    }
  }
  return { kind: entry.kind, label, from: null, to: null, count: 1, text: label };
}

/** The list the screen shows: one line per change that names a word, and one
 *  line (with a count) for repeats of a change that does not. */
export function describeEditLog(source: unknown): { lines: EditLine[]; hidden: number; total: number } {
  const lines: EditLine[] = [];
  for (const entry of readEditLog(source)) {
    const line = describeEdit(entry);
    const same = lines.find((l) => l.kind === line.kind && l.from === null && line.from === null);
    if (same) same.count += 1;
    else lines.push(line);
  }
  const shown = lines.slice(0, MAX_SHOWN);
  // `total` is every change the computer made, also the ones past the cap, so a
  // count badge never understates what the list is a part of.
  const total = lines.reduce((n, l) => n + l.count, 0);
  return { lines: shown.map((l) => (l.count > 1 ? { ...l, text: `${l.label} (${l.count} times)` } : l)), hidden: lines.length - shown.length, total };
}

/** The computer's first raw reading, or null when the row has none (older rows)
 *  or it is empty. Returned exactly as stored: it is shown, never edited. */
export function rawReading(raw: unknown): string | null {
  return typeof raw === 'string' && raw.trim() !== '' ? raw : null;
}

/** Whether the section is worth showing at all. */
export function hasChangesToShow(source: unknown, raw: unknown): boolean {
  return readEditLog(source).length > 0 || rawReading(raw) !== null;
}
