import { refreshHod } from '@/lib/hod-refresh';
import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { Check, X } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { HeaderEditor } from '@/components/hod/HeaderEditor';
import { BackLink, ListSkeleton, LoadError, Notice, deskLink, quietButton } from '@/components/hod/HodShared';
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
  OVERRIDE_MAX_REASON,
  OVERRIDE_REASON_LABEL,
  OVERRIDE_TICK_TEXT,
  PUBLISH_FIELDS,
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
  marksMismatch,
  overrideErrorWords,
  overrideOffered,
  overrideProblemsText,
  overrideWhyOff,
  type HodPreview,
  type PublishField,
} from '@/lib/hod-publish';
import { cn } from '@/lib/utils';

/* The preview flow for one paper that is ready to go live. Four steps, each a
   plain page you can come back to:
     1. The paper: read it as a printed sheet, with pictures and tables.
     2. Checks: the four checks as a green or red list, each with its own words
        and a way to fix it.
     3. Details: class, subject, board, year, school, exam, marks, time and the
        instructions; each field saves on its own and says Saved.
     4. Publish: enabled only when all four checks pass. When the server refuses
        it, its own sentence is shown as written.
   When a check fails, "Publish anyway" sits under the red list (owner, 14 Nov 2026:
   "allow me to ignore and pass as an override"): tick a box, type why (10 characters
   or more), and the reason and the checks skipped are saved in the paper's history.
   It is a separate, deliberate button; the normal Publish never skips a check. */

export const PREVIEW_KEY = (scope: string, paperId: string) => ['hod', scope, 'preview', paperId] as const;

const STEPS = [
  { key: 'paper', label: 'The paper' },
  { key: 'checks', label: 'Checks' },
  { key: 'details', label: 'Details' },
  { key: 'publish', label: 'Publish' },
] as const;

type StepKey = (typeof STEPS)[number]['key'];

