import { refreshHod } from '@/lib/hod-refresh';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Check, X } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { HeaderEditor } from '@/components/hod/HeaderEditor';
import { ListSkeleton, LoadError, Notice, deskLink, quietButton } from '@/components/hod/HodShared';
import { SendBackToChecking } from '@/components/hod/SendBackToChecking';
import { PaperPageFlip } from '@/components/checker/PaperPageFlip';
import { PaperSheet, type PictureWork } from '@/components/hod/PaperSheet';
import { STAGE_FAILED_WORDS, stagePictures, unstagedCount } from '@/lib/stage-pictures';
import { CheckChips, RouteTrail } from '@/components/hod/RouteTrail';
import { PaperStatusPill, PaperTimelineDisclosure } from '@/components/PaperStatus';
import { EMPTY_MOMENTS, stageOfReady } from '@/lib/paper-status';
import { useConfirm } from '@/components/ui/use-confirm';
import { actionToneClass } from '@/lib/checker-button-styles';
import type { HodApi } from '@/lib/hod-api';
import {
  MARK_WORDS,
  OVERRIDE_MAX_REASON,
  OVERRIDE_REASON_LABEL,
  OVERRIDE_TICK_TEXT,
  PUBLISH_FIELDS,
  UNSAVED_TEXT,
  UNSAVED_TITLE,
  UnsavedContext,
  aiOnlyText,
  allChecksPass,
  canPublishAnywayNow,
  canPublishNow,
  leftOutConfirmText,
  checkFixHint,
  checksSummary,
  errorWords,
  failedChecks,
  headerText,
  junkNumbersText,
  leftOutText,
  markedIds,
  marksMismatch,
  nextReadyPaper,
  overrideErrorWords,
  overrideOffered,
  overrideProblemsText,
  overrideWhyOff,
  type CheckKey,
  type HodPreview,
  type MarkKind,
  type PublishField,
  type UnsavedRegistry,
  notPublishedWords,
  paperIsQueued,
  paperNotOnList,
  queueErrorWords,
} from '@/lib/hod-publish';
import { cn } from '@/lib/utils';

/* The preview flow for one paper that is ready to go live. Four steps, each a
   plain page you can come back to:
     1. The paper: read it exactly as the live page will draw it, with pictures and tables.
     2. Checks: the four checks as a green or red list, each with its own words
        and a button that goes to the fix ("Show me" walks through the marked questions).
     3. Details: class, subject, board, year, school, exam, marks, time and the
        instructions; one "Save all changes" button, and tick boxes that save at once.
     4. Publish: enabled only when all four checks pass. When the server refuses
        it, its own sentence is shown (raw database wording never is).
   The step is in the address (?step=checks), so the browser's Back and a reload keep it. The step bar stays at the
   top while scrolling, and a new step starts at the top. Typed words that are not saved are never thrown away
   silently: a step change, Back or leaving asks first, and the browser asks before a reload.
   When a check fails, "Publish anyway" sits under the red list (owner, 14 Nov 2026:
   "allow me to ignore and pass as an override"): tick a box, type why (10 characters
   or more), and the reason and the checks skipped are saved in the paper's history.
   It is a separate, deliberate button with a warning look; the normal Publish never skips a check. */

export const PREVIEW_KEY = (scope: string, paperId: string) => ['hod', scope, 'preview', paperId] as const;

const STEPS = [
  { key: 'paper', label: 'The paper', short: 'Paper' },
  { key: 'checks', label: 'Checks', short: 'Checks' },
  { key: 'details', label: 'Details', short: 'Details' },
  { key: 'publish', label: 'Publish', short: 'Publish' },
] as const;

type StepKey = (typeof STEPS)[number]['key'];

export function stepFromParam(v: string | null): StepKey {
  return STEPS.some((s) => s.key === v) ? (v as StepKey) : 'paper';
}

const SHOW_ME = cn(actionToneClass('dark'), 'h-[46.5px]');

