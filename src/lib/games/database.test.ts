/**
 * The games schema (supabase/games/install.sql), run on an empty in-memory Postgres (PGlite) with Supabase's sign-in
 * stubbed: installing it (the dry run, the moderator line, the check that nothing outside `games` changes), who can call
 * what, how the sign-in counts, the fixed list of chapters and topics, sending, numbering, duplicates, sending back,
 * approving and the team. Nothing here touches a real database. The tests in a file run in order and build on each other.
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { ALL_BOARDS, SUBJECTS } from './details';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any
type Result = { rows?: Json[]; error?: string };

const SQL = readFileSync('supabase/games/install.sql', 'utf8');
/** The moderator's email, as committed. */
const MODERATOR = 'dhairyaplayz97@gmail.com';
/** The script with a moderator and the dry run switched off, as it is run for real. */
const installable = (moderator = 'mod@x.in', dryRun = 'no') =>
  SQL.replace(`'games_install.moderator', '${MODERATOR}'`, `'games_install.moderator', '${moderator}'`).replace("'games_install.dry_run', 'yes'", `'games_install.dry_run', '${dryRun}'`);

/** An empty Postgres with what Supabase provides: the roles, and auth.uid() and auth.jwt() reading the token. */
async function supabaseLike() {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create schema auth;
    create function auth.jwt() returns jsonb language sql stable as $$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt() ->> 'sub')::uuid $$;
    grant usage on schema auth to anon, authenticated;
    create table public.profiles (id uuid primary key, full_name text);`);
  return db;
}

const db = await supabaseLike();
const ids: Record<string, string> = {};

/** How the session was signed in: Google, an email link, a password, or another OAuth provider. */
type Via = 'google' | 'link' | 'password' | 'github';
/** A signed-in person's token, as Supabase gives it. `providers` defaults to what that sign-in would leave. */
function claims(email: string, { via = 'google', name, providers, phone = '' }: { via?: Via; name?: string | null; providers?: string[]; phone?: string } = {}) {
  ids[email] ??= `00000000-0000-0000-0000-${String(Object.keys(ids).length + 1).padStart(12, '0')}`;
  const method = { google: 'oauth', github: 'oauth', link: 'otp', password: 'password' }[via];
  return {
    sub: ids[email], email, phone, role: 'authenticated', aal: 'aal1',
    amr: [{ method, timestamp: 1_791_756_427 }],
    app_metadata: { provider: via === 'link' || via === 'password' ? 'email' : via, providers: providers ?? [via === 'link' || via === 'password' ? 'email' : via] },
    user_metadata: name === null ? {} : { full_name: name ?? email.split('@')[0] },
  };
}
type Opts = Parameters<typeof claims>[1];
async function run(on: PGlite, role: 'anon' | 'authenticated', pass: object | null, sql: string, params?: unknown[]): Promise<Result> {
  await on.exec(`set role ${role}; select set_config('request.jwt.claims', '${pass ? JSON.stringify(pass).replace(/'/g, "''") : ''}', false);`);
  try {
    return { rows: (await on.query<Json>(sql, params)).rows };
  } catch (e) {
    return { error: (e as Error).message };
  } finally {
    await on.exec('reset role');
  }
}
const anon = (sql: string) => run(db, 'anon', null, sql);
const as = (email: string, sql: string, params?: unknown[], opts?: Opts) => run(db, 'authenticated', claims(email, opts), sql, params);
/** The value a call returns; fails the test if the call fails. */
async function value(email: string, sql: string, params?: unknown[], opts?: Opts) {
  const r = await as(email, sql, params, opts);
  expect(r.error, sql).toBeUndefined();
  return Object.values(r.rows![0])[0] as Json;
}
const admin = async (sql: string, params?: unknown[]) => (await db.query<Json>(sql, params)).rows;
/** As the database owner, catching a refusal. */
const adminTry = async (sql: string): Promise<Result> => {
  try { return { rows: (await db.query<Json>(sql)).rows }; } catch (e) { return { error: (e as Error).message }; }
};
const refused = (r: Result, why: RegExp) => expect(r.error ?? 'it was allowed').toMatch(why);
/** Runs a script that should fail, ends its transaction, and gives the error. */
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
const schemas = async (on: PGlite) => (await on.query<Json>(`select count(*)::int n from pg_namespace where nspname = 'games'`)).rows[0].n;
const count = async (sql: string) => (await admin(`select count(*)::int n from ${sql}`))[0].n as number;

