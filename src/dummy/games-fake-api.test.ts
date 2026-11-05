import { describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));

import { createFakeGamesApi, DUMMY_LIST, DUMMY_TEXTS, rowsOf } from '@/dummy/games-fake-api';
import { GAME_TYPES, makeGame } from '@/lib/games/engine';
import { read } from '@/lib/games/format';
import { addChapter, addTopic, changeCount, chaptersOf, deleteChapter, draftOf, readBulk, renameChapter, renumberChapter, setOpen, toSave, type DraftChapter } from '@/lib/games/list-draft';
import type { AdminChapter } from '@/lib/games/rows';

/* Dummy mode's stand-in for the `games` schema keeps the database's rules, so what people try in dummy mode is what
   the real pages will do. Its made-up questions are written the way the prompt asks, so they pass the checker. */

const rows = (text: string) => rowsOf(text);
/** A real chapter on the starting list, where the made-up questions put three topics. */
const HEAT = `Board: ICSE
Class: 9
Subject: Physics
Chapter 6: Heat and Energy
Topic 2: Transfer of Heat
`;
const PHY9 = { board: 'ICSE', class: 9, subject: 'Physics' };
const q = (question: string, answer: string, more = '') => `\nQ: ${question}\nA: ${answer}\n${more}`;
type Api = ReturnType<typeof createFakeGamesApi>;
/** Fixes a chapter's topics on the list, as an admin does on the Chapters page. */
async function fixTopics(api: Api, chapterId: string) {
  const loaded = chaptersOf((await api.loadList()).chapters, PHY9);
  await api.saveChapters(toSave(PHY9, loaded, setOpen(draftOf(loaded), chapterId, false)));
}
/** Every waiting question, page by page, as Approve questions loads them. */
async function waitingAll(api: Api) {
  const out: Awaited<ReturnType<Api['loadWaiting']>>['questions'] = [];
  for (let after; ;) {
    const page = await api.loadWaiting(after);
    if (!page.batches.length) return out;
    out.push(...page.questions);
    after = page.batches.at(-1);
  }
}

describe('the list of chapters', () => {
  it("is the real starting list from install.sql: every chapter, under its real board, class, subject and name, none with topics yet", () => {
    expect(DUMMY_LIST).toHaveLength(564);
    expect(new Set(DUMMY_LIST.map((c) => c.chapter_id)).size).toBe(564);
    expect(new Set(DUMMY_LIST.map((c) => c.board))).toEqual(new Set(['CBSE', 'ICSE', 'ISC']));
    expect(DUMMY_LIST.find((c) => c.chapter_id === 'ICSE09PHY06')).toMatchObject({ board: 'ICSE', class: 9, subject: 'Physics', chapter_no: 6, name: 'Heat and Energy', topics: [], open: true });
    expect(DUMMY_LIST.some((c) => c.subject === 'History & Civics' && c.name === 'Revolt of 1857')).toBe(true);
    expect(DUMMY_LIST.some((c) => c.name.includes("'"))).toBe(true); // "Earth's Structure": quotes read back as written
  });
});

describe('the made-up questions', () => {
  it.each(Object.entries(DUMMY_TEXTS))('%s passes the checker and the list, and makes every game', (_name, text) => {
    expect(read(text).issues).toEqual([]);
    const rs = rowsOf(text);
    expect(rs).toHaveLength(read(text).drafts.length);
    // each is under a real chapter, and a topic of its own (sending adds it, as on the real list)
    expect(rs.every((r) => DUMMY_LIST.some((c) => c.chapter_id === r.chapter_id) && r.topic_no !== null && r.topic)).toBe(true);
    if (text.includes('Level: hard')) {
      const items = rs.map((r, i) => ({ id: String(i), question: r.question, answer: r.answer, also: r.also, fill: r.fill, wrong: r.wrong_options }));
      if (rs.length >= 8) for (const t of GAME_TYPES) expect(makeGame(t, items, 1), t).not.toBeNull();
    }
  });
});

