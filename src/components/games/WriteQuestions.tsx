import { Fragment, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, Copy, Download, Send } from 'lucide-react';
import type { GamesApi, SendResult } from '@/lib/games/api';
import { checkBoard, checkClass, checkDetail, checkSubject, DETAIL_KEYS, detailLine, detailsId, LABEL, parseNumbered, readDetails, standardDetail, writeDetail, type DetailKey } from '@/lib/games/details';
import { chaptersFor, checkList, sameName } from '@/lib/games/catalog';
import { asText, baseName, EXAMPLE, format, lineLevels, missing, visibleIssues, type Issue } from '@/lib/games/format';
import { chatbotPrompt, listedMaterial } from '@/lib/games/prompt';
import { COLUMNS, toCSV, toJSON, toTSV, type ListChapter, type ListTopic, type Row, type SentBack } from '@/lib/games/rows';
import { cn } from '@/lib/utils';
import { GamePreview } from './GamePreview';
import { Guide } from './Guide';
import { btn, chip, copyText, day, download, FIELD, LINKISH, offerUndo, plural } from './helpers';
import { ActionIcon, RowsTable } from './shared';
import './games.css';

/* Write questions: people on the games team write questions in one format (Question | Answer, under detail and Topic
   lines; other common layouts are read too, quietly), check them, see a game made from them, and send them for
   approval or download them. The example's questions can't be sent while the example is loaded. Questions sent back
   by an HoD show at the top, with the reason, and can be put back in the box to fix. */

const HINT: Record<DetailKey, string> = { board: 'CBSE', class: '10', subject: 'Science', chapter: '1: Chemical Reactions' };
/** The example's questions: they are only for trying the page, so they are never sent while the example is loaded. */
const EXAMPLE_QUESTIONS = new Set(format(EXAMPLE).rows.map((r) => r.question.toLowerCase()));
const motion = (): ScrollBehavior => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');
const SECTION = 'flex flex-col gap-4 rounded-[24px] bg-muted p-4 sm:p-6';

/** Scrolls smoothly to a part of the page and moves keyboard focus there, without adding "#..." to the address. */
function scrollToEl(el: HTMLElement | null) {
  if (!el) return;
  el.scrollIntoView({ behavior: motion(), block: 'start' });
  el.focus({ preventScroll: true });
}

export interface Alerts { list?: SentBack[]; error?: string }
/** The fixed list of chapters and topics (no list while loading). */
export interface Catalog { list?: ListChapter[]; error?: string }

