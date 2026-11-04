import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { toRecord, type AdminList, type Bank, type BankQuestion, type Batch, type GamesRole, type ListChapter, type ListSave, type Person, type RoleCheck, type Row, type SentBack, type Status, type TeamChange, type TopicQuestions } from './rows';

/*
 * Everything the games pages ask the database, as one object, so the same pages run against the real database or,
 * in dummy mode, an in-memory fake (src/dummy/games-fake-api.ts).
 *
 * The real one talks to the `games` schema (supabase/games/install.sql, then upgrade-1-team-log-and-pages.sql), through
 * its functions only, never its tables.
 * It reads nothing of Shikshaq's own tables. Until that schema is installed (and added to the API's exposed schemas)
 * every call fails, so nobody is shown the games team: the account menu's check reads a failure as "not on the team".
 */

/** What "Send" gives back: the new batch IDs, and how many were sent, skipped as already sent, or skipped because
 * they were sent back to this person before and haven't changed (`sentBackIds`: the notifications to show). */
export interface SendResult { batchIds: string[]; sent: number; already: number; sentBack: number; sentBackIds: string[] }
/** What a saved decision gives back: what changed, what stayed sent back (the same question is already waiting or
 * approved), and how many are waiting and approved now. */
export interface SaveResult { changed: string[]; skipped: string[]; waiting: number; approved: number }
/** The numbers on Approve questions' tabs. */
export interface HodCounts { waiting: number; approved: number; sentBack: number }

export interface GamesApi {
  /** The signed-in person's role on the games team; null when they aren't on it; 'reauth' when this sign-in (a
   * password) doesn't prove their email. Asked every time a page opens. */
  myRole(): Promise<RoleCheck>;
  /** The fixed list of chapters and their topics: questions can only be written for these. */
  loadCatalog(): Promise<ListChapter[]>;
  /** Sends questions to wait for an HoD: one batch per `BATCH_MAX`. */
  sendBatch(rows: Row[]): Promise<SendResult>;
  /** HoDs and admins: the waiting questions, `WAITING_BATCHES` batches at a time, newest batch first: the batches sent
   * before `after` that still have a question waiting, with those questions. */
  loadWaiting(after?: Batch): Promise<Bank>;
  /** HoDs and admins: approved questions, newest first, `APPROVED_PAGE` at a time: those approved before `after`. */
  loadApproved(after?: BankQuestion): Promise<Bank>;
  /** HoDs and admins: sent-back questions, newest first, `SENT_BACK_PAGE` at a time: those sent back before `after`. */
  loadSentBack(after?: BankQuestion): Promise<Bank>;
  /** HoDs and admins: how many are waiting, approved and sent back. */
  hodCounts(): Promise<HodCounts>;
  /** HoDs and admins: approve, send back (with a reason) or move back to waiting. */
  saveStatus(ids: string[], status: Status, reason?: string): Promise<SaveResult>;
  /** The number on the Approve tab. HoDs and admins only. */
  waitingCount(): Promise<number>;
  /** Every approved question, in order: the games and the download. */
  loadQuestionBank(): Promise<BankQuestion[]>;
  /** The signed-in person's questions that were sent back, newest first. */
  mySentBack(): Promise<SentBack[]>;
  /** The person has seen these notifications. */
  markSentBackSeen(ids: string[]): Promise<void>;
  /** Admins: the team. */
  loadPeople(): Promise<Person[]>;
  /** Admins: add someone, or change their role (noted in the team's log). */
  setPersonRole(email: string, role: GamesRole): Promise<void>;
  /** Admins: take someone off the team (noted in the team's log). */
  removePerson(email: string): Promise<void>;
  /** Admins: the team's log, newest first, `TEAM_LOG_PAGE` at a time: the entries before `beforeId`. */
  loadTeamLog(beforeId?: number): Promise<TeamChange[]>;

  /** Admins: the list as the Chapters page shows it, with question counts and the latest changes. */
  loadList(): Promise<AdminList>;
  /**
   * Admins: saves the changes made to one board, class and subject's chapters (or, from Bulk add, to several), all at
   * once, or none of them if any is refused (or the list changed since `before`). Gives back how many changes were made.
   */
  saveChapters(save: ListSave | ListSave[]): Promise<{ changes: number }>;
  /** Admins: up to 20 of a topic's questions (`topicNo` null: the chapter's questions under no topic), and how many it has. */
  topicQuestions(chapterId: string, topicNo: number | null): Promise<TopicQuestions>;
}

/** The most questions the database takes in one batch; more are sent as several batches, one after another. */
export const BATCH_MAX = 500;
/** Approve questions loads this many batches of waiting questions at a time. */
export const WAITING_BATCHES = 3;
/** Approve questions loads this many approved, or sent-back, questions at a time. */
export const APPROVED_PAGE = 20;
export const SENT_BACK_PAGE = 20;
/** The team's log loads this many entries at a time. */
export const TEAM_LOG_PAGE = 20;

// ---------------------------------------------------------------- the real database

/* The typed client only knows the `public` schema; `games` is reached untyped. */
const db = () => (supabase as unknown as SupabaseClient).schema('games');

const OFFLINE = "Couldn't reach the question bank. Check the internet connection and try again.";
/** The database's own words for a value it won't store ("violates check constraint ..."): something is missing or too long. */
const REFUSED = /violates|constraint|invalid input|value too long|out of range/i;

