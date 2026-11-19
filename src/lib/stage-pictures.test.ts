import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: vi.fn(), from: vi.fn(), storage: { from: vi.fn() }, auth: { getSession: vi.fn(), onAuthStateChange: vi.fn() } },
}));

import { isAlreadyThere, normaliseStageItems } from '@/lib/hod-api';
import { pictureNote } from '@/components/hod/PaperSheet';
import { STAGE_FAILED_WORDS, STAGE_ROUNDS, groupByQuestion, stagePictures, unstagedCount, type StageOps, type StagePictureItem } from '@/lib/stage-pictures';

const read = (p: string) => readFileSync(p, 'utf8');

const item = (q: string, n: number, version = 1): StagePictureItem => ({
  question_id: q,
  question_version: version,
  from_path: `paper/${q}-${n}.png`,
  to_path: `staged/paper/${q}_${n}.png`,
  is_first: n === 1,
});

/** A fake store: the list shrinks as questions are confirmed, like the real database. */
function fakeOps(initial: StagePictureItem[], opts: { failCopyFor?: string[]; failOnce?: boolean; listNull?: boolean; listThrows?: boolean } = {}) {
  const done = new Set<string>();
  const log: string[] = [];
  const failedOnce = new Set<string>();
  const ops: StageOps = {
    async list() {
      if (opts.listThrows) throw new Error('offline');
      if (opts.listNull) return null;
      return initial.filter((i) => !done.has(i.question_id));
    },
    async copy(i) {
      if (opts.failCopyFor?.includes(i.question_id)) {
        if (!opts.failOnce || !failedOnce.has(i.question_id)) {
          failedOnce.add(i.question_id);
          throw new Error('The connection dropped.');
        }
      }
      log.push(`copy ${i.to_path}`);
    },
    async confirm(q, v) {
      log.push(`confirm ${q}@${v}`);
      done.add(q);
    },
  };
  return { ops, log, done };
}

describe('groupByQuestion', () => {
  it('keeps one group per question in the order sent', () => {
    const g = groupByQuestion([item('a', 1), item('a', 2), item('b', 1)]);
    expect(g.map((x) => x.map((i) => i.question_id + i.to_path.slice(-6)))).toEqual([['a_1.png', 'a_2.png'], ['b_1.png']]);
  });
});

describe('unstagedCount', () => {
  it('counts a question with a picture and no public copy, not a left-out one', () => {
    const q = (o: Partial<{ state: string; has_picture: boolean; picture_staged: boolean; figure_path: string | null }>) => ({ state: 'passed', has_picture: true, picture_staged: false, figure_path: null, ...o });
    expect(unstagedCount([q({}), q({ state: 'set_aside' }), q({ picture_staged: true }), q({ figure_path: 'staged/x.png' }), q({ has_picture: false })])).toBe(1);
  });
});

describe('stagePictures', () => {
  it('says nothing to do when the list is empty', async () => {
    expect(await stagePictures(fakeOps([]).ops, 'p')).toEqual({ kind: 'nothing' });
  });

  it('copies every picture of a question, then confirms that question with its version', async () => {
    const f = fakeOps([item('a', 1, 4), item('a', 2, 4), item('b', 1, 2)]);
    const out = await stagePictures(f.ops, 'p');
    expect(out).toEqual({ kind: 'done', staged: 2 });
    expect(f.log).toEqual(['copy staged/paper/a_1.png', 'copy staged/paper/a_2.png', 'confirm a@4', 'copy staged/paper/b_1.png', 'confirm b@2']);
  });

  it('never confirms a question whose copy failed, and still finishes the others', async () => {
    const f = fakeOps([item('a', 1), item('b', 1)], { failCopyFor: ['a'] });
    const out = await stagePictures(f.ops, 'p');
    expect(f.log).toContain('confirm b@1');
    expect(f.log.some((l) => l.startsWith('confirm a'))).toBe(false);
    expect(out.kind).toBe('failed');
    if (out.kind === 'failed') {
      expect(out.left).toBe(1);
      expect(out.staged).toBe(1);
      expect(out.message).toMatch(/connection dropped/);
    }
  });

  it('tries a failed question again in the next round and then succeeds', async () => {
    const f = fakeOps([item('a', 1)], { failCopyFor: ['a'], failOnce: true });
    expect(await stagePictures(f.ops, 'p')).toEqual({ kind: 'done', staged: 1 });
    expect(STAGE_ROUNDS).toBeGreaterThanOrEqual(2);
  });

  it('is unavailable (and changes nothing) when the server cannot say', async () => {
    const f = fakeOps([item('a', 1)], { listNull: true });
    expect(await stagePictures(f.ops, 'p')).toEqual({ kind: 'unavailable' });
    expect(f.log).toEqual([]);
  });

  it('reports a dropped connection on the list as failed with plain words, never throws', async () => {
    const out = await stagePictures(fakeOps([item('a', 1)], { listThrows: true }).ops, 'p');
    expect(out.kind).toBe('failed');
  });

  it('uses the plain default sentence when the error has no words of its own', async () => {
    const ops: StageOps = { list: async () => [item('a', 1)], copy: async () => Promise.reject({}), confirm: async () => undefined };
    const out = await stagePictures(ops, 'p');
    expect(out.kind === 'failed' && out.message).toBe(STAGE_FAILED_WORDS);
  });

  it('reports progress per question', async () => {
    const seen: string[] = [];
    await stagePictures(fakeOps([item('a', 1), item('b', 1)]).ops, 'p', (d, t) => seen.push(`${d}/${t}`));
    expect(seen).toEqual(['1/2', '2/2']);
  });
});

