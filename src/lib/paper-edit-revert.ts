import type { DraftFields } from '@/lib/paper-edit';

/* What a question editor must hold after the server's copy of the question
   changed under it: a version put back from the Versions dialog, or someone
   else's save (the 40001 conflict).

   Before this, putting a version back left the open editor showing the OLD
   text and told the admin to reload the page. The editor now takes the stored
   row and resets everything that was derived from the old one:
   - the visible fields,
   - the baseline (what the server holds; p_body_before on the next save),
   - the "text as it was when the page loaded", which the big-edit warning is
     measured against.

   Pure, so it is tested without a browser. The question text is copied as is,
   never trimmed, re-cased or reformatted. */

export interface EditorRow {
  body: string | null;
  display_number: string | null;
  marks: number | string | null;
}

export interface EditorFieldStrings {
  body: string;
  number: string;
  marks: string;
}

export interface EditorStateFromRow {
  fields: EditorFieldStrings;
  baseline: DraftFields;
  loadedBody: string;
}

export function editorStateFromRow(row: EditorRow): EditorStateFromRow {
  const marksNumber = row.marks != null && row.marks !== '' ? Number(row.marks) : null;
  return {
    fields: {
      body: row.body ?? '',
      number: row.display_number ?? '',
      marks: row.marks != null ? String(row.marks) : '',
    },
    baseline: {
      body: row.body ?? '',
      display_number: row.display_number,
      marks: marksNumber !== null && Number.isFinite(marksNumber) ? marksNumber : null,
    },
    loadedBody: row.body ?? '',
  };
}
