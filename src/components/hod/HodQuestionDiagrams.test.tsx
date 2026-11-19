import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { HodQuestionDiagrams } from '@/components/hod/HodQuestionDiagrams';
import { withoutShownFigureFlag } from '@/lib/checker-diagrams';

/* The HOD "Needs you" card shows a question's stored diagram (owner, 13 Nov 2026: "diagram still missing").
   The checker's screen has done this since PR 98; these tests pin that the HOD card does it too. */

describe('HodQuestionDiagrams (what is drawn)', () => {
  it('draws nothing when the question has no stored diagram', () => {
    expect(renderToStaticMarkup(<HodQuestionDiagrams items={[]} />)).toBe('');
  });

  it('draws the diagram with its heading and the check line', () => {
    const html = renderToStaticMarkup(
      <HodQuestionDiagrams items={[{ id: 'a', url: 'https://x/a.png', alt: 'The diagram for this question', fromStem: false }]} />,
    );
    expect(html).toContain('data-testid="question-diagrams"');
    expect(html).toContain('The diagram for this question');
    expect(html).toContain('src="https://x/a.png"');
  });

  it('draws one tile per diagram', () => {
    const html = renderToStaticMarkup(
      <HodQuestionDiagrams
        items={[
          { id: 'a', url: 'https://x/a.png', alt: 'Diagram 1 of 2 for this question', fromStem: true },
          { id: 'b', url: 'https://x/b.png', alt: 'Diagram 2 of 2 for this question', fromStem: false },
        ]}
      />,
    );
    expect([...html.matchAll(/data-testid="diagram-item"/g)]).toHaveLength(2);
  });
});

describe('the HOD card and the HOD api (the wiring)', () => {
  const card = readFileSync('src/components/hod/NeedsYouTab.tsx', 'utf8');
  const api = readFileSync('src/lib/hod-api.ts', 'utf8');
  const fake = readFileSync('src/dummy/hod-fake-api.ts', 'utf8');

  it('the card reads the diagrams and draws them above the printed picture', () => {
    expect(card).toContain("useHodDiagrams(api, q.id)");
    const block = card.indexOf('<HodQuestionDiagrams items={diagrams} />');
    const picture = card.indexOf('<QuestionPicture api={api}');
    expect(block).toBeGreaterThan(-1);
    expect(picture).toBeGreaterThan(block);
  });

  it('the "figure missing" tip is dropped while a diagram is shown, as on the checker screen', () => {
    expect(card).toContain('withoutShownFigureFlag(q.flag_reasons, diagrams.length > 0)');
    expect(withoutShownFigureFlag(['figure_missing', 'marks_mismatch'], true)).toEqual(['marks_mismatch']);
    expect(withoutShownFigureFlag(['figure_missing'], false)).toEqual(['figure_missing']);
  });

  it('the real HOD api uses the existing database read that already lets an HOD in', () => {
    expect(api).toContain('questionDiagrams: verifierQuestionDiagrams');
  });

  it('dummy mode has the same method, so the screens still build there', () => {
    expect(fake).toContain('async questionDiagrams()');
  });
});