describe('the server rows', () => {
  it('keeps only rows that have everything a copy needs', () => {
    const rows = [
      { question_id: 'q1', question_version: 3, ord: 1, from_path: 'a/b.png', to_path: 'staged/a/q1_1.png', is_first: true },
      { question_id: 'q2', question_version: 1, from_path: '', to_path: 'staged/x.png', is_first: false },
      { from_path: 'a', to_path: 'b' },
    ];
    expect(normaliseStageItems(rows)).toEqual([{ question_id: 'q1', question_version: 3, from_path: 'a/b.png', to_path: 'staged/a/q1_1.png', is_first: true }]);
    expect(normaliseStageItems(null)).toEqual([]);
  });

  it('treats "already exists" on upload as done, nothing else', () => {
    expect(isAlreadyThere({ statusCode: '409', message: 'x' })).toBe(true);
    expect(isAlreadyThere({ message: 'The resource already exists' })).toBe(true);
    expect(isAlreadyThere({ statusCode: 403, message: 'new row violates row-level security policy' })).toBe(false);
    expect(isAlreadyThere(null)).toBe(false);
  });
});

describe('the screen', () => {
  it('shows a ready picture normally: a neutral note, never red, never "not on the site yet"', () => {
    for (const w of ['running', 'failed', 'unavailable', null, undefined] as const) {
      expect(pictureNote(w)).not.toMatch(/not on the site yet/i);
    }
    expect(pictureNote('running')).toMatch(/Getting this picture ready/);
    const sheet = read('src/components/hod/PaperSheet.tsx');
    const block = sheet.slice(sheet.indexOf('function UnstagedPicture'), sheet.indexOf('function SheetQuestion'));
    expect(block).not.toMatch(/destructive/);
    expect(block).not.toMatch(/not on the site yet/);
  });

  it('copies by itself when the paper opens, with a Try again button', () => {
    const flow = read('src/components/hod/PublishFlow.tsx');
    expect(flow).toContain('stagePictures(');
    expect(flow).toContain('data-testid="picture-work"');
    expect(flow).toMatch(/Try again/);
    expect(flow).toMatch(/pictureWork=\{pictureWork\}/);
  });
});

describe('the database file', () => {
  const sql = read('supabase/migrations/20261113300000_auto_stage_pictures.sql');
  it('lets an HOD add a png under staged/ only, and nothing else', () => {
    expect(sql).toMatch(/for insert to authenticated/);
    expect(sql).toMatch(/name like 'staged\/%'/);
    expect(sql).toMatch(/storage\.extension\(name\) = 'png'/);
    expect(sql).toMatch(/public\.is_hod\(\)/);
    expect(sql).not.toMatch(/for (update|delete)/);
  });
  it('closes both functions to signed-out visitors and checks HOD inside', () => {
    expect(sql).toMatch(/revoke all on function %s from public, anon, authenticated/);
    expect((sql.match(/if not public\.is_hod\(\)/g) ?? []).length).toBe(2);
    expect((sql.match(/set search_path = public, pg_temp/g) ?? []).length).toBe(2);
  });
  it('never touches live or live-copy papers and records through the versioned path', () => {
    expect(sql).toMatch(/ap\.source is distinct from 'live_copy'/);
    expect(sql).toMatch(/live_bank_paper_id is null/);
    expect(sql).toMatch(/apply_fix_locked/);
    expect(sql).toMatch(/storage\.objects/);
  });
});