export function WriteQuestions({ api, teacher, canApprove, alerts, onSeen, onRetryAlerts, onSent, catalog, onRetryCatalog }: {
  api: GamesApi;
  /** The name batches are sent under. */
  teacher: string;
  /** An HoD or admin, who can open Approve questions. */
  canApprove: boolean;
  /** Questions sent back to this person (no list while loading). */
  alerts: Alerts;
  /** The sent-back list was opened: these are now seen. */
  onSeen: (ids: string[]) => void;
  onRetryAlerts: () => void;
  /** Questions were sent: the counts elsewhere on the page go up. */
  onSent: () => void;
  /** Questions can only be sent for a chapter and topic on this list, under its names. */
  catalog: Catalog;
  onRetryCatalog: () => void;
}) {
  const [raw, setRaw] = useState('');
  /** The text as it was last sent or downloaded: leaving the page with anything else asks first, as it isn't saved. */
  const [kept, setKept] = useState('');
  const [done, setDone] = useState('');
  const [caret, setCaret] = useState(0);
  /** Bumped when the whole text is replaced (paste, example, clear), so the table plays its entrance again. */
  const [batch, setBatch] = useState(0);
  const [sent, setSent] = useState<SendResult | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [resultsInView, setResultsInView] = useState(true);
  /** The line being typed on in the Questions box, and the detail box being typed in: problems there wait until they move on. */
  const [typingLine, setTypingLine] = useState<number | null>(null);
  const [typingBox, setTypingBox] = useState<DetailKey | null>(null);
  /** The sent-back list: open or not, and the questions to point at ("See why"). */
  const [backOpen, setBackOpen] = useState(false);
  const [backFocus, setBackFocus] = useState<string[]>([]);
  const boxTimer = useRef(0);
  const box = useRef<HTMLTextAreaElement>(null);
  const results = useRef<HTMLElement>(null);
  const backPanel = useRef<HTMLElement>(null);

  // on a phone the results are below the box: a small pill points to them while they are out of sight
  useEffect(() => {
    const el = results.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setResultsInView(e.isIntersecting), { rootMargin: '0px 0px -30% 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const text = useDeferredValue(raw);
  const { rows, issues: formatIssues } = useMemo(() => format(text), [text]);
  /** Moving the cursor to another line ends "still typing" there; arriving on a line shows its problems. */
  const moveCaret = (line: number) => {
    setCaret(line);
    setTypingLine((t) => (t === line ? t : null));
  };
  const typedOn = (line: number | null) => {
    if (line !== null) setCaret(line);
    setTypingLine(line);
  };
  const details = readDetails(raw);
  const id = detailsId(details);
  const gaps = missing(rows);
  const chapters = new Set(rows.map((r) => r.chapter_id ?? [r.board, r.class, r.subject, r.chapter_no, r.chapter].join('|'))).size;
  const topics = new Set(rows.filter((r) => r.topic || r.topic_no !== null).map((r) => [r.chapter_id, r.board, r.class, r.subject, r.chapter_no, r.chapter, r.topic_no, r.topic].join('|'))).size;
  const name = baseName(rows);

  // one note per count, so "no board, class or subject" is one line rather than three
  const have = (n: number) => plural(n, 'question has', 'questions have');
  const byCount = new Map<number, string[]>();
  for (const [k, what] of [['board', 'board'], ['class', 'class'], ['subject', 'subject'], ['chapter', 'chapter number']] as const) {
    if (gaps[k]) byCount.set(gaps[k], [...(byCount.get(gaps[k]) ?? []), what]);
  }
  const notes = [
    ...[...byCount].map(([n, what]) => `${have(n)} no ${what.length > 1 ? `${what.slice(0, -1).join(', ')} or ${what[what.length - 1]}` : what[0]}, so no chapter ID. Fill in the boxes above.`),
    gaps.topic > 0 && `${have(gaps.topic)} no topic. Add a line such as "Topic 1: Name" above them.`,
  ].filter(Boolean) as string[];

  /** Shows a check mark on a button for a moment after its action worked. */
  const flash = (what: string) => {
    setDone(what);
    setTimeout(() => setDone((c) => (c === what ? '' : c)), 1800);
  };
  const copy = async (what: string, value: string) => { if (await copyText(value)) { flash(what); if (what === 'sheets') setKept(raw); } };
  const save = (what: 'csv' | 'json') => {
    if (what === 'csv') download(`${name}.csv`, toCSV(rows), 'text/csv');
    else download(`${name}.json`, toJSON(rows), 'application/json');
    setKept(raw);
    flash(what);
  };

  /**
   * "Try an example" was pressed and its text is still here. Its questions are only for trying the page, so they aren't
   * sent; once the text is emptied, pasted over or replaced, the same questions are the person's own (a chatbot's reply
   * often has them).
   */
  const [example, setExample] = useState(false);
  useEffect(() => { if (!raw.trim()) setExample(false); }, [raw]);
  const fromExample = (r: Row) => example && EXAMPLE_QUESTIONS.has(r.question.toLowerCase());
  /** Your own questions (not the example's), and those of them the list rules out: they can't be sent. */
  const own = rows.filter((r) => !fromExample(r));
  const listCheck = useMemo(() => (catalog.list ? checkList(text, own, catalog.list) : null),
    // `own` is a new array each render; it changes only with the text and the example
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [text, example, catalog.list]);
  const all = useMemo(() => (listCheck?.issues.length ? [...formatIssues, ...listCheck.issues].sort((a, b) => a.line - b.line) : formatIssues), [formatIssues, listCheck]);
  const issues = visibleIssues(all, { caret: typingLine, line: typingBox && detailLine(raw, typingBox) });
  const errors = issues.filter((x) => x.level === 'error').length;

  /** Replacing all the text can always be undone for a few seconds, so there is no "are you sure?". */
  const replaceAll = (next: string, what: string, isExample = false) => {
    const before = raw;
    const wasExample = example;
    if (before.trim() && before !== next) {
      offerUndo(what, () => {
        setRaw(before);
        setExample(wasExample);
        setBatch((b) => b + 1);
        box.current?.focus({ preventScroll: true });
      });
    }
    setRaw(next);
    setExample(isExample);
    setBatch((b) => b + 1);
  };

  /** "Fix it" on a sent-back question: it goes in the Questions box with its details (the text before it can be had back with Undo). */
  const fix = (a: SentBack) => {
    replaceAll(asText([a]), 'Question loaded');
    setSent(null);
    box.current?.scrollIntoView({ behavior: motion(), block: 'center' });
    box.current?.focus({ preventScroll: true });
  };

  /** Sends the questions to the HoD (not the example's). A question needs a chapter ID and a chapter name to be sent. */
  const examples = rows.filter(fromExample).length;
  const complete = own.filter((r) => r.chapter_id && r.chapter);
  const sendable = listCheck ? complete.filter((r) => !listCheck.blocked.has(r.line)) : [];
  const ready = sendable.length;
  const offList = listCheck ? complete.length - sendable.length : 0;
  const noId = own.filter((r) => !r.chapter_id).length;
  const noName = own.filter((r) => r.chapter_id && !r.chapter).length;
  // the text lives only on this page: closing or reloading it with questions not yet sent or downloaded asks first
  const unsaved = own.length > 0 && raw !== kept;
  useEffect(() => {
    if (!unsaved) return;
    const ask = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    addEventListener('beforeunload', ask);
    return () => removeEventListener('beforeunload', ask);
  }, [unsaved]);
  const send = async () => {
    setSending(true);
    setSent(null);
    setSendError('');
    try {
      const result = await api.sendBatch(sendable);
      setSent(result);
      setKept(raw);
      if (result.sent) { flash('send'); onSent(); }
    } catch (e) {
      setSendError((e as Error).message);
    } finally {
      setSending(false);
    }
  };
  /** "See why": opens the sent-back list at these questions. */
  const seeWhy = (ids: string[]) => {
    setBackOpen(true);
    setBackFocus(ids);
    requestAnimationFrame(() => scrollToEl(backPanel.current));
  };

  // the chapter chosen in the boxes, when it is on the list as written there
  const listed = catalog.list ? chaptersFor(catalog.list, details.board, details.class, details.subject) : [];
  const typed = parseNumbered(details.chapter, 'chapter');
  const chosen = listed.find((c) => c.chapter_no === typed.no && sameName(c.name, typed.name));
  const listHasNone = !!catalog.list && !listed.length && !!checkBoard(details.board).code && checkClass(details.class).value !== null && !!checkSubject(details.subject).code;
  const prompt = chatbotPrompt(`${location.origin}/games`) + (chosen ? listedMaterial(chosen) : '');

  /** A topic chip: its Topic line goes after the line the cursor is on (or replaces it when it is empty), and the
   * cursor moves to the line after it, ready for the first question. */
  const addTopic = (t: ListTopic) => {
    const lines = raw.split('\n');
    const topicLine = `Topic ${t.topic_no}: ${t.name}`;
    let at = caret >= 1 && caret <= lines.length ? caret - 1 : lines.length - 1;
    if (lines[at]?.trim()) at += 1;
    lines.splice(at, lines[at]?.trim() === '' ? 1 : 0, topicLine);
    if (at === lines.length - 1) lines.push('');
    const next = lines.join('\n');
    const pos = lines.slice(0, at + 1).join('\n').length + 1;
    setRaw(next);
    requestAnimationFrame(() => {
      const ta = box.current;
      if (!ta) return;
      ta.focus({ preventScroll: true });
      ta.setSelectionRange(pos, pos);
      moveCaret(at + 2);
    });
  };

  /** Selects a line of the Questions box, so a reported problem can be fixed in place. */
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

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-prose text-[14px] text-warm-secondary">
        Write one question per line: the question, a bar <code className="rounded bg-muted px-1 font-mono text-foreground">|</code>, then the answer. They come out as clean rows for the question bank, each linked to its chapter by an ID, and you can try the game they make before you send them.{' '}
        <button type="button" className={LINKISH} onClick={() => scrollToEl(document.getElementById('guide'))}>How to write your questions</button>
      </p>

      <SentBackPanel panelRef={backPanel} alerts={alerts} open={backOpen} setOpen={setBackOpen} focus={backFocus} onSeen={onSeen} onRetry={onRetryAlerts} onFix={fix} />

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <section className={SECTION} aria-labelledby="in-h">
          <h2 id="in-h" className="text-[15px] font-bold text-foreground">1. Write</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {DETAIL_KEYS.map((k) => {
              const problem = typingBox === k ? undefined : k === 'chapter' && listHasNone
                ? { level: 'warn' as const, text: `The list has no chapters for this board, class and subject yet.` }
                : checkDetail(k, details[k]);
              if (k === 'chapter' && listed.length) {
                return (
                  <div className="col-span-2 flex flex-col gap-1 sm:col-span-1" key={k}>
                    <label htmlFor="d-chapter" className="text-[12px] font-semibold text-warm-secondary">{LABEL[k]}</label>
                    <select id="d-chapter" value={chosen ? String(chosen.chapter_no) : ''}
                      className={cn(FIELD, 'h-11', details.chapter && !chosen && 'ring-2 ring-destructive')}
                      onChange={(e) => {
                        const c = listed.find((x) => String(x.chapter_no) === e.target.value);
                        setRaw((r) => writeDetail(r, 'chapter', c ? `${c.chapter_no}: ${c.name}` : ''));
                      }}>
                      <option value="">{details.chapter && !chosen ? `${details.chapter} (not on the list)` : 'Choose a chapter'}</option>
                      {listed.map((c) => <option key={c.chapter_id} value={String(c.chapter_no)}>{c.chapter_no}: {c.name}</option>)}
                    </select>
                  </div>
                );
              }
              return (
                <div className={cn('flex flex-col gap-1', k === 'chapter' && 'col-span-2 sm:col-span-1')} key={k}>
                  <label htmlFor={`d-${k}`} className="text-[12px] font-semibold text-warm-secondary">{LABEL[k]}</label>
                  <input id={`d-${k}`} type="text" value={details[k]} placeholder={`e.g. ${HINT[k]}`} autoComplete="off"
                    className={cn(FIELD, 'h-11', problem?.level === 'error' && 'ring-2 ring-destructive', problem?.level === 'warn' && 'ring-2 ring-brand')}
                    aria-invalid={problem?.level === 'error'} aria-describedby={problem ? `d-${k}-msg` : undefined}
                    onChange={(e) => {
                      const v = e.target.value;
                      setRaw((r) => writeDetail(r, k, v));
                      // a box's warning waits until it is left, or until typing pauses
                      setTypingBox(k);
                      clearTimeout(boxTimer.current);
                      boxTimer.current = window.setTimeout(() => setTypingBox(null), 1500);
                    }}
                    onBlur={(e) => {
                      clearTimeout(boxTimer.current);
                      setTypingBox(null);
                      const std = standardDetail(k, e.target.value);
                      if (std !== e.target.value) setRaw((r) => writeDetail(r, k, std));
                    }} />
                  {problem && <span id={`d-${k}-msg`} className={cn('text-[12px]', problem.level === 'error' ? 'text-destructive' : 'text-brand-deep')}>{problem.text}</span>}
                </div>
              );
            })}
          </div>
          <p className="text-[13px] text-warm-secondary">
            {id ? <>Chapter ID <code className="rounded-md bg-card px-1.5 py-0.5 font-mono font-semibold text-foreground">{id}</code>. </> : 'Board, class, subject and chapter number make the chapter ID. '}
            These boxes are the lines at the top of the Questions box; editing either changes both.
          </p>
          {chosen && (chosen.topics.length ? (
            <div className="flex flex-col gap-1.5">
              <p className="text-[12px] font-semibold text-warm-secondary">Topics of this chapter on the list: press one to add its Topic line below the cursor</p>
              <div className="flex flex-wrap gap-2">
                {chosen.topics.map((t) => (
                  <button key={t.topic_id} type="button" className={chip('card')} onClick={() => addTopic(t)}>Topic {t.topic_no}: {t.name}</button>
                ))}
              </div>
            </div>
          ) : <p className="text-[13px] text-warm-secondary">This chapter has no topics on the list, so write its questions without a Topic line.</p>)}

          <div className="flex flex-col gap-1.5">
            <label htmlFor="q" className="text-[12px] font-semibold text-warm-secondary">Questions</label>
            <Editor value={raw} onChange={setRaw} onPaste={(all) => { setBatch((b) => b + 1); if (all) setExample(false); }} onTyping={typedOn} issues={issues} boxRef={box} caret={caret} setCaret={moveCaret} />
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btn('card')} onClick={() => replaceAll(EXAMPLE, 'Example loaded', true)}>Try an example</button>
            <button type="button" className={btn('card')} onClick={() => replaceAll('', 'Cleared')} disabled={!raw}>Clear</button>
          </div>

          <div className="flex flex-col gap-2 rounded-2xl bg-card p-4">
            <p className="text-[14px] text-warm-prose"><b className="text-foreground">Starting from notes?</b> Copy this prompt into ChatGPT, Gemini or Claude, add your notes (or just the class, subject and chapter), then paste its reply into Questions. The prompt carries all the instructions the chatbot needs.</p>
            <button type="button" className={btn('quiet', 'w-fit')} onClick={() => copy('prompt', prompt)}>
              <ActionIcon done={done === 'prompt'}><Copy /></ActionIcon>Copy chatbot prompt
            </button>
          </div>
        </section>

        <section className={SECTION} aria-labelledby="out-h" ref={results} tabIndex={-1}>
          <h2 id="out-h" className="text-[15px] font-bold text-foreground">2. Check</h2>
          <p className="text-[15px] text-foreground" role="status" aria-live="polite">
            {rows.length
              ? <><b>{plural(rows.length, 'question')}</b> in {plural(chapters, 'chapter')} and {plural(topics, 'topic')}</>
              : 'Nothing to check yet.'}
          </p>

          {issues.length > 0 && (
            <div className={cn('rounded-2xl px-4 py-3 text-[14px]', errors ? 'bg-destructive/10' : 'bg-brand-subtle')}>
              <b className="text-foreground">{errors ? `${plural(errors, 'line')} left out` : ''}{errors && issues.length > errors ? ', ' : ''}{issues.length > errors ? `${plural(issues.length - errors, 'warning')}` : ''}</b>
              <ul className="mt-1 flex flex-col gap-0.5">
                {issues.slice(0, 50).map((x) => (
                  <li key={`${x.line}\u0000${x.text}`} className={x.level === 'error' ? 'text-destructive' : 'text-brand-deep'}>
                    <button type="button" className={LINKISH} onClick={() => goTo(x.line)}>Line {x.line}</button>: {x.text}
                  </li>
                ))}
                {issues.length > 50 && <li className="text-warm-secondary">and {issues.length - 50} more</li>}
              </ul>
            </div>
          )}
          {notes.length > 0 && <ul className="flex list-disc flex-col gap-0.5 pl-5 text-[14px] text-warm-prose">{notes.map((n) => <li key={n}>{n}</li>)}</ul>}

          <div className="rounded-2xl bg-card p-3 sm:p-4">
            {rows.length ? <RowsTable key={batch} rows={rows} /> : <p className="py-6 text-center text-[14px] text-warm-secondary">Your questions will appear here, grouped by chapter and topic.</p>}
          </div>

          <div className="flex flex-wrap gap-2">
            <button type="button" className={btn('card')} disabled={!rows.length} onClick={() => save('csv')}>
              <ActionIcon done={done === 'csv'}><Download /></ActionIcon>Download CSV
            </button>
            <button type="button" className={btn('card')} disabled={!rows.length} onClick={() => save('json')}>
              <ActionIcon done={done === 'json'}><Download /></ActionIcon>Download JSON
            </button>
            <button type="button" className={btn('card')} disabled={!rows.length} onClick={() => copy('sheets', toTSV(rows))}>
              <ActionIcon done={done === 'sheets'}><Copy /></ActionIcon>Copy for Sheets
            </button>
          </div>
          <p className="sr-only" aria-live="polite">{done === 'csv' || done === 'json' ? 'Downloaded.' : done ? 'Copied.' : ''}</p>
          <p className="text-[12px] text-warm-meta">One row per question, with the columns <code className="font-mono">{COLUMNS.join(', ')}</code>.</p>
        </section>
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="rounded-[24px] bg-card p-4 shadow-border sm:p-6">
          <GamePreview rows={rows} />
        </div>
        <form className={SECTION} onSubmit={(e) => { e.preventDefault(); void send(); }}>
          <h2 className="text-[15px] font-bold text-foreground">4. Send for approval</h2>
          <p className="text-[14px] text-warm-secondary">An HoD checks the questions. Only approved ones go into the question bank and the games.</p>
          {examples > 0 && (
            <p className="rounded-2xl bg-brand-subtle px-4 py-3 text-[14px] text-foreground" role="status">
              {examples === rows.length
                ? <><b>This is the example.</b> Its questions can't be sent. Write or paste your own questions in their place.</>
                : <><b>{plural(examples, 'question is', 'questions are')} from the example</b>, so {examples === 1 ? "it won't" : "they won't"} be sent. Only your own questions are sent.</>}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className={btn('brand')} disabled={!ready || sending}>
              <ActionIcon done={done === 'send'}><Send /></ActionIcon>{sending ? 'Sending…' : ready ? `Send ${plural(ready, 'question')}` : 'Send'}
            </button>
            <p className="text-[13px] text-warm-secondary">Sending as <b className="text-foreground">{teacher}</b>.</p>
          </div>
          {catalog.error && !catalog.list && (
            <p className="rounded-2xl bg-destructive/10 px-4 py-3 text-[14px] text-foreground" role="alert">
              <b>Couldn't load the list of chapters,</b> so nothing can be sent yet. {catalog.error}{' '}
              <button type="button" className={LINKISH} onClick={onRetryCatalog}>Try again</button>
            </p>
          )}
          {!catalog.list && !catalog.error && <p className="text-[13px] text-warm-secondary">Loading the list of chapters…</p>}
          {catalog.list && !catalog.list.length && <p className="text-[13px] text-warm-secondary">The list of chapters is empty, so nothing can be sent yet. Ask an admin to add it.</p>}
          {offList > 0 && <p className="text-[13px] text-warm-secondary">{plural(offList, "question doesn't", "questions don't")} match the list of chapters and topics and can't be sent yet. The lines in red say what to change.</p>}
          {noId > 0 && <p className="text-[13px] text-warm-secondary">{plural(noId, 'question has', 'questions have')} no chapter ID and can't be sent yet. Fill in the boxes above.</p>}
          {noName > 0 && <p className="text-[13px] text-warm-secondary">{plural(noName, 'question has', 'questions have')} no chapter name and can't be sent yet. Write it after the chapter number, for example "3: Acids".</p>}
          {sent && (
            <p className={cn('animate-fade-slide-up rounded-2xl px-4 py-3 text-[14px] text-foreground', sent.sent ? 'bg-mint' : 'bg-brand-subtle')}>
              {sent.sent ? <>Sent {plural(sent.sent, 'question')} to the HoD as {sent.batchIds.length > 1 ? 'batches' : 'batch'} <b>{sent.batchIds.join(', ')}</b>. </> : 'Nothing new to send. '}
              {sent.already > 0 && <>{plural(sent.already, 'question was', 'questions were')} already sent, so {sent.already === 1 ? 'it was' : 'they were'} skipped. </>}
              {sent.sentBack > 0 && <>{plural(sent.sentBack, 'question was', 'questions were')} sent back to you before and {sent.sentBack === 1 ? "hasn't" : "haven't"} changed, so {sent.sentBack === 1 ? "it wasn't" : "they weren't"} sent again. <button type="button" className={LINKISH} onClick={() => seeWhy(sent.sentBackIds)}>See why</button> </>}
              {canApprove && sent.sent > 0 && <Link className={LINKISH} to="/games/approve">Open Approve questions</Link>}
            </p>
          )}
          {sent && raw.trim() && (
            <button type="button" className={btn('card', 'w-fit')} onClick={() => { replaceAll('', 'Cleared'); setSent(null); box.current?.focus({ preventScroll: true }); }}>Start a new batch</button>
          )}
          {sendError && <p className="rounded-2xl bg-destructive/10 px-4 py-3 text-[14px] text-foreground" role="alert">Couldn't send: {sendError}</p>}
        </form>
      </div>

      <div className="mt-4"><Guide /></div>

      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-30 flex justify-center lg:hidden" aria-live="polite">
        {rows.length > 0 && !resultsInView ? (
          <button type="button" onClick={() => scrollToEl(results.current)}
            className={cn('pointer-events-auto flex min-h-11 items-center gap-1.5 rounded-full px-4 text-[14px] font-semibold shadow-pill', errors ? 'bg-destructive text-destructive-foreground' : 'bg-panel text-background')}>
            {errors ? `${plural(errors, 'line')} left out · ` : ''}{plural(rows.length, 'question')} <ArrowDown className="size-4" aria-hidden />
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Questions an HoD sent back to this person, with why. Opening the list marks them seen. */
function SentBackPanel({ panelRef, alerts, open, setOpen, focus, onSeen, onRetry, onFix }: {
  panelRef: RefObject<HTMLElement>;
  alerts: Alerts; open: boolean; setOpen: (o: boolean) => void; focus: string[];
  onSeen: (ids: string[]) => void; onRetry: () => void; onFix: (a: SentBack) => void;
}) {
  const list = alerts.list ?? [];
  const unseen = list.filter((a) => !a.seen);
  const unseenIds = unseen.map((a) => a.id).join(',');
  // the ones that were new when the list was opened keep their "New" label while it stays open
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!open || !unseenIds) return;
    const ids = unseenIds.split(',');
    setFresh((f) => new Set([...f, ...ids]));
    onSeen(ids);
  }, [open, unseenIds, onSeen]);
  useEffect(() => { if (!open) setFresh(new Set()); }, [open]);
  const pointAt = new Set(focus);

  if (alerts.error && !alerts.list) {
    return (
      <section ref={panelRef} tabIndex={-1} className="rounded-2xl bg-destructive/10 px-4 py-3 text-[14px] text-foreground outline-none" role="alert">
        <b>Couldn't check for questions sent back to you.</b> {alerts.error}{' '}
        <button type="button" className={LINKISH} onClick={onRetry}>Try again</button>
      </section>
    );
  }
  if (!list.length) return null;
  const waitingFix = list.filter((a) => !a.now).length;

  return (
    <section ref={panelRef} tabIndex={-1} aria-labelledby="back-h" className="rounded-[24px] bg-brand-subtle p-4 outline-none sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="back-h" className="flex flex-wrap items-center gap-2 text-[15px] font-bold text-foreground">
          {plural(list.length, 'question was', 'questions were')} sent back to you
          {unseen.length > 0 && <span className="rounded-full bg-brand px-2 py-0.5 text-[12px] font-bold text-foreground">{unseen.length} new</span>}
        </h2>
        <button type="button" className={btn('card')} aria-expanded={open} aria-controls="back-list" onClick={() => setOpen(!open)}>{open ? 'Hide' : 'See why'}</button>
      </div>
      {!open && <p className="mt-1 text-[14px] text-warm-prose">{waitingFix ? `${plural(waitingFix, 'needs', 'need')} fixing. ` : 'All of them have been sent again. '}Each one has the HoD's reason.</p>}
      {open && (
        <ul id="back-list" className="mt-3 flex flex-col gap-2">
          {list.map((a) => (
            <li key={a.id} className={cn('flex flex-col gap-1 rounded-2xl bg-card p-4 text-[14px]', pointAt.has(a.id) && 'ring-2 ring-brand')}>
              <p className="text-[12px] text-warm-meta">
                {[a.chapter_no !== null && `Chapter ${a.chapter_no}`, a.chapter].filter(Boolean).join(': ')}{a.topic && ` · ${a.topic}`}
                {fresh.has(a.id) && <span className="ml-2 rounded-full bg-brand px-1.5 py-0.5 text-[11px] font-bold text-foreground">New</span>}
              </p>
              <p className="text-foreground">{a.question}</p>
              <p className="font-semibold text-foreground">{a.answer}</p>
              <p className="rounded-xl bg-brand-subtle px-3 py-2 text-foreground"><b>Why:</b> {a.note}</p>
              <p className="text-[12px] text-warm-meta">
                Sent back by {a.reviewer}{a.reviewedAt && `, ${day(a.reviewedAt)}`}.
                {a.now && (a.now === 'approved' ? ' Since sent again, and approved.' : ' Since sent again, and waiting for an HoD.')}
              </p>
              {!a.now && <button type="button" className={chip('dark', 'mt-1 w-fit')} onClick={() => onFix(a)}>Fix it in the Questions box</button>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The Questions box. A textarea can't style parts of its text, so a copy of the text sits behind it with the same font,
 * padding and width: the copy is invisible except for the underlines on lines with a problem. The two scroll together.
 * Moving the cursor onto an underlined line shows why it is underlined.
 */
function Editor({ value, onChange, onPaste, onTyping, issues, boxRef, caret, setCaret }: {
  value: string;
  onChange: (v: string) => void;
  /** A paste; `all` when it replaces all the text (or the box was empty). */
  onPaste: (all: boolean) => void;
  /** The line just typed on (null when the box is left): problems there wait until the cursor moves on. */
  onTyping: (line: number | null) => void;
  issues: Issue[];
  boxRef: RefObject<HTMLTextAreaElement>;
  /** The line the cursor is on (set from outside too, when a listed problem is clicked). */
  caret: number;
  setCaret: (line: number) => void;
}) {
  const back = useRef<HTMLDivElement>(null);
  const pasted = useRef(false); // a paste is finished text: check all of it at once

  const sync = () => {
    const ta = boxRef.current;
    const b = back.current;
    if (!ta || !b) return;
    (b.firstElementChild as HTMLElement).style.width = `${ta.clientWidth}px`; // excludes the textarea's scrollbar
    b.scrollTop = ta.scrollTop;
    b.scrollLeft = ta.scrollLeft;
  };
  useLayoutEffect(sync);
  useEffect(() => {
    const ta = boxRef.current;
    if (!ta || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(sync);
    ro.observe(ta);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lineOf = (ta: HTMLTextAreaElement) => ta.value.slice(0, ta.selectionStart).split('\n').length;
  const onCaret = (ta: HTMLTextAreaElement) => setCaret(lineOf(ta));
  const levels = lineLevels(issues);
  const here = issues.filter((x) => x.line === caret);
  const errors = issues.filter((x) => x.level === 'error').length;

  return (
    <>
      <div className="games-editor">
        <div className="games-backdrop" ref={back} aria-hidden="true">
          <div className="games-backdrop-in">
            {value.split('\n').map((l, i) => {
              const level = levels.get(i + 1);
              const body = l.trim();
              const nl = i > 0 ? '\n' : '';
              if (!level || !body) return <Fragment key={i}>{nl}{l}</Fragment>;
              const lead = l.slice(0, l.indexOf(body[0]));
              return <Fragment key={i}>{nl}{lead}<span className={`games-mark ${level}`}>{body}</span>{l.slice(lead.length + body.length)}</Fragment>;
            })}
            {/* keeps an empty last line as tall as the textarea draws it */}
            {'​'}
          </div>
        </div>
        <textarea id="q" ref={boxRef} spellCheck={false} value={value} aria-invalid={errors > 0} aria-describedby="caret-note"
          onChange={(e) => {
            onChange(e.target.value);
            if (pasted.current) { pasted.current = false; onCaret(e.target); onTyping(null); } else onTyping(lineOf(e.target));
          }}
          onPaste={(e) => { pasted.current = true; const t = e.currentTarget; onPaste(t.selectionStart === 0 && t.selectionEnd === t.value.length); }}
          onFocus={(e) => onCaret(e.currentTarget)} onBlur={() => onTyping(null)}
          onScroll={sync} onSelect={(e) => onCaret(e.currentTarget)} onClick={(e) => onCaret(e.currentTarget)} onKeyUp={(e) => onCaret(e.currentTarget)}
          placeholder={'One question per line, like this:\n\nTopic 1: Chemical Equations\nQuestion | Answer\nQuestion | Answer | easy'} />
      </div>
      <p id="caret-note" aria-live="polite"
        className={cn('min-h-[1.5em] text-[14px]', here.length ? (here.some((x) => x.level === 'error') ? 'text-destructive' : 'text-brand-deep') : 'text-warm-secondary')}>
        {here.length
          ? <span key={`l${caret}`}><b>Line {caret}:</b> {here.map((x) => x.text).join(' ')}</span>
          : issues.length
            ? <span key="hint"><span className="games-mark error">Red</span> lines are left out. <span className="games-mark warn">Amber</span> lines are kept, but check them. Put the cursor on one to see why.</span>
            : ' '}
      </p>
    </>
  );
}
