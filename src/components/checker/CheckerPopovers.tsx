import { HelpCircle, Info } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { FIX_RULE_NOTE, FIX_RULE_TITLE } from '@/lib/checker-body';
import { TYPO_RULE_NOTE, TYPO_RULE_TITLE } from '@/lib/checker-save';
import { shortcutRows } from '@/lib/checker-shortcuts';

/* Two small popovers of the verify screen: the full fixing rules behind the
   one line above the part card, and the keyboard shortcuts behind the "?" in the
   action bar. Pure presentation, no data access. */

/** The one line above the part card while it is being edited. */
export const FIX_RULE_LINE = 'Match the printed paper exactly. Do not reword.';

export function RulesInfo() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="The rules for fixing"
          title="The rules for fixing"
          data-testid="rules-info"
          className="tap-44 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-warm-secondary transition-transform duration-150 hover:bg-muted active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <Info className="h-4 w-4" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 max-w-[calc(100vw-24px)] rounded-[16px] p-3" data-testid="rules-popover">
        <p className="text-[14px] font-bold text-foreground">{FIX_RULE_TITLE}</p>
        <p className="mt-0.5 text-[13px] leading-snug text-warm-secondary">{FIX_RULE_NOTE}</p>
        <p className="mt-3 text-[14px] font-bold text-foreground">{TYPO_RULE_TITLE}</p>
        <p className="mt-0.5 text-[13px] leading-snug text-warm-secondary">{TYPO_RULE_NOTE}</p>
      </PopoverContent>
    </Popover>
  );
}

export function ShortcutsPopover({ canSplit, canPass, canUndo, editing }: { canSplit: boolean; canPass: boolean; canUndo: boolean; editing: boolean }) {
  const rows = shortcutRows({ canSplit, canPass, canUndo, editing });
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Keyboard shortcuts"
          title="Keyboard shortcuts"
          data-testid="shortcuts-button"
          className="tap-44 hidden h-11 w-11 shrink-0 items-center justify-center rounded-full bg-muted text-warm-secondary transition-transform duration-150 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand md:inline-flex"
        >
          <HelpCircle className="h-[18px] w-[18px]" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" side="top" className="w-64 rounded-[16px] p-3" data-testid="shortcuts-popover">
        <p className="mb-1.5 text-[14px] font-bold text-foreground">Keyboard shortcuts</p>
        <dl className="flex flex-col gap-1.5">
          {rows.map((r) => (
            <div key={r.keys + r.does} className="flex items-baseline justify-between gap-3 text-[13px]">
              <dt className="shrink-0 rounded-[6px] bg-muted px-2 py-0.5 font-semibold text-foreground">{r.keys}</dt>
              <dd className="text-right text-warm-secondary">{r.does}</dd>
            </div>
          ))}
        </dl>
      </PopoverContent>
    </Popover>
  );
}
