import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  autosaveReducer,
  initialAutosave,
  hasEditsBeyondSave,
  hasUnsavedWork,
  saveStatusLabel,
  parseMarks,
  numberForSave,
  fieldsEqual,
  summarizeForVerify,
  verifyConfirmLines,
  verifyResultHeadline,
  depthMap,
  paperDetailValue,
  PAPER_DETAIL_FIELDS,
  detailError,
  adminFlagLines,
  editDistanceCapped,
  ocrFixBudget,
  looksLikeRewrite,
  passagesBefore,
  sourcePdfLine,
  OCR_ONLY_REMINDER,
  BIG_EDIT_WARNING,
  type AutosaveEvent,
  type AutosaveState,
} from './paper-edit';
import { KID_SENTENCE } from './checker-kid-reasons';

const run = (events: AutosaveEvent[], from: AutosaveState = initialAutosave) => events.reduce(autosaveReducer, from);

describe('autosave state', () => {
  it('goes dirty, saving, saved', () => {
    const s = run([{ type: 'edit' }, { type: 'save_start' }, { type: 'save_ok' }]);
    expect(s.status).toBe('saved');
    expect(hasUnsavedWork(s)).toBe(false);
  });

  it('stays dirty when the admin typed during the save, so one more save runs', () => {
    const s = run([{ type: 'edit' }, { type: 'save_start' }, { type: 'edit' }, { type: 'save_ok' }]);
    expect(s.status).toBe('dirty');
    expect(hasUnsavedWork(s)).toBe(true);
  });

  it('keeps showing Saving while an edit lands mid-save', () => {
    const s = run([{ type: 'edit' }, { type: 'save_start' }, { type: 'edit' }]);
    expect(s.status).toBe('saving');
  });

  it('a failure counts as unsaved work and keeps the message', () => {
    const s = run([{ type: 'edit' }, { type: 'save_start' }, { type: 'save_fail', error: 'offline' }]);
    expect(s.status).toBe('failed');
    expect(s.error).toBe('offline');
    expect(hasUnsavedWork(s)).toBe(true);
  });

  it('typing again after a failure clears the error and goes dirty', () => {
    const s = run([{ type: 'edit' }, { type: 'save_start' }, { type: 'save_fail', error: 'x' }, { type: 'edit' }]);
    expect(s.status).toBe('dirty');
    expect(s.error).toBeNull();
  });

  it('a conflict is not unsaved work: the page reloads the other version', () => {
    const s = run([{ type: 'edit' }, { type: 'save_start' }, { type: 'conflict' }]);
    expect(s.status).toBe('conflict');
    expect(hasUnsavedWork(s)).toBe(false);
  });

  it('labels every visible state, with no em or en dashes', () => {
    for (const st of ['dirty', 'saving', 'saved', 'failed', 'conflict'] as const) {
      const label = saveStatusLabel(st);
      expect(label.length).toBeGreaterThan(0);
      expect(label).not.toMatch(/[–—]/);
    }
    expect(saveStatusLabel('idle')).toBe('');
  });

  it('still owes a save for keystrokes typed while a save was on the wire', () => {
    expect(hasEditsBeyondSave(run([{ type: 'edit' }]))).toBe(true);
    expect(hasEditsBeyondSave(run([{ type: 'edit' }, { type: 'save_start' }]))).toBe(false);
    // Status reads "saving" here, which is why an unmount cannot trust it.
    const typedDuringSave = run([{ type: 'edit' }, { type: 'save_start' }, { type: 'edit' }]);
    expect(typedDuringSave.status).toBe('saving');
    expect(hasEditsBeyondSave(typedDuringSave)).toBe(true);
    expect(hasEditsBeyondSave(run([{ type: 'edit' }, { type: 'save_start' }, { type: 'save_ok' }]))).toBe(false);
    expect(hasEditsBeyondSave(run([{ type: 'edit' }, { type: 'save_start' }, { type: 'conflict' }]))).toBe(false);
  });
});

