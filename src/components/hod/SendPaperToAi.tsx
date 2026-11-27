import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ReasonBox, UndoStrip, useUndoWindow } from '@/components/hod/HodReason';
import { useHodConfirm } from '@/components/hod/HodConfirm';
import { quietButton } from '@/components/hod/HodShared';
import { actionToneClass } from '@/lib/checker-button-styles';
import type { HodApi } from '@/lib/hod-api';
import { refreshHod } from '@/lib/hod-refresh';
import {
  paperSendConfirm,
  paperSendCount,
  paperSentLine,
  reasonProblem,
  SEND_TO_AI_NOT_ON_WORDS,
  sendFailureWords,
} from '@/lib/hod-send-to-ai';
import { cn } from '@/lib/utils';

/* "Send whole paper to AI" (owner, 27 Nov 2026): for when the same problem runs through the whole paper (every table
   unreadable, wrong numbering). The HOD types ONE reason; every open question of the paper that is waiting on the HOD
   goes to the AI re-read queue with it, as one paper-wide request. A box can also take the paper's other open
   questions, the ones still with the student checkers. A confirm box says how many questions go, and Undo stays for
   a few seconds (the server undoes it for real, only while the AI has not picked anything up). */

export const PAPER_AI_COUNTS_KEY = (scope: string, paperId: string) => ['hod', scope, 'needs-you', paperId, 'ai-counts'] as const;

export function SendPaperToAi({ api, scope, paperId }: { api: HodApi; scope: string; paperId: string }) {
  const qc = useQueryClient();
  const { confirm, confirmDialog } = useHodConfirm();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [includeOther, setIncludeOther] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ requestId: string; text: string } | null>(null);
  const [undoing, setUndoing] = useState(false);
  const undo = useUndoWindow();

  const counts = useQuery({
    queryKey: PAPER_AI_COUNTS_KEY(scope, paperId),
    queryFn: () => api.paperAiCounts(paperId),
    enabled: open,
    staleTime: 0,
  });

  const refresh = () => {
    refreshHod(qc, scope, 'send-to-ai');
  };

  function close() {
    setOpen(false);
    setReason('');
    setIncludeOther(false);
    setError(null);
  }

  const c = counts.data ?? null;
  const notOn = open && counts.isSuccess && counts.data === null;
  const willSend = c ? paperSendCount(c, includeOther) : 0;
  const problem = reasonProblem(reason);
  const canSend = !busy && c !== null && willSend > 0 && problem === null;

  async function send() {
    if (!c) return;
    const words = paperSendConfirm(c, includeOther);
    if (!(await confirm({ title: words.title, description: words.description, confirmLabel: words.confirmLabel }))) return;
    setBusy(true);
    setError(null);
    try {
      const out = await api.sendPaperToAi(paperId, reason, includeOther);
      const text = paperSentLine(out.sent, out.moved_from_students);
      setSent({ requestId: out.request_id, text });
      undo.start();
      toast.success(text);
      close();
      refresh();
    } catch (err) {
      setError(sendFailureWords(err));
      refresh();
    } finally {
      setBusy(false);
    }
  }

  async function takeBack() {
    if (!sent) return;
    setUndoing(true);
    try {
      await api.undoSendPaperToAi(sent.requestId);
      toast.success('Taken back. The questions are with you again.');
      undo.stop();
      setSent(null);
      refresh();
    } catch (err) {
      toast.error(sendFailureWords(err));
      undo.stop();
    } finally {
      setUndoing(false);
    }
  }

  return (
    <div className="mb-3" data-testid="send-paper-to-ai">
      {open ? (
        <div className="rounded-[18px] bg-muted p-4 shadow-card" data-testid="send-paper-panel">
          <p className="mb-1 text-[15px] font-bold text-foreground">Send the whole paper to the AI</p>
          <p className="mb-3 text-[13px] text-warm-secondary">
            Use this when the same problem runs through the whole paper. One reason goes with every question, and the AI reads the paper again
            with it. Nothing changes in the words until the AI has read it again, and then you check what comes back.
          </p>
          {notOn ? (
            <p role="alert" className="mb-2 text-[13px] text-destructive">
              {SEND_TO_AI_NOT_ON_WORDS}
            </p>
          ) : counts.isError ? (
            <p role="alert" className="mb-2 text-[13px] text-destructive">
              The number of questions did not load. Close this and try again.
            </p>
          ) : c === null ? (
            <p className="mb-2 text-[13px] text-warm-secondary">Counting the questions...</p>
          ) : (
            <p className="mb-2 text-[13px] font-semibold text-foreground" data-testid="paper-ai-count">
              {c.needs_you === 1 ? '1 question is waiting for you' : `${c.needs_you} questions are waiting for you`}
              {c.skipped > 0 ? `, and ${c.skipped} already ${c.skipped === 1 ? 'is' : 'are'} in the AI flow and ${c.skipped === 1 ? 'stays' : 'stay'} as ${c.skipped === 1 ? 'it is' : 'they are'}` : ''}.
            </p>
          )}
          {c && c.other > 0 ? (
            <label className="mb-3 flex items-start gap-2 text-[14px] text-foreground">
              <input
                type="checkbox"
                className="mt-1 h-5 w-5 shrink-0"
                checked={includeOther}
                disabled={busy}
                onChange={(ev) => setIncludeOther(ev.target.checked)}
                data-testid="include-other"
              />
              <span>
                Also send this paper's other open questions, the {c.other} still with the student checkers. They leave the students and come to you
                first.
              </span>
            </label>
          ) : null}
          <ReasonBox
            id={`paper-ai-reason-${paperId}`}
            label="What is wrong with this paper? (required)"
            value={reason}
            onChange={setReason}
            disabled={busy}
            placeholder="For example: every table is missing its rows."
          />
          {error ? (
            <p role="alert" className="mt-2 text-[13px] text-destructive">
              {error}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={cn(actionToneClass('brand'), 'h-[46.5px]')}
              disabled={!canSend}
              onClick={() => void send()}
              data-testid="send-paper-go"
            >
              {busy ? 'Sending...' : willSend > 0 ? `Send ${willSend} to the AI` : 'Send to the AI'}
            </button>
            <button type="button" className={quietButton} disabled={busy} onClick={close}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className={quietButton}
          onClick={() => {
            setSent(null);
            undo.stop();
            setOpen(true);
          }}
          data-testid="send-paper-open"
        >
          Send whole paper to AI
        </button>
      )}
      {sent && undo.left > 0 ? <UndoStrip text={sent.text} left={undo.left} busy={undoing} onUndo={() => void takeBack()} /> : null}
      {sent && undo.left === 0 ? (
        <p role="status" className="mt-2 text-[13px] text-warm-secondary" data-testid="paper-sent-note">
          {sent.text} It now waits on the Send to AI tab.
        </p>
      ) : null}
      {confirmDialog}
    </div>
  );
}
