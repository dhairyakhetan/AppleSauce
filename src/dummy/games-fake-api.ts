import { APPROVED_PAGE, BATCH_MAX, type GamesApi, type SaveResult, type SendResult } from '@/lib/games/api';
import { checkBoard, checkSubject, pad2 } from '@/lib/games/details';
import { format } from '@/lib/games/format';
import type { Bank, BankQuestion, Batch, GamesRole, Person, Row, SentBack, Status } from '@/lib/games/rows';

/* The games pages in dummy mode (D75): an in-memory stand-in for the `games` schema, with no sign-in. It keeps the
   same rules as the database: who may do what, duplicates skipped, questions numbered within their topic and never
   renumbered, a sent-back question not sent again unchanged, batch IDs by the day. Test builds only, reached solely
   through the PREVIEW_TOOLS-gated lazy import in pages/Games.tsx.

   Every question and name below is made up for the preview; none is copied from a real paper. */

/** The dummy "you". Which role you have is switched from the dummy banner. */
export const DUMMY_ME = { email: 'you@example.com', name: 'You (dummy)' };

interface FakeQuestion extends BankQuestion { teacherEmail: string; reviewedBy: string | null; seenAt: string | null }
interface State { team: Person[]; batches: Batch[]; questions: FakeQuestion[] }

const OWNER = { email: 'asha.rao@example.com', name: 'Asha Rao' };
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
Normal temperature of the human body, in degrees Celsius | 37 | medium
Thermometer that a doctor uses to check for fever | Clinical thermometer | medium
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
Highest mountain range in the world | Himalayas | easy
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

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
/** How the database compares two questions: case, extra spaces and punctuation at the end don't matter. */
const norm = (t: string) => t.trim().replace(/[\s?.!:;,।]+$/u, '').replace(/\s+/g, ' ').toLowerCase();
const indiaDay = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso)).replace(/-/g, '');

