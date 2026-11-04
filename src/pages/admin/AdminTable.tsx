import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { InfoTip } from '@/components/admin/AdminHelp';
import { AdminLoading } from '@/components/admin/AdminState';

/* Handoff 09i AD-003/AD-004 — the one AdminTable column template shared by
   every admin section (approvals, teachers, papers, reviews-as-table
   sources, audit log). Pixel values transcribed from "Admin Screens
   Redesign.dc.html": card radius 30 (BentoPanel), header row 10px 14px
   with an inset hairline rule, body row 12px 14px with a lighter inset
   hairline, first column bold, status is a dot pill (AD-004), row actions
   right-aligned r999 13px/700 with destructive tinted and always last
   (never first) in reading order.

   Admin rework, Batch 1: every addition below is OFF unless a page opts in
   (`wrap`, `href`, `stack`, `AdminPanelHeader` slots), so existing pages keep
   working unchanged. Status and tone colours come from tokens, not raw hex. */

export type AdminStatus = 'live' | 'pending' | 'paused' | 'hidden';

/* Tokens: live uses success-subtle (already behind AdminPill, 7.5:1), hidden
   uses destructive on its own 10% tint (5.9:1). Pending and paused were
   already tokens. */
const STATUS_CONFIG: Record<AdminStatus, { label: string; fillClass: string; inkClass: string; dotClass: string }> = {
  live: { label: 'Live', fillClass: 'bg-success-subtle-bg', inkClass: 'text-success-subtle-text', dotClass: 'bg-success-subtle-text' },
  pending: { label: 'Pending', fillClass: 'bg-brand-subtle', inkClass: 'text-brand-deep', dotClass: 'bg-brand-deep' },
  paused: { label: 'Paused', fillClass: 'bg-muted', inkClass: 'text-warm-secondary', dotClass: 'bg-warm-secondary' },
  hidden: { label: 'Hidden', fillClass: 'bg-destructive/10', inkClass: 'text-destructive', dotClass: 'bg-destructive' },
};

/** AD-004: every status cell is one pill, dot + label, coloured from a
 *  fixed 4-tone palette. `label` overrides the default tone label (e.g.
 *  Approvals' "Approved"/"Rejected" instead of the generic "Live"/"Hidden")
 *  — the record's real state always decides the *label*, never a hardcoded
 *  string; the *tone* just picks which of the 4 colours it reads with. */
