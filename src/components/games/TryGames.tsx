import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Shuffle } from 'lucide-react';
import type { GamesApi } from '@/lib/games/api';
import { GAME_TYPES, makeGame, seedOf, type Game, type GameType, type Item } from '@/lib/games/engine';
import type { BankQuestion } from '@/lib/games/rows';
import { cn } from '@/lib/utils';
import { GameView } from './GameView';
import { btn, chip, GAME_NAMES, plural } from './helpers';
import { Empty, Loading, LoadFailed } from './shared';

/* Try the games: what students will get, played by the team for now. Only approved questions are used. Pick a class,
   subject and chapter, and the topics studied; a puzzle is made from those questions on the device by the games engine
   (src/lib/games/engine), which checks every puzzle before it is shown. A game these topics can't make is greyed out. */

interface Topic { key: string; no: number | null; name: string; count: number }
interface Chapter { id: string; cls: number | null; subject: string; no: number | null; name: string; topics: Topic[]; questions: BankQuestion[] }

const topicKey = (q: BankQuestion) => q.topic_id ?? `${q.chapter_id}|${q.topic}`;

/** Approved questions grouped into chapters and their topics, by class, subject and chapter number. */
function chaptersOf(questions: BankQuestion[]): Chapter[] {
  const byChapter = new Map<string, BankQuestion[]>();
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

const PILL = 'min-h-10 rounded-full px-3.5 text-[13px] font-bold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand';

export function TryGames({ api }: { api: GamesApi }) {
  const [bank, setBank] = useState<{ data?: BankQuestion[]; error?: string }>({});
  const load = useCallback(() => {
    setBank((b) => ({ data: b.data }));
    api.loadQuestionBank().then((data) => setBank({ data }), (e: Error) => setBank((b) => ({ data: b.data, error: e.message })));
  }, [api]);
  useEffect(load, [load]);

  const chapters = useMemo(() => chaptersOf(bank.data ?? []), [bank.data]);
  const [pick, setPickState] = useState({ chapter: '', topics: [] as string[] });
  const [round, setRound] = useState(0);
  const [want, setWant] = useState<GameType | null>(null);
  const setPick = (p: { chapter: string; topics: string[] }) => {
    setPickState(p);
    setRound(0);
  };

  const chapter = chapters.find((c) => c.id === pick.chapter) ?? chapters[0];
  const classes = [...new Set(chapters.map((c) => c.cls))];
  const subjects = [...new Set(chapters.filter((c) => c.cls === chapter?.cls).map((c) => c.subject))];
  const inSubject = chapters.filter((c) => c.cls === chapter?.cls && c.subject === chapter?.subject);
  const open = (c: Chapter | undefined) => { if (c) setPick({ chapter: c.id, topics: [] }); };
  const known = new Set(chapter?.topics.map((t) => t.key));
  const chosen = pick.chapter === chapter?.id && pick.topics.some((t) => known.has(t)) ? pick.topics.filter((t) => known.has(t)) : [...known];
  const chosenKey = chosen.join('|');
  const items: Item[] = useMemo(
    () => (chapter?.questions ?? []).filter((q) => chosenKey.split('|').includes(topicKey(q))).map((q) => ({ id: q.id, question: q.question, answer: q.answer })),
    [chapter, chosenKey],
  );
  const seed = seedOf(`${chapter?.id}|${chosenKey}|${round}`);
  // every game these questions can make (each one already checked), so the player can switch between them
  const games = useMemo(() => {
    const out: Partial<Record<GameType, Game>> = {};
    for (const t of GAME_TYPES) { const g = makeGame(t, items, seed); if (g) out[t] = g; }
    return out;
  }, [items, seed]);
  const type = want && games[want] ? want : GAME_TYPES.find((t) => games[t]);
  const game = type && games[type];

  const toggle = (k: string) => {
    const next = chosen.includes(k) ? chosen.filter((t) => t !== k) : [...chosen, k];
    if (next.length) setPick({ chapter: chapter!.id, topics: next });
  };

  if (!chapter) {
    return bank.error ? <LoadFailed what="The question bank" error={bank.error} onRetry={load} />
      : !bank.data ? <Loading label="Loading the questions" />
      : (
        <Empty>
          <p><b className="text-foreground">The question bank is empty.</b> Questions appear here once the team sends them and an HoD approves them.</p>
          <Link className={btn('card', 'mt-3')} to="/games">Go to Write questions</Link>
        </Empty>
      );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-prose text-[14px] text-warm-secondary">What students will get: pick the topics they studied, and play a short puzzle made from the approved questions.</p>

      <section aria-labelledby="pick-h" className="flex flex-col gap-4 rounded-[24px] bg-muted p-4 sm:p-6">
        <h2 id="pick-h" className="text-[15px] font-bold text-foreground">What are you revising?</h2>
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-[12px] font-semibold text-warm-secondary" id="class-l">Class</span>
            <div className="flex flex-wrap gap-1" role="radiogroup" aria-labelledby="class-l">
              {classes.map((n) => (
                <button key={n} type="button" role="radio" aria-checked={n === chapter.cls} onClick={() => open(chapters.find((c) => c.cls === n))}
                  className={cn(PILL, n === chapter.cls ? 'bg-panel text-background' : 'bg-card text-warm-secondary hover:text-foreground')}>Class {n}</button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-[12px] font-semibold text-warm-secondary" id="subject-l">Subject</span>
            <div className="flex flex-wrap gap-1" role="radiogroup" aria-labelledby="subject-l">
              {subjects.map((s) => (
                <button key={s} type="button" role="radio" aria-checked={s === chapter.subject} onClick={() => open(chapters.find((c) => c.cls === chapter.cls && c.subject === s))}
                  className={cn(PILL, s === chapter.subject ? 'bg-panel text-background' : 'bg-card text-warm-secondary hover:text-foreground')}>{s}</button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] font-semibold text-warm-secondary" id="chapter-l">Chapter</span>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3" aria-labelledby="chapter-l">
            {inSubject.map((c) => (
              <li key={c.id}>
                <button type="button" aria-pressed={c.id === chapter.id} onClick={() => open(c)}
                  className={cn('flex h-full w-full flex-col items-start gap-0.5 rounded-2xl p-4 text-left transition-[background-color,transform] duration-150 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
                    c.id === chapter.id ? 'bg-panel text-background' : 'bg-card text-foreground shadow-border')}>
                  <span className={cn('text-[12px] font-semibold', c.id === chapter.id ? 'text-brand' : 'text-warm-meta')}>Chapter {c.no}</span>
                  <b className="text-[15px]">{c.name}</b>
                  <span className={cn('text-[12px]', c.id === chapter.id ? 'text-background/70' : 'text-warm-secondary')}>{plural(c.topics.length, 'topic')} · {plural(c.questions.length, 'question')}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-[12px] font-semibold text-warm-secondary">Which topics of Chapter {chapter.no} did you study?</legend>
          <div className="flex flex-wrap gap-1.5">
            {chapter.topics.map((t) => (
              <label key={t.key} className={cn('flex min-h-10 cursor-pointer items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold transition-colors duration-150 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand',
                chosen.includes(t.key) ? 'bg-brand-blue-subtle text-brand-blue-deep' : 'bg-card text-warm-secondary')}>
                <input type="checkbox" className="sr-only" checked={chosen.includes(t.key)} onChange={() => toggle(t.key)} />
                {t.no !== null && <b>{t.no}</b>} {t.name} <span className="font-normal opacity-70">({t.count})</span>
              </label>
            ))}
          </div>
        </fieldset>
      </section>

      <section aria-label="Puzzle" className="flex flex-col gap-4 rounded-[24px] bg-muted p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div role="tablist" aria-label="Game" className="flex max-w-full flex-wrap items-center gap-1 rounded-[20px] bg-card p-1 sm:rounded-full">
            {GAME_TYPES.map((t) => (
              <button key={t} type="button" role="tab" aria-selected={t === type} disabled={!games[t]} onClick={() => setWant(t)}
                title={games[t] ? undefined : "These topics don't have enough suitable answers for this game"}
                className={cn('flex h-9 items-center rounded-full px-3 text-[13px] font-bold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:text-warm-label disabled:line-through',
                  t === type ? 'bg-muted text-foreground' : 'text-warm-secondary hover:text-foreground')}>
                {GAME_NAMES[t]}
              </button>
            ))}
          </div>
          <button type="button" className={chip('card')} onClick={() => setRound((r) => r + 1)}><Shuffle aria-hidden /> New puzzle</button>
        </div>
        <div className="rounded-2xl bg-card p-4 sm:p-6">
          {game ? <GameView key={`${type}|${seed}`} game={game} onNext={() => setRound((r) => r + 1)} />
            : <p className="py-6 text-center text-[14px] text-warm-secondary">These topics don't have enough questions for a puzzle yet. Pick more topics.</p>}
        </div>
      </section>
    </div>
  );
}
