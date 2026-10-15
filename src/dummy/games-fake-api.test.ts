import { describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));

import { createFakeGamesApi, DUMMY_LIST, DUMMY_TEXTS } from '@/dummy/games-fake-api';
import { checkList } from '@/lib/games/catalog';
import { GAME_TYPES, makeGame } from '@/lib/games/engine';
import { format } from '@/lib/games/format';
import { addChapter, addTopic, changeCount, chaptersOf, deleteChapter, draftOf, renameChapter, renumberChapter, setOpen, toSave, type DraftChapter } from '@/lib/games/list-draft';
import type { AdminChapter } from '@/lib/games/rows';

/* Dummy mode's stand-in for the `games` schema keeps the database's rules, so what people try in dummy mode is what
   the real pages will do. Its made-up questions are written the way the prompt asks, so they pass the checker. */

const rows = (text: string) => format(text).rows;
const HEAT = `Board: CBSE
Class: 7
Subject: Science
Chapter 4: Heat
Topic 2: Transfer of Heat
`;
const q = (question: string, answer: string, more = '') => `\nQ: ${question}\nA: ${answer}\n${more}`;

describe('the made-up questions', () => {
  it.each(Object.entries(DUMMY_TEXTS))('%s passes the checker and the list, and makes every game', (_name, text) => {
    const { rows: rs, issues } = format(text);
    expect(issues).toEqual([]);
    expect(checkList(text, rs, DUMMY_LIST).issues).toEqual([]);
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
    const waiting = (await api.loadForHod()).questions.filter((x) => x.status === 'pending' && x.chapter_id === 'CBSE07SCI04');
    expect(waiting.map((x) => x.id)).toEqual(['CBSE07SCI04T02Q010']); // 8 approved and 1 sent back before it
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
    const sent = (await api.loadForHod()).questions.find((x) => x.question === 'Process by which heat moves through a solid')!;
    expect(sent).toMatchObject({ also: ['Thermal conduction'], fill: 'Heat moves through a solid by ___.' });
  });

  it('refuses the whole send when a question is off the list of chapters and topics', async () => {
    const api = createFakeGamesApi(false);
    const before = (await api.loadForHod()).questions.length;
    const off = rows(`Board: CBSE\nClass: 7\nSubject: Science\nChapter 4: Heat\nTopic 9: Weather${q('Wind from the sea by day', 'Sea breeze')}`);
    await expect(api.sendBatch([...rows(`${HEAT}${q('Heat flowing through a solid', 'Conduction')}`), ...off])).rejects.toThrow(/topic 9/i);
    expect((await api.loadForHod()).questions).toHaveLength(before);
    expect((await api.loadCatalog()).find((c) => c.chapter_id === 'CBSE07SCI04')?.topics.map((t) => t.topic_no)).toEqual([1, 2, 3]);
  });

  it('lets a chapter the list gives no topics take topics of its own, as the database does', async () => {
    const api = createFakeGamesApi(false);
    const NUTRITION = 'Board: CBSE\nClass: 7\nSubject: Science\nChapter 2: Nutrition in Animals\n';
    const r = await api.sendBatch(rows(`${NUTRITION}Topic 1: Digestion in Humans${q('Organ where digestion ends', 'Small intestine')}\nTopic 2: Feeding in Amoeba${q('Finger-like parts Amoeba feeds with', 'Pseudopodia')}`));
    expect(r.sent).toBe(2);
    const ch = (await api.loadCatalog()).find((c) => c.chapter_id === 'CBSE07SCI02')!;
    expect([ch.open, ch.topics.map((t) => `${t.topic_no} ${t.name}`)]).toEqual([true, ['1 Digestion in Humans', '2 Feeding in Amoeba']]);
    // one number and one name each, and a refused send adds no topic
    await expect(api.sendBatch(rows(`${NUTRITION}Topic 1: Teeth${q('Teeth that cut food', 'Incisors')}`))).rejects.toThrow('Topic 1 of chapter 2 is called "Digestion in Humans", not "Teeth".');
    await expect(api.sendBatch(rows(`${NUTRITION}Topic 3: Teeth${q('Teeth that cut food', 'Incisors')}\nTopic 4: Digestion in humans${q('Juice the liver makes', 'Bile')}`))).rejects.toThrow('already has "Digestion in Humans" as topic 1');
    expect((await api.loadCatalog()).find((c) => c.chapter_id === 'CBSE07SCI02')!.topics).toHaveLength(2);
  });

  it("saves a subject's chapters all at once by the database's rules: renames reach questions, numbers and deletes wait for none", async () => {
    const api = createFakeGamesApi(false);
    const SCI7 = { board: 'CBSE', class: 7, subject: 'Science' };
    const open = async () => {
      const loaded = chaptersOf((await api.loadList()).chapters, SCI7);
      return { loaded, d: draftOf(loaded) };
    };
    const save = (loaded: AdminChapter[], d: DraftChapter[]) => api.saveChapters(toSave(SCI7, loaded, d));
    let { loaded, d } = await open();
    const heat = d.find((c) => c.name === 'Heat')!;
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
    d = addTopic(d, 'CBSE07SCI02', 1, 'Digestion in Humans');
    d = setOpen(d, 'CBSE07SCI02', false);
    expect(changeCount(d)).toBe(4);
    expect(await save(loaded, d)).toEqual({ changes: 4 });
    expect((await api.loadForHod()).questions.filter((q) => q.chapter_id === 'CBSE07SCI04').every((q) => q.chapter === 'Heat and Temperature')).toBe(true);
    const nutrition = (await api.loadCatalog()).find((c) => c.chapter_id === 'CBSE07SCI02')!;
    expect([nutrition.open, nutrition.topics.map((t) => t.topic_id)]).toEqual([false, ['CBSE07SCI02T01']]);
    // saving from the list as it was before refuses, and keeps nothing
    await expect(save(loaded, renameChapter(d, heat.key, 'Heat'))).rejects.toThrow(/changed after you opened them .*Nothing was saved/);
    // the new chapter has nothing sent: it moves, then goes
    ({ loaded, d } = await open());
    d = renumberChapter(d, 'CBSE07SCI12', 11);
    await save(loaded, d);
    expect((await api.loadCatalog()).some((c) => c.chapter_id === 'CBSE07SCI11' && c.name === 'Motion and Time')).toBe(true);
    ({ loaded, d } = await open());
    await save(loaded, deleteChapter(d, 'CBSE07SCI11'));
    expect((await api.loadCatalog()).some((c) => c.name === 'Motion and Time')).toBe(false);
    expect((await api.loadList()).log.slice(0, 2).map((l) => l.detail)).toEqual([
      'Chapter 11 (CBSE class 7 Science) "Motion and Time" deleted.', 'Chapter 12 (CBSE class 7 Science) "Motion and Time" is now chapter 11.',
    ]);
  });

  it("shows up to 20 of a topic's questions, in order, with how many it has", async () => {
    const api = createFakeGamesApi(false);
    const r = await api.topicQuestions('CBSE07SCI04', 2);
    expect(r.total).toBeGreaterThan(0);
    expect(r.questions.map((x) => x.question_id)).toEqual([...r.questions.map((x) => x.question_id)].sort());
    expect(r.questions[0]).toEqual({ question_id: 'CBSE07SCI04T02Q001', question: expect.any(String), answer: expect.any(String), status: 'approved' });
    expect((await api.topicQuestions('CBSE07SCI04', 77)).total).toBe(0);
  });

  it('keeps the list for admins only', async () => {
    const api = createFakeGamesApi(false);
    const loaded = chaptersOf((await api.loadList()).chapters, { board: 'CBSE', class: 7, subject: 'Science' });
    api.setRole('hod');
    await expect(api.loadList()).rejects.toThrow(/Only an admin/);
    await expect(api.saveChapters(toSave({ board: 'CBSE', class: 7, subject: 'Science' }, loaded, draftOf(loaded)))).rejects.toThrow(/Only an admin/);
    await expect(api.topicQuestions('CBSE07SCI04', 2)).rejects.toThrow(/Only an admin/);
  });

  it('lets only HoDs and admins approve, and only admins manage the team', async () => {
    const api = createFakeGamesApi(false);
    api.setRole('member');
    await expect(api.loadForHod()).rejects.toThrow(/HoD/);
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
    const bank = await api.loadForHod();
    const pending = bank.questions.filter((x) => x.status === 'pending');
    const before = await api.approvedCount();
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
});
