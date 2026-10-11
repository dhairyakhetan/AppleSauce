import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/* Source-level guards for the past-papers pages (browse, reader, submit). The
   pages are big and fetch-driven, so what is pinned here is the wording and the
   wiring that reviews found wrong, not a render. */
const read = (rel: string) => readFileSync(resolve(__dirname, rel), 'utf8');
// Code and copy only: the comments around a fix legitimately name the old bug.
const noComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

describe('PaperResults', () => {
  const src = read('PaperResults.tsx');
  const code = noComments(src);

  it('meta description makes no promise the site does not keep', () => {
    expect(code).not.toMatch(/no download/i);
    expect(code).not.toMatch(/no sign-up wall/i);
    expect(code).toContain('the first two questions of every paper need no account');
  });

  it('does not lock cards behind "Sign in to read": papers are soft-gated', () => {
    expect(code).not.toContain('locked={!user}');
    expect(code).toContain('<PaperSheetCard paper={p} />');
  });

  it('a next-page request checks it still belongs to the search on screen', () => {
    expect(code).toContain('searchGen.begin()');
    expect(code).toMatch(/if \(!searchGen\.isCurrent\(gen\)\) return;/);
    expect(code).toMatch(/if \(searchGen\.isCurrent\(gen\)\) setLoadingMore\(false\)/);
  });

  it('the empty state waits for the bank index as well as the database', () => {
    expect(code).toContain('const listLoading = loading || bankQuery.isPending;');
    expect(code).toContain('const isDeadEnd = !listLoading &&');
    expect(code).toMatch(/\{listLoading && shownPapers\.length === 0 \? \(/);
  });
});

describe('PastPapers', () => {
  const code = noComments(read('PastPapers.tsx'));

  it('the shelf sorted by exam year is not called "Recently added"', () => {
    expect(code).not.toContain('>Recently added<');
    expect(code).toContain('>Latest papers<');
  });

  it('an error from either source shows the error panel, and retry does not reload the page', () => {
    expect(code).toContain('const loadError = landing.isError || bankQuery.isError;');
    expect(code).not.toContain('window.location.reload()');
    expect(code).toContain('bankQuery.refetch()');
    expect(code).toContain('landing.refetch()');
  });
});

describe('BankPaper', () => {
  const code = noComments(read('BankPaper.tsx'));

  it('searches options as well as the stem', () => {
    expect(code).toContain('questionMatchesSearch(row, needle)');
    expect(code).not.toContain('row.t.toLowerCase().includes(needle)');
  });

  it('counts only searchable questions in "No match in the N free questions"', () => {
    expect(code).toContain('searchableCount(questions)');
    expect(code).not.toContain('${questions.length} free questions');
  });

  it('no "a Economics teacher": the link does not guess an article', () => {
    expect(code).not.toMatch(/Find a \{displaySubject\} teacher/);
    expect(code).toContain('Find {displaySubject} teachers');
  });

  it('sibling papers list undated papers last, as the index does', () => {
    expect(code).toContain("order('year', { ascending: false, nullsFirst: false })");
  });

  it('the report confirmation timer is cleared with the form', () => {
    expect(code).toContain('window.clearTimeout(doneTimer.current)');
    expect(code).toContain('doneTimer.current = window.setTimeout(onDone, 1400)');
  });
});

describe('PaperReader', () => {
  const code = noComments(read('PaperReader.tsx'));

  it('uses siblingNeighbours so Previous is the older paper', () => {
    expect(code).toContain('siblingNeighbours(siblings, id)');
    expect(code).not.toContain('siblings[currentIndex - 1]');
  });

  it('only says the file is not uploaded once the server said so', () => {
    expect(code).toContain("fileState === 'loading'");
    expect(code).toContain("fileState === 'error'");
    expect(code).toContain('fileStateFrom(');
  });

  it('a dismissed share sheet does not fall through to a copied link', () => {
    expect(code).toContain('if (isShareDismissed(err)) return;');
  });
});
