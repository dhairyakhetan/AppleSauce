import type { RawOption } from '@/lib/checker-options';

/* Editing a question's answer options (owner, 25 Nov 2026: "I can't edit the options ... for checkers as well").

   audit_questions.options holds two shapes (see checker-options.ts): plain text lines (the pipeline's shape, most
   papers) and {label, text} pairs. Editing keeps each option in the shape it came in, so saving never turns a plain
   line into an object or the other way round. Text is verbatim: nothing here trims, cleans or re-cases it. The saved
   value is the whole list, sent only when something really changed. */

export interface EditableOption {
  /** A stable key for the row while editing (not stored). */
  id: number;
  shape: 'string' | 'object';
  label: string;
  text: string;
  /** The stored object, so fields this editor does not show are kept as they were. */
  base: Record<string, unknown> | null;
}

/** The stored options as editable rows. Blank entries are dropped, the same way the screens that show options drop them. */
export function toEditable(options: unknown): EditableOption[] {
  if (!Array.isArray(options)) return [];
  const out: EditableOption[] = [];
  let id = 0;
  for (const o of options as RawOption[]) {
    if (typeof o === 'string') {
      if (o.trim() !== '') out.push({ id: id++, shape: 'string', label: '', text: o, base: null });
    } else if (o && typeof o === 'object') {
      const text = typeof o.text === 'string' ? o.text : '';
      const label = typeof o.label === 'string' ? o.label : '';
      if (text.trim() !== '' || label.trim() !== '') out.push({ id: id++, shape: 'object', label, text, base: { ...(o as Record<string, unknown>) } });
    }
  }
  return out;
}

/** The rows back into the stored form. A row with no words and no label is left out. */
export function fromEditable(list: EditableOption[]): RawOption[] {
  const out: RawOption[] = [];
  for (const o of list) {
    if (o.text.trim() === '' && o.label.trim() === '') continue;
    if (o.shape === 'string') out.push(o.text);
    else out.push({ ...(o.base ?? {}), label: o.label.trim() === '' ? null : o.label, text: o.text });
  }
  return out;
}

/**
 * What to send as `options`: the new list, or null when nothing changed. Compared against the stored list as it
 * reads after the same blank-dropping, so an untouched question never produces a change.
 */
export function optionsChange(original: unknown, current: EditableOption[]): RawOption[] | null {
  const before = JSON.stringify(fromEditable(toEditable(original)));
  const next = fromEditable(current);
  return JSON.stringify(next) === before ? null : next;
}

function nextId(list: EditableOption[]): number {
  return list.reduce((m, o) => Math.max(m, o.id), -1) + 1;
}

/** A new empty option, in the shape the others use (plain lines unless every option is a label-and-text pair). */
export function addOption(list: EditableOption[]): EditableOption[] {
  const allObjects = list.length > 0 && list.every((o) => o.shape === 'object');
  return [...list, { id: nextId(list), shape: allObjects ? 'object' : 'string', label: '', text: '', base: null }];
}

export function removeOption(list: EditableOption[], id: number): EditableOption[] {
  return list.filter((o) => o.id !== id);
}

export function updateOption(list: EditableOption[], id: number, patch: Partial<Pick<EditableOption, 'label' | 'text'>>): EditableOption[] {
  return list.map((o) => (o.id === id ? { ...o, ...patch } : o));
}

export function moveOption(list: EditableOption[], id: number, dir: -1 | 1): EditableOption[] {
  const i = list.findIndex((o) => o.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return list;
  const copy = [...list];
  [copy[i], copy[j]] = [copy[j], copy[i]];
  return copy;
}
