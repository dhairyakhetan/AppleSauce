import type { QuestionDiagram } from '@/lib/checker-api';

/* The stored diagram(s) of the question being checked, shown beside the question without any tap
   (owner, 6 November 2026: "when i am checking questions and it has an accompanying diagram, it should
   also show to the checker"). Pure, so it is tested without a login or a browser. The read itself is
   verifier_question_diagrams (checker-api.ts); the file is signed the same way the crop is. */

/** The object path of each diagram, keyed by its id (what useSignedUrls takes). */
export function diagramPaths(list: QuestionDiagram[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of list) if (d.path) out[d.id] = d.path;
  return out;
}

/** The key that names one set of diagrams for one question; empty when there is nothing to ask for. */
export function diagramsKey(questionId: string | null | undefined, list: QuestionDiagram[]): string {
  if (!questionId || list.length === 0) return '';
  return `${questionId}|${list.map((d) => `${d.id}:${d.path}`).join(',')}`;
}

export interface DiagramItem {
  id: string;
  url: string;
  alt: string;
  fromStem: boolean;
}

/**
 * The diagrams that have a link, in the order given (shared-stem diagrams first, as the database sends them).
 * One whose link is still on its way (undefined) or failed (null) is left out: the question is never held up.
 */
export function diagramItems(list: QuestionDiagram[], urls: Record<string, string | null | undefined>): DiagramItem[] {
  const ready = list.filter((d) => typeof urls[d.id] === 'string' && urls[d.id] !== '');
  return ready.map((d, i) => ({
    id: d.id,
    url: urls[d.id] as string,
    fromStem: d.fromStem,
    alt: ready.length === 1 ? 'The diagram for this question' : `Diagram ${i + 1} of ${ready.length} for this question`,
  }));
}

/**
 * The flags the tips are written from. "Figure missing" says the diagram is not attached; once a stored
 * diagram is on screen that is no longer true, so it is left out. "Figure ambiguous" (it is not clear which
 * diagram goes with the question) stays: showing a diagram does not settle that.
 */
export function withoutShownFigureFlag(flags: string[] | null | undefined, diagramShown: boolean): string[] {
  const list = flags ?? [];
  return diagramShown ? list.filter((f) => f !== 'figure_missing') : list;
}

/** The line under the heading: what the checker does with the diagram. */
export const DIAGRAM_CHECK_LINE = 'Check it is the same as the diagram on the printed page.';

export function diagramHeading(count: number): string {
  return count === 1 ? 'The diagram for this question' : 'The diagrams for this question';
}
