import { useOnline } from '@/hooks/useOnline';
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { MathText } from '@/components/papers/math-text';
import { OptionList } from '@/components/checker/OptionList';
import { PartCard } from '@/components/checker/PartCard';
import { FIX_RULE_LINE, RulesInfo, ShortcutsPopover } from '@/components/checker/CheckerPopovers';
import { PaperPageFlip } from '@/components/checker/PaperPageFlip';
import { AiSurePill, PanelTabs, PrintedFrame, TypedFrame, VERIFY_TABS, type PanelId } from '@/components/checker/Panels';
import { tileForNextQuestion } from '@/lib/checker-bento';
import { BentoTile, FadeScroll, ImageLightbox, TilePager, useBentoWide } from '@/components/checker/BentoParts';
import { ChangesChip, ChangesPanel, MarksInsideHint, QuestionChips, ToolsToolbar } from '@/components/checker/TypedBits';
import { toolBlockedByUnsavedEdit, toolById, type CheckerToolId } from '@/lib/checker-tools';
import { CheckerSkeleton, Callout, CheckGuidance, ContextPart, Modal, SplitPreview, useSignedUrl, useSignedUrls } from '@/components/checker/CheckerBits';
import { PartPictures } from '@/components/checker/PartPictures';
import { ArrowLeft, Check, CircleHelp, Maximize2, Pencil, SkipForward, Undo2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CheckerApi, CheckerQuestion } from '@/lib/checker-api';
import { whatToCheck } from '@/lib/checker-kid-reasons';
import { englishContext, passageHeading } from '@/lib/checker-english';
import { assembleQuestionContext, wholeQuestionRows, type QuestionContext } from '@/lib/checker-context';
import { focusedPartId, planCheckerPicture, planPartPictures, pictureHeading, PICTURE_MAY_MISS_PARTS, type PartPicture, type PicturePlan } from '@/lib/checker-pictures';
import { planVerifiedPage, PAGE_HEADING, type PagePlan } from '@/lib/checker-page';
import { describeLanes, unmappedCodes } from '@/lib/checker-lanes';
import { lostTextSuggestion, LOST_TEXT_CONFIRM, LOST_TEXT_HEADING, LOST_TEXT_NOTE, LOST_TEXT_TITLE } from '@/lib/checker-lost-text';
import {
  typoSaveProblem,
  TYPO_CHECKBOX_LABEL,
  TYPO_RULE_TITLE,
  TYPO_NOTE_LABEL,
  TYPO_NOTE_MAX,
} from '@/lib/checker-save';
import { DebugFacts } from '@/components/admin/DebugFacts';
import { PageImageViewer } from '@/components/checker/PageImageViewer';
import { matchCheckerKeyboardEvent } from '@/lib/checker-shortcuts';
import {
  isBlankBody,
  isOrOnlyBody,
  OR_ONLY_BUTTON,
  OR_ONLY_DONE,
  OR_ONLY_NOTE,
  OR_ONLY_TITLE,
  looksGarbled,
  codePointOffset,
  splitHalves,
  canSplitAt,
  bigEdit,
  moveMarksOut,
  BIG_EDIT_WARNING,
} from '@/lib/checker-body';
import { checkerErrorAdvice, nextLoadProblem, reopenErrorMessage, undoErrorMessage, UNDONE_NOTE, LOAD_FAILED_TITLE, LOAD_FAILED_NOTE, PAPER_GONE_TITLE, PAPER_GONE_NOTE } from '@/lib/checker-errors';
import { normaliseOptions } from '@/lib/checker-options';
import {
  clearDraft,
  draftOwnerKey,
  draftsFromQuestion,
  isEdited,
  loadDraft,
  planAnswer,
  sameDrafts,
  saveDraft,
} from '@/lib/checker-drafts';
import { usePaperReviewChannel, useLiveRefresh } from '@/hooks/usePaperReviewChannel';
import { isForeignChangeToOpenQuestion } from '@/lib/paper-review-realtime';
import { DebugId } from '@/components/DebugId';
import { ActionButton } from '@/components/checker/CheckerButtons';
import { ACTION_ICON_CLASS } from '@/lib/checker-button-styles';
import { CheckerWalkthrough } from '@/components/checker/CheckerWalkthrough';
import { CHECKER_PRACTICE_PATH, CHECKER_TOUR_PARAM, hasSeenWalkthrough, markWalkthroughSeen } from '@/lib/checker-onboarding';
import { paperLabel, paperProgress } from '@/lib/checker-progress';
import { loadGate, skippedNote } from '@/lib/verifier-papers';
import { IncomingCard, PaperStrip, SaveStatusChip } from '@/components/checker/AdvanceBits';
import { useCheckerOutbox } from '@/components/checker/useCheckerOutbox';
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion';
import { cardEnterClass, cardId, isPaperChange, paperStripInfo } from '@/lib/checker-card-motion';
import { clearPrefetch, dropWarm, prefetchNext, type WarmQuestion } from '@/lib/checker-prefetch';
import { offlinePrefetchDeps } from '@/lib/checker-prefetch-fallback';
import { clearPictureCache, primePicture, withPictureCache } from '@/lib/checker-picture-cache';
import type { OutboxEntry, VerdictKind, VerdictPayload } from '@/lib/checker-outbox';
import { decideAck, isConfirmedNotSaved } from '@/lib/checker-advance';
import type { VerdictAndNext } from '@/lib/checker-verdict-next';
import '@/components/checker/checker-motion.css';

/* The verify screen ("Start verifying"): one question of one paper at a time.
   The question and its details are on the left; the picture of the printed
   page is on the right and switches with the question. Pass, Fix it, Ask the
   HOD and Skip load the next question of the same paper. When nothing is left
   it says the paper is finished and goes back to the list.

   Moved out of pages/Checker.tsx: the logic, the picture rules (a doubtful crop
   is never shown, an unverified page is never shown, no picture at all falls
   back to the whole paper) and the keyboard shortcuts are unchanged. */

type Mode = 'check' | 'fix' | 'split';

const HELP_REASONS = [
  'I cannot read the words',
  'The words are scrambled',
  'There is no question here',
  'The picture is of a different question',
];

