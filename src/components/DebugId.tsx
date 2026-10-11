import { useState } from 'react';
import { useAdminDebugOn } from '@/lib/admin-debug';
import { cn } from '@/lib/utils';

/**
 * One shared id chip for admin debug mode (owner, 2026-09-28), so every
 * surface that shows an id does it the same way instead of each page
 * inventing its own. Renders NOTHING unless debug mode is on for an admin
 * (`useAdminDebugOn`) — a non-admin, or an admin with the toggle off, gets
 * back `null`, not a hidden element, so there is nothing in the DOM to
 * discover by inspecting a page.
 *
 * Read-only display of an id the calling component already has in its own
 * props/data. This component fetches nothing itself.
 */
export function DebugId({
  value,
  label,
  className,
}: {
  value: string | number | null | undefined;
  /** Short tag shown before the id, e.g. "paper", "question", "audit". */
  label: string;
  className?: string;
}) {
  const on = useAdminDebugOn();
  const [copied, setCopied] = useState(false);

  if (!on || value === null || value === undefined || value === '') return null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(String(value));
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard API unavailable (permissions, insecure context): the id is
      // still visible on screen to copy by hand.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={`Copy ${label} id`}
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-md border border-dashed border-amber-500/60 bg-amber-50 px-1.5 py-0.5 font-mono text-[10px] leading-none text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
        'align-middle',
        className,
      )}
    >
      <span className="shrink-0 font-semibold uppercase tracking-wide opacity-70">{label}</span>
      <span className="truncate">{copied ? 'copied' : String(value)}</span>
    </button>
  );
}

/** The "Debug mode on" pill (owner: "so it's never left on by accident"),
 *  plus the admin-only toggle button. Renders nothing for a non-admin. */
export function AdminDebugToggle({
  on,
  canToggle,
  toggle,
  className,
}: {
  on: boolean;
  canToggle: boolean;
  toggle: () => void;
  className?: string;
}) {
  if (!canToggle) return null;
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={on}
      title="Show ids for teachers, papers, questions and audit rows on screen"
      className={cn(
        'inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[11px] font-bold uppercase tracking-wide transition-colors duration-150',
        on ? 'bg-amber-500 text-black' : 'bg-muted text-warm-secondary',
        className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', on ? 'bg-black' : 'bg-warm-label')} aria-hidden />
      {on ? 'Debug mode on' : 'Debug mode'}
    </button>
  );
}
