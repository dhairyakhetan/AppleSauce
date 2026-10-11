import { useEffect, useMemo, useState } from 'react';
import { Maximize2, Shuffle } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { GAME_TYPES, makeGame, seedOf, type Game, type GameType, type Item } from '@/lib/games/engine';
import type { Row } from '@/lib/games/rows';
import { cn } from '@/lib/utils';
import { GameView } from './GameView';
import { chip, GAME_NAMES, plural, whyNot } from './helpers';

/* "How it will look": a small, playable version of what students get on Try the games, made from the questions in
   the Questions box as they are written (the same engine, so it is exactly the puzzle a student would see from these
   questions). A game these questions can't make is greyed out, with what it needs. Nothing here is saved or sent. */

/** The value, once it has stopped changing for `ms`: the games aren't rebuilt on every key press. */
function useSettled<T>(value: T, key: string, ms = 450): T {
  const [settled, setSettled] = useState({ value, key });
  useEffect(() => {
    if (key === settled.key) return;
    const t = setTimeout(() => setSettled({ value, key }), ms);
    return () => clearTimeout(t);
  }, [key, value, ms, settled.key]);
  return settled.value;
}

export function GamePreview({ rows }: { rows: Row[] }) {
  const sig = rows.map((r) => `${r.chapter_id}|${r.chapter_no}|${r.chapter}|${r.question}|${r.answer}`).join('\n');
  const settled = useSettled(rows, sig);
  const [want, setWant] = useState<GameType | null>(null);
  const [round, setRound] = useState(0);
  const [pick, setPick] = useState<string | null>(null);
  const [big, setBig] = useState(false);

  // one chapter at a time, as students play them
  const chapters = useMemo(() => {
    const m = new Map<string, { key: string; title: string; rows: Row[] }>();
    for (const r of settled) {
      const key = r.chapter_id ?? `${r.board}|${r.class}|${r.subject}|${r.chapter_no}|${r.chapter}`;
      const c = m.get(key) ?? { key, title: [r.chapter_no !== null && `Chapter ${r.chapter_no}`, r.chapter].filter(Boolean).join(': ') || 'No chapter', rows: [] };
      c.rows.push(r);
      m.set(key, c);
    }
    return [...m.values()];
  }, [settled]);
  const chapter = chapters.find((c) => c.key === pick) ?? chapters[0];
  const items: Item[] = useMemo(() => (chapter?.rows ?? []).map((r) => ({ id: `L${r.line}`, question: r.question, answer: r.answer })), [chapter]);
  const seed = seedOf(`${chapter?.key}|${round}`);
  // a different set of questions is a different puzzle: the game starts afresh
  const made = seedOf(items.map((i) => `${i.question}|${i.answer}`).join('\n'));
  const games = useMemo(() => {
    const out: Partial<Record<GameType, Game>> = {};
    for (const t of GAME_TYPES) { const g = makeGame(t, items, seed); if (g) out[t] = g; }
    return out;
  }, [items, seed]);
  const type = want && games[want] ? want : GAME_TYPES.find((t) => games[t]);
  const game = type && games[type];
  const missing = GAME_TYPES.filter((t) => !games[t]);

  return (
    <section aria-labelledby="preview-h" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="preview-h" className="text-[15px] font-bold text-foreground">3. See how it plays</h2>
        {game && (
          <div className="flex flex-wrap gap-2">
            <button type="button" className={chip('card')} onClick={() => setRound((r) => r + 1)}><Shuffle aria-hidden /> Shuffle</button>
            <button type="button" className={chip('card')} onClick={() => setBig(true)}><Maximize2 aria-hidden /> Full size</button>
          </div>
        )}
      </div>
      <p className="text-[14px] text-warm-secondary">
        {rows.length ? 'Students play short puzzles made from approved questions. This is one made from yours, right now. Try it.' : 'A small game made from your questions shows here as you write.'}
      </p>

      {chapters.length > 1 && (
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Chapter">
          {chapters.map((c) => (
            <button key={c.key} type="button" role="radio" aria-checked={c === chapter} onClick={() => { setPick(c.key); setRound(0); }}
              className={cn('min-h-9 rounded-full px-3 text-[13px] font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
                c === chapter ? 'bg-panel text-background' : 'bg-card text-warm-secondary hover:text-foreground')}>
              {c.title}
            </button>
          ))}
        </div>
      )}

      {rows.length > 0 && (
        <>
          <div role="tablist" aria-label="Game" className="flex max-w-full flex-wrap items-center gap-1 rounded-[20px] bg-card p-1 sm:w-fit sm:rounded-full">
            {GAME_TYPES.map((t) => (
              <button key={t} type="button" role="tab" aria-selected={t === type} disabled={!games[t]} title={whyNot(t, items, !!games[t]) ?? undefined} onClick={() => setWant(t)}
                className={cn('flex h-9 items-center rounded-full px-3 text-[13px] font-bold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:text-warm-label disabled:line-through',
                  t === type ? 'bg-muted text-foreground' : 'text-warm-secondary hover:text-foreground')}>
                {GAME_NAMES[t]}
              </button>
            ))}
          </div>
          {missing.length > 0 && (
            <ul className="flex flex-col gap-1 text-[13px] text-warm-secondary">
              {missing.map((t) => <li key={t}><b className="text-foreground">{GAME_NAMES[t]}:</b> {whyNot(t, items, false)}</li>)}
            </ul>
          )}
          <div className="rounded-2xl bg-card p-3 shadow-border sm:p-4">
            {game ? <GameView key={`${type}|${seed}|${made}`} game={game} compact onNext={() => setRound((r) => r + 1)} />
              : <p className="py-6 text-center text-[14px] text-warm-secondary">No game can be made from {plural(items.length, 'question')} yet. Add a few more.</p>}
          </div>
        </>
      )}

      <Dialog open={big && !!game} onOpenChange={setBig}>
        <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto rounded-2xl">
          <DialogTitle>{type && GAME_NAMES[type]}</DialogTitle>
          <DialogDescription>Full size, as students see it on Try the games.</DialogDescription>
          {game && <GameView key={`big|${type}|${seed}|${made}`} game={game} onNext={() => setRound((r) => r + 1)} />}
        </DialogContent>
      </Dialog>
    </section>
  );
}
