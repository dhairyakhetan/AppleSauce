import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { createGoLiveFake } from '@/dummy/hod-golive-fake';
import { hodRefreshPlan } from '@/lib/hod-refresh';
import { aiRedoStepWords, normaliseAiRedoList } from '@/lib/hod-publish';

/* The HOD desk's "Send to AI" tab (owner, 19 Nov 2026): the whole "send back to the AI" flow in one place. A student's
   request waits there for the HOD's yes or no, a yes stays on the list, and every question opens into its story.
   The migration cannot run in CI (no database), so the load-bearing lines of the SQL files are pinned here too. */

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
}

const sqlFirst = code('supabase/migrations/20261119100000_hod_ai_redo_list.sql');
const sql = code('supabase/migrations/20261119200000_hod_ai_redo_flow.sql');
const sqlLive = code('supabase/migrations/20261119300000_hod_ai_redo_list_live_copies.sql');

const row = { id: 'q1', paper_id: 'p1', paper_title: 'Beccon X Maths', ai_redo_state: 'approved', ai_redo_reason: 'Cut off', asked_by_name: 'Asha' };

describe('reading the list', () => {
  it('keeps requested, approved and redone questions and drops anything else', () => {
    const out = normaliseAiRedoList([
      row,
      { ...row, id: 'q2', ai_redo_state: 'redone' },
      { ...row, id: 'q3', ai_redo_state: 'requested' },
      { ...row, id: 'q4', ai_redo_state: null },
      { ...row, id: 'q5', ai_redo_state: 'nonsense' },
      { ...row, id: '' },
    ]);
    expect(out.map((x) => [x.id, x.state])).toEqual([
      ['q1', 'approved'],
      ['q2', 'redone'],
      ['q3', 'requested'],
    ]);
  });

  it('keeps the reason, who asked, and the question as stored', () => {
    const [x] = normaliseAiRedoList([{ ...row, body: ' exactly  as typed ', marks: '3', display_number: '4(a)', question_state: 'set_aside' }]);
    expect(x.reason).toBe('Cut off');
    expect(x.asked_by_name).toBe('Asha');
    expect(x.body).toBe(' exactly  as typed ');
    expect(x.marks).toBe(3);
    expect(x.display_number).toBe('4(a)');
    expect(x.set_aside).toBe(true);
  });

  it('falls back to subject, class and school when a paper has no title', () => {
    const [x] = normaliseAiRedoList([{ ...row, paper_title: null, subject: 'Physics', cls: 'X', school: 'Beccon' }]);
    expect(x.paper_title).toBe('Physics · Class X · Beccon');
  });

  it('is empty for nothing', () => {
    expect(normaliseAiRedoList(null)).toEqual([]);
    expect(normaliseAiRedoList([])).toEqual([]);
  });

  it('knows a question on a frozen live Maths copy from any other', () => {
    const out = normaliseAiRedoList([
      { ...row, id: 'a', ai_redo_state: 'requested', paper_source: 'live_copy' },
      { ...row, id: 'b', ai_redo_state: 'requested', paper_source: 'new_ocr' },
      { ...row, id: 'c', ai_redo_state: 'requested' },
    ]);
    expect(out.map((x) => [x.id, x.live_copy])).toEqual([
      ['a', true],
      ['b', false],
      ['c', false],
    ]);
  });
});

describe('the story of a question', () => {
  it('is read oldest first, keeps the before and after words as stored, and drops rows without a time or an action', () => {
    const [x] = normaliseAiRedoList([
      {
        ...row,
        trail: [
          { at: '2026-11-19T10:00:00Z', action: 'ai_redo_done', who: 'AI check (Sonnet)', note: null, before: ' old  words ', after: 'new words', undone: false },
          { at: '2026-11-19T08:00:00Z', action: 'checker_ask_ai_redo', who: 'Asha', note: 'Cut off', before: null, after: null, undone: false },
          { at: '2026-11-19T09:00:00Z', action: '', who: 'x' },
          { action: 'hod_ai_redo_approve' },
        ],
      },
    ]);
    expect(x.trail.map((s) => s.action)).toEqual(['checker_ask_ai_redo', 'ai_redo_done']);
    expect(x.trail[1]).toMatchObject({ before: ' old  words ', after: 'new words', who: 'AI check (Sonnet)', undone: false });
  });

  it('is an empty story when the database sends none', () => {
    expect(normaliseAiRedoList([row])[0].trail).toEqual([]);
  });

  it('names every step of the flow in plain words, with no raw underscores', () => {
    for (const a of ['checker_ask_ai_redo', 'hod_ai_redo_approve', 'hod_ai_redo_decline', 'ai_redo_read', 'ai_redo_done', 'something_new_later']) {
      expect(aiRedoStepWords(a)).not.toMatch(/_/);
      expect(aiRedoStepWords(a)).not.toMatch(/[–—]/);
    }
    expect(aiRedoStepWords('checker_ask_ai_redo')).toBe('A student asked for the AI to redo it');
    expect(aiRedoStepWords('something_new_later')).toBe('Something new later');
  });
});

describe('the demo HOD desk', () => {
  it('lists a request at once, keeps it after a yes, and drops it after a no', async () => {
    const fake = createGoLiveFake(() => undefined, (id) => id);
    const before = await fake.api.aiRedoList();
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({ state: 'requested' });
    expect(before[0].trail.map((s) => s.action)).toEqual(['checker_ask_ai_redo']);
    expect(before[0].paper_title).not.toBe('');

    await fake.api.aiRedoDecide(before[0].id, true, '');
    const after = await fake.api.aiRedoList();
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id: before[0].id, state: 'approved', reason: before[0].reason });
    expect(after[0].trail.map((s) => s.action)).toEqual(['checker_ask_ai_redo', 'hod_ai_redo_approve']);

    const again = createGoLiveFake(() => undefined, (id) => id);
    await again.api.aiRedoDecide(before[0].id, false, '');
    expect(await again.api.aiRedoList()).toEqual([]);
  });
});

