import { useMemo, useState, type ReactNode } from 'react';
import { Shuffle } from 'lucide-react';
import { GAME_TYPES, makeGame, seedOf, type Game, type GameType, type Item } from '@/lib/games/engine';
import type { BankQuestion } from '@/lib/games/rows';
import { cn } from '@/lib/utils';
import { GameView } from './GameView';
import { chip, GAME_NAMES, plural, whyNot } from './helpers';

/* What students get: pick a class, subject and chapter, and the topics studied (all of them to start with), and play a
   short puzzle made from those questions on the device by the games engine (src/lib/games/engine), which checks every
   puzzle before it is shown. A game these topics can't make is greyed out.

   Used twice: Try the games (the approved question bank, full size) and the preview on Write questions (the questions
   being written, `compact`: smaller, with the pickers that have only one choice left out, and with what each greyed-out
   game needs, so the writer can fix it). */

/** What a puzzle needs to know about a question. */
export type ReviseQuestion = Pick<BankQuestion, 'id' | 'chapter_id' | 'topic_id' | 'board' | 'class' | 'subject' | 'chapter_no' | 'chapter' | 'topic_no' | 'topic' | 'question' | 'answer'>;

interface Topic { key: string; no: number | null; name: string; count: number }
interface Chapter { id: string; cls: number | null; subject: string; no: number | null; name: string; topics: Topic[]; questions: ReviseQuestion[] }

const topicKey = (q: ReviseQuestion) => q.topic_id ?? `${q.chapter_id}|${q.topic_no ?? ''}|${q.topic}`;

/** Questions grouped into chapters and their topics, by class, subject and chapter number. */
function chaptersOf(questions: ReviseQuestion[]): Chapter[] {
  const byChapter = new Map<string, ReviseQuestion[]>();
  for (const q of questions) if (q.chapter_id) byChapter.set(q.chapter_id, [...(byChapter.get(q.chapter_id) ?? []), q]);
  return [...byChapter].map(([id, qs]) => {
    const topics = new Map<string, Topic>();
    for (const q of qs) {
      const k = topicKey(q);
      const t = topics.get(k) ?? { key: k, no: q.topic_no, name: q.topic || 'Other questions', count: 0 };
      t.count++;
      topics.set(k, t);
    }
    const q0 = qs[0];
    return {
      id, questions: qs, cls: q0.class, subject: q0.subject, no: q0.chapter_no, name: q0.chapter,
      topics: [...topics.values()].sort((a, b) => (a.no ?? 99) - (b.no ?? 99)),
    };
  }).sort((a, b) => (a.cls ?? 0) - (b.cls ?? 0) || a.subject.localeCompare(b.subject) || (a.no ?? 0) - (b.no ?? 0));
}

