import { Link } from 'react-router-dom';
import { BentoStack, BentoPanel } from '@/components/layout/PageContainer';
import { usePageMeta } from '@/hooks/usePageMeta';
import { actionToneClass } from '@/lib/checker-button-styles';
import {
  CHECKER_HELP_EXTRAS,
  CHECKER_PATH,
  CHECKER_PRACTICE_PATH,
  CHECKER_RULES,
  CHECKER_TOOL_RULES,
  CHECKER_TOUR_PARAM,
  shortcutRows,
} from '@/lib/checker-onboarding';

/* The checker cheat sheet (/checker/help). Public on purpose: it holds no
   question, no contact and nothing signed-in. The rules are quoted from the
   live checker copy and the shortcut table is read from checker-shortcuts.ts
   (src/lib/checker-onboarding.ts), so it cannot drift from the real page. */

export default function CheckerHelp() {
  usePageMeta('Checker help | Shikshaq', 'The rules and keyboard shortcuts for checking a paper question.');
  const rows = shortcutRows();
  return (
    <BentoStack className="min-h-screen bg-muted">
      <BentoPanel fill="card" edge="top" className="mx-auto w-full max-w-3xl">
        <h1 className="text-balance text-xl font-bold text-foreground">Checker help</h1>
        <p className="mt-1 text-pretty text-[14px] text-warm-secondary">
          One question at a time: read the typed words against the picture of the printed page, then press one button.
        </p>

        <h2 className="mb-2 mt-5 text-[16px] font-bold text-foreground">The rules</h2>
        <ol className="flex flex-col gap-2" data-testid="checker-rules">
          {CHECKER_RULES.map((r, n) => (
            <li key={r.title} className="rounded-2xl bg-muted p-3">
              <p className="text-[14px] font-semibold text-foreground">
                <span className="tabular-nums">{n + 1}.</span> {r.title}
              </p>
              <p className="mt-0.5 text-pretty text-[14px] leading-snug text-warm-secondary">{r.body}</p>
            </li>
          ))}
        </ol>

        <h2 id="tools" className="mb-1 mt-6 scroll-mt-24 text-[16px] font-bold text-foreground">
          The tools under the typed words
        </h2>
        <p className="mb-2 text-[13px] text-warm-secondary">
          They are always on the screen, in words. Point at one, or tab to it, and a line says what it does.
        </p>
        <ul className="flex flex-col gap-2" data-testid="checker-tools-help">
          {CHECKER_TOOL_RULES.map((r) => (
            <li key={r.title} className="rounded-[12px] bg-muted p-3">
              <p className="text-[14px] font-semibold text-foreground">{r.title}</p>
              <p className="mt-0.5 text-pretty text-[14px] leading-snug text-warm-secondary">{r.body}</p>
            </li>
          ))}
        </ul>

        <h2 className="mb-2 mt-6 text-[16px] font-bold text-foreground">Taking back, skipping, OR and more</h2>
        <ul className="flex flex-col gap-2" data-testid="checker-help-extras">
          {CHECKER_HELP_EXTRAS.map((r) => (
            <li key={r.title} className="rounded-2xl bg-muted p-3">
              <p className="text-[14px] font-semibold text-foreground">{r.title}</p>
              <p className="mt-0.5 text-pretty text-[14px] leading-snug text-warm-secondary">{r.body}</p>
            </li>
          ))}
        </ul>

        <h2 className="mb-2 mt-6 text-[16px] font-bold text-foreground">Keyboard shortcuts</h2>
        <p className="mb-2 text-[13px] text-warm-secondary">
          One key, no Ctrl. They switch off while you are typing in a box.
        </p>
        <div className="overflow-hidden rounded-2xl bg-muted" role="table" aria-label="Keyboard shortcuts" data-testid="checker-shortcuts">
          {rows.map((r) => (
            <div key={r.action} role="row" className="flex items-center justify-between gap-3 px-3 py-2.5 odd:bg-card/50">
              <span role="cell" className="text-[14px] text-foreground">
                {r.label}
              </span>
              <kbd role="cell" className="rounded-lg bg-card px-2.5 py-1 text-[13px] font-semibold text-foreground shadow-sm">
                {r.keys}
              </kbd>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[12px] text-warm-meta">Split into two questions only works on a question that has words to split.</p>

        <div className="mt-6 flex flex-wrap items-center gap-2.5">
          <Link to={CHECKER_PRACTICE_PATH} className={actionToneClass('brand')}>
            Practice round
          </Link>
          <Link to={`${CHECKER_PATH}?${CHECKER_TOUR_PARAM}=1`} className={actionToneClass('mint')}>
            Show me around the checker
          </Link>
          <Link to={CHECKER_PATH} className={actionToneClass('muted')}>
            Back to the checker
          </Link>
        </div>
      </BentoPanel>
    </BentoStack>
  );
}