const Q = (question: string, answer: string, x: object = {}) => ({
  chapter_id: 'CBSE10SCI01', topic_id: 'CBSE10SCI01T01', board: 'CBSE', class: 10, subject: 'Science', chapter_no: 1,
  chapter: 'Chemical Reactions', topic_no: 1, topic: 'Equations', question, answer, difficulty: null, ...x,
});
const send = (email: string, qs: unknown, opts?: Opts) => as(email, 'select games.submit_batch($1::jsonb) r', [JSON.stringify(qs)], opts);
const sent = (email: string, qs: unknown, opts?: Opts) => value(email, 'select games.submit_batch($1::jsonb)', [JSON.stringify(qs)], opts);
const decide = (email: string, list: string[], status: string, reason = '') => as(email, 'select games.hod_set_status($1::text[], $2, $3) r', [list, status, reason]);
const notes = (email: string) => value(email, 'select games.my_sent_back()');

beforeAll(async () => {
  await db.exec(installable());
  await admin(`insert into games.team (email, role) values ('hod@x.in', 'hod'), ('ann@x.in', 'member'), ('ben@x.in', 'member'),
    ('fay@x.in', 'member'), ('dan@x.in', 'member'), ('eve@x.in', 'member'), ('zed@x.in', 'member'), ('noname@x.in', 'member'),
    ('long@x.in', 'member'), ('bulk@x.in', 'member')`);
  // a small list of chapters and topics, the way the real one is loaded
  await admin(`insert into games.chapters (chapter_id, board, class, subject, chapter_no, name) values
    ('CBSE10SCI01', 'CBSE', 10, 'Science', 1, 'Chemical Reactions'), ('CBSE10SCI02', 'CBSE', 10, 'Science', 2, 'Acids, Bases and Salts'),
    ('MH10SCI01', 'Maharashtra State Board', 10, 'Science', 1, 'Gravitation'), ('CBSE10ROB01', 'CBSE', 10, 'Robotics', 1, 'Sensors')`);
  await admin(`insert into games.topics (topic_id, chapter_id, topic_no, name) select 'CBSE10SCI01T' || lpad(n::text, 2, '0'), 'CBSE10SCI01', n,
    case n when 1 then 'Equations' else 'Topic ' || n end from generate_series(1, 5) n`);
  await admin(`insert into games.topics (topic_id, chapter_id, topic_no, name) values ('CBSE10SCI02T01', 'CBSE10SCI02', 1, 'Equations')`);
}, 60_000);

