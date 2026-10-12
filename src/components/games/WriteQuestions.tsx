import { Fragment, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, Copy, Send } from 'lucide-react';
import type { GamesApi, SendResult } from '@/lib/games/api';
import { checkBoard, checkClass, checkDetail, checkSubject, DETAIL_KEYS, detailLine, LABEL, parseNumbered, readDetails, readMeta, standardDetail, writeDetail, type DetailKey } from '@/lib/games/details';
import { chaptersFor, checkList, sameName } from '@/lib/games/catalog';
import { asText, EXAMPLE, format, lineLevels, missing, visibleIssues, type Issue } from '@/lib/games/format';
import { chatbotPrompt } from '@/lib/games/prompt';
import { type ListChapter, type ListTopic, type Row, type SentBack } from '@/lib/games/rows';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { GamePreview } from './GamePreview';
import { Guide } from './Guide';
import { btn, chip, copyText, day, FIELD, LINKISH, offerUndo, plural } from './helpers';
import { ActionIcon, RowsTable } from './shared';
import './games.css';

/* Write questions: people on the games team write questions in one format (Question | Answer, under detail and Topic
   lines; other common layouts are read too, quietly), check them, see a game made from them, and send them for
   approval. Only what writing and sending needs is on the page: no IDs, no exports. The example's questions can't be sent while the example is loaded. Questions sent back
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

export function WriteQuestions({ api, canApprove, alerts, onSeen, onRetryAlerts, onSent, catalog, onRetryCatalog }: {
  api: GamesApi;
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
  /** The text as it was last sent: leaving the page with anything else asks first, as it isn't saved. */
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
  /** "Copy chatbot prompt" is asking which chapter the prompt is for. */
  const [picking, setPicking] = useState(false);
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
  const gaps = missing(rows);
  // a chapter the list gives no topics needs no Topic line
  const topicless = new Set(catalog.list?.filter((c) => !c.topics.length).map((c) => c.chapter_id));
  const noTopic = rows.filter((r) => !r.topic && r.topic_no === null && !(r.chapter_id && topicless.has(r.chapter_id))).length;
  const chapters = new Set(rows.map((r) => r.chapter_id ?? [r.board, r.class, r.subject, r.chapter_no, r.chapter].join('|'))).size;
  const topics = new Set(rows.filter((r) => r.topic || r.topic_no !== null).map((r) => [r.chapter_id, r.board, r.class, r.subject, r.chapter_no, r.chapter, r.topic_no, r.topic].join('|'))).size;

  // one note per count, so "no board, class or subject" is one line rather than three
  const have = (n: number) => plural(n, 'question has', 'questions have');
  const byCount = new Map<number, string[]>();
  for (const [k, what] of [['board', 'board'], ['class', 'class'], ['subject', 'subject'], ['chapter', 'chapter number']] as const) {
    if (gaps[k]) byCount.set(gaps[k], [...(byCount.get(gaps[k]) ?? []), what]);
  }
  const notes = [
    ...[...byCount].map(([n, what]) => `${have(n)} no ${what.length > 1 ? `${what.slice(0, -1).join(', ')} or ${what[what.length - 1]}` : what[0]}. Fill in the boxes above.`),
    noTopic > 0 && `${have(noTopic)} no topic. Add a line such as "Topic 1: Name" above them.`,
  ].filter(Boolean) as string[];

  /** Shows a check mark on a button for a moment after its action worked. */
  const flash = (what: string) => {
    setDone(what);
    setTimeout(() => setDone((c) => (c === what ? '' : c)), 1800);
  };
  const copy = async (what: string, value: string) => { if (await copyText(value)) flash(what); };

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

  /** Sends the questions for approval (not the example's). A question needs a chapter ID and a chapter name to be sent,
   * and to be on the list; Check says what is missing from the others. */
  const examples = rows.filter(fromExample).length;
  const sendable = listCheck ? own.filter((r) => r.chapter_id && r.chapter && !listCheck.blocked.has(r.line)) : [];
  const ready = sendable.length;
  const notReady = listCheck ? own.length - ready : 0;
  // the text lives only on this page: closing or reloading it with questions not yet sent asks first
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
  /** The chatbot prompt is made for one chapter: the one in the boxes, when it is on the list and the example's
   * questions aren't in the box; otherwise the button asks which. */
  const promptChapter = examples ? undefined : chosen;
  const copyPrompt = (ch: ListChapter) => copy('prompt', chatbotPrompt(ch));

  /** A topic chip. When the topic the cursor is under has no questions yet, its Topic line is swapped for this one;
   * otherwise this Topic line goes after the line the cursor is on (or replaces it when it is empty). Either way the
   * cursor moves to the line after it, ready for the first question. */
  const addTopic = (t: ListTopic) => {
    const lines = raw.split('\n');
    const topicLine = `Topic ${t.topic_no}: ${t.name}`;
    const cur = caret >= 1 && caret <= lines.length ? caret - 1 : lines.length - 1;
    // the Topic line the cursor is under (none once a Chapter line is passed), and whether a question follows it
    let top = -1;
    for (let i = cur; i >= 0; i--) {
      const m = readMeta(lines[i]);
      if (m?.key === 'topic') { top = i; break; }
      if (m?.key === 'chapter') break;
    }
    let hasQuestions = false;
    for (let i = top + 1; top >= 0 && i < lines.length; i++) {
      const m = readMeta(lines[i]);
      if (m?.key === 'topic' || m?.key === 'chapter') break;
      if (!m && lines[i].trim()) { hasQuestions = true; break; }
    }
    let at: number;
    if (top >= 0 && !hasQuestions) {
      at = top;
      lines[at] = topicLine;
    } else {
      at = lines[cur]?.trim() ? cur + 1 : cur;
      lines.splice(at, lines[at]?.trim() === '' ? 1 : 0, topicLine);
    }
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

      <SentBackPanel panelRef={backPanel} alerts={alerts} open={backOpen} setOpen={setBackOpen} focus={backFocus} onSeen={onSeen} onRetry={onRetryAlerts} onFix={fix} />

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <section className={SECTION} aria-labelledby="in-h">
          <h2 id="in-h" className="text-[15px] font-bold text-foreground">1. Write</h2>
          {/* Chapter gets a row of its own: its names are long */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {DETAIL_KEYS.map((k) => {
              const problem = typingBox === k ? undefined : k === 'chapter' && listHasNone
                ? { level: 'warn' as const, text: `The list has no chapters for this board, class and subject yet.` }
                : checkDetail(k, details[k]);
              if (k === 'chapter' && listed.length) {
                return (
                  <div className="col-span-full flex flex-col gap-1" key={k}>
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
                <div className={cn('flex flex-col gap-1', k === 'subject' && 'col-span-2 sm:col-span-1', k === 'chapter' && 'col-span-full')} key={k}>
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
          {chosen && (chosen.topics.length ? (
            <div className="flex flex-col gap-1.5">
              <p className="text-[12px] font-semibold text-warm-secondary">Add a topic</p>
              <div className="flex flex-wrap gap-2">
                {chosen.topics.map((t) => (
                  <button key={t.topic_id} type="button" className={chip('card')} onClick={() => addTopic(t)}>Topic {t.topic_no}: {t.name}</button>
                ))}
              </div>
            </div>
          ) : <p className="text-[13px] text-warm-secondary">This chapter has no topics: write its questions straight under it.</p>)}

          <div className="flex flex-col gap-1.5">
            <label htmlFor="q" className="text-[12px] font-semibold text-warm-secondary">Questions</label>
            <Editor value={raw} onChange={setRaw} onPaste={(all) => { setBatch((b) => b + 1); if (all) setExample(false); }} onTyping={typedOn} issues={issues} boxRef={box} caret={caret} setCaret={moveCaret} />
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btn('card')} onClick={() => replaceAll(EXAMPLE, 'Example loaded', true)}>Try an example</button>
            <button type="button" className={btn('card')} onClick={() => replaceAll('', 'Cleared')} disabled={!raw}>Clear</button>
          </div>

          <div className="flex flex-col gap-2 rounded-2xl bg-card p-4">
            <p className="text-[14px] text-warm-prose"><b className="text-foreground">Starting from notes?</b> Paste this prompt and your notes into ChatGPT, Gemini or Claude, then paste its reply into Questions.</p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <button type="button" className={btn('quiet', 'w-fit')} onClick={() => (promptChapter ? void copyPrompt(promptChapter) : setPicking(true))}>
                <ActionIcon done={done === 'prompt'}><Copy /></ActionIcon>Copy chatbot prompt
              </button>
              {promptChapter && <span className="text-[13px] text-warm-secondary">For chapter {promptChapter.chapter_no}: {promptChapter.name}. <button type="button" className={LINKISH} onClick={() => setPicking(true)}>Another chapter</button></span>}
              <span className="sr-only" aria-live="polite">{done === 'prompt' ? 'Prompt copied.' : ''}</span>
            </div>
          </div>
          <ChapterPicker open={picking} setOpen={setPicking} catalog={catalog} start={examples ? undefined : details}
            onCopy={(ch) => { void copyPrompt(ch); setPicking(false); }} />
        </section>

        <section className={SECTION} aria-labelledby="out-h" ref={results} tabIndex={-1}>
          <h2 id="out-h" className="text-[15px] font-bold text-foreground">2. Check</h2>
          <p className="text-[15px] text-foreground empty:hidden" role="status" aria-live="polite">
            {rows.length > 0 && <><b>{plural(rows.length, 'question')}</b> in {plural(chapters, 'chapter')} and {plural(topics, 'topic')}</>}
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
            {rows.length ? <RowsTable key={batch} rows={rows} /> : <p className="py-6 text-center text-[14px] text-warm-secondary">Your questions will appear here.</p>}
          </div>
        </section>
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="rounded-[24px] bg-card p-4 shadow-border sm:p-6">
          <GamePreview rows={rows} />
        </div>
        <form className={SECTION} onSubmit={(e) => { e.preventDefault(); void send(); }}>
          <h2 className="text-[15px] font-bold text-foreground">4. Send for approval</h2>
          {examples > 0 && (
            <p className="rounded-2xl bg-brand-subtle px-4 py-3 text-[14px] text-foreground" role="status">
              {examples === rows.length ? "The example's questions can't be sent." : `${plural(examples, 'question is', 'questions are')} from the example and won't be sent.`}
            </p>
          )}
          <button type="submit" className={btn('brand', 'w-fit')} disabled={!ready || sending}>
            <ActionIcon done={done === 'send'}><Send /></ActionIcon>{sending ? 'Sending…' : ready ? `Send ${plural(ready, 'question')}` : 'Send'}
          </button>
          {catalog.error && !catalog.list && (
            <p className="rounded-2xl bg-destructive/10 px-4 py-3 text-[14px] text-foreground" role="alert">
              <b>Couldn't load the list of chapters,</b> so nothing can be sent yet. {catalog.error}{' '}
              <button type="button" className={LINKISH} onClick={onRetryCatalog}>Try again</button>
            </p>
          )}
          {!catalog.list && !catalog.error && <p className="text-[13px] text-warm-secondary">Loading the list of chapters…</p>}
          {catalog.list && !catalog.list.length && <p className="text-[13px] text-warm-secondary">The list of chapters is empty, so nothing can be sent yet. Ask an admin to add it.</p>}
          {notReady > 0 && <p className="text-[13px] text-warm-secondary">{plural(notReady, "question can't", "questions can't")} be sent yet: Check says why.</p>}
          {sent && (
            <p className={cn('animate-fade-slide-up rounded-2xl px-4 py-3 text-[14px] text-foreground', sent.sent ? 'bg-mint' : 'bg-brand-subtle')}>
              {sent.sent ? <>Sent {plural(sent.sent, 'question')} for approval. </> : 'Nothing new to send. '}
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
      {!open && <p className="mt-1 text-[14px] text-warm-prose">{waitingFix ? `${plural(waitingFix, 'needs', 'need')} fixing.` : 'All of them have been sent again.'}</p>}
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

const uniq = <T,>(xs: T[]) => [...new Set(xs)];
/** The chosen value if it is one of the options; the only option when there is just one. */
const fit = <T,>(v: T, options: T[]) => (options.includes(v) ? v : options.length === 1 ? options[0] : undefined);

/** "Copy chatbot prompt" when the boxes don't name a chapter of the person's own: which chapter, from the list. */
function ChapterPicker({ open, setOpen, catalog, start, onCopy }: {
  open: boolean; setOpen: (o: boolean) => void; catalog: Catalog;
  /** The detail boxes, to start from (none while the example is loaded). */
  start?: Record<DetailKey, string>;
  onCopy: (ch: ListChapter) => void;
}) {
  const list = catalog.list ?? [];
  const [pick, setPick] = useState({ board: '', cls: '', subject: '', chapter: '' });
  useEffect(() => {
    if (!open) return;
    setPick({
      board: start ? checkBoard(start.board).name : '',
      cls: String((start && checkClass(start.class).value) ?? ''),
      subject: start ? checkSubject(start.subject).name : '',
      chapter: String((start && parseNumbered(start.chapter, 'chapter').no) ?? ''),
    });
    // starts from the boxes as they are when it opens, not as they change behind it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const boards = uniq(list.map((c) => c.board)).sort();
  const board = fit(pick.board, boards);
  const classes = uniq(list.filter((c) => c.board === board).map((c) => c.class)).sort((a, b) => a - b);
  const cls = fit(Number(pick.cls), classes);
  const subjects = uniq(list.filter((c) => c.board === board && c.class === cls).map((c) => c.subject)).sort();
  const subject = fit(pick.subject, subjects);
  const chapters = list.filter((c) => c.board === board && c.class === cls && c.subject === subject).sort((a, b) => a.chapter_no - b.chapter_no);
  const ch = chapters.find((c) => String(c.chapter_no) === pick.chapter) ?? (chapters.length === 1 ? chapters[0] : undefined);

  const field = (label: string, value: string, options: [string, string][], change: (v: string) => void, wide?: string) => (
    <label className={cn('flex flex-col gap-1', wide)}>
      <span className="text-[12px] font-semibold text-warm-secondary">{label}</span>
      <select value={value} disabled={!options.length} onChange={(e) => change(e.target.value)} className={cn(FIELD, 'h-11 disabled:opacity-50')}>
        <option value="">Choose</option>
        {options.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
      </select>
    </label>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg rounded-2xl bg-card">
        <DialogTitle>Which chapter are the questions for?</DialogTitle>
        <DialogDescription>The prompt is made for one chapter and its topics on the list, so the chatbot writes only what fits them.</DialogDescription>
        {!catalog.list ? (
          <p className="text-[14px] text-warm-secondary">{catalog.error ? `Couldn't load the list of chapters. ${catalog.error}` : 'Loading the list of chapters…'}</p>
        ) : !list.length ? (
          <p className="text-[14px] text-warm-secondary">The list of chapters is empty, so there is no chapter to make a prompt for yet.</p>
        ) : (
          <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (ch) onCopy(ch); }}>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {field('Board', board ?? '', boards.map((b) => [b, b]), (v) => setPick({ board: v, cls: '', subject: '', chapter: '' }))}
              {field('Class', cls ? String(cls) : '', classes.map((c) => [String(c), String(c)]), (v) => setPick((p) => ({ ...p, cls: v, subject: '', chapter: '' })))}
              {field('Subject', subject ?? '', subjects.map((s) => [s, s]), (v) => setPick((p) => ({ ...p, subject: v, chapter: '' })), 'col-span-2 sm:col-span-1')}
              {field('Chapter', ch ? String(ch.chapter_no) : '', chapters.map((c) => [String(c.chapter_no), `${c.chapter_no}: ${c.name}`]), (v) => setPick((p) => ({ ...p, chapter: v })), 'col-span-full')}
            </div>
            {ch && <p className="text-[13px] text-warm-secondary">{ch.topics.length ? `Its topics: ${ch.topics.map((t) => `${t.topic_no} ${t.name}`).join(', ')}.` : 'It has no topics on the list.'}</p>}
            <button type="submit" className={btn('brand', 'w-fit')} disabled={!ch}><Copy aria-hidden />Copy chatbot prompt</button>
          </form>
        )}
      </DialogContent>
    </Dialog>
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