function CheckList({ preview, go, paperId }: { preview: HodPreview; go: (s: StepKey) => void; paperId: string }) {
  const junk = preview.questions.filter((q) => q.scanner_junk && q.state !== 'set_aside');
  return (
    <ul className="space-y-2" data-testid="check-list">
      {preview.checks.map((c) => (
        <li
          key={c.key}
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
                      {preview.counts.open > 0 ? (
                        <Link to={deskLink('needs-you', paperId)} className={cn(actionToneClass('brand'), 'h-[46.5px]')}>
                          Go to Needs you
                        </Link>
                      ) : null}
                    </>
                  ) : null}
                  {c.key === 'header_complete' ? (
                    <button type="button" className={actionToneClass('dark')} onClick={() => go('details')}>
                      Fill in the details
                    </button>
                  ) : null}
                  {c.key === 'scanner_junk_gone' ? (
                    <button type="button" className={actionToneClass('dark')} onClick={() => go('paper')}>
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
      ))}
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
    <div className="mt-3 rounded-[18px] bg-muted shadow-card p-4" data-testid="publish-anyway">
      <p className="text-[14px] font-bold text-foreground">Or publish anyway</p>
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
            className="w-full rounded-xl bg-card p-3 text-[16px] font-normal outline-none focus-visible:ring-2 focus-visible:ring-focus"
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
          className={cn(actionToneClass('dark'), 'min-w-[160px]')}
          disabled={!canOverride}
          aria-describedby="publish-anyway-help"
          onClick={onPublish}
        >
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
  const { confirm, confirmDialog } = useConfirm();
  const [step, setStep] = useState<StepKey>('paper');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmedLeftOut, setConfirmedLeftOut] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [published, setPublished] = useState<{ liveId: string | null; questions: number; anyway?: boolean } | null>(null);
  const [overrideTicked, setOverrideTicked] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [overrideError, setOverrideError] = useState<string | null>(null);
  const stepRefs = useId();

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

  const onStepKey = (ev: KeyboardEvent<HTMLButtonElement>) => {
    const i = STEPS.findIndex((s) => s.key === step);
    if (ev.key === 'ArrowRight') setStep(STEPS[(i + 1) % STEPS.length].key);
    else if (ev.key === 'ArrowLeft') setStep(STEPS[(i - 1 + STEPS.length) % STEPS.length].key);
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
            {published.questions > 0 ? `${published.questions} ${published.questions === 1 ? 'question' : 'questions'} are live.` : 'The paper is live.'} Public pages and the
            sitemap pick it up after the next site update.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {published.liveId ? (
              <Link to={`/past-papers/${encodeURIComponent(published.liveId)}`} className={actionToneClass('dark')} data-testid="live-link">
                Open the live paper
              </Link>
            ) : null}
            <Link to={deskLink('ready')} className={cn(actionToneClass('brand'), 'h-[46.5px]')}>
              Back to Ready to go live
            </Link>
            <Link to={deskLink('live')} className={quietButton}>
              See Live papers
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (q.isLoading) return <ListSkeleton rows={4} label="Loading the paper" />;
  if (q.isError || !data) {
    return (
      <div>
        <BackLink to={deskLink('ready')}>Back to Ready to go live</BackLink>
        <LoadError what="This paper" onRetry={() => void q.refetch()} />
        {q.error ? (
          <p className="mt-2 text-[13px] text-warm-secondary" data-testid="preview-error">
            {errorWords(q.error, '')}
          </p>
        ) : null}
      </div>
    );
  }

  const { paper } = data;
  const header = paper.header;
  const waiting = paper.approval_state === 'awaiting' || paper.approval_state === null;
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

  async function publish() {
    if (!canPublish) return;
    const ok = await confirm({
      title: alreadyLive ? 'Record the approval for this paper?' : 'Put this paper on the site?',
      description: alreadyLive
        ? 'The paper is already live. This only records your yes.'
        : `${data.counts.passed} ${data.counts.passed === 1 ? 'question goes' : 'questions go'} live for visitors. You can hide the paper afterwards from Live papers.`,
      confirmLabel: alreadyLive ? 'Record it' : 'Publish',
      cancelLabel: 'Not yet',
    });
    if (!ok) return;
    setBusy(true);
    setPublishError(null);
    try {
      const out = await api.approvePaper(paperId, note, leftOutCount > 0 ? confirmedLeftOut : undefined);
      toast.success('Paper published.');
      setPublished({ liveId: out.live_bank_paper_id, questions: out.question_count });
      refresh();
    } catch (err) {
      // The server's sentence, as written: it names every check that failed.
      setPublishError(`Not published. The paper is still waiting for you. ${errorWords(err)}`);
      refresh();
    } finally {
      setBusy(false);
    }
  }

  async function publishAnyway() {
    if (!canOverride) return;
    const ok = await confirm({
      title: 'Publish this paper with a problem?',
      description: `${overrideProblemsText(failed)} ${data.counts.passed} ${data.counts.passed === 1 ? 'question goes' : 'questions go'} live for visitors. Your reason is saved in the paper's history with your name. You can hide the paper afterwards from Live papers.`,
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

  return (
    <div>
      <BackLink to={deskLink('ready')}>Back to Ready to go live</BackLink>
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
          <p
            className={cn('rounded-full px-3 py-1 text-[12px] font-bold', pass ? 'bg-mint text-foreground' : 'bg-destructive/10 text-destructive')}
            data-testid="checks-summary"
          >
            {checksSummary(data.checks)}
          </p>
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
          <CheckChips checks={data.checks} />
        </div>
        {leftOut ? (
          <p className="mt-3 text-[14px] font-semibold text-foreground" data-testid="left-out-banner">
            {leftOut}
          </p>
        ) : null}
      </div>

      {pictureWork ? (
        <div role="status" className="mb-4 flex flex-wrap items-center gap-3 rounded-[14px] bg-muted p-3 text-[14px] text-foreground" data-testid="picture-work">
          <p className="min-w-0 flex-1">
            {pictureWork === 'running'
              ? 'Getting the pictures ready for the site...'
              : pictureWork === 'failed'
                ? STAGE_FAILED_WORDS
                : 'Copying pictures to the site is not switched on yet. The owner needs to paste the picture file in the database editor.'}
          </p>
          {pictureWork !== 'running' ? (
            <button type="button" className={quietButton} onClick={() => setPictureTry((n) => n + 1)}>
              Try again
            </button>
          ) : null}
        </div>
      ) : null}

      <ol className="mb-4 flex flex-wrap gap-1 rounded-[20px] bg-muted shadow-card p-1 sm:inline-flex sm:rounded-full" aria-label="Steps to go live">
        {STEPS.map((s, i) => (
          <li key={s.key}>
            <button
              type="button"
              id={`${stepRefs}-${s.key}`}
              aria-current={step === s.key ? 'step' : undefined}
              onClick={() => setStep(s.key)}
              onKeyDown={onStepKey}
              className={cn(
                'flex h-11 md:h-10 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-bold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
                step === s.key ? 'bg-card text-foreground' : 'text-warm-secondary hover:text-foreground',
              )}
            >
              <span className="tabular-nums">{i + 1}.</span> {s.label}
            </button>
          </li>
        ))}
      </ol>

      <section aria-label={STEPS[stepIndex].label} data-testid={`step-${step}`}>
        {step === 'paper' ? (
          <>
            <p className="mb-3 text-[13px] text-warm-secondary">Read the paper the way a visitor will. Pictures and tables show as they will on the site.</p>
            <PaperSheet preview={data} api={api} editable={!paper.is_live && waiting} onChanged={refresh} pictureWork={pictureWork} />
          </>
        ) : null}

        {step === 'checks' ? (
          <>
            <p className="mb-3 text-[13px] text-warm-secondary">All four must be green before the paper can go live.</p>
            <CheckList preview={data} go={setStep} paperId={paperId} />
            <button type="button" className={cn(quietButton, 'mt-3')} onClick={() => void q.refetch().then(() => toast.message('Checked just now. The list above is up to date.'))}>
              Check again
            </button>
          </>
        ) : null}

        {step === 'details' ? (
          <>
            <p className="mb-3 text-[13px] text-warm-secondary">
              Make sure the paper sits in the right class, subject and board. Each box saves on its own. Leave an optional box empty to clear it.
              The printed paper is on one side and the computer's version on the other, so you can compare as you type.
            </p>
            <div className="grid gap-4 lg:grid-cols-2 lg:items-start" data-testid="details-side-by-side">
              <section aria-label="The printed paper" className="min-w-0 lg:sticky lg:top-4" data-testid="details-printed">
                <h3 className="mb-2 text-[14px] font-bold text-foreground">The printed paper</h3>
                <PaperPageFlip paperId={paperId} loadPages={api.paperPages} pictureUrl={api.pictureUrl} title="Page by page, as printed" />
              </section>
              <div className="min-w-0">
                {mismatch ? (
                  <p role="note" className="mb-3 rounded-2xl bg-brand-subtle px-4 py-3 text-[14px] text-foreground">
                    {mismatch}
                  </p>
                ) : null}
                <HeaderEditor
                  fields={PUBLISH_FIELDS}
                  values={values}
                  save={(field, value) => api.updatePublishMeta(paperId, field, value)}
                  onSaved={refresh}
                />
                <section aria-label="The computer's version" className="mt-5 min-w-0" data-testid="details-computer-version">
                  <h3 className="mb-2 text-[14px] font-bold text-foreground">The computer's version</h3>
                  <div className="max-h-[70vh] overflow-y-auto rounded-2xl bg-muted shadow-card p-2">
                    <PaperSheet preview={data} api={api} editable={!paper.is_live && waiting} onChanged={refresh} pictureWork={pictureWork} />
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

            {!waiting ? (
              <div className="mt-3">
                <Notice tone="warn">This paper is not waiting to go live, so it cannot be published from here.</Notice>
              </div>
            ) : null}

            {!pass ? (
              <div className="mt-3 rounded-[18px] bg-destructive/10 p-4" data-testid="publish-blocked">
                <p className="text-[14px] font-bold text-foreground">Not yet. Fix {failed.length === 1 ? 'this' : 'these'} first:</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[14px] text-foreground">
                  {failed.map((c) => (
                    <li key={c.key}>
                      {c.label}
                      {c.detail ? `: ${c.detail}` : ''}
                    </li>
                  ))}
                </ul>
                <button type="button" className={cn(actionToneClass('dark'), 'mt-3')} onClick={() => setStep('checks')}>
                  Go to the checks
                </button>
              </div>
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
                  {!waiting ? 'This paper is not waiting to go live. See the note at the top of this page.' : !pass ? 'Publish switches on when all four checks are green.' : 'Tick the box above to say you know about the questions left out.'}
                </p>
              ) : null}
            </div>
          </>
        ) : null}
      </section>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-warm-hairline pt-4">
        <button
          type="button"
          className={quietButton}
          disabled={stepIndex === 0}
          onClick={() => setStep(STEPS[Math.max(0, stepIndex - 1)].key)}
        >
          Back
        </button>
        <p className="text-[12px] tabular-nums text-warm-meta">
          Step {stepIndex + 1} of {STEPS.length}
        </p>
        <button
          type="button"
          className={cn(actionToneClass('brand'), 'h-[46.5px]')}
          disabled={stepIndex === STEPS.length - 1}
          onClick={() => setStep(STEPS[Math.min(STEPS.length - 1, stepIndex + 1)].key)}
        >
          {STEPS[Math.min(STEPS.length - 1, stepIndex + 1)].label === 'Publish' ? 'On to publishing' : 'Next'}
        </button>
      </div>
      {confirmDialog}
    </div>
  );
}