describe('the dummy games database', () => {
  it('numbers new questions after the ones already in the topic, and skips repeats', async () => {
    const api = createFakeGamesApi(false);
    // already approved (case, spaces and a full stop at the end don't count), and the same question twice in one send
    const r = await api.sendBatch([
      ...rows(`${HEAT}${q('Material that lets heat pass through it easily.', 'Conductor')}${q('Liquid that rises in a thermometer', 'Mercury')}`),
      ...rows(`${HEAT}${q('liquid that rises in a  thermometer', 'Mercury')}`),
    ]);
    expect(r).toMatchObject({ sent: 1, already: 2, sentBack: 0 });
    expect(r.batchIds).toHaveLength(1);
    const waiting = (await waitingAll(api)).filter((x) => x.chapter_id === 'ICSE09PHY06');
    expect(waiting.map((x) => x.id)).toEqual(['ICSE09PHY06T02Q010']); // 8 approved and 1 sent back before it
  });

  it("doesn't take back a sent-back question unchanged (other answers, fill-in and options included), and points to why", async () => {
    const api = createFakeGamesApi(false);
    const back = (await api.mySentBack()).find((x) => x.topic_no === 2)!;
    const again = `${HEAT}${q(back.question, back.answer, `Fill: ${back.fill}\nWrong: ${back.wrong_options.join('; ')}`)}`;
    expect(await api.sendBatch(rows(again))).toMatchObject({ sent: 0, sentBack: 1, sentBackIds: [back.id], batchIds: [] });
    // a changed fill-in sentence is a changed question
    const changed = again.replace(back.fill!, 'Heat moves from hot to cold by ___.');
    expect((await api.sendBatch(rows(changed))).sent).toBe(1);
  });

  it('keeps the other answers and the fill-in sentence', async () => {
    const api = createFakeGamesApi(false);
    await api.sendBatch(rows(`${HEAT}${q('Process by which heat moves through a solid', 'Conduction', 'Also: Thermal conduction\nFill: Heat moves through a solid by ___.\n')}`));
    const sent = (await waitingAll(api)).find((x) => x.question === 'Process by which heat moves through a solid')!;
    expect(sent).toMatchObject({ also: ['Thermal conduction'], fill: 'Heat moves through a solid by ___.' });
  });

  it('refuses the whole send when a question is off the list of chapters, or under a topic a fixed chapter lacks', async () => {
    const api = createFakeGamesApi(false);
    const before = (await waitingAll(api)).length;
    const good = rows(`${HEAT}${q('Heat flowing through a solid', 'Conduction')}`);
    const elsewhere = { ...good[0], chapter_id: 'CBSE07SCI04', board: 'CBSE', class: 7, subject: 'Science', chapter_no: 4, chapter: 'Heat', topic_id: null, topic_no: null, topic: '' };
    await expect(api.sendBatch([...good, elsewhere])).rejects.toThrow(/isn't on the list of chapters/);
    await fixTopics(api, 'ICSE09PHY06');
    const off = rows(`Board: ICSE\nClass: 9\nSubject: Physics\nChapter 6: Heat and Energy\nTopic 9: Weather${q('Wind from the sea by day', 'Sea breeze')}`);
    await expect(api.sendBatch([...good, ...off])).rejects.toThrow(/topic 9/i);
    expect(await waitingAll(api)).toHaveLength(before);
    expect((await api.loadCatalog()).find((c) => c.chapter_id === 'ICSE09PHY06')?.topics.map((t) => t.topic_no)).toEqual([1, 2, 3]);
  });

  it('lets a chapter the list gives no topics take topics of its own, as the database does', async () => {
    const api = createFakeGamesApi(false);
    const NUTRITION = 'Board: CBSE\nClass: 10\nSubject: Science\nChapter 5: Life Processes\n';
    const r = await api.sendBatch(rows(`${NUTRITION}Topic 1: Digestion in Humans${q('Organ where digestion ends', 'Small intestine')}\nTopic 2: Feeding in Amoeba${q('Finger-like parts Amoeba feeds with', 'Pseudopodia')}`));
    expect(r.sent).toBe(2);
    const ch = (await api.loadCatalog()).find((c) => c.chapter_id === 'CBSE10SCI05')!;
    expect([ch.open, ch.topics.map((t) => `${t.topic_no} ${t.name}`)]).toEqual([true, ['1 Digestion in Humans', '2 Feeding in Amoeba']]);
    // one number and one name each, and a refused send adds no topic
    await expect(api.sendBatch(rows(`${NUTRITION}Topic 1: Teeth${q('Teeth that cut food', 'Incisors')}`))).rejects.toThrow('Topic 1 of chapter 5 is called "Digestion in Humans", not "Teeth".');
    await expect(api.sendBatch(rows(`${NUTRITION}Topic 3: Teeth${q('Teeth that cut food', 'Incisors')}\nTopic 4: Digestion in humans${q('Juice the liver makes', 'Bile')}`))).rejects.toThrow('already has "Digestion in Humans" as topic 1');
    expect((await api.loadCatalog()).find((c) => c.chapter_id === 'CBSE10SCI05')!.topics).toHaveLength(2);
  });

  it("saves a subject's chapters all at once by the database's rules: renames reach questions, numbers and deletes wait for none", async () => {
    const api = createFakeGamesApi(false);
    const SCI7 = PHY9;
    const open = async () => {
      const loaded = chaptersOf((await api.loadList()).chapters, SCI7);
      return { loaded, d: draftOf(loaded) };
    };
    const save = (loaded: AdminChapter[], d: DraftChapter[]) => api.saveChapters(toSave(SCI7, loaded, d));
    let { loaded, d } = await open();
    const heat = d.find((c) => c.name === 'Heat and Energy')!;
    expect(heat.questions).toBeGreaterThan(0);
    // what the page refuses, the database refuses too
    const sneaky = toSave(SCI7, loaded, d);
    sneaky.after = sneaky.after.map((c) => (c.chapter_id === heat.key ? { ...c, chapter_no: 9 } : c));
    await expect(api.saveChapters(sneaky)).rejects.toThrow(/so its number stays: it is part of each question's ID/);
    sneaky.after = sneaky.after.filter((c) => c.chapter_id !== heat.key);
    await expect(api.saveChapters(sneaky)).rejects.toThrow(/can't be deleted\. Rename it instead/);
    // a rename, a new chapter, and fixed topics for a chapter that had none, in one save
    d = renameChapter(d, heat.key, 'Heat and Temperature');
    d = addChapter(d, 12, 'Motion and Time');
    d = addTopic(d, 'ICSE09PHY08', 1, 'Echoes');
    d = setOpen(d, 'ICSE09PHY08', false);
    expect(changeCount(d)).toBe(4);
    expect(await save(loaded, d)).toEqual({ changes: 4 });
    expect([...(await waitingAll(api)), ...(await api.loadSentBack()).questions].filter((q) => q.chapter_id === 'ICSE09PHY06').every((q) => q.chapter === 'Heat and Temperature')).toBe(true);
    const sound = (await api.loadCatalog()).find((c) => c.chapter_id === 'ICSE09PHY08')!;
    expect([sound.open, sound.topics.map((t) => t.topic_id)]).toEqual([false, ['ICSE09PHY08T01']]);
    // saving from the list as it was before refuses, and keeps nothing
    await expect(save(loaded, renameChapter(d, heat.key, 'Heat and Energy'))).rejects.toThrow(/changed after you opened them .*Nothing was saved/);
    // the new chapter has nothing sent: it moves, then goes
    ({ loaded, d } = await open());
    d = renumberChapter(d, 'ICSE09PHY12', 11);
    await save(loaded, d);
    expect((await api.loadCatalog()).some((c) => c.chapter_id === 'ICSE09PHY11' && c.name === 'Motion and Time')).toBe(true);
    ({ loaded, d } = await open());
    await save(loaded, deleteChapter(d, 'ICSE09PHY11'));
    expect((await api.loadCatalog()).some((c) => c.name === 'Motion and Time')).toBe(false);
    expect((await api.loadList()).log.slice(0, 2).map((l) => l.detail)).toEqual([
      'Chapter 11 (ICSE class 9 Physics) "Motion and Time" deleted.', 'Chapter 12 (ICSE class 9 Physics) "Motion and Time" is now chapter 11.',
    ]);
  });

  it('saves several subjects at once (Bulk add), or none of them, as the database does', async () => {
    const api = createFakeGamesApi(false);
    const list = (await api.loadList()).chapters;
    const bulk = readBulk('Board: CBSE\nClass: 7\nSubject: Science\n6. Motion and Time\n- Speed\n\nBoard: ICSE\nClass: 9\nSubject: Physics\n11. Work and Power', list);
    expect(bulk.problems).toEqual([]);
    const saves = bulk.groups.map((g) => toSave(g.group, g.loaded, g.draft));
    await expect(api.saveChapters([saves[0], { ...saves[1], before: [{ chapter_id: 'ICSE09PHY01', chapter_no: 1, name: 'Old', open: true, topics: [] }] }])).rejects.toThrow(/changed after you opened them/);
    expect((await api.loadList()).chapters.length).toBe(list.length);
    expect(await api.saveChapters(saves)).toEqual({ changes: 3 });
    expect((await api.loadCatalog()).filter((c) => ['CBSE07SCI06', 'ICSE09PHY11'].includes(c.chapter_id)).map((c) => [c.name, c.topics.length])).toEqual([['Motion and Time', 1], ['Work and Power', 0]]);
  });

  it("shows up to 20 of a topic's questions, in order, with how many it has", async () => {
    const api = createFakeGamesApi(false);
    const r = await api.topicQuestions('ICSE09PHY06', 2);
    expect(r.total).toBeGreaterThan(0);
    expect(r.questions.map((x) => x.question_id)).toEqual([...r.questions.map((x) => x.question_id)].sort());
    expect(r.questions[0]).toEqual({ question_id: 'ICSE09PHY06T02Q001', question: expect.any(String), answer: expect.any(String), status: 'approved' });
    expect((await api.topicQuestions('ICSE09PHY06', 77)).total).toBe(0);
  });

  it('keeps the list for admins only', async () => {
    const api = createFakeGamesApi(false);
    const loaded = chaptersOf((await api.loadList()).chapters, PHY9);
    api.setRole('hod');
    await expect(api.loadList()).rejects.toThrow(/Only an admin/);
    await expect(api.saveChapters(toSave(PHY9, loaded, draftOf(loaded)))).rejects.toThrow(/Only an admin/);
    await expect(api.topicQuestions('ICSE09PHY06', 2)).rejects.toThrow(/Only an admin/);
  });

  it('lets only HoDs and admins approve, and only admins manage the team', async () => {
    const api = createFakeGamesApi(false);
    api.setRole('member');
    await expect(api.loadWaiting()).rejects.toThrow(/HoD/);
    await expect(api.hodCounts()).rejects.toThrow(/HoD/);
    await expect(api.loadTeamLog()).rejects.toThrow(/admin/);
    await expect(api.loadPeople()).rejects.toThrow(/admin/);
    api.setRole(null);
    expect(await api.myRole()).toBeNull();
    await expect(api.sendBatch([])).rejects.toThrow(/sign in with google/i);
    api.setRole('reauth');
    expect(await api.myRole()).toBe('reauth');
    await expect(api.loadQuestionBank()).rejects.toThrow(/games team/);
  });

  it('approves, sends back with a reason, and keeps a sent-back question back while its copy waits', async () => {
    const api = createFakeGamesApi(false);
    const pending = await waitingAll(api);
    const before = (await api.hodCounts()).approved;
    const r = await api.saveStatus([pending[0].id], 'approved');
    expect(r.changed).toEqual([pending[0].id]);
    expect(r.approved).toBe(before + 1);
    await expect(api.saveStatus([pending[1].id], 'rejected', '  ')).rejects.toThrow(/why/);
    // the same thing twice changes nothing
    expect((await api.saveStatus([pending[0].id], 'approved')).changed).toEqual([]);

    const back = (await api.mySentBack()).find((x) => x.topic_no === 2)!;
    await api.sendBatch(rows(`${HEAT}${q(back.question, 'A different answer')}`));
    const kept = await api.saveStatus([back.id], 'pending');
    expect(kept).toMatchObject({ changed: [], skipped: [back.id] });
  });

  it('keeps the moderator an admin and stops admins removing themselves', async () => {
    const api = createFakeGamesApi(false);
    await expect(api.setPersonRole('asha.rao@example.com', 'member')).rejects.toThrow(/moderator/);
    await expect(api.removePerson('you@example.com')).rejects.toThrow(/yourself/);
    await api.setPersonRole('New.Person@Example.com ', 'hod');
    expect((await api.loadPeople()).find((p) => p.email === 'new.person@example.com')?.role).toBe('hod');
  });

  it("notes each change to the team in its log, newest first, 20 at a time, and nothing refused", async () => {
    const api = createFakeGamesApi(false);
    const start = await api.loadTeamLog();
    await api.setPersonRole('new.person@example.com', 'member');
    await api.setPersonRole('new.person@example.com', 'hod');
    await api.setPersonRole('new.person@example.com', 'hod');
    await api.removePerson('new.person@example.com');
    await expect(api.removePerson('you@example.com')).rejects.toThrow(/yourself/);
    const log = await api.loadTeamLog();
    expect(log.slice(0, 3).map((l) => [l.action, l.person, l.role, l.old_role])).toEqual([
      ['remove', 'new.person@example.com', 'hod', null],
      ['role', 'new.person@example.com', 'hod', 'member'],
      ['add', 'new.person@example.com', 'member', null],
    ]);
    expect(log.length).toBe(start.length + 3);
    for (let i = 0; i < 25; i++) await api.setPersonRole(`p${i}@example.com`, 'member');
    const first = await api.loadTeamLog();
    expect(first).toHaveLength(20);
    expect((await api.loadTeamLog(first.at(-1)!.id)).every((l) => l.id < first.at(-1)!.id)).toBe(true);
  });

  it('gives Approve questions a few batches, or 20 questions, at a time, and the counts', async () => {
    const api = createFakeGamesApi(false);
    for (let i = 0; i < 4; i++) await api.sendBatch(rows(`${HEAT}${q(`Made-up waiting question ${i}`, `Answer ${i}`)}`));
    const first = await api.loadWaiting();
    expect(first.batches).toHaveLength(3);
    expect(first.batches.map((b) => b.at)).toEqual([...first.batches.map((b) => b.at)].sort().reverse());
    expect(first.questions.every((x) => x.status === 'pending' && first.batches.some((b) => b.id === x.batch))).toBe(true);
    const counts = await api.hodCounts();
    expect((await waitingAll(api)).length).toBe(counts.waiting);
    const approvedFirst = await api.loadApproved();
    expect(approvedFirst.questions).toHaveLength(20);
    const approvedNext = await api.loadApproved(approvedFirst.questions.at(-1));
    expect(approvedNext.questions.some((x) => approvedFirst.questions.some((y) => y.id === x.id))).toBe(false);
    expect((await api.loadSentBack()).questions.length).toBe(counts.sentBack);
  });
});
