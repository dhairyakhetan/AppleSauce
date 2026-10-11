import { describe, expect, it } from 'vitest';
import { editorStateFromRow } from './paper-edit-revert';

describe('editorStateFromRow (what the open editor holds after a revert)', () => {
  it('resets the fields, the baseline and the loaded body to the stored question', () => {
    const next = editorStateFromRow({ body: 'Solve  2x + 3 = 7.\n', display_number: '4(b)', marks: 2 });
    expect(next.fields).toEqual({ body: 'Solve  2x + 3 = 7.\n', number: '4(b)', marks: '2' });
    expect(next.baseline).toEqual({ body: 'Solve  2x + 3 = 7.\n', display_number: '4(b)', marks: 2 });
    expect(next.loadedBody).toBe('Solve  2x + 3 = 7.\n');
  });

  it('copies the question text byte for byte, with no trimming or re-casing', () => {
    const odd = '  ThE   odd\ttext   with  spaces\n\n';
    expect(editorStateFromRow({ body: odd, display_number: null, marks: null }).fields.body).toBe(odd);
    expect(editorStateFromRow({ body: odd, display_number: null, marks: null }).baseline.body).toBe(odd);
  });

  it('handles blanks and numeric marks that arrive as text', () => {
    expect(editorStateFromRow({ body: null, display_number: null, marks: null })).toEqual({
      fields: { body: '', number: '', marks: '' },
      baseline: { body: '', display_number: null, marks: null },
      loadedBody: '',
    });
    expect(editorStateFromRow({ body: 'x', display_number: '1', marks: '0.5' }).baseline.marks).toBe(0.5);
  });
});
