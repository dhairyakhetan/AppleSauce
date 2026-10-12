import { APPROVED_PAGE, BATCH_MAX, type GamesApi, type SaveResult, type SendResult } from '@/lib/games/api';
import { chapterId, checkBoard, checkSubject, pad2, topicId } from '@/lib/games/details';
import { format } from '@/lib/games/format';
import type { Bank, BankQuestion, Batch, ListChapter, Person, RoleCheck, Row, SentBack, Status } from '@/lib/games/rows';

/* The games pages in dummy mode (D75): an in-memory stand-in for the `games` schema, with no sign-in. It keeps the
   same rules as the database: who may do what, duplicates skipped, questions numbered within their topic and never
   renumbered, a sent-back question not sent again unchanged, batch IDs by the day. Test builds only, reached solely
   through the PREVIEW_TOOLS-gated lazy import in pages/Games.tsx.

   Every question and name below is made up for the preview; none is copied from a real paper. */

/** The dummy "you". Which role you have is switched from the dummy banner. */
export const DUMMY_ME = { email: 'you@example.com', name: 'You (dummy)' };

interface FakeQuestion extends BankQuestion { teacherEmail: string; reviewedBy: string | null; seenAt: string | null }
interface State { team: Person[]; batches: Batch[]; questions: FakeQuestion[]; catalog: ListChapter[] }

const MODERATOR = { email: 'asha.rao@example.com', name: 'Asha Rao' };
const HOD = { email: 'vikram.singh@example.com', name: 'Vikram Singh' };
const ROHAN = { email: 'rohan.mehta@example.com', name: 'Rohan Mehta' };
const PRIYA = { email: 'priya.das@example.com', name: 'Priya Das' };

/** Approved: what "Try the games" plays with. */
const APPROVED_HEAT = `Board: CBSE
Class: 7
Subject: Science
Chapter 4: Heat
Topic 1: Hot and Cold
Device used to measure how hot or cold something is | Thermometer | easy
Scale of temperature marked on the thermometers we use every day | Celsius | easy
Normal temperature of the human body, in degrees Celsius | 37 | 35; 40; 98.6 | medium
Thermometer that a doctor uses to check for fever | Clinical thermometer | Laboratory thermometer; Maximum-minimum thermometer | medium
Mercury is used in thermometers because it expands evenly when heated | True | False | easy
Topic 2: Transfer of Heat
Transfer of heat through a solid from its hotter end to its colder end | Conduction | medium
Transfer of heat by the movement of a heated liquid or gas | Convection | medium
Transfer of heat that needs no material to travel through | Radiation | medium
Material that lets heat pass through it easily | Conductor | easy
Material that does not let heat pass through it easily | Insulator | easy
Topic 3: Sea and Land Breezes
Cool wind that blows from the sea towards the land during the day | Sea breeze | medium
Wind that blows from the land towards the sea at night | Land breeze | medium
Colour of clothes that takes in the most heat from the sun | Black | easy
Woollen clothes keep us warm because this is trapped between their fibres | Air | easy`;

const APPROVED_LANDFORMS = `Board: ICSE
Class: 6
Subject: Geography
Chapter 2: Landforms of the Earth
Topic 1: Mountains
Very high landform that rises steeply to a narrow peak | Mountain | easy
Long chain of mountains joined together | Range | easy
Highest mountain range in the world | [the] Himalayas | Alps; Andes; Rockies | easy
Mountains formed when layers of rock are pushed and folded | Fold mountains | medium
Topic 2: Plateaus and Plains
Raised flat land that stands above the land around it | Plateau | easy
Large stretch of flat, low land | Plain | easy
Fine soil carried and laid down by rivers that makes plains fertile | Silt | medium
Landform made where a river splits into many streams before it meets the sea | Delta | medium
Land around a river that is covered with water when the river floods | Floodplain | hard`;

