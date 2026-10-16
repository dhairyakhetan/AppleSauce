import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import * as Accordion from '@radix-ui/react-accordion';
import { Check, ChevronDown, Copy, ListPlus, Plus } from 'lucide-react';
import { toast } from 'sonner';
import type { GamesApi } from '@/lib/games/api';
import { ALL_BOARDS, SUBJECTS } from '@/lib/games/details';
import {
  addChapter, addMany, addTopic, changeCount, changedInside, chapterChanged, chaptersOf, deleteChapter, deleteTopic, draftOf, isOpen, keepChapter, keepTopic,
  liveTopics, nextNumber, renameChapter, renameTopic, renumberChapter, renumberTopic, setOpen, toSave, topicChanged, type DraftChapter, type DraftTopic,
} from '@/lib/games/list-draft';
import { TOPIC_QUESTIONS_MAX, type AdminChapter, type AdminList, type ListGroup, type Status, type TopicQuestions } from '@/lib/games/rows';
import { chapterListPrompt } from '@/lib/games/prompt';
import { cn } from '@/lib/utils';
import { btn, chip, copyText, FIELD, plural, when } from './helpers';
import { Picker, type PickerOption } from './Picker';
import { Empty, Loading } from './shared';

/* The list of chapters (admins): questions can only be written for a chapter on it. Pick a board, class and subject;
   its chapters are listed, a chapter opens to its topics and a topic to its first questions. Edits (add, rename,
   renumber, delete, open or fix topics) stay on the page, marked, until "Save changes" sends them all at once
   (games.admin_save_chapters, which checks them again); "Revert changes", or picking another board, class or subject,
   drops them. A name can change at any time; a number changes, and a chapter or topic is deleted, only while nothing
   has been sent for it, as the number is part of each question's ID. */

const EASE = 'ease-[cubic-bezier(0.2,0,0,1)]';
const SMALL = cn(FIELD, 'h-9 rounded-full px-3');
const LOCKED = "It has questions, so this can't change: the number is part of each question's ID.";
const FIRST_SHOWN = 5;
const OPEN_ANIM = 'overflow-hidden data-[state=open]:animate-[accordion-down_160ms_cubic-bezier(0.2,0,0,1)] data-[state=closed]:animate-[accordion-up_120ms_cubic-bezier(0.2,0,0,1)]';
/** Whether the browser keeps what is on screen in place when something above it closes (not every browser does). */
const ANCHORS = typeof CSS !== 'undefined' && !!CSS.supports?.('overflow-anchor', 'auto');
const FALLBACK: ListGroup = { board: 'CBSE', class: 10, subject: 'Mathematics' };

