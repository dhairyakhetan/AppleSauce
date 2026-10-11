import { useCallback, useEffect, useState } from 'react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { DebugId } from '@/components/DebugId';
import { DebugFacts } from '@/components/admin/DebugFacts';
import type { ActivityApi, VersionRow, VersionedTable } from '@/lib/activity-api';
import {
  canRevert,
  changedFields,
  opWords,
  PRIMARY_FIELDS,
  revertConfirmText,
  shortId,
  tableWords,
  valueText,
} from '@/lib/activity-format';

/**
 * Owner round 24: "every question has version id + fingerprint, full history
 * on admin, revert to a specific version". One row's versions, newest first,
 * each with what changed since the one before it, and "Put back this
 * version" on every older one (admin_revert_to_version: the old text comes
 * back as a NEW version, so nothing is ever lost, including the version being
 * replaced). Question text is shown verbatim. answer_key never reaches this
 * component (admin_version_history strips it server side).
 */
export function VersionHistory({
  api,
  table,
  rowId,
  onReverted,
}: {
  api: Pick<ActivityApi, 'versionHistory' | 'revert'>;
  table: VersionedTable;
  rowId: string;
  onReverted?: (newVersion: number | null) => void;
}) {
  const [rows, setRows] = useState<VersionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRows(await api.versionHistory(table, rowId));
    } catch {
      setRows(null);
      setError('Could not load the history. Check your internet and try again.');
    }
  }, [api, table, rowId]);

  useEffect(() => {
    setRows(null);
    setConfirming(null);
    setNotice(null);
    void load();
  }, [load]);

  const current = rows?.find((r) => r.is_current)?.version ?? null;

  async function revert(version: number) {
    setBusy(true);
    setError(null);
    try {
      const next = await api.revert(table, rowId, version, reason);
      setConfirming(null);
      setReason('');
      setNotice(`Put back version ${version}. It is now version ${next ?? 'new'}.`);
      onReverted?.(next);
      await load();
    } catch (e) {
      const msg = (e as { message?: string })?.message ?? '';
      setError(
        /deleted/i.test(msg)
          ? 'This row was deleted, so it cannot be reverted here. Restore it from the paper history first.'
          : 'Could not put that version back. Nothing was changed. Try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="text-balance text-[15px] font-bold text-foreground">Version history</h3>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[12px] font-semibold text-warm-secondary">
          {tableWords(table)} {shortId(rowId)}
        </span>
        <DebugId label="row" value={rowId} />
        <DebugFacts facts={{ table, current }} />
      </div>

      <div aria-live="polite">
        {notice ? <p className="mb-3 rounded-2xl bg-mint px-3 py-2 text-[13px] font-semibold text-foreground">{notice}</p> : null}
        {error ? (
          <div role="alert" className="mb-3 flex flex-wrap items-center gap-2 rounded-2xl bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
            <span>{error}</span>
            {rows === null ? (
              <button type="button" onClick={() => void load()} className="tap-44 rounded-full py-2 bg-card px-3 font-semibold text-foreground">
                Try again
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {rows === null && !error ? (
        <div className="space-y-2" role="status" aria-label="Loading the history">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-2xl bg-muted" />
          ))}
        </div>
      ) : rows && rows.length === 0 ? (
        <p className="rounded-2xl bg-muted p-4 text-[13px] text-warm-secondary">
          No versions recorded yet. A question gets its first entry the first time its text changes after the version
          lock went live (1 October 2026).
        </p>
      ) : rows ? (
        <ol className="space-y-3">
          {rows.map((row, i) => {
            const older = rows.slice(i + 1).find((r) => r.op !== 'delete');
            const changed = older ? changedFields(older.snapshot, row.snapshot) : [];
            const shownFields = older
              ? changed
              : PRIMARY_FIELDS.filter((f) => row.snapshot[f] !== undefined && row.snapshot[f] !== null);
            return (
              <li
                key={`${row.version}-${row.op}-${row.created_at}`}
                className={cn('rounded-2xl p-3', row.is_current ? 'bg-brand-subtle ring-2 ring-inset ring-brand' : 'bg-muted')}
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[14px] font-bold tabular-nums text-foreground">Version {row.version}</span>
                  {row.is_current ? (
                    <span className="rounded-full bg-brand px-2 py-0.5 text-[11px] font-bold text-foreground">Current</span>
                  ) : null}
                  <span className="text-[12px] text-warm-secondary">{opWords(row.op)}</span>
                  <DebugFacts facts={{ sha256: row.content_sha256.slice(0, 12), source: row.source }} />
                </div>
                <p className="mt-0.5 text-[12px] text-warm-meta">
                  {format(new Date(row.created_at), 'd MMM yyyy, h:mm a')}
                  {' · '}
                  <span title={row.actor_user_id ?? row.actor ?? undefined} className="font-mono">
                    {row.actor_user_id ? shortId(row.actor_user_id) : row.actor ?? 'system'}
                  </span>
                  {row.reason ? <> · {row.reason}</> : null}
                </p>

                {shownFields.length > 0 ? (
                  <dl className="mt-2 space-y-1.5">
                    {shownFields.map((f) => (
                      <div key={f} className="rounded-xl bg-card px-2.5 py-1.5">
                        <dt className="text-[11px] font-bold uppercase tracking-[.04em] text-warm-label">
                          {f.replace(/_/g, ' ')}
                          {older ? ' changed' : ''}
                        </dt>
                        <dd className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-foreground">
                          {valueText(row.snapshot[f])}
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : older ? (
                  <p className="mt-1 text-[12px] text-warm-secondary">Same content as the version before.</p>
                ) : null}
                {row.has_answer_key ? (
                  <p className="mt-1 text-[12px] text-warm-meta">Has an answer key, not shown here.</p>
                ) : null}

                {canRevert(row) ? (
                  confirming === row.version ? (
                    <div className="mt-2 rounded-xl bg-card p-2.5">
                      <p className="text-[13px] text-foreground">{revertConfirmText(row.version, current)}</p>
                      <label className="mt-2 flex flex-col gap-1 text-[12px] font-semibold text-warm-secondary">
                        Why (optional, kept in the history)
                        <input
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          maxLength={300}
                          className="min-h-[40px] rounded-xl bg-muted px-3 text-[14px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-brand"
                        />
                      </label>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void revert(row.version)}
                          className="tap-44 rounded-full py-2 bg-panel px-4 text-[13px] font-bold text-background transition-transform duration-150 active:scale-[0.96] disabled:opacity-50"
                        >
                          {busy ? 'Putting it back...' : `Put back version ${row.version}`}
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setConfirming(null)}
                          className="tap-44 rounded-full py-2 bg-muted px-4 text-[13px] font-semibold text-warm-secondary"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setConfirming(row.version);
                        setReason('');
                      }}
                      className="tap-44 mt-2 rounded-full py-2 bg-card px-3.5 text-[13px] font-bold text-foreground transition-transform duration-150 hover:bg-warm-hairline active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                    >
                      Revert to this version
                    </button>
                  )
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : null}
    </div>
  );
}
