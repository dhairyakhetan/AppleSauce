import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalisePreviewQuestion, type PreviewQuestion } from '@/lib/hod-publish';
import { instructionsAreSaved, instructionsText, leadingInstructionRows } from '@/lib/paper-instructions';

/* Owner, 6 Nov 2026, paper 0285475b: "this oaoer has general instructions and you are showing them but
   they dont appear". That paper kept nine instruction lines as its first list rows and left the General
   instructions box empty. */

function row(ord: number, kind: string, body: string, extra: Record<string, unknown> = {}): PreviewQuestion {
  const q = normalisePreviewQuestion({ id: `q${ord}`, ord, kind, body, ...extra });
  if (!q) throw new Error('bad test row');
  return q;
}

const PAPER = [
  row(1, 'section_instruction', 'This paper has FOUR sections.'),
  row(2, 'section_instruction', 'Section A is compulsory.'),
  row(3, 'master_instruction', 'You will not be allowed to write during the first 15 minutes.'),
  row(10, 'section_break', 'Section A'),
  row(11, 'section_instruction', '(Attempt all questions from this Section)'),
  row(12, 'question', 'Choose the right answer.', { display_number: 'Q1' }),
];

describe('leadingInstructionRows', () => {
  it('takes the instruction lines at the top and stops at the first heading', () => {
    expect(leadingInstructionRows(PAPER).map((r) => r.id)).toEqual(['q1', 'q2', 'q3']);
  });

  it('works whatever order the rows arrive in', () => {
    expect(leadingInstructionRows([...PAPER].reverse()).map((r) => r.id)).toEqual(['q1', 'q2', 'q3']);
  });

  it('stops at a numbered line even when it is stored as an instruction', () => {
    const rows = [row(1, 'section_instruction', 'Answer all.'), row(2, 'section_instruction', 'Read the passage.', { display_number: 'Q1' })];
    expect(leadingInstructionRows(rows).map((r) => r.id)).toEqual(['q1']);
  });

  it('skips empty lines, and finds nothing on a paper that starts with a question', () => {
    const rows = [row(1, 'section_instruction', '   '), row(2, 'section_instruction', 'Keep me.')];
    expect(leadingInstructionRows(rows).map((r) => r.id)).toEqual(['q2']);
    expect(leadingInstructionRows([row(1, 'question', 'What is 2 + 2?', { display_number: '1' })])).toEqual([]);
    expect(leadingInstructionRows([])).toEqual([]);
  });
});

describe('instructionsText and instructionsAreSaved', () => {
  const top = leadingInstructionRows(PAPER);

  it('joins one line per instruction', () => {
    expect(instructionsText(top)).toBe('This paper has FOUR sections.\nSection A is compulsory.\nYou will not be allowed to write during the first 15 minutes.');
  });

  it('knows when the saved box holds exactly those lines, ignoring spacing', () => {
    expect(instructionsAreSaved(instructionsText(top), top)).toBe(true);
    expect(instructionsAreSaved('This paper has FOUR sections.  Section A is compulsory. You will not be allowed to write during the first 15 minutes.', top)).toBe(true);
  });

  it('says no when the box is empty or has something else, so nothing is ever hidden by mistake', () => {
    expect(instructionsAreSaved(null, top)).toBe(false);
    expect(instructionsAreSaved('', top)).toBe(false);
    expect(instructionsAreSaved('Answer all questions.', top)).toBe(false);
    expect(instructionsAreSaved('anything', [])).toBe(false);
  });
});

describe('the screens use them', () => {
  it('the sheet offers the top lines as the general instructions, and hides them below only once saved', () => {
    const sheet = readFileSync('src/components/hod/PaperSheet.tsx', 'utf8');
    expect(sheet).toContain('leadingInstructionRows(questions)');
    expect(sheet).toContain("api.updatePublishMeta(paper.audit_paper_id, 'general_instructions', instructionsText(topLines))");
    expect(sheet).toContain('Use these as the general instructions');
    expect(sheet).toContain('if (topLineIds.has(q.id)) return null;');
    expect(sheet).toContain('instructionsAreSaved(h.general_instructions, topLines)');
  });

  it('the Details step shows the printed paper and the computer version next to the boxes', () => {
    const flow = readFileSync('src/components/hod/PublishFlow.tsx', 'utf8');
    const details = flow.slice(flow.indexOf("step === 'details'"), flow.indexOf("step === 'publish'"));
    expect(details).toContain('data-testid="details-side-by-side"');
    expect(details).toContain('<PaperPageFlip paperId={paperId} loadPages={api.paperPages} pictureUrl={api.pictureUrl}');
    expect(details).toContain('<PaperSheet preview={data}');
    expect(details).toContain('<HeaderEditor');
    // the printed pages come before the boxes, and the computer version after them
    expect(details.indexOf('<PaperPageFlip')).toBeLessThan(details.indexOf('<HeaderEditor'));
    expect(details.indexOf('<HeaderEditor')).toBeLessThan(details.indexOf('<PaperSheet'));
  });
});
