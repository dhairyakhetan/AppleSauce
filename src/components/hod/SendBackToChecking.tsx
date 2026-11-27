import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ReasonBox } from '@/components/hod/HodReason';
import { useHodConfirm } from '@/components/hod/HodConfirm';
import { quietButton } from '@/components/hod/HodShared';
import { actionToneClass } from '@/lib/checker-button-styles';
import type { HodApi } from '@/lib/hod-api';
import { refreshHod } from '@/lib/hod-refresh';
import { reasonProblem, SEND_BACK_NOT_ON_WORDS, sendBackConfirm, sendFailureWords } from '@/lib/hod-send-to-ai';
import { cn } from '@/lib/utils';

/* "Send back to checking" on a paper in Ready to go live (owner, 27 Nov 2026). The paper leaves the Ready list and its
   passed questions go back to the student checkers. A reason is required and is written in the history, with the HOD as
   the person who did it. Never offered on a live paper. Nothing is handed out by itself: the paper waits under Papers
   nobody has until an HOD presses Auto assign all. */

export function SendBackToChecking({
  api,
  scope,
  paperId,
  title,
  passedCount,
  onDone,
}: {
  api: HodApi;
  scope: string;
  paperId: string;
  title: string;
  /** How many passed questions will go back (the paper's passed count on the Ready row). */
  passedCount: number;
  onDone?: () => void;
}) {
  const qc = useQueryClient();
  const { confirm, confirmDialog } = useHodConfirm();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setOpen(false);
    setReason('');
    setError(null);
  }

  async function send() {
    const words = sendBackConfirm(passedCount);
    if (!(await confirm({ title: words.title, description: words.description, confirmLabel: words.confirmLabel }))) return;
    setBusy(true);
    setError(null);
    try {
      const reopened = await api.sendPaperBackToChecking(paperId, reason);
      toast.success(
        `${title} went back to checking. ${reopened} ${reopened === 1 ? 'question is' : 'questions are'} open for the student checkers. Give it to a checker with Auto assign all.`,
      );
      refreshHod(qc, scope, 'send-back-checking');
      close();
      onDone?.();
    } catch (err) {
      setError(sendFailureWords(err, SEND_BACK_NOT_ON_WORDS));
      refreshHod(qc, scope, 'send-back-checking');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <>
        <button type="button" className={quietButton} onClick={() => setOpen(true)} data-testid="send-back-open" aria-label={`Send ${title} back to checking`}>
          Send back to checking
        </button>
        {confirmDialog}
      </>
    );
  }
  return (
    <div className="mt-3 w-full rounded-2xl bg-card p-4" data-testid="send-back-panel">
      <p className="mb-1 text-[14px] font-bold text-foreground">Send this paper back to checking</p>
      <p className="mb-3 text-[13px] text-warm-secondary">
        The paper leaves the Ready list and its questions go back to the student checkers. Questions you left out stay left out.
      </p>
      <ReasonBox
        id={`send-back-reason-${paperId}`}
        label="Why is it going back? (required)"
        value={reason}
        onChange={setReason}
        disabled={busy}
        placeholder="For example: the pictures were attached to the wrong questions."
      />
      {error ? (
        <p role="alert" className="mt-2 text-[13px] text-destructive" data-testid="send-back-error">
          {error}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={cn(actionToneClass('brand'), 'h-[46.5px]')}
          disabled={busy || reasonProblem(reason) !== null}
          onClick={() => void send()}
          data-testid="send-back-go"
        >
          {busy ? 'Sending...' : 'Send it back'}
        </button>
        <button type="button" className={quietButton} disabled={busy} onClick={close}>
          Cancel
        </button>
      </div>
      {confirmDialog}
    </div>
  );
}