describe('field parsing', () => {
  it('blank marks mean none printed', () => {
    expect(parseMarks('  ')).toEqual({ ok: true, value: null });
  });
  it('accepts whole and half marks', () => {
    expect(parseMarks('4')).toEqual({ ok: true, value: 4 });
    expect(parseMarks('0.5')).toEqual({ ok: true, value: 0.5 });
  });
  it('refuses negatives and words', () => {
    expect(parseMarks('-1').ok).toBe(false);
    expect(parseMarks('four').ok).toBe(false);
    expect(parseMarks('4 marks').ok).toBe(false);
  });
  it('a cleared number is null, anything else is sent exactly as typed', () => {
    expect(numberForSave('')).toBeNull();
    expect(numberForSave(' 5(ii) ')).toBe(' 5(ii) ');
  });
  it('compares all three fields', () => {
    const a = { body: 'x', display_number: '1', marks: 2 };
    expect(fieldsEqual(a, { ...a })).toBe(true);
    expect(fieldsEqual(a, { ...a, marks: null })).toBe(false);
    expect(fieldsEqual(a, { ...a, body: 'x ' })).toBe(false);
  });
});

describe('verify confirmation counts', () => {
  const rows = [
    { kind: 'master_instruction', question_passed: false, review_bucket: 'none', flag_reasons: [] },
    { kind: 'question', question_passed: true, review_bucket: 'kid', flag_reasons: [] },
    { kind: 'question', question_passed: false, review_bucket: 'kid', flag_reasons: ['marks_mismatch'] },
    { kind: 'question', question_passed: false, review_bucket: 'escalated', flag_reasons: ['ocr_fused'] },
    { kind: 'section_break', question_passed: false, review_bucket: null, flag_reasons: null },
  ];

  it('counts only question rows, the same ones Verify passes', () => {
    expect(summarizeForVerify(rows)).toEqual({ total: 3, stillFlagged: 2, escalated: 1, alreadyPassed: 1 });
  });

  it('says how many are still flagged and that edits go live', () => {
    const lines = verifyConfirmLines(summarizeForVerify(rows), { isRed: false, reason: null });
    expect(lines[0]).toBe('2 questions are still flagged, out of 3.');
    expect(lines).toContain('1 of them was sent for help.');
    expect(lines[lines.length - 1]).toBe('Your edits go live for readers straight away.');
  });

  it('uses the singular for one', () => {
    const lines = verifyConfirmLines({ total: 5, stillFlagged: 1, escalated: 0, alreadyPassed: 4 }, { isRed: false, reason: null });
    expect(lines[0]).toBe('1 question is still flagged, out of 5.');
  });

  it('says all checked when nothing is flagged', () => {
    const lines = verifyConfirmLines({ total: 4, stillFlagged: 0, escalated: 0, alreadyPassed: 4 }, { isRed: false, reason: null });
    expect(lines[0]).toBe('All 4 questions are already checked.');
  });

  it('warns when the AI marked the paper red', () => {
    const lines = verifyConfirmLines({ total: 1, stillFlagged: 0, escalated: 0, alreadyPassed: 1 }, { isRed: true, reason: 'page 3 missing' });
    expect(lines.some((l) => l.includes('red: page 3 missing'))).toBe(true);
  });

  it('never uses an em or en dash', () => {
    const lines = verifyConfirmLines({ total: 2, stillFlagged: 2, escalated: 2, alreadyPassed: 0 }, { isRed: true, reason: null });
    for (const l of lines) expect(l).not.toMatch(/[–—]/);
  });

  it('headline reflects live or not', () => {
    const base = { needs_review: false, is_published: true, reason: null, questions_total: 3, questions_newly_passed: 1 };
    expect(verifyResultHeadline({ ...base, is_live: true })).toMatch(/^Live\./);
    expect(verifyResultHeadline({ ...base, is_live: false })).toMatch(/not live/);
  });
});

