import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Check, Copy, Plus, Send } from 'lucide-react';
import type { GamesApi, SendResult } from '@/lib/games/api';
import { isOpen } from '@/lib/games/catalog';
import { usableIn } from '@/lib/games/engine';
import { blockOf, checkPlace, checkTopics, EXAMPLE, leftAfterSend, read, toRows, visibleIssues, type Draft, type Issue, type Where } from '@/lib/games/format';
import { NO_PLACE, options, placeOf, whereOf, type Place } from '@/lib/games/place';
import { chatbotPrompt, fixPrompt } from '@/lib/games/prompt';
import type { ListChapter, SentBack } from '@/lib/games/rows';
import { cn } from '@/lib/utils';
import { GamePreview } from './GamePreview';
import { Guide } from './Guide';
import { btn, chip, copyText, GAME_NAMES, LINKISH, offerUndo, plural } from './helpers';
import { Picker } from './Picker';
import { QuestionList, type ListFilter } from './QuestionList';
import { QuestionsBox } from './QuestionsBox';
import { SentBackPanel, type Alerts } from './SentBack';
import { ActionIcon } from './shared';
import './games.css';

/* Write questions, in four steps: choose the chapter (board, class, subject, chapter: dropdowns of the list, so nothing
   is typed), get questions from a chatbot with a prompt made for that chapter (or write them), paste them into the box,
   and send. The chatbot divides the chapter into topics itself, as many as it needs, with a "Topic: Name" line above
   each topic's questions; the page numbers new topics, and a chapter whose topics the list fixes takes only those.
   Beside the box, in a column of its own, every question shows under its topic as it will be sent: ready, or what to
   fix. "Send" sends the ready ones; those that need fixing stay in the box, and a prompt to fix them is one
   click away. Questions sent back by an HoD show at the top, with why, and "Fix it" puts one back in the box. The
   example's questions are never sent while the example is loaded. */

export type { Alerts };
/** The fixed list of chapters, with their topics (no list while loading). */
export interface Catalog { list?: ListChapter[]; error?: string }

const SECTION = 'flex flex-col gap-4 rounded-[24px] bg-muted p-4 sm:p-6';
/** The example's questions, which are never sent while the example is loaded. */
const EXAMPLE_QUESTIONS = new Set(read(EXAMPLE).drafts.map((d) => d.question.toLowerCase()));
const motion = (): ScrollBehavior => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');
/** Where the preview puts questions before anything is chosen. */
const SOMEWHERE: Where = { chapter_id: 'DRAFT', board: '', class: 1, subject: '', chapter_no: 1, chapter: 'Your questions' };

/** The place chosen last time, kept on this device only (a convenience: it starts empty when it can't be read). */
const KEEP = 'shikshaq:games:write-place';
function keptPlace(): Place {
  try {
    const v = JSON.parse(localStorage.getItem(KEEP) ?? 'null');
    return v && typeof v === 'object' ? { board: String(v.board ?? ''), cls: String(v.cls ?? ''), subject: String(v.subject ?? ''), chapter: String(v.chapter ?? '') } : NO_PLACE;
  } catch {
    return NO_PLACE;
  }
}

/** Everything the page knows about the box: the questions, their topics, every problem, and which can be sent. */
function analyse(raw: string, where: Where | null, chapter: ListChapter | undefined, example: boolean) {
  const { drafts, headers, issues } = read(raw);
  const placeIssues = checkPlace(headers, where);
  // the topics can only be worked out once the chapter is chosen
  const t = chapter ? checkTopics(drafts, chapter) : { issues: [], topics: drafts.map(() => null) };
  const all = [...issues, ...placeIssues, ...t.issues].sort((a, b) => a.line - b.line);
  const fromExample = (d: Draft) => example && EXAMPLE_QUESTIONS.has(d.question.toLowerCase());
  const blocked = new Set(all.flatMap((x) => (x.q === undefined ? [] : [x.q])));
  // a line naming another chapter holds back every question: they might be meant for somewhere else
  const readyAt = where && chapter && !placeIssues.length ? drafts.map((_, i) => i).filter((i) => !blocked.has(i) && !fromExample(drafts[i])) : [];
  return { drafts, all, placeIssues, blocked, readyAt, topics: t.topics, fromExample };
}

