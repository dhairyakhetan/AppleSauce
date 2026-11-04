import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { HeaderEditor } from '@/components/hod/HeaderEditor';
import { EmptyNote, ListSkeleton, LoadError, Tile, ago, deskLink, quietButton } from '@/components/hod/HodShared';
import { RouteTrail } from '@/components/hod/RouteTrail';
import { CHIP, actionToneClass } from '@/lib/checker-button-styles';
import type { HodApi } from '@/lib/hod-api';
import {
  LIVE_FIELDS,
  LIVE_PAGE,
  NO_LIVE_FILTER,
  distinctValues,
  errorWords,
  filterLivePapers,
  liveCounts,
  liveWaitingText,
  type HodLivePaper,
  type LiveFilter,
  type LiveStatus,
} from '@/lib/hod-publish';
import { cn } from '@/lib/utils';

/* "Live papers": every paper in the library, live or hidden. Counts are Live and
   Hidden only. Filter by status, subject and class, or search. Per paper: hide it
   (with a reason), put it back, or change its details. Changes are saved one
   field at a time and logged, so History and undo keep working. */

export const LIVE_KEY = (scope: string) => ['hod', scope, 'live'] as const;

/* Action buttons in a card's row: they grow to fill the phone row they share and
   keep their own width from sm up. */
const ACTION_FILL = 'grow text-center sm:grow-0';

const STATUS_FILTERS: { key: LiveStatus; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'live', label: 'Live' },
  { key: 'hidden', label: 'Hidden' },
];

