import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { createGoLiveFake } from '@/dummy/hod-golive-fake';
import { normaliseAiRedoList } from '@/lib/hod-publish';

/* The HOD desk's "Send to AI" tab (owner, 19 Nov 2026): every question an HOD approved for the AI to redo, in one list.
   The migration cannot run in CI (no database), so the load-bearing lines of the SQL file are pinned here too. */

const raw = readFileSync('supabase/migrations/20261119100000_hod_ai_redo_list.sql', 'utf8');
const sql = raw
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

const row = { id: 'q1', paper_id: 'p1', paper_title: 'Beccon X Maths', ai_redo_state: 'approved', ai_redo_reason: 'Cut off', asked_by_name: 'Asha' };

describe('reading the list', () => {
  it('keeps approved and redone questions and drops anything else', () => {
    const out = normaliseAiRedoList([
      row,
      { ...row, id: 'q2', ai_redo_state: 'redone' },
      { ...row, id: 'q3', ai_redo_state: 'requested' },
      { ...row, id: 'q4', ai_redo_state: null },
      { ...row, id: '' },
    ]);
    expect(out.map((x) => [x.id, x.state])).toEqual([
      ['q1', 'approved'],
      ['q2', 'redone'],
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
});

describe('the demo HOD desk', () => {
  it('lists a question only after the HOD says yes, and not after a no', async () => {
    const fake = createGoLiveFake(() => undefined, (id) => id);
    expect(await fake.api.aiRedoList()).toEqual([]);

    let asked: { id: string; reason: string | null } | null = null;
    for (const p of await fake.api.needsYouPapers()) {
      for (const q of await fake.api.needsYouQuestions(p.audit_paper_id)) {
        if (q.ai_redo_state === 'requested') asked = { id: q.id, reason: q.ai_redo_reason };
      }
    }
    expect(asked).not.toBeNull();

    await fake.api.aiRedoDecide(asked!.id, true, '');
    const list = await fake.api.aiRedoList();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: asked!.id, state: 'approved', reason: asked!.reason });
    expect(list[0].paper_title).not.toBe('');

    const again = createGoLiveFake(() => undefined, (id) => id);
    await again.api.aiRedoDecide(asked!.id, false, '');
    expect(await again.api.aiRedoList()).toEqual([]);
  });
});

describe('20261119100000_hod_ai_redo_list.sql', () => {
  it('only an HOD or admin can read it, and it is closed to visitors', () => {
    expect(sql).toMatch(/not public\.is_hod\(\)/);
    expect(sql).toContain("'42501'");
    expect(sql).toMatch(/revoke all on function public\.hod_ai_redo_list\(\) from public, anon, authenticated/);
    expect(sql).toMatch(/grant execute on function public\.hod_ai_redo_list\(\) to authenticated/);
  });

  it('lists only approved and redone questions and leaves out live Maths copies', () => {
    expect(sql).toMatch(/ai_redo_state in \('approved',\s*'redone'\)/);
    expect(sql).toContain('live_copy');
  });

  it('only reads: it never writes a table', () => {
    expect(sql).not.toMatch(/\b(insert into|update public|delete from|alter table|drop table)\b/i);
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

  it('only reads the list, never sends anything, and uses no em or en dashes', () => {
    expect(tab).toContain('api.aiRedoList()');
    expect(tab).not.toMatch(/aiRedoDecide|setQuestionState|sendBack/);
    expect(tab).not.toMatch(/[–—]/);
  });
});
