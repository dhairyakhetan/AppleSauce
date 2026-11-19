import { describe, expect, it } from 'vitest';

import { createSearchGeneration } from '@/lib/search-generation';

/* The PaperResults race: a next-page request in flight while the filters change.
   This replays it with the same capture-then-check order loadMore() uses. */
describe('createSearchGeneration', () => {
  it('a token is current until a new search begins', () => {
    const gen = createSearchGeneration();
    gen.begin();
    const token = gen.current();
    expect(gen.isCurrent(token)).toBe(true);
    gen.begin();
    expect(gen.isCurrent(token)).toBe(false);
  });

  it('drops a next page that lands after the filters changed', async () => {
    const gen = createSearchGeneration();
    let rows: string[] = [];
    gen.begin(); // search A's first page
    rows = ['A1', 'A2'];

    let resolveA!: (v: string[]) => void;
    const inFlight = new Promise<string[]>((r) => { resolveA = r; });
    const token = gen.current();
    const loadMoreA = inFlight.then((more) => {
      if (!gen.isCurrent(token)) return;
      rows = [...rows, ...more];
    });

    gen.begin(); // the student picks new filters: search B replaces the list
    rows = ['B1'];

    resolveA(['A3', 'A4']); // A's page 2 finally arrives
    await loadMoreA;

    expect(rows).toEqual(['B1']);
  });

  it('still appends when the search did not change', async () => {
    const gen = createSearchGeneration();
    gen.begin();
    let rows = ['A1'];
    const token = gen.current();
    await Promise.resolve(['A2']).then((more) => {
      if (gen.isCurrent(token)) rows = [...rows, ...more];
    });
    expect(rows).toEqual(['A1', 'A2']);
  });
});