describe('layout helpers', () => {
  it('nests sub-parts by parent_id', () => {
    const d = depthMap([
      { id: 'a', parent_id: null },
      { id: 'b', parent_id: 'a' },
      { id: 'c', parent_id: 'b' },
      { id: 'x', parent_id: 'missing' },
    ]);
    expect([d.get('a'), d.get('b'), d.get('c'), d.get('x')]).toEqual([0, 1, 2, 0]);
  });

  it('survives a parent cycle in bad data', () => {
    const d = depthMap([
      { id: 'a', parent_id: 'b' },
      { id: 'b', parent_id: 'a' },
    ]);
    expect(d.get('a')).toBeLessThanOrEqual(6);
  });

  it('prefills the details editor with that field only', () => {
    const p = { school: 'St X', year: null, allowed_time_minutes: 90 };
    expect(paperDetailValue(p, 'school')).toBe('St X');
    expect(paperDetailValue(p, 'year')).toBe('');
    expect(paperDetailValue(p, 'allowed_time_minutes')).toBe('90');
    expect(paperDetailValue(p, 'subject')).toBe('');
  });

  it('offers every header field the public page shows, including class and exam', () => {
    const keys = PAPER_DETAIL_FIELDS.map((f) => f.key);
    for (const k of ['school', 'cls', 'subject', 'exam', 'year', 'allowed_time_minutes', 'general_instructions', 'incomplete_note']) {
      expect(keys).toContain(k);
    }
    for (const f of PAPER_DETAIL_FIELDS) expect(f.label).not.toMatch(/[\u2013\u2014]/);
  });

  it('refuses a time allowed that the database cast would reject, before sending it', () => {
    expect(detailError('allowed_time_minutes', '90')).toBeNull();
    expect(detailError('allowed_time_minutes', '')).toMatch(/number/);
    expect(detailError('allowed_time_minutes', '1 hour')).toMatch(/number/);
    expect(detailError('school', '  ')).toMatch(/blank/);
    expect(detailError('incomplete_note', '')).toBeNull();
    expect(detailError('general_instructions', 'Answer all questions.')).toBeNull();
  });
});

describe('flag reasons in plain words', () => {
  it('turns the pipeline JSON into sentences and never shows the JSON', () => {
    const lines = adminFlagLines(
      ['hidden_on_site', 'gate_not_ready'],
      '{"gate_not_ready": "The computer reading of this question was unsure."}',
    );
    expect(lines).toContain(KID_SENTENCE.gate_not_ready);
    expect(lines).toContain('The computer reading of this question was unsure.');
    for (const l of lines) {
      expect(l).not.toMatch(/[{}]/);
      expect(l).not.toMatch(/gate_|_/);
    }
  });

  it('drops a malformed JSON note rather than printing it', () => {
    const lines = adminFlagLines(['low_ocr_confidence'], '{"low_ocr_confidence": "unsure');
    expect(lines).toEqual([KID_SENTENCE.low_ocr_confidence]);
  });

  it('keeps a plain-text note, and an unknown code still reads as words', () => {
    const lines = adminFlagLines(['some_new_code'], 'Page two was blurred.');
    expect(lines).toEqual(['Some new code', 'Page two was blurred.']);
  });

  it('is empty when there is nothing to say', () => {
    expect(adminFlagLines(null, null)).toEqual([]);
    expect(adminFlagLines([], '')).toEqual([]);
  });
});

describe('D76: an edit may only fix a reading mistake', () => {
  const naive = (a: string, b: string) => {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j += 1) d[0][j] = j;
    for (let i = 1; i <= a.length; i += 1)
      for (let j = 1; j <= b.length; j += 1)
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  };

  it('the capped distance matches the full one, up to the cap', () => {
    const pairs: [string, string][] = [
      ['', ''],
      ['kitten', 'sitting'],
      ['abc', ''],
      ['Find the value of x.', 'Find the va1ue of x'],
      ['\\ling p p r b g a a part f our', 'Using the paper, find part four'],
      ['same text', 'same text'],
    ];
    for (const [a, b] of pairs) {
      for (const cap of [0, 1, 3, 10, 50]) {
        expect(editDistanceCapped(a, b, cap)).toBe(Math.min(naive(a, b), cap + 1));
      }
    }
  });

  it('a few-letter OCR fix is not flagged', () => {
    const before = 'Find the va1ue of x if 2x + 3 = 11. Show your working clear1y.';
    const after = 'Find the value of x if 2x + 3 = 11. Show your working clearly.';
    expect(looksLikeRewrite(before, after)).toBe(false);
  });

  it('a reworded question is flagged', () => {
    const before = 'Find the value of x if 2x + 3 = 11. Show your working clearly.';
    const after = 'Solve for x in the equation 2x + 3 = 11, explaining each step.';
    expect(looksLikeRewrite(before, after)).toBe(true);
  });

  it('allows a small absolute fix on a very short question', () => {
    expect(ocrFixBudget(8)).toBe(10);
    expect(looksLikeRewrite('Def1ne', 'Define')).toBe(false);
  });

  it('the reminder and the warning are plain words with no em or en dash', () => {
    for (const s of [OCR_ONLY_REMINDER, BIG_EDIT_WARNING]) expect(s).not.toMatch(/[\u2013\u2014]/);
    expect(OCR_ONLY_REMINDER).toMatch(/exactly what the printed paper says/);
  });
});

