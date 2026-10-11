import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import { PracticeRound } from '@/pages/CheckerPractice';
import { createPracticeApi } from '@/lib/checker-practice';

describe('practice round screen', () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <PracticeRound api={createPracticeApi()} onRestart={() => undefined} />
    </MemoryRouter>,
  );

  it('offers Undo last, switched off until something has been answered', () => {
    expect(html).toContain('data-testid="practice-undo"');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*data-testid="practice-undo"|<button[^>]*data-testid="practice-undo"[^>]*disabled=""/);
  });

  it('starts on the first question of eleven', () => {
    expect(html).toContain('Question 1 of 11');
  });
});
