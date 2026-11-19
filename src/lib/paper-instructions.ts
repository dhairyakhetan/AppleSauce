import type { PreviewQuestion } from '@/lib/hod-publish';

/* Some papers come out of the reading step with their general instructions stored as the first lines of
   the paper (rows of the kind "instruction") and nothing in the paper's own General instructions box.
   The ready-to-publish screen then says "none yet" and the publish check counts them as missing, even
   though they are right there on the paper (owner, 6 Nov 2026, paper 0285475b: "this paper has general
   instructions and you are showing them but they dont appear").
   These helpers find those top lines so the screen can show them as the instructions and offer to
   save them in the box. They only read; nothing is changed until the HOD presses the button. */

const INSTRUCTION_KINDS = new Set(['master_instruction', 'section_instruction']);

/** The instruction lines at the very top of the paper, in order: stop at the first heading, numbered
 *  question or question part. Lines the HOD left out, and empty lines, are skipped. */
export function leadingInstructionRows(questions: PreviewQuestion[]): PreviewQuestion[] {
  const out: PreviewQuestion[] = [];
  for (const q of [...questions].sort((a, b) => a.ord - b.ord)) {
    const plainInstruction = INSTRUCTION_KINDS.has(q.kind) && !q.display_number && !q.number_path && !q.parent_id;
    if (!plainInstruction) break;
    if (q.state === 'set_aside' || q.body.trim() === '') continue;
    out.push(q);
  }
  return out;
}

/** The lines joined one per line, as they would be typed into the General instructions box. */
export function instructionsText(rows: Pick<PreviewQuestion, 'body'>[]): string {
  return rows.map((r) => r.body.trim()).join('\n');
}

function squash(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** True when the saved General instructions are exactly those top lines, so the list below need not
 *  show them a second time. Anything the HOD changed stays visible in both places. */
export function instructionsAreSaved(saved: string | null | undefined, rows: Pick<PreviewQuestion, 'body'>[]): boolean {
  if (!saved || rows.length === 0) return false;
  return squash(saved) === squash(instructionsText(rows));
}