/** Waiting for an HoD. */
const WAITING_CELL = `Board: CBSE
Class: 9
Subject: Science
Chapter 5: The Fundamental Unit of Life
Topic 1: The Cell
Basic unit of structure and function of all living things | Cell | easy
Scientist who first saw cells, in a thin slice of cork | Robert Hooke | medium
Jelly-like substance that fills the cell inside its membrane | Cytoplasm | easy
Part of the cell that controls all its activities | Nucleus | easy
Topic 2: Cell Organelles
Organelle known as the powerhouse of the cell | Mitochondria | easy
Organelle in plant cells where food is made | Chloroplast | medium
Organelles that hold digestive enzymes | Lysosomes | hard`;

const WAITING_FLAME = `Board: CBSE
Class: 8
Subject: Science
Chapter 6: Combustion and Flame
Topic 1: Combustion
Chemical process in which a substance reacts with oxygen and gives off heat | Combustion | easy
Lowest temperature at which a substance catches fire | Ignition temperature | medium
Substance that is burnt to give heat | Fuel | easy
Gas from the air that is needed for burning | Oxygen | easy`;

/** Sent back to you: what the notifications show. */
const SENT_BACK_HEAT = `Board: CBSE
Class: 7
Subject: Science
Chapter 4: Heat
Topic 2: Transfer of Heat
Heat flows from a colder object to a hotter one by this process | Conduction | medium
Topic 3: Sea and Land Breezes
Does a black shirt take in more heat than a white one? | Yes | easy`;

const NOTE_WRONG_WAY = 'Heat flows from hotter to colder, not the other way. Please rewrite the question.';
const NOTE_YES_NO = 'No yes/no questions: a puzzle needs a word as the answer. Try "Colour of clothes that ...".';

/** A chapter on the made-up list, with its topics numbered from 1. */
function listed(board: string, cls: number, subject: string, no: number, name: string, topics: string[]): ListChapter {
  const id = chapterId(checkBoard(board).code, cls, checkSubject(subject).code, no)!;
  return { chapter_id: id, board, class: cls, subject, chapter_no: no, name, topics: topics.map((t, i) => ({ topic_id: topicId(id, i + 1)!, topic_no: i + 1, name: t })) };
}
/** The made-up list of chapters and topics: the ones the made-up questions use, the formatter's example, one with no
 * questions yet, and one with no topics (its questions go without a Topic line). The real list comes from the database. */
export const DUMMY_LIST: ListChapter[] = [
  listed('ICSE', 6, 'Geography', 2, 'Landforms of the Earth', ['Mountains', 'Plateaus and Plains']),
  listed('CBSE', 7, 'Science', 4, 'Heat', ['Hot and Cold', 'Transfer of Heat', 'Sea and Land Breezes']),
  listed('CBSE', 7, 'Science', 5, 'Acids, Bases and Salts', ['Acids and Bases', 'Indicators', 'Neutralisation']),
  listed('CBSE', 8, 'Science', 6, 'Combustion and Flame', ['Combustion', 'Flame']),
  listed('CBSE', 7, 'Science', 2, 'Nutrition in Animals', []),
  listed('CBSE', 9, 'Science', 5, 'The Fundamental Unit of Life', ['The Cell', 'Cell Organelles']),
  listed('CBSE', 10, 'Science', 1, 'Chemical Reactions and Equations', ['Chemical Equations', 'Types of Chemical Reactions', 'Effects of Oxidation in Everyday Life']),
];

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
/** How the database compares two questions: case, extra spaces and punctuation at the end don't matter. */
const norm = (t: string) => t.trim().replace(/[\s?.!:;,।]+$/u, '').replace(/\s+/g, ' ').toLowerCase();
const indiaDay = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso)).replace(/-/g, '');