describe('English passages and the source file', () => {
  const src = (id: string | null) =>
    id ? { pipeline: 'english_w14', role: 'shown', stimulus: { id, kind: 'passage', text: 'Once upon a time', title: null } } : { pipeline: 'english_w14' };

  it('shows each passage once, before the first question that uses it', () => {
    const m = passagesBefore([
      { question_id: 'q1', source: src('S-1') },
      { question_id: 'q2', source: src('S-1') },
      { question_id: 'q3', source: src(null) },
      { question_id: 'q4', source: src('S-2') },
      { question_id: 'q5', source: { page: 1 } },
    ]);
    expect([...m.keys()]).toEqual(['q1', 'q4']);
    expect(m.get('q1')?.text).toBe('Once upon a time');
  });

  it('names the printed paper by file name only, never a path', () => {
    expect(sourcePdfLine('C:\\Users\\kanis\\data\\filed\\ICSE\\X\\Maths_2023.pdf')).toBe('Printed paper file: Maths_2023.pdf');
    expect(sourcePdfLine('010_Bhavans_2022_8_English.pdf')).toBe('Printed paper file: 010_Bhavans_2022_8_English.pdf');
    expect(sourcePdfLine(null)).toBe('Printed paper file: not recorded');
    expect(sourcePdfLine(undefined)).toBe('Printed paper file: not recorded');
  });
});

describe('the admin paper edit migration', () => {
  /* The grant trap (CLAUDE.md): revoking from PUBLIC alone leaves Supabase's
     by-name grant to anon/authenticated in place. Pin the full lockdown for
     each function this page calls. */
  const sql = readFileSync('supabase/migrations/20260928170000_admin_paper_edit.sql', 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

  const fns: [string, string][] = [
    ['admin_paper_draft', 'text'],
    ['admin_save_draft_question', 'uuid, text, text, numeric, text'],
    ['admin_verify_paper', 'text'],
  ];

  for (const [name, args] of fns) {
    it(`${name} is admin-checked, definer, and closed to anon`, () => {
      // Literal substrings, not a RegExp built from the signature: nothing to escape.
      expect(sql).toContain(`revoke all on function public.${name}(${args}) from public, anon, authenticated;`);
      expect(sql).toContain(`grant execute on function public.${name}(${args}) to authenticated;`);
      const body = sql.slice(sql.indexOf(`function public.${name}(`));
      const head = body.slice(0, body.indexOf('$function$;'));
      expect(head).toMatch(/security definer/);
      expect(head).toMatch(/set search_path to 'public'/);
      expect(head).toMatch(/if not public\.is_admin\(\) then\s+raise exception 'Not authorized' using errcode = '42501';/);
    });
  }

  it('never grants anything to anon', () => {
    expect(sql).not.toMatch(/grant[^;]*\banon\b/i);
  });

  it('never writes bank_questions directly: edits go to the draft', () => {
    expect(sql).not.toMatch(/update\s+public\.bank_questions/i);
    expect(sql).not.toMatch(/insert\s+into\s+public\.bank_questions/i);
  });

  it('refuses a stale save with 40001', () => {
    expect(sql).toMatch(/is distinct from p_body_before then\s+raise exception '[^']+' using errcode = '40001';/);
  });
});