describe('installing it', () => {
  it('as committed, it is a dry run with the moderator filled in, keeping nothing', async () => {
    expect(SQL).toContain(`select set_config('games_install.moderator', '${MODERATOR}', true);`);
    const fresh = await supabaseLike();
    expect(await failure(fresh, SQL)).toMatch(/Dry run passed/);
    expect(await schemas(fresh)).toBe(0);
  });

  it('stops, keeping nothing, if the moderator line is not an email', async () => {
    const fresh = await supabaseLike();
    expect(await failure(fresh, installable('not an email'))).toMatch(/Put the moderator's Google email on the MODERATOR line/);
    expect(await schemas(fresh)).toBe(0);
  });

  it('the dry run does everything, then undoes it', async () => {
    const fresh = await supabaseLike();
    expect(await failure(fresh, installable('mod@x.in', 'yes'))).toMatch(/Dry run passed/);
    expect(await schemas(fresh)).toBe(0);
  });

  it('stops, keeping nothing, if anything outside games would change', async () => {
    for (const sneak of [
      `create function public.sneaky() returns int language sql as 'select 1';`,
      `grant select on public.profiles to anon;`,
      `create policy sneaky on public.profiles for select using (true);`,
      `alter default privileges grant execute on functions to anon;`,
      `create trigger sneaky after insert on public.profiles for each row execute function games.sync_question_bank();`,
    ]) {
      const fresh = await supabaseLike();
      const script = installable().replace('-- ---------------------------------------------------------------- checks', `${sneak}\n-- -------- checks`);
      expect(await failure(fresh, script), sneak).toMatch(/Stopped: this would change something outside the games schema/);
      expect(await schemas(fresh), sneak).toBe(0);
    }
  }, 60_000);

  it('a second run stops at "create schema games", changing nothing', async () => {
    expect(await failure(db, installable())).toMatch(/schema "games" already exists/);
    expect(await count('games.team where moderator')).toBe(1);
  });

  it('knows exactly the boards and subjects the site knows, with the same codes', async () => {
    expect((await admin('select name, code from games.boards order by name')).map((b) => `${b.name}=${b.code}`).sort())
      .toEqual(ALL_BOARDS.map((b) => `${b.name}=${b.code}`).sort());
    expect((await admin('select name, code from games.subjects order by name')).map((s) => `${s.name}=${s.code}`).sort())
      .toEqual(SUBJECTS.map((s) => `${s.name}=${s.code}`).sort());
  });

  it('signed-out visitors can call nothing, and signed-in people only the site\'s functions', async () => {
    const callable = async (role: string) => (await admin(`select p.proname from pg_proc p where p.pronamespace = 'games'::regnamespace and has_function_privilege('${role}', p.oid, 'EXECUTE') order by 1`)).map((r) => r.proname);
    expect(await callable('anon')).toEqual([]);
    expect(await callable('authenticated')).toEqual(['admin_people', 'admin_remove', 'admin_set_role', 'bank', 'bank_count', 'catalog', 'hod_approved',
      'hod_questions', 'hod_set_status', 'mark_sent_back_seen', 'my_role', 'my_sent_back', 'submit_batch', 'waiting_count']);
  });
});

describe('who can call what, and how the sign-in counts', () => {
  it('signed-out visitors get nothing', async () => {
    refused(await anon('select games.my_role()'), /permission denied/);
    refused(await anon('select * from games.question_bank'), /permission denied/);
  });

  it('nobody signed in can read or write the tables directly', async () => {
    for (const t of ['team', 'batches', 'questions', 'question_bank', 'chapters', 'topics', 'settings']) {
      refused(await as('mod@x.in', `select * from games.${t}`), /permission denied/);
    }
    refused(await as('mod@x.in', `insert into games.team (email, role) values ('me@x.in', 'admin')`), /permission denied/);
    refused(await as('mod@x.in', 'select games.team_role()'), /permission denied/);
  });

  it('a Google sign-in or an email link counts; a password, or another provider, doesn\'t', async () => {
    expect(await value('ann@x.in', 'select games.my_role()')).toBe('member');
    expect(await value('ann@x.in', 'select games.my_role()', [], { via: 'link' })).toBe('member');
    expect(await value('ann@x.in', 'select games.my_role()', [], { via: 'password' })).toBe('reauth');
    expect(await value('ann@x.in', 'select games.my_role()', [], { via: 'github' })).toBe('reauth');
    // the account has Google linked, but this session was signed in with its password: still not proven
    expect(await value('ann@x.in', 'select games.my_role()', [], { via: 'password', providers: ['email', 'google'] })).toBe('reauth');
    refused(await send('ann@x.in', [Q('Sneaky?', 'Yes')], { via: 'password', providers: ['email', 'google'] }), /Sign in with Google/);
    // a code sent by text message is recorded like an email link: on an account with a phone it proves nothing
    expect(await value('ann@x.in', 'select games.my_role()', [], { via: 'link', providers: ['email', 'phone'] })).toBe('reauth');
    expect(await value('ann@x.in', 'select games.my_role()', [], { via: 'link', phone: '919800000000' })).toBe('reauth');
    expect(await value('ann@x.in', 'select games.my_role()', [], { providers: ['google', 'phone'], phone: '919800000000' })).toBe('member'); // Google still counts
    expect(await value('stranger@x.in', 'select games.my_role()')).toBeNull(); // not on the team
    expect(await count(`games.team where email = 'stranger@x.in'`)).toBe(0); // and not added by asking
  });

  it('my_role notes the name, and writes nothing on a visit within 10 minutes', async () => {
    await value('hod@x.in', 'select games.my_role()', [], { name: 'Mrs Hod' });
    expect((await admin(`select name from games.team where email = 'hod@x.in'`))[0].name).toBe('Mrs Hod');
    const row = async () => (await admin(`select xmin::text x from games.team where email = 'hod@x.in'`))[0].x;
    const before = await row();
    await value('hod@x.in', 'select games.my_role()', [], { name: 'Mrs Hod' });
    expect(await row()).toBe(before);
  });

  it('members can\'t open the HoD desk or manage the team; HoDs can\'t manage the team', async () => {
    for (const f of ['waiting_count()', 'hod_questions()', 'hod_approved()', `hod_set_status('{}', 'approved', '')`]) refused(await as('ann@x.in', `select games.${f}`), /Only HoDs and admins/);
    for (const f of ['admin_people()', `admin_set_role('b@x.in', 'hod')`, `admin_remove('hod@x.in')`]) refused(await as('ann@x.in', `select games.${f}`), /Only a games admin/);
    refused(await as('hod@x.in', 'select games.admin_people()'), /Only a games admin/);
  });
});

describe('the team', () => {
  it('admins add people and change roles; nobody demotes or removes the moderator, or themselves', async () => {
    refused(await as('mod@x.in', `select games.admin_set_role('not-an-email', 'hod')`), /doesn't look like an email/);
    refused(await as('mod@x.in', `select games.admin_set_role('x@y.in', 'boss')`), /Unknown role/);
    await value('mod@x.in', `select games.admin_set_role('  Gus@X.IN ', 'hod')`);
    expect(await value('gus@x.in', 'select games.my_role()')).toBe('hod');
    refused(await as('mod@x.in', `select games.admin_set_role('mod@x.in', 'member')`), /own admin role/);
    refused(await as('mod@x.in', `select games.admin_remove('MOD@x.in')`), /remove yourself/);
    await value('mod@x.in', `select games.admin_set_role('dee@x.in', 'admin')`);
    refused(await as('dee@x.in', `select games.admin_set_role('mod@x.in', 'hod')`), /moderator stays an admin/);
    refused(await as('dee@x.in', `select games.admin_remove('mod@x.in')`), /moderator can't be removed/);
    await value('dee@x.in', `select games.admin_remove('gus@x.in')`);
    expect(await value('gus@x.in', 'select games.my_role()')).toBeNull();
    const people = await value('mod@x.in', 'select games.admin_people()');
    expect(people[0]).toMatchObject({ email: 'mod@x.in', moderator: true });
  });
});

describe('the fixed list and sending', () => {
  it('the team sees the list; others don\'t', async () => {
    const list = await value('ann@x.in', 'select games.catalog()');
    expect(list.map((c: Json) => c.chapter_id)).toEqual(['CBSE10ROB01', 'CBSE10SCI01', 'CBSE10SCI02', 'MH10SCI01']);
    expect(list[1].topics).toHaveLength(5);
    refused(await as('stranger@x.in', 'select games.catalog()'), /Only people on the games team/);
  });

  it('takes only chapters and topics on the list, under the list\'s names', async () => {
    refused(await send('ann@x.in', [Q('Off the list?', 'A', { chapter_id: 'CBSE10SCI07', chapter_no: 7 })]), /Chapter 7 \(CBSE, class 10, Science\) isn't on the list/);
    refused(await send('ann@x.in', [Q('Other name?', 'A', { chapter: 'Reactions' })]), /called "Chemical Reactions" on the list, not "Reactions"/);
    refused(await send('ann@x.in', [Q('Topic 9?', 'A', { topic_no: 9, topic_id: 'CBSE10SCI01T09' })]), /no topic 9 on the list/);
    refused(await send('ann@x.in', [Q('Wrong topic name?', 'A', { topic: 'Balancing' })]), /Topic 1 of chapter 1 is called "Equations" on the list, not "Balancing"/);
    refused(await send('ann@x.in', [Q('No topic?', 'A', { topic_no: null, topic_id: null, topic: '' })]), /has no topic/);
    refused(await send('ann@x.in', [Q('Topic where there are none?', 'A', { board: 'Maharashtra State Board', chapter_id: 'MH10SCI01', chapter: 'Gravitation', topic_id: null })]), /no topics on the list/);
    const r = await sent('ann@x.in', [Q('Case and spaces in the names?', 'Fine', { chapter: '  chemical   reactions ', topic: 'equations.' })]);
    expect((await admin('select chapter, topic from games.questions where question_id = $1', [r.question_ids[0]]))[0]).toEqual({ chapter: 'Chemical Reactions', topic: 'Equations' });
    expect((await send('ann@x.in', [Q('No topic where there are none?', 'Fine', { board: 'Maharashtra State Board', chapter_id: 'MH10SCI01', chapter: 'Gravitation', topic_no: null, topic_id: null, topic: '' })])).error).toBeUndefined();
  });

  it('refuses a batch that is empty, too big, or has a question with no chapter ID', async () => {
    refused(await send('ann@x.in', { not: 'a list' }), /between 1 and 500/);
    refused(await send('ann@x.in', []), /between 1 and 500/);
    refused(await send('ann@x.in', Array.from({ length: 501 }, (_, i) => Q(`Q${i}?`, 'A'))), /between 1 and 500/);
    refused(await send('ann@x.in', [Q('No chapter?', 'A', { chapter_id: null })]), /no chapter ID/);
  });

  it('takes only boards and subjects on the list, with their own codes in the chapter ID', async () => {
    for (const x of [{ subject: 'Mathematics' }, { board: 'ICSE' }, { chapter_id: 'cbse10sci01' }]) refused(await send('ann@x.in', [Q('Code check?', 'A', x)]), /doesn't match/);
    refused(await send('ann@x.in', [Q('Typo?', 'A', { subject: 'Scince' })]), /subject "Scince" isn't on the site's list/);
    refused(await send('ann@x.in', [Q('Made-up board?', 'No', { board: 'Dps Board', chapter_id: 'DPSB10SCI01' })]), /board "Dps Board" isn't on the site's list/);
  });

  it('works out each topic ID itself, and keeps to the limits', async () => {
    const r = await sent('ann@x.in', [Q('Topic ID that disagrees?', 'A', { topic_id: 'CBSE10SCI01T09' })]);
    expect((await admin('select topic_id from games.questions where question_id = $1', [r.question_ids[0]]))[0].topic_id).toBe('CBSE10SCI01T01');
    for (const x of [{ answer: 'a'.repeat(101) }, { question: 'q'.repeat(301) }, { answer: '  ' }, { difficulty: 'tough' }]) {
      expect((await send('ann@x.in', [Q('Limits?', 'Answer', x)])).error, JSON.stringify(x).slice(0, 40)).toBeDefined();
    }
    expect((await send('ann@x.in', [Q('q'.repeat(300), 'b'.repeat(100))])).error).toBeUndefined();
  });

  it('numbers questions within their topic, skips repeats, and gives batch IDs that say the day', async () => {
    const day = (await admin(`select to_char(now() at time zone 'Asia/Kolkata', 'YYYYMMDD') d`))[0].d;
    const b = await sent('ann@x.in', [Q('What is rust?', 'Iron oxide'), Q('What is rust?', 'Iron oxide'), Q('Topic two?', 'Fine', { topic_no: 2, topic: 'Topic 2' })]);
    expect(b.batch_id).toMatch(new RegExp(`^B${day}-\\d{2}$`));
    expect([b.sent, b.already]).toEqual([2, 1]);
    expect(b.question_ids).toContain('CBSE10SCI01T02Q001');
    const again = await sent('ann@x.in', [Q('WHAT IS  RUST', 'iron oxide'), Q('What is rust?!', 'Something else')]);
    expect(again).toMatchObject({ sent: 0, already: 2, batch_id: null });
    expect((await sent('ann@x.in', [Q('What is rust?', 'Iron oxide', { chapter_id: 'CBSE10SCI02', chapter_no: 2, chapter: 'Acids, Bases and Salts', topic_id: 'CBSE10SCI02T01' })])).sent).toBe(1);
    const days = (await admin(`select batch_id from games.batches where batch_id like 'B${day}-%' order by 1`)).map((x) => x.batch_id);
    expect(days).toEqual(days.map((_, i) => `B${day}-${String(i + 1).padStart(2, '0')}`)); // no gaps
  });

  it('says plainly when a topic is full (999 questions, as the IDs have three digits), and keeps nothing from that batch', async () => {
    const day = (await admin(`select to_char(now() at time zone 'Asia/Kolkata', 'YYYYMMDD') d`))[0].d;
    await admin(`insert into games.batches (batch_id, teacher, teacher_email) values ('B${day}-99', 'Bulk', 'bulk@x.in')`);
    await admin(`insert into games.questions (question_id, batch_id, chapter_id, topic_id, board, class, subject, chapter_no, chapter, topic_no, topic, question_no, question, answer)
      values ('CBSE10SCI01T05Q999', 'B${day}-99', 'CBSE10SCI01', 'CBSE10SCI01T05', 'CBSE', 10, 'Science', 1, 'Chemical Reactions', 5, 'Topic 5', 999, 'The last one?', 'Yes')`);
    const before = await count('games.questions');
    refused(await send('bulk@x.in', [Q('Fits elsewhere?', 'Yes'), Q('One too many?', 'No', { topic_no: 5, topic: 'Topic 5' })]),
      /^Topic 5 \("Topic 5"\) of chapter 1 already has 999 questions, the most it can hold\. Nothing was sent\.$/);
    expect(await count('games.questions')).toBe(before);
    await admin(`delete from games.questions where question_id = 'CBSE10SCI01T05Q999'`);
    await admin(`delete from games.batches where batch_id = 'B${day}-99'`);
  });

  it('keeps the wrong options of a multiple-choice question, and refuses broken ones', async () => {
    const r = await sent('zed@x.in', [Q('Gas in chip packets?', 'Nitrogen', { wrong_options: [' Oxygen ', 'Hydrogen', 'Carbon dioxide'] }), Q('Plain one?', 'Yes')]);
    const rows = await admin('select question, wrong_options from games.questions where question_id = any($1) order by question', [r.question_ids]);
    expect(rows).toEqual([{ question: 'Gas in chip packets?', wrong_options: ['Oxygen', 'Hydrogen', 'Carbon dioxide'] }, { question: 'Plain one?', wrong_options: [] }]);
    refused(await send('zed@x.in', [Q('Six wrong?', 'A', { wrong_options: ['b', 'c', 'd', 'e', 'f', 'g'] })]), /more than 5 wrong options/);
    refused(await send('zed@x.in', [Q('Same as the answer?', 'Nitrogen', { wrong_options: ['nitrogen.'] })]), /same as the answer/);
    refused(await send('zed@x.in', [Q('Twice?', 'A', { wrong_options: ['B', 'b'] })]), /same wrong option twice/);
    refused(await send('zed@x.in', [Q('Empty?', 'A', { wrong_options: ['  '] })]), /empty or longer than 100/);
    refused(await send('zed@x.in', [Q('Too long?', 'A', { wrong_options: ['x'.repeat(101)] })]), /empty or longer than 100/);
  });

  it('keeps the other answers and the fill-in sentence, and refuses broken ones', async () => {
    const r = await sent('zed@x.in', [Q('Brain of the computer?', 'Central Processing Unit', { also: [' CPU ', 'Processor'], fill: ' The ___ is the brain of the computer. ' })]);
    const [row] = await admin('select also, fill from games.questions where question_id = any($1)', [r.question_ids]);
    expect(row).toEqual({ also: ['CPU', 'Processor'], fill: 'The ___ is the brain of the computer.' });
    refused(await send('zed@x.in', [Q('Six others?', 'A', { also: ['b', 'c', 'd', 'e', 'f', 'g'] })]), /more than 5 other answers/);
    refused(await send('zed@x.in', [Q('Same as the answer?', 'Nitrogen', { also: ['nitrogen.'] })]), /repeats the answer/);
    refused(await send('zed@x.in', [Q('Twice?', 'A', { also: ['B', 'b'] })]), /repeats the answer or another/);
    refused(await send('zed@x.in', [Q('No blank?', 'A', { fill: 'There is no blank here.' })]), /exactly one ___/);
    refused(await send('zed@x.in', [Q('Two blanks?', 'A', { fill: 'One ___ and two ___.' })]), /exactly one ___/);
    expect(await sent('zed@x.in', [Q('Long blank?', 'A', { fill: 'One long ______ blank.' })])).toMatchObject({ sent: 1 });
    // the table itself refuses a sentence with two blanks, whoever writes it
    refused(await adminTry(`update games.questions set fill = 'a ___ b ___' where question_id = '${r.question_ids[0]}'`), /check constraint/);
  });

  it('names the batch after the person, never their email', async () => {
    await sent('noname@x.in', [Q('Nameless?', 'Ok')], { name: null });
    expect((await admin(`select teacher from games.batches where teacher_email = 'noname@x.in'`))[0].teacher).toBe('A teacher');
    await sent('long@x.in', [Q('Long name?', 'Ok')], { name: 'N'.repeat(120) });
    expect((await admin(`select char_length(teacher)::int n from games.batches where teacher_email = 'long@x.in'`))[0].n).toBe(80);
    expect(await count('games.question_bank')).toBe(0); // nothing is in the bank before approval
  });
});

describe('approving, sending back, and the bank', () => {
  let rust = '';
  let copy = '';

  it('lists what is waiting, with the teacher, email and time, oldest first', async () => {
    const waiting = await value('hod@x.in', 'select games.waiting_count()');
    const desk = await value('hod@x.in', 'select games.hod_questions()');
    expect(desk).toHaveLength(waiting);
    expect(desk.every((x: Json, i: number) => i === 0 || desk[i - 1].sent_at <= x.sent_at)).toBe(true);
    rust = desk.find((x: Json) => x.question === 'What is rust?' && x.chapter_id === 'CBSE10SCI01').question_id;
  });

  it('sending back needs a reason, and saves who and when', async () => {
    refused(await decide('hod@x.in', [rust], 'rejected', '   '), /Say why/);
    refused(await decide('hod@x.in', [rust], 'done'), /Unknown status/);
    await decide('hod@x.in', [rust], 'rejected', '  Write the formula too.  ');
    expect((await admin('select * from games.questions where question_id = $1', [rust]))[0]).toMatchObject({ status: 'rejected', note: 'Write the formula too.', reviewed_by: 'hod@x.in', seen_at: null });
  });

  it('the teacher, and only the teacher, sees it, with the reason', async () => {
    const [n] = await notes('ann@x.in');
    expect(n).toMatchObject({ note: 'Write the formula too.', reviewer: 'Mrs Hod', seen: false, now: null });
    expect(n).not.toHaveProperty('reviewed_by');
    expect(await notes('ben@x.in')).toEqual([]);
    await value('ann@x.in', 'select games.mark_sent_back_seen($1::text[])', [[rust]]);
    expect((await notes('ann@x.in'))[0].seen).toBe(true);
  });

  it('sent back to you, unchanged: not taken again; sent back to someone else: taken as new', async () => {
    expect(await sent('ann@x.in', [Q('what is rust', 'Iron Oxide.')])).toMatchObject({ sent: 0, sent_back: 1, sent_back_ids: [rust] });
    const theirs = await sent('ben@x.in', [Q('What is rust?', 'Iron oxide')]);
    copy = theirs.question_ids[0];
    expect(Number(copy.slice(-3))).toBeGreaterThan(Number(rust.slice(-3))); // numbers are never reused
    expect((await notes('ann@x.in'))[0].now).toBe('pending');
  });

  it('a sent-back question stays sent back while its copy waits or is approved', async () => {
    for (const status of ['pending', 'approved']) expect((await decide('hod@x.in', [rust], status)).rows![0].r).toMatchObject({ changed: [], skipped: [rust] });
    await decide('hod@x.in', [copy], 'approved');
    expect((await notes('ann@x.in'))[0].now).toBe('approved');
  });

  it('approving fills the bank with every column, and the team can read it', async () => {
    const qs = Array.from({ length: 50 }, (_, i) => Q(`Bulk question ${i}?`, `Answer ${i}`, { topic_no: (i % 5) + 1, topic: i % 5 ? `Topic ${(i % 5) + 1}` : 'Equations' }));
    const got: string[] = (await sent('bulk@x.in', qs)).question_ids;
    const done = (await decide('hod@x.in', got, 'approved')).rows![0].r;
    expect(done.changed).toHaveLength(50);
    expect(done.approved).toBe(await count('games.question_bank'));
    const bank = await value('ann@x.in', 'select games.bank()');
    expect(bank).toHaveLength(done.approved);
    expect(await value('ann@x.in', 'select games.bank_count()')).toBe(done.approved);
    expect(bank.find((b: Json) => b.question_id === got[0])).toMatchObject({ question: 'Bulk question 0?', answer: 'Answer 0', chapter: 'Chemical Reactions', teacher: 'bulk' });
    expect((await decide('hod@x.in', got, 'approved')).rows![0].r.changed).toEqual([]); // approving again changes nothing
    refused(await as('stranger@x.in', 'select games.bank()'), /Only people on the games team/);
  });

  it('the bank keeps the other answers and the fill-in sentence; changing only the sentence counts as a change', async () => {
    const [one] = (await sent('fay@x.in', [Q('Powerhouse of the cell?', 'Mitochondria', { also: ['Mitochondrion'], fill: 'The ___ release energy in a cell.' })])).question_ids;
    await decide('hod@x.in', [one], 'approved');
    expect((await value('fay@x.in', 'select games.bank()')).find((b: Json) => b.question_id === one)).toMatchObject({ also: ['Mitochondrion'], fill: 'The ___ release energy in a cell.' });
    const [bad] = (await sent('fay@x.in', [Q('Green pigment in leaves?', 'Chlorophyll', { fill: 'Leaves are green because of ___ in their cells.' })])).question_ids;
    await decide('hod@x.in', [bad], 'rejected', 'Say where in the cell.');
    expect(await sent('fay@x.in', [Q('Green pigment in leaves?', 'Chlorophyll', { fill: 'Leaves are green because of ___ in their cells.' })])).toMatchObject({ sent: 0, sent_back: 1 });
    expect(await sent('fay@x.in', [Q('Green pigment in leaves?', 'Chlorophyll', { fill: 'Leaves are green because of ___ in their chloroplasts.' })])).toMatchObject({ sent: 1, sent_back: 0 });
  });

  it('a multiple-choice question goes into the bank with its wrong options; changing only them counts as a change', async () => {
    const [mcq] = (await sent('fay@x.in', [Q('Largest planet?', 'Jupiter', { wrong_options: ['Saturn', 'Mars'] })])).question_ids;
    await decide('hod@x.in', [mcq], 'approved');
    expect((await value('fay@x.in', 'select games.bank()')).find((b: Json) => b.question_id === mcq).wrong_options).toEqual(['Saturn', 'Mars']);
    const [bad] = (await sent('fay@x.in', [Q('Smallest planet?', 'Mercury', { wrong_options: ['Pluto'] })])).question_ids;
    await decide('hod@x.in', [bad], 'rejected', 'Pluto is not a planet any more.');
    expect(await sent('fay@x.in', [Q('Smallest planet?', 'Mercury', { wrong_options: ['Pluto'] })])).toMatchObject({ sent: 0, sent_back: 1 });
    expect(await sent('fay@x.in', [Q('Smallest planet?', 'Mercury', { wrong_options: ['Mars', 'Venus'] })])).toMatchObject({ sent: 1, sent_back: 0 });
  });

  it('pages through approved questions, newest first, with no repeats', async () => {
    const all: Json[] = [];
    let last: Json = null;
    for (;;) {
      const page = await value('hod@x.in', 'select games.hod_approved($1, $2, $3)', [last?.reviewed_at ?? null, last?.question_id ?? null, 7]);
      all.push(...page);
      if (page.length < 7) break;
      last = page[page.length - 1];
    }
    expect(all).toHaveLength(await count('games.question_bank'));
    expect(new Set(all.map((x) => x.question_id)).size).toBe(all.length);
  });
});

describe('loading the list of chapters and topics (list.sql)', () => {
  const LIST = readFileSync('supabase/games/list.sql', 'utf8');
  const HEADER = 'Board | Class | Subject | Chapter number | Chapter | Topic number | Topic\n';
  /** The script with these rows pasted under its header line. */
  const withRows = (rows: string, dryRun = 'yes') => {
    expect(LIST).toContain(HEADER);
    return LIST.replace(HEADER, HEADER + rows).replace("'games_list.dry_run', 'yes'", `'games_list.dry_run', '${dryRun}'`);
  };
  const SHEET = [
    // from a spreadsheet: tabs, and a chapter with no topics leaves its topic cells empty
    'cbse\t7\tscience\t4\tHeat\t1\tHot and Cold',
    'CBSE\t7\tScience\t4\tHeat\t2\tTransfer of Heat',
    'CBSE\t7\tScience\t5\tAcids, Bases and Salts\t\t',
    // written by hand
    'ICSE | 6 | Geography | 2 | Landforms of the Earth | 1 | Mountains',
  ].join('\n') + '\n';
  let fresh: PGlite;
  const chapters = async () => (await fresh.query<Json>('select chapter_id, board, subject, name from games.chapters order by 1')).rows;

  beforeAll(async () => {
    fresh = await supabaseLike();
    await fresh.exec(installable());
  }, 60_000);

  it('as committed, it stops: the list is empty', async () => {
    expect(await failure(fresh, LIST)).toMatch(/The list is empty/);
  });

  it('the dry run checks and counts, then keeps nothing', async () => {
    expect(await failure(fresh, withRows(SHEET))).toMatch(/Dry run passed: the list has 3 chapters and 3 topics, of which 3 chapters and 3 topics are new/);
    expect(await chapters()).toEqual([]);
  });

  it('adds the chapters and topics under the site\'s IDs and names, and the team sees them', async () => {
    await fresh.exec(withRows(SHEET, 'no'));
    expect(await chapters()).toEqual([
      { chapter_id: 'CBSE07SCI04', board: 'CBSE', subject: 'Science', name: 'Heat' },
      { chapter_id: 'CBSE07SCI05', board: 'CBSE', subject: 'Science', name: 'Acids, Bases and Salts' },
      { chapter_id: 'ICSE06GEO02', board: 'ICSE', subject: 'Geography', name: 'Landforms of the Earth' },
    ]);
    const list = (await run(fresh, 'authenticated', claims('mod@x.in'), 'select games.catalog() c')).rows![0].c;
    expect(list.find((c: Json) => c.chapter_id === 'CBSE07SCI04').topics.map((t: Json) => t.topic_id)).toEqual(['CBSE07SCI04T01', 'CBSE07SCI04T02']);
    expect(list.find((c: Json) => c.chapter_id === 'CBSE07SCI05').topics).toEqual([]);
  });

  it('run again with more rows, it adds only the new ones', async () => {
    expect(await failure(fresh, withRows(`${SHEET}CBSE | 7 | Science | 4 | Heat | 3 | Sea and Land Breezes\n`)))
      .toMatch(/the list has 3 chapters and 4 topics, of which 0 chapters and 1 topics are new/);
  });

  it('stops on a problem, naming the row as numbered in the sheet, and keeps nothing', async () => {
    const before = await chapters();
    const why = await failure(fresh, withRows([
      'CBSE | 7 | Science | 4 | Heating | 1 | Hot and Cold', // row 2: already on the list as Heat
      'CBSE | 13 | Science | 1 | Light | 1 | Mirrors', // row 3: no class 13
      'Kolkata Board | 7 | Science | 1 | Light | 1 | Mirrors', // row 4
      'CBSE | 7 | Sciences | 1 | Light | 1 | Mirrors', // row 5
      'CBSE | 7 | Science | 6 | Light | 1', // row 6: a topic number with no name
    ].join('\n') + '\n', 'no'));
    expect(why).toMatch(/Nothing was kept/);
    expect(why).toMatch(/row 3: the class "13"/);
    expect(why).toMatch(/row 4: the board "Kolkata Board"/);
    expect(why).toMatch(/row 5: the subject "Sciences"/);
    expect(why).toMatch(/row 6 has 6 columns/);
    // checked once the rows themselves are right
    expect(await failure(fresh, withRows('CBSE | 7 | Science | 4 | Heating | 1 | Hot and Cold\n', 'no'))).toMatch(/row 2: chapter CBSE07SCI04 is already on the list as "Heat", not "Heating"/);
    expect(await failure(fresh, withRows('CBSE | 7 | Science | 4 | Heat | 1 | Cold\n', 'no'))).toMatch(/topic 1 of chapter CBSE07SCI04 is already on the list as "Hot and Cold"/);
    expect(await failure(fresh, withRows('CBSE | 7 | Science | 4 | Heat\n', 'no'))).toMatch(/already has topics on the list/);
    expect(await failure(fresh, withRows('CBSE | 8 | Science | 1 | Crops | 1 | Kharif\nCBSE | 8 | Science | 1 | Crops\n', 'no'))).toMatch(/has rows with topics and a row without one/);
    expect(await failure(fresh, withRows('CBSE | 8 | Science | 1 | Crops | 1 | Kharif\nCBSE | 8 | Science | 1 | Crop Production | 2 | Rabi\n', 'no'))).toMatch(/has more than one name/);
    expect(await chapters()).toEqual(before);
  });
});
