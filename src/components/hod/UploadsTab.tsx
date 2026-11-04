import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { EmptyNote, ListSkeleton, LoadError, ago, quietButton } from '@/components/hod/HodShared';
import { CHIP, actionToneClass } from '@/lib/checker-button-styles';
import type { HodApi } from '@/lib/hod-api';
import {
  UPLOAD_FILTERS,
  errorWords,
  fileNameOf,
  uploadDecisionProblem,
  uploadStatusWord,
  uploadTitle,
  type HodStudentUpload,
  type UploadStatus,
} from '@/lib/hod-publish';
import { cn } from '@/lib/utils';

/* "Student uploads": papers students sent in with Submit a paper. Open the files
   to look at them, then approve or reject. Rejecting needs a reason. Approving
   only records the yes; an approved paper enters the checking route when the
   owner next runs it. The sender's contact is never shown here. */

export const UPLOADS_KEY = (scope: string, status: UploadStatus) => ['hod', scope, 'uploads', status] as const;

function Files({ api, upload }: { api: HodApi; upload: HodStudentUpload }) {
  const [links, setLinks] = useState<{ path: string; url: string | null }[] | null>(null);
  const [loading, setLoading] = useState(false);
  async function load() {
    setLoading(true);
    const out = await Promise.all(upload.file_paths.map(async (path) => ({ path, url: await api.uploadFileUrl(path).catch(() => null) })));
    setLinks(out);
    setLoading(false);
  }
  if (upload.file_paths.length === 0) return <p className="text-[13px] text-warm-secondary">No files came with this one.</p>;
  if (!links) {
    return (
      <button type="button" className={quietButton} disabled={loading} onClick={() => void load()}>
        {loading ? 'Getting the files...' : `Show ${upload.file_paths.length === 1 ? 'the file' : `the ${upload.file_paths.length} files`}`}
      </button>
    );
  }
  return (
    <ul className="space-y-1" aria-label="Files">
      {links.map((l, i) => (
        <li key={l.path}>
          {l.url ? (
            <a href={l.url} target="_blank" rel="noreferrer" className="tap-44 inline-flex items-center text-[14px] font-semibold text-brand-blue underline underline-offset-2">
              File {i + 1}: {fileNameOf(l.path)}
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          ) : (
            <span className="text-[14px] text-destructive">File {i + 1} could not be opened. Reload the list to get a fresh link.</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function UploadCard({ api, upload, onDone }: { api: HodApi; upload: HodStudentUpload; onDone: () => void }) {
  const [mode, setMode] = useState<null | 'rejected'>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = upload.status === 'pending';

  async function decide(decision: 'approved' | 'rejected') {
    const problem = uploadDecisionProblem(decision, note);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.reviewUpload(upload.id, decision, note);
      toast.success(decision === 'approved' ? 'Upload approved.' : 'Upload rejected.');
      onDone();
    } catch (err) {
      setError(errorWords(err));
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-[18px] bg-muted p-4" data-testid="upload-card" data-status={upload.status}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[15px] font-bold text-foreground">{uploadTitle(upload)}</p>
          <p className="mt-0.5 text-[12px] text-warm-meta">
            Sent by {upload.submitter_name ?? 'a student'}
            {upload.created_at ? ` ${ago(upload.created_at)}` : ''} · {upload.file_count} {upload.file_count === 1 ? 'file' : 'files'}
          </p>
        </div>
        <span
          className={cn(
            'rounded-full px-3 py-1 text-[12px] font-bold',
            upload.status === 'approved' ? 'bg-mint text-foreground' : upload.status === 'rejected' ? 'bg-destructive/10 text-destructive' : 'bg-brand-subtle text-foreground',
          )}
        >
          {uploadStatusWord(upload.status)}
        </span>
      </div>
      <div className="mt-3">
        <Files api={api} upload={upload} />
      </div>
      {!pending ? (
        <p className="mt-2 text-[13px] text-warm-secondary">
          {uploadStatusWord(upload.status)}
          {upload.reviewed_by_name ? ` by ${upload.reviewed_by_name}` : ''}
          {upload.reviewed_at ? ` ${ago(upload.reviewed_at)}` : ''}.{upload.review_note ? ` Note: ${upload.review_note}` : ''}
        </p>
      ) : (
        <div className="mt-3">
          {mode === 'rejected' ? (
            <label className="mb-2 flex flex-col gap-1 text-[13px] font-semibold text-foreground">
              Why is it rejected? (required)
              <textarea
                value={note}
                onChange={(ev) => setNote(ev.target.value)}
                rows={2}
                disabled={busy}
                className="w-full rounded-xl bg-card p-3 text-[14px] font-normal outline-none focus-visible:ring-2 focus-visible:ring-brand"
              />
            </label>
          ) : null}
          {error ? (
            <p role="alert" className="mb-2 text-[13px] text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {mode === null ? (
              <>
                <button type="button" className={cn(actionToneClass('brand'), 'h-[46.5px]')} disabled={busy} onClick={() => void decide('approved')}>
                  {busy ? 'Saving...' : 'Approve'}
                </button>
                <button type="button" className={quietButton} disabled={busy} onClick={() => setMode('rejected')}>
                  Reject
                </button>
              </>
            ) : (
              <>
                <button type="button" className={actionToneClass('dark')} disabled={busy || note.trim() === ''} onClick={() => void decide('rejected')}>
                  {busy ? 'Saving...' : 'Reject it'}
                </button>
                <button
                  type="button"
                  className={quietButton}
                  disabled={busy}
                  onClick={() => {
                    setMode(null);
                    setError(null);
                  }}
                >
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

export function UploadsTab({ api, scope }: { api: HodApi; scope: string }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<UploadStatus>('pending');
  const q = useQuery({ queryKey: UPLOADS_KEY(scope, status), queryFn: () => api.studentUploads(status), staleTime: 0, refetchOnMount: true });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['hod', scope] });
  return (
    <div>
      <div role="group" aria-label="Show uploads" className="mb-4 flex flex-wrap gap-1.5">
        {UPLOAD_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            aria-pressed={status === f.key}
            onClick={() => setStatus(f.key)}
            className={cn(CHIP, status === f.key ? 'bg-panel text-background' : 'bg-muted text-warm-secondary hover:text-foreground')}
          >
            {f.label}
          </button>
        ))}
      </div>
      {q.isLoading ? (
        <ListSkeleton label="Loading student uploads" />
      ) : q.isError ? (
        <LoadError what="The student uploads" onRetry={() => void q.refetch()} />
      ) : (q.data ?? []).length === 0 ? (
        <EmptyNote>{status === 'pending' ? 'No upload is waiting. When a student sends in a paper, it shows here.' : 'No uploads in this list yet.'}</EmptyNote>
      ) : (
        <ul className="space-y-3">
          {(q.data ?? []).map((u) => (
            <UploadCard key={u.id} api={api} upload={u} onDone={refresh} />
          ))}
        </ul>
      )}
    </div>
  );
}
