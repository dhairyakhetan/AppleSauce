import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Plus } from 'lucide-react';
import type { GamesApi } from '@/lib/games/api';
import { parseList, type ListProblem } from '@/lib/games/list-rows';
import type { AdminChapter, AdminList } from '@/lib/games/rows';
import { STARTING_LIST } from '@/lib/games/starting-list';
import { cn } from '@/lib/utils';
import { btn, chip, FIELD, offerUndo, plural, when } from './helpers';
import { Empty, Loading } from './shared';

/* The list of chapters (admins): questions can only be written for a chapter on it. Chapters are added one at a time or
   pasted many at once, in the rows a spreadsheet gives; a chapter or topic can be renamed at any time (its questions
   take the new name), but its number changes, and it is deleted, only while nothing has been sent for it, as the number
   is part of every question's ID. A chapter's topics are open (writers add their own, and the first question sent
   under one adds it) or fixed (only these). The database checks all of it and notes every change. */

const SELECT = 'h-11 rounded-full bg-card px-3 text-[14px] font-semibold text-foreground outline-none ring-1 ring-border focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50';
const SMALL = cn(FIELD, 'h-9 rounded-full px-3');
const LOCKED = "It has questions, so this can't change: the number is part of each question's ID.";

/** What is being edited: a chapter's or topic's name or number. */
type Edit = { what: 'name' | 'number'; chapter: string; topic: number | null; value: string };

