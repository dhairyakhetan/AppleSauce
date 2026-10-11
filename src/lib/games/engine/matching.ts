/**
 * Matching: questions on one side, answers on the other, both shuffled. A pair is correct when both sides have the same id.
 * Two questions with the same answer would make it ambiguous, so only one of them is used.
 */
import { loose, shuffle, type Item } from './shared';

export const MATCHING = { min: 3, max: 8 } as const;

export interface Matching {
  type: 'matching';
  left: { id: string; text: string }[];
  right: { id: string; text: string }[];
}

export function makeMatching(items: Item[], r: () => number): Matching | null {
  const answers = new Set<string>();
  const questions = new Set<string>();
  const chosen: Item[] = [];
  for (const it of shuffle(items, r)) {
    if (chosen.length === MATCHING.max) break;
    const a = loose(it.answer);
    const q = loose(it.question);
    if (!a || !q || answers.has(a) || questions.has(q)) continue;
    answers.add(a);
    questions.add(q);
    chosen.push(it);
  }
  if (chosen.length < MATCHING.min) return null;
  const left = shuffle(chosen, r);
  let right = shuffle(chosen, r);
  if (right.every((it, i) => it.id === left[i].id)) right = [...right.slice(1), right[0]]; // never in the same order
  return {
    type: 'matching',
    left: left.map((it) => ({ id: it.id, text: it.question })),
    right: right.map((it) => ({ id: it.id, text: it.answer })),
  };
}

/** Everything wrong with a matching game; empty when it is correct. Written separately from the maker on purpose. */
export function checkMatching(g: Matching, items: Item[]): string[] {
  const out: string[] = [];
  const byId = new Map(items.map((it) => [it.id, it]));
  const n = g.left.length;
  if (n < MATCHING.min || n > MATCHING.max) out.push(`has ${n} pairs, needs ${MATCHING.min} to ${MATCHING.max}`);
  if (g.right.length !== n) out.push('the two sides have different lengths');
  const leftIds = g.left.map((x) => x.id);
  const rightIds = g.right.map((x) => x.id);
  if (new Set(leftIds).size !== n) out.push('a question appears twice');
  if (new Set(rightIds).size !== g.right.length) out.push('an answer appears twice');
  if ([...leftIds].sort().join('\u0000') !== [...rightIds].sort().join('\u0000')) out.push('the answers do not belong to the questions shown');
  for (const x of g.left) if (byId.get(x.id)?.question !== x.text) out.push(`question ${x.id} is not the bank's text`);
  for (const x of g.right) if (byId.get(x.id)?.answer !== x.text) out.push(`answer ${x.id} is not the bank's text`);
  const shownAnswers = g.right.map((x) => loose(x.text));
  if (new Set(shownAnswers).size !== shownAnswers.length) out.push('two answers are the same, so a question has two right matches');
  const shownQuestions = g.left.map((x) => loose(x.text));
  if (new Set(shownQuestions).size !== shownQuestions.length) out.push('two questions are the same');
  if (n > 1 && leftIds.every((id, i) => rightIds[i] === id)) out.push('answers are in the same order as the questions');
  return out;
}
