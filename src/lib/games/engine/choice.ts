/**
 * Multiple choice: each question with its answer among its wrong options, shuffled; the student taps one.
 *
 * Only the writer's own wrong options are used, so no option can secretly also be right: a question without them is not
 * multiple choice. A True/False question needs none (the other one is the option); those are only used here, since in
 * the other games "True" is not much of an answer.
 *
 * The rules that make it correct: the answer is among the options exactly once; no two options read the same; no wrong
 * option counts as the answer; every wrong option is the writer's own for that question (or the other of True/False);
 * and there are 2 to 6 options.
 */
import { sameAnswer } from './answers';
import { answersOf, isTrueFalse, loose, shuffle, type Item } from './shared';

export const CHOICE = { min: 1, max: 10, maxOptions: 6 } as const;

export interface ChoiceRow { id: string; question: string; answer: string; options: string[] }
export interface Choice { type: 'choice'; rows: ChoiceRow[] }

/** A True/False question: only multiple choice uses it. */
export const choiceOnly = (it: Pick<Item, 'answer'>) => isTrueFalse(it.answer);

const opposite = (a: string) => (/^true$/i.test(a.trim()) ? 'False' : 'True');

/** The wrong options this question can show: the writer's own (without any that count as the answer, or repeat), or
 * the other of True/False. Empty when it has none. */
export function wrongOptions(it: Item): string[] {
  if (choiceOnly(it)) return [opposite(it.answer)];
  const out: string[] = [];
  for (const w of it.wrong ?? []) {
    const t = w.trim();
    if (!loose(t) || answersOf(it).some((a) => sameAnswer(t, a)) || out.some((o) => sameAnswer(o, t))) continue;
    out.push(t);
  }
  return out;
}

export function makeChoice(items: Item[], r: () => number): Choice | null {
  const rows: ChoiceRow[] = [];
  for (const it of shuffle(items, r)) {
    if (rows.length === CHOICE.max) break;
    const wrong = wrongOptions(it);
    if (!wrong.length) continue;
    rows.push({ id: it.id, question: it.question, answer: it.answer, options: shuffle([it.answer, ...wrong.slice(0, CHOICE.maxOptions - 1)], r) });
  }
  return rows.length >= CHOICE.min ? { type: 'choice', rows } : null;
}

/** Everything wrong with a multiple-choice game; empty when it is correct. Written separately from the maker on purpose. */
export function checkChoice(g: Choice, items: Item[]): string[] {
  const out: string[] = [];
  const byId = new Map(items.map((it) => [it.id, it]));
  if (g.rows.length < CHOICE.min || g.rows.length > CHOICE.max) out.push(`has ${g.rows.length} questions, needs ${CHOICE.min} to ${CHOICE.max}`);
  if (new Set(g.rows.map((x) => x.id)).size !== g.rows.length) out.push('a question appears twice');
  for (const x of g.rows) {
    const it = byId.get(x.id);
    if (!it) { out.push(`question ${x.id} is not in the bank`); continue; }
    if (x.question !== it.question) out.push(`question ${x.id} is not the bank's text`);
    if (x.answer !== it.answer) out.push(`question ${x.id} has the wrong answer`);
    if (x.options.length < 2 || x.options.length > CHOICE.maxOptions) out.push(`question ${x.id} has ${x.options.length} options`);
    const keys = x.options.map(loose);
    if (keys.some((k) => !k) || new Set(keys).size !== keys.length) out.push(`question ${x.id}: two options read the same`);
    if (x.options.filter((o) => o === x.answer).length !== 1) out.push(`question ${x.id}: the answer is not among the options exactly once`);
    const allowed = new Set((choiceOnly(it) ? [opposite(it.answer)] : it.wrong ?? []).map((w) => w.trim()));
    for (const o of x.options) {
      if (o === x.answer) continue;
      if (!allowed.has(o)) out.push(`question ${x.id}: the option "${o}" isn't one of its wrong options`);
      if (answersOf(it).some((a) => sameAnswer(o, a))) out.push(`question ${x.id}: the option "${o}" counts as the answer`);
    }
  }
  return out;
}