describe('saying yes or no from the tab', () => {
  it('re-reads the Send to AI list and the counts at once, and marks Needs you out of date', () => {
    const plan = hodRefreshPlan('hod', 'ai-redo');
    expect(plan.now).toContainEqual(['hod', 'hod', 'ai-redo']);
    expect(plan.now).toContainEqual(['hod', 'hod', 'counts']);
    expect(plan.later).toContainEqual(['hod', 'hod', 'needs-you']);
  });
});

describe('20261119300000_hod_ai_redo_list_live_copies.sql (the list function that shows live Maths copies too)', () => {
  it('only an HOD or admin can read it, and it is closed to visitors', () => {
    expect(sqlLive).toMatch(/not public\.is_hod\(\)/);
    expect(sqlLive).toContain("'42501'");
    expect(sqlLive).toMatch(/revoke all on function public\.hod_ai_redo_list\(\) from public, anon, authenticated/);
    expect(sqlLive).toMatch(/grant execute on function public\.hod_ai_redo_list\(\) to authenticated/);
  });

  it('lists requested, approved and redone questions, live Maths copies included, and says which kind of paper each is on', () => {
    expect(sqlLive).toMatch(/ai_redo_state in \('requested',\s*'approved',\s*'redone'\)/);
    expect(sqlLive).toContain("'paper_source', ap.source");
    expect(sqlLive).not.toMatch(/distinct from 'live_copy'/);
    expect(sqlLive).toContain("'trail'");
  });

  it('only reads: it never writes a table', () => {
    expect(sqlLive).not.toMatch(/\b(insert into|update public|delete from|alter table|drop table)\b/i);
  });
});

describe('20261119200000_hod_ai_redo_flow.sql (the previous list function, kept so it can be pasted back)', () => {
  it('only an HOD or admin can read it, and it is closed to visitors', () => {
    expect(sql).toMatch(/not public\.is_hod\(\)/);
    expect(sql).toContain("'42501'");
    expect(sql).toMatch(/revoke all on function public\.hod_ai_redo_list\(\) from public, anon, authenticated/);
    expect(sql).toMatch(/grant execute on function public\.hod_ai_redo_list\(\) to authenticated/);
  });

  it('lists requested, approved and redone questions and leaves out live Maths copies', () => {
    expect(sql).toMatch(/ai_redo_state in \('requested',\s*'approved',\s*'redone'\)/);
    expect(sql).toContain('live_copy');
  });

  it("carries each question's trail from the history log, since the student asked", () => {
    expect(sql).toContain("'trail'");
    expect(sql).toContain('public.audit_review_log');
    expect(sql).toMatch(/l\.question_id = q\.id/);
    expect(sql).toMatch(/q\.ai_redo_at/);
  });

  it('only reads: it never writes a table', () => {
    expect(sql).not.toMatch(/\b(insert into|update public|delete from|alter table|drop table)\b/i);
  });

  it('the first version stays as it was, so it can be pasted back to undo this one', () => {
    expect(sqlFirst).toMatch(/ai_redo_state in \('approved',\s*'redone'\)/);
    expect(sqlFirst).not.toContain("'trail'");
  });
});

describe('the screen', () => {
  const page = readFileSync('src/pages/Hod.tsx', 'utf8');
  const tab = readFileSync('src/components/hod/SendToAiTab.tsx', 'utf8');

  it('is on the desk as "Send to AI", right after Needs you', () => {
    expect(page).toContain("key: 'send-to-ai', label: 'Send to AI'");
    expect(page.indexOf("key: 'needs-you'")).toBeLessThan(page.indexOf("key: 'send-to-ai'"));
    expect(page.indexOf("key: 'send-to-ai'")).toBeLessThan(page.indexOf("key: 'ready'"));
  });

  it('shows waiting requests with a yes and a no, and refreshes the lists after either', () => {
    expect(tab).toContain('api.aiRedoList()');
    expect(tab).toContain('api.aiRedoDecide(item.id, approve');
    expect(tab).toContain("refreshHod(qc, scope, 'ai-redo')");
    expect(tab).toContain('Yes, it needs AI review');
    expect(tab).toContain('No, keep it with the HOD');
  });

  it('opens each question into its whole story, as a real disclosure button', () => {
    expect(tab).toContain('aria-expanded={open}');
    expect(tab).toContain('aria-controls={storyId}');
    expect(tab).toContain('See the whole story');
    expect(tab).toContain('data-testid="ai-redo-stages"');
  });

  it('gives a frozen live Maths copy a note and its own group, with no yes, no or Open paper', () => {
    expect(tab).toContain('data-testid="ai-redo-frozen-note"');
    expect(tab).toContain("item.state === 'requested' && !item.live_copy");
    expect(tab).toContain('{item.live_copy ? null : (');
    expect(tab).toContain('On frozen live Maths copies (cannot be decided here)');
  });

  it('sends nothing to the AI and uses no em or en dashes', () => {
    expect(tab).not.toMatch(/setQuestionState|sendBack|runAi|callAi/);
    expect(tab).not.toMatch(/[–—]/);
  });
});