/** Runs a database call and turns its error into a plain sentence. */
async function ask<T>(call: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
  let r: { data: T | null; error: { message: string } | null };
  try {
    r = await call;
  } catch {
    throw new Error(OFFLINE);
  }
  if (!r.error) return r.data as T;
  const m = r.error.message;
  throw new Error(/fetch/i.test(m) ? OFFLINE : REFUSED.test(m) ? 'The question bank refused this: something in it is missing or too long. Check the lines and boxes marked in red or amber, then try again.' : m);
}

/** A row from the questions or question_bank table, with the batch's teacher and date where there is one. */
interface DbQuestion extends Omit<Row, 'line'> {
  question_id: string; batch_id?: string; status?: Status; note?: string; reviewed_at?: string | null;
  approved_at?: string; teacher?: string; teacher_email?: string | null; sent_at?: string;
}
const fromDb = (r: DbQuestion): BankQuestion => ({
  ...r, line: 0, also: r.also ?? [], fill: r.fill ?? null, wrong_options: r.wrong_options ?? [], id: r.question_id, batch: r.batch_id ?? '', status: r.status ?? 'approved', note: r.note ?? '', reviewedAt: r.reviewed_at ?? r.approved_at ?? null,
});

/** Questions from the HoD desk's functions, with their batches. */
function toBank(rows: DbQuestion[]): Bank {
  const batches = new Map<string, Batch>();
  for (const r of rows) if (r.batch_id && !batches.has(r.batch_id)) batches.set(r.batch_id, { id: r.batch_id, by: r.teacher ?? '', email: r.teacher_email ?? '', at: r.sent_at ?? '' });
  return { batches: [...batches.values()], questions: rows.map(fromDb) };
}

export const realGamesApi: GamesApi = {
  myRole: () => ask<RoleCheck>(db().rpc('my_role')),
  loadCatalog: () => ask<ListChapter[]>(db().rpc('catalog')),

  async sendBatch(rows) {
    const ready = rows.filter((r) => r.chapter_id && r.chapter).map(toRecord);
    const out: SendResult = { batchIds: [], sent: 0, already: 0, sentBack: 0, sentBackIds: [] };
    for (let i = 0; i < ready.length; i += BATCH_MAX) {
      const r = await ask<{ batch_id: string | null; sent: number; already: number; sent_back: number; sent_back_ids: string[] }>(
        db().rpc('submit_batch', { questions: ready.slice(i, i + BATCH_MAX) }),
      );
      if (r.batch_id) out.batchIds.push(r.batch_id);
      out.sent += r.sent;
      out.already += r.already;
      out.sentBack += r.sent_back;
      out.sentBackIds.push(...r.sent_back_ids);
    }
    return out;
  },

  loadWaiting: async (after) =>
    toBank(await ask<DbQuestion[]>(db().rpc('hod_waiting', { before_at: after?.at ?? null, before_batch: after?.id ?? null, take: WAITING_BATCHES }))),
  loadApproved: async (after) =>
    toBank(await ask<DbQuestion[]>(db().rpc('hod_approved', { before_at: after?.reviewedAt ?? null, before_id: after?.id ?? null, take: APPROVED_PAGE }))),
  loadSentBack: async (after) =>
    toBank(await ask<DbQuestion[]>(db().rpc('hod_sent_back', { before_at: after?.reviewedAt ?? null, before_id: after?.id ?? null, take: SENT_BACK_PAGE }))),
  hodCounts: async () => {
    const c = await ask<{ waiting: number; approved: number; sent_back: number }>(db().rpc('hod_counts'));
    return { waiting: c.waiting, approved: c.approved, sentBack: c.sent_back };
  },
  saveStatus: (ids, status, reason = '') => ask<SaveResult>(db().rpc('hod_set_status', { ids, new_status: status, reason })),
  waitingCount: () => ask<number>(db().rpc('waiting_count')),

  /* The whole bank in one answer (a function, not a table read, so there is no 1,000-row page limit), in order. */
  loadQuestionBank: async () => (await ask<DbQuestion[]>(db().rpc('bank'))).map(fromDb),

  mySentBack: async () =>
    (await ask<(DbQuestion & { reviewer: string; seen: boolean; now: SentBack['now'] })[]>(db().rpc('my_sent_back')))
      .map((r): SentBack => ({ ...fromDb(r), reviewer: r.reviewer, seen: r.seen, now: r.now })),
  markSentBackSeen: async (ids) => { await ask<null>(db().rpc('mark_sent_back_seen', { ids })); },

  loadPeople: () => ask<Person[]>(db().rpc('admin_people')),
  // the upgrade's functions, which note each change in the team's log (supabase/games/upgrade-1-team-log-and-pages.sql)
  setPersonRole: async (email, role) => { await ask<null>(db().rpc('admin_team_set', { person: email, new_role: role })); },
  removePerson: async (email) => { await ask<null>(db().rpc('admin_team_remove', { person: email })); },
  loadTeamLog: (beforeId) => ask<TeamChange[]>(db().rpc('admin_team_log', { before_id: beforeId ?? null, take: TEAM_LOG_PAGE })),

  loadList: () => ask<AdminList>(db().rpc('admin_list')),
  saveChapters: (save) => ask<{ changes: number }>(db().rpc('admin_save_chapters', { changes: save })),
  topicQuestions: (chapterId, topicNo) => ask<TopicQuestions>(db().rpc('admin_topic_questions', { chapter: chapterId, topic_no: topicNo })),
};
