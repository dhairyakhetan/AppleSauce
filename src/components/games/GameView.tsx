import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import type { Game } from '@/lib/games/engine';
import type { Choice } from '@/lib/games/engine/choice';
import type { Crossword } from '@/lib/games/engine/crossword';
import type { FillIn } from '@/lib/games/engine/fill';
import type { Matching } from '@/lib/games/engine/matching';
import { mark, type Mark } from '@/lib/games/engine/answers';
import { loose, shownAnswer } from '@/lib/games/engine/shared';
import type { WordSearch } from '@/lib/games/engine/wordsearch';
import { cn } from '@/lib/utils';
import { btn, chip, plural } from './helpers';
import './games.css';

/* The four games, playable: matching (tap a question, then its answer), fill in the blank (type into the gap), word
   search (drag across the letters, or tap the first and last letter) and crossword (tap a square and type). Each takes
   a puzzle already made and checked by src/lib/games/engine. `compact`: the small version in the formatter's preview. */

type Props = { onNext: () => void; compact?: boolean };

export function GameView({ game, onNext, compact = false }: { game: Game } & Props) {
  const body = game.type === 'matching' ? <MatchingGame g={game} onNext={onNext} compact={compact} />
    : game.type === 'fill' ? <FillGame g={game} onNext={onNext} compact={compact} />
    : game.type === 'wordsearch' ? <WordSearchGame g={game} onNext={onNext} compact={compact} />
    : game.type === 'choice' ? <ChoiceGame g={game} onNext={onNext} compact={compact} />
    : <CrosswordGame g={game} onNext={onNext} compact={compact} />;
  return <div className={cn('flex flex-col gap-3', compact && 'games-compact')}>{body}</div>;
}

function How({ children, compact }: { children: ReactNode; compact: boolean }) {
  return compact ? null : <p className="text-[14px] text-warm-secondary">{children}</p>;
}

function Progress({ done, total, children }: { done: number; total: number; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="h-2 min-w-24 flex-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
        <span className="block h-full rounded-full bg-brand transition-[width] duration-300" style={{ width: `${(100 * done) / total}%` }} />
      </div>
      <span className="text-[13px] tabular-nums text-warm-secondary">{done} of {total}</span>
      {children}
    </div>
  );
}

function Solved({ text, onNext, compact }: { text: string; onNext: () => void; compact: boolean }) {
  return (
    <div className="animate-fade-slide-up flex flex-wrap items-center gap-3 rounded-2xl bg-mint px-4 py-3" role="status">
      <span className="grid size-8 place-items-center rounded-full bg-success text-card"><Check className="size-4" aria-hidden /></span>
      <b className="flex-1 text-[15px] text-foreground">{text}</b>
      <button type="button" className={btn('dark', compact ? 'min-h-9 text-[13px]' : undefined)} onClick={onNext}>{compact ? 'Another one' : 'Next puzzle'}</button>
    </div>
  );
}

// ---------------------------------------------------------------- matching

function MatchingGame({ g, onNext, compact }: { g: Matching } & Required<Props>) {
  const [sel, setSel] = useState<{ side: 'left' | 'right'; id: string } | null>(null);
  const [matched, setMatched] = useState<string[]>([]);
  const [wrong, setWrong] = useState<string[]>([]);
  const [mistakes, setMistakes] = useState(0);

  const pick = (side: 'left' | 'right', id: string) => {
    if (matched.includes(id) && side === 'left') return;
    if (!sel || sel.side === side) { setSel(sel?.side === side && sel.id === id ? null : { side, id }); return; }
    if (sel.id === id) setMatched([...matched, id]);
    else {
      setWrong([`${sel.side}:${sel.id}`, `${side}:${id}`]);
      setMistakes((m) => m + 1);
      setTimeout(() => setWrong([]), 450);
    }
    setSel(null);
  };
  const tile = (side: 'left' | 'right', id: string) => {
    const n = matched.indexOf(id);
    return cn(
      'w-full rounded-2xl border-2 border-transparent bg-card px-3 text-left text-foreground shadow-border transition-[background-color,border-color,transform] duration-150 active:scale-[0.98] disabled:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
      compact ? 'min-h-10 py-1.5 text-[13px]' : 'min-h-[52px] py-2.5 text-[15px]',
      side === 'right' && 'font-bold',
      n >= 0 && `games-matched games-c${n % 6} shadow-none`,
      sel?.side === side && sel.id === id && 'border-brand-blue bg-brand-blue-subtle',
      wrong.includes(`${side}:${id}`) && 'border-destructive bg-destructive/10',
    );
  };
  const done = matched.length === g.left.length;

  return (
    <>
      <How compact={compact}>Tap a question, then its answer.</How>
      <Progress done={matched.length} total={g.left.length} />
      <div className="grid grid-cols-2 gap-2 sm:gap-3">
        {(['left', 'right'] as const).map((side) => (
          <ul key={side} aria-label={side === 'left' ? 'Questions' : 'Answers'} className="flex flex-col gap-2">
            {g[side].map((x) => (
              <li key={x.id}>
                <button type="button" data-id={x.id} className={tile(side, x.id)} disabled={matched.includes(x.id)} onClick={() => pick(side, x.id)}>{x.text}</button>
              </li>
            ))}
          </ul>
        ))}
      </div>
      {done && <Solved compact={compact} text={mistakes ? `All matched, with ${plural(mistakes, 'wrong try', 'wrong tries')}.` : 'All matched, first time!'} onNext={onNext} />}
    </>
  );
}

