import { useCallback, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { checkLine, historyLine } from '@/lib/history-labels';
import {
  versionChanges,
  writeErrorWords,
  type ApprovalApi,
  type QuestionHistory,
  type QuestionVersion,
} from '@/lib/admin-approval-shape';
import { QuestionBody } from '@/components/admin/approval/QuestionBody';
import { ChangeList } from '@/components/admin/approval/ChangeView';

/* Owner, 2026-10-02: "if I open the edit page ... and I go to a question, I
   can see the versions of the question."

   v1, v2, v3 ... newest first. Each says who made it, when and what changed,
   in words. "View" draws that version the way a visitor would see it,
   read-only. "Restore this version" brings its text back as a NEW version
   (admin_revert_question), so nothing is ever lost, and the restore itself
   shows up in the history with the admin's name. */

function versionAction(v: QuestionVersion, i: number): string {
  if (v.action && v.action !== 'update' && v.action !== 'insert' && v.action !== 'backfill') {
    if (v.action === 'revert') return 'version_revert';
    return v.action;
  }
  return i === 0 ? 'version_insert' : 'version_update';
}

export function QuestionVersions({
  api,
  questionId,
  questionLabel,
  figure,
  reloadKey = 0,
  onRestored,
  now,
}: {
  api: Pick<ApprovalApi, 'questionHistory' | 'revertQuestion'>;
  questionId: string;
  questionLabel: string | null;
  figure: string | null;
  reloadKey?: number;
  onRestored?: (newVersion: number | null) => void;
  now?: Date;
}) {
  const [hist, setHist] = useState<QuestionHistory | null>(null);
  const [error, setError] = useState(false);
  const [viewing, setViewing] = useState<number | null>(null);
  const [diffFor, setDiffFor] = useState<number | null>(null);
  const [confirming, setConfirming] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(false);
    try {
      setHist(await api.questionHistory(questionId));
    } catch {
      setHist(null);
      setError(true);
    }
  }, [api, questionId]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  async function restore(version: number) {
    setBusy(true);
    setWriteError(null);
    try {
      const next = await api.revertQuestion(questionId, version, note.trim());
      setConfirming(null);
      setNote('');
      setNotice(`Version ${version} is back.${next ? ` It is saved as version ${next}.` : ''}`);
      onRestored?.(next);
      await load();
    } catch (e) {
      setWriteError(writeErrorWords(e, 'That version could not be restored. Nothing was changed. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <div role="alert" className="rounded-2xl bg-card p-3 text-[13px] text-foreground">
        The versions did not load.
        <button type="button" onClick={() => void load()} className="tap-44 ml-2 font-semibold text-brand-blue">
          Try again
        </button>
      </div>
    );
  }
  if (!hist) {
    return (
      <div className="space-y-2" role="status" aria-label="Loading the versions">
        {[0, 1].map((i) => (
          <div key={i} className="h-16 animate-pulse rounded-2xl bg-card" />
        ))}
      </div>
    );
  }

  const versions = hist.versions;
  const current = versions.length ? versions[versions.length - 1].version : null;
  const newestFirst = versions.map((v, i) => ({ v, i })).reverse();

  return (
    <div>
      <div aria-live="polite">
        {notice ? <p className="mb-2 rounded-2xl bg-mint px-3 py-2 text-[13px] font-semibold text-foreground">{notice}</p> : null}
      </div>

      {versions.length === 0 ? (
        <p className="rounded-2xl bg-card p-3 text-[13px] text-warm-secondary">
          No versions are recorded for this question yet. The first one is saved the next time its text changes.
        </p>
      ) : (
        <ol className="space-y-2" aria-label="Versions, newest first">
          {newestFirst.map(({ v, i }) => {
            const older = i > 0 ? versions[i - 1] : null;
            const changes = versionChanges(older, v);
            const { who, what, when, note: vNote } = historyLine(
              {
                at: v.created_at,
                actor_kind: v.actor_kind,
                actor_name: v.actor_name,
                action: versionAction(v, i),
                changes,
                note: v.note,
              },
              now,
            );
            const isCurrent = v.version === current;
            return (
              <li
                key={v.version}
                className={cn('rounded-2xl p-3', isCurrent ? 'bg-brand-subtle ring-2 ring-inset ring-brand' : 'bg-card')}
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full bg-panel px-2 py-0.5 text-[12px] font-bold tabular-nums text-background">
                    v{v.version}
                  </span>
                  {isCurrent ? (
                    <span className="rounded-full bg-brand px-2 py-0.5 text-[12px] font-bold text-foreground">Current</span>
                  ) : null}
                  <span className="text-[12px] tabular-nums text-warm-meta">{when}</span>
                </div>
                <p className="mt-1 text-pretty text-[14px] leading-[1.5] text-foreground">
                  <span className="font-bold">{who}</span> {what}
                </p>
                {vNote ? <p className="mt-0.5 text-[13px] text-warm-prose">Note: {vNote}</p> : null}

                <div className="mt-2 flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    aria-expanded={viewing === v.version}
                    onClick={() => setViewing((cur) => (cur === v.version ? null : v.version))}
                    className="inline-flex min-h-10 items-center rounded-full bg-muted px-3.5 text-[13px] font-bold text-foreground transition-transform duration-150 hover:bg-warm-hairline active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {viewing === v.version ? 'Hide' : 'View'}
                  </button>
                  {changes.length ? (
                    <button
                      type="button"
                      aria-expanded={diffFor === v.version}
                      onClick={() => setDiffFor((cur) => (cur === v.version ? null : v.version))}
                      className="inline-flex min-h-10 items-center rounded-full bg-muted px-3.5 text-[13px] font-bold text-foreground transition-transform duration-150 hover:bg-warm-hairline active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {diffFor === v.version ? 'Hide changes' : 'What changed'}
                    </button>
                  ) : null}
                  {!isCurrent ? (
                    <button
                      type="button"
                      onClick={() => {
                        setConfirming(v.version);
                        setNote('');
                        setWriteError(null);
                      }}
                      className="inline-flex min-h-10 items-center rounded-full bg-panel px-3.5 text-[13px] font-bold text-background transition-transform duration-150 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      Restore this version
                    </button>
                  ) : null}
                </div>

                {diffFor === v.version ? <ChangeList changes={changes} /> : null}

                {viewing === v.version ? (
                  <div className="mt-2 rounded-[14px] bg-muted p-3">
                    <p className="mb-2 text-[12px] font-semibold text-warm-label">How version {v.version} reads on the site</p>
                    <QuestionBody
                      number={v.display_number ?? questionLabel}
                      marks={v.marks}
                      instructions={v.instructions}
                      body={v.body}
                      options={v.options}
                      figure={figure}
                    />
                  </div>
                ) : null}

                {confirming === v.version ? (
                  <div className="mt-2 rounded-[14px] bg-muted p-3">
                    <p className="text-[13px] text-foreground">
                      Bring back the text of version {v.version}? It is saved as version {(current ?? 0) + 1}. Every version stays in
                      this list, so this can be undone the same way.
                    </p>
                    <label className="mt-2 flex flex-col gap-1 text-[12px] font-semibold text-warm-secondary">
                      Why (optional, shown in the history)
                      <input
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        maxLength={300}
                        className="min-h-10 rounded-xl bg-card px-3 text-[14px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-brand"
                      />
                    </label>
                    {writeError ? (
                      <p role="alert" className="mt-2 text-[13px] text-destructive">
                        {writeError}
                      </p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void restore(v.version)}
                        className="inline-flex min-h-10 items-center rounded-full bg-panel px-4 text-[13px] font-bold text-background transition-transform duration-150 active:scale-[0.96] disabled:opacity-60"
                      >
                        {busy ? 'Restoring...' : `Restore version ${v.version}`}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setConfirming(null)}
                        className="inline-flex min-h-10 items-center rounded-full bg-card px-4 text-[13px] font-semibold text-warm-secondary"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}

      {hist.checks.length ? (
        <div className="mt-3">
          <p className="mb-1 text-[12px] font-semibold text-warm-label">Checks on this question</p>
          <ul className="space-y-1">
            {hist.checks.map((c, i) => (
              <li key={i} className="rounded-[12px] bg-card px-3 py-2 text-[13px] text-foreground">
                {checkLine(c, now)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
