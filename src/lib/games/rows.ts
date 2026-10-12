/**
 * The games team's question rows: the shape every part agrees on (the question formatter makes them, the HoD desk
 * approves them, the games read them), the files they download as, and the bank's statuses.
 *
 * Pure: no Supabase here. The database calls are in api.ts (real) and src/dummy/games-fake-api.ts (dummy mode).
 */

// ---------------------------------------------------------------- a question row

export type Difficulty = 'easy' | 'medium' | 'hard';
export const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];

/** The columns of a row, in order. These are the column names of the CSV and the keys of the JSON. */
export const COLUMNS = ['chapter_id', 'topic_id', 'board', 'class', 'subject', 'chapter_no', 'chapter', 'topic_no', 'topic', 'question_no', 'question', 'answer', 'also', 'fill', 'wrong_options', 'difficulty'] as const;

export interface Row {
  /** Board code + class + subject code + chapter number, such as CBSE10SCI01. Null until all four are known. */
  chapter_id: string | null;
  /** Chapter ID + "T" + topic number, such as CBSE10SCI01T02. */
  topic_id: string | null;
  board: string;
  class: number | null;
  subject: string;
  chapter_no: number | null;
  chapter: string;
  topic_no: number | null;
  topic: string;
  /** Position of the question within its topic (within its chapter when there is no topic), from 1. */
  question_no: number;
  question: string;
  answer: string;
  /** Other answers that count as right (up to 5). */
  also: string[];
  /** The fill-in-the-blank version: a sentence with ___ where the answer goes. Null when none was written. */
  fill: string | null;
  /** Multiple choice: the wrong options shown beside the answer (3 to 5). Empty for an ordinary question. */
  wrong_options: string[];
  difficulty: Difficulty | null;
  /** The line of the Questions box the question starts on (its Q: line). Not exported. */
  line: number;
  /** Its last line, and the detail lines it is under (Board, Class, Subject, Chapter, Topic). Not exported. */
  end?: number;
  under?: number[];
}

// ---------------------------------------------------------------- rows as files

type Record_ = Record<(typeof COLUMNS)[number], string | number | string[] | null>;

/** A row as the database sees it: the columns only, with an empty value as null (and an empty list as []). */
export function toRecord(r: Row): Record_ {
  const out = {} as Record_;
  for (const c of COLUMNS) out[c] = r[c] === '' ? null : r[c];
  return out;
}

/** A header row, then one line per question. Other answers and wrong options go in one cell each, separated by "; ". */
function table(rows: Row[], sep: string, cell: (v: string) => string): string {
  const line = (r: Row) => {
    const rec = toRecord(r);
    return COLUMNS.map((c) => { const v = rec[c]; return cell(Array.isArray(v) ? v.join('; ') : String(v ?? '')); }).join(sep);
  };
  return [COLUMNS.join(sep), ...rows.map(line)].join('\n');
}

/** CSV with a header row (RFC 4180 quoting, no byte-order mark), ready to import into a table. */
export const toCSV = (rows: Row[]) => table(rows, ',', (v) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)) + '\n';

export const toJSON = (rows: Row[]) => JSON.stringify(rows.map(toRecord), null, 2) + '\n';

/** Tab-separated with a header row, for pasting into Google Sheets or Excel. */
export const toTSV = (rows: Row[]) => table(rows, '\t', (v) => v.replace(/\t/g, ' '));

// ---------------------------------------------------------------- the question bank

export type Status = 'pending' | 'approved' | 'rejected';
/** A teacher's batch. `id` is its batch ID, such as B20261009-03 (the 3rd batch sent that day). */
export interface Batch { id: string; by: string; email: string; at: string }
/** A question in the bank. `id` is its question ID, such as CBSE10SCI01T02Q003 (chapter, topic 02, question 003). */
export interface BankQuestion extends Row { id: string; batch: string; status: Status; note: string; reviewedAt: string | null }
export interface Bank { batches: Batch[]; questions: BankQuestion[] }

/** Approve, send back (with the reason the teacher sees) or move back to waiting, on the page's copy of the bank. */
export function setStatus(bank: Bank, ids: string[], status: Status, note: string, at: string): Bank {
  const pick = new Set(ids);
  return {
    ...bank,
    questions: bank.questions.map((q) => (pick.has(q.id) ? { ...q, status, note: status === 'rejected' ? note.trim() : '', reviewedAt: status === 'pending' ? null : at } : q)),
  };
}

export const counts = (bank: Bank): Record<Status, number> => ({
  pending: bank.questions.filter((q) => q.status === 'pending').length,
  approved: bank.questions.filter((q) => q.status === 'approved').length,
  rejected: bank.questions.filter((q) => q.status === 'rejected').length,
});

/** A notification: one of the person's questions that was sent back, with why (`note`) and by whom. `now`: what
 * happened to it since (sent again and waiting or approved), or null. */
export interface SentBack extends BankQuestion { reviewer: string; seen: boolean; now: 'pending' | 'approved' | null }

// ---------------------------------------------------------------- the games team

/**
 * What a person on the games team may do: member (write and send questions, and see which were sent back), hod (also
 * approve them) or admin (also manage the team). Only people on the team list get in; everyone else gets null.
 */
export type GamesRole = 'admin' | 'hod' | 'member';
export const ROLE_NAMES: Record<GamesRole, string> = { admin: 'Admin', hod: 'HoD', member: 'Member' };

/** What the database says about the signed-in person: their role, null when not on the team, or 'reauth' when they
 * signed in in a way that doesn't prove their email (a password): they must sign in with Google or an email link. */
export type RoleCheck = GamesRole | 'reauth' | null;

/** Someone on the games team. `moderator`: the admin who runs it, whom nobody can remove or demote. */
export interface Person { email: string; name: string | null; role: GamesRole; moderator: boolean; added_at: string; last_seen_at: string | null }

// ---------------------------------------------------------------- the fixed list of chapters and topics

export interface ListTopic { topic_id: string; topic_no: number; name: string }
/** A chapter on the list, with its topics. `board` and `subject` are their names, as on the site's lists. */
export interface ListChapter { chapter_id: string; board: string; class: number; subject: string; chapter_no: number; name: string; topics: ListTopic[] }
