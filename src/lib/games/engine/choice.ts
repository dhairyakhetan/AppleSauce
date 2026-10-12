/**
 * Multiple choice: each question with its answer among wrong options, shuffled; the student taps one.
 *
 * The wrong options are the teacher's own when the question has them (those questions come first). Otherwise they are
 * other answers from the same round, the most alike first (numbers with numbers, as many words, a similar length), so
 * every chapter can be played this way. A true/false or yes/no question with no wrong option written gets the opposite.
 * True/false questions are only used here: in the other games "True" is not much of an answer.
 *
 * The rules that make it correct: the answer is among the options exactly once; no two options read the same; every
 * wrong option is the teacher's own for that question, another question's answer, or the opposite of true/false; and
 * there are 2 to 6 options.
 */
import { loose, shownAnswer, shuffle, type Item } from './shared';

export const CHOICE = { min: 1, max: 10, options: 4, maxOptions: 6 } as const;

export interface ChoiceRow { id: string; question: string; answer: string; options: string[] }
export interface Choice { type: 'choice'; rows: ChoiceRow[] }

const OPPOSITE: Record<string, string> = { true: 'False', false: 'True', yes: 'No', no: 'Yes' };

/** A true/false or yes/no question: only multiple choice uses it. */
export const choiceOnly = (it: Item) => loose(shownAnswer(it.answer)) in OPPOSITE;

/** The teacher's own wrong options, without any that read like the answer or each other. */
function own(it: Item): string[] {
  const seen = new Set([loose(shownAnswer(it.answer))]);
  const out: string[] = [];
  for (const w of it.wrong ?? []) {
    const t = w.trim();
    const k = loose(t);
    if (k && !seen.has(k)) { seen.add(k); out.push(t); }
  }
  return out;
}

function wrongFor(it: Item, pool: Item[], r: () => number): string[] | null {
  const mine = own(it);
  if (mine.length) return mine;
  const answer = shownAnswer(it.answer);
  const a = loose(answer);
  if (a in OPPOSITE) return [OPPOSITE[a]];
  // other answers in the round, the most alike first
  const seen = new Set([a]);
  const others: string[] = [];
  for (const o of shuffle(pool, r)) {
    const s = shownAnswer(o.answer);
    const k = loose(s);
    if (o.id === it.id || !k || seen.has(k) || k in OPPOSITE) continue;
    seen.add(k);
    others.push(s);
  }
  const num = /\d/.test(answer);
  const words = answer.split(/\s+/).length;
  const alike = (s: string) => (/\d/.test(s) === num ? 2 : 0) + (s.split(/\s+/).length === words ? 1 : 0) - Math.abs(s.length - answer.length) / 20;
  const pick = others.map((s, i) => ({ s, i, score: alike(s) })).sort((x, y) => y.score - x.score || x.i - y.i).slice(0, CHOICE.options - 1).map((x) => x.s);
  return pick.length >= 2 ? pick : null;
}

export function makeChoice(items: Item[], r: () => number): Choice | null {
  const order = shuffle(items, r).map((it, i) => ({ it, i, mine: own(it).length > 0 })).sort((x, y) => Number(y.mine) - Number(x.mine) || x.i - y.i);
  const rows: ChoiceRow[] = [];
  for (const { it } of order) {
    if (rows.length === CHOICE.max) break;
    const wrong = wrongFor(it, items, r);
    if (!wrong) continue;
    const answer = shownAnswer(it.answer);
    rows.push({ id: it.id, question: it.question, answer, options: shuffle([answer, ...wrong.slice(0, CHOICE.maxOptions - 1)], r) });
  }
  return rows.length >= CHOICE.min ? { type: 'choice', rows: shuffle(rows, r) } : null;
}

/** Everything wrong with a multiple-choice game; empty when it is correct. Written separately from the maker on purpose. */
export function checkChoice(g: Choice, items: Item[]): string[] {
  const out: string[] = [];
  const byId = new Map(items.map((it) => [it.id, it]));
  const answers = new Set(items.map((it) => loose(shownAnswer(it.answer))));
  if (g.rows.length < CHOICE.min || g.rows.length > CHOICE.max) out.push(`has ${g.rows.length} questions, needs ${CHOICE.min} to ${CHOICE.max}`);
  if (new Set(g.rows.map((x) => x.id)).size !== g.rows.length) out.push('a question appears twice');
  for (const x of g.rows) {
    const it = byId.get(x.id);
    if (!it) { out.push(`question ${x.id} is not in the bank`); continue; }
    if (x.question !== it.question) out.push(`question ${x.id} is not the bank's text`);
    if (x.answer !== shownAnswer(it.answer)) out.push(`question ${x.id} has the wrong answer`);
    if (x.options.length < 2 || x.options.length > CHOICE.maxOptions) out.push(`question ${x.id} has ${x.options.length} options`);
    const keys = x.options.map(loose);
    if (keys.some((k) => !k) || new Set(keys).size !== keys.length) out.push(`question ${x.id}: two options read the same`);
    if (x.options.filter((o) => o === x.answer).length !== 1) out.push(`question ${x.id}: the answer is not among the options exactly once`);
    const mine = new Set((it.wrong ?? []).map((w) => w.trim()));
    const a = loose(x.answer);
    for (const o of x.options) {
      if (o === x.answer) continue;
      const fromBank = answers.has(loose(o)) && loose(o) !== a;
      if (!mine.has(o) && !fromBank && OPPOSITE[a] !== o) out.push(`question ${x.id}: the option "${o}" comes from nowhere`);
    }
  }
  return out;
}