export function AdminStatusPill({ status, label, className }: { status: AdminStatus; label?: string; className?: string }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span
      className={cn(
        'inline-flex h-[26px] w-fit shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-[10px] text-[12px] font-bold',
        cfg.fillClass,
        cfg.inkClass,
        className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', cfg.dotClass)} aria-hidden />
      {label ?? cfg.label}
    </span>
  );
}

export type AdminActionTone = 'primary' | 'muted' | 'mint' | 'destructive';

const ACTION_TONE_CLASS: Record<AdminActionTone, string> = {
  primary: 'bg-muted text-foreground hover:bg-warm-hairline',
  muted: 'bg-muted text-warm-secondary hover:bg-warm-hairline',
  mint: 'bg-mint text-success-subtle-text hover:brightness-95',
  destructive: 'bg-destructive/10 text-destructive hover:bg-destructive/15',
};

export interface AdminRowAction {
  label: string;
  onClick: () => void;
  tone: AdminActionTone;
  disabled?: boolean;
}

/** AD-003: h40 px-3.5 r999 13px/700 admin action pill. Rendered in the
 *  order given — callers are responsible for putting destructive actions
 *  last, never first (⚠ AD-003). Exported so AD-007's review-card queue
 *  (which isn't a table) can render the identical action-pill treatment.
 *
 *  `stack` lets the pills wrap onto a second line below `sm` (and left-aligns
 *  them there) instead of forcing one wide row on a phone. Put the primary
 *  action first. */
/** The name a row's buttons are about, so a screen reader hears "Edit Ananya Roy"
 *  and not "Edit" fifty times. An explicit `subject` wins; otherwise the first
 *  cell, when it is plain text. Clipped so a long quote stays one short phrase. */
export function rowSubject(row: { subject?: string; cells?: ReactNode[] }): string | undefined {
  const raw = row.subject ?? (typeof row.cells?.[0] === 'string' ? (row.cells[0] as string) : undefined);
  const text = raw?.replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

export function AdminRowActions({ actions, stack = false, subject }: { actions: AdminRowAction[]; stack?: boolean; subject?: string }) {
  return (
    <div className={cn('flex shrink-0 items-center gap-1.5', stack ? 'flex-wrap justify-start sm:flex-nowrap sm:justify-end' : 'justify-end')}>
      {actions.map((action) => (
        <button
          key={action.label}
          type="button"
          onClick={action.onClick}
          disabled={action.disabled}
          className={cn(
            'relative inline-flex h-10 items-center justify-center whitespace-nowrap rounded-full px-[14px] text-[13px] font-bold before:absolute before:-inset-[2px] before:content-[""] transition-colors duration-150 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            ACTION_TONE_CLASS[action.tone],
          )}
        >
          {action.label}
          {subject ? <span className="sr-only"> {subject}</span> : null}
        </button>
      ))}
    </div>
  );
}

export interface AdminTableColumn {
  key: string;
  label: string;
  /** Tailwind grid-template-columns fraction, e.g. "2.2fr". */
  width: string;
  /** Plain-words explanation of the column, opened from a small "i" in the header. */
  hint?: string;
  /** Let this column's text run to two lines instead of being cut off with an
   *  ellipsis. Use it for subjects, areas, titles. */
  wrap?: boolean;
}

export interface AdminTableRow {
  id: string;
  /** One ReactNode per column, in column order — first cell renders bold.
   *  A status column is just a regular cell holding an `<AdminStatusPill>`
   *  — its position varies per section (AD-005's Teachers puts "Updated"
   *  after "Status"; AD-006/AD-008 put Status/Result last), so AdminTable
   *  doesn't special-case it: the caller places it wherever its own
   *  `columns` array says it goes. A plain string cell also becomes the
   *  cell's `title`, so a cut-off value can be read on hover. */
  cells: ReactNode[];
  /** Row actions, left-to-right reading order. Empty/omitted for a row
   *  with nothing to do (readOnly tables never pass this at all). */
  actions?: AdminRowAction[];
  /** Makes the whole row a link (the first cell is the link, stretched over
   *  the row) with a quiet chevron on the right. Row actions stay clickable. */
  href?: string;
  /** What the row is about, read after each action's label by screen readers.
   *  Defaults to the first cell when that is plain text. */
  subject?: string;
}

export interface AdminTableProps {
  columns: AdminTableColumn[];
  rows: AdminTableRow[];
  className?: string;
  /** AD-008 audit log: hides the action column entirely, both grid and
   *  mobile list — nothing on that screen mutates anything. */
  readOnly?: boolean;
}

const SUBGRID_ROW = { gridColumn: '1 / -1', gridTemplateColumns: 'subgrid' } as const;

const cellTitle = (cell: ReactNode): string | undefined => (typeof cell === 'string' && cell.length > 0 ? cell : undefined);

const STRETCH = 'after:absolute after:inset-0 after:content-[""] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:rounded-sm';

/** One shared column template — every section passes its own columns/rows.
 *  Rendered inside a `<BentoPanel fill="card">` by the caller (the panel
 *  also carries the section's own title/meta row above the table). */
export function AdminTable({ columns, rows, className, readOnly }: AdminTableProps) {
  const hasHref = rows.some((r) => r.href);
  const gridTemplate = [
    ...columns.map((c, i) => (i === 0 ? `minmax(140px, ${c.width})` : c.width)),
    ...(readOnly ? [] : ['auto']),
    ...(hasHref ? ['20px'] : []),
  ].join(' ');

  return (
    <div className={cn('overflow-hidden', className)}>
      {/* Desktop / tablet: the grid, lg: and up.

          AD-003 specifies a `border-collapse` <table>; this is a CSS grid so
          the same rows can restack as cards below lg (see below). The visual
          spec is met either way, but a bare grid of <div>s announces as a flat
          run of text with no column association — C-015 asks that the
          semantics survive the restyle, so the ARIA table roles carry what the
          <table> element would have. */}
      {/* One grid owns the column template and every row is a subgrid of
          it. Separate per-row grids sized the `auto` actions column per row
          (empty in the header, button-wide in the rows), so header labels
          drifted away from their cells. */}
      <div className="hidden overflow-x-auto lg:grid" role="table" style={{ gridTemplateColumns: gridTemplate }}>
        <div
          role="row"
          className="grid gap-3.5 px-[14px] py-3 shadow-[inset_0_-1px_0_#E7DFD5]"
          style={SUBGRID_ROW}
        >
          {columns.map((c) => (
            <span role="columnheader" key={c.key} className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-[.06em] text-warm-label">
              {c.label}
              {c.hint ? <InfoTip text={c.hint} label={c.label} /> : null}
            </span>
          ))}
          {/* The actions column is unlabelled by design, but a header cell
              with no accessible name leaves the column count wrong for AT. */}
          {readOnly ? null : <span role="columnheader"><span className="sr-only">Actions</span></span>}
          {hasHref ? <span role="columnheader"><span className="sr-only">Open</span></span> : null}
        </div>

        {rows.map((row) => (
          <div
            key={row.id}
            role="row"
            className={cn(
              'grid items-center gap-3.5 px-[14px] py-[12px] shadow-[inset_0_-1px_0_#F0EAE2] transition-colors duration-150 hover:bg-muted/40',
              row.href && 'relative',
            )}
            style={SUBGRID_ROW}
          >
            {row.cells.map((cell, i) => (
              <span
                role="cell"
                key={i}
                title={cellTitle(cell)}
                className={cn(
                  'min-w-0 text-[14px] leading-[1.45]',
                  columns[i]?.wrap ? 'line-clamp-2 break-words' : 'truncate',
                  i === 0 ? 'font-bold text-foreground' : 'text-warm-prose',
                )}
              >
                {i === 0 && row.href ? (
                  <Link to={row.href} className={STRETCH}>
                    {cell}
                  </Link>
                ) : (
                  cell
                )}
              </span>
            ))}

            {readOnly ? null : (
              <span role="cell" className={cn(row.href && 'relative z-10')}>
                <AdminRowActions actions={row.actions ?? []} subject={rowSubject(row)} />
              </span>
            )}
            {hasHref ? (
              <span role="cell" className="flex justify-end text-warm-label">
                {row.href ? <ChevronRight className="h-4 w-4" aria-hidden /> : null}
              </span>
            ) : null}
          </div>
        ))}
      </div>

      {/* Mobile / tablet: a single-column list of row cards. */}
      <div className="divide-y divide-warm-hairline lg:hidden">
        {rows.map((row) => (
          <div key={row.id} className={cn('flex flex-col gap-3 px-[14px] py-4', row.href && 'relative')}>
            <div className="flex min-w-0 items-start gap-2">
              <div className="min-w-0 flex-1 text-[15px] font-bold leading-[1.35] text-foreground" title={cellTitle(row.cells[0])}>
                {row.href ? (
                  <Link to={row.href} className={STRETCH}>
                    {row.cells[0]}
                  </Link>
                ) : (
                  row.cells[0]
                )}
              </div>
              {row.href ? <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-warm-label" aria-hidden /> : null}
            </div>

            {row.cells.length > 1 ? (
              <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
                {row.cells.slice(1).map((cell, i) => (
                  <div key={i} className="min-w-0">
                    {columns[i + 1] ? (
                      <dt className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-[.06em] text-warm-label">
                        {columns[i + 1].label}
                        {columns[i + 1].hint ? <InfoTip text={columns[i + 1].hint} label={columns[i + 1].label} /> : null}
                      </dt>
                    ) : null}
                    <dd
                      title={cellTitle(cell)}
                      className={cn('text-[14px] leading-[1.45] text-warm-prose', columns[i + 1]?.wrap ? 'line-clamp-2 break-words' : 'truncate')}
                    >
                      {cell}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}

            {readOnly ? null : row.actions?.length ? (
              <div className={cn(row.href && 'relative z-10')}>
                <AdminRowActions actions={row.actions} stack subject={rowSubject(row)} />
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

/** The loading state for a table-bearing panel: a header bar and rows in the
 *  final layout. First load only; refetches patch rows in place. */
export function AdminTableSkeleton({ rows = 5, label = 'Loading the list', className }: { rows?: number; label?: string; className?: string }) {
  return <AdminLoading shape="table" rows={rows} label={label} className={cn('px-[14px]', className)} />;
}

/** AD-003: the title + meta row every table-bearing section renders above
 *  its `AdminTable`, inside the same content `BentoPanel`. One title, one
 *  meta, at most one primary `action` (the panel's single dark pill). */
export function AdminPanelHeader({
  title,
  meta,
  subtitle,
  action,
}: {
  title: string;
  meta?: ReactNode;
  /** One line under the title, for what the list holds. */
  subtitle?: ReactNode;
  /** The panel's one primary action, right-aligned. */
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-[18px] pb-3">
      <div className="min-w-0">
        <h2 className="text-[19px] font-extrabold tracking-[-0.03em] text-foreground">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-pretty text-[13px] leading-[1.5] text-warm-secondary">{subtitle}</p> : null}
      </div>
      {meta || action ? (
        <div className="flex items-center gap-3">
          {meta ? <span className="text-[13px] tabular-nums text-warm-meta">{meta}</span> : null}
          {action}
        </div>
      ) : null}
    </div>
  );
}
