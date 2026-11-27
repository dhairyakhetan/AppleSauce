import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ActionButton } from '@/components/checker/CheckerButtons';
import { CheckTipLine } from '@/components/checker/CheckerBits';
import { OptionsEditor } from '@/components/checker/OptionsEditor';
import { restoreOption } from '@/lib/checker-options';
import { SaveStatusChip } from '@/components/checker/AdvanceBits';
import { createFakeCheckerApi } from '@/dummy/checker-fake-api';
import { describeLanes, laneForCode, unmappedCodes } from '@/lib/checker-lanes';
import { UNDONE_FIX_NOTE } from '@/lib/checker-errors';
import type { EditableOption } from '@/lib/option-editing';
import { PAPER_LIMIT_NOTE, paperCardProgress, partDoneNote, QUESTION_STATE_LABEL } from '@/lib/verifier-papers';

/* Checker screens: easier on phones, no lost work (owner approved, 26 Nov 2026). One test per fix from the audit,
   in node (renderToStaticMarkup and source-text checks, like the rest of the checker tests). */

const verify = readFileSync('src/components/checker/VerifyScreen.tsx', 'utf8');
const page = readFileSync('src/pages/Checker.tsx', 'utf8');
const ask = readFileSync('src/components/checker/AskForPapers.tsx', 'utf8');
const body = readFileSync('src/components/checker/BodyEditor.tsx', 'utf8');
const formula = readFileSync('src/components/checker/MathFieldEditor.tsx', 'utf8');

const opt = (id: number, text: string): EditableOption => ({ id, shape: 'string', label: '', text, base: null });

describe('1, 16: the message after an answer', () => {
  it('no longer floats over the tabs at the top, lets taps through and has a close button', () => {
    expect(verify).not.toContain('fixed left-1/2 top-24');
    expect(verify).toContain('pointer-events-none absolute inset-x-0 bottom-full');
    expect(verify).toContain('data-testid="checker-notice-close"');
    expect(verify).toContain('pointer-events-auto');
    expect(verify).toContain('aria-label="Close this message"');
  });

  it('also tells a screen reader which question is now up', () => {
    expect(verify).toContain('`Question ${progress.position} of ${progress.total} is up.`');
    expect(verify).toContain('<span className="sr-only"> {nowUpLine}</span>');
  });
});

describe('2: weak signal never shows a false "Paper finished"', () => {
  it('reads the question through loadGate, not isLoading', () => {
    expect(verify).toContain('const questionGate = loadGate(questionQuery);');
    expect(verify).toContain("{questionGate === 'loading' ? (");
    expect(verify).not.toContain('questionQuery.isLoading');
  });
});

describe('3: Cancel asks before throwing typed work away', () => {
  it('asks "Throw away your changes?" when there are changes', () => {
    expect(verify).toContain("if (mode === 'fix' && unsavedEdit) setConfirmCancel(true);");
    expect(verify).toContain('Throw away your changes?');
    expect(verify).toContain('Keep editing');
    expect(verify).toContain('onClick={requestCancel} disabled={submitting} title="Cancel (Esc)"');
  });
});

describe('4: what the My papers note promises', () => {
  it('says the HOD gives out more papers, not that more arrive by themselves', () => {
    expect(PAPER_LIMIT_NOTE).toContain('Your HOD gives out more papers.');
    expect(PAPER_LIMIT_NOTE).not.toContain('arrive');
  });
});

describe('5: Undo and Looks right on a phone', () => {
  it('shows the word Undo on a phone and explains a switched-off button on a tap', () => {
    expect(verify).toContain('<span className="md:hidden">Undo</span>');
    expect(verify).toContain("setNotice({ text: undoTitle(false, undoHeld, stepBlocked), tone: 'warn' });");
    expect(verify).toContain('ariaDisabled={!canPass || marksInvalid}');
  });

  it('a switched-off ActionButton still takes a tap and says it is off', () => {
    const html = renderToStaticMarkup(
      <ActionButton tone="mint" onClick={() => undefined} ariaDisabled>
        Looks right
      </ActionButton>,
    );
    expect(html).toContain('aria-disabled="true"');
    expect(html).not.toContain('disabled=""');
  });
});

describe('6: a tip above the words on a phone', () => {
  it('shows the first tip in one short line, with More tips', () => {
    const html = renderToStaticMarkup(<CheckTipLine summary={describeLanes(['display_number_missing'], null)} targetId="x" />);
    expect(html).toContain('data-testid="check-tip-line"');
    expect(html).toContain('Tap Fix it to change the number');
    expect(html).toContain('More tips');
    expect(verify).toContain('{tipLine}');
  });

  it('shows nothing when there is no tip', () => {
    expect(renderToStaticMarkup(<CheckTipLine summary={describeLanes([], null)} />)).toBe('');
  });
});

describe('7: Save stays reachable in Fix it on a phone', () => {
  it('puts Save and Cancel inside the card, under the words', () => {
    expect(verify).toContain('data-testid="fix-save-inline"');
    expect(verify).toContain("{submitting ? 'Saving...' : edited ? 'Save' : 'Looks right'}");
  });
});

describe('8: the Ask the HOD sheet on a touch screen', () => {
  it('does not open the keyboard by itself there', () => {
    expect(verify).toContain('autoFocus={!coarsePointer()}');
    expect(verify).toContain("matchMedia('(pointer: coarse)')");
  });
});