function CheckList({
  preview,
  go,
  paperId,
  showMarked,
  retryPictures,
}: {
  preview: HodPreview;
  go: (s: StepKey) => void;
  paperId: string;
  showMarked: (kind: MarkKind) => void;
  retryPictures: () => void;
}) {
  const junk = preview.questions.filter((q) => q.scanner_junk && q.state !== 'set_aside');
  const openIds = markedIds('open', preview.questions);
  const pictureIds = markedIds('pictures', preview.questions);
  // The questions checked by the AI only, marked on the paper once the database says which ones (20261126310000).
  const aiIds = markedIds('ai_only', preview.questions);
  return (
    <ul className="space-y-2" data-testid="check-list">
      {preview.checks.map((c) => {
        const aiOnly = c.key === 'questions_checked' && !c.ok ? aiOnlyText(c.ai_only ?? 0, aiIds.length > 0) : null;
        return (
          <li
            key={c.key}
            id={`check-${c.key}`}
            data-check={c.key}
            data-ok={c.ok}
            className={cn('rounded-[18px] p-4', c.ok ? 'bg-mint' : 'bg-destructive/10')}
          >
            <div className="flex items-start gap-3">
              <span
                aria-hidden
                className={cn('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white', c.ok ? 'bg-mint-solid' : 'bg-destructive')}
              >
                {c.ok ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
              </span>
              <div className="min-w-0">
                <p className="text-[15px] font-bold text-foreground">
                  {c.label}
                  <span className="sr-only">{c.ok ? ': passes' : ': needs fixing'}</span>
                </p>
                {c.detail ? <p className="mt-0.5 text-[14px] text-foreground">{c.detail}</p> : null}
                {!c.ok ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <p className="w-full text-[13px] text-warm-secondary">{checkFixHint(c.key)}</p>
                    {c.key === 'questions_checked' ? (
                      <>
                        {openIds.length > 0 ? (
                          <button type="button" className={SHOW_ME} onClick={() => showMarked('open')}>
                            Show me the open questions
                          </button>
                        ) : null}
                        {preview.counts.open > 0 ? (
                          <Link to={deskLink('needs-you', paperId)} className={cn(actionToneClass('brand'), 'h-[46.5px]')}>
                            Go to Needs you
                          </Link>
                        ) : null}
                        {aiOnly ? (
                          <>
                            <p className="w-full text-[13px] text-foreground" data-testid="ai-only-note">
                              {aiOnly}
                            </p>
                            {aiIds.length > 0 ? (
                              <button type="button" className={SHOW_ME} onClick={() => showMarked('ai_only')} data-testid="show-ai-only">
                                Show me the questions checked by the AI only
                              </button>
                            ) : null}
                            <button type="button" className={quietButton} onClick={() => go('publish')}>
                              Go to Publish anyway
                            </button>
                          </>
                        ) : null}
                      </>
                    ) : null}
                    {c.key === 'pictures_present' ? (
                      <>
                        {pictureIds.length > 0 ? (
                          <button type="button" className={SHOW_ME} onClick={() => showMarked('pictures')}>
                            Show me
                          </button>
                        ) : null}
                        <button type="button" className={quietButton} onClick={retryPictures}>
                          Try again
                        </button>
                      </>
                    ) : null}
                    {c.key === 'header_complete' ? (
                      <button type="button" className={actionToneClass('dark')} onClick={() => go('details')}>
                        Fill in the details
                      </button>
                    ) : null}
                    {c.key === 'scanner_junk_gone' ? (
                      <button type="button" className={actionToneClass('dark')} onClick={() => showMarked('junk')}>
                        Show me the marked questions
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {c.key === 'scanner_junk_gone' && !c.ok && junk.length > 0 ? (
                  <p className="mt-1 text-[13px] text-warm-secondary">
                    Marked: {junkNumbersText(junk.map((q) => q.display_number ?? q.number_path))}.
                  </p>
                ) : null}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** The "Publish anyway" box under the red list. Shown only while a check fails; the page owns the state and the call. */
export function PublishAnywayBox({
  ticked,
  reason,
  error,
  busy,
  canOverride,
  whyOff,
  onTick,
  onReason,
  onPublish,
}: {
  ticked: boolean;
  reason: string;
  error: string | null;
  busy: boolean;
  canOverride: boolean;
  whyOff: string;
  onTick: (v: boolean) => void;
  onReason: (v: string) => void;
  onPublish: () => void;
}) {
  return (
    <div className="mt-3 rounded-[18px] bg-card p-4 shadow-card ring-1 ring-destructive/30" data-testid="publish-anyway">
      <p className="flex items-center gap-1.5 text-[14px] font-bold text-foreground">
        <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" aria-hidden />
        Or publish anyway, with the problem
      </p>
      <p className="mt-0.5 text-[13px] text-warm-secondary">
        Fixing the problem is better. If it cannot wait, you can put the paper on the site as it is. Visitors will not see anything different.
      </p>
      <label className="mt-3 flex items-start gap-3 text-[14px] font-semibold text-foreground" data-testid="publish-anyway-tick">
        <input
          type="checkbox"
          checked={ticked}
          disabled={busy}
          onChange={(ev) => onTick(ev.target.checked)}
          className="mt-0.5 h-5 w-5 shrink-0 accent-[hsl(var(--brand))]"
        />
        <span>{OVERRIDE_TICK_TEXT}</span>
      </label>
      {ticked ? (
        <label className="mt-3 flex flex-col gap-1 text-[13px] font-semibold text-foreground">
          {OVERRIDE_REASON_LABEL}
          <textarea
            value={reason}
            onChange={(ev) => onReason(ev.target.value)}
            rows={3}
            maxLength={OVERRIDE_MAX_REASON}
            disabled={busy}
            aria-describedby="publish-anyway-help"
            data-testid="publish-anyway-reason"
            className="w-full rounded-xl bg-muted p-3 text-[16px] font-normal outline-none focus-visible:ring-2 focus-visible:ring-focus"
          />
        </label>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 rounded-2xl bg-destructive/10 px-4 py-3 text-[14px] text-destructive" data-testid="publish-anyway-error">
          {error}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={cn(actionToneClass('outline'), 'min-w-[160px] border-destructive text-destructive hover:bg-destructive/10')}
          disabled={!canOverride}
          aria-describedby="publish-anyway-help"
          onClick={onPublish}
          data-testid="publish-anyway-button"
        >
          <AlertTriangle className="h-[18px] w-[18px] shrink-0" aria-hidden />
          {busy ? 'Publishing...' : 'Publish anyway'}
        </button>
        <p id="publish-anyway-help" className="text-[13px] text-warm-secondary" data-testid="publish-anyway-help">
          {canOverride ? "Your name and reason go in the paper's history." : whyOff}
        </p>
      </div>
    </div>
  );
}

export function PublishFlow({ api, scope, paperId }: { api: HodApi; scope: string; paperId: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { confirm, confirmDialog } = useConfirm();
  const [params, setParams] = useSearchParams();
  const step = stepFromParam(params.get('step'));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmedLeftOut, setConfirmedLeftOut] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [published, setPublished] = useState<{ liveId: string | null; questions: number; anyway?: boolean } | null>(null);
  const [overrideTicked, setOverrideTicked] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [overrideError, setOverrideError] = useState<string | null>(null);
  const [queueBusy, setQueueBusy] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [jump, setJump] = useState<{ kind: MarkKind; index: number } | null>(null);
  const [photoOpen, setPhotoOpen] = useState(false);
  const stepRefs = useId();
  const topRef = useRef<HTMLDivElement | null>(null);

  // Unsaved work: every editor on this screen marks itself while it holds typed words that are not saved.
  const dirtyKeys = useRef(new Set<string>());
  const [dirtyCount, setDirtyCount] = useState(0);
  const registry = useMemo<UnsavedRegistry>(
    () => ({
      mark(key, dirty) {
        const set = dirtyKeys.current;
        if (dirty === set.has(key)) return;
        if (dirty) set.add(key);
        else set.delete(key);
        setDirtyCount(set.size);
      },
    }),
    [],
  );
  // The publish note and the Publish anyway reason live on this page across steps; they are lost only when leaving it.
  const pageDirty = note.trim() !== '' || overrideReason.trim() !== '';
  useEffect(() => {
    if (dirtyCount === 0 && !pageDirty) return undefined;
    const onUnload = (ev: BeforeUnloadEvent) => {
      ev.preventDefault();
      ev.returnValue = '';
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [dirtyCount, pageDirty]);

  async function okToGo(leavingPage: boolean): Promise<boolean> {
    if (dirtyCount === 0 && !(leavingPage && pageDirty)) return true;
    return confirm({ title: UNSAVED_TITLE, description: UNSAVED_TEXT, confirmLabel: 'Go on without saving', cancelLabel: 'Stay and save' });
  }

  function setStepParam(s: StepKey) {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('step', s);
      return next;
    });
  }

  async function go(s: StepKey) {
    if (s === step) return;
    if (!(await okToGo(false))) return;
    setJump(null);
    setStepParam(s);
  }

  async function showMarked(kind: MarkKind) {
    if (step !== 'paper') {
      if (!(await okToGo(false))) return;
      setStepParam('paper');
    }
    setJump({ kind, index: 0 });
  }

  async function leave(ev: MouseEvent<HTMLAnchorElement>, to: string) {
    if (dirtyCount === 0 && !pageDirty) return;
    ev.preventDefault();
    if (await okToGo(true)) navigate(to);
  }

  const q = useQuery({
    queryKey: PREVIEW_KEY(scope, paperId),
    queryFn: () => api.paperPreview(paperId),
    staleTime: 0,
    refetchOnMount: true,
    // After publishing the paper is no longer waiting, so the preview is left as it was.
    enabled: !published,
  });
  const data = q.data;
  const refresh = () => refreshHod(qc, scope, 'publish');

  // After publishing: the next paper on the Ready list, so the HOD can carry on.
  const next = useQuery({
    queryKey: ['hod', scope, 'ready-next', paperId],
    queryFn: () => api.readyPapers(),
    enabled: Boolean(published),
    staleTime: 0,
  });
  const nextPaper = next.data ? nextReadyPaper(next.data, paperId) : null;

  // A new step starts at the top of the flow (not halfway down the last one). A "Show me" scrolls to its question instead.
  const firstStep = useRef(true);
  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    if (jump && step === 'paper') return;
    topRef.current?.scrollIntoView?.({ block: 'start' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // "Show me": the marked questions, worked out afresh from the paper each time, so a fixed one drops off the list.
  const jumpIds = data && jump ? markedIds(jump.kind, data.questions) : [];
  const jumpIndex = jump ? Math.min(jump.index, Math.max(0, jumpIds.length - 1)) : 0;
  const currentId = jump && step === 'paper' ? (jumpIds[jumpIndex] ?? null) : null;
  useEffect(() => {
    if (!currentId || typeof window === 'undefined') return;
    window.setTimeout(() => {
      document.getElementById(`q-${currentId}`)?.scrollIntoView?.({ block: 'center' });
      document.getElementById(`edit-${currentId}`)?.focus({ preventScroll: true });
    }, 30);
  }, [currentId, jump?.index]);

  // The left-out tick is about a number. When the number changes (a question put back or left out), it is asked again.
  const leftOutNow = data?.counts.set_aside ?? 0;
  const lastLeftOut = useRef<number | null>(null);
  useEffect(() => {
    if (lastLeftOut.current !== null && lastLeftOut.current !== leftOutNow) setConfirmedLeftOut(false);
    lastLeftOut.current = leftOutNow;
  }, [leftOutNow]);

  // A picture the checkers kept is copied onto the site by itself when the paper is opened here (owner, 13 Nov: "not on
  // the site yet shouldnt happen ... it can just show on the paper itself"). It runs once per open and when Try again is
  // pressed; a paper that is already live or only waiting for a record is left alone.
  const [pictureWork, setPictureWork] = useState<PictureWork>(null);
  const [pictureTry, setPictureTry] = useState(0);
  const needsPictures = data ? unstagedCount(data.questions) > 0 : false;
  const canStage = Boolean(data) && (data?.paper.approval_state === 'awaiting' || data?.paper.approval_state === null) && !data?.paper.is_live && data?.paper.kind !== 'retro';
  useEffect(() => {
    if (!canStage || !needsPictures) return;
    let cancelled = false;
    setPictureWork('running');
    void stagePictures(
      {
        list: (id) => api.unstagedPictures(id),
        copy: (item) => api.copyPictureToSite(item),
        confirm: (questionId, version) => api.confirmStagedPicture(questionId, version),
      },
      paperId,
    ).then((out) => {
      if (cancelled) return;
      if (out.kind === 'failed') setPictureWork('failed');
      else if (out.kind === 'unavailable') setPictureWork('unavailable');
      else {
        setPictureWork(null);
        void q.refetch();
        refresh();
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canStage, needsPictures, paperId, pictureTry]);
  const retryPictures = () => {
    setPictureTry((n) => n + 1);
    void q.refetch();
  };

  const onStepKey = (ev: KeyboardEvent<HTMLButtonElement>) => {
    const i = STEPS.findIndex((s) => s.key === step);
    if (ev.key === 'ArrowRight') void go(STEPS[(i + 1) % STEPS.length].key);
    else if (ev.key === 'ArrowLeft') void go(STEPS[(i - 1 + STEPS.length) % STEPS.length].key);
    else return;
    ev.preventDefault();
  };

  if (published) {
    return (
      <div>
        <div className="rounded-[18px] bg-mint p-5" role="status" data-testid="publish-success">
          <h2 className="text-[20px] font-extrabold text-foreground">Published</h2>
          {published.anyway ? (
            <p className="mt-1 text-[14px] font-semibold text-foreground" data-testid="publish-anyway-done">
              Published anyway. Your reason is saved in the paper's history.
            </p>
          ) : null}
          <p className="mt-1 text-[14px] text-foreground">
            {published.questions > 0 ? `${published.questions} ${published.questions === 1 ? 'question' : 'questions'} are live.` : 'The paper is live.'} Students can
            open it now. Google finds it a little later, after the next site update.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {nextPaper ? (
              <Link to={deskLink('ready', nextPaper.audit_paper_id)} className={cn(actionToneClass('brand'), 'h-[46.5px]')} data-testid="next-paper">
                Next paper ready to go live
              </Link>
            ) : null}
            {published.liveId ? (
              <Link to={`/past-papers/${encodeURIComponent(published.liveId)}`} className={actionToneClass('dark')} data-testid="live-link">
                Open the live paper
              </Link>
            ) : null}
            <Link to={deskLink('ready')} className={nextPaper ? quietButton : cn(actionToneClass('brand'), 'h-[46.5px]')}>
              Back to Ready to go live
            </Link>
            <Link to={deskLink('live')} className={quietButton}>
              See Live papers
            </Link>
          </div>
          {nextPaper ? (
            <p className="mt-2 text-[13px] text-foreground" data-testid="next-paper-title">
              Next: {nextPaper.title}
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  const backLink = (
    <Link
      to={deskLink('ready')}
      onClick={(ev) => void leave(ev, deskLink('ready'))}
      className="tap-44 mb-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-brand-blue hover:text-brand-blue-deep"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden />
      Back to Ready to go live
    </Link>
  );

  if (q.isLoading) return <ListSkeleton rows={4} label="Loading the paper" />;
  if (q.isError || !data) {
    return (
      <div>
        {backLink}
        <LoadError what="This paper" onRetry={() => void q.refetch()} />
        {q.error ? (
          <p className="mt-2 text-[13px] text-warm-secondary" data-testid="preview-error">
            {errorWords(q.error, '')}
          </p>
        ) : null}
        {confirmDialog}
      </div>
    );
  }

  const { paper } = data;
  const header = paper.header;
  // Only a paper that is ON the Ready list can be published: the server refuses any other. A paper that was never put
  // there (approval_state null) can still be opened and edited here, and gets its own button to join the list.
  const waiting = paperIsQueued(paper.approval_state);
  const notOnList = paperNotOnList(paper);
  const pass = allChecksPass(data.checks);
  const leftOutCount = data.counts.set_aside;
  const canPublish = canPublishNow(data.checks, leftOutCount, confirmedLeftOut, waiting) && !busy;
  const offerOverride = overrideOffered(data.checks, waiting);
  const canOverride =
    canPublishAnywayNow({ checks: data.checks, waiting, ticked: overrideTicked, reason: overrideReason, leftOut: leftOutCount, confirmedLeftOut }) && !busy;
  const alreadyLive = paper.kind === 'retro' || paper.is_live;
  const failed = failedChecks(data.checks);
  const leftOut = leftOutText(data.counts.set_aside);
  const values: Record<string, string> = Object.fromEntries(PUBLISH_FIELDS.map((f) => [f.key, headerText(header, f.key as PublishField)]));
  const mismatch = marksMismatch(header, paper.marks_from_questions);
  const stepIndex = STEPS.findIndex((s) => s.key === step);
  const pictureIds = markedIds('pictures', data.questions);
  const picturesCheck = data.checks.find((c) => c.key === 'pictures_present');
  const picturesRed = Boolean(picturesCheck && !picturesCheck.ok);

  /** Where a red check is fixed: the marked questions on the paper, or the step that holds the fix. */
  function goToFix(key: CheckKey) {
    const ids = (kind: MarkKind) => markedIds(kind, data!.questions);
    if (key === 'header_complete') void go('details');
    else if (key === 'scanner_junk_gone' && ids('junk').length > 0) void showMarked('junk');
    else if (key === 'pictures_present' && ids('pictures').length > 0) void showMarked('pictures');
    else if (key === 'questions_checked' && ids('open').length > 0) void showMarked('open');
    else if (key === 'questions_checked' && ids('ai_only').length > 0) void showMarked('ai_only');
    else void go('checks');
  }

  async function publish() {
    if (!canPublish) return;
    const ok = await confirm({
      title: alreadyLive ? 'Record the approval for this paper?' : 'Put this paper on the site?',
      description: alreadyLive
        ? 'The paper is already live. This only records your yes.'
        : `${data!.counts.passed} ${data!.counts.passed === 1 ? 'question goes' : 'questions go'} live for visitors. You can hide the paper afterwards from Live papers.`,
      confirmLabel: alreadyLive ? 'Record it' : 'Publish',
      cancelLabel: 'Not yet',
    });
    if (!ok) return;
    setBusy(true);
    setPublishError(null);
    try {
      const out = await api.approvePaper(paperId, note, leftOutCount > 0 ? confirmedLeftOut : undefined);
      toast.success('Paper published.');
      setNote('');
      setPublished({ liveId: out.live_bank_paper_id, questions: out.question_count });
      refresh();
    } catch (err) {
      // The server's sentence, as written: it names every check that failed.
      setPublishError(notPublishedWords(err));
      refresh();
    } finally {
      setBusy(false);
    }
  }

  async function putOnList() {
    if (queueBusy) return;
    setQueueBusy(true);
    setQueueError(null);
    try {
      await api.queuePaper(paperId);
      toast.success('The paper is on the Ready to go live list.');
      refresh();
      void q.refetch();
    } catch (err) {
      setQueueError(queueErrorWords(err));
    } finally {
      setQueueBusy(false);
    }
  }

  async function publishAnyway() {
    if (!canOverride) return;
    const ok = await confirm({
      title: 'Publish this paper with a problem?',
      description: `${overrideProblemsText(failed)} ${data!.counts.passed} ${data!.counts.passed === 1 ? 'question goes' : 'questions go'} live for visitors. Your reason is saved in the paper's history with your name. You can hide the paper afterwards from Live papers.`,
      confirmLabel: 'Publish anyway',
      cancelLabel: 'Not yet',
    });
    if (!ok) return;
    setBusy(true);
    setOverrideError(null);
    setPublishError(null);
    try {
      const out = await api.publishAnyway(paperId, overrideReason.trim(), note, leftOutCount > 0 ? confirmedLeftOut : undefined);
      toast.success('Paper published. Your reason is saved in its history.');
      setNote('');
      setOverrideReason('');
      setPublished({ liveId: out.live_bank_paper_id, questions: out.question_count, anyway: out.overridden.length > 0 });
      refresh();
    } catch (err) {
      // Not switched on yet is said plainly, and nothing was changed; any other refusal is the server's own sentence.
      setOverrideError(overrideErrorWords(err));
      refresh();
    } finally {
      setBusy(false);
    }
  }

  const editable = !paper.is_live && (waiting || paper.approval_state === null);

  return (
    <UnsavedContext.Provider value={registry}>
      <div ref={topRef} className="scroll-mt-24">
        {backLink}
        <div className="mb-4 rounded-[18px] bg-muted shadow-card p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-balance text-[18px] font-bold text-foreground">{paper.title}</h2>
                <PaperStatusPill stage={stageOfReady(paper)} />
              </div>
              <p className="mt-0.5 text-[13px] text-warm-secondary">
                {[header.school, header.cls ? `Class ${header.cls}` : null, header.subject, header.board, header.year].filter(Boolean).join(' · ')}
              </p>
            </div>
            {pass ? (
              <p className="rounded-full bg-mint px-3 py-1 text-[12px] font-bold text-foreground" data-testid="checks-summary">
                {checksSummary(data.checks)}
              </p>
            ) : (
              <button
                type="button"
                onClick={() => void go('checks')}
                className="inline-flex min-h-11 items-center rounded-full bg-destructive/10 px-3 text-[12px] font-bold text-destructive underline decoration-dotted underline-offset-2 hover:bg-destructive/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus md:min-h-9"
                data-testid="checks-summary"
              >
                {checksSummary(data.checks)}
              </button>
            )}
          </div>
          <RouteTrail stage="ready" className="mt-3" />
          <PaperTimelineDisclosure
            className="mt-3"
            queryKey={['hod', scope, 'timeline', paper.audit_paper_id]}
            load={() => api.paperTimeline(paper.audit_paper_id)}
            fallback={{ ...EMPTY_MOMENTS, finished_at: paper.queued_at }}
            stage={stageOfReady(paper)}
          />
          <div className="mt-3">
            <CheckChips checks={data.checks} onPick={goToFix} />
          </div>
          {leftOut ? (
            <p className="mt-3 text-[14px] font-semibold text-foreground" data-testid="left-out-banner">
              {leftOut}
            </p>
          ) : null}
          {waiting && !alreadyLive ? (
            <div className="mt-3 flex flex-wrap items-center gap-2" data-testid="preview-send-back">
              <SendBackToChecking
                api={api}
                scope={scope}
                paperId={paper.audit_paper_id}
                title={paper.title}
                passedCount={data.counts.passed}
                onDone={() => navigate(deskLink('ready'))}
              />
            </div>
          ) : null}
        </div>

        {pictureWork || picturesRed ? (
          <div role="status" className="mb-4 flex flex-wrap items-center gap-3 rounded-[14px] bg-muted p-3 text-[14px] text-foreground" data-testid="picture-work">
            <p className="min-w-0 flex-1">
              {pictureWork === 'running'
                ? 'Getting the pictures ready for the site...'
                : pictureWork === 'failed'
                  ? STAGE_FAILED_WORDS
                  : pictureWork === 'unavailable'
                    ? 'Pictures cannot be copied to the site yet. Tell the owner.'
                    : pictureIds.length === 1
                      ? '1 picture is not on the site yet.'
                      : pictureIds.length > 1
                        ? `${pictureIds.length} pictures are not on the site yet.`
                        : picturesCheck?.detail || 'A picture is not on the site yet.'}
            </p>
            {pictureIds.length > 0 ? (
              <button type="button" className={quietButton} onClick={() => void showMarked('pictures')}>
                Show me
              </button>
            ) : null}
            {pictureWork !== 'running' ? (
              <button type="button" className={quietButton} onClick={retryPictures}>
                Try again
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="sticky top-20 z-30 -mx-1 mb-4 lg:top-24 bg-background/95 px-1 py-2 backdrop-blur" data-testid="step-bar">
          <ol className="flex gap-1 rounded-full bg-muted p-1 shadow-card sm:inline-flex" aria-label="Steps to go live">
            {STEPS.map((s, i) => (
              <li key={s.key} className="min-w-0 flex-1 sm:flex-none">
                <button
                  type="button"
                  id={`${stepRefs}-${s.key}`}
                  aria-current={step === s.key ? 'step' : undefined}
                  onClick={() => void go(s.key)}
                  onKeyDown={onStepKey}
                  className={cn(
                    'flex h-11 w-full items-center justify-center gap-1 rounded-full px-2 text-[12px] font-bold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus sm:px-3.5 sm:text-[13px] md:h-10',
                    step === s.key ? 'bg-card text-foreground' : 'text-warm-secondary hover:text-foreground',
                  )}
                >
                  <span className="tabular-nums">{i + 1}.</span>
                  <span className="sm:hidden">{s.short}</span>
                  <span className="hidden sm:inline">{s.label}</span>
                </button>
              </li>
            ))}
          </ol>
          {jump && step === 'paper' ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-[14px] bg-brand-subtle p-2 text-[13px] text-foreground" role="status" data-testid="jump-bar">
              <p className="min-w-0 flex-1 font-semibold">
                {jumpIds.length === 0 ? `No ${MARK_WORDS[jump.kind].one} left. All done here.` : `${jumpIndex + 1} of ${jumpIds.length}: ${MARK_WORDS[jump.kind].one}`}
              </p>
              {jumpIds.length > 1 ? (
                <button
                  type="button"
                  className={cn(quietButton, 'h-11 md:h-10')}
                  onClick={() => setJump({ kind: jump.kind, index: (jumpIndex + 1) % jumpIds.length })}
                  data-testid="jump-next"
                >
                  Next marked
                </button>
              ) : null}
              <button type="button" className={cn(quietButton, 'h-11 md:h-10')} onClick={() => void go('checks')}>
                Back to the checks
              </button>
              <button type="button" className={cn(quietButton, 'h-11 md:h-10')} onClick={() => setJump(null)} aria-label="Stop showing the marked questions">
                Done
              </button>
            </div>
          ) : null}
        </div>

        <section aria-label={STEPS[stepIndex].label} data-testid={`step-${step}`}>
          {step === 'paper' ? (
            <>
              <p className="mb-3 text-[13px] text-warm-secondary">Read the paper the way a visitor will. It is drawn the same way as the live page, with pictures and tables.</p>
              <PaperSheet preview={data} api={api} editable={editable} onChanged={refresh} pictureWork={pictureWork} currentId={currentId} />
            </>
          ) : null}

          {step === 'checks' ? (
            <>
              <p className="mb-3 text-[13px] text-warm-secondary">All four must be green before the paper can go live.</p>
              <CheckList preview={data} go={(s) => void go(s)} paperId={paperId} showMarked={(k) => void showMarked(k)} retryPictures={retryPictures} />
              <button type="button" className={cn(quietButton, 'mt-3')} onClick={() => void q.refetch().then(() => toast.message('Checked just now. The list above is up to date.'))}>
                Check again
              </button>
            </>
          ) : null}

          {step === 'details' ? (
            <>
              <p className="mb-3 text-[13px] text-warm-secondary">
                Make sure the paper sits in the right class, subject and board. Change any boxes, then press Save all changes. Leave an optional box empty to
                clear it. Compare with the printed paper as you type.
              </p>
              <div className="grid gap-4 lg:grid-cols-2 lg:items-start" data-testid="details-side-by-side">
                <section
                  aria-label="The printed paper"
                  className="min-w-0 max-lg:sticky max-lg:top-[148px] max-lg:z-20 max-lg:rounded-[18px] max-lg:bg-background max-lg:p-2 max-lg:shadow-card lg:sticky lg:top-[164px]"
                  data-testid="details-printed"
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h3 className="text-[14px] font-bold text-foreground">The printed paper</h3>
                    <button
                      type="button"
                      className={cn(quietButton, 'h-11 lg:hidden')}
                      aria-expanded={photoOpen}
                      onClick={() => setPhotoOpen((v) => !v)}
                      data-testid="photo-toggle"
                    >
                      {photoOpen ? 'Hide the photo' : 'Show the photo'}
                    </button>
                  </div>
                  <div className={photoOpen ? undefined : 'max-lg:hidden'}>
                    <PaperPageFlip paperId={paperId} loadPages={api.paperPages} pictureUrl={api.pictureUrl} title="Page by page, as printed" />
                  </div>
                </section>
                <div className="min-w-0">
                  {mismatch ? (
                    <p role="note" className="mb-3 rounded-2xl bg-brand-subtle px-4 py-3 text-[14px] text-foreground">
                      {mismatch}
                    </p>
                  ) : null}
                  <HeaderEditor
                    mode="all"
                    fields={PUBLISH_FIELDS}
                    values={values}
                    save={(field, value) => api.updatePublishMeta(paperId, field, value)}
                    onSaved={refresh}
                  />
                  <section aria-label="The computer's version" className="mt-5 min-w-0" data-testid="details-computer-version">
                    <h3 className="mb-2 text-[14px] font-bold text-foreground">The computer's version</h3>
                    <div className="lg:max-h-[70vh] lg:overflow-y-auto lg:rounded-2xl lg:bg-muted lg:p-2 lg:shadow-card">
                      <PaperSheet preview={data} api={api} editable={editable} onChanged={refresh} pictureWork={pictureWork} editInstructions={false} />
                    </div>
                  </section>
                </div>
              </div>
            </>
          ) : null}

          {step === 'publish' ? (
            <>
              <div className="rounded-[18px] bg-muted shadow-card p-4">
                <p className="text-[15px] font-bold text-foreground">{paper.title}</p>
                <ul className="mt-2 space-y-1 text-[14px] text-foreground">
                  <li>
                    {data.counts.passed} of {data.counts.total} questions are passed and will go live.
                  </li>
                  {leftOut ? <li className="font-semibold text-foreground">{leftOut}. They will not go live.</li> : null}
                  <li>
                    {[header.cls ? `Class ${header.cls}` : 'No class', header.subject ?? 'no subject', header.board ?? 'no board', header.year ?? 'no year'].join(', ')}.
                  </li>
                </ul>
              </div>

              {notOnList ? (
                <div className="mt-3 rounded-[18px] bg-brand-subtle p-4" data-testid="not-on-list">
                  <p className="text-[14px] font-bold text-foreground">This paper has not been put on the Ready to go live list yet.</p>
                  <p className="mt-1 text-[14px] text-foreground">
                    It can only be published from that list. Put it there when every question is settled and its pictures are in place.
                  </p>
                  <button type="button" className={cn(actionToneClass('dark'), 'mt-3 min-w-[160px]')} disabled={queueBusy} onClick={() => void putOnList()} data-testid="put-on-list">
                    {queueBusy ? 'Putting it on the list...' : 'Put this paper on the Ready list'}
                  </button>
                  {queueError ? (
                    <p role="alert" className="mt-2 text-[13px] font-semibold text-destructive" data-testid="queue-error">
                      {queueError}
                    </p>
                  ) : null}
                </div>
              ) : !waiting ? (
                <div className="mt-3">
                  <Notice tone="warn">This paper is not waiting to go live, so it cannot be published from here.</Notice>
                </div>
              ) : null}

              {!pass ? (
                <div className="mt-3 rounded-[18px] bg-destructive/10 p-4" data-testid="publish-blocked">
                  <p className="text-[14px] font-bold text-foreground">Not yet. Fix {failed.length === 1 ? 'this' : 'these'} first:</p>
                  <ul className="mt-2 space-y-2 text-[14px] text-foreground">
                    {failed.map((c) => (
                      <li key={c.key} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="min-w-0 flex-1">
                          {c.label}
                          {c.detail ? `: ${c.detail}` : ''}
                        </span>
                        <button
                          type="button"
                          className="inline-flex min-h-11 items-center rounded-full px-2 text-[13px] font-bold text-brand-blue underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-10"
                          onClick={() => goToFix(c.key)}
                        >
                          Fix this
                        </button>
                      </li>
                    ))}
                  </ul>
                  <button type="button" className={cn(actionToneClass('dark'), 'mt-3')} onClick={() => void go('checks')}>
                    Go to the checks
                  </button>
                </div>
              ) : null}

              {leftOutCount > 0 ? (
                <label className="mt-3 flex items-start gap-3 rounded-2xl bg-brand-subtle p-4 text-[14px] font-semibold text-foreground" data-testid="left-out-confirm">
                  <input
                    type="checkbox"
                    checked={confirmedLeftOut}
                    disabled={busy}
                    onChange={(ev) => setConfirmedLeftOut(ev.target.checked)}
                    className="mt-0.5 h-5 w-5 shrink-0 accent-[hsl(var(--brand))]"
                  />
                  <span>{leftOutConfirmText(leftOutCount)}</span>
                </label>
              ) : null}

              {offerOverride ? (
                <PublishAnywayBox
                  ticked={overrideTicked}
                  reason={overrideReason}
                  error={overrideError}
                  busy={busy}
                  canOverride={canOverride}
                  whyOff={overrideWhyOff({ ticked: overrideTicked, reason: overrideReason, leftOut: leftOutCount, confirmedLeftOut })}
                  onTick={setOverrideTicked}
                  onReason={setOverrideReason}
                  onPublish={() => void publishAnyway()}
                />
              ) : null}

              <label className="mt-4 flex flex-col gap-1 text-[13px] font-semibold text-foreground">
                A note for the history (optional)
                <textarea
                  value={note}
                  onChange={(ev) => setNote(ev.target.value)}
                  rows={2}
                  maxLength={500}
                  disabled={busy}
                  className="w-full rounded-xl bg-muted p-3 text-[16px] font-normal outline-none focus-visible:ring-2 focus-visible:ring-focus"
                />
              </label>

              {publishError ? (
                <p role="alert" className="mt-3 rounded-2xl bg-destructive/10 px-4 py-3 text-[14px] text-destructive" data-testid="publish-error">
                  {publishError}
                </p>
              ) : null}

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className={cn(actionToneClass('dark'), 'min-w-[160px]')}
                  disabled={!canPublish}
                  aria-describedby={!canPublish ? 'publish-why' : undefined}
                  onClick={() => void publish()}
                >
                  {busy ? 'Publishing...' : alreadyLive ? 'Record the approval' : 'Publish'}
                </button>
                {!canPublish ? (
                  <p id="publish-why" className="text-[13px] text-warm-secondary">
                    {notOnList
                      ? 'Put the paper on the Ready to go live list first (the box above).'
                      : !waiting
                      ? 'This paper is not waiting to go live. See the note at the top of this page.'
                      : !pass
                        ? 'Publish switches on when all four checks are green.'
                        : 'Tick the box above to say you know about the questions left out.'}
                  </p>
                ) : null}
              </div>
            </>
          ) : null}
        </section>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-warm-hairline pt-4">
          <button type="button" className={quietButton} disabled={stepIndex === 0} onClick={() => void go(STEPS[Math.max(0, stepIndex - 1)].key)}>
            Back
          </button>
          <p className="text-[12px] tabular-nums text-warm-meta">
            Step {stepIndex + 1} of {STEPS.length}
          </p>
          {stepIndex < STEPS.length - 1 ? (
            <button type="button" className={cn(actionToneClass('brand'), 'h-[46.5px]')} onClick={() => void go(STEPS[stepIndex + 1].key)}>
              {STEPS[stepIndex + 1].key === 'publish' ? 'On to publishing' : 'Next'}
            </button>
          ) : (
            <span aria-hidden className="w-px" />
          )}
        </div>
        {confirmDialog}
      </div>
    </UnsavedContext.Provider>
  );
}