export function Chapters({ api, onChanged }: { api: GamesApi; onChanged: () => void }) {
  const [list, setList] = useState<AdminList | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [pasted, setPasted] = useState('');
  const [problems, setProblems] = useState<ListProblem[]>([]);
  const [pick, setPick] = useState({ board: '', cls: '', subject: '' });
  const [edit, setEdit] = useState<Edit | null>(null);
  const [newTopic, setNewTopic] = useState<Record<string, { no: string; name: string }>>({});
  const [newChapter, setNewChapter] = useState({ no: '', name: '' });

  const load = useCallback(() => api.loadList().then((l) => { setList(l); setError(''); }, (e: Error) => setError(e.message)), [api]);
  useEffect(() => { void load(); }, [load]);

  /** Runs a change, then shows the list as the database now has it, and tells the other parts it changed. */
  const change = async (run: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setNote('');
    setError('');
    try {
      await run();
      setNote(done);
      setEdit(null);
      await load();
      onChanged();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  // the board, class and subject shown: those on the list, in order; the first until one is picked
  const chapters = useMemo(() => list?.chapters ?? [], [list]);
  const boards = [...new Set(chapters.map((c) => c.board))];
  const board = boards.includes(pick.board) ? pick.board : boards[0] ?? '';
  const classes = [...new Set(chapters.filter((c) => c.board === board).map((c) => c.class))].sort((a, b) => a - b);
  const cls = classes.includes(Number(pick.cls)) ? Number(pick.cls) : classes[0];
  const subjects = [...new Set(chapters.filter((c) => c.board === board && c.class === cls).map((c) => c.subject))].sort();
  const subject = subjects.includes(pick.subject) ? pick.subject : subjects[0] ?? '';
  const shown = useMemo(() => chapters.filter((c) => c.board === board && c.class === cls && c.subject === subject), [chapters, board, cls, subject]);
  const nextChapter = Math.max(0, ...shown.map((c) => c.chapter_no)) + 1;

  const addPasted = async (e?: FormEvent) => {
    e?.preventDefault();
    const { chapters: rows, problems: found } = parseList(pasted);
    setProblems(found);
    setNote('');
    setError('');
    if (found.length) return;
    if (!rows.length) { setError('Paste at least one row: Board | Class | Subject | Chapter number | Chapter.'); return; }
    let done = '';
    if (await change(async () => {
      const r = await api.addChapters(rows);
      done = `Added ${plural(r.chapters, 'chapter')} and ${plural(r.topics, 'topic')}${r.already ? ` (${plural(r.already, 'chapter was', 'chapters were')} on the list already)` : ''}.`;
    }, '')) {
      setNote(done);
      setPasted('');
    }
  };

  const addOne = (e: FormEvent) => {
    e.preventDefault();
    const no = Number(newChapter.no || nextChapter);
    void change(() => api.addChapters([{ board, class: cls, subject, chapter_no: no, name: newChapter.name.trim(), topics: [] }]),
      `Added chapter ${no}: ${newChapter.name.trim()}.`).then((ok) => { if (ok) setNewChapter({ no: '', name: '' }); });
  };

  const addTopic = (c: AdminChapter, e: FormEvent) => {
    e.preventDefault();
    const t = newTopic[c.chapter_id] ?? { no: '', name: '' };
    const no = Number(t.no || Math.max(0, ...c.topics.map((x) => x.topic_no)) + 1);
    void change(() => api.addTopic(c.chapter_id, no, t.name.trim()), `Added topic ${no} to chapter ${c.chapter_no}.`)
      .then((ok) => { if (ok) setNewTopic((m) => ({ ...m, [c.chapter_id]: { no: '', name: '' } })); });
  };

  const save = (e: FormEvent) => {
    e.preventDefault();
    if (!edit) return;
    const v = edit.value.trim();
    const where = edit.topic === null ? 'Chapter' : `Topic ${edit.topic}`;
    if (edit.what === 'name') void change(() => api.renameInList(edit.chapter, edit.topic, v), `${where} renamed "${v}".`);
    else void change(() => api.renumberInList(edit.chapter, edit.topic, Number(v)), `${where} is now number ${v}.`);
  };

  /** Deleting can be undone for a few seconds: the chapter (or topic) is added back as it was. */
  const removeChapter = (c: AdminChapter) => {
    void change(() => api.deleteFromList(c.chapter_id, null), '').then((ok) => {
      if (!ok) return;
      offerUndo(`Chapter ${c.chapter_no} deleted`, () => {
        void change(async () => {
          await api.addChapters([{ board: c.board, class: c.class, subject: c.subject, chapter_no: c.chapter_no, name: c.name, topics: c.topics.map((t) => ({ topic_no: t.topic_no, name: t.name })) }]);
          if (c.open && c.topics.length) await api.setTopicsFixed(c.chapter_id, false);
        }, `Chapter ${c.chapter_no} is back.`);
      });
    });
  };
  const removeTopic = (c: AdminChapter, no: number, name: string) => {
    void change(() => api.deleteFromList(c.chapter_id, no), '').then((ok) => {
      if (ok) offerUndo(`Topic ${no} deleted`, () => { void change(() => api.addTopic(c.chapter_id, no, name), `Topic ${no} is back.`); });
    });
  };

  /** A name or number being edited, in place. */
  const editor = (chapter: string, topic: number | null) => edit && edit.chapter === chapter && edit.topic === topic && (
    <form className="flex flex-wrap items-center gap-2" onSubmit={save}>
      <input aria-label={edit.what === 'name' ? 'New name' : 'New number'} autoFocus value={edit.value} disabled={busy}
        inputMode={edit.what === 'number' ? 'numeric' : undefined} className={cn(SMALL, edit.what === 'number' ? 'w-20' : 'min-w-[200px] flex-1')}
        onChange={(e) => setEdit({ ...edit, value: e.target.value })} onKeyDown={(e) => { if (e.key === 'Escape') setEdit(null); }} />
      <button type="submit" className={chip('brand')} disabled={busy || !edit.value.trim()}>Save</button>
      <button type="button" className={chip('card')} onClick={() => setEdit(null)}>Cancel</button>
    </form>
  );
  const actions = (c: AdminChapter, topic: { topic_no: number; name: string; questions: number } | null) => {
    const locked = (topic ? topic.questions : c.questions) > 0;
    const no = topic ? topic.topic_no : c.chapter_no;
    const name = topic ? topic.name : c.name;
    const what = topic ? `topic ${no}` : `chapter ${no}`;
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" className={chip('card')} disabled={busy} aria-label={`Rename ${what}`}
          onClick={() => setEdit({ what: 'name', chapter: c.chapter_id, topic: topic?.topic_no ?? null, value: name })}>Rename</button>
        <button type="button" className={chip('card')} disabled={busy || locked} title={locked ? LOCKED : undefined} aria-label={`Change the number of ${what}`}
          onClick={() => setEdit({ what: 'number', chapter: c.chapter_id, topic: topic?.topic_no ?? null, value: String(no) })}>Number</button>
        <button type="button" className={chip('card', 'text-destructive')} disabled={busy || locked} title={locked ? LOCKED : undefined} aria-label={`Delete ${what}`}
          onClick={() => (topic ? removeTopic(c, no, name) : removeChapter(c))}>Delete</button>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-prose text-[14px] text-warm-secondary">
        Questions can only be written for a chapter on this list. A name can change at any time, and its questions take the new one.
        A number can change, and a chapter or topic can be deleted, only until a question is sent for it: the number is part of each question's ID.
      </p>

      <section aria-labelledby="paste-h" className="flex flex-col gap-3 rounded-[24px] bg-muted p-4 sm:p-6">
        <h2 id="paste-h" className="text-[15px] font-bold text-foreground">Add chapters</h2>
        <form className="flex flex-col gap-2" onSubmit={addPasted}>
          <label htmlFor="list-paste" className="text-[12px] font-semibold text-warm-secondary">Chapters to add</label>
          <p id="list-paste-how" className="text-[13px] text-warm-secondary">
            One row per chapter, from a spreadsheet or written with <code className="rounded bg-card px-1 font-mono text-[13px]">|</code> between the columns:
            {' '}<b className="text-foreground">Board | Class | Subject | Chapter number | Chapter</b>, with <b className="text-foreground">| Topic number | Topic</b> on the end to give a chapter fixed topics (one row per topic).
            Lines starting with # are notes.
          </p>
          <textarea id="list-paste" aria-describedby="list-paste-how" rows={6} value={pasted} spellCheck={false} disabled={busy}
            placeholder={'ICSE | 10 | Physics | 1 | Force\nICSE | 10 | Physics | 2 | Work, Energy and Power'}
            onChange={(e) => { setPasted(e.target.value); setProblems([]); }}
            className={cn(FIELD, 'min-h-[140px] py-2 font-mono text-[13px] sm:text-[13px]')} />
          {problems.length > 0 && (
            <ul className="flex flex-col gap-1 rounded-2xl bg-card px-4 py-3 text-[13px]" role="alert" aria-label="Rows to fix">
              {problems.slice(0, 30).map((p) => <li key={p.line}><b className="text-destructive">Line {p.line}:</b> {p.text}</li>)}
              {problems.length > 30 && <li className="text-warm-secondary">and {plural(problems.length - 30, 'more line')}.</li>}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={btn('brand')} disabled={busy || !pasted.trim()}><Plus aria-hidden /> Check and add</button>
            <button type="button" className={btn('card')} disabled={busy} onClick={() => { setPasted(STARTING_LIST); setProblems([]); }}>Fill in the starting list</button>
          </div>
          <p className="text-[12px] text-warm-meta">The starting list has 564 chapters: the site's Mathematics, and other subjects for classes 9 to 12 drafted from the syllabus. Check the drafted ones before adding them.</p>
        </form>
        {note && <p className="rounded-2xl bg-mint px-4 py-3 text-[14px] text-foreground" role="status">{note}</p>}
        {error && <p className="rounded-2xl bg-destructive/10 px-4 py-3 text-[14px] text-foreground" role="alert">{error}</p>}
      </section>

      <section aria-labelledby="list-h" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="list-h" className="text-[15px] font-bold text-foreground">The list{list ? ` (${plural(chapters.length, 'chapter')})` : ''}</h2>
          {chapters.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <select aria-label="Board" className={SELECT} value={board} onChange={(e) => setPick({ board: e.target.value, cls: '', subject: '' })}>
                {boards.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
              <select aria-label="Class" className={SELECT} value={String(cls)} onChange={(e) => setPick({ board, cls: e.target.value, subject: '' })}>
                {classes.map((c) => <option key={c} value={c}>Class {c}</option>)}
              </select>
              <select aria-label="Subject" className={SELECT} value={subject} onChange={(e) => setPick({ board, cls: String(cls), subject: e.target.value })}>
                {subjects.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          )}
        </div>

        {!list ? (error ? null : <Loading label="Loading the list of chapters" />) : !chapters.length ? (
          <Empty>The list is empty. Paste chapters above, or fill in the starting list.</Empty>
        ) : (
          <ul className="flex flex-col gap-2">
            {shown.map((c) => (
              <li key={c.chapter_id} className="flex flex-col gap-2 rounded-2xl bg-muted px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {editor(c.chapter_id, null) || (
                    <>
                      <div className="min-w-0">
                        <p className="text-[14px] font-semibold text-foreground">{c.chapter_no}. {c.name}</p>
                        <p className="text-[12px] text-warm-meta">{c.questions ? plural(c.questions, 'question') : 'No questions yet'} · {c.chapter_id}</p>
                      </div>
                      {actions(c, null)}
                    </>
                  )}
                </div>

                <div className="flex flex-col gap-1.5 border-t border-border pt-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[13px] text-warm-secondary">
                      Topics: <b className="text-foreground">{c.open ? 'open' : 'fixed'}</b> {c.open ? '(writers add their own)' : '(questions go only under these)'}
                    </p>
                    <button type="button" className={chip('card')} disabled={busy || (!c.open ? false : !c.topics.length)}
                      title={c.open && !c.topics.length ? 'Add its topics first, then fix them.' : undefined}
                      onClick={() => void change(() => api.setTopicsFixed(c.chapter_id, c.open), `Chapter ${c.chapter_no}'s topics are ${c.open ? 'fixed' : 'open'} now.`)}>
                      {c.open ? 'Fix them' : 'Open them'}
                    </button>
                  </div>
                  {c.topics.length > 0 && (
                    <ul className="flex flex-col gap-1">
                      {c.topics.map((t) => (
                        <li key={t.topic_id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-card px-3 py-2">
                          {editor(c.chapter_id, t.topic_no) || (
                            <>
                              <p className="text-[13px] text-foreground">Topic {t.topic_no}: {t.name} <span className="text-warm-meta">· {t.questions ? plural(t.questions, 'question') : 'no questions yet'}</span></p>
                              {actions(c, t)}
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => addTopic(c, e)}>
                    <input aria-label={`Number of the new topic of chapter ${c.chapter_no}`} inputMode="numeric" className={cn(SMALL, 'w-16')} disabled={busy}
                      placeholder={String(Math.max(0, ...c.topics.map((x) => x.topic_no)) + 1)} value={newTopic[c.chapter_id]?.no ?? ''}
                      onChange={(e) => setNewTopic((m) => ({ ...m, [c.chapter_id]: { name: m[c.chapter_id]?.name ?? '', no: e.target.value } }))} />
                    <input aria-label={`Name of the new topic of chapter ${c.chapter_no}`} className={cn(SMALL, 'min-w-[180px] flex-1')} placeholder="Add a topic" disabled={busy}
                      value={newTopic[c.chapter_id]?.name ?? ''}
                      onChange={(e) => setNewTopic((m) => ({ ...m, [c.chapter_id]: { no: m[c.chapter_id]?.no ?? '', name: e.target.value } }))} />
                    <button type="submit" className={chip('card')} disabled={busy || !newTopic[c.chapter_id]?.name?.trim()}>Add topic</button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}

        {chapters.length > 0 && (
          <form className="flex flex-wrap items-center gap-2 rounded-2xl bg-muted px-4 py-3" onSubmit={addOne}>
            <span className="text-[13px] font-semibold text-warm-secondary">Add a chapter to {board} class {cls} {subject}:</span>
            <input aria-label="Number of the new chapter" inputMode="numeric" className={cn(SMALL, 'w-16')} placeholder={String(nextChapter)} disabled={busy}
              value={newChapter.no} onChange={(e) => setNewChapter((n) => ({ ...n, no: e.target.value }))} />
            <input aria-label="Name of the new chapter" className={cn(SMALL, 'min-w-[200px] flex-1')} placeholder="Chapter name" disabled={busy}
              value={newChapter.name} onChange={(e) => setNewChapter((n) => ({ ...n, name: e.target.value }))} />
            <button type="submit" className={chip('card')} disabled={busy || !newChapter.name.trim()}>Add chapter</button>
          </form>
        )}
      </section>

      {list && list.log.length > 0 && (
        <section aria-labelledby="log-h" className="flex flex-col gap-2">
          <h2 id="log-h" className="text-[15px] font-bold text-foreground">Recent changes</h2>
          <ul className="flex flex-col gap-1 text-[13px] text-warm-prose">
            {list.log.slice(0, 10).map((l, i) => (
              <li key={`${l.at}-${i}`}>{l.detail} <span className="text-warm-meta">{l.by}, {when(l.at)}</span></li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