export function Revise({ questions, compact = false, heading, extra }: {
  questions: ReviseQuestion[];
  /** The small version, for the preview on Write questions. */
  compact?: boolean;
  /** Shown above the pickers (the preview puts its title and buttons here). */
  heading?: ReactNode;
  /** Shown next to "New puzzle" (the preview's "Full size"). */
  extra?: (game: { chapterId: string; topics: string[] }) => ReactNode;
}) {
  const chapters = useMemo(() => chaptersOf(questions), [questions]);
  /** The chapter open, and the topics left out of it: every other topic is in, including one added later. */
  const [pick, setPickState] = useState({ chapter: '', out: [] as string[] });
  const [round, setRound] = useState(0);
  const [want, setWant] = useState<GameType | null>(null);
  const setPick = (p: { chapter: string; out: string[] }) => {
    setPickState(p);
    setRound(0);
  };

  const chapter = chapters.find((c) => c.id === pick.chapter) ?? chapters[0];
  const classes = [...new Set(chapters.map((c) => c.cls))];
  const subjects = [...new Set(chapters.filter((c) => c.cls === chapter?.cls).map((c) => c.subject))];
  const inSubject = chapters.filter((c) => c.cls === chapter?.cls && c.subject === chapter?.subject);
  const open = (c: Chapter | undefined) => { if (c) setPick({ chapter: c.id, out: [] }); };
  const known = chapter?.topics.map((t) => t.key) ?? [];
  // every topic but the ones left out (and every topic, if that would leave none)
  const left = pick.chapter === chapter?.id ? known.filter((k) => !pick.out.includes(k)) : known;
  const chosen = left.length ? left : known;
  const chosenKey = chosen.join('\u0000');
  const items: Item[] = useMemo(
    () => (chapter?.questions ?? []).filter((q) => chosenKey.split('\u0000').includes(topicKey(q))).map((q) => ({ id: q.id, question: q.question, answer: q.answer })),
    [chapter, chosenKey],
  );
  const seed = seedOf(`${chapter?.id}|${chosenKey}|${round}`);
  // other questions make another puzzle, even with the same seed: the game on screen starts afresh
  const made = seedOf(items.map((i) => `${i.id}|${i.question}|${i.answer}`).join('\n'));
  // every game these questions can make (each one already checked), so the player can switch between them
  const games = useMemo(() => {
    const out: Partial<Record<GameType, Game>> = {};
    for (const t of GAME_TYPES) { const g = makeGame(t, items, seed); if (g) out[t] = g; }
    return out;
  }, [items, seed]);
  const type = want && games[want] ? want : GAME_TYPES.find((t) => games[t]);
  const game = type && games[type];
  const missing = GAME_TYPES.filter((t) => !games[t]);

  const toggle = (k: string) => {
    const out = pick.chapter === chapter!.id ? pick.out.filter((t) => known.includes(t)) : [];
    if (chosen.includes(k)) { if (chosen.length > 1) setPick({ chapter: chapter!.id, out: [...out, k] }); }
    else setPick({ chapter: chapter!.id, out: out.filter((t) => t !== k) });
  };

  const pill = cn('rounded-full font-bold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand', compact ? 'min-h-9 px-3 text-[12px]' : 'min-h-10 px-3.5 text-[13px]');
  const label = cn('font-semibold text-warm-secondary', compact ? 'text-[11px]' : 'text-[12px]');
  const box = cn('flex flex-col rounded-[24px] bg-muted', compact ? 'gap-3 p-3 sm:p-4' : 'gap-4 p-4 sm:p-6');

  if (!chapter) return heading ? <div className="flex flex-col gap-3">{heading}</div> : null;

  return (
    <div className={cn('flex flex-col', compact ? 'gap-3' : 'gap-4')}>
      {heading}
      <section aria-label="What are you revising?" className={box}>
        {!compact && <h2 className="text-[15px] font-bold text-foreground">What are you revising?</h2>}
        {(!compact || classes.length > 1 || subjects.length > 1) && (
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            <div className="flex flex-col gap-1.5">
              <span className={label} id={`class-l${compact ? '-p' : ''}`}>Class</span>
              <div className="flex flex-wrap gap-1" role="radiogroup" aria-labelledby={`class-l${compact ? '-p' : ''}`}>
                {classes.map((n) => (
                  <button key={n} type="button" role="radio" aria-checked={n === chapter.cls} onClick={() => open(chapters.find((c) => c.cls === n))}
                    className={cn(pill, n === chapter.cls ? 'bg-panel text-background' : 'bg-card text-warm-secondary hover:text-foreground')}>Class {n}</button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className={label} id={`subject-l${compact ? '-p' : ''}`}>Subject</span>
              <div className="flex flex-wrap gap-1" role="radiogroup" aria-labelledby={`subject-l${compact ? '-p' : ''}`}>
                {subjects.map((s) => (
                  <button key={s} type="button" role="radio" aria-checked={s === chapter.subject} onClick={() => open(chapters.find((c) => c.cls === chapter.cls && c.subject === s))}
                    className={cn(pill, s === chapter.subject ? 'bg-panel text-background' : 'bg-card text-warm-secondary hover:text-foreground')}>{s}</button>
                ))}
              </div>
            </div>
          </div>
        )}
        {(!compact || inSubject.length > 1) && (
          <div className="flex flex-col gap-1.5">
            <span className={label} id={`chapter-l${compact ? '-p' : ''}`}>Chapter</span>
            <ul className={cn('grid grid-cols-1 gap-2', compact ? 'sm:grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-3')} aria-labelledby={`chapter-l${compact ? '-p' : ''}`}>
              {inSubject.map((c) => (
                <li key={c.id}>
                  <button type="button" aria-pressed={c.id === chapter.id} onClick={() => open(c)}
                    className={cn('flex h-full w-full flex-col items-start gap-0.5 rounded-2xl text-left transition-[background-color,transform] duration-150 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
                      compact ? 'p-3' : 'p-4',
                      c.id === chapter.id ? 'bg-panel text-background' : 'bg-card text-foreground shadow-border')}>
                    <span className={cn('text-[12px] font-semibold', c.id === chapter.id ? 'text-brand' : 'text-warm-meta')}>{c.no !== null ? `Chapter ${c.no}` : 'Chapter'}</span>
                    <b className={compact ? 'text-[14px]' : 'text-[15px]'}>{c.name || 'No name yet'}</b>
                    <span className={cn('text-[12px]', c.id === chapter.id ? 'text-background/70' : 'text-warm-secondary')}>{plural(c.topics.length, 'topic')} · {plural(c.questions.length, 'question')}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <fieldset className="flex flex-col gap-1.5">
          <legend className={cn(label, 'mb-1.5')}>
            {compact ? `Topics in ${chapter.no !== null ? `Chapter ${chapter.no}` : 'this chapter'}: all are in, tap one to leave it out` : `Which topics of Chapter ${chapter.no} did you study?`}
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {chapter.topics.map((t) => (
              <label key={t.key} className={cn('flex cursor-pointer items-center gap-1.5 rounded-full font-semibold transition-colors duration-150 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand',
                compact ? 'min-h-9 px-3 text-[12px]' : 'min-h-10 px-3.5 text-[13px]',
                chosen.includes(t.key) ? 'bg-brand-blue-subtle text-brand-blue-deep' : 'bg-card text-warm-secondary')}>
                <input type="checkbox" className="sr-only" checked={chosen.includes(t.key)} onChange={() => toggle(t.key)} />
                {t.no !== null && <b>{t.no}</b>} {t.name} <span className="font-normal opacity-70">({t.count})</span>
              </label>
            ))}
          </div>
        </fieldset>
      </section>

      <section aria-label="Puzzle" className={box}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div role="tablist" aria-label="Game" className="flex max-w-full flex-wrap items-center gap-1 rounded-[20px] bg-card p-1 sm:rounded-full">
            {GAME_TYPES.map((t) => (
              <button key={t} type="button" role="tab" aria-selected={t === type} disabled={!games[t]} onClick={() => setWant(t)}
                title={whyNot(t, items, !!games[t]) ?? undefined}
                className={cn('flex items-center rounded-full font-bold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:text-warm-label disabled:line-through',
                  compact ? 'h-8 px-2.5 text-[12px]' : 'h-9 px-3 text-[13px]',
                  t === type ? 'bg-muted text-foreground' : 'text-warm-secondary hover:text-foreground')}>
                {GAME_NAMES[t]}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {extra?.({ chapterId: chapter.id, topics: chosen })}
            <button type="button" className={chip('card')} onClick={() => setRound((r) => r + 1)}><Shuffle aria-hidden /> New puzzle</button>
          </div>
        </div>
        {compact && missing.length > 0 && (
          <ul className="flex flex-col gap-1 text-[12px] text-warm-secondary">
            {missing.map((t) => <li key={t}><b className="text-foreground">{GAME_NAMES[t]}:</b> {whyNot(t, items, false)}</li>)}
          </ul>
        )}
        <div className={cn('rounded-2xl bg-card', compact ? 'p-3' : 'p-4 sm:p-6')}>
          {game ? <GameView key={`${type}|${seed}|${made}`} game={game} compact={compact} onNext={() => setRound((r) => r + 1)} />
            : <p className="py-6 text-center text-[14px] text-warm-secondary">These topics don't have enough questions for a puzzle yet. {compact ? 'Add a few more.' : 'Pick more topics.'}</p>}
        </div>
      </section>
    </div>
  );
}