// ---------------------------------------------------------------- fill in the blank

/** Points as people say them: 4½, ½, 3. */
const points = (p: number) => (Number.isInteger(p) ? `${p}` : `${Math.floor(p) || ''}½`);

function FillGame({ g, onNext, compact }: { g: FillIn } & Required<Props>) {
  const [typed, setTyped] = useState<Record<string, string>>({});
  /** right: a point; almost: a spelling slip, half a point; shown: the answer was revealed, no point. */
  const [state, setState] = useState<Record<string, Mark | 'shown'>>({});
  const [tries, setTries] = useState<Record<string, number>>({});
  const answers = g.rows.map((r) => r.answer);
  const check = (r: FillIn['rows'][number]) => {
    const v = typed[r.id] ?? '';
    if (!v.trim() || (state[r.id] && state[r.id] !== 'wrong')) return;
    const m = mark(v, r.answer, { question: `${r.before} ${r.after}`, others: answers });
    setState((s) => ({ ...s, [r.id]: m }));
    if (m === 'wrong') setTries((t) => ({ ...t, [r.id]: (t[r.id] ?? 0) + 1 }));
  };
  const solved = g.rows.filter((r) => state[r.id] && state[r.id] !== 'wrong').length;
  const score = g.rows.reduce((n, r) => n + (state[r.id] === 'right' ? 1 : state[r.id] === 'almost' ? 0.5 : 0), 0);

  return (
    <>
      <How compact={compact}>Type the missing word or words, then press Enter.</How>
      <Progress done={solved} total={g.rows.length}>
        <button type="button" className={chip('quiet')} onClick={() => g.rows.forEach(check)}>Check all</button>
      </Progress>
      <ol className={cn('flex list-decimal flex-col gap-3 pl-6 marker:text-warm-meta', compact ? 'text-[14px] leading-9' : 'text-[17px] leading-[2.3]')}>
        {g.rows.map((r) => {
          const st = state[r.id];
          const locked = !!st && st !== 'wrong';
          const shown = shownAnswer(r.answer);
          // a shorter answer that counts, or a slip: the full answer, spelt right, beside it
          const full = (st === 'right' || st === 'almost') && loose(typed[r.id] ?? '') !== loose(shown);
          return (
            <li key={r.id}>
              <span>{r.before}</span>
              <input
                type="text" aria-label="Answer" autoComplete="off" autoCapitalize="off" spellCheck={false}
                className={cn(
                  // wrong to right (or back to typing) fades from one colour to the next
                  'mx-1 inline-block h-10 max-w-full rounded-xl border px-2 text-center align-middle font-bold outline-none transition-[background-color,border-color,color] duration-300 ease-out focus-visible:ring-2 focus-visible:ring-brand',
                  compact ? 'h-8 text-[14px]' : 'text-[17px]',
                  st === 'right' ? 'border-success bg-success-subtle-bg text-success-subtle-text'
                    : st === 'almost' ? 'border-brand bg-brand-subtle text-brand-deep'
                    : st === 'wrong' ? 'border-destructive bg-destructive/10'
                    : st === 'shown' ? 'border-border bg-muted text-warm-secondary' : 'border-border bg-card',
                )}
                style={{ width: `${Math.min(26, Math.max(7, shown.length + 2))}ch` }}
                value={st === 'shown' ? shown : typed[r.id] ?? ''} readOnly={locked}
                onChange={(e) => { setTyped((t) => ({ ...t, [r.id]: e.target.value })); if (st === 'wrong') setState((s) => { const n = { ...s }; delete n[r.id]; return n; }); }}
                onKeyDown={(e) => { if (e.key === 'Enter') check(r); }}
                onBlur={() => check(r)}
              />
              <span>{r.after}</span>
              {st === 'right' && <Check className="ml-1 inline size-5 animate-pop align-middle text-success" aria-label="Right" />}
              {st === 'almost' && (
                <span className="ml-1 inline-flex animate-pop items-center gap-1 rounded-full bg-brand-subtle px-2 align-middle text-[13px] font-bold leading-6 text-brand-deep" aria-label="Almost: half a point for a spelling slip">½ Check the spelling</span>
              )}
              {full && <span className={cn('ml-2 inline-block animate-fade-slide-up align-middle text-[13px] font-semibold', st === 'almost' ? 'text-brand-deep' : 'text-success-subtle-text')}>{shown}</span>}
              {st === 'wrong' && (tries[r.id] ?? 0) >= 2 && (
                <button type="button" className={chip('quiet', 'ml-2 align-middle')} onClick={() => setState((s) => ({ ...s, [r.id]: 'shown' }))}>Show answer</button>
              )}
            </li>
          );
        })}
      </ol>
      {solved === g.rows.length && <Solved compact={compact} text={`${points(score)} of ${g.rows.length} points.`} onNext={onNext} />}
    </>
  );
}

