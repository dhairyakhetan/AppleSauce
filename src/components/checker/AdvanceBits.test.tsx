import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { IncomingCard, PaperStrip, SaveStatusChip } from '@/components/checker/AdvanceBits';
import { paperStripInfo } from '@/lib/checker-card-motion';

describe('PaperStrip', () => {
  const info = paperStripInfo({ subject: 'Mathematics', cls: 'X', school: 'Riverside Academy', year: '2024' }, [{ paper_id: 'a' }, { paper_id: 'b' }], 'b');
  const html = renderToStaticMarkup(<PaperStrip info={info} />);

  it('is a polite status that announces the next paper', () => {
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('Next paper: Riverside Academy, 2024');
  });

  it('shows the title, subject, class and position', () => {
    expect(html).toContain('Riverside Academy, 2024');
    expect(html).toContain('Mathematics');
    expect(html).toContain('Class X');
    expect(html).toContain('Paper 2 of 2');
  });

  it('has no dash characters in its words', () => {
    expect(html).not.toMatch(/[–—]/);
  });
});

describe('SaveStatusChip', () => {
  it('shows nothing while a save is simply on its way', () => {
    expect(renderToStaticMarkup(<SaveStatusChip waiting={1} failing={false} onRetry={() => undefined} />)).toBe('');
    expect(renderToStaticMarkup(<SaveStatusChip waiting={0} failing onRetry={() => undefined} />)).toBe('');
  });

  it('says "Not saved yet, retrying" with a Retry button once a send failed', () => {
    const html = renderToStaticMarkup(<SaveStatusChip waiting={2} failing onRetry={() => undefined} />);
    expect(html).toContain('Not saved yet, retrying');
    expect(html).toContain('(2 answers)');
    expect(html).toContain('Retry');
    expect(html).toContain('role="status"');
  });
});

describe('IncomingCard', () => {
  it('shows the warm picture and placeholders, never words', () => {
    const html = renderToStaticMarkup(<IncomingCard pictureUrl="https://signed/q2.png" />);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('src="https://signed/q2.png"');
    expect(html).not.toMatch(/<p[ >]/);
  });

  it('works without a picture', () => {
    expect(renderToStaticMarkup(<IncomingCard pictureUrl={null} />)).not.toContain('<img');
  });
});

/* There is no browser test environment here, so the screen's wiring is pinned
   by reading its source, like VerifyScreenWiring.test.ts. */
const screen = readFileSync(resolve(__dirname, './VerifyScreen.tsx'), 'utf8');

describe('verify screen: optimistic advance wiring (speed plan 2026-10-12)', () => {
  it('a verdict goes to the outbox, not an awaited request', () => {
    expect(screen).toContain('box.enqueue({ questionId: question.id, paperId, kind, payload: { ...payload, includeSkipped: inc } })');
    expect(screen).toMatch(/submitVerdict\(\s+'fix'/);
    expect(screen).toContain("submitVerdict('pass'");
    expect(screen).toContain("submitVerdict('skip'");
    expect(screen).toContain("submitVerdict('ask_help'");
    expect(screen).not.toMatch(/run\(\s*\(\) => api\.passQuestion/);
  });

  it('one call saves the verdict and brings the next question: no separate fetch after a verdict', () => {
    // the old early ask, in parallel with the save, is gone
    expect(screen).not.toContain('advanceFrom');
    expect(screen).not.toContain('firstInflight');
    expect(screen).not.toMatch(/void loadNext\(entry\.questionId, includeSkippedRef\.current, true\)/);
    // the answer to the verdict goes through decideAck and is applied with its context
    expect(screen).toContain('onAck: (entry, result) => ackedVerdict(entry, result)');
    expect(screen).toContain('decideAck({');
    expect(screen).toContain("qc.setQueryData(['checker-question-context', scope, next.id], next.context)");
    expect(screen).toContain('qc.setQueryData(keyFor(inc), next)');
    expect(screen).toContain("clearDraft(scope, entry.questionId);");
    // the includeSkipped mode travels with the verdict, so a replay asks the same list
    expect(screen).toContain('payload: { ...payload, includeSkipped: inc }');
  });

  it('a late answer is ignored when the person has moved on; a refusal brings the question back with the reason', () => {
    expect(screen).toContain("openQuestionId: questionRef.current?.id ?? null");
    expect(screen).toContain("decision.kind === 'ignore'");
    expect(screen).toMatch(/function rejectedVerdict[\s\S]*setNotice\([\s\S]*loadNext\(entry\.questionId, includeSkippedRef\.current\)/);
    expect(screen).toContain('isConfirmedNotSaved(err)');
  });

  it('only the question card is keyed by the question id', () => {
    expect(screen).toContain('<div key={cardId(question, null)} className={cn(\'min-h-0\', enterClass)}');
    expect(screen).not.toMatch(/<div data-testid="verify-screen" key=/);
  });

  it('reduced motion chooses the fade class', () => {
    expect(screen).toContain('usePrefersReducedMotion()');
    expect(screen).toContain('cardEnterClass(reducedMotion)');
  });

  it('prefetch runs after a question is shown, with the paper cleared on change and sign-out', () => {
    expect(screen).toContain('prefetchNext(pid, {');
    expect(screen).toContain('preloadPage: false');
    expect(screen).toMatch(/if \(!dummy && !userId\) \{\s+clearPrefetch\(\);/);
    expect(screen).toMatch(/lastPrefetchPaper\.current !== pid\) \{\s+clearPrefetch\(\);/);
  });

  it('dummy mode never reaches the real peek or storage', () => {
    expect(screen).toContain('deps: dummy ? offlinePrefetchDeps(api) : undefined');
  });

  it('a held-down key is one press, and the key handler still reads the latest render', () => {
    expect(screen).toContain('if (e.repeat) return;');
    expect(screen).toMatch(/const keyHandlerRef = useRef\(onKeyDown\)/);
  });

  it('Undo waits for the verdicts still on their way', () => {
    expect(screen).toContain('await box.flush()');
  });

  it('the paper strip shows when the paper changed', () => {
    expect(screen).toContain('isPaperChange(seenPaper, question.paper_id)');
    expect(screen).toContain('<PaperStrip info={stripInfo} />');
  });
});
