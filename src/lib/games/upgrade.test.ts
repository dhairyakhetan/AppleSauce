/**
 * Upgrade 1 of the games schema (supabase/games/upgrade-1-team-log-and-pages.sql), run after install.sql on an empty
 * in-memory Postgres (PGlite) with Supabase's sign-in stubbed: the dry run, the checks that nothing that exists changes,
 * who can call what, the team's log, and Approve questions a page at a time. The tests run in order and build on each
 * other. Nothing here touches a real database.
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const INSTALL = readFileSync('supabase/games/install.sql', 'utf8')
  .replace(/'games_install\.moderator', '[^']*'/, "'games_install.moderator', 'mod@x.in'")
  .replace("'games_install.dry_run', 'yes'", "'games_install.dry_run', 'no'");
const UPGRADE = readFileSync('supabase/games/upgrade-1-team-log-and-pages.sql', 'utf8');
const upgrade = (dryRun = 'no') => UPGRADE.replace("'games_upgrade.dry_run', 'yes'", `'games_upgrade.dry_run', '${dryRun}'`);
/** The upgrade with something slipped in just before its checks. */
const sneaking = (sql: string) => upgrade().replace('-- ---------------------------------------------------------------- checks', `${sql}\n-- checks`);

async function supabaseLike(install = true) {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create schema auth;
    create function auth.jwt() returns jsonb language sql stable as $$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt() ->> 'sub')::uuid $$;
    grant usage on schema auth to anon, authenticated;`);
  if (install) await db.exec(INSTALL);
  return db;
}
async function failure(on: PGlite, script: string): Promise<string> {
  try {
    await on.exec(script);
    return 'it worked';
  } catch (e) {
    return (e as Error).message;
  } finally {
    await on.exec('rollback');
  }
}
const has = async (on: PGlite, what: string) => (await on.query<Json>(`select to_regclass('${what}') is not null as x`)).rows[0].x as boolean;

const ids: Record<string, string> = {};
const claims = (email: string) => {
  ids[email] ??= `00000000-0000-0000-0000-${String(Object.keys(ids).length + 1).padStart(12, '0')}`;
  return {
    sub: ids[email], email, role: 'authenticated', amr: [{ method: 'oauth', timestamp: 1_791_756_427 }],
    app_metadata: { provider: 'google', providers: ['google'] }, user_metadata: { full_name: email.split('@')[0] },
  };
};
async function run(on: PGlite, role: 'anon' | 'authenticated', email: string | null, sql: string, params?: unknown[]): Promise<{ rows?: Json[]; error?: string }> {
  await on.exec(`set role ${role}; select set_config('request.jwt.claims', '${email ? JSON.stringify(claims(email)).replace(/'/g, "''") : ''}', false);`);
  try {
    return { rows: (await on.query<Json>(sql, params)).rows };
  } catch (e) {
    return { error: (e as Error).message };
  } finally {
    await on.exec('reset role');
  }
}

let db: PGlite;
const as = (email: string, sql: string, params?: unknown[]) => run(db, 'authenticated', email, sql, params);
async function value(email: string, sql: string, params?: unknown[]) {
  const r = await as(email, sql, params);
  expect(r.error, sql).toBeUndefined();
  return Object.values(r.rows![0])[0] as Json;
}
const refused = (r: { error?: string }, why: RegExp) => expect(r.error ?? 'it was allowed').toMatch(why);
const Q = (n: number, x: object = {}) => ({
  chapter_id: 'CBSE10SCI01', topic_id: 'CBSE10SCI01T01', board: 'CBSE', class: 10, subject: 'Science', chapter_no: 1, chapter: 'Chemical Reactions',
  topic_no: 1, topic: 'Equations', question: `Question number ${n}`, answer: `Answer ${n}`, difficulty: null, ...x,
});
const send = (email: string, qs: object[]) => value(email, 'select games.submit_batch($1::jsonb)', [JSON.stringify(qs)]);

beforeAll(async () => {
  db = await supabaseLike();
  await db.exec(`insert into games.team (email, role, added_by) values ('hod@x.in', 'hod', 'mod@x.in'), ('ann@x.in', 'member', 'mod@x.in')`);
}, 60_000);