function Step({ n, title, note, done, children, className }: { n: number; title: string; note?: string; done?: boolean; children: ReactNode; className?: string }) {
  return (
    <section aria-labelledby={`step-${n}`} className={cn(SECTION, className)}>
      <div className="flex items-start gap-3">
        <span aria-hidden className={cn('inline-flex size-7 shrink-0 items-center justify-center rounded-full text-[13px] font-bold transition-colors duration-200', done ? 'bg-mint text-foreground' : 'bg-panel text-background')}>
          {done ? <Check className="size-4" /> : n}
        </span>
        <div className="min-w-0">
          <h2 id={`step-${n}`} className="text-[15px] font-bold leading-7 text-foreground">{n}. {title}</h2>
          {note && <p className="text-[13px] text-warm-secondary">{note}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function Field({ id, label, children, className }: { id: string; label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      <label htmlFor={id} className="text-[12px] font-semibold text-warm-secondary">{label}</label>
      {children}
    </div>
  );
}

export function WriteQuestions({ api, canApprove, alerts, onSeen, onRetryAlerts, onSent, catalog, onRetryCatalog }: {
  api: GamesApi;
  /** An HoD or admin, who can open Approve questions. */
  canApprove: boolean;
  /** Questions sent back to this person (no list while loading). */
  alerts: Alerts;
  /** These sent-back questions were shown: they are now seen. */
  onSeen: (ids: string[]) => void;
  onRetryAlerts: () => void;
  /** Questions were sent: the counts elsewhere on the page go up, and the list of topics may have grown. */
  onSent: () => void;
  /** Questions can only be sent for a chapter and topic on this list. */
  catalog: Catalog;
  onRetryCatalog: () => void;
}) {
  const [raw, setRaw] = useState('');
  const [place, setPlaceNow] = useState<Place>(keptPlace);
  const setPlace = (p: Place) => {
    setPlaceNow(p);
    try { localStorage.setItem(KEEP, JSON.stringify(p)); } catch { /* kept for this visit only */ }
  };
  /** "Try an example" was pressed and its text is still here: its questions aren't sent. */
  const [example, setExample] = useState(false);
  useEffect(() => { if (!raw.trim()) setExample(false); }, [raw]);
  const [caret, setCaret] = useState(0);
  /** The line being typed on: problems there wait until the cursor moves on. */
  const [typing, setTyping] = useState<number | null>(null);
  const [sent, setSent] = useState<SendResult | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [done, setDone] = useState('');
  const [backOpen, setBackOpen] = useState(false);
  const [backFocus, setBackFocus] = useState<string[]>([]);
  const [filter, setFilter] = useState<ListFilter>('all');
  const [preview, setPreview] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const backPanel = useRef<HTMLElement>(null);

  const list = useMemo(() => catalog.list ?? [], [catalog.list]);
  const opts = useMemo(() => options(list, place), [list, place]);
  const { where, chapter: ch, todo } = useMemo(() => whereOf(list, place), [list, place]);

  const text = useDeferredValue(raw);
  const a = useMemo(() => analyse(text, where, ch, example), [text, where, ch, example]);
  const { drafts, all, placeIssues, blocked, topics } = a;
  const shown = visibleIssues(all, typing, drafts);
  const problems = useMemo(() => {
    const m = new Map<number, Issue[]>();
    for (const x of shown) if (x.q !== undefined) m.set(x.q, [...(m.get(x.q) ?? []), x]);
    return m;
  }, [shown]);
  const other = shown.filter((x) => x.q === undefined);
  const ready = a.readyAt.length;
  const toFix = drafts.filter((_, i) => blocked.has(i)).length;
  const strays = all.filter((x) => x.q === undefined).length;
  const examples = drafts.filter(a.fromExample).length;

  const moveCaret = (line: number) => { setCaret(line); setTyping((t) => (t === line ? t : null)); };
  const typedOn = (line: number | null) => { if (line !== null) setCaret(line); setTyping(line); };
  const flash = (what: string) => {
    setDone(what);
    setTimeout(() => setDone((c) => (c === what ? '' : c)), 1800);
  };
  const copy = async (what: string, value: string) => { if (await copyText(value)) flash(what); };

  // the text lives only on this page: closing or reloading it with questions not yet sent asks first
  const unsaved = drafts.some((d) => !a.fromExample(d));
  useEffect(() => {
    if (!unsaved) return;
    const ask = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    addEventListener('beforeunload', ask);
    return () => removeEventListener('beforeunload', ask);
  }, [unsaved]);

  /** Replacing all the text can always be undone for a few seconds, so there is no "are you sure?". */
  const replaceAll = (next: string, what: string, isExample = false) => {
    const before = raw;
    const wasExample = example;
    if (before.trim() && before !== next) offerUndo(what, () => { setRaw(before); setExample(wasExample); box.current?.focus({ preventScroll: true }); });
    setRaw(next);
    setExample(isExample);
  };

  /** Selects a line of the box, so a problem can be fixed in place. */
  const goTo = (line: number) => {
    const ta = box.current;
    if (!ta) return;
    const lines = ta.value.split('\n');
    const start = lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0);
    ta.scrollIntoView({ behavior: motion(), block: 'center' });
    ta.focus({ preventScroll: true });
    ta.setSelectionRange(start, start + (lines[line - 1]?.length ?? 0));
    ta.scrollTop = Math.max(0, (line - 3) * (parseFloat(getComputedStyle(ta).lineHeight) || 24));
    moveCaret(line);
  };

  /** Sends the ready questions. They leave the box (with Topic lines left with nothing under them); what needs fixing
   * stays, to fix and send next. */
  const send = async () => {
    if (!where || !ch) return;
    const now = analyse(raw, where, ch, example);
    if (!now.readyAt.length) return;
    const these = now.readyAt.map((i) => now.drafts[i]);
    setSending(true);
    setSent(null);
    setSendError('');
    try {
      const result = await api.sendBatch(toRows(these, where, now.readyAt.map((i) => now.topics[i])));
      setSent(result);
      setRaw(leftAfterSend(raw, these));
      if (result.sent) { flash('send'); onSent(); }
    } catch (e) {
      setSendError((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  /** "Fix it" on a sent-back question: its chapter is chosen, and it goes in the box under its Topic line (Undo brings
   * the old text back). */
  const fix = (q: SentBack) => {
    setPlace(placeOf(list, q));
    replaceAll(`${q.topic ? `Topic: ${q.topic}\n\n` : ''}${blockOf(q)}\n`, 'Question loaded');
    setSent(null);
    box.current?.scrollIntoView({ behavior: motion(), block: 'center' });
    box.current?.focus({ preventScroll: true });
  };
  /** "See why" after a send: opens the sent-back list at these questions. */
  const seeWhy = (ids: string[]) => {
    setBackOpen(true);
    setBackFocus(ids);
    requestAnimationFrame(() => {
      backPanel.current?.scrollIntoView({ behavior: motion(), block: 'start' });
      backPanel.current?.focus({ preventScroll: true });
    });
  };

  const games = (d: Draft) => usableIn({ id: String(d.line), question: d.question, answer: d.answer, also: d.also, fill: d.fill, wrong: d.wrong }).map((t) => GAME_NAMES[t]);
  const pick = (patch: Partial<Place>) => setPlace({ ...opts.place, ...patch });
  /** A topic button: its Topic line goes in the box above the line the cursor is on, with the cursor after it. */
  const putTopic = (name: string) => {
    const lines = raw.split('\n');
    const at = raw.trim() ? Math.min(Math.max(caret - 1, 0), lines.length) : 0;
    const next = raw.trim() ? [...lines.slice(0, at), `Topic: ${name}`, '', ...lines.slice(at)].join('\n') : `Topic: ${name}\n\n`;
    setRaw(next);
    const pos = next.split('\n').slice(0, at + 2).join('\n').length + 1;
    requestAnimationFrame(() => {
      const ta = box.current;
      if (!ta) return;
      ta.focus({ preventScroll: true });
      ta.setSelectionRange(pos, pos);
      moveCaret(at + 3);
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <SentBackPanel panelRef={backPanel} alerts={alerts} open={backOpen} setOpen={setBackOpen} focus={backFocus} onSeen={onSeen} onRetry={onRetryAlerts} onFix={fix} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
        <div className="flex min-w-0 flex-col gap-4">
          <Step n={1} title="Choose the chapter" done={!!where}>
            {!catalog.list ? (
              catalog.error ? (
                <p className="rounded-2xl bg-destructive/10 px-4 py-3 text-[14px] text-foreground" role="alert">
                  <b>Couldn't load the list of chapters.</b> {catalog.error}{' '}
                  <button type="button" className={LINKISH} onClick={onRetryCatalog}>Try again</button>
                </p>
              ) : <div className="h-28 animate-pulse rounded-2xl bg-card" role="status" aria-label="Loading the list of chapters" />
            ) : !list.length ? (
              <p className="text-[14px] text-warm-secondary">The list of chapters is empty, so questions can't be written yet. Ask a games admin to add chapters.</p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <Field id="p-board" label="Board">
                    <Picker id="p-board" look="field" label="Board" value={opts.place.board} placeholder="Choose"
                      options={opts.boards.map((b) => ({ value: b, label: b }))} onPick={(v) => setPlace({ ...NO_PLACE, board: v })} />
                  </Field>
                  <Field id="p-class" label="Class">
                    <Picker id="p-class" look="field" label="Class" value={opts.place.cls} placeholder="Choose" disabled={!opts.classes.length}
                      options={opts.classes.map((c) => ({ value: String(c), label: String(c) }))} onPick={(v) => pick({ cls: v, subject: '', chapter: '' })} />
                  </Field>
                  <Field id="p-subject" label="Subject" className="col-span-2 sm:col-span-1">
                    <Picker id="p-subject" look="field" label="Subject" value={opts.place.subject} placeholder="Choose" disabled={!opts.subjects.length}
                      options={opts.subjects.map((s) => ({ value: s, label: s }))} onPick={(v) => pick({ subject: v, chapter: '' })} />
                  </Field>
                  <Field id="p-chapter" label="Chapter" className="col-span-full">
                    <Picker id="p-chapter" look="field" label="Chapter" value={opts.place.chapter} placeholder="Choose" disabled={!opts.chapters.length}
                      options={opts.chapters.map((c) => ({ value: c.chapter_id, label: `${c.chapter_no}: ${c.name}` }))} onPick={(v) => pick({ chapter: v })} />
                  </Field>
                </div>
                <p className={cn('rounded-2xl px-4 py-3 text-[14px]', where ? 'bg-mint text-foreground' : 'bg-card text-warm-secondary')} role="status" aria-live="polite">
                  {where ? <>Questions go to <b>{where.board}, class {where.class}, {where.subject}</b>, chapter {where.chapter_no}: <b>{where.chapter}</b>.</> : todo}
                </p>
                {ch && (
                  <div className="flex flex-col gap-2 text-[13px] text-warm-secondary">
                    <p>
                      {!isOpen(ch) ? <><b className="text-foreground">Its topics are fixed.</b> Each question goes under one of these Topic lines:</>
                        : ch.topics.length ? <><b className="text-foreground">Topics already in use.</b> The chatbot keeps these, and adds as many new ones as the chapter needs:</>
                        : <><b className="text-foreground">No topics yet.</b> The chatbot divides the chapter into topics itself, as many as it needs.</>}
                    </p>
                    {ch.topics.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {ch.topics.map((t) => (
                          <button key={t.topic_id} type="button" className={chip('card')} title="Put this Topic line in the box, above the cursor" onClick={() => putTopic(t.name)}>
                            <Plus aria-hidden /> Topic: {t.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </Step>

          <Step n={2} title="Get questions from a chatbot" note="Optional: you can also write them yourself in step 3.">
            <ol className="flex list-decimal flex-col gap-1 pl-5 text-[14px] text-warm-prose">
              <li>Copy the prompt. It is made for the chapter you chose; the chatbot decides its topics.</li>
              <li>Paste it into ChatGPT, Gemini or Claude, and add your notes or the textbook pages under it.</li>
              <li>Copy its answer (the box of questions, with the Copy button on it) and paste it into step 3.</li>
            </ol>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <button type="button" className={btn('dark', 'w-fit')} disabled={!where} onClick={() => ch && void copy('prompt', chatbotPrompt(ch))}>
                <ActionIcon done={done === 'prompt'}><Copy /></ActionIcon>Copy chatbot prompt
              </button>
              <span className="text-[13px] text-warm-secondary" aria-live="polite">{done === 'prompt' ? 'Copied.' : !where ? 'Choose the chapter in step 1 first.' : ''}</span>
            </div>
          </Step>

          <Step n={3} title="Paste or write the questions">
            <QuestionsBox value={raw} onChange={setRaw} onPaste={(whole) => { if (whole) setExample(false); }} onTyping={typedOn} issues={shown} boxRef={box} caret={caret} setCaret={moveCaret} />
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className={btn('card')} onClick={() => replaceAll(EXAMPLE, 'Example loaded', true)}>Try an example</button>
              <button type="button" className={btn('card')} onClick={() => replaceAll('', 'Cleared')} disabled={!raw}>Clear</button>
              <a href="#guide" className={cn(LINKISH, 'ml-1 text-[14px]')}>How to write a question</a>
            </div>
          </Step>
        </div>

        <QuestionList drafts={drafts} topics={topics} problems={problems} blocked={blocked} other={other} games={games} fromExample={a.fromExample} onGoTo={goTo}
          filter={filter} setFilter={setFilter}
          className="max-h-[75vh] lg:sticky lg:top-[88px] lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:max-h-[calc(100dvh-104px)]" />

        <Step n={4} title="Send for approval" className="lg:col-start-1">
          {examples > 0 && (
            <p className="rounded-2xl bg-brand-subtle px-4 py-3 text-[14px] text-foreground" role="status">
              {examples === drafts.length ? "The example's questions are only for trying the page, so they aren't sent." : `${plural(examples, 'question is', 'questions are')} from the example, so ${examples === 1 ? "it isn't" : "they aren't"} sent.`}
            </p>
          )}
          {placeIssues.length > 0 && (
            <p className="rounded-2xl bg-destructive/10 px-4 py-3 text-[14px] text-foreground" role="alert">
              <b>A line in the box names another chapter,</b> so nothing is sent until it is fixed. Remove it (it is marked red), or choose the right chapter in step 1.
            </p>
          )}
          <p className="text-[14px] text-foreground" aria-live="polite">
            {!where ? 'Choose the chapter in step 1 first.'
              : !drafts.length ? 'Nothing to send yet.'
              : <><b>{ready}</b> ready to send{toFix > 0 && <>, <b className="text-destructive">{toFix}</b> to fix</>}{strays > 0 && <>, and {plural(strays, 'line')} that {strays === 1 ? "isn't a question" : "aren't questions"}</>}.</>}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btn('brand')} disabled={!ready || sending} onClick={() => void send()}>
              <ActionIcon done={done === 'send'}><Send /></ActionIcon>
              {sending ? 'Sending…' : !ready ? 'Send' : toFix || strays ? `Send the ${plural(ready, 'ready question')}` : `Send ${plural(ready, 'question')}`}
            </button>
            {(toFix > 0 || strays > 0) && (
              <button type="button" className={btn('dark')} onClick={() => { const now = analyse(raw, where, ch, example); void copy('fix', fixPrompt(raw, now.drafts, now.all)); }}>
                <ActionIcon done={done === 'fix'}><Copy /></ActionIcon>Copy a prompt to fix {toFix ? `the ${toFix}` : 'them'}
              </button>
            )}
          </div>
          {(toFix > 0 || strays > 0) && (
            <p className="text-[13px] text-warm-secondary" aria-live="polite">
              {done === 'fix'
                ? 'Copied. Paste it into the same chat, then paste the whole answer over the text in step 3.'
                : ready > 0 ? 'Sending keeps the ones to fix in the box, so you can fix them and send them next.' : 'Fix them in the box, or copy a prompt that asks the chatbot to fix them.'}
            </p>
          )}
          {sent && (
            <p className={cn('animate-fade-slide-up rounded-2xl px-4 py-3 text-[14px] text-foreground', sent.sent ? 'bg-mint' : 'bg-brand-subtle')} role="status">
              {sent.sent ? <>Sent {plural(sent.sent, 'question')} for approval. </> : 'Nothing new was sent. '}
              {sent.already > 0 && <>{plural(sent.already, 'question was', 'questions were')} already sent before, so {sent.already === 1 ? 'it was' : 'they were'} skipped. </>}
              {sent.sentBack > 0 && <>{plural(sent.sentBack, 'question was', 'questions were')} sent back to you before and {sent.sentBack === 1 ? "hasn't" : "haven't"} changed, so {sent.sentBack === 1 ? "it wasn't" : "they weren't"} sent again. <button type="button" className={LINKISH} onClick={() => seeWhy(sent.sentBackIds)}>See why</button> </>}
              {canApprove && sent.sent > 0 && <Link className={LINKISH} to="/games/approve">Open Approve questions</Link>}
            </p>
          )}
          {sendError && <p className="rounded-2xl bg-destructive/10 px-4 py-3 text-[14px] text-foreground" role="alert">Couldn't send: {sendError}</p>}
        </Step>
      </div>

      <section aria-labelledby="preview-h" className="flex flex-col gap-3 rounded-[24px] bg-card p-4 shadow-border sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 id="preview-h" className="text-[15px] font-bold text-foreground">See how they play</h2>
            <p className="text-[13px] text-warm-secondary">The games made from the ready questions, as students will get them. Nothing here is saved.</p>
          </div>
          <button type="button" className={btn('quiet')} aria-expanded={preview} onClick={() => setPreview((p) => !p)}>{preview ? 'Hide the games' : 'Show the games'}</button>
        </div>
        {preview && <GamePreview rows={toRows(drafts.filter((_, i) => !blocked.has(i)), where ?? SOMEWHERE, topics.filter((_, i) => !blocked.has(i)))} />}
      </section>

      <div className="mt-4"><Guide /></div>
    </div>
  );
}