// ---------------------------------------------------------------- multiple choice

function ChoiceGame({ g, onNext, compact }: { g: Choice } & Required<Props>) {
  /** The options tried for each question; a question is done once its answer is among them. */
  const [tried, setTried] = useState<Record<string, string[]>>({});
  const pick = (id: string, option: string) => setTried((t) => (t[id]?.includes(option) ? t : { ...t, [id]: [...(t[id] ?? []), option] }));
  const isDone = (r: Choice['rows'][number]) => (tried[r.id] ?? []).includes(r.answer);
  const done = g.rows.filter(isDone).length;
  const firstTime = g.rows.filter((r) => tried[r.id]?.[0] === r.answer).length;

  return (
    <>
      <How compact={compact}>Tap the right answer.</How>
      <Progress done={done} total={g.rows.length} />
      <ol className={cn('flex list-decimal flex-col pl-6 marker:text-warm-meta', compact ? 'gap-3 text-[14px]' : 'gap-5 text-[16px]')}>
        {g.rows.map((r) => {
          const mine = tried[r.id] ?? [];
          const finished = isDone(r);
          return (
            <li key={r.id} className="flex flex-col gap-2">
              <p className="font-semibold text-foreground">{r.question}</p>
              <div className={cn('grid gap-2', compact ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-2')} role="group" aria-label="Options">
                {r.options.map((o) => {
                  const chosen = mine.includes(o);
                  const right = o === r.answer;
                  return (
                    <button key={o} type="button" disabled={finished || chosen} onClick={() => pick(r.id, o)}
                      aria-pressed={chosen}
                      className={cn(
                        // a wrong pick fades to red and stays out; the right one fades to green
                        'flex w-full items-center justify-between gap-2 rounded-2xl border-2 px-3 text-left font-semibold transition-[background-color,border-color,color,opacity,transform] duration-300 ease-out active:scale-[0.98] disabled:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
                        compact ? 'min-h-10 py-1.5 text-[13px]' : 'min-h-[52px] py-2.5 text-[15px]',
                        chosen && right ? 'border-success bg-success-subtle-bg text-success-subtle-text'
                          : chosen ? 'border-destructive bg-destructive/10 text-foreground'
                          : finished ? 'border-transparent bg-card text-warm-secondary opacity-60'
                          : 'border-transparent bg-card text-foreground shadow-border hover:border-brand-blue',
                      )}>
                      <span>{o}</span>
                      {chosen && right && <Check className="size-5 shrink-0 animate-pop text-success" aria-label="Right" />}
                      {chosen && !right && <span className="shrink-0 animate-pop text-[12px] font-bold text-destructive">Not this one</span>}
                    </button>
                  );
                })}
              </div>
            </li>
          );
        })}
      </ol>
      {done === g.rows.length && <Solved compact={compact} text={`${firstTime} of ${g.rows.length} right first time.`} onNext={onNext} />}
    </>
  );
}

// ---------------------------------------------------------------- word search

type Cell = [number, number];
const cellsOf = (w: WordSearch['words'][number]): Cell[] => Array.from({ length: w.word.length }, (_, i) => [w.row + w.dr * i, w.col + w.dc * i]);
const sameCells = (a: Cell[], b: Cell[]) => a.length === b.length && (a.every((c, i) => c[0] === b[i][0] && c[1] === b[i][1]) || a.every((c, i) => c[0] === b[b.length - 1 - i][0] && c[1] === b[b.length - 1 - i][1]));

/** A straight line of cells from `a` towards `b`, snapped to the nearest of the eight directions. */
function line(a: Cell, b: Cell, n: number): Cell[] {
  const dr = b[0] - a[0];
  const dc = b[1] - a[1];
  if (!dr && !dc) return [a];
  const oct = Math.round(Math.atan2(dr, dc) / (Math.PI / 4));
  const sr = Math.round(Math.sin((oct * Math.PI) / 4));
  const sc = Math.round(Math.cos((oct * Math.PI) / 4));
  let len = Math.max(Math.abs(dr), Math.abs(dc));
  while (len > 0 && (a[0] + sr * len < 0 || a[0] + sr * len >= n || a[1] + sc * len < 0 || a[1] + sc * len >= n)) len--;
  return Array.from({ length: len + 1 }, (_, i) => [a[0] + sr * i, a[1] + sc * i]);
}

function WordSearchGame({ g, onNext, compact }: { g: WordSearch } & Required<Props>) {
  const [found, setFound] = useState<string[]>([]);
  const [path, setPath] = useState<Cell[]>([]);
  const [anchor, setAnchor] = useState<Cell | null>(null); // first tap of tap-tap selection
  const [miss, setMiss] = useState(false);
  const [showWords, setShowWords] = useState(false);
  const drag = useRef<Cell | null>(null);
  const moved = useRef(false);

  const color = useMemo(() => {
    const m = new Map<string, number>();
    found.forEach((id, i) => { for (const c of cellsOf(g.words.find((w) => w.id === id)!)) m.set(`${c[0]},${c[1]}`, i % 6); });
    return m;
  }, [found, g.words]);
  const onPath = new Set(path.map((c) => `${c[0]},${c[1]}`));

  const cellAt = (x: number, y: number): Cell | null => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-r]');
    return el ? [Number(el.dataset.r), Number(el.dataset.c)] : null;
  };
  const finish = (cells: Cell[]) => {
    const hit = g.words.find((w) => !found.includes(w.id) && sameCells(cellsOf(w), cells));
    if (hit) setFound((f) => [...f, hit.id]);
    else if (cells.length > 1) { setMiss(true); setTimeout(() => setMiss(false), 400); }
    setPath([]);
  };

  return (
    <>
      <How compact={compact}>Drag across a word, or tap its first and last letter. Words read forwards: across, down or diagonally.</How>
      <Progress done={found.length} total={g.words.length}>
        <label className="flex items-center gap-1.5 text-[13px] text-warm-secondary">
          <input type="checkbox" className="size-4 accent-brand" checked={showWords} onChange={(e) => setShowWords(e.target.checked)} /> Show the words
        </label>
      </Progress>
      <div className="flex flex-wrap items-start gap-4">
        <div className="max-w-full overflow-x-auto">
          <div
            className={cn('games-ws-grid', miss && 'ring-2 ring-destructive')} style={{ ['--n' as string]: g.size }} role="grid" aria-label="Word search"
            onPointerDown={(e) => {
              const c = cellAt(e.clientX, e.clientY);
              if (!c) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              moved.current = false;
              if (anchor) { drag.current = anchor; setPath(line(anchor, c, g.size)); setAnchor(null); moved.current = true; return; }
              drag.current = c;
              setPath([c]);
            }}
            onPointerMove={(e) => {
              if (!drag.current) return;
              const c = cellAt(e.clientX, e.clientY);
              if (!c) return;
              const p = line(drag.current, c, g.size);
              if (p.length > 1) moved.current = true;
              setPath(p);
            }}
            onPointerUp={() => {
              if (!drag.current) return;
              const start = drag.current;
              drag.current = null;
              if (!moved.current) { setAnchor(start); return; } // a tap: wait for the last letter
              finish(path);
            }}
          >
            {g.grid.map((row, r) => [...row].map((ch, c) => {
              const k = `${r},${c}`;
              const col = color.get(k);
              return (
                <span key={k} data-r={r} data-c={c} role="gridcell"
                  className={cn('games-ws-cell', col !== undefined && `found games-c${col}`, onPath.has(k) && 'on', anchor && anchor[0] === r && anchor[1] === c && 'anchor')}>{ch}</span>
              );
            }))}
          </div>
        </div>
        <ol className={cn('flex min-w-[220px] flex-1 list-decimal flex-col gap-1.5 pl-5 marker:text-warm-meta', compact ? 'text-[13px]' : 'text-[15px]')}>
          {g.words.map((w) => {
            const got = found.includes(w.id);
            return (
              <li key={w.id}>
                {showWords || got ? <b className={cn(got && 'text-success line-through')}>{w.word}</b> : <span>{w.clue} <span className="text-warm-meta">({w.word.length})</span></span>}
                {got && !showWords && <span className="text-warm-meta"> · {w.clue}</span>}
              </li>
            );
          })}
        </ol>
      </div>
      {found.length === g.words.length && <Solved compact={compact} text="All words found!" onNext={onNext} />}
    </>
  );
}