export function Chapters({ api, onChanged }: { api: GamesApi; onChanged: () => void }) {
  const [list, setList] = useState<AdminList | null>(null);
  const [error, setError] = useState('');
  const [pick, setPick] = useState<ListGroup | null>(null);
  const [loadedAt, setLoadedAt] = useState(0);
  /** The chapter and topic open, by number, so they stay open after saving. */
  const keepOpen = useRef<{ chapter: number | null; topic: number | null }>({ chapter: null, topic: null });

  const load = useCallback(() => api.loadList().then((l) => { setList(l); setError(''); setLoadedAt(Date.now()); }, (e: Error) => setError(e.message)), [api]);
  useEffect(() => { void load(); }, [load]);

  const chapters = useMemo(() => list?.chapters ?? [], [list]);
  const group: ListGroup = pick ?? (chapters[0] ? { board: chapters[0].board, class: chapters[0].class, subject: chapters[0].subject } : FALLBACK);
  const count = (f: (c: AdminChapter) => boolean) => chapters.filter(f).length;
  const meta = (n: number) => (n ? plural(n, 'chapter') : undefined);
  const classesOn = (b: string) => [...new Set(chapters.filter((c) => c.board === b).map((c) => c.class))].sort((x, y) => x - y);
  const subjectsOn = (b: string, k: number) => [...new Set(chapters.filter((c) => c.board === b && c.class === k).map((c) => c.subject))].sort();

  const boardOptions: PickerOption[] = ALL_BOARDS.map((b) => { const n = count((c) => c.board === b.name); return { value: b.name, label: b.name, meta: meta(n), on: n > 0 }; });
  const classOptions: PickerOption[] = Array.from({ length: 12 }, (_, i) => i + 1)
    .map((k) => { const n = count((c) => c.board === group.board && c.class === k); return { value: String(k), label: `Class ${k}`, meta: meta(n), on: n > 0 }; });
  const subjectOptions: PickerOption[] = SUBJECTS.map((s) => s.name).sort((a, b) => a.localeCompare(b))
    .map((s) => { const n = count((c) => c.board === group.board && c.class === group.class && c.subject === s); return { value: s, label: s, meta: meta(n), on: n > 0 }; });

  /** Another board, class or subject: unsaved changes are dropped (the editor below starts again). A board or class with
   * chapters moves on to its first class and subject that has some. */
  const choose = (key: keyof ListGroup, value: string) => {
    const g = { ...group, [key]: key === 'class' ? Number(value) : value };
    if (key === 'board') { const ks = classesOn(g.board); if (ks.length && !ks.includes(g.class)) g.class = ks[0]; }
    if (key !== 'subject') { const ss = subjectsOn(g.board, g.class); if (ss.length && !ss.includes(g.subject)) g.subject = ss[0]; }
    keepOpen.current = { chapter: null, topic: null };
    setPick(g);
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-prose text-[14px] text-warm-secondary">
        Questions can only be written for a chapter on this list. Pick a board, class and subject, then open a chapter for its topics, and a topic for its
        questions. Changes stay marked here until you save them.
      </p>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Which chapters">
        <Picker label="Board" value={group.board} options={boardOptions} onPick={(v) => choose('board', v)} searchable />
        <Picker label="Class" value={String(group.class)} options={classOptions} onPick={(v) => choose('class', v)} />
        <Picker label="Subject" value={group.subject} options={subjectOptions} onPick={(v) => choose('subject', v)} searchable />
      </div>

      {error && <p className="rounded-2xl bg-destructive/10 px-4 py-3 text-[14px] text-foreground" role="alert">{error}</p>}
      {!list ? (error ? null : <Loading label="Loading the list of chapters" />) : (
        <GroupEditor key={`${group.board}|${group.class}|${group.subject}|${loadedAt}`} api={api} group={group} loaded={chaptersOf(chapters, group)} keepOpen={keepOpen}
          onSaved={async (n) => {
            toast(`Saved ${plural(n, 'change')}.`);
            await load();
            onChanged();
          }} />
      )}

      {list && list.log.length > 0 && (
        <section aria-labelledby="log-h" className="mt-4 flex flex-col gap-2">
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

/** What is being edited in place: a chapter's or topic's name or number (`at`: the chapter key, or chapter/topic key). */
type Editing = { at: string; what: 'name' | 'number'; value: string };

/** One board, class and subject: its draft, from the list as loaded. Remounted (so started again) for another one, and
 * after saving. */
function GroupEditor({ api, group, loaded, keepOpen, onSaved }: {
  api: GamesApi;
  group: ListGroup;
  loaded: AdminChapter[];
  keepOpen: { current: { chapter: number | null; topic: number | null } };
  onSaved: (changes: number) => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => draftOf(loaded));
  const [problem, setProblem] = useState<{ at: string; text: string } | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [newChapter, setNewChapter] = useState({ no: '', name: '' });
  const [bulk, setBulk] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [newTopic, setNewTopic] = useState<Record<string, { no: string; name: string }>>({});
  const [questions, setQuestions] = useState<Record<string, TopicQuestions | Error>>({});
  const [openChapter, setOpenChapter] = useState(() => draft.find((c) => c.chapter_no === keepOpen.current.chapter)?.key ?? '');
  const [openTopic, setOpenTopic] = useState(() => {
    const c = draft.find((x) => x.key === openChapter);
    const t = c?.topics.find((x) => x.topic_no === keepOpen.current.topic);
    return c && t ? `${c.key}/${t.key}` : '';
  });
  /** A topic closed because it was scrolled past: it closes at once, with no animation, so nothing on screen moves. */
  const [quiet, setQuiet] = useState('');
  const changes = changeCount(draft);
  const groupName = `${group.board} class ${group.class} ${group.subject}`;

  useEffect(() => {
    const c = draft.find((x) => x.key === openChapter);
    const t = c?.topics.find((x) => `${c.key}/${x.key}` === openTopic);
    keepOpen.current = { chapter: c?.chapter_no ?? null, topic: t?.topic_no ?? null };
  }, [draft, openChapter, openTopic, keepOpen]);

  // leaving the site with changes not saved asks first
  useEffect(() => {
    if (!changes) return;
    const stay = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', stay);
    return () => window.removeEventListener('beforeunload', stay);
  }, [changes]);

  /** Makes an edit to the draft; a refusal is shown where it was made (`at`). */
  const edit = (at: string, f: (d: DraftChapter[]) => DraftChapter[]) => {
    try {
      setDraft(f(draft));
      setProblem(null);
      setSaveError('');
      return true;
    } catch (e) {
      setProblem({ at, text: (e as Error).message });
      return false;
    }
  };
  const begin = (at: string, what: Editing['what'], value: string | number) => { setEditing({ at, what, value: String(value) }); setProblem(null); };
  const stopEditing = () => { setEditing(null); setProblem(null); };
  const finish = (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    const [ck, tk] = editing.at.split('/');
    const v = editing.value;
    const ok = edit(editing.at, (d) => {
      if (editing.what === 'name') return tk ? renameTopic(d, ck, tk, v) : renameChapter(d, ck, v);
      const no = /^\d+$/.test(v.trim()) ? Number(v) : NaN;
      return tk ? renumberTopic(d, ck, tk, no) : renumberChapter(d, ck, no);
    });
    if (ok) setEditing(null);
  };

  const save = async () => {
    setSaving(true);
    setSaveError('');
    try {
      const r = await api.saveChapters(toSave(group, loaded, draft));
      await onSaved(r.changes);
    } catch (e) {
      setSaveError((e as Error).message);
      setSaving(false);
    }
  };
  const revert = () => {
    setDraft(draftOf(loaded));
    stopEditing();
    setSaveError('');
  };

  const loadQuestions = useCallback((chapterId: string, topicNo: number | null) => {
    const k = `${chapterId}/${topicNo ?? '-'}`;
    api.topicQuestions(chapterId, topicNo).then(
      (r) => setQuestions((m) => ({ ...m, [k]: r })),
      (e: Error) => setQuestions((m) => ({ ...m, [k]: e })),
    );
  }, [api]);

  const closeScrolledPast = useCallback((el: HTMLElement, value: string) => {
    const before = el.getBoundingClientRect().height;
    flushSync(() => { setQuiet(value); setOpenTopic(''); });
    if (!ANCHORS) window.scrollBy(0, el.getBoundingClientRect().height - before);
  }, []);

  /** The inline editor, or null when this isn't being edited. */
  const editor = (at: string) => editing?.at === at && (
    <form className="flex flex-wrap items-center gap-2" onSubmit={finish}>
      <input aria-label={editing.what === 'name' ? 'New name' : 'New number'} autoFocus value={editing.value}
        inputMode={editing.what === 'number' ? 'numeric' : undefined} className={cn(SMALL, editing.what === 'number' ? 'w-20' : 'min-w-[200px] flex-1')}
        onChange={(e) => setEditing({ ...editing, value: e.target.value })} onKeyDown={(e) => { if (e.key === 'Escape') stopEditing(); }} />
      <button type="submit" className={chip('brand')} disabled={!editing.value.trim()}>Done</button>
      <button type="button" className={chip(at.includes('/') ? 'quiet' : 'card')} onClick={stopEditing}>Cancel</button>
    </form>
  );
  const problemAt = (at: string) => problem?.at === at && <p role="alert" className="text-[13px] font-semibold text-destructive">{problem.text}</p>;

  /** Rename, Number and Delete (or Keep, for one marked to be deleted). `on`: the surface they sit on. */
  const actions = (at: string, item: { name: string; questions: number; deleted: boolean }, no: number, onDelete: () => void, onKeep: () => void, on: 'muted' | 'card' = 'muted') => {
    const tone = on === 'card' ? 'quiet' : 'card';
    if (item.deleted) {
      return (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[13px] text-warm-secondary">Deleted when you save.</p>
          <button type="button" className={chip(tone)} onClick={onKeep}>Keep it</button>
        </div>
      );
    }
    const locked = item.questions > 0;
    return editor(at) || (
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" className={chip(tone)} onClick={() => begin(at, 'name', item.name)}>Rename</button>
        <button type="button" className={chip(tone)} disabled={locked} title={locked ? LOCKED : undefined} onClick={() => begin(at, 'number', no)}>Number</button>
        <button type="button" className={chip(tone, 'text-destructive')} disabled={locked} title={locked ? LOCKED : undefined} onClick={onDelete}>Delete</button>
      </div>
    );
  };

  const nextChapter = nextNumber(draft);
  const addOne = (e: FormEvent) => {
    e.preventDefault();
    const no = newChapter.no.trim() ? Number(newChapter.no) : nextChapter;
    const key = `new${Math.max(0, ...draft.filter((c) => !c.was).map((c) => Number(c.key.slice(3)))) + 1}`;
    if (edit('add-chapter', (d) => addChapter(d, no, newChapter.name))) {
      setNewChapter({ no: '', name: '' });
      setOpenChapter(key);
      setOpenTopic('');
    }
  };

  /** Bulk add: many chapters (and their topics) from lines of text, into the draft like any other edit. */
  const addBulk = (e: FormEvent) => {
    e.preventDefault();
    let added = { chapters: 0, topics: 0 };
    if (edit('bulk', (d) => { const r = addMany(d, bulk ?? ''); added = r; return r.draft; })) {
      setBulk(null);
      toast(`Added ${plural(added.chapters, 'chapter')}${added.topics ? ` and ${plural(added.topics, 'topic')}` : ''}. Save changes to keep them.`);
    }
  };

  /** The chatbot prompt for this subject's chapters, leaving out the ones in the list (saved or not). */
  const copyPrompt = async () => {
    if (!(await copyText(chapterListPrompt(group, draft.filter((c) => !c.deleted))))) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2500);
  };

  return (
    <section aria-label={`Chapters of ${groupName}`} className="flex flex-col gap-3">
      <p className="text-[13px] text-warm-meta tabular-nums">
        {plural(draft.filter((c) => !c.deleted).length, 'chapter')} · {plural(draft.reduce((n, c) => n + (c.deleted ? 0 : liveTopics(c).length), 0), 'topic')}
      </p>

      {draft.length === 0 ? (
        <Empty>No chapters for {groupName} yet. Add the first one below.</Empty>
      ) : (
        <Accordion.Root type="single" collapsible value={openChapter} onValueChange={(v) => { setOpenChapter(v); setOpenTopic(''); stopEditing(); }}
          className="flex flex-col gap-2">
          {draft.map((c) => {
            const ch = chapterChanged(c);
            const live = liveTopics(c);
            const tone = c.deleted ? 'gone' : ch.added ? 'new' : ch.renamed !== null || ch.renumbered !== null || ch.topics ? 'changed' : 'none';
            return (
              <Accordion.Item key={c.key} value={c.key} className={cn('rounded-[20px] bg-muted transition-[background-color,box-shadow,opacity] duration-150', TONE[tone])}>
                <Accordion.Header className="flex">
                  <Accordion.Trigger className="group flex min-h-14 w-full items-start gap-3 rounded-[20px] px-4 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-brand">
                    <span className="min-w-0 flex-1">
                      <span className={cn('block text-[15px] font-semibold text-foreground', c.deleted && 'text-warm-meta line-through')}>
                        <span className="tabular-nums">{c.chapter_no}.</span> {c.name}
                      </span>
                      <span className="mt-0.5 block text-[12px] text-warm-meta tabular-nums">
                        {plural(live.length, 'topic')} · {c.questions ? plural(c.questions, 'question') : 'no questions yet'}{c.was ? ` · ${c.was}` : ''}
                      </span>
                      <Tags>
                        {ch.added && <Tag tone="new">New</Tag>}
                        {ch.deleted && <Tag tone="gone">Deleted when you save</Tag>}
                        {ch.renamed !== null && <Tag tone="changed">Was "{ch.renamed}"</Tag>}
                        {ch.renumbered !== null && <Tag tone="changed">Was chapter {ch.renumbered}</Tag>}
                        {ch.topics && <Tag tone="changed">Topics {ch.topics}</Tag>}
                        {changedInside(c) && <Tag tone="changed">Topics changed</Tag>}
                      </Tags>
                    </span>
                    <ChevronDown aria-hidden className={`mt-1 size-5 shrink-0 text-warm-meta transition-transform duration-150 ${EASE} group-data-[state=open]:rotate-180`} />
                  </Accordion.Trigger>
                </Accordion.Header>
                <Accordion.Content className={OPEN_ANIM}>
                  <div className="flex animate-in flex-col gap-3 px-4 pb-4 duration-150 fade-in-0">
                    <div className="flex flex-col gap-2 border-t border-border pt-3">
                      {actions(c.key, c, c.chapter_no,
                        () => { if (edit(c.key, (d) => deleteChapter(d, c.key)) && !c.was) setOpenChapter(''); },
                        () => edit(c.key, (d) => keepChapter(d, c.key)))}
                      {problemAt(c.key)}
                    </div>

                    {!c.deleted && (
                      <>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-[13px] text-warm-secondary">
                            Topics: <b className="text-foreground">{isOpen(c) ? 'open' : 'fixed'}</b> {isOpen(c) ? '(writers add their own)' : '(questions go only under these)'}
                          </p>
                          <button type="button" className={chip('card')} disabled={isOpen(c) && !live.length}
                            title={isOpen(c) && !live.length ? 'Add its topics first, then fix them.' : undefined}
                            onClick={() => edit(`${c.key}/topics`, (d) => setOpen(d, c.key, !isOpen(c)))}>
                            {isOpen(c) ? 'Fix them' : 'Open them'}
                          </button>
                        </div>
                        {problemAt(`${c.key}/topics`)}

                        {(c.topics.length > 0 || c.untopiced > 0) && (
                          <Accordion.Root type="single" collapsible value={openTopic.startsWith(`${c.key}/`) ? openTopic : ''}
                            onValueChange={(v) => { setQuiet(''); setOpenTopic(v); stopEditing(); }} className="flex flex-col gap-1.5">
                            {c.topics.map((t) => {
                              const at = `${c.key}/${t.key}`;
                              const saved = c.was !== null && t.was !== null;
                              return (
                                <TopicItem key={t.key} value={at} open={openTopic === at} quiet={quiet === at} topic={t} onScrolledPast={closeScrolledPast}
                                  actions={<>
                                    {actions(at, t, t.topic_no, () => edit(at, (d) => deleteTopic(d, c.key, t.key)), () => edit(at, (d) => keepTopic(d, c.key, t.key)), 'card')}
                                    {problemAt(at)}
                                  </>}
                                  questions={<QuestionList count={saved ? t.questions : 0} got={saved ? questions[`${c.was}/${t.was}`] : undefined}
                                    load={() => loadQuestions(c.was!, t.was)} />} />
                              );
                            })}
                            {c.untopiced > 0 && (
                              <TopicItem value={`${c.key}/-`} open={openTopic === `${c.key}/-`} quiet={quiet === `${c.key}/-`} untopiced={c.untopiced} onScrolledPast={closeScrolledPast}
                                questions={<QuestionList count={c.untopiced} got={questions[`${c.was}/-`]} load={() => loadQuestions(c.was!, null)} />} />
                            )}
                          </Accordion.Root>
                        )}

                        <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => {
                          e.preventDefault();
                          const n = newTopic[c.key] ?? { no: '', name: '' };
                          const no = n.no.trim() ? Number(n.no) : nextNumber(c.topics);
                          if (edit(`${c.key}/add`, (d) => addTopic(d, c.key, no, n.name))) setNewTopic((m) => ({ ...m, [c.key]: { no: '', name: '' } }));
                        }}>
                          <input aria-label={`Number of the new topic of chapter ${c.chapter_no}`} inputMode="numeric" className={cn(SMALL, 'w-16')}
                            placeholder={String(nextNumber(c.topics))} value={newTopic[c.key]?.no ?? ''}
                            onChange={(e) => setNewTopic((m) => ({ ...m, [c.key]: { name: m[c.key]?.name ?? '', no: e.target.value } }))} />
                          <input aria-label={`Name of the new topic of chapter ${c.chapter_no}`} className={cn(SMALL, 'min-w-[180px] flex-1')} placeholder="Add a topic"
                            value={newTopic[c.key]?.name ?? ''} onChange={(e) => setNewTopic((m) => ({ ...m, [c.key]: { no: m[c.key]?.no ?? '', name: e.target.value } }))} />
                          <button type="submit" className={chip('card')} disabled={!newTopic[c.key]?.name?.trim()}><Plus aria-hidden /> Add topic</button>
                        </form>
                        {problemAt(`${c.key}/add`)}
                      </>
                    )}
                  </div>
                </Accordion.Content>
              </Accordion.Item>
            );
          })}
        </Accordion.Root>
      )}

      <form className="flex flex-wrap items-center gap-2 rounded-[20px] bg-muted px-4 py-3" onSubmit={addOne}>
        <span className="text-[13px] font-semibold text-warm-secondary">Add a chapter to {groupName}:</span>
        <input aria-label="Number of the new chapter" inputMode="numeric" className={cn(SMALL, 'w-16')} placeholder={String(nextChapter)}
          value={newChapter.no} onChange={(e) => setNewChapter((n) => ({ ...n, no: e.target.value }))} />
        <input aria-label="Name of the new chapter" className={cn(SMALL, 'min-w-[200px] flex-1')} placeholder="Chapter name"
          value={newChapter.name} onChange={(e) => setNewChapter((n) => ({ ...n, name: e.target.value }))} />
        <button type="submit" className={chip('card')} disabled={!newChapter.name.trim()}><Plus aria-hidden /> Add chapter</button>
        <button type="button" className={chip('card')} aria-expanded={bulk !== null} aria-controls="bulk-add"
          onClick={() => { setBulk((b) => (b === null ? '' : null)); setProblem(null); }}><ListPlus aria-hidden /> Bulk add</button>
        {problem?.at === 'add-chapter' && <div className="basis-full">{problemAt('add-chapter')}</div>}
      </form>

      {bulk !== null && (
        <form id="bulk-add" className="flex animate-in flex-col gap-2 rounded-[20px] bg-muted px-4 py-3 duration-150 fade-in-0 slide-in-from-top-1" onSubmit={addBulk}>
          <label htmlFor="bulk-text" className="text-[13px] font-semibold text-warm-secondary">Add many chapters to {groupName}</label>
          <ul id="bulk-how" className="flex list-disc flex-col gap-0.5 pl-5 text-[13px] text-warm-secondary marker:text-warm-meta">
            <li>One chapter per line, like <b className="text-foreground">4. Heat</b>. The number is optional.</li>
            <li>A line starting with <b className="text-foreground">-</b> under a chapter adds a topic to it.</li>
            <li>Or copy the chatbot prompt, paste it into ChatGPT, Gemini or Claude, and paste its reply here.</li>
          </ul>
          <textarea id="bulk-text" aria-describedby="bulk-how" rows={7} autoFocus value={bulk} spellCheck={false}
            placeholder={'Force\nWork, Energy and Power\n- Work\n- Energy\n- Power\n12. Sound'}
            onChange={(e) => { setBulk(e.target.value); if (problem?.at === 'bulk') setProblem(null); }}
            onKeyDown={(e) => { if (e.key === 'Escape') { setBulk(null); setProblem(null); } }}
            className={cn(FIELD, 'min-h-[150px] py-2 font-mono text-[14px] sm:text-[14px]')} />
          {problemAt('bulk')}
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={chip('brand')} disabled={!bulk.trim()}><Plus aria-hidden /> Add to the list</button>
            <button type="button" className={chip('card')} onClick={() => void copyPrompt()}>
              {copied ? <><Check aria-hidden /> Copied</> : <><Copy aria-hidden /> Copy chatbot prompt</>}
            </button>
            <button type="button" className={chip('card')} onClick={() => { setBulk(null); setProblem(null); }}>Cancel</button>
          </div>
        </form>
      )}

      {changes > 0 && (
        <div className="sticky bottom-4 z-30 mt-1 animate-in fade-in-0 slide-in-from-bottom-2 duration-150">
          <div role="region" aria-label="Changes not saved yet"
            className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[28px] bg-panel px-4 py-3 text-background shadow-[0_18px_44px_rgba(0,0,0,.28)] sm:px-5">
            <div className="min-w-[180px] flex-1">
              <p className="text-[14px] font-semibold tabular-nums">{plural(changes, 'change')} not saved yet</p>
              <p className="text-[12px] opacity-70">Picking another board, class or subject drops them.</p>
              {saveError && <p role="alert" className="mt-1 text-[13px] font-semibold text-brand">{saveError}</p>}
            </div>
            <button type="button" className={btn('quiet')} disabled={saving} onClick={revert}>Revert changes</button>
            <button type="button" className={btn('brand')} disabled={saving} onClick={() => void save()}>{saving ? 'Saving' : 'Save changes'}</button>
          </div>
        </div>
      )}
    </section>
  );
}

/** How a changed chapter or topic is marked in the list. */
const TONE = {
  none: '',
  changed: 'bg-brand-subtle ring-1 ring-brand/40',
  new: 'bg-mint ring-1 ring-border',
  gone: 'opacity-70',
} as const;
const TAG = {
  changed: 'bg-brand-subtle text-brand-deep ring-1 ring-brand/30',
  new: 'bg-mint text-foreground ring-1 ring-border',
  gone: 'bg-destructive/10 text-destructive',
} as const;
const Tags = ({ children }: { children: ReactNode }) => <span className="mt-1.5 flex flex-wrap gap-1.5 empty:hidden">{children}</span>;
const Tag = ({ tone, children }: { tone: keyof typeof TAG; children: ReactNode }) => (
  <span className={cn('inline-flex min-h-6 max-w-full items-center rounded-full px-2 text-[12px] font-semibold', TAG[tone])}><span className="truncate">{children}</span></span>
);

/** A topic: opens to its actions and first questions, and closes when scrolled past. */
function TopicItem({ value, open, quiet, topic, untopiced, actions, questions, onScrolledPast }: {
  value: string;
  open: boolean;
  quiet: boolean;
  topic?: DraftTopic;
  /** For the row of a chapter's questions under no topic. */
  untopiced?: number;
  actions?: ReactNode;
  questions: ReactNode;
  onScrolledPast: (el: HTMLElement, value: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const ch = topic ? topicChanged(topic) : null;
  const tone = !topic || !ch ? 'none' : topic.deleted ? 'gone' : ch.added ? 'new' : ch.renamed !== null || ch.renumbered !== null ? 'changed' : 'none';

  // scrolled past (its bottom above the top of the screen): it closes
  useEffect(() => {
    const el = ref.current;
    if (!open || !el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting && e.boundingClientRect.bottom <= (e.rootBounds?.top ?? 0)) onScrolledPast(el, value);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [open, value, onScrolledPast]);

  return (
    <Accordion.Item ref={ref} value={value} className={cn('rounded-[14px] bg-card transition-[background-color,box-shadow,opacity] duration-150', TONE[tone])}>
      <Accordion.Header className="flex">
        <Accordion.Trigger className="group flex min-h-12 w-full items-start gap-2 rounded-[14px] px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-brand">
          <span className="min-w-0 flex-1">
            <span className={cn('block text-[14px] text-foreground', topic?.deleted && 'text-warm-meta line-through')}>
              {topic ? <><span className="tabular-nums">Topic {topic.topic_no}:</span> {topic.name}</> : <span className="text-warm-secondary">Under no topic</span>}
              <span className="text-warm-meta tabular-nums"> · {plural(topic ? topic.questions : untopiced ?? 0, 'question')}</span>
            </span>
            {ch && (
              <Tags>
                {ch.added && <Tag tone="new">New</Tag>}
                {ch.deleted && <Tag tone="gone">Deleted when you save</Tag>}
                {ch.renamed !== null && <Tag tone="changed">Was "{ch.renamed}"</Tag>}
                {ch.renumbered !== null && <Tag tone="changed">Was topic {ch.renumbered}</Tag>}
              </Tags>
            )}
          </span>
          <ChevronDown aria-hidden className={`mt-0.5 size-4 shrink-0 text-warm-meta transition-transform duration-150 ${EASE} group-data-[state=open]:rotate-180`} />
        </Accordion.Trigger>
      </Accordion.Header>
      <Accordion.Content className={cn(OPEN_ANIM, quiet && 'data-[state=closed]:animate-none')}>
        <div className="flex animate-in flex-col gap-2.5 px-3 pb-3 duration-150 fade-in-0">
          {actions && <div className="flex flex-col gap-2 border-t border-border pt-2.5">{actions}</div>}
          {questions}
        </div>
      </Accordion.Content>
    </Accordion.Item>
  );
}

const STATUS: Record<Status, { label: string; tone: string }> = {
  pending: { label: 'Waiting', tone: 'bg-brand-subtle text-brand-deep' },
  approved: { label: 'Approved', tone: 'bg-mint text-foreground' },
  rejected: { label: 'Sent back', tone: 'bg-destructive/10 text-destructive' },
};

/** A topic's first questions, five at a time up to 20. Loaded when it first opens (and kept while the page is). */
function QuestionList({ count, got, load }: { count: number; got: TopicQuestions | Error | undefined; load: () => void }) {
  const [shown, setShown] = useState(FIRST_SHOWN);
  const asked = useRef(false);
  useEffect(() => {
    if (count && !got && !asked.current) { asked.current = true; load(); }
  }, [count, got, load]);

  if (!count) return <p className="text-[13px] text-warm-meta">No questions yet.</p>;
  if (got instanceof Error) {
    return (
      <p className="text-[13px] text-foreground" role="alert">
        {got.message}{' '}
        <button type="button" className="font-semibold text-brand-blue underline-offset-2 hover:underline" onClick={() => { asked.current = false; load(); }}>Try again</button>
      </p>
    );
  }
  if (!got) {
    return (
      <div className="flex flex-col gap-1.5" aria-busy aria-label="Loading questions">
        {Array.from({ length: Math.min(count, 3) }, (_, i) => <div key={i} className="h-14 animate-pulse rounded-[12px] bg-muted" />)}
      </div>
    );
  }
  const most = Math.min(got.questions.length, TOPIC_QUESTIONS_MAX);
  return (
    <div className="flex flex-col gap-1.5">
      <ol className="flex flex-col gap-1.5" aria-label="Questions">
        {got.questions.slice(0, shown).map((q, i) => (
          <li key={q.question_id} className="flex animate-in flex-col gap-0.5 rounded-[12px] bg-muted px-3 py-2 fade-in-0 slide-in-from-top-1 duration-150"
            style={{ animationDelay: `${Math.min(Math.max(0, i - (shown - FIRST_SHOWN)), 5) * 20}ms`, animationFillMode: 'both' }}>
            <span className="flex items-start gap-2">
              <span className="min-w-0 flex-1 text-[14px] text-foreground">{q.question}</span>
              <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[12px] font-semibold', STATUS[q.status].tone)}>{STATUS[q.status].label}</span>
            </span>
            <span className="text-[13px] text-warm-secondary">
              <span className="font-semibold text-foreground">A:</span> {q.answer} <span className="text-warm-meta tabular-nums">· {q.question_id}</span>
            </span>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        {shown < most && (
          <button type="button" className={chip('quiet')} onClick={() => setShown((n) => Math.min(most, n + FIRST_SHOWN))}>
            Show {Math.min(FIRST_SHOWN, most - shown)} more
          </button>
        )}
        <p className="text-[12px] text-warm-meta tabular-nums">
          {shown >= most && got.total > most ? `Showing ${most} of ${got.total}. The rest are on Approve questions.` : `${Math.min(shown, most)} of ${got.total}`}
        </p>
      </div>
    </div>
  );
}