function seed(): State {
  const s: State = {
    team: [
      { ...MODERATOR, role: 'admin', moderator: true, added_at: hoursAgo(24 * 30), last_seen_at: hoursAgo(5), name: MODERATOR.name },
      { ...HOD, role: 'hod', moderator: false, added_at: hoursAgo(24 * 20), last_seen_at: hoursAgo(2), name: HOD.name },
      { ...ROHAN, role: 'member', moderator: false, added_at: hoursAgo(24 * 10), last_seen_at: hoursAgo(26), name: ROHAN.name },
      { ...PRIYA, role: 'member', moderator: false, added_at: hoursAgo(24 * 3), last_seen_at: null, name: PRIYA.name },
      { ...DUMMY_ME, role: 'admin', moderator: false, added_at: hoursAgo(24 * 15), last_seen_at: hoursAgo(0.1) },
    ],
    batches: [],
    questions: [],
    catalog: structuredClone(DUMMY_LIST),
  };
  const put = (text: string, who: { email: string; name: string }, sentAt: string, status: Status, reviewedAt: string | null, note = '') => {
    const ids = add(s, format(text).rows, who, sentAt).ids;
    for (const q of s.questions) {
      if (!ids.includes(q.id)) continue;
      q.status = status;
      q.reviewedAt = reviewedAt;
      q.reviewedBy = status === 'pending' ? null : HOD.email;
      q.note = status === 'rejected' ? note : '';
    }
  };
  put(APPROVED_HEAT, ROHAN, hoursAgo(24 * 6), 'approved', hoursAgo(24 * 5));
  put(APPROVED_LANDFORMS, PRIYA, hoursAgo(24 * 4), 'approved', hoursAgo(24 * 3));
  put(SENT_BACK_HEAT, DUMMY_ME, hoursAgo(30), 'rejected', hoursAgo(20));
  const [wrongWay, yesNo] = s.questions.filter((q) => q.status === 'rejected');
  wrongWay.note = NOTE_WRONG_WAY;
  yesNo.note = NOTE_YES_NO;
  put(WAITING_CELL, ROHAN, hoursAgo(3), 'pending', null);
  put(WAITING_FLAME, PRIYA, hoursAgo(1), 'pending', null);
  return s;
}

/** Adds rows as one batch, by the database's rules. */
function add(s: State, rows: Row[], who: { email: string; name: string }, at = new Date().toISOString()) {
  const day = indiaDay(at);
  const seq = s.batches.filter((b) => b.id.startsWith(`B${day}-`)).length + 1;
  const batch: Batch = { id: `B${day}-${pad2(seq)}`, by: who.name, email: who.email, at };
  const out = { ids: [] as string[], already: 0, sentBack: 0, sentBackIds: [] as string[] };
  const seen = new Set<string>();
  for (const r0 of rows) {
    const { problem, row: r } = onTheList(s.catalog, r0);
    if (problem) throw new Error(problem);
    const cid = r.chapter_id!;
    const key = `${cid}|${norm(r.question)}`;
    if (seen.has(key) || s.questions.some((x) => x.chapter_id === cid && norm(x.question) === norm(r.question) && x.status !== 'rejected')) {
      out.already++;
      continue;
    }
    seen.add(key);
    const back = s.questions.filter((x) => x.chapter_id === cid && x.status === 'rejected' && x.teacherEmail === who.email
      && norm(x.question) === norm(r.question) && norm(x.answer) === norm(r.answer)
      && JSON.stringify(x.wrong_options ?? []) === JSON.stringify((r.wrong_options ?? []).map((o) => o.trim())));
    if (back.length) {
      out.sentBack++;
      out.sentBackIds.push(...back.map((x) => x.id));
      continue;
    }
    const tno = r.topic_no ?? 0;
    const n = Math.max(0, ...s.questions.filter((x) => x.chapter_id === cid && (x.topic_no ?? 0) === tno).map((x) => x.question_no)) + 1;
    const id = `${cid}T${pad2(tno)}Q${String(n).padStart(3, '0')}`;
    s.questions.push({
      ...r, line: 0, question: r.question.trim(), answer: r.answer.trim(), wrong_options: (r.wrong_options ?? []).map((o) => o.trim()), topic_id: r.topic_no === null ? null : `${cid}T${pad2(tno)}`, question_no: n,
      id, batch: batch.id, status: 'pending', note: '', reviewedAt: null, teacherEmail: who.email, reviewedBy: null, seenAt: null,
    });
    out.ids.push(id);
  }
  if (out.ids.length) s.batches.push(batch);
  return { batchId: out.ids.length ? batch.id : null, ...out };
}