function seed(): State {
  const s: State = {
    team: [
      { ...OWNER, role: 'admin', owner: true, added_at: hoursAgo(24 * 30), last_seen_at: hoursAgo(5), name: OWNER.name },
      { ...HOD, role: 'hod', owner: false, added_at: hoursAgo(24 * 20), last_seen_at: hoursAgo(2), name: HOD.name },
      { ...ROHAN, role: 'member', owner: false, added_at: hoursAgo(24 * 10), last_seen_at: hoursAgo(26), name: ROHAN.name },
      { ...PRIYA, role: 'member', owner: false, added_at: hoursAgo(24 * 3), last_seen_at: null, name: PRIYA.name },
      { ...DUMMY_ME, role: 'admin', owner: false, added_at: hoursAgo(24 * 15), last_seen_at: hoursAgo(0.1) },
    ],
    batches: [],
    questions: [],
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
  for (const r of rows) {
    const cid = r.chapter_id!;
    const key = `${cid}|${norm(r.question)}`;
    if (seen.has(key) || s.questions.some((x) => x.chapter_id === cid && norm(x.question) === norm(r.question) && x.status !== 'rejected')) {
      out.already++;
      continue;
    }
    seen.add(key);
    const back = s.questions.filter((x) => x.chapter_id === cid && x.status === 'rejected' && x.teacherEmail === who.email
      && norm(x.question) === norm(r.question) && norm(x.answer) === norm(r.answer));
    if (back.length) {
      out.sentBack++;
      out.sentBackIds.push(...back.map((x) => x.id));
      continue;
    }
    const tno = r.topic_no ?? 0;
    const n = Math.max(0, ...s.questions.filter((x) => x.chapter_id === cid && (x.topic_no ?? 0) === tno).map((x) => x.question_no)) + 1;
    const id = `${cid}T${pad2(tno)}Q${String(n).padStart(3, '0')}`;
    s.questions.push({
      ...r, line: 0, question: r.question.trim(), answer: r.answer.trim(), topic_id: r.topic_no === null ? null : `${cid}T${pad2(tno)}`, question_no: n,
      id, batch: batch.id, status: 'pending', note: '', reviewedAt: null, teacherEmail: who.email, reviewedBy: null, seenAt: null,
    });
    out.ids.push(id);
  }
  if (out.ids.length) s.batches.push(batch);
  return { batchId: out.ids.length ? batch.id : null, ...out };
}

/** The board and subject must be on the site's lists and match the chapter ID's codes. */
function codesProblem(r: Row): string | null {
  const board = checkBoard(r.board).code;
  const subject = checkSubject(r.subject).code;
  if (!board) return `The board "${r.board}" isn't on the site's list.`;
  if (!subject) return `The subject "${r.subject}" isn't on the site's list.`;
  if (!r.chapter_id?.startsWith(`${board}${pad2(r.class ?? 0)}${subject}`)) return 'A chapter ID doesn\'t match its board, class and subject.';
  return null;
}

const strip = ({ teacherEmail: _t, reviewedBy: _r, seenAt: _s, ...q }: FakeQuestion): BankQuestion => q;
const byChapterOrder = (a: BankQuestion, b: BankQuestion) =>
  (a.class ?? 0) - (b.class ?? 0) || a.subject.localeCompare(b.subject) || (a.chapter_no ?? 0) - (b.chapter_no ?? 0)
  || (a.topic_no ?? 0) - (b.topic_no ?? 0) || a.question_no - b.question_no || a.id.localeCompare(b.id);

export type FakeGamesApi = GamesApi & {
  /** Puts the made-up questions and team back as they started. */
  reset(): void;
  /** Which role the dummy "you" has; null takes you off the team. */
  setRole(role: GamesRole | null): void;
  role(): GamesRole | null;
};

/** `slow`: each call takes a moment, like the real database, so loading states show (tests pass false). */
export function createFakeGamesApi(slow = true): FakeGamesApi {
  const wait = (ms = 250) => (slow ? new Promise((done) => setTimeout(done, ms)) : Promise.resolve());
  let s = seed();
  const me = () => s.team.find((p) => p.email === DUMMY_ME.email) ?? null;
  const roleOf = () => me()?.role ?? null;
  const need = (what: 'team' | 'hod' | 'admin') => {
    const r = roleOf();
    if (!r) throw new Error('Please sign in first.');
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
    reset() { s = seed(); },
    setRole(role) {
      const p = me();
      if (!role) s.team = s.team.filter((x) => x !== p);
      else if (p) p.role = role;
      else s.team.push({ ...DUMMY_ME, role, owner: false, added_at: new Date().toISOString(), last_seen_at: null });
    },
    role: roleOf,

    async myRole() {
      await wait(150);
      const p = me();
      if (p) p.last_seen_at = new Date().toISOString();
      return p?.role ?? null;
    },

    async sendBatch(rows) {
      await wait(500);
      need('team');
      const ready = rows.filter((r) => r.chapter_id && r.chapter);
      const out: SendResult = { batchIds: [], sent: 0, already: 0, sentBack: 0, sentBackIds: [] };
      for (let i = 0; i < ready.length; i += BATCH_MAX) {
        const part = ready.slice(i, i + BATCH_MAX);
        for (const r of part) {
          const why = codesProblem(r);
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
      return [...s.team].sort((a, b) => Number(b.owner) - Number(a.owner) || rank[a.role] - rank[b.role] || (a.name ?? a.email).localeCompare(b.name ?? b.email));
    },

    async setPersonRole(email, role) {
      await wait();
      need('admin');
      const mail = email.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) throw new Error("That doesn't look like an email address.");
      if (mail === DUMMY_ME.email && role !== 'admin') throw new Error("You can't take away your own admin role.");
      const p = s.team.find((x) => x.email === mail);
      if (p?.owner && role !== 'admin') throw new Error('The owner stays an admin.');
      if (p) p.role = role;
      else s.team.push({ email: mail, name: null, role, owner: false, added_at: new Date().toISOString(), last_seen_at: null });
    },

    async removePerson(email) {
      await wait();
      need('admin');
      const mail = email.trim().toLowerCase();
      if (mail === DUMMY_ME.email) throw new Error("You can't remove yourself.");
      if (s.team.find((x) => x.email === mail)?.owner) throw new Error("The owner can't be removed.");
      s.team = s.team.filter((x) => x.email !== mail);
    },
  };
}