describe('running it', () => {
  it('as committed, it is a dry run that keeps nothing', async () => {
    const fresh = await supabaseLike();
    expect(await failure(fresh, UPGRADE)).toMatch(/^Dry run passed: everything worked \(the team's log starts with 1 person\)/);
    expect(await has(fresh, 'games.team_log')).toBe(false);
  }, 60_000);

  it('stops, changing nothing, when the games schema is not installed', async () => {
    const empty = await supabaseLike(false);
    expect(await failure(empty, upgrade())).toMatch(/The games schema isn't installed\. Run supabase\/games\/install\.sql first/);
  }, 60_000);

  it('stops, keeping nothing, if anything that exists would change, inside games or outside', async () => {
    for (const sneak of [
      'grant select on games.team to authenticated;',
      `create or replace function games.waiting_count() returns int language sql as 'select 0';`,
      'create function public.sneaky() returns int language sql as \'select 1\';',
      'alter table games.batches add column x int;',
      `create function games.extra() returns int language sql as 'select 1';`,
    ]) {
      const fresh = await supabaseLike();
      expect(await failure(fresh, sneaking(sneak)), sneak).toMatch(/^Stopped: this would (change something that already exists|add something it shouldn't)/);
      expect(await has(fresh, 'games.team_log'), sneak).toBe(false);
    }
  }, 120_000);

  it('runs for real, and a second run stops at its first create, changing nothing', async () => {
    await db.exec(upgrade());
    expect(await has(db, 'games.team_log')).toBe(true);
    expect(await failure(db, upgrade())).toMatch(/relation "team_log" already exists/);
  }, 60_000);

  it('signed-out visitors can call nothing new; nobody reads the log directly', async () => {
    for (const f of ['games.admin_team_log()', 'games.hod_counts()', 'games.hod_waiting()', 'games.hod_sent_back()']) {
      refused(await run(db, 'anon', null, `select ${f}`), /permission denied/);
    }
    refused(await as('mod@x.in', 'select * from games.team_log'), /permission denied/);
    refused(await as('mod@x.in', "insert into games.team_log (action, person, role) values ('add', 'x@x.in', 'admin')"), /permission denied/);
  });
});

describe("the team's log", () => {
  it('starts with everyone on the team, as they were added', async () => {
    const log = await value('mod@x.in', 'select games.admin_team_log()');
    // in the order they were added (the moderator at install, then the others), newest first
    expect(log.map((l: Json) => [l.action, l.person, l.role, l.before_log])).toEqual([
      ['add', 'hod@x.in', 'hod', true], ['add', 'ann@x.in', 'member', true], ['add', 'mod@x.in', 'admin', true],
    ]);
    expect(log).toHaveLength(3);
    expect(log.every((l: Json) => l.before_log)).toBe(true);
  });

  it('notes each addition, role change and removal, with who did it, newest first', async () => {
    await value('mod@x.in', "select games.admin_team_set('New@X.in', 'member')");
    await value('mod@x.in', "select games.admin_team_set('new@x.in', 'hod')");
    await value('mod@x.in', "select games.admin_team_set('new@x.in', 'hod')"); // no change: nothing noted
    await value('mod@x.in', "select games.admin_team_remove('ann@x.in')");
    const log = await value('mod@x.in', 'select games.admin_team_log()');
    expect(log.slice(0, 3).map((l: Json) => [l.action, l.person, l.role, l.old_role, l.by])).toEqual([
      ['remove', 'ann@x.in', 'member', null, 'mod@x.in'],
      ['role', 'new@x.in', 'hod', 'member', 'mod@x.in'],
      ['add', 'new@x.in', 'member', null, 'mod@x.in'],
    ]);
    expect((await db.query<Json>("select count(*)::int n from games.team where email = 'new@x.in' and role = 'hod'")).rows[0].n).toBe(1);
  });

  it("keeps admin_set_role's and admin_remove's checks, and notes nothing that was refused", async () => {
    const before = (await value('mod@x.in', 'select games.admin_team_log()')).length;
    refused(await as('mod@x.in', "select games.admin_team_set('mod@x.in', 'member')"), /can't take away your own admin role/);
    refused(await as('mod@x.in', "select games.admin_team_remove('mod@x.in')"), /can't remove yourself/);
    refused(await as('hod@x.in', "select games.admin_team_set('z@x.in', 'member')"), /Only a games admin/);
    refused(await as('mod@x.in', "select games.admin_team_set('not an email', 'member')"), /doesn't look like an email/);
    refused(await as('hod@x.in', 'select games.admin_team_log()'), /Only a games admin can see the team's log/);
    expect((await value('mod@x.in', 'select games.admin_team_log()')).length).toBe(before);
  });

  it('pages through the log, 20 at a time by default, with no repeats', async () => {
    for (let i = 0; i < 25; i++) await value('mod@x.in', `select games.admin_team_set('p${i}@x.in', 'member')`);
    const first = await value('mod@x.in', 'select games.admin_team_log()');
    expect(first).toHaveLength(20);
    const next = await value('mod@x.in', 'select games.admin_team_log($1)', [first.at(-1).id]);
    expect(next.length).toBeGreaterThan(0);
    expect(next.every((l: Json) => l.id < first.at(-1).id)).toBe(true);
  });
});

describe('Approve questions, a page at a time', () => {
  beforeAll(async () => {
    await db.exec(`delete from games.chapters;
      insert into games.chapters (chapter_id, board, class, subject, chapter_no, name) values ('CBSE10SCI01', 'CBSE', 10, 'Science', 1, 'Chemical Reactions');
      insert into games.topics (topic_id, chapter_id, topic_no, name) values ('CBSE10SCI01T01', 'CBSE10SCI01', 1, 'Equations');
      insert into games.team (email, role) values ('ann@x.in', 'member') on conflict do nothing;`);
    // five batches of two questions each, sent one after another
    for (let b = 0; b < 5; b++) await send('ann@x.in', [Q(b * 2 + 1), Q(b * 2 + 2)]);
  });

  it('counts what is waiting, approved and sent back, for HoDs and admins only', async () => {
    expect(await value('hod@x.in', 'select games.hod_counts()')).toEqual({ waiting: 10, approved: 0, sent_back: 0 });
    refused(await as('ann@x.in', 'select games.hod_counts()'), /Only HoDs and admins/);
  });

  it('gives the waiting questions a few batches at a time, newest batch first, with who sent them', async () => {
    const first = await value('hod@x.in', 'select games.hod_waiting()');
    const batches = (qs: Json[]) => [...new Set(qs.map((q) => q.batch_id))];
    expect(batches(first)).toHaveLength(3);
    expect(first[0]).toMatchObject({ teacher: 'ann', teacher_email: 'ann@x.in', status: 'pending' });
    expect(first.map((q: Json) => q.question)).toEqual(['Question number 9', 'Question number 10', 'Question number 7', 'Question number 8', 'Question number 5', 'Question number 6']);
    const last = first.at(-1);
    const next = await value('hod@x.in', 'select games.hod_waiting($1, $2)', [last.sent_at, last.batch_id]);
    expect(batches(next)).toHaveLength(2);
    expect(next.map((q: Json) => q.question)).toEqual(['Question number 3', 'Question number 4', 'Question number 1', 'Question number 2']);
    refused(await as('ann@x.in', 'select games.hod_waiting()'), /Only HoDs and admins/);
  });

  it('a batch with nothing left waiting is not shown; sent-back questions come 20 at a time, newest first', async () => {
    const all = await value('hod@x.in', 'select games.hod_waiting(null, null, 50)');
    const newest = all.filter((q: Json) => q.batch_id === all[0].batch_id).map((q: Json) => q.question_id);
    await value('hod@x.in', "select games.hod_set_status($1::text[], 'rejected', 'Check the wording')", [newest]);
    const now = await value('hod@x.in', 'select games.hod_waiting()');
    expect(now.some((q: Json) => newest.includes(q.question_id))).toBe(false);
    expect(await value('hod@x.in', 'select games.hod_counts()')).toEqual({ waiting: 8, approved: 0, sent_back: 2 });
    const back = await value('hod@x.in', 'select games.hod_sent_back()');
    expect(back.map((q: Json) => [q.status, q.note])).toEqual([['rejected', 'Check the wording'], ['rejected', 'Check the wording']]);
    const one = await value('hod@x.in', 'select games.hod_sent_back(null, null, 1)');
    const rest = await value('hod@x.in', 'select games.hod_sent_back($1, $2, 1)', [one[0].reviewed_at, one[0].question_id]);
    expect(rest).toHaveLength(1);
    expect(rest[0].question_id).not.toBe(one[0].question_id);
    refused(await as('ann@x.in', 'select games.hod_sent_back()'), /Only HoDs and admins/);
  });
});