/** The chapter and topic must be on the list (under its names, which are the ones kept), as in the database. */
function onTheList(catalog: ListChapter[], r: Row): { problem?: string; row: Row } {
  const ch = catalog.find((c) => c.chapter_id === r.chapter_id);
  if (!ch) return { problem: `Chapter ${r.chapter_no} (${r.board}, class ${r.class}, ${r.subject}) isn't on the list of chapters.`, row: r };
  if (norm(ch.name) !== norm(r.chapter)) return { problem: `Chapter ${ch.chapter_no} is called "${ch.name}" on the list, not "${r.chapter}".`, row: r };
  if (!ch.topics.length) {
    if (r.topic_no !== null) return { problem: `Chapter ${ch.chapter_no} ("${ch.name}") has no topics on the list, so its questions go without a topic line.`, row: r };
    return { row: { ...r, chapter: ch.name, topic: '' } };
  }
  if (r.topic_no === null) return { problem: `A question in chapter ${ch.chapter_no} ("${ch.name}") has no topic. Put it under one of the chapter's topics.`, row: r };
  const tp = ch.topics.find((t) => t.topic_no === r.topic_no);
  if (!tp) return { problem: `Chapter ${ch.chapter_no} ("${ch.name}") has no topic ${r.topic_no} on the list.`, row: r };
  if (norm(tp.name) !== norm(r.topic)) return { problem: `Topic ${r.topic_no} of chapter ${ch.chapter_no} is called "${tp.name}" on the list, not "${r.topic}".`, row: r };
  return { row: { ...r, chapter: ch.name, topic: tp.name } };
}

/** The board and subject must be on the site's lists and match the chapter ID's codes; wrong options as the database
 * checks them. */
function codesProblem(r: Row): string | null {
  const board = checkBoard(r.board).code;
  const subject = checkSubject(r.subject).code;
  if (!board) return `The board "${r.board}" isn't on the site's list.`;
  if (!subject) return `The subject "${r.subject}" isn't on the site's list.`;
  if (!r.chapter_id?.startsWith(`${board}${pad2(r.class ?? 0)}${subject}`)) return 'A chapter ID doesn\'t match its board, class and subject.';
  const wrong = (r.wrong_options ?? []).map((o) => o.trim());
  if (wrong.length > 5) return `A question has more than 5 wrong options: "${r.question}".`;
  if (wrong.some((o) => !o || o.length > 100)) return `A wrong option is empty or longer than 100 characters: "${r.question}".`;
  if (wrong.some((o) => norm(o) === norm(r.answer))) return `A wrong option is the same as the answer: "${r.question}".`;
  if (new Set(wrong.map(norm)).size < wrong.length) return `A question has the same wrong option twice: "${r.question}".`;
  return null;
}

const strip = ({ teacherEmail: _t, reviewedBy: _r, seenAt: _s, ...q }: FakeQuestion): BankQuestion => q;
const byChapterOrder = (a: BankQuestion, b: BankQuestion) =>
  (a.class ?? 0) - (b.class ?? 0) || a.subject.localeCompare(b.subject) || (a.chapter_no ?? 0) - (b.chapter_no ?? 0)
  || (a.topic_no ?? 0) - (b.topic_no ?? 0) || a.question_no - b.question_no || a.id.localeCompare(b.id);

export type FakeGamesApi = GamesApi & {
  /** Puts the made-up questions and team back as they started. */
  reset(): void;
  /** Which role the dummy "you" has; null takes you off the team; 'reauth' is signed in with a password. */
  setRole(role: RoleCheck): void;
  role(): RoleCheck;
};