function LiveRow({ p, api, onChanged }: { p: HodLivePaper; api: HodApi; onChanged: () => void }) {
  const [mode, setMode] = useState<null | 'hide' | 'edit'>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<void>, done: string) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      toast.success(done);
      setMode(null);
      setReason('');
      onChanged();
    } catch (err) {
      setError(errorWords(err));
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  const values: Record<string, string> = {
    cls: p.cls ?? '',
    subject: p.subject ?? '',
    board: p.board ?? '',
    year: p.year ?? '',
    school: p.school ?? '',
    exam: p.exam ?? '',
    marks: p.marks !== null ? String(p.marks) : '',
    allowed_time_minutes: p.allowed_time_minutes !== null ? String(p.allowed_time_minutes) : '',
    general_instructions: p.general_instructions ?? '',
    incomplete_note: p.incomplete_note ?? '',
  };
  const waiting = liveWaitingText(p);

  return (
    <li className="rounded-[18px] bg-muted p-4" data-testid="live-paper" data-live={p.is_published}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-bold text-foreground">{p.title}</p>
          <p className="mt-0.5 text-[12px] text-warm-meta">
            {[p.school, p.cls ? `Class ${p.cls}` : null, p.board, p.exam, p.year].filter(Boolean).join(' · ')}
          </p>
          <p className="mt-1 text-[12px] tabular-nums text-warm-secondary">
            {p.question_count} {p.question_count === 1 ? 'question' : 'questions'}
            {p.marks ? ` · ${p.marks} marks` : ''}
            {waiting ? ` · ${waiting}` : ''}
          </p>
        </div>
        <span
          className={cn('shrink-0 rounded-full px-3 py-1 text-[12px] font-bold', p.is_published ? 'bg-mint text-foreground' : 'bg-destructive/10 text-destructive')}
          data-testid="live-status"
        >
          {p.is_published ? 'Live' : 'Hidden'}
        </span>
      </div>
      {!p.is_published && (p.hidden_reason || p.hidden_at) ? (
        <p className="mt-2 text-[13px] text-warm-secondary" data-testid="hidden-why">
          Hidden{p.hidden_by ? ` by ${p.hidden_by}` : ''}
          {p.hidden_at ? ` ${ago(p.hidden_at)}` : ''}.{p.hidden_reason ? ` Why: ${p.hidden_reason}` : ''}
        </p>
      ) : null}
      <RouteTrail stage="live" className="mt-3" />

      {/* On a phone the actions share a row while they fit and the rest take a full row,
          so no button is left alone on the left. From sm up they sit side by side. */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {p.is_published ? (
          <>
            <Link to={`/past-papers/${encodeURIComponent(p.paper_id)}`} className={cn(quietButton, ACTION_FILL)}>
              See it on the site
            </Link>
            <button type="button" className={cn(quietButton, ACTION_FILL)} disabled={busy} aria-expanded={mode === 'hide'} onClick={() => setMode(mode === 'hide' ? null : 'hide')}>
              Hide
            </button>
          </>
        ) : (
          <button type="button" className={cn(actionToneClass('brand'), 'h-[46.5px]', ACTION_FILL)} disabled={busy} onClick={() => void run(() => api.restorePaper(p.paper_id), 'Paper is back on the site.')}>
            {busy ? 'Putting it back...' : 'Restore'}
          </button>
        )}
        <button type="button" className={cn(actionToneClass('dark'), ACTION_FILL)} disabled={busy} aria-expanded={mode === 'edit'} onClick={() => setMode(mode === 'edit' ? null : 'edit')}>
          Edit details
        </button>
        {p.audit_paper_id && p.waiting_you > 0 ? (
          <Link to={deskLink('needs-you', p.audit_paper_id)} className={cn(actionToneClass('brand'), 'h-[46.5px]', ACTION_FILL)}>
            See what needs you
          </Link>
        ) : null}
      </div>

      {mode === 'hide' ? (
        <div className="mt-3 rounded-2xl bg-card p-3">
          <label className="flex flex-col gap-1 text-[13px] font-semibold text-foreground">
            Why is it being hidden? (required)
            <input
              value={reason}
              onChange={(ev) => setReason(ev.target.value)}
              disabled={busy}
              className="min-h-[44px] rounded-xl bg-muted px-3 text-[16px] font-normal outline-none focus-visible:ring-2 focus-visible:ring-brand"
            />
          </label>
          <p className="mt-1 text-[12px] text-warm-meta">Visitors stop seeing it at once. Nothing is deleted, and it can be restored.</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className={actionToneClass('dark')}
              disabled={busy || reason.trim() === ''}
              onClick={() => void run(() => api.hidePaper(p.paper_id, reason.trim()), 'Paper hidden.')}
            >
              {busy ? 'Hiding...' : 'Hide it'}
            </button>
            <button type="button" className={quietButton} disabled={busy} onClick={() => setMode(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {mode === 'edit' ? (
        <div className="mt-3">
          <p className="mb-2 text-[13px] text-warm-secondary">
            Changes show on the site at once. Each box saves on its own. Leave an optional box empty and save to clear it.
          </p>
          <HeaderEditor
            fields={LIVE_FIELDS}
            values={values}
            save={(field, value) => api.editLivePaper(p.paper_id, field, value === '' ? null : value)}
            onSaved={onChanged}
            hints={{
              general_instructions: 'Not shown here. Type to replace what is on the paper.',
              incomplete_note: 'Not shown here. Type to replace what is on the paper.',
            }}
          />
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2 text-[13px] text-destructive">
          {error}
        </p>
      ) : null}
    </li>
  );
}

export function LiveTab({ api, scope }: { api: HodApi; scope: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: LIVE_KEY(scope), queryFn: () => api.livePapers(), staleTime: 15_000, refetchOnMount: true });
  const [filter, setFilter] = useState<LiveFilter>(NO_LIVE_FILTER);
  const [shown, setShown] = useState(LIVE_PAGE);
  const rows = useMemo(() => q.data ?? [], [q.data]);
  const counts = useMemo(() => liveCounts(rows), [rows]);
  const subjects = useMemo(() => distinctValues(rows, (r) => r.subject), [rows]);
  const classes = useMemo(() => distinctValues(rows, (r) => r.cls), [rows]);
  const filtered = useMemo(() => filterLivePapers(rows, filter), [rows, filter]);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['hod', scope] });
  const applied = filter.status !== 'all' || filter.subject !== '' || filter.cls !== '' || filter.q.trim() !== '';

  const set = (patch: Partial<LiveFilter>) => {
    setFilter((f) => ({ ...f, ...patch }));
    setShown(LIVE_PAGE);
  };

  if (q.isLoading) return <ListSkeleton label="Loading live papers" />;
  if (q.isError) return <LoadError what="The live papers" onRetry={() => void q.refetch()} />;
  if (rows.length === 0) return <EmptyNote>There are no papers in the library yet.</EmptyNote>;

  const select = 'min-h-[44px] rounded-xl bg-muted px-3 text-[14px] font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-brand';
  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:max-w-sm" data-testid="live-counts">
        <Tile label="Live" value={counts.live} hint="Papers visitors can read." />
        <Tile label="Hidden" value={counts.hidden} hint="Papers taken off the site. They can be restored." />
      </div>

      {/* Every control here is the same shape: a 12px caption over a 44px row, so the
          chips, the dropdowns and the search all sit on one centre line. On a phone the
          row becomes two columns, with the chips and the search each taking a full row. */}
      <div className="mb-4 grid grid-cols-2 items-end gap-3 sm:flex sm:flex-wrap sm:gap-2">
        <div className="col-span-2 flex flex-col gap-0.5 text-[12px] font-semibold text-warm-secondary">
          <span>Show</span>
          <div role="group" aria-label="Show papers" className="flex h-11 items-center gap-1.5">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                aria-pressed={filter.status === f.key}
                onClick={() => set({ status: f.key })}
                className={cn(
                  CHIP,
                  'h-11 px-3.5 transition-[transform,background-color,color]',
                  filter.status === f.key ? 'bg-panel text-background' : 'bg-muted text-warm-secondary hover:text-foreground',
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <label className="flex flex-col gap-0.5 text-[12px] font-semibold text-warm-secondary">
          Subject
          <select value={filter.subject} onChange={(ev) => set({ subject: ev.target.value })} className={select}>
            <option value="">All subjects</option>
            {subjects.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5 text-[12px] font-semibold text-warm-secondary">
          Class
          <select value={filter.cls} onChange={(ev) => set({ cls: ev.target.value })} className={select}>
            <option value="">All classes</option>
            {classes.map((c) => (
              <option key={c} value={c}>
                Class {c}
              </option>
            ))}
          </select>
        </label>
        <label className="col-span-2 flex min-w-[10rem] flex-1 flex-col gap-0.5 text-[12px] font-semibold text-warm-secondary">
          Search
          <input
            type="search"
            value={filter.q}
            onChange={(ev) => set({ q: ev.target.value })}
            placeholder="School, exam or year"
            className={select}
          />
        </label>
        {applied ? (
          <button type="button" className={cn(quietButton, 'col-span-2 justify-self-start')} onClick={() => set(NO_LIVE_FILTER)}>
            Clear filters
          </button>
        ) : null}
      </div>

      <p className="mb-3 text-[13px] tabular-nums text-warm-secondary" data-testid="live-shown">
        {applied ? `${filtered.length} of ${rows.length} papers` : `${rows.length} papers`}
      </p>

      {filtered.length === 0 ? (
        <EmptyNote>No paper matches these filters.</EmptyNote>
      ) : (
        <>
          <ul className="space-y-3">
            {filtered.slice(0, shown).map((p) => (
              <LiveRow key={p.paper_id} p={p} api={api} onChanged={refresh} />
            ))}
          </ul>
          {filtered.length > shown ? (
            <div className="mt-4 text-center">
              <button type="button" className={quietButton} onClick={() => setShown((n) => n + LIVE_PAGE)}>
                Show {Math.min(LIVE_PAGE, filtered.length - shown)} more
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