// ---------------------------------------------------------------- crossword

function CrosswordGame({ g, onNext, compact }: { g: Crossword } & Required<Props>) {
  const blank = () => g.grid.map((row) => [...row].map((ch) => (ch === '#' ? '#' : '')));
  const [letters, setLetters] = useState<string[][]>(blank);
  const [cur, setCur] = useState<{ r: number; c: number; dir: 'across' | 'down' }>(() => ({ r: g.clues[0].row, c: g.clues[0].col, dir: g.clues[0].dir }));
  const [checked, setChecked] = useState(false);
  const [active, setActive] = useState(!compact); // the preview doesn't grab the keyboard until it is tapped
  const input = useRef<HTMLInputElement>(null);

  const numberAt = useMemo(() => new Map(g.clues.map((cl) => [`${cl.row},${cl.col}`, cl.n])), [g.clues]);
  const cellsOfClue = (cl: Crossword['clues'][number]): Cell[] => Array.from({ length: cl.answer.length }, (_, i) => (cl.dir === 'across' ? [cl.row, cl.col + i] : [cl.row + i, cl.col]));
  const clueAt = (r: number, c: number, dir: 'across' | 'down') => g.clues.find((cl) => cl.dir === dir && cellsOfClue(cl).some(([y, x]) => y === r && x === c));
  const clue = clueAt(cur.r, cur.c, cur.dir) ?? clueAt(cur.r, cur.c, cur.dir === 'across' ? 'down' : 'across')!;
  const inWord = new Set(cellsOfClue(clue).map(([y, x]) => `${y},${x}`));
  const done = g.grid.every((row, r) => [...row].every((ch, c) => ch === '#' || letters[r][c] === ch));

  useEffect(() => { if (active) input.current?.focus({ preventScroll: true }); }, [cur, active]);

  const select = (r: number, c: number) => {
    if (g.grid[r][c] === '#') return;
    setActive(true);
    const both = clueAt(r, c, 'across') && clueAt(r, c, 'down');
    const dir = r === cur.r && c === cur.c && both ? (cur.dir === 'across' ? 'down' : 'across') : clueAt(r, c, cur.dir) ? cur.dir : clueAt(r, c, 'across') ? 'across' : 'down';
    setCur({ r, c, dir });
  };
  const step = (by: 1 | -1) => {
    const cells = cellsOfClue(clue);
    const i = cells.findIndex(([y, x]) => y === cur.r && x === cur.c);
    const next = cells[i + by];
    if (next) setCur({ r: next[0], c: next[1], dir: clue.dir });
  };
  const type = (ch: string) => {
    if (done) return;
    setLetters((L) => L.map((row, r) => row.map((v, c) => (r === cur.r && c === cur.c ? ch : v))));
    setChecked(false);
    if (ch) step(1);
  };
  const jump = (cl: Crossword['clues'][number]) => { setActive(true); setCur({ r: cl.row, c: cl.col, dir: cl.dir }); };
  const reveal = (cells: Cell[]) => setLetters((L) => L.map((row, r) => row.map((v, c) => (cells.some(([y, x]) => y === r && x === c) ? g.grid[r][c] : v))));

  const keys = (e: KeyboardEvent) => {
    if (/^[a-z]$/i.test(e.key) && !e.ctrlKey && !e.metaKey) { e.preventDefault(); type(e.key.toUpperCase()); }
    else if (e.key === 'Backspace') {
      e.preventDefault();
      if (letters[cur.r][cur.c]) { type(''); return; }
      // on an empty square, go back one and clear that one
      const cells = cellsOfClue(clue);
      const prev = cells[cells.findIndex(([y, x]) => y === cur.r && x === cur.c) - 1];
      if (!prev) return;
      setCur({ r: prev[0], c: prev[1], dir: clue.dir });
      setLetters((L) => L.map((row, r) => row.map((v, c) => (r === prev[0] && c === prev[1] ? '' : v))));
    } else if (e.key.startsWith('Arrow')) {
      e.preventDefault();
      const [dr, dc] = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key as 'ArrowUp']!;
      const r = cur.r + dr, c = cur.c + dc;
      if (g.grid[r]?.[c] && g.grid[r][c] !== '#') setCur({ r, c, dir: dr ? 'down' : 'across' });
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      const i = g.clues.indexOf(clue);
      jump(g.clues[(i + (e.shiftKey ? g.clues.length - 1 : 1)) % g.clues.length]);
    }
  };

  const filled = g.clues.filter((cl) => cellsOfClue(cl).every(([y, x]) => letters[y][x] === g.grid[y][x])).length;

  return (
    <>
      <How compact={compact}>Tap a square and type. Tap it again to switch between across and down.</How>
      <Progress done={filled} total={g.clues.length}>
        <button type="button" className={chip('quiet')} onClick={() => setChecked(true)}>Check</button>
        <button type="button" className={chip('quiet')} onClick={() => reveal(cellsOfClue(clue))}>Reveal word</button>
      </Progress>
      <p className={cn('rounded-2xl bg-panel px-4 py-3 text-background shadow-pill', compact ? 'text-[13px]' : 'sticky top-20 z-10 text-[15px]')} aria-live="polite">
        <b className="text-brand">{clue.n} {clue.dir}</b> {clue.clue} <span className="text-background/60">{clue.enumeration}</span>
      </p>
      <div className="flex flex-wrap items-start gap-4">
        <div className="relative max-w-full overflow-x-auto">
          <div className="games-cw-grid" style={{ ['--cols' as string]: g.cols }} onClick={() => { setActive(true); input.current?.focus({ preventScroll: true }); }}>
            {g.grid.map((row, r) => [...row].map((ch, c) => {
              const k = `${r},${c}`;
              if (ch === '#') return <span key={k} className="games-cw-cell is-block" />;
              const v = letters[r][c];
              const bad = checked && v && v !== ch;
              return (
                <button key={k} type="button" data-r={r} data-c={c} aria-label={`Row ${r + 1}, column ${c + 1}${v ? `, ${v}` : ''}`}
                  className={cn('games-cw-cell', inWord.has(k) && 'word', r === cur.r && c === cur.c && 'cur', bad && 'bad', done && 'done')}
                  onClick={(e) => { e.stopPropagation(); select(r, c); }}>
                  {numberAt.has(k) && <span className="games-cw-n">{numberAt.get(k)}</span>}
                  <span className="games-cw-l">{v}</span>
                </button>
              );
            }))}
          </div>
          <input ref={input} className="games-cw-input" aria-label="Type a letter" autoCapitalize="characters" autoComplete="off" spellCheck={false} value=""
            onKeyDown={keys}
            onChange={(e) => { const ch = e.target.value.slice(-1); if (/^[a-z]$/i.test(ch)) type(ch.toUpperCase()); }} />
        </div>
        <div className={cn('flex min-w-[220px] flex-1 flex-col gap-3', compact ? 'text-[13px]' : 'text-[15px]')}>
          {(['across', 'down'] as const).map((dir) => (
            <div key={dir}>
              <h4 className="mb-1 text-[12px] font-bold uppercase tracking-[0.06em] text-warm-secondary">{dir === 'across' ? 'Across' : 'Down'}</h4>
              <ol className="flex flex-col gap-0.5">
                {g.clues.filter((cl) => cl.dir === dir).map((cl) => {
                  const ok = cellsOfClue(cl).every(([y, x]) => letters[y][x] === g.grid[y][x]);
                  return (
                    <li key={`${cl.n}${dir}`}>
                      <button type="button" data-n={cl.n} data-dir={dir}
                        className={cn('w-full rounded-xl px-2.5 py-1.5 text-left transition-colors duration-150 hover:bg-muted', cl === clue && 'bg-brand-blue-subtle hover:bg-brand-blue-subtle', ok && 'text-success')}
                        onClick={() => jump(cl)}>
                        <b className="mr-1.5">{cl.n}</b>{cl.clue} <span className="text-warm-meta">{cl.enumeration}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
        </div>
      </div>
      {done && <Solved compact={compact} text="Crossword complete!" onNext={onNext} />}
    </>
  );
}