/** `slow`: each call takes a moment, like the real database, so loading states show (tests pass false). */
export function createFakeGamesApi(slow = true): FakeGamesApi {
  const wait = (ms = 250) => (slow ? new Promise((done) => setTimeout(done, ms)) : Promise.resolve());
  let s = seed();
  /** Signed in with a password: on the team or not, nothing counts until they sign in with Google or a link. */
  let password = false;
  const me = () => s.team.find((p) => p.email === DUMMY_ME.email) ?? null;
  const roleOf = (): RoleCheck => (password ? 'reauth' : me()?.role ?? null);
  const need = (what: 'team' | 'hod' | 'admin') => {
    const r = roleOf();
    if (!r || r === 'reauth') throw new Error('Only people on the games team can do this. Sign in with Google, using the email on the team\'s list.');
    if (what === 'hod' && r === 'member') throw new Error('Only HoDs can see the HoD desk.');
    if (what === 'admin' && r !== 'admin') throw new Error('Only an admin can do this.');
  };
  const nameOf = (email: string | null) => s.team.find((p) => p.email === email)?.name ?? 'Your HoD';
  const bankOf = (qs: FakeQuestion[]): Bank => ({
    batches: s.batches.filter((b) => qs.some((q) => q.batch === b.id)),
    questions: qs.map(strip),
  });
  const approved = () => s.questions.filter((q) => q.status === 'approved');
  const waiting = () => s.questions.filter((q) => q.status === 'pending').length;

  return {
    reset() { s = seed(); password = false; },
    setRole(role) {
      password = role === 'reauth';
      if (role === 'reauth') return;
      const p = me();
      if (!role) s.team = s.team.filter((x) => x !== p);
      else if (p) p.role = role;
      else s.team.push({ ...DUMMY_ME, role, moderator: false, added_at: new Date().toISOString(), last_seen_at: null });
    },
    role: roleOf,

    async myRole() {
      await wait(150);
      if (password) return 'reauth';
      const p = me();
      if (p) p.last_seen_at = new Date().toISOString();
      return p?.role ?? null;
    },

    async loadCatalog() {
      await wait(150);
      need('team');
      return structuredClone(s.catalog);
    },

    async sendBatch(rows) {
      await wait(500);
      need('team');
      const ready = rows.filter((r) => r.chapter_id && r.chapter);
      const out: SendResult = { batchIds: [], sent: 0, already: 0, sentBack: 0, sentBackIds: [] };
      for (let i = 0; i < ready.length; i += BATCH_MAX) {
        const part = ready.slice(i, i + BATCH_MAX);
        // like the database, a batch with one bad question is refused whole, before anything is kept
        for (const r of part) {
          const why = codesProblem(r) ?? onTheList(s.catalog, r).problem;
          if (why) throw new Error(why);
        }
        const r = add(s, part, DUMMY_ME);
        if (r.batchId) out.batchIds.push(r.batchId);
        out.sent += r.ids.length;
        out.already += r.already;
        out.sentBack += r.sentBack;
        out.sentBackIds.push(...r.sentBackIds);
      }
      return out;
    },

    async loadForHod() {
      await wait();
      need('hod');
      return bankOf(s.questions.filter((q) => q.status !== 'approved'));
    },

    async loadApproved(after) {
      await wait();
      need('hod');
      const newest = approved().sort((a, b) => (b.reviewedAt ?? '').localeCompare(a.reviewedAt ?? '') || b.id.localeCompare(a.id));
      const from = after ? newest.findIndex((q) => q.id === after.id) + 1 : 0;
      return bankOf(newest.slice(from, from + APPROVED_PAGE));
    },

    async approvedCount() {
      await wait(100);
      need('team');
      return approved().length;
    },

    async saveStatus(ids, status, reason = '') {
      await wait(300);
      need('hod');
      const why = reason.trim();
      if (status === 'rejected' && !why) throw new Error('Say why the question is going back.');
      const pick = s.questions.filter((q) => ids.includes(q.id));
      // a sent-back question stays sent back while the same question (sent again) is waiting or approved
      const skipped = status === 'rejected' ? [] : pick.filter((t) => t.status === 'rejected' && (
        s.questions.some((x) => x.chapter_id === t.chapter_id && norm(x.question) === norm(t.question) && x.status !== 'rejected')
        || pick.some((u) => u.status === 'rejected' && u.id < t.id && u.chapter_id === t.chapter_id && norm(u.question) === norm(t.question))
      )).map((t) => t.id);
      const changed: string[] = [];
      const now = new Date().toISOString();
      for (const q of pick) {
        if (skipped.includes(q.id)) continue;
        // nothing to do when it already has this status (and this reason): its time and "seen" stay as they are
        if (q.status === status && (status !== 'rejected' || q.note === why)) continue;
        q.status = status;
        q.note = status === 'rejected' ? why : '';
        q.reviewedAt = status === 'pending' ? null : now;
        q.reviewedBy = status === 'pending' ? null : DUMMY_ME.email;
        q.seenAt = null;
        changed.push(q.id);
      }
      const out: SaveResult = { changed, skipped, waiting: waiting(), approved: approved().length };
      return out;
    },

    async waitingCount() {
      await wait(100);
      need('hod');
      return waiting();
    },

    async loadQuestionBank() {
      await wait(400);
      need('team');
      return approved().map(strip).sort(byChapterOrder);
    },

    async mySentBack() {
      await wait();
      need('team');
      return s.questions
        .filter((q) => q.status === 'rejected' && q.teacherEmail === DUMMY_ME.email)
        .sort((a, b) => (b.reviewedAt ?? '').localeCompare(a.reviewedAt ?? '') || a.id.localeCompare(b.id))
        .map((q): SentBack => {
          const later = s.questions.filter((x) => x.chapter_id === q.chapter_id && norm(x.question) === norm(q.question) && x.status !== 'rejected');
          const now = later.some((x) => x.status === 'approved') ? 'approved' : later.length ? 'pending' : null;
          return { ...strip(q), reviewer: nameOf(q.reviewedBy), seen: q.seenAt !== null, now };
        });
    },

    async markSentBackSeen(ids) {
      await wait(100);
      need('team');
      const at = new Date().toISOString();
      for (const q of s.questions) {
        if (q.status === 'rejected' && q.teacherEmail === DUMMY_ME.email && !q.seenAt && ids.includes(q.id)) q.seenAt = at;
      }
    },

    async loadPeople() {
      await wait();
      need('admin');
      const rank = { admin: 0, hod: 1, member: 2 };
      return [...s.team].sort((a, b) => Number(b.moderator) - Number(a.moderator) || rank[a.role] - rank[b.role] || (a.name ?? a.email).localeCompare(b.name ?? b.email));
    },

    async setPersonRole(email, role) {
      await wait();
      need('admin');
      const mail = email.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) throw new Error("That doesn't look like an email address.");
      if (mail === DUMMY_ME.email && role !== 'admin') throw new Error("You can't take away your own admin role.");
      const p = s.team.find((x) => x.email === mail);
      if (p?.moderator && role !== 'admin') throw new Error('The moderator stays an admin.');
      if (p) p.role = role;
      else s.team.push({ email: mail, name: null, role, moderator: false, added_at: new Date().toISOString(), last_seen_at: null });
    },

    async removePerson(email) {
      await wait();
      need('admin');
      const mail = email.trim().toLowerCase();
      if (mail === DUMMY_ME.email) throw new Error("You can't remove yourself.");
      if (s.team.find((x) => x.email === mail)?.moderator) throw new Error("The moderator can't be removed.");
      s.team = s.team.filter((x) => x.email !== mail);
    },
  };
}