describe('9: answer options at 375px', () => {
  it('puts move and remove on their own line on a phone', () => {
    const html = renderToStaticMarkup(<OptionsEditor value={[opt(0, 'a'), opt(1, 'b')]} onChange={() => undefined} />);
    expect(html).toContain('data-testid="option-row-tools"');
    expect(html).toContain('sm:flex-row');
  });

  it('a removed option can be put back where it was', () => {
    const list = [opt(0, 'a'), opt(2, 'c')];
    expect(restoreOption(list, opt(1, 'b'), 1).map((o) => o.text)).toEqual(['a', 'b', 'c']);
    // Never twice, and never past the end.
    expect(restoreOption([opt(1, 'b')], opt(1, 'b'), 0)).toHaveLength(1);
    expect(restoreOption([], opt(1, 'b'), 5).map((o) => o.text)).toEqual(['b']);
  });
});

describe('10: Split says it cannot be undone', () => {
  it('says so next to Split here', () => {
    expect(verify).toContain('A split cannot be undone. Check the preview before you press Split here.');
  });
});

describe('11: one set of words', () => {
  it('says check, not verify, and "the computer", not "the AI"', () => {
    expect(verify).not.toMatch(/>\s*Verifying/);
    expect(verify).toContain('Send back to the computer');
    expect(verify).toContain('the computer will read it again');
    expect(page).toContain("'Keep checking' : 'Start checking'");
    expect(page).not.toMatch(/Start verifying|Keep verifying|Verify one question/);
    expect(QUESTION_STATE_LABEL.to_verify).toBe('To check');
  });
});

describe('12: the formula keypad', () => {
  it('says what its button does and that Save is still needed, and is not called a dialog', () => {
    expect(formula).toContain('Use this formula');
    expect(formula).toContain('then press Save');
    expect(formula).not.toContain('role="dialog"');
    expect(formula).not.toContain('aria-modal');
  });
});

describe('13: "Not saved yet" on a phone', () => {
  it('sits above the buttons on a phone, in the top bar only from md up', () => {
    expect(verify).toContain('<SaveStatusChip compact className="hidden md:flex"');
    expect(verify).toContain('<SaveStatusChip className="mb-2 md:hidden"');
    const html = renderToStaticMarkup(<SaveStatusChip waiting={1} failing onRetry={() => undefined} className="md:hidden" />);
    expect(html).toContain('md:hidden');
  });
});

describe('14: Ask my HOD for more papers', () => {
  it('shows nothing until it knows whether the person already asked', () => {
    expect(ask).toContain('if (mine.isPending && !off) return');
  });
});

describe('15: the plain-text link', () => {
  it('is called "Show maths as plain text"', () => {
    expect(body).toContain('Show maths as plain text');
    expect(body).not.toContain("'Show code'");
  });
});

describe('17: My details', () => {
  it('Save my details is a submit button, so Enter saves', () => {
    expect(page).toContain('<ActionButton tone="dark" type="submit"');
    const html = renderToStaticMarkup(
      <ActionButton tone="dark" type="submit" onClick={() => undefined}>
        Save my details
      </ActionButton>,
    );
    expect(html).toContain('type="submit"');
  });
});

describe('18: the paper name on a phone', () => {
  it('may take two lines instead of being cut off', () => {
    expect(verify).toContain('line-clamp-2 break-words text-[15px] font-bold leading-snug text-foreground md:truncate');
  });
});

describe('19: every page from the open page', () => {
  it('offers the whole paper (previous and next) once the page is open', () => {
    expect(verify).toContain('|| pageViewerOn));');
    expect(verify).toContain('{pageViewerOn && !paperOpen ? (');
  });
});

describe('20: a long question can be read to its end on a phone', () => {
  it('pins the tools row only from md up', () => {
    expect(verify).toContain('md:sticky md:bottom-0" data-testid="tools-dock"');
  });
});

describe('21: honest counts on a My papers card', () => {
  it('says the count is the whole paper when the checker part is done but the paper is not', () => {
    const row = { total: 0, done: 0, remaining: 0, with_hod: 0, paper_total: 12, paper_passed: 0 };
    expect(paperCardProgress(row).label).toBe('0 of 12 done on the whole paper');
    expect(partDoneNote(row)).toBe('Your part is done. Your HOD settles the rest of this paper.');
    expect(partDoneNote({ ...row, paper_passed: 12 })).toBeNull();
    expect(partDoneNote({ ...row, remaining: 2 })).toBeNull();
    expect(page).toContain('{partDoneNote(p) ?? checkerCardLine(p)}');
  });

  it('practice data: an emptied queue no longer leaves questions "to check" on the paper page', async () => {
    const api = createFakeCheckerApi();
    const [first] = await api.myPapers();
    api.emptyQueue();
    const [after] = await api.myPapers();
    expect(after.remaining).toBe(0);
    const qs = await api.paperQuestions(first.paper_id);
    expect(qs.filter((q) => q.state === 'to_verify')).toHaveLength(0);
  });
});

describe('22: Undo after a fix', () => {
  it('says the changes were removed', () => {
    expect(UNDONE_FIX_NOTE).toContain('Your changes were removed');
    expect(verify).toContain("text: undidFix ? UNDONE_FIX_NOTE : UNDONE_NOTE");
  });
});

describe('23: spelling_suspect has a lane', () => {
  it('maps to reading the words, with its own plain words, and no console warning', () => {
    expect(laneForCode('spelling_suspect')?.id).toBe('read_words');
    expect(unmappedCodes(['spelling_suspect'])).toEqual([]);
    const s = describeLanes(['spelling_suspect'], null);
    expect(s.blocks[0].title).toBe('This word may be misspelt');
    expect(s.blocks[0].text).toContain('This word may be misspelt');
    expect(s.unmapped).toEqual([]);
  });
});

describe('no dashes in the new words', () => {
  it('has no em or en dash in the screens changed here', () => {
    for (const src of [verify, page, ask, body, formula]) expect(src).not.toMatch(/[–—]/);
  });
});