export function VerifyScreen({
  api,
  scope,
  dummy,
  paperId,
  userId,
  userName,
  onExit,
  onList,
  toolbar,
  reopenQuestionId,
}: {
  api: CheckerApi;
  scope: string;
  dummy: boolean;
  paperId: string;
  userId?: string;
  userName?: string | null;
  /** Back to the paper's list of questions. */
  onExit: () => void;
  /** Back to the list of all my papers (the finished screen's button says so). */
  onList?: () => void;
  /** The page's own small controls (counts, Menu ...), shown in the top tile so the page needs no header row of its own. */
  toolbar?: ReactNode;
  /** A question the verifier already marked Done and chose to Edit from the paper's list. It is reopened (verifier_reopen_question)
   *  and shown first, instead of the next question in line. Used once, on the first load. */
  reopenQuestionId?: string;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const labelRef = useRef('this paper');

  /* Speed (checker speed plan, 12 Oct 2026): the next question appears the
     moment a verdict is pressed, not after the save comes back, and its WORDS
     arrive with the save's own answer.

       1. The verdict is written to the outbox (src/lib/checker-outbox.ts,
          localStorage) and sent in the background, in order, with retries.
          It is never lost and never sent twice.
       2. ONE call does both jobs: verifier_verdict_and_next saves the verdict
          and returns the next question of the paper, already leased to this
          checker, with its context (checker-verdict-next.ts). There is no
          separate "next question" fetch after a verdict. The answer reaches
          `ackedVerdict`, which asks decideAck (checker-advance.ts) what to do:
          show it, show "paper finished", or ignore it when the person has
          moved on. A refused verdict serves nothing: the question comes back
          with the reason.
       3. The pictures of the questions after this one are signed and decoded
          ahead through verifier_peek_next_in_paper, which leases nothing
          (checker-prefetch.ts), and the picture of a question that has just
          arrived starts signing before it is shown (checker-picture-cache.ts).
       4. Until the answer is back, the card is the next question's frame with
          its picture and placeholders; the answered question is hidden at
          once (`maskedIds`), so a second press can only land on a card that
          is ready.

     The words of a question are only ever the ones the server returned:
     nothing is guessed or carried over. */
  // Skipped questions wait for later: they are served only after the
  // verifier asks to go through them (20261008160000).
  const [includeSkipped, setIncludeSkipped] = useState(false);
  const includeSkippedRef = useRef(false);
  includeSkippedRef.current = includeSkipped;
  const nextKey = ['verifier-next', scope, paperId, includeSkipped] as const;
  const keyFor = (inc: boolean) => ['verifier-next', scope, paperId, inc] as const;
  const picApi = useMemo(() => withPictureCache(api), [api]);
  const reducedMotion = usePrefersReducedMotion();
  // Tablet and up: every tile on one screen. Below 768: swipeable tiles (Question | Page | Fix).
  const wide = useBentoWide();
  // A picture opened full screen.
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);

  /** Questions the checker has answered whose card must not come back: the
   *  fetch that follows an answer may still hold the old row for a moment. */
  const [maskedIds, setMaskedIds] = useState<ReadonlySet<string>>(() => new Set());
  const maskedRef = useRef<ReadonlySet<string>>(maskedIds);
  const mask = (id: string) => {
    const next = new Set(maskedRef.current).add(id);
    maskedRef.current = next;
    setMaskedIds(next);
  };
  const unmask = (id: string) => {
    if (!maskedRef.current.has(id)) return;
    const next = new Set(maskedRef.current);
    next.delete(id);
    maskedRef.current = next;
    setMaskedIds(next);
  };
  // True from a verdict until the next question (or the end of the paper) is on screen.
  const [advancing, setAdvancing] = useState(false);
  const [nextFailed, setNextFailed] = useState(false);
  // The next question's picture, when it was warmed ahead, shown on its card while the words arrive.
  const [incoming, setIncoming] = useState<{ id: string; pictureUrl: string | null } | null>(null);
  const warmedRef = useRef<WarmQuestion[]>([]);
  const fetchSeq = useRef(0);
  const appliedSeq = useRef(0);
  const questionRef = useRef<CheckerQuestion | null>(null);

  const { box, state: outboxState } = useCheckerOutbox(api, scope, userId, {
    onAck: (entry, result) => ackedVerdict(entry, result),
    onReject: (entry, err) => rejectedVerdict(entry, err),
  });
  const pendingIds = useMemo(() => new Set(outboxState.entries.map((e) => e.questionId)), [outboxState]);
  // Verdicts of THIS paper still on their way (another paper's do not hold this screen).
  const pendingHere = outboxState.entries.filter((e) => e.paperId === paperId).length;

  // "Edit" on a Done question: the first load reopens it instead of asking for the next one. Taken once, so a
  // refresh or a later fetch goes back to the normal order (the reopened question is leased to me and comes first anyway).
  const reopenOnce = useRef<string | null>(reopenQuestionId ?? null);
  async function fetchFirstRow(inc: boolean): Promise<CheckerQuestion | null> {
    const id = reopenOnce.current;
    reopenOnce.current = null;
    if (id) {
      try {
        const row = await api.reopenQuestion(id);
        primePicture(api, row);
        // It is no longer Done: the paper's progress and its list must say so.
        qc.invalidateQueries({ queryKey: ['verifier-papers', scope] });
        qc.invalidateQueries({ queryKey: ['verifier-paper-questions', scope, paperId] });
        setNotice({ text: 'Question reopened. Change what is wrong, or press Looks right to save it again.', tone: 'ok' });
        return row;
      } catch (err) {
        setNotice({ text: reopenErrorMessage(err), tone: 'warn' });
      }
    }
    return fetchNextRow(inc);
  }

  const questionQuery = useQuery({
    queryKey: nextKey,
    queryFn: () => fetchFirstRow(includeSkipped),
    retry: 1,
    // Always ask the server: the question is leased for 10 minutes, so a cached
    // one may have been taken by the time it is shown.
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    // "Go through skipped ones" changes the key: keep the card that is up
    // (hidden or not) instead of flashing a skeleton. A paper that was
    // finished (null) has nothing to keep, so it loads as before.
    placeholderData: (prev) => prev ?? undefined,
  });
  // A failed read of the next question, told apart: a paper that closed behind us is not a sign-in problem.
  const nextProblem = nextLoadProblem(questionQuery.error, questionQuery.data);
  const nextIsError = nextProblem !== 'none';
  const rawQuestion = questionQuery.data ?? null;
  // The card that was just answered stays hidden until its replacement is here.
  const maskedRaw = rawQuestion != null && (maskedIds.has(rawQuestion.id) || pendingIds.has(rawQuestion.id));
  const question = rawQuestion && !maskedRaw ? rawQuestion : null;
  const showIncoming = !question && !questionQuery.isLoading && (maskedRaw || advancing || pendingHere > 0);

  // Where the verifier is in this paper: "3 of 12 done". The paper's row
  // is shared with the list, and the old answer stays on screen while the new
  // one loads so the bar does not flicker between questions.
  const papersQuery = useQuery({
    queryKey: ['verifier-papers', scope],
    queryFn: api.myPapers,
    staleTime: 0,
    placeholderData: keepPreviousData,
  });
  const paperRow = papersQuery.data?.find((p) => p.paper_id === paperId) ?? null;
  const paperGate = loadGate(papersQuery);
  const progress = paperRow ? paperProgress({ done_count: paperRow.done, remaining_count: paperRow.remaining, total_count: paperRow.total }) : null;
  // Skipped questions stay on the paper for later. When nothing but skipped
  // ones are left, the screen says so instead of looping them back.
  const skippedCount = paperRow?.skipped ?? 0;
  if (question) labelRef.current = paperLabel(paperRow ?? question);
  const currentPaperLabel = question ? paperLabel(paperRow ?? question) : labelRef.current;

  // How sure the computer was, as a whole percent, for the question on screen (null for most questions: no pill then).
  // A hint only: it loads after the card, is cached per question, and a failure is just "no pill".
  const sureQuery = useQuery({
    queryKey: ['checker-ai-sure', scope, question?.id ?? null],
    queryFn: () => api.questionAiSure(question!.id),
    enabled: Boolean(question),
    staleTime: 10 * 60 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const sureChip = question && sureQuery.data != null ? <AiSurePill percent={sureQuery.data} /> : null;

  // Lost text: no words, but the AI transcribed the page (checker-lost-text.ts).
  const lost = question ? lostTextSuggestion(question.body, question.flag_detail) : null;

  // W11: the whole question a sub-part belongs to (empty for a standalone
  // question, and also empty if the RPC is not deployed yet).
  const contextQuery = useQuery({
    queryKey: ['checker-question-context', scope, question?.id],
    queryFn: () => api.questionContext(question!.id),
    enabled: Boolean(question?.id),
    staleTime: 5 * 60 * 1000,
  });
  const context: QuestionContext | null = question ? assembleQuestionContext(contextQuery.data, question.id) : null;

  // The one picture of the printed paper (checker-pictures.ts). Null plan =
  // no trustworthy crop, so no signed URL is asked for. Owner, 2026-09-28:
  // never a tap-to-show button, never a doubtful crop.
  // A question with parts shows one picture per part, mirroring the typed words
  // (planPartPictures); with no crop of its own on any part it is the single picture below.
  const partRows = wholeQuestionRows(context);
  const partPictures: PartPicture[] | null = question && !contextQuery.isLoading ? planPartPictures(partRows) : null;
  const checkedPartPath = partPictures?.find((p) => p.current)?.path ?? '';
  const picturePlan: PicturePlan | null = !question || contextQuery.isLoading
    ? null
    : partPictures
      ? checkedPartPath
        ? { path: checkedPartPath, kind: 'own', doubtful: false, mayMissParts: false }
        : null
      : planCheckerPicture(question, context);
  // The view aid: which part the highlight pair (typed words left, picture right) is on. It
  // starts on the part being checked and only ever moves the view: the checked question, the
  // lease and the saved verdict are decided by `question`, never by this.
  const [focusPick, setFocusPick] = useState<{ questionId: string; partId: string } | null>(null);
  const focusId = question
    ? focusedPartId(focusPick, question.id, partRows.map((r) => r.id))
    : '';
  const focusPart = (partId: string) => {
    if (question) setFocusPick({ questionId: question.id, partId });
  };
  // The verified whole page, beside every question that has one, crop or not
  // (owner round 24, checker-page.ts). Null when the page is not verified.
  const pagePlan: PagePlan | null = question && !contextQuery.isLoading ? planVerifiedPage(question) : null;
  const viewPath = picturePlan?.path ?? '';
  const pagePath = pagePlan?.path ?? '';
  // Crop first; the whole page only after a tap (owner 2026-10-03). With no
  // crop the page is the only picture, so it is shown straight away. The page
  // image is not even requested until it is wanted.
  const [showPage, setShowPage] = useState(false);
  // The whole paper as a page-flip, behind a tap, for a question that has a crop but no verified
  // page of its own (bug tracker, 2 Nov 2026: "most papers cropped, cannot view the whole paper").
  const [showPaper, setShowPaper] = useState(false);
  const picturePlanKey = question && !contextQuery.isLoading ? `${question.id}|${viewPath}` : '';
  // undefined = still looking, null = none (or it failed to load).
  const pictureUrl = useSignedUrl(picApi, picturePlanKey, viewPath);
  const [pictureFailed, setPictureFailed] = useState<string>('');
  const cropShown = pictureUrl && pictureFailed !== picturePlanKey ? pictureUrl : pictureUrl === undefined ? undefined : null;
  // While a picture is still loading, sentences assume it will arrive when
  // one is planned.
  const hasCrop = cropShown === undefined ? viewPath !== '' : Boolean(cropShown);
  // A crop that failed to load leaves the page as the picture: show it.
  const pageOpen = pagePath !== '' && (showPage || !hasCrop);
  const pagePlanKey = question && !contextQuery.isLoading && pageOpen ? `${question.id}|${pagePath}` : '';
  // The other parts' pictures (the checked part's is `pictureUrl`, above).
  const otherPartPaths: Record<string, string> = {};
  for (const p of partPictures ?? []) if (p.path && !p.current) otherPartPaths[p.id] = p.path;
  const otherPartsKey =
    question && partPictures ? `${question.id}|${Object.entries(otherPartPaths).map(([id, path]) => `${id}:${path}`).join(',')}` : '';
  const otherPartUrls = useSignedUrls(picApi, otherPartsKey, otherPartPaths);
  const pageUrl = useSignedUrl(picApi, pagePlanKey, pagePath);
  const [pageFailed, setPageFailed] = useState<string>('');
  const pageShown = pageUrl && pageFailed !== pagePlanKey ? pageUrl : pageUrl === undefined ? undefined : null;
  const hasPage = pageShown === undefined ? pagePath !== '' : Boolean(pageShown);
  const hasPicture = hasCrop || hasPage;
  // No crop and no page matched, or both failed to load: the whole paper is
  // shown as a page-flip instead, never a dead end.
  const flipShown = Boolean(picturePlanKey) && !hasPicture && pictureUrl !== undefined && (pagePath === '' || pageUrl !== undefined);
  // The checker can compare against the paper when any of the three is on
  // screen. The guidance says "you cannot see the paper" only when none is.
  const canCompare = hasPicture || flipShown;
  const whatToCheckLine = question
    ? whatToCheck(question.flag_reasons, question.flag_detail, { hasPicture: canCompare })
    : { line: null, detail: null };
  // Every flag has a lane in plain English (checker-lanes.ts). Without a
  // picture the older picture-aware sentences are used instead.
  const laneSummary = question ? describeLanes(question.flag_reasons, question.flag_detail) : null;
  useEffect(() => {
    const missing = unmappedCodes(question?.flag_reasons);
    if (missing.length) console.warn('[checker] flag codes with no lane:', missing.join(', '));
  }, [question?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // W14: English questions carry their passage and set text in `source`.
  const english = question ? englishContext(question.source) : null;

  const [mode, setMode] = useState<Mode>('check');
  // Choosing a tool (or finishing one) brings the view back to the part being checked.
  useEffect(() => setFocusPick(null), [mode]);
  // Phone only: which tile is showing (Question, Page or Fix). All hold the
  // same question. It opens on the typed words (the thing being checked). The
  // next question keeps the tile you were on (the owner's bento ask), except
  // Fix, which belongs to the question you were fixing: that goes back to the
  // words so a new question never opens in the middle of an edit.
  const [panel, setPanel] = useState<PanelId>('typed');
  // Which tool opened Fix it ("Fix the words" or "Edit a formula"), for the pressed look.
  const [fixTool, setFixTool] = useState<'fix' | 'formula'>('fix');
  // "Edit a formula": a number that goes up with every press, and whether the
  // editor still has to act on it.
  const [formulaReq, setFormulaReq] = useState<{ n: number; pending: boolean }>({ n: 0, pending: false });
  // Bumped when the text is changed from outside the editor (Move marks out).
  const [editorKey, setEditorKey] = useState(0);
  const [bodyDraft, setBodyDraft] = useState('');
  const [numberDraft, setNumberDraft] = useState('');
  const [marksDraft, setMarksDraft] = useState('');
  const [splitAt, setSplitAt] = useState<number | null>(null);
  const [printedTypo, setPrintedTypo] = useState(false);
  const [typoNote, setTypoNote] = useState('');
  // "What the computer changed" on the part card, opened inline.
  const [changesOpen, setChangesOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpReason, setHelpReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // What the verifier has answered in this visit, newest last, so Undo knows
  // whether there is anything to take back. The server decides what can
  // really be undone (30 minutes, nobody else touched it).
  const [answered, setAnswered] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const online = useOnline();
  // A message that survives moving to the next question (an error that made
  // the page move on, or "Saved").
  const [notice, setNotice] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);

  /* The boxes belong to ONE question. They are reset while the new question
     renders (React's "adjust state when a prop changes" pattern), not in an
     effect one render later: an effect left a render in which the new
     question sat beside the PREVIOUS question's words, and the Enter / P key
     handler, bound in that very render, saved those words onto the new
     question (release QA 2026-10-11, finding 1). Now no render, and so no
     handler, ever sees a mix.

     Keyed on the fetch, not only the id: after a split the first half comes
     back with the SAME id and a shorter body, and keying on the id alone left
     the old, whole text in the split box (a second split then failed as
     "stale"). */
  const ownerNow = draftOwnerKey(question, questionQuery.dataUpdatedAt);
  const [draftFor, setDraftFor] = useState('');
  // Typed work that came back from this browser session, and typed work that
  // belongs to an older version of the question (shown for copying only).
  const [restored, setRestored] = useState(false);
  const [keptTyping, setKeptTyping] = useState<string | null>(null);
  if (draftFor !== ownerNow) {
    setDraftFor(ownerNow);
    if (question) {
      const kept = loadDraft(scope, question, lost);
      const start = kept?.current ? kept.drafts : draftsFromQuestion(question, lost);
      setFixTool('fix');
      setFormulaReq((r) => ({ ...r, pending: false }));
      setBodyDraft(start.body);
      setNumberDraft(start.number);
      setMarksDraft(start.marks);
      setPrintedTypo(start.printedTypo);
      setTypoNote(start.typoNote);
      setMode(kept?.current ? 'fix' : 'check');
      setRestored(Boolean(kept?.current));
      setKeptTyping(kept && !kept.current ? kept.drafts.body : null);
      setEditorKey((k) => k + 1);
      setPanel((p) => tileForNextQuestion(p));
      setShowPage(false);
      setShowPaper(false);
      setLightbox(null);
      setSplitAt(null);
      setChangesOpen(false);
      setHelpOpen(false);
      setHelpReason('');
      setError(null);
    }
  }

  // Autosave: what is typed on this question is kept for this browser
  // session, so a refresh, the Back buttons or a question that comes back
  // after the lease ran out do not lose it. Removed when it matches the
  // question again, and after every successful answer.
  useEffect(() => {
    if (!question || draftFor !== ownerNow) return;
    const now = { body: bodyDraft, number: numberDraft, marks: marksDraft, printedTypo, typoNote };
    if (sameDrafts(now, draftsFromQuestion(question, lost))) clearDraft(scope, question.id);
    else saveDraft(scope, question, now);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bodyDraft, numberDraft, marksDraft, printedTypo, typoNote, draftFor, ownerNow]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), notice.tone === 'ok' ? 2500 : 20000);
    return () => clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    questionRef.current = question;
  });

  /* Warm the pictures of the questions after this one, once this one is on
     screen (verifier_peek_next_in_paper leases nothing). The picture links and
     the peeked list are forgotten when the paper changes and on sign-out. */
  const lastPrefetchPaper = useRef<string | null>(null);
  useEffect(() => {
    if (!question) return;
    const pid = question.paper_id || paperId;
    if (lastPrefetchPaper.current && lastPrefetchPaper.current !== pid) {
      clearPrefetch();
      clearPictureCache();
    }
    lastPrefetchPaper.current = pid;
    dropWarm(question.id);
    void prefetchNext(pid, {
      count: 3,
      preloadPage: false,
      // Dummy mode: nothing may reach Supabase, so the paper's own list stands in for the peek.
      deps: dummy ? offlinePrefetchDeps(api) : undefined,
    }).then((warmed) => {
      warmedRef.current = [...warmed].sort((a, b) => a.ord - b.ord);
    });
  }, [question?.id, paperId, dummy]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!dummy && !userId) {
      clearPrefetch();
      clearPictureCache();
    }
  }, [userId, dummy]);
  // Leaving the paper (or the page) forgets what was warmed for it.
  useEffect(
    () => () => {
      clearPrefetch();
      clearPictureCache();
    },
    [paperId],
  );

  /* The paper-change cue. The strip appears when the question now on screen
     belongs to a different paper than the one before, and stays for the whole
     of that paper. */
  const [seenPaper, setSeenPaper] = useState<string | null>(null);
  const [stripPaper, setStripPaper] = useState<string | null>(null);
  if (question && question.paper_id && question.paper_id !== seenPaper) {
    setSeenPaper(question.paper_id);
    if (isPaperChange(seenPaper, question.paper_id)) setStripPaper(question.paper_id);
  }
  const stripInfo =
    question && stripPaper != null && stripPaper === question.paper_id
      ? paperStripInfo(papersQuery.data?.find((p) => p.paper_id === question.paper_id) ?? question, papersQuery.data, question.paper_id)
      : null;
  const enterClass = cardEnterClass(reducedMotion);

  // W13 realtime: show as online, keep my counters and the leaderboard
  // current, and move on if someone else changes the question I have open.
  const refreshCounters = useLiveRefresh(() => {
    qc.invalidateQueries({ queryKey: ['checker-my-stats', scope] });
    qc.invalidateQueries({ queryKey: ['verifier-papers', scope] });
  });
  usePaperReviewChannel({
    enabled: !dummy,
    userId,
    fullName: userName,
    onActivity: (event) => {
      refreshCounters();
      if (!submitting && question && isForeignChangeToOpenQuestion(event, question.id, userId)) {
        setNotice({
          text:
            event.action === 'reclassify'
              ? 'A check moved that question to an admin, so here is the next one.'
              : 'Someone else just changed that question, so here is the next one.',
          tone: 'warn',
        });
        qc.invalidateQueries({ queryKey: ['verifier-next', scope, paperId] });
      } else if (!question && !submitting && !advancing && pendingHere === 0) {
        // Nothing open: any activity may mean new questions are waiting.
        qc.invalidateQueries({ queryKey: ['verifier-next', scope, paperId] });
      }
    },
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['verifier-next', scope, paperId] });
    qc.invalidateQueries({ queryKey: ['checker-my-stats', scope] });
    qc.invalidateQueries({ queryKey: ['verifier-papers', scope] });
    qc.invalidateQueries({ queryKey: ['verifier-paper-questions', scope, paperId] });
  };

  /** The next question of this paper. Its picture starts signing the moment
   *  the row is here, before its context is back. */
  async function fetchNextRow(inc: boolean): Promise<CheckerQuestion | null> {
    const row = await api.nextInPaper(paperId, { includeSkipped: inc });
    if (row) primePicture(api, row);
    return row;
  }

  /** True when this question is already answered (hidden, or a verdict is waiting for it). */
  function isAnswered(id: string): boolean {
    return maskedRef.current.has(id) || box.hasQuestion(id);
  }

  /**
   * Ask the server for the next question the plain way and put it on screen.
   * Only the fallback paths use this (a refused verdict, a missing answer, the
   * Try again button): the normal advance has the next question in the
   * verdict's own answer. A result that arrives after a newer one is dropped.
   */
  async function loadNext(answeredId: string | null, inc: boolean): Promise<boolean> {
    const seq = ++fetchSeq.current;
    try {
      const row = await fetchNextRow(inc);
      if (seq < appliedSeq.current) return true;
      appliedSeq.current = seq;
      qc.setQueryData(keyFor(inc), row);
      if (answeredId) unmask(answeredId);
      if (row) unmask(row.id);
      setNextFailed(false);
      setAdvancing(false);
      setIncoming(null);
      return true;
    } catch {
      if (seq >= appliedSeq.current) {
        setNextFailed(true);
        setAdvancing(false);
      }
      return false;
    }
  }

  /**
   * The server took a verdict (also one written before a refresh) and, in the
   * same call, handed back the next question with its context. Put it on
   * screen at once, with nothing more to fetch, unless the person has moved on.
   */
  function ackedVerdict(entry: OutboxEntry, result: VerdictAndNext | null) {
    clearDraft(scope, entry.questionId);
    qc.invalidateQueries({ queryKey: ['checker-my-stats', scope] });
    qc.invalidateQueries({ queryKey: ['verifier-papers', scope] });
    qc.invalidateQueries({ queryKey: ['verifier-paper-questions', scope, paperId] });
    const inc = entry.payload.includeSkipped ?? includeSkippedRef.current;
    const decision = decideAck({
      entry,
      result,
      screenPaperId: paperId,
      openQuestionId: questionRef.current?.id ?? null,
      answeredIds: new Set([...maskedRef.current, ...box.pendingQuestionIds()]),
      otherPendingHere: box.state().entries.filter((e) => e.paperId === paperId && e.id !== entry.id).length,
    });
    if (decision.kind === 'ignore') {
      // Another paper, or a question is already open: the answer is not wanted.
      // The question just answered stays hidden; its lease on `next` runs out by itself.
      return;
    }
    if (decision.kind === 'fetch') {
      void loadNext(entry.questionId, inc);
      return;
    }
    const next = decision.kind === 'show' ? decision.next : null;
    appliedSeq.current = ++fetchSeq.current; // anything older still on its way must not replace this
    if (next) {
      primePicture(api, next);
      // Its context came with it: seed the cache so the screen does not ask again.
      qc.setQueryData(['checker-question-context', scope, next.id], next.context);
    }
    qc.setQueryData(keyFor(inc), next);
    unmask(entry.questionId);
    if (next) unmask(next.id);
    setNextFailed(false);
    setAdvancing(false);
    setIncoming(null);
  }

  /** The server refused a verdict for good (the lease ran out, someone else changed the question). */
  function rejectedVerdict(entry: OutboxEntry, err: unknown) {
    const advice = checkerErrorAdvice(err);
    setNotice({
      text:
        entry.attempts > 0 && !isConfirmedNotSaved(err)
          ? 'Your last answer may already have been saved. If that question comes back, answer it again.'
          : advice.message,
      tone: 'warn',
    });
    unmask(entry.questionId);
    if (entry.paperId === paperId) void loadNext(entry.questionId, includeSkippedRef.current);
  }

  function retryNext() {
    setNextFailed(false);
    setAdvancing(true);
    void loadNext(null, includeSkippedRef.current);
  }

  /**
   * One verdict: write it to the outbox, hide the card at once and bring the
   * next question up. False when it was refused (nothing is open, the question
   * already has a verdict, or a save is in the same tick).
   */
  function submitVerdict(kind: VerdictKind, payload: VerdictPayload, okText: string, inc: boolean, afterQueued?: () => void): boolean {
    if (!question || busyRef.current || isAnswered(question.id)) return false;
    const entry = box.enqueue({ questionId: question.id, paperId, kind, payload: { ...payload, includeSkipped: inc } });
    if (!entry) return false;
    mask(question.id);
    const ahead = warmedRef.current.find((w) => w.questionId !== question.id && !isAnswered(w.questionId));
    setIncoming(ahead ? { id: ahead.questionId, pictureUrl: ahead.snippetUrl } : null);
    setAdvancing(true);
    setNextFailed(false);
    setError(null);
    setAnswered((a) => [...a, kind]);
    setNotice({ text: okText, tone: 'ok' });
    afterQueued?.();
    return true;
  }

  const blank = question ? isBlankBody(question.body) : false;
  const garbled = question ? looksGarbled(question.body, question.subject).garbled : false;
  // Split is offered on every question that has words (owner, 8 Oct 2026):
  // an OR between two questions is not always flagged.
  const splitOffered = question ? !blank : false;
  const orOnly = question ? isOrOnlyBody(question.body) : false;
  const edited = question ? isEdited(question, { body: bodyDraft, number: numberDraft, marks: marksDraft }) : false;
  // An empty question can never be "right" as it is; only after the checker
  // typed its words in from the picture.
  // A row that is only the word OR is not a question either: use the OR action.
  const canPass = question ? !isBlankBody(bodyDraft) && !isOrOnlyBody(bodyDraft) : false;
  const marksInvalid = marksDraft.trim() !== '' && !(Number.isFinite(Number(marksDraft)) && Number(marksDraft) >= 0);
  const showBigEditWarning = mode === 'fix' && question ? bigEdit(question.body ?? '', bodyDraft) : false;

  // A second click in the same tick, before React has shown "Saving...", must
  // not send a second request.
  const busyRef = useRef(false);

  /** Runs one answer. True when the server took it; a typed draft for the
   *  question is only dropped then (`dropDraft`), never on a failure. */
  async function run(action: () => Promise<unknown>, okText: string, kind: string, dropDraftFor?: string): Promise<boolean> {
    if (busyRef.current) return false;
    busyRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      await action();
      if (dropDraftFor) clearDraft(scope, dropDraftFor);
      setAnswered((a) => [...a, kind]);
      setNotice({ text: okText, tone: 'ok' });
      refresh();
      return true;
    } catch (err) {
      const advice = checkerErrorAdvice(err);
      if (advice.moveOn) {
        setNotice({ text: advice.message, tone: 'warn' });
        refresh();
      } else {
        setError(advice.message);
      }
      return false;
    } finally {
      busyRef.current = false;
      setSubmitting(false);
    }
  }

  function doPass() {
    if (!question || submitting) return;
    if (!canPass) {
      setError('This question has no words, so it cannot be marked as right. Press Ask the HOD.');
      return;
    }
    if (marksInvalid) {
      setError('Marks must be a number, like 2 or 0.5.');
      return;
    }
    // One place decides pass or fix and what a fix sends (checker-drafts.ts):
    // words that were not touched are never sent, and drafts that belong to
    // another question are refused.
    const plan = planAnswer(
      { question, drafts: { body: bodyDraft, number: numberDraft, marks: marksDraft, printedTypo, typoNote }, draftsFor: draftFor, mode },
      ownerNow,
    );
    if (plan.kind === 'refuse') {
      setError('This question changed while you were editing, so nothing was saved. Check the words again, then press Looks right.');
      return;
    }
    if (plan.kind === 'fix') {
      // Logged because it changes what gets stored, even though it is always
      // the same removal a checker could have made by hand.
      if (plan.strippedPrefix) {
        console.info('[checker] stripped repeated leading number on save', {
          questionId: question.id,
          displayNumber: plan.patch.display_number,
          removed: plan.strippedPrefix,
        });
      }
      const typo = plan.printedTypo;
      const typoProblem = typoSaveProblem(typo, plan.bodyChanged);
      if (typoProblem) {
        setError(typoProblem);
        return;
      }
      // plan.patch.body is null unless the words were edited, so fixing
      // only the marks or the number can never rewrite the question.
      // The version this checker saw: a save over a newer version is
      // refused (40001) instead of silently overwriting it. The typed draft
      // is dropped when the server takes the save (ackedVerdict), never before.
      submitVerdict(
        'fix',
        { patch: plan.patch, version: question.version, printedTypo: typo, typoNote: typo ? typoNote : null },
        typo ? 'Saved with the typo corrected.' : 'Saved.',
        includeSkipped,
      );
    } else {
      submitVerdict('pass', { version: question.version }, 'Marked as right.', includeSkipped);
    }
  }

  async function doOrSeparator() {
    if (!question || submitting || !orOnly) return;
    await run(() => api.markOrSeparator(question.id), OR_ONLY_DONE, 'or_separator');
  }

  async function doSplit() {
    if (!question || submitting || !canSplitAt(bodyDraft, splitAt)) return;
    await run(() => api.splitQuestion(question.id, bodyDraft, splitAt!), 'Split into two. Both will be checked again.', 'split', question.id);
  }

  function doAskForHelp(reason: string) {
    if (!question || submitting) return;
    submitVerdict('ask_help', { reason: reason.trim() || 'Not sure how to fix this' }, 'Sent to your HOD.', includeSkipped, () => setHelpOpen(false));
  }

  // Skip is always available, also on the last question left. A skipped
  // question stays on this paper for later; the verifier can go to other papers.
  function doSkip() {
    if (!question || submitting) return;
    // Skipping while going through the skipped ones sends it back to waiting.
    submitVerdict('skip', {}, 'Skipped. It stays on this paper for later.', false, () => setIncludeSkipped(false));
  }

  // Take back the last answer (verifier_undo_last). The server decides what is
  // allowed; its refusal is a plain sentence, shown as it is.
  async function doUndo() {
    if (submitting || answered.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      // Undo works on the last answer the SERVER has, so the ones still on
      // their way go first.
      if (!(await box.flush())) {
        setError('Your last answer is still being saved. Try again in a moment.');
        return;
      }
      const result = await api.undoLast(paperId);
      setAnswered((a) => a.slice(0, -1));
      // Anything still on its way is older than this and must not replace it.
      appliedSeq.current = ++fetchSeq.current;
      unmask(result.question_id);
      primePicture(api, result.question);
      qc.setQueryData(nextKey, result.question);
      setAdvancing(false);
      setNextFailed(false);
      setIncoming(null);
      qc.invalidateQueries({ queryKey: ['checker-my-stats', scope] });
      qc.invalidateQueries({ queryKey: ['verifier-papers', scope] });
      qc.invalidateQueries({ queryKey: ['verifier-paper-questions', scope, paperId] });
      setNotice({ text: UNDONE_NOTE, tone: 'ok' });
    } catch (err) {
      setError(undoErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  function cancelEdit() {
    if (!question) return;
    const start = draftsFromQuestion(question, lost);
    setBodyDraft(start.body);
    setNumberDraft(start.number);
    setMarksDraft(start.marks);
    setSplitAt(null);
    setPrintedTypo(false);
    setTypoNote('');
    setFormulaReq((r) => ({ ...r, pending: false }));
    setFixTool('fix');
    setRestored(false);
    setMode('check');
  }

  /** Open Fix it: the part card turns into the editor in place. On a phone the Question tile is the one with the card. */
  function startFix(tool: 'fix' | 'formula' = 'fix') {
    setSplitAt(null);
    setFixTool(tool);
    setMode('fix');
    setPanel('typed');
  }

  function startSplit() {
    setMode('split');
    setPanel('typed');
  }

  /** One of the four tools under the typed words. */
  function pickTool(id: CheckerToolId, available: boolean) {
    if (submitting) return;
    if (!available) {
      setNotice({ text: toolById(id).unavailable, tone: 'warn' });
      return;
    }
    // Split and the OR tool act on the stored question, so a Fix it draft
    // with changes in it must be saved or cancelled first, not lost.
    const blocked = toolBlockedByUnsavedEdit(id, mode, edited);
    if (blocked) {
      setNotice({ text: blocked, tone: 'warn' });
      return;
    }
    if (id === 'fix') startFix('fix');
    else if (id === 'formula') {
      startFix('formula');
      setFormulaReq((r) => ({ n: r.n + 1, pending: true }));
    } else if (id === 'split') {
      if (mode === 'split') cancelEdit();
      else startSplit();
    } else void doOrSeparator();
  }

  /** Cut the marks token out of the words and put its number in the Marks box. */
  function moveMarks() {
    const moved = moveMarksOut(bodyDraft);
    if (!moved) return;
    setBodyDraft(moved.body);
    setMarksDraft(String(moved.marks));
    setEditorKey((k) => k + 1);
    startFix(fixTool);
  }

  function onSplitCaret(el: HTMLTextAreaElement) {
    setSplitAt(codePointOffset(el.value, el.selectionStart));
  }

  /* First-visit walkthrough. It only starts once the real question is on
     screen and the subject picker is out of the way, so it never delays or
     covers the load. Shown once per account per browser; `?tour=1` (from
     Help) replays it. */
  const [tourOpen, setTourOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const tourUserId = dummy ? 'dummy' : (userId ?? '');
  useEffect(() => {
    if (tourOpen || !question || !tourUserId) return;
    if (searchParams.get(CHECKER_TOUR_PARAM) === '1') {
      setTourOpen(true);
      const next = new URLSearchParams(searchParams);
      next.delete(CHECKER_TOUR_PARAM);
      setSearchParams(next, { replace: true });
      return;
    }
    if (!hasSeenWalkthrough(tourUserId)) setTourOpen(true);
  }, [tourOpen, question, tourUserId, searchParams, setSearchParams]);

  function closeTour() {
    setTourOpen(false);
    if (tourUserId) markWalkthroughSeen(tourUserId);
  }

  /* Keyboard shortcuts. The listener is added ONCE and always calls the
     handler of the latest render (through the ref), so it can never act on
     a question or a draft from an earlier render. */
  function onKeyDown(e: KeyboardEvent) {
    // The full-screen picture has its own Escape; nothing is answered behind it.
    if (submitting || tourOpen || lightbox) return;
    // A held-down key is one press: it must not answer the card after this one.
    if (e.repeat) return;
    if (helpOpen) {
      if (e.key === 'Escape') setHelpOpen(false);
      return;
    }
    if (e.key === 'Escape' && mode !== 'check') {
      e.preventDefault();
      cancelEdit();
      return;
    }
    const action = matchCheckerKeyboardEvent(e);
    if (!action || !question || mode !== 'check') return;
    // The boxes must belong to the question on screen (they always do after a
    // render; this is the belt to the braces above).
    if (draftFor !== ownerNow) return;
    if (action === 'pass' && canPass) {
      e.preventDefault();
      doPass();
    } else if (action === 'fix') {
      e.preventDefault();
      startFix('fix');
    } else if (action === 'split' && splitOffered) {
      e.preventDefault();
      startSplit();
    } else if (action === 'help') {
      e.preventDefault();
      setHelpOpen(true);
    } else if (action === 'skip') {
      e.preventDefault();
      doSkip();
    } else if (action === 'undo' && answered.length > 0) {
      e.preventDefault();
      void doUndo();
    }
  }
  const keyHandlerRef = useRef(onKeyDown);
  useEffect(() => {
    keyHandlerRef.current = onKeyDown;
  });
  useEffect(() => {
    const listener = (e: KeyboardEvent) => keyHandlerRef.current(e);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  const metaChips = question
    ? [
        question.subject,
        question.cls ? `Class ${question.cls}` : null,
        question.school,
        question.year,
      ].filter((x): x is string => Boolean(x))
    : [];

  // Rewind: enabled once the verifier has answered something in this visit.
  // Also shown on the "done" screens, where the last answer is the one most
  // often clicked by mistake. On a phone it is icon-only, to leave the room to
  // the two words that matter.
  const undoButton = (
    <button
      type="button"
      onClick={() => void doUndo()}
      disabled={submitting || answered.length === 0}
      data-testid="undo-last"
      data-tour="undo"
      aria-label="Undo last"
      title={answered.length === 0 ? 'Nothing to undo yet' : 'Take back your last answer'}
      className="tap-44 order-3 inline-flex h-11 w-11 shrink-0 items-center justify-center gap-2 rounded-full bg-muted text-[15px] font-bold text-warm-secondary transition-transform duration-150 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-50 md:order-none md:w-auto md:px-4"
    >
      <Undo2 className={ACTION_ICON_CLASS} aria-hidden="true" />
      <span className="hidden md:inline">Undo last</span>
    </button>
  );

  /* The top tile: ONE calm row (owner, 12 Oct 2026: "too crammed"). A back
     arrow to the paper's questions, which paper, how far through it, the
     unsaved-answers chip when there is one, and one Menu button. Every other
     way out (my papers, admin, the HOD desk) and the day's counts are in the
     Menu. Only the title may shrink and cut off; it carries the whole name as
     its tooltip. On a phone the progress bar is a thin line along the foot of
     the tile. */
  const topTile = (
    <div
      data-tour="paper"
      data-testid="verify-header"
      className="relative shrink-0 overflow-hidden rounded-[20px] border border-warm-hairline bg-card px-3 py-2 md:rounded-[18px] md:px-4"
    >
      <div className="flex flex-nowrap items-center gap-3 md:gap-4">
        <button
          type="button"
          onClick={onExit}
          aria-label="Back to this paper's questions"
          title="Back to this paper's questions"
          data-testid="back-to-questions"
          className="tap-44 flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-muted text-warm-secondary transition-transform duration-150 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        </button>
        <div className="min-w-0 flex-1 md:flex-none md:basis-[34%]">
          <p className="truncate text-[12px] font-semibold uppercase tracking-[.04em] text-warm-meta">
            Verifying
            {question ? (
              <span className="ml-2 inline-flex gap-1 align-middle normal-case tracking-normal">
                <DebugId label="question" value={question.id} />
                <DebugId label="paper" value={question.paper_id} />
                <DebugFacts
                  facts={{
                    version: question.version,
                    flags: question.flag_reasons,
                    page: typeof question.source?.page === 'number' ? question.source.page : null,
                    'page verified': typeof question.source?.page_verified === 'boolean' ? question.source.page_verified : null,
                    align: typeof question.source?.align_score === 'number' ? question.source.align_score : null,
                  }}
                />
              </span>
            ) : null}
          </p>
          <h2 className="truncate text-[15px] font-bold leading-snug text-foreground" title={currentPaperLabel}>
            {currentPaperLabel}
          </h2>
        </div>
        {progress && question ? (
          <>
            <p className="shrink-0 whitespace-nowrap text-[13px] font-semibold tabular-nums text-foreground" aria-live="polite">
              {progress.label}
            </p>
            <div
              className="absolute inset-x-0 bottom-0 h-1 overflow-hidden bg-muted md:static md:h-2 md:min-w-[48px] md:flex-1 md:rounded-full"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress.percent}
              aria-label={progress.label}
            >
              <div className="h-full rounded-full bg-brand transition-[width] duration-300" style={{ width: `${Math.max(progress.percent, 4)}%` }} />
            </div>
          </>
        ) : (
          <div className="hidden md:block md:flex-1" aria-hidden="true" />
        )}
        <SaveStatusChip compact waiting={outboxState.entries.length} failing={outboxState.failing} onRetry={box.retryNow} />
        {toolbar ? <div className="flex shrink-0 items-center">{toolbar}</div> : null}
      </div>
    </div>
  );

  /* The action bar: always visible, under the tiles. On a phone it is two rows
     (the two big answers, then undo, ask and skip) pinned to the bottom; on a
     tablet and up one row. */
  const actionBarShell = (children: ReactNode, testId?: string) => (
    // Action footer: sticky so the buttons stay under the thumb, and outside the
    // scrolling tiles so a long question can never push them off the screen.
    <div
      data-testid={testId ?? 'action-bar'}
      className="sticky bottom-0 z-10 shrink-0 rounded-[20px] border border-warm-hairline bg-card p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:rounded-[18px]"
    >
      {children}
    </div>
  );

  const answerButtonClass = 'order-1 min-w-0 basis-[calc(50%-4px)] grow px-3 md:order-none md:basis-auto md:grow-0 md:px-5 md:py-2';
  const smallButtonClass = 'min-w-0 grow px-2 text-[14px] md:grow-0 md:basis-auto md:px-5 md:py-2 md:text-[15px]';

  const actionBar =
    question && !nextIsError
      ? actionBarShell(
          <>
            {/* A save that failed says so right here, beside the buttons, not
                at the top of a long page. */}
            {!online ? (
              <div role="status" data-testid="offline-note" className="mb-2 rounded-[12px] bg-brand-subtle px-3 py-2 text-[14px] font-semibold text-foreground">
                You are offline. Answers stay on this device and are sent when the connection is back.
              </div>
            ) : null}
            {error ? (
              <div role="alert" data-testid="save-error" className="mb-2 rounded-[12px] bg-destructive/10 px-3 py-2 text-[14px] text-destructive">
                {error}
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-2 md:flex-nowrap">
              {undoButton}
              {mode === 'split' ? (
                <>
                  <ActionButton
                    tone="mint"
                    className={answerButtonClass}
                    onClick={doSplit}
                    disabled={!canSplitAt(bodyDraft, splitAt) || submitting}
                  >
                    <Check className={ACTION_ICON_CLASS} aria-hidden="true" />
                    {submitting ? 'Saving...' : 'Split here'}
                  </ActionButton>
                  <ActionButton tone="muted" className={answerButtonClass} onClick={cancelEdit} disabled={submitting}>
                    <X className={ACTION_ICON_CLASS} aria-hidden="true" />
                    Cancel
                  </ActionButton>
                </>
              ) : (
                <>
                  <ActionButton
                    tourId="pass"
                    tone={blank && !lost && mode === 'check' ? 'muted' : 'mint'}
                    className={answerButtonClass}
                    onClick={doPass}
                    disabled={submitting || !canPass || marksInvalid}
                    title={
                      !canPass
                        ? 'This question has no words, so it cannot be marked as right'
                        : marksInvalid
                          ? 'Marks must be a number, like 2 or 0.5'
                          : 'Looks right (Enter or P)'
                    }
                  >
                    <Check className={ACTION_ICON_CLASS} aria-hidden="true" />
                    {submitting
                      ? 'Saving...'
                      : mode === 'fix'
                        ? edited
                          ? 'Save, now it matches'
                          : 'Looks right'
                        : lost
                          ? LOST_TEXT_CONFIRM
                          : 'Looks right'}
                  </ActionButton>
                  {mode === 'check' ? (
                    <ActionButton tourId="fix" tone="dark" className={answerButtonClass} onClick={() => startFix('fix')} disabled={submitting} title="Fix it (F)">
                      <Pencil className={ACTION_ICON_CLASS} aria-hidden="true" />
                      Fix it
                    </ActionButton>
                  ) : (
                    <ActionButton tone="muted" className={answerButtonClass} onClick={cancelEdit} disabled={submitting} title="Cancel (Esc)">
                      <X className={ACTION_ICON_CLASS} aria-hidden="true" />
                      Cancel
                    </ActionButton>
                  )}
                  <ActionButton
                    tourId="help"
                    tone="outline"
                    className={cn('order-4 md:order-none', smallButtonClass)}
                    onClick={() => setHelpOpen(true)}
                    disabled={submitting}
                    title="Ask the HOD (H)"
                  >
                    <CircleHelp className={ACTION_ICON_CLASS} aria-hidden="true" />
                    Ask the HOD
                  </ActionButton>
                  <ActionButton
                    tourId="skip"
                    tone="muted"
                    className={cn('order-5 md:order-none', smallButtonClass)}
                    onClick={doSkip}
                    disabled={submitting}
                    ariaLabel="Skip this question"
                    title="Skip this question (K)"
                  >
                    <SkipForward className={ACTION_ICON_CLASS} aria-hidden="true" />
                    Skip
                  </ActionButton>
                </>
              )}
              <span className="order-6 ml-auto hidden md:order-none md:inline-flex">
                <ShortcutsPopover canSplit={splitOffered} canPass={canPass} canUndo={answered.length > 0} editing={mode !== 'check'} />
              </span>
            </div>
          </>,
        )
      : null;

  const incomingBar =
    showIncoming && !nextFailed
      ? actionBarShell(
          <div className="flex flex-wrap items-center gap-2 md:flex-nowrap">
            {undoButton}
            <ActionButton tone="mint" className={answerButtonClass} onClick={() => undefined} disabled>
              <Check className={ACTION_ICON_CLASS} aria-hidden="true" />
              Looks right
            </ActionButton>
            <ActionButton tone="dark" className={answerButtonClass} onClick={() => undefined} disabled>
              <Pencil className={ACTION_ICON_CLASS} aria-hidden="true" />
              Fix it
            </ActionButton>
            <ActionButton tone="outline" className={cn('order-4 md:order-none', smallButtonClass)} onClick={() => undefined} disabled>
              <CircleHelp className={ACTION_ICON_CLASS} aria-hidden="true" />
              Ask the HOD
            </ActionButton>
            <ActionButton tone="muted" className={cn('order-5 md:order-none', smallButtonClass)} onClick={() => undefined} disabled>
              <SkipForward className={ACTION_ICON_CLASS} aria-hidden="true" />
              Skip
            </ActionButton>
          </div>,
          'incoming-footer',
        )
      : null;

  /* The question card: every tile for the question on screen. Built only when
     there is a question. Tablet and up it is a grid that fits the screen (the
     words on the left, the printed paper on the right); on a phone the same
     pieces are three swipeable tiles. */
  const card = question
    ? (() => {
        const editingHere = mode === 'fix';

        const metaList = (
          // The same four facts are in the top tile's title, so a phone and a short tablet or laptop screen drop them here to give the words the room.
          <ul className="hidden flex-wrap items-center gap-1.5 md:flex md:[@media(max-height:799px)]:hidden" aria-label="About this question" data-testid="question-meta">
            {metaChips.map((c) => (
              <li key={c} className="rounded-full bg-muted px-3 py-1 text-[12px] font-semibold text-warm-secondary">
                {c}
              </li>
            ))}
          </ul>
        );

        /** Question number and marks as chips (the boxes to change them are under the words, in the part card), then the subject, class, school and year. */
        const questionTop = (
          <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <QuestionChips
              className="mb-0"
              number={editingHere ? numberDraft || null : (question.display_number ?? null)}
              marks={editingHere && marksDraft.trim() !== '' && !marksInvalid ? Number(marksDraft) : (question.marks ?? null)}
              editing={false}
              numberDraft={numberDraft}
              marksDraft={marksDraft}
              onNumber={setNumberDraft}
              onMarks={setMarksDraft}
              marksInvalid={marksInvalid}
              disabled={submitting}
            />
            {metaChips.length > 0 ? metaList : null}
          </div>
        );

        // How to check: quiet guidance, never a card. The comparison (what the
        // computer typed, the printed paper) is the job.
        const guidance =
          canCompare && laneSummary && (laneSummary.blocks.length > 0 || laneSummary.unmapped.length > 0) ? (
            <CheckGuidance summary={laneSummary} className="mb-0" />
          ) : whatToCheckLine.line ? (
            <CheckGuidance line={whatToCheckLine.line} detail={whatToCheckLine.detail} className="mb-0" />
          ) : null;

        /** Things that need doing before the words can be judged. They are rare, and they sit ABOVE the part card. */
        const alerts = (
          <>
            {keptTyping !== null ? (
              <div role="note" className="mb-3 rounded-[10px] bg-destructive/10 p-3" data-testid="kept-typing">
                <p className="text-[14px] font-semibold text-foreground">What you typed was not saved</p>
                <p className="mt-0.5 text-[13px] leading-snug text-warm-secondary">
                  This question changed after you typed this, so it was not put back. Copy anything you still need, then check the question as it is now.
                </p>
                <textarea
                  readOnly
                  value={keptTyping}
                  rows={4}
                  aria-label="What you typed earlier"
                  className="mt-2 w-full rounded-[8px] bg-card p-3 text-[16px] leading-relaxed text-foreground outline-none focus-visible:ring-2 focus-visible:ring-brand"
                />
                <div className="mt-2">
                  <ActionButton tone="muted" onClick={() => setKeptTyping(null)}>
                    Done, hide this
                  </ActionButton>
                </div>
              </div>
            ) : null}

            {lost ? (
              <Callout tone="warn" title={LOST_TEXT_TITLE}>
                {LOST_TEXT_NOTE}
              </Callout>
            ) : blank && question?.flag_reasons?.includes('incomplete_text') ? (
              <Callout tone="warn" title="The words did not come through">
                Look at the page and press Fix it to type them. If the page does not show them either, press Ask the HOD.
              </Callout>
            ) : blank ? (
              <Callout tone="warn" title="There are no words to check here">
                The computer may have read this question together with another one. If the page shows the words, press Fix
                it and type them in. If it does not, press Ask the HOD and your HOD will sort it out.
              </Callout>
            ) : garbled ? (
              <Callout tone="warn" title="These words look scrambled">
                Do not try to retype them. Press Ask the HOD and your HOD will fix it from the paper.
              </Callout>
            ) : null}

            {orOnly && mode === 'check' ? (
              <Callout tone="warn" title={OR_ONLY_TITLE}>
                {OR_ONLY_NOTE}
                <span className="mt-2 block">
                  <ActionButton tone="brand" onClick={() => void doOrSeparator()} disabled={submitting}>
                    {OR_ONLY_BUTTON}
                  </ActionButton>
                </span>
              </Callout>
            ) : null}
          </>
        );

        /* The question as the paper has it, around the part being checked (owner, 12 Oct 2026:
           "show the entire paper question, not just the sub-part"). All of it is plain, calm
           reading with no box of its own; only the checked part is a card. */
        const marksHint =
          mode !== 'split' && !blank ? (
            <MarksInsideHint body={bodyDraft} currentMarks={marksDraft} onMove={moveMarks} disabled={submitting} />
          ) : null;

        // W14: the passage an English question is about, whole, in the pane's one scroll area.
        const passageBlock = english?.passage ? (
          <div className="mb-3 border-l-2 border-warm-hairline pl-3" data-testid="context-passage">
            <p className="mb-1 text-[12px] font-semibold text-warm-meta">{passageHeading(english.passage.kind)}</p>
            <MathText text={english.passage.text} className="break-words text-[15px] leading-relaxed text-foreground" />
            {english.setText ? <p className="mt-1 text-[12px] text-warm-secondary">From: {english.setText}</p> : null}
          </div>
        ) : english?.setText ? (
          <p className="mb-3 text-[12px] text-warm-secondary">From: {english.setText}</p>
        ) : null;

        const instructionsBlock = question.instructions ? (
          <div className="mb-3" data-testid="context-instructions">
            <MathText text={question.instructions} className="text-[14px] italic leading-relaxed text-warm-secondary" />
          </div>
        ) : null;

        const contextRows = partRows;

        /** The one line above the card while it is being edited, with the full rules behind the info icon. */
        const rulesLine =
          mode === 'fix' ? (
            <div className="mb-2 flex flex-col gap-1.5" data-testid="fix-rules">
              {restored ? (
                <p role="status" className="rounded-[10px] bg-brand-subtle px-3 py-1.5 text-[13px] font-semibold text-foreground">
                  We kept what you typed last time. Check it, then save it or press Cancel.
                </p>
              ) : null}
              <div className="flex items-center gap-1">
                <p className="min-w-0 text-[13px] font-semibold leading-snug text-foreground">{printedTypo ? TYPO_RULE_TITLE : FIX_RULE_LINE}</p>
                <RulesInfo />
              </div>
            </div>
          ) : null;

        const changesChip = (
          <ChangesChip source={question.source} rawOcr={question.raw_ocr} open={changesOpen} onToggle={() => setChangesOpen((v) => !v)} />
        );
        const changesPanel = changesOpen ? <ChangesPanel source={question.source} rawOcr={question.raw_ocr} /> : null;

        /** What sits under the words while the card is the editor: number and marks, the typo box, notes. */
        const editFooter = (
          <>
            <QuestionChips
              className="mb-0"
              number={numberDraft || null}
              marks={null}
              editing
              numberDraft={numberDraft}
              marksDraft={marksDraft}
              onNumber={setNumberDraft}
              onMarks={setMarksDraft}
              marksInvalid={marksInvalid}
              disabled={submitting}
            />
            {/* Owner round 24: a student may correct a typo printed on
                the paper. Off by default; the printed version is kept
                in version history and an admin can put it back. */}
            <label className="tap-44 flex min-h-[40px] cursor-pointer items-center gap-2.5 text-[13px] text-foreground">
              <input
                type="checkbox"
                checked={printedTypo}
                onChange={(e) => setPrintedTypo(e.target.checked)}
                disabled={submitting}
                className="h-5 w-5 shrink-0 accent-brand-blue"
              />
              <span className="leading-snug">{TYPO_CHECKBOX_LABEL}</span>
            </label>
            {printedTypo ? (
              <label className="flex flex-col gap-1 text-[13px] font-medium text-warm-secondary">
                {TYPO_NOTE_LABEL}
                <input
                  value={typoNote}
                  maxLength={TYPO_NOTE_MAX}
                  onChange={(e) => setTypoNote(e.target.value)}
                  disabled={submitting}
                  placeholder="e.g. the paper printed 'teh' for 'the'"
                  className="min-h-[44px] rounded-[10px] bg-muted px-3 py-2 text-[16px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-brand"
                />
              </label>
            ) : null}
            {normaliseOptions(question.options).length > 0 ? (
              <p className="text-[13px] leading-snug text-warm-secondary" data-testid="options-cannot-edit">
                You cannot change the options here. If one is wrong or missing, press Ask the HOD.
              </p>
            ) : null}
            {showBigEditWarning ? (
              <p role="status" className="text-[13px] leading-snug text-destructive">
                {BIG_EDIT_WARNING}
              </p>
            ) : null}
          </>
        );

        /** Split: the card itself is where you tap to choose where the second question starts. */
        const splitBody = (
          <div>
            <p className="mb-2 text-[13px] text-warm-secondary">Tap right before where the second question starts, then press Split here.</p>
            <textarea
              readOnly
              value={bodyDraft}
              onClick={(e) => onSplitCaret(e.currentTarget)}
              onKeyUp={(e) => onSplitCaret(e.currentTarget)}
              onSelect={(e) => onSplitCaret(e.currentTarget)}
              rows={5}
              aria-label="Tap where the second question starts"
              className="w-full resize-none rounded-[8px] bg-muted p-3 text-[18px] leading-relaxed text-foreground outline-none focus-visible:ring-2 focus-visible:ring-brand"
            />
          </div>
        );

        /** The card: absent only when there are no words and nothing to type over (the alert above says what to do). */
        const partCard =
          blank && !lost && mode === 'check' ? null : (
            <PartCard
              mode={mode === 'fix' ? 'edit' : mode === 'split' ? 'split' : 'read'}
              body={bodyDraft}
              options={question.options}
              lostHeading={lost ? LOST_TEXT_HEADING : null}
              disabled={submitting}
              focused={focusId === question.id}
              onFocus={() => focusPart(question.id)}
              changesChip={changesChip}
              changesPanel={changesPanel}
              sureChip={sureChip}
              onBody={setBodyDraft}
              editorKey={editorKey}
              formulaRequest={formulaReq.pending ? formulaReq.n : 0}
              onFormulaHandled={() => setFormulaReq((r) => ({ ...r, pending: false }))}
              editFooter={editFooter}
              splitBody={splitBody}
              splitFooter={<SplitPreview body={bodyDraft} at={splitAt} />}
            />
          );

        // Directly under the card. While the card is taller than the tile (a long
        // question in Fix it) the row stays pinned to the foot of the tile instead of
        // scrolling away, so a tool is never a scroll from the words.
        const tools = (
          <div className="sticky bottom-0 z-[1] mb-3 bg-card pb-1 pt-1" data-testid="tools-dock">
            <ToolsToolbar
              active={mode === 'split' ? 'split' : mode === 'fix' ? fixTool : null}
              available={{ fix: true, split: splitOffered, formula: true, or: orOnly }}
              onPick={pickTool}
              busy={submitting}
            />
          </div>
        );

        /** The checked part: the editable card, its rules line above and the tools right under it. */
        const checkedPart = (
          <>
            {rulesLine}
            {partCard}
            {tools}
            {marksHint}
          </>
        );

        /** The whole left side, top to bottom. A part of a bigger question shows the whole question from its
         *  stem, every part in order, with the checked part as the one card in its natural place. */
        const leftContent =
          contextRows.length > 0 ? (
            <>
              {questionTop}
              {alerts}
              {instructionsBlock}
              <div data-testid="whole-question" role="group" aria-label="The whole question">
                {contextRows[0].isParent ? null : passageBlock}
                {contextRows.map((r, i) => (
                  <Fragment key={r.id}>
                    {r.current ? checkedPart : <ContextPart row={r} focused={r.id === focusId} onFocus={() => focusPart(r.id)} />}
                    {/* The passage sits under the stem, before the parts. */}
                    {i === 0 && r.isParent ? passageBlock : null}
                  </Fragment>
                ))}
              </div>
            </>
          ) : (
            <>
              {questionTop}
              {alerts}
              {checkedPart}
              {passageBlock}
              {instructionsBlock}
            </>
          );

        /* ------------------------------------------------ the printed side */

        const cropAlt = picturePlan && picturePlan.kind !== 'own' ? 'the printed whole question' : 'the printed question';
        const pageAlt = pagePlan ? `the whole printed page ${pagePlan.page}, as scanned` : 'the whole printed page';
        // One picture tile per part, in the same order as the typed words (see PartPictures).
        const tilesOn = Boolean(partPictures);
        const checkedPartId = partPictures?.find((p) => p.current)?.id ?? question.id;
        const partUrls: Record<string, string | null | undefined> = tilesOn ? { ...otherPartUrls, [checkedPartId]: cropShown } : {};
        const focusedUrl = tilesOn ? partUrls[focusId] : undefined;
        // Scrolls the left words and the right picture to the same part. A picture arriving late moves the tiles, so it re-aims.
        const loadedTiles = Object.values(partUrls).filter(Boolean).length;
        const leftRevealKey = contextRows.length > 0 ? `${question.id}|${focusId}` : '';
        const rightRevealKey = tilesOn ? `${question.id}|${focusId}|${loadedTiles}` : '';
        const FOCUSED_SELECTOR = '[data-focused="true"]';
        const cropVisible = tilesOn || !picturePlanKey || (viewPath !== '' && cropShown !== null);
        const pageToggle = Boolean(pagePlan && viewPath !== '' && hasCrop);
        const pageViewerOn = Boolean(pagePlan && pageOpen && pageShown !== null);
        // A crop with no verified page: the whole paper is one tap away instead of nowhere.
        const paperToggle = Boolean(!pageToggle && hasCrop && !flipShown);
        const paperOpen = paperToggle && showPaper;
        const pageTileOn = pageViewerOn || flipShown || paperOpen;
        // The page was asked for (a tap) but its picture could not be loaded, for
        // example because it is not in storage yet. Say so, so the button never
        // looks dead.
        const pageUnavailable = Boolean(pagePlan && showPage && pageOpen && pageShown === null);
        const PAGE_UNAVAILABLE = 'The whole page could not be loaded for this question. The photo above is still right.';
        const cropLabel = picturePlan && picturePlan.kind !== 'own' && cropShown ? 'Photo of the printed whole question' : 'Photo of the printed paper';

        const enlargeCrop = tilesOn
          ? focusedUrl
            ? () => setLightbox({ src: focusedUrl, alt: 'the printed question' })
            : undefined
          : cropShown
            ? () => setLightbox({ src: cropShown, alt: cropAlt })
            : undefined;
        const enlargeButtonClass =
          'tap-44 rounded-full bg-white px-3 py-1 text-[12px] font-semibold text-foreground transition-transform duration-150 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand';

        const partsBody = partPictures ? (
          <PartPictures
            parts={partPictures}
            urls={partUrls}
            focusId={focusId}
            onFocus={focusPart}
            onEnlarge={(src, alt) => setLightbox({ src, alt })}
            onCurrentFailed={() => setPictureFailed(picturePlanKey)}
          />
        ) : null;

        /** The crop. `fit` (tablet and up) fits it to the tile; otherwise it is its natural size and the tile scrolls. */
        const cropBody = (fit: boolean) =>
          !picturePlanKey ? (
            <div className={cn('animate-pulse rounded-[8px] bg-muted', fit ? 'min-h-0 flex-1' : 'h-40 shrink-0')} role="status" aria-label="Loading the picture" />
          ) : (
            <>
              {picturePlan?.mayMissParts && cropShown ? (
                <p className="shrink-0 text-[13px] leading-snug text-warm-secondary">{PICTURE_MAY_MISS_PARTS}</p>
              ) : null}
              {cropShown === undefined ? (
                <div className={cn('animate-pulse rounded-[8px] bg-muted', fit ? 'min-h-0 flex-1' : 'h-40 shrink-0')} aria-label="Loading the picture" />
              ) : cropShown ? (
                // Natural size, never stretched past it: a small crop blown up
                // to the panel width turned into a few giant blurry words.
                <button
                  type="button"
                  onClick={enlargeCrop}
                  aria-label="Enlarge the printed question"
                  data-testid="enlarge-crop"
                  className={cn(
                    'group relative flex cursor-zoom-in justify-center self-center rounded-[6px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
                    fit ? 'min-h-0 flex-1 items-center overflow-hidden' : 'shrink-0',
                  )}
                >
                  <img
                    key={cropShown}
                    src={cropShown}
                    alt={cropAlt}
                    onError={() => setPictureFailed(picturePlanKey)}
                    className={cn('block', fit ? 'max-h-full max-w-full object-contain' : 'mx-auto h-auto max-w-full shrink-0')}
                  />
                  <span
                    aria-hidden="true"
                    className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-white text-foreground shadow-sm"
                  >
                    <Maximize2 className="h-3.5 w-3.5" />
                  </span>
                </button>
              ) : null}
            </>
          );

        const pageToggleButton = (className: string) => (
          <button
            type="button"
            aria-expanded={showPage}
            data-enter-passes="true"
            onClick={() => setShowPage((v) => !v)}
            className={cn(
              'tap-44 rounded-full bg-brand-subtle px-4 py-2 text-[13px] font-semibold text-foreground transition-transform duration-150 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
              className,
            )}
          >
            {showPage ? 'Hide the whole page' : 'See the whole page'}
          </button>
        );

        const paperToggleButton = (className: string) => (
          <button
            type="button"
            aria-expanded={showPaper}
            data-enter-passes="true"
            data-testid="paper-toggle"
            onClick={() => setShowPaper((v) => !v)}
            className={cn(
              'tap-44 rounded-full bg-brand-subtle px-4 py-2 text-[13px] font-semibold text-foreground transition-transform duration-150 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
              className,
            )}
          >
            {showPaper ? 'Hide the whole paper' : 'See the whole paper'}
          </button>
        );

        /** The whole verified page. */
        const pageBody = (fit: boolean) =>
          pageShown === undefined ? (
            <div className={cn('animate-pulse rounded-[10px] bg-muted', fit ? 'min-h-0 flex-1' : 'h-72')} aria-label="Loading the printed page" />
          ) : pageShown && pagePlan ? (
            <PageImageViewer
              src={pageShown}
              alt={pageAlt}
              note={pagePlan.note}
              source={question.source}
              fill={fit}
              onEnlarge={() => setLightbox({ src: pageShown, alt: pageAlt })}
              onError={() => setPageFailed(pagePlanKey)}
            />
          ) : null;

        // No crop and no page matched this question, or both failed to load:
        // show the whole paper as a page-flip, never a dead end.
        const flipBody = (
          <PaperPageFlip
            paperId={question.paper_id}
            loadPages={api.paperPages}
            pictureUrl={api.pictureUrl}
            questionPage={typeof question.source?.page === 'number' ? question.source.page : null}
          />
        );
        // The same flip, opened by the verifier: it must not say "no page matched".
        const paperBody = (
          <PaperPageFlip
            paperId={question.paper_id}
            loadPages={api.paperPages}
            pictureUrl={api.pictureUrl}
            questionPage={typeof question.source?.page === 'number' ? question.source.page : null}
            title="The whole paper"
          />
        );

        /* --------------------------------------------- tablet and up: the grid */
        if (wide) {
          return (
            <div className="flex h-full min-h-0 min-w-0 flex-col gap-3">
              {stripInfo ? <PaperStrip info={stripInfo} /> : null}
              <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3" data-testid="bento-grid">
                {/* Left: what the computer typed, with its details in plain sight. */}
                <div className="flex min-h-0 min-w-0 flex-col gap-3" data-testid="bento-left">
                  <TypedFrame tile tabbed={false} chip={false} panelClass="flex min-h-0 flex-1">
                    <FadeScroll revealKey={leftRevealKey} revealSelector={FOCUSED_SELECTOR}>
                      {leftContent}
                    </FadeScroll>
                  </TypedFrame>
                  {guidance ? (
                    <BentoTile data-testid="flags-tile" className="max-h-[24%] shrink-0 overflow-y-auto px-3 py-2">
                      {guidance}
                    </BentoTile>
                  ) : null}
                </div>

                {/* Right: the photo of the printed paper, in its own strong frame. */}
                <div className="flex min-h-0 min-w-0 flex-col gap-3" data-testid="bento-right">
                  {cropVisible ? (
                    <PrintedFrame
                      tile
                      tabbed={false}
                      tourId="picture"
                      label={cropLabel}
                      title={pictureHeading(cropShown ? picturePlan : null)}
                      panelClass={cn('flex min-h-0', pageTileOn ? 'flex-[2_1_0%]' : 'flex-1')}
                      headerExtra={
                        enlargeCrop ? (
                          <button type="button" onClick={enlargeCrop} className={enlargeButtonClass}>
                            Enlarge
                          </button>
                        ) : null
                      }
                    >
                      {tilesOn ? (
                        <FadeScroll white revealKey={rightRevealKey} revealSelector={FOCUSED_SELECTOR}>
                          {partsBody}
                        </FadeScroll>
                      ) : (
                        cropBody(true)
                      )}
                    </PrintedFrame>
                  ) : null}

                  {/* The whole verified page: behind a tap when there is a crop,
                      straight away when the page is the only picture. */}
                  {pageToggle && !pageViewerOn ? (
                    <div
                      data-testid="page-strip"
                      className="flex shrink-0 items-center gap-2 rounded-[20px] border-2 border-brand bg-brand-subtle px-3 py-1.5 shadow-card-bone md:rounded-[18px]"
                    >
                      <span role={pageUnavailable ? 'status' : undefined} className="text-[12px] font-bold text-foreground">
                        {pageUnavailable ? PAGE_UNAVAILABLE : 'The whole page'}
                      </span>
                      {pageToggleButton('ml-auto shrink-0 bg-white')}
                    </div>
                  ) : null}
                  {paperToggle && !paperOpen ? (
                    <div
                      data-testid="paper-strip"
                      className="flex shrink-0 items-center gap-2 rounded-[20px] border-2 border-brand bg-brand-subtle px-3 py-1.5 shadow-card-bone md:rounded-[18px]"
                    >
                      <span className="text-[12px] font-bold text-foreground">The whole paper</span>
                      {paperToggleButton('ml-auto shrink-0 bg-white')}
                    </div>
                  ) : null}
                  {pageTileOn ? (
                    <PrintedFrame
                      tile
                      tabbed={false}
                      id="verify-panel-page"
                      tourId={cropVisible ? undefined : 'picture'}
                      label={pageViewerOn ? PAGE_HEADING : paperOpen ? 'The whole paper' : 'Photo of the printed paper'}
                      title={pageViewerOn ? PAGE_HEADING : paperOpen ? 'The whole paper' : pictureHeading(null)}
                      panelClass="flex min-h-0 flex-[3_1_0%]"
                      headerExtra={
                        pageToggle
                          ? pageToggleButton('bg-white px-3 py-1 text-[12px]')
                          : paperToggle
                            ? paperToggleButton('bg-white px-3 py-1 text-[12px]')
                            : null
                      }
                    >
                      {pageViewerOn ? (
                        pageBody(true)
                      ) : (
                        <FadeScroll white>{paperOpen ? paperBody : flipBody}</FadeScroll>
                      )}
                    </PrintedFrame>
                  ) : null}
                  {!cropVisible && !pageTileOn && !(pageToggle && !pageViewerOn) ? (
                    <PrintedFrame tile tabbed={false} tourId="picture" panelClass="flex min-h-0 flex-1">
                      <div className="min-h-0 flex-1 animate-pulse rounded-[8px] bg-muted" aria-label="Loading the picture" />
                    </PrintedFrame>
                  ) : null}
                </div>
              </div>
            </div>
          );
        }

        /* --------------------------------------- phone: Question | Page | Fix */
        const typedPane = (
          <TypedFrame tile chip={false} panelClass="flex min-h-0 flex-1">
            <FadeScroll revealKey={leftRevealKey} revealSelector={FOCUSED_SELECTOR}>
              {leftContent}
              {guidance ? <div className="mt-3">{guidance}</div> : null}
            </FadeScroll>
          </TypedFrame>
        );
        const printedPane = (
          <PrintedFrame
            tile
            tourId="picture"
            label={cropVisible ? cropLabel : 'Photo of the printed paper'}
            title={pictureHeading(cropShown ? picturePlan : null)}
            panelClass="flex min-h-0 flex-1"
          >
            <FadeScroll
              white
              innerClassName="flex flex-col gap-2.5"
              revealKey={panel === 'printed' ? rightRevealKey : ''}
              revealSelector={FOCUSED_SELECTOR}
            >
              {tilesOn ? partsBody : cropVisible ? cropBody(false) : null}
              {pageToggle ? pageToggleButton('self-start') : null}
              {paperToggle ? paperToggleButton('self-start') : null}
              {pageUnavailable ? (
                <p role="status" className="text-[13px] font-semibold text-warm-secondary">
                  {PAGE_UNAVAILABLE}
                </p>
              ) : null}
              {pageViewerOn ? (
                <div className="flex min-w-0 flex-col">
                  <p className="mb-1 text-[12px] font-semibold text-warm-secondary">{PAGE_HEADING}</p>
                  {pageBody(false)}
                </div>
              ) : null}
              {flipShown ? (
                <div className="flex min-w-0 flex-col">
                  <p className="mb-1 text-[12px] font-semibold text-warm-secondary">{pictureHeading(null)}</p>
                  {flipBody}
                </div>
              ) : null}
              {paperOpen ? <div className="flex min-w-0 flex-col">{paperBody}</div> : null}
              {!cropVisible && !pageViewerOn && !flipShown ? (
                <div className="h-40 animate-pulse rounded-[8px] bg-muted" aria-label="Loading the picture" />
              ) : null}
            </FadeScroll>
          </PrintedFrame>
        );
        return (
          <div className="flex h-full min-h-0 min-w-0 flex-col gap-2">
            {stripInfo ? <PaperStrip info={stripInfo} /> : null}
            <PanelTabs value={panel} onChange={setPanel} tabs={VERIFY_TABS} className="mb-0 md:hidden" />
            <TilePager
              value={panel}
              onChange={setPanel}
              order={['typed', 'printed']}
              panes={{ typed: typedPane, printed: printedPane }}
              reducedMotion={reducedMotion || tourOpen}
            />
          </div>
        );
      })()
    : null;

  return (
    <div data-testid="verify-screen" className="flex min-h-0 flex-1 flex-col gap-2 md:gap-3">
      {topTile}

      <div aria-live="polite" className="contents">
        {notice ? (
          <div
            role="status"
            // Floats over the page instead of pushing the question down
            // (no layout shift on every save).
            className={cn(
              'fixed left-1/2 top-24 z-40 w-[min(92vw,28rem)] -translate-x-1/2 rounded-2xl px-4 py-3 text-center text-[14px] font-semibold text-foreground shadow-lg animate-in fade-in-0 duration-200',
              notice.tone === 'ok' ? 'bg-mint' : 'bg-brand-subtle',
            )}
          >
            {notice.text}
          </div>
        ) : null}
        {/* With a question open the error sits beside the buttons (the action
            bar below); this one is for the screens that have no buttons. */}
        {error && !question ? (
          <div role="alert" className="rounded-2xl bg-destructive/10 px-4 py-3 text-[14px] text-destructive">
            {error}
          </div>
        ) : null}
      </div>

      {/* The tiles take everything between the top tile and the action bar. */}
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] overflow-y-auto">
        {questionQuery.isLoading ? (
          <CheckerSkeleton />
        ) : nextFailed || (nextIsError && !showIncoming) ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            {nextProblem === 'paper_gone' ? (
              <>
                <p className="text-lg font-semibold text-foreground">{PAPER_GONE_TITLE}</p>
                <p className="max-w-[40ch] text-[14px] text-warm-secondary">{PAPER_GONE_NOTE}</p>
                <ActionButton tone="mint" onClick={onList ?? onExit}>
                  Back to my papers
                </ActionButton>
              </>
            ) : (
              <>
                <p className="text-lg font-semibold text-foreground">{LOAD_FAILED_TITLE}</p>
                {nextProblem === 'no_access' ? (
                  <>
                    <p className="max-w-[40ch] text-[14px] text-warm-secondary">Your sign-in no longer lets you check papers. Sign in again, or ask an admin or the HOD.</p>
                    <a href="/auth" className="tap-44 inline-flex items-center rounded-full bg-brand px-5 text-[15px] font-bold text-foreground">
                      Sign in again
                    </a>
                  </>
                ) : (
                  <>
                    <p className="text-[14px] text-warm-secondary">{LOAD_FAILED_NOTE}</p>
                    <ActionButton tone="mint" onClick={nextFailed ? retryNext : () => void questionQuery.refetch()}>
                      Try again
                    </ActionButton>
                  </>
                )}
              </>
            )}
          </div>
        ) : showIncoming ? (
          // The next question's card, up before its words: the picture is warm.
          <div key={cardId(null, incoming?.id ?? null)} className={cn('min-h-0', enterClass)}>
            <IncomingCard pictureUrl={incoming?.pictureUrl ?? null} />
          </div>
        ) : !question && !includeSkipped && !paperRow && paperGate === 'loading' ? (
          // The list that says how many are skipped has not arrived. Do not
          // say "Paper finished" until it has.
          <CheckerSkeleton />
        ) : !question && !includeSkipped && !paperRow && paperGate === 'error' ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center" role="alert">
            <p className="text-lg font-semibold text-foreground">Could not load your papers</p>
            <p className="text-[14px] text-warm-secondary">{LOAD_FAILED_NOTE}</p>
            <ActionButton tone="mint" onClick={() => void papersQuery.refetch()}>
              Try again
            </ActionButton>
          </div>
        ) : !question && !includeSkipped && skippedCount > 0 && paperRow != null && paperRow.remaining <= skippedCount ? (
          // Only skipped questions are left. They stay on this paper for
          // later; the verifier can go to other papers or go through them now.
          <div className="flex flex-col items-center gap-3 py-16 text-center" data-testid="only-skipped-left">
            <p className="text-balance text-xl font-bold text-foreground">Done for now</p>
            <p className="max-w-md text-pretty text-[14px] text-warm-secondary">{skippedNote(skippedCount)}</p>
            <div className="flex flex-wrap justify-center gap-2.5">
              <ActionButton tone="mint" onClick={onList ?? onExit}>
                Back to my papers
              </ActionButton>
              <ActionButton
                tone="muted"
                onClick={() => {
                  setIncludeSkipped(true);
                }}
              >
                Go through skipped ones now
              </ActionButton>
              {undoButton}
            </div>
          </div>
        ) : !question ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center" data-testid="paper-finished">
            <p className="text-balance text-xl font-bold text-foreground">Paper finished</p>
            <p className="max-w-md text-pretty text-[14px] text-warm-secondary">
              You have been through every question you can settle on {currentPaperLabel}. Anything you sent to the HOD stays with them.
            </p>
            <div className="flex flex-wrap justify-center gap-2.5">
              <ActionButton tone="mint" onClick={onList ?? onExit}>
                Back to my papers
              </ActionButton>
              {undoButton}
            </div>
          </div>
        ) : (
          // Tablet and up: what the computer typed on the left, the photo of the
          // printed paper on the right, in a strongly framed box so they cannot
          // be mixed up. Phone: three tiles, Question, Page and Fix, both
          // always on the same question.
          <div key={cardId(question, null)} className={cn('min-h-0', enterClass)} data-testid="question-card">
            {card}
          </div>
        )}
      </div>

      {actionBar}
      {incomingBar}

      {tourOpen && question ? (
        <CheckerWalkthrough
          onShowTarget={(target) => {
            // On a phone only one tile shows at a time: bring up the tile a step is about.
            if (target === 'picture') setPanel('printed');
            else if (target === 'question' || target === 'tools' || target === 'changes') setPanel('typed');
          }}
          onClose={closeTour}
          onPractice={() => {
            closeTour();
            navigate(CHECKER_PRACTICE_PATH);
          }}
        />
      ) : null}

      {lightbox ? <ImageLightbox src={lightbox.src} alt={lightbox.alt} onClose={() => setLightbox(null)} /> : null}

      {helpOpen && question ? (
        <Modal onClose={() => setHelpOpen(false)} labelledBy="checker-help-title">
          <h2 id="checker-help-title" className="mb-2 text-[16px] font-bold text-foreground">
            What should the HOD look at?
          </h2>
          <p className="mb-3 text-[13px] text-warm-secondary">
            Your HOD will look at this question. The rest of your paper carries on, so you can go straight to the next one.
          </p>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {HELP_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={helpReason === r}
                onClick={() => setHelpReason(r)}
                className={cn(
                  'tap-44 rounded-full px-3 py-1.5 text-[13px] font-semibold transition-transform duration-150 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
                  helpReason === r ? 'bg-brand text-foreground' : 'bg-muted text-warm-secondary',
                )}
              >
                {r}
              </button>
            ))}
          </div>
          <textarea
            autoFocus
            value={helpReason}
            onChange={(e) => setHelpReason(e.target.value)}
            placeholder="Or say it in your own words"
            rows={3}
            aria-label="What can't you fix"
            className="w-full rounded-xl bg-muted p-3 text-[16px] outline-none focus-visible:ring-2 focus-visible:ring-brand"
          />
          {error ? <p className="mt-2 text-[13px] text-destructive">{error}</p> : null}
          <div className="mt-3 flex gap-2">
            <ActionButton tone="brand" onClick={() => doAskForHelp(helpReason)} disabled={submitting}>
              {submitting ? 'Sending...' : 'Send to the HOD'}
            </ActionButton>
            <ActionButton tone="muted" onClick={() => setHelpOpen(false)} disabled={submitting}>
              Cancel
            </ActionButton>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
