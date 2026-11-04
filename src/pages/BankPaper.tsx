import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Clock, Flag, Search } from 'lucide-react';

import { Footer } from '@/components/Footer';
import { DisclaimerStrip } from '@/components/papers/disclaimer-strip';
import { PaperDisclaimerDialog } from '@/components/papers/paper-disclaimer-dialog';
import { PaperShareLock, paperLockClass } from '@/components/papers/paper-share-lock';
import { CaptureShield } from '@/components/CaptureShield';
import { MorePapers } from '@/components/papers/more-papers';
import { MathText } from '@/components/papers/math-text';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useAuth } from '@/lib/auth-context';
import { GateSheet } from '@/components/auth/gate-sheet';
import { supabase } from '@/integrations/supabase/client';
import { logger } from '@/utils/logger';
import { SUBJECT_PATH_TO_FILTER } from '@/utils/subjectMapping';
import { bankSubjectToSite } from '@/lib/subject-vocabulary';
import { paperSourceName } from '@/lib/school-display';
import { NOT_FOUND_TITLE, NOT_FOUND_DESCRIPTION } from '@/lib/not-found-copy';
import NotFound from '@/pages/NotFound';
import { buildPaperSeo } from '@/lib/paper-seo';

import {
  resolveDisplayNumber, showPaperExtras, showIncompleteNote, showQuestionInstructions,
  marksShownInText as marksInText, showSuggestedTime, sectionHeadings, alternativeRuns,
  alternativeFollowerIds, subPartsOf, topLevelIds,
} from '@/lib/bank-paper-display';
import { displayBodyWithoutDuplicateNumber } from '@/lib/checker-body';
import { qtypeLabel } from '@/lib/qtype-label';
import { questionMatchesSearch, searchableCount } from '@/lib/bank-question-search';
import { DebugId } from '@/components/DebugId';
import { HeldQuestionCard } from '@/components/papers/held-question-card';

/** The teachers route for a bank paper's subject, or the filtered browse
 *  when that subject has no page of its own. Never an invented slug. */
function subjectTeacherPath(subject: string): string {
  const siteName = bankSubjectToSite(subject);
  const hit = Object.entries(SUBJECT_PATH_TO_FILTER).find(
    ([, name]) => name.toLowerCase() === siteName.toLowerCase(),
  );
  return hit
    ? hit[0]
    : `/all-tuition-teachers-in-kolkata?filter_subjects=${encodeURIComponent(siteName)}`;
}
import {
  loadPaper, loadPaperQuestions, hasYear, paperTitle,
  type BankPaper as BankPaperMeta, type BankQuestion,
} from '@/lib/question-bank';

const CONTAINER = 'mx-auto w-full max-w-5xl px-4 sm:px-6 lg:px-8';

/* One paper from the question bank, at its own /past-papers/:id.

   Same address space and the same dark chrome as the PDF reader (S5/RD-002):
   App's paper route dispatches here on the bank's 6-hex ids and there on the
   database's UUIDs. What differs is the sheet: this paper has structured
   questions, so it renders them with their marks, chapters and figures.

   Reading a 40-question paper is a long scroll, so the things you steer with
   stay put: the back bar, the paper's identity, the search and the chapter
   chips are one sticky block at the top, and only the questions move.

   Question text is rendered verbatim, byte-exact from the source, never
   cleaned or retyped. */

/**
 * The inline report form, opened from a question's own Flag chip.
 *
 * Submitting writes a row to `question_reports` rather than opening a
 * WhatsApp draft: the report stays in the product, where it can be queued
 * and moderated, and a reader without WhatsApp can still file one. Works
 * signed out — reporter_id is recorded only when there is a session, which
 * is exactly what the table's insert policy permits.
 */
function QuestionReport({
  questionId,
  paperId,
  onDone,
}: {
  questionId: string;
  paperId: string;
  onDone: () => void;
}) {
  const [note, setNote] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  // The confirmation lingers for a moment, then closes the form. If the reader
  // opens a report on another question in that window this component unmounts,
  // and the timer must go with it or it would close the form they just opened.
  const doneTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(doneTimer.current), []);

  async function submit() {
    if (state === 'sending') return;
    setState('sending');
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const { error } = await supabase.from('question_reports').insert({
        question_id: questionId,
        paper_id: paperId,
        note: note.trim() ? note.trim().slice(0, 1000) : null,
        reporter_id: sessionData.session?.user.id ?? null,
      });
      if (error) throw error;
    } catch (error) {
      logger.error('question report failed', error);
      setState('error');
      return;
    }
    setState('sent');
    // Left on screen briefly so the confirmation is actually read.
    doneTimer.current = window.setTimeout(onDone, 1400);
  }

  if (state === 'sent') {
    return (
      /* role="status" — the form this replaces is gone from the page, so
         without a live region a screen-reader user gets silence and no way to
         know the report was filed. */
      <p
        role="status"
        className="mt-2 rounded-[12px] bg-mint px-3 py-2 text-[13px] font-semibold text-foreground"
      >
        Thanks. We will take a look at this one.
      </p>
    );
  }

  return (
    <div className="mt-2 rounded-[12px] bg-card p-2.5 shadow-border">
      <label htmlFor={`report-note-${questionId}`} className="sr-only">
        What is wrong with this question?
      </label>
      <textarea
        id={`report-note-${questionId}`}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        maxLength={1000}
        placeholder="What is wrong? (optional)"
        className="w-full resize-none rounded-[8px] bg-muted px-2.5 py-2 text-base text-foreground placeholder:text-warm-prose focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={state === 'sending'}
          className="inline-flex min-h-11 items-center rounded-full bg-brand px-4 text-[13px] font-bold text-brand-foreground transition-colors duration-150 hover:bg-brand-hover disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {state === 'sending' ? 'Sending…' : 'Send report'}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="inline-flex min-h-11 items-center px-2 text-[13px] font-semibold text-warm-secondary transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Cancel
        </button>
        {state === 'error' && (
          /* role="alert" — a failure that only appears visually leaves a
             screen-reader user believing the report was sent. */
          <span role="alert" className="text-[12px] font-semibold text-destructive">
            That did not send. Try again?
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * M8: the report chip's "Report" label used to be conditionally mounted
 * (`{reportFor === row.i && <span>Report</span>}`), so switching which
 * question's report is open -- or closing one -- removed the old label in
 * the same frame the new state applied, with no exit transition. Keeping the
 * label mounted for one more tick and fading its opacity down over 150ms
 * (CRAFT's motion budget for exits) means the old chip's label settles out
 * instead of just vanishing. Opacity only, per CRAFT §2 -- this never
 * touches layout/width, so it does not fight the chip's own icon-only
 * collapsed state.
 */
function FadeLabel({ show, children }: { show: boolean; children: import('react').ReactNode }) {
  const [mounted, setMounted] = useState(show);
  useEffect(() => {
    if (show) { setMounted(true); return; }
    const t = window.setTimeout(() => setMounted(false), 150);
    return () => window.clearTimeout(t);
  }, [show]);
  if (!mounted) return null;
  return (
    <span className={`transition-opacity duration-[150ms] motion-reduce:transition-none ${show ? 'opacity-100' : 'opacity-0'}`}>
      {children}
    </span>
  );
}

/** A question's diagram. If the picture cannot load, a plain note stands in, so it does not read as a broken part of the question. */
function FigureImage({ src, alt, dims }: { src: string; alt: string; dims?: [number, number] }) {
  const [bad, setBad] = useState(false);
  if (bad) {
    return (
      <p role="status" className="rounded-[12px] bg-card px-3 py-2 text-[13px] text-warm-secondary">
        The diagram for this question did not load. Reload the page to try again.
      </p>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      {...(dims ? { width: dims[0], height: dims[1] } : {})}
      loading="lazy"
      decoding="async"
      onError={() => setBad(true)}
      className="max-h-[300px] w-auto max-w-full rounded-[12px] bg-card p-2 shadow-border"
    />
  );
}

export default function BankPaper() {
  const { id } = useParams<{ id: string }>();
  const [paper, setPaper] = useState<BankPaperMeta | null>(null);
  const [questions, setQuestions] = useState<BankQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const [chapter, setChapter] = useState('');
  const [q, setQ] = useState('');
  const [reportFor, setReportFor] = useState('');
  const [gateOpen, setGateOpen] = useState(false);
  const { user } = useAuth();

  /* P2-2: figure-dimensions.ts is a ~114KB generated source file (intrinsic
     width/height for every figure in the whole bank, not just this paper's),
     and was the single largest thing riding inside BankPaper's own page
     chunk -- bigger than Browse, TeacherProfile and TeacherDashboard
     combined per the audit. Most papers carry no figures at all, so most
     visits to this route paid for it without ever reading a value out of it.
     A dynamic import splits it into its own chunk that only downloads once
     this route actually mounts, in parallel with (not blocking) the question
     text this page exists to show. `row.f` figures already carry
     `loading="lazy"`, so there is no visible cost: by the time any image is
     near the viewport this has long since resolved. */
  const [figureDims, setFigureDims] = useState<Record<string, [number, number]> | null>(null);
  /* R3P4: most papers carry zero figures (no question's row.f is set), and
     until now the 116KB chunk above was fetched unconditionally on mount,
     before `questions` had even loaded. Gating on "at least one loaded
     question has row.f" skips the chunk entirely for the figure-less
     majority, and still fetches it -- in parallel, non-blocking -- for
     papers that do have figures, in time for the images (already
     loading="lazy" below) that need it. */
  const hasFigures = questions.some((row) => row.f);
  useEffect(() => {
    if (!hasFigures) return;
    let cancelled = false;
    import('@/content/figure-dimensions').then((m) => {
      if (!cancelled) setFigureDims(m.FIGURE_DIMENSIONS);
    });
    return () => { cancelled = true; };
  }, [hasFigures]);

  /* bank_papers.subject stores the raw bank spelling ("Mathematics"); every
     other site-facing surface (title, header, CTA, meta) uses the site's own
     vocabulary ("Maths") -- see src/lib/subject-vocabulary.ts. Every display
     site below reads this, never paper.subject directly. */
  const displaySubject = paper ? bankSubjectToSite(paper.subject) : '';
  /* The source a paper is shown under, or null when none is recorded. A null
     source is dropped from the title, the header and the card rather than
     printed as "School not recorded". */
  const sourceName = paper ? paperSourceName(paper.school) : null;
  const paperHeading = paper
    ? [sourceName, `Class ${paper.cls} ${displaySubject}`].filter(Boolean).join(' · ')
    : '';

  /* This paper's own row and this paper's own questions, and nothing else.
     It used to fetch the entire bank — 6,912 questions — to read one of them. */
  useEffect(() => {
    let cancelled = false;
    setPaper(null);
    setQuestions([]);
    setFailed(false);
    setLoading(true);
    if (!id) { setLoading(false); return; }
    /* Re-runs when the user signs in, which is the whole point: the gate now
       withholds the rows themselves, so unlocking is a re-fetch, not a CSS
       change. `user?.id` rather than `user` so a new object identity for the
       same person does not re-request the paper. */
    loadPaper(id)
      .then((meta) => {
        if (cancelled) return;
        setPaper(meta);
        /* A paper still under review shows no questions at all, not even the
           free preview -- and this never calls the RPC for one, so it never
           writes read_events for content nobody is meant to see yet. */
        if (!meta || meta.needsReview) {
          setLoading(false);
          return undefined;
        }
        return loadPaperQuestions(id, Boolean(user)).then((rows) => {
          if (cancelled) return;
          setQuestions(rows);
          setLoading(false);
        });
      })
      .catch(() => { if (!cancelled) { setFailed(true); setLoading(false); } });
    return () => { cancelled = true; };
  }, [id, user?.id, retryTick]);

  useEffect(() => { setChapter(''); setQ(''); setReportFor(''); }, [id]);

  /* Same subject + class, for the "more papers like this" section — public
     metadata (school/cls/subject/board/year, no question text), so this
     runs for every visitor, not just a signed-in one. */
  const [siblings, setSiblings] = useState<{ id: string; title: string; year: string | number | null }[]>([]);
  useEffect(() => {
    if (!paper) { setSiblings([]); return; }
    let cancelled = false;
    supabase
      .from('bank_papers')
      .select('id,school,cls,subject,year')
      .eq('is_published', true).gt('question_count', 0)
      .eq('needs_review', false)
      .eq('subject', paper.subject)
      .eq('cls', paper.cls)
      // Undated papers last, as the index does (question-bank.ts pageQuery):
      // Postgres sorts NULLs first on DESC, which would lead the list with
      // papers that have no year.
      .order('year', { ascending: false, nullsFirst: false })
      .limit(50)
      .then(({ data }) => {
        if (cancelled || !data) return;
        setSiblings(data.map((r) => ({ id: r.id, title: [paperSourceName(r.school), `Class ${r.cls} ${bankSubjectToSite(r.subject)}`].filter(Boolean).join(' '), year: hasYear(r.year) ? r.year : null })));
      });
    return () => { cancelled = true; };
  }, [paper]);

  const chapters = useMemo(() => {
    const seen: string[] = [];
    questions.forEach((row) => { if (row.c && !seen.includes(row.c)) seen.push(row.c); });
    return seen;
  }, [questions]);

  const needle = q.trim().toLowerCase();
  const visible = useMemo(
    () => questions.filter((row) =>
      (!chapter || row.c === chapter) && questionMatchesSearch(row, needle)),
    [questions, chapter, needle],
  );

  /* D77: layout for the pipeline's structural fields -- a printed section
     heading ("Section A"), OR-alternatives ("Answer Q7 OR Q8") and sub-parts
     ("5" -> "5(a)", "5(b)"). Derived from `visible` (the already
     chapter/search-filtered list), not the raw `questions`, so a filter never
     shows a heading or an OR pair whose other half it just hid -- each of
     these three helpers is a pure, order-preserving pass and none of them
     re-sort, so they compose safely with that filter. Most papers have none
     of the three fields set; every one of these is empty for such a paper and
     the render below falls straight back to today's flat list. */
  const sectionHeadingsMap = useMemo(
    () => sectionHeadings(visible.map((row) => ({ i: row.i, sec: row.sec }))),
    [visible],
  );
  const altRuns = useMemo(
    () => alternativeRuns(visible.map((row) => ({ i: row.i, ag: row.ag }))),
    [visible],
  );
  const altFollowers = useMemo(() => alternativeFollowerIds(altRuns), [altRuns]);
  const childrenOf = useMemo(
    () => subPartsOf(visible.map((row) => ({ i: row.i, pid: row.pid }))),
    [visible],
  );
  const topIds = useMemo(
    () => new Set(topLevelIds(visible.map((row) => ({ i: row.i, pid: row.pid })))),
    [visible],
  );
  const byId = useMemo(() => new Map(visible.map((row) => [row.i, row])), [visible]);

  type RenderNode =
    | { kind: 'heading'; key: string; label: string }
    | { kind: 'or'; key: string }
    | { kind: 'card'; key: string; row: BankQuestion; depth: number };

  const renderNodes = useMemo(() => {
    const nodes: RenderNode[] = [];
    const pushWithChildren = (row: BankQuestion, depth: number) => {
      nodes.push({ kind: 'card', key: row.i, row, depth });
      for (const childId of childrenOf.get(row.i) ?? []) {
        const child = byId.get(childId);
        if (child) pushWithChildren(child, depth + 1);
      }
    };
    for (const row of visible) {
      if (!topIds.has(row.i) || altFollowers.has(row.i)) continue; // rendered elsewhere
      const heading = sectionHeadingsMap.get(row.i);
      if (heading) nodes.push({ kind: 'heading', key: `sec-${row.i}`, label: heading });

      const run = altRuns.get(row.i);
      if (run) {
        run.forEach((id, idx) => {
          if (idx > 0) nodes.push({ kind: 'or', key: `or-${row.i}-${idx}` });
          const member = byId.get(id);
          if (member) pushWithChildren(member, 0);
        });
      } else {
        pushWithChildren(row, 0);
      }
    }
    return nodes;
  }, [visible, topIds, altFollowers, sectionHeadingsMap, altRuns, childrenOf, byId]);

  /* The source splits a multi-part printed question ("1. a) ... b) ... c) ...")
     into one row per part, but every part carries the SAME printed number —
     the badge showed "1","1","1","2","2","2"... which reads as duplicated/
     wrong numbering, not as three parts of one question. This derives a
     display-only a/b/c suffix for runs that share a number; it never touches
     `row.n` itself or the question text, both of which stay exactly as
     stored. Built from the full, unfiltered `questions` (paper order), not
     `visible`, so the lettering stays stable regardless of chapter/search
     filtering. */
  const displayNumbers = useMemo(() => {
    const map = new Map<string, string>();
    let runNumber: string | null = null;
    let runIds: string[] = [];
    const flushRun = () => {
      if (runIds.length === 0) return;
      /* A run of rows that all carry NO printed number is not a multi-part
         question, it is a paper that never numbered its questions — every
         History and Economics paper in the bank is like this. Suffixing it
         produced "nulla", "nullb", "nullc" from the template literal below.
         The badge never showed it (it is gated on row.n), so this surfaced
         only once the report chip started naming the question. */
      if (runNumber === null || runNumber === '') return;
      if (runIds.length === 1) {
        map.set(runIds[0], runNumber);
      } else {
        runIds.forEach((id, idx) => map.set(id, `${runNumber}${String.fromCharCode(97 + idx)}`));
      }
    };
    for (const row of questions) {
      if (row.n !== runNumber) {
        flushRun();
        runNumber = row.n;
        runIds = [];
      }
      runIds.push(row.i);
    }
    flushRun();
    return map;
  }, [questions]);

  /* How a question is NAMED to assistive tech, which is a different job from
     the badge. The badge may legitimately show nothing when the paper printed
     no number; a control that acts on one question still has to say which one,
     or a 186-question paper puts 186 identically-named buttons in the
     accessibility tree. Falls back to paper position, counted over the full
     ordered list so it does not shift when a chapter filter is applied. */
  const questionNames = useMemo(() => {
    const map = new Map<string, string>();
    questions.forEach((row, i) => {
      map.set(row.i, displayNumbers.get(row.i) ?? `${i + 1}`);
    });
    return map;
  }, [questions, displayNumbers]);

  /* The sign-in gate — now a real one.

     It used to be a soft gate: every question was rendered and the tail merely
     blurred, so the rows were sitting in the DOM and in any unauthenticated API
     response. This now reads through the bank_paper_questions RPC with anon
     SELECT revoked, so a signed-out reader is SENT only the preview questions and the rest
     do not exist on the client. There is no blur to defeat and nothing to
     un-hide with devtools.

     `withheld` is therefore a difference between what the paper says it has and
     what the server was willing to send, not a slice index into rows we hold.
     It is only ever non-zero while signed out.

     The old "not applied while filtering" exemption is gone with the rows it
     protected: filtering cannot reveal a question the client never received. */
  const withheld =
    paper && !user ? Math.max(0, paper.questionCount - questions.filter((row) => !row.held).length) : 0;
  const filtering = Boolean(chapter || needle);

  /* Title and description come from src/lib/paper-seo.ts, the same builder
     scripts/prerender.ts uses, so the crawler's copy and the browser's copy of
     this page cannot disagree. */
  const paperSeo = paper ? buildPaperSeo(paper) : null;
  /* A paper id that does not resolve shows the site's own not-found page,
     with its title and description, rather than a paper-specific message.
     A failed read is a separate state (`failed`) and is not "not found". */
  const notFound = !loading && !failed && !paper;
  usePageMeta(
    notFound
      ? NOT_FOUND_TITLE
      : paperSeo ? paperSeo.title : 'Past paper | Shikshaq',
    notFound
      ? NOT_FOUND_DESCRIPTION
      : paper && paperSeo
        ? paper.needsReview
          ? `${paperSeo.heading.replace(/ question paper$/, '')} ${paper.exam}. This paper is being audited and is not open to read yet.`
          : paperSeo.description
        : 'Read a free past year question paper on Shikshaq.',
  );

  /* The description wording ("All N questions ... First two open to
     everyone, the rest free with an account") is the owner's choice of
     2026-09-30 and is true for a signed-out reader too. */

  /* Many papers print their own marks inline, "Find: [3]". Our pill would then
     say the same number twice on one card, so ours stands down; the paper's
     own marker is the source and is never touched. */
  const marksShownInText = (row: BankQuestion): boolean => marksInText(row.m, row.t);

  /* One dot-separated line, not a wall of pills. As chips these five facts ran
     to two rows on a phone and pushed the first question below the fold. */
  const facts = paper
    ? [
        `${paper.questionCount} questions`,
        paper.marks > 0 ? `${paper.marks} marks` : null,
        chapters.length > 0 ? `${chapters.length} chapters` : null,
        paper.exam,
        hasYear(paper.year) ? paper.year : null,
      ].filter(Boolean) as string[]
    : [];


  /* One question card.
     The `blurPx` parameter is gone with the soft gate that needed it. It
     ramped a CSS blur across the gated tail; under the real gate those rows
     are never sent, so every card this renders is one the reader is entitled
     to and there is nothing left to soften. */
  const questionCard = (row: BankQuestion, depth = 0) => {
    /* QUEUE_20261002: a question held back on a live paper (set aside,
       rejected, or still being checked). The server sends no text, options
       or figure for it, so there is nothing to show but its number and a
       short note. No report chip: there is nothing to report yet. */
    if (row.held) {
      const heldNumber = resolveDisplayNumber(row.dn, displayNumbers.get(row.i), row.n);
      return <HeldQuestionCard key={row.i} id={row.i} number={heldNumber} depth={depth} />;
    }
    /* D66: the printed display_number, when the checker/admin has recorded
       one, wins over the client-derived a/b/c run lettering below -- it is a
       real fact about how the paper was numbered, not a guess from repeated
       raw numbers. Computed once so the body below can hide a leading
       repeat of the same number (owner: "the number lives in the number
       box only") without a second, possibly different, resolution. */
    const shownNumber = resolveDisplayNumber(row.dn, displayNumbers.get(row.i), row.n);
    return (
    <li
      key={row.i}
      id={`q-${row.i}`}
      /* D77: a sub-part ("5(a)") nests under its parent with an indent and a
         rule down its left edge, the same visual language paper-edit.tsx
         already uses for the checker's own nesting. depth is 0 for every
         top-level question, so this never changes today's layout for a
         paper with no parent_question_id at all. */
      style={depth > 0 ? { marginLeft: `${Math.min(depth, 3) * 16}px` } : undefined}
      className={`min-w-0 animate-card-blur-in rounded-[18px] bg-muted p-[16px] motion-reduce:animate-none${
        depth > 0 ? ' border-l-2 border-border pl-3' : ''
      }`}
    >
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {(() => {
          const shown = shownNumber;
          return shown ? (
            <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-brand-blue px-1.5 text-[12px] font-extrabold tabular-nums text-white">
              {shown}
            </span>
          ) : null;
        })()}
        {row.m !== null && !marksShownInText(row) && (
          <span className="rounded-full bg-card px-2 py-0.5 text-[12px] font-bold tabular-nums text-foreground shadow-border">
            {row.m} {row.m === 1 ? 'mark' : 'marks'}
          </span>
        )}
        {qtypeLabel(row.ty) && (
          <span className="rounded-full bg-card px-2 py-0.5 text-[12px] font-semibold text-warm-secondary shadow-border">
            {qtypeLabel(row.ty)}
          </span>
        )}
        {row.c && (
          <span className="rounded-full bg-brand-blue-subtle px-2 py-0.5 text-[12px] font-semibold text-brand-blue-deep">
            {row.c}
          </span>
        )}
        {/* D77: how long the pipeline suggests spending on THIS question --
            distinct from the paper's own allowed-time header. Most questions
            carry none, so this is gated the same way the marks pill is. */}
        {showSuggestedTime(row.stm) && (
          <span className="rounded-full bg-card px-2 py-0.5 text-[12px] font-semibold tabular-nums text-warm-secondary shadow-border">
            {row.stm} min
          </span>
        )}
        {/* D77: the printed label for this row's own place in an OR-group
            ("Either", a repeated question number) -- the "OR" divider between
            cards (below) is presentation; this is the paper's own word. */}
        {row.al && (
          <span className="rounded-full bg-brand-subtle px-2 py-0.5 text-[12px] font-semibold text-brand-deep">
            {row.al}
          </span>
        )}
        <DebugId label="question" value={row.i} />

        {/* Report, as one more chip on this line rather than a full-width
            "Something wrong here?" button under every question. Icon only
            until it is needed; the label and the field appear on tap.

            The name carries the question's own number. A 186-question paper
            put 186 buttons in the accessibility tree reading the identical
            string, so a screen reader's element list was 186 indistinguishable
            rows and there was no way to tell which one you were on. `title`
            tracks aria-label rather than staying fixed, which had given the
            expanded chip two different names at once. */}
        {(() => {
          const qLabel = questionNames.get(row.i) ?? '';
          const name = reportFor === row.i
            ? `Close report for question ${qLabel}`.trim()
            : `Report a problem with question ${qLabel}`.trim();
          return (
          <button
            type="button"
            id={`report-chip-${row.i}`}
            onClick={() => setReportFor((cur) => (cur === row.i ? '' : row.i))}
            aria-expanded={reportFor === row.i}
            aria-label={name}
            title={name}
            /* min-h-11/min-w-11 keeps the real tap target at the 44px
               floor while the painted chip stays chip-sized, the same
               trick ui/chip.tsx uses. */
            className={`relative ml-auto inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-full px-2 text-[12px] font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
              reportFor === row.i
                ? 'bg-brand-subtle text-brand-deep'
                : 'text-warm-label hover:bg-card hover:text-foreground'
            }`}
          >
            <Flag className="h-3.5 w-3.5" aria-hidden="true" />
            <FadeLabel show={reportFor === row.i}>Report</FadeLabel>
          </button>
          );
        })()}
      </div>

      {/* D66: question-level instructions ("Answer any three of the
          following"), printed above the question stem itself, as the source
          paper prints them. Distinct from the paper-level ones in the header
          above. */}
      {showQuestionInstructions(row.instr) && (
        <MathText
          text={row.instr as string}
          className="mb-1.5 text-[13px] italic leading-[1.5] text-warm-secondary"
        />
      )}

      <MathText
        text={displayBodyWithoutDuplicateNumber(row.t, shownNumber)}
        className="text-[15px] leading-[1.6] text-foreground"
      />

      {/* An MCQ without its choices is unanswerable, and 4,176 of them
          arrived with the History & Civics and Economics banks. The column
          has always been read into BankQuestion.o — nothing ever rendered
          it, which went unnoticed while the bank was maths-only.

          Deliberately NOT re-lettered. 81% of these options already carry
          their own label from the paper ("a. Dominion status", "(c) 1947"),
          so adding a/b/c/d here would print "a. a. Dominion status"; the
          remaining 19% have no label in the source, and inventing one would
          be writing paper data the paper does not have. The marker below is
          a dot — presentation, not a claim about how the paper numbered
          its choices. Text renders verbatim through MathText, same as the
          question stem. */}
      {row.o && row.o.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1">
          {row.o.map((opt, i) => (
            <li key={`${row.i}-opt-${i}`} className="flex gap-2">
              <span aria-hidden="true" className="mt-[9px] h-1 w-1 flex-none rounded-full bg-warm-label" />
              <MathText text={opt} className="text-[14px] leading-[1.55] text-warm-prose" />
            </li>
          ))}
        </ul>
      )}

      {/* After the stem and its options, not before them. It used to render
          directly under the meta line, so the DOM order was: chips, report
          form, "Send report", then the question you were being asked to
          describe a problem with. */}
      {reportFor === row.i && (
        <QuestionReport
          questionId={row.i}
          paperId={paper?.id ?? ''}
          onDone={() => {
            setReportFor('');
            /* Focus goes back to the chip that opened this. Without it the
               whole form unmounts under the focused button and focus falls to
               <body>, dropping a keyboard reader at the top of a 186-question
               document. */
            window.requestAnimationFrame(() => {
              document.getElementById(`report-chip-${row.i}`)?.focus();
            });
          }}
        />
      )}

      {row.f && (
        <figure className="mt-2.5">
          {/* width/height carry the intrinsic size so the browser reserves a
              correctly shaped box before the bytes arrive. Without them a
              figure-heavy paper shifts its text continuously as images load
              while the reader is scrolling through it, which is worse than a
              single shift at load. The CSS below still decides the rendered
              size; these only supply the aspect ratio.
              Generated by scripts/generate-figure-dimensions.ts, which reads
              the WebP headers directly rather than adding a native image
              dependency to a build whose logs we cannot read.
              Served from the paper-figures Storage bucket, not the deployed
              bundle -- see supabase/migrations/20260925130000_paper_figures_bucket.sql.
              getPublicUrl does no network call, just URL construction, so
              this costs nothing extra per card. */}
          <FigureImage
            src={supabase.storage.from('paper-figures').getPublicUrl(row.f).data.publicUrl}
            alt={`Figure for question ${resolveDisplayNumber(row.dn, displayNumbers.get(row.i), row.n) ?? ''}`}
            dims={figureDims?.[row.f]}
          />
        </figure>
      )}

    </li>
    );
  };

  if (failed) {
    return (
      <div className="flex min-h-screen flex-col bg-panel">
        <main id="main-content" className={`flex-1 ${CONTAINER} py-10`}>
          <p role="alert" className="text-[15px] text-white/80">This paper did not load. Check your connection and try again.</p>
          <button
            type="button"
            onClick={() => { setFailed(false); setLoading(true); setRetryTick((n) => n + 1); }}
            className="tap-44 mt-3 inline-flex items-center rounded-full bg-brand px-5 text-[15px] font-bold text-foreground"
          >
            Try again
          </button>
          <br />
          <Link to="/past-papers" className="mt-3 inline-flex min-h-11 items-center font-semibold text-brand-blue">
            Back to past papers
          </Link>
        </main>
      </div>
    );
  }

  /* Not found is the site's own 404 page, so an old or removed paper link
     reads like any other dead URL. Loading and error are handled above and
     below and never reach this line. */
  if (notFound) return <NotFound />;

  return (
    <div className="flex min-h-screen flex-col bg-panel">
      {/* ONLY the title bar is sticky.
          All three controls used to be stuck together, which measured 166px at
          every width tested — 20% of a phone viewport, and 37% at 200% zoom,
          leaving 284px for the paper. DESIGN_SYSTEM.md §11: "Sticky headers
          must be short. Max h-14 on mobile; the content is the point."
          Identity and the way back stay put at ~68px; the search field and the
          chapter rail scroll away, which is fine because both are things you
          reach for deliberately rather than mid-read. */}
      <div className="sticky top-0 z-40 bg-panel shadow-[inset_0_-1px_0_rgba(255,255,255,.10)]">
        <div className={`${CONTAINER} flex items-center gap-3 py-[12px]`}>
          <Link
            to="/past-papers"
            aria-label="Back to papers"
            className="flex h-11 w-11 flex-none items-center justify-center rounded-full text-white transition-colors duration-tap hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-panel"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10">
              <ArrowLeft size={17} strokeWidth={2.4} aria-hidden="true" />
            </span>
          </Link>

          {/* Both lines truncate, and at 320px the facts line loses most of
              itself ("17 chapters · Board Examination · 2018" cut to about a
              third). `title` gives the full value a way back. Most of it also
              reappears in the exam-header block below, which is why this is a
              tooltip rather than a layout change. */}
          <div className="min-w-0 flex-1">
            <h1
              className="flex items-center gap-1.5 truncate text-[14px] font-bold text-white"
              title={paper ? paperHeading : undefined}
            >
              <span className="truncate">
                {paper ? paperHeading : 'Past paper'}
              </span>
              {paper ? <DebugId label="paper" value={paper.id} /> : null}
            </h1>
            {facts.length > 0 && (
              <p className="truncate text-[12px] tabular-nums text-white/60" title={facts.join(' · ')}>
                {facts.join(' · ')}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Outside the sticky block, so these scroll away with the page. */}
      {(chapters.length > 1 || questions.length > 0) && (
        <div className="bg-panel">
          <div className={`${CONTAINER} pb-3`}>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3.5 top-1/2 h-[17px] w-[17px] -translate-y-1/2 text-white/40"
                aria-hidden="true"
              />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search in this paper"
                aria-label="Search in this paper"
                className="h-10 w-full rounded-full bg-white/10 pl-10 pr-4 text-base text-white placeholder:text-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-panel"
              />
            </div>
            {chapters.length > 1 && (
              /* overscroll-x-contain: this row starts flush with the physical
                 left edge on mobile (-mx-4 cancels the page's own padding), so
                 a scroll gesture starting right at "All" collides with the
                 browser's own edge-swipe-back gesture without this. */
              <div className="-mx-4 mt-2.5 overflow-x-auto overscroll-x-contain px-4 scrollbar-hide sm:mx-0 sm:px-0">
                <div className="flex w-max items-center gap-2">
                  {['All', ...chapters].map((t) => {
                    const on = (t === 'All' && !chapter) || chapter === t;
                    return (
                      <button
                        key={t}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setChapter(t === 'All' ? '' : t)}
                        className={`tap-44 flex h-9 flex-none items-center whitespace-nowrap rounded-full px-3.5 text-[13px] font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-panel ${
                          on ? 'bg-brand-blue text-white' : 'bg-white/10 text-white/85 hover:bg-white/20'
                        }`}
                      >
                        {t}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <main id="main-content" className={`flex-1 ${CONTAINER} pb-14 pt-4`}>
        {paper && !paper.needsReview && (
          <>
            <PaperDisclaimerDialog />
            <PaperShareLock paperTitle={paperTitle(paper)} />
            <CaptureShield />
            <DisclaimerStrip tone="dark" school={sourceName} isBoard={paper.isBoardPaper} />
          </>
        )}

        {/* RD-004 document surface: the questions are the sheet, lifted off the
            dark ground. It runs the full length of the paper rather than
            scrolling inside itself, so the page keeps one scrollbar. */}
        <div className="mt-4 rounded-xl bg-card p-4 shadow-[0_18px_40px_rgba(0,0,0,.45)] sm:p-6">
          {loading && (
            <div className="grid gap-3" aria-busy="true">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-[104px] animate-shimmer rounded-[18px] bg-muted bg-[length:200%_100%]" />
              ))}
            </div>
          )}

          {/* Coming soon: the paper is listed (is_published stays true — it
              was findable from a card, a search result or a direct link) but
              not open yet. No exam header, no question list, no withheld-
              questions lock -- there is genuinely nothing behind this but the
              audit note, matching "you can't actually open it" rather than
              a locked preview of content that isn't ready to show. */}
          {paper && paper.needsReview && (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
                <Clock size={22} strokeWidth={2} className="text-warm-label" aria-hidden="true" />
              </span>
              <h2 className="font-display text-[21px] font-extrabold tracking-[-0.03em] text-foreground">
                Coming soon
              </h2>
              <p className="max-w-[42ch] text-[14px] leading-[1.6] text-warm-prose">
                This paper is being audited to make sure the content is
                correct before it goes live. Check back soon.
              </p>
              <Link
                to="/past-papers"
                className="mt-1 inline-flex min-h-11 items-center rounded-full bg-brand-blue px-5 text-[14px] font-bold text-white transition-transform duration-tap hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue focus-visible:ring-offset-2 focus-visible:ring-offset-card"
              >
                Browse other papers
              </Link>
            </div>
          )}

          {/* Formal exam-header block, per your reference photo — centred
              school/course line, bold title, total marks and an "answer all
              questions" instruction, like the top of an actual printed
              paper, instead of the questions just starting cold. */}
          {paper && !paper.needsReview && (
            /* Owner's ask: a small settle moment at "first paper read" --
               the header and the question list below both mount once, the
               moment loading finishes, so a one-shot entrance here reads as
               the paper arriving rather than as decoration on every render
               (CRAFT §2: delight at success, not on every element). */
            <div className="mb-5 animate-card-blur-in border-b border-border pb-4 text-center motion-reduce:animate-none">
              {sourceName !== null && (
                <p className="text-[13px] italic text-muted-foreground">{sourceName}</p>
              )}
              <h2 className="mt-1 font-display text-[20px] font-extrabold tracking-[-0.02em] text-foreground sm:text-[23px]">
                {/* Middle dot, not an em dash -- CLAUDE.md bans em/en dashes in
                   site copy; · is this codebase's own standing separator
                   convention (used throughout the badge line right below). */}
                Class {paper.cls} {displaySubject} {paper.exam ? `· ${paper.exam}` : ''}
              </h2>
              {hasYear(paper.year) && (
                <p className="mt-0.5 text-[13px] tabular-nums text-muted-foreground">{paper.year}</p>
              )}
              <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[13px] font-semibold tabular-nums text-foreground">
                <span>{paper.questionCount} question{paper.questionCount === 1 ? '' : 's'}</span>
                {paper.marks > 0 && <span>Total: {paper.marks} marks</span>}
              </div>
              <p className="mt-2 text-[13px] uppercase tracking-[0.04em] text-muted-foreground">
                Answer all questions
              </p>
              {/* D66: allowed time and the paper's own general instructions,
                  when recorded -- most papers have neither, so both are
                  gated on presence rather than always taking up the header. */}
              {showPaperExtras(paper.allowedTimeMinutes, paper.generalInstructions) && (
                <div className="mt-3 flex flex-col items-center gap-1">
                  {paper.allowedTimeMinutes && (
                    <p className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
                      <Clock size={14} strokeWidth={2.2} aria-hidden="true" />
                      {paper.allowedTimeMinutes} minutes allowed
                    </p>
                  )}
                  {paper.generalInstructions && (
                    <MathText
                      text={paper.generalInstructions}
                      className="max-w-[48ch] text-[13px] leading-[1.5] text-warm-prose"
                    />
                  )}
                </div>
              )}
              {/* D66: a small, honest note when the source paper itself was
                  incomplete -- never a claim about the questions' quality. */}
              {showIncompleteNote(paper.incompleteNote) && (
                <p className="mt-2 text-[12px] italic leading-[1.5] text-muted-foreground">
                  {paper.incompleteNote}
                </p>
              )}
            </div>
          )}

          {paper && !paper.needsReview && visible.length > 0 && (
            /* data-paper-locked drives the print rule in index.css: Ctrl+P and
               "Save as PDF" render the page without the questions, so printing
               is not a way around the gate. Selection is off here and nowhere
               else on the page -- see paperLockClass. */
            <ol data-paper-locked data-protected className={`grid grid-cols-1 gap-3 stagger-children ${paperLockClass}`}>
              {renderNodes.map((node) => {
                if (node.kind === 'heading') {
                  /* D77: a printed section heading ("Section A"), shown once
                     above the first question of a run that carries it -- never
                     repeated per row, never shown for a paper with no
                     section_label at all. */
                  return (
                    <li key={node.key} className="mt-1 px-0.5 first:mt-0">
                      <h3 className="text-[12px] font-bold uppercase tracking-[0.06em] text-warm-label">
                        {node.label}
                      </h3>
                    </li>
                  );
                }
                if (node.kind === 'or') {
                  /* D77: the divider between OR-alternatives -- presentation
                     only, so it is hidden from assistive tech; the alt-group
                     label chip on each card (above) carries the actual words. */
                  return (
                    <li key={node.key} aria-hidden="true" className="flex items-center gap-2 py-0.5">
                      <span className="h-px flex-1 bg-border" />
                      <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-warm-label">OR</span>
                      <span className="h-px flex-1 bg-border" />
                    </li>
                  );
                }
                return questionCard(node.row, node.depth);
              })}
            </ol>
          )}

          {/* The lock.

              There is no blurred tail any more because there is no tail: the
              server sent only the preview questions and kept the rest. So this states the
              count from the paper's own question_count rather than pretending
              to show rows it does not have -- honest about what is behind it,
              and impossible to defeat by deleting a CSS filter.

              Hidden while filtering: "182 more questions" under a chapter
              search reads as a claim about the search, not about the paper. */}
          {paper && !paper.needsReview && withheld > 0 && !filtering && (
            <div className="mt-3 rounded-[18px] bg-brand-blue-subtle px-4 py-5 text-center">
              <p className="text-[17px] font-extrabold tracking-[-0.03em] text-foreground">
                {withheld} more {withheld === 1 ? 'question' : 'questions'} in this paper
              </p>
              <p className="mx-auto mt-1 max-w-[34ch] text-[14px] leading-[1.5] text-warm-prose">
                Reading the rest is free. It just needs an account, so we can
                keep your place across papers.
              </p>
              <button
                type="button"
                onClick={() => setGateOpen(true)}
                className="mt-3 inline-flex min-h-11 items-center justify-center rounded-full bg-brand-blue px-5 text-[14px] font-bold text-white transition-transform duration-tap hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue focus-visible:ring-offset-2 focus-visible:ring-offset-card"
              >
                Sign in to read all {paper?.questionCount ?? questions.length}
              </button>
            </div>
          )}


          {paper && !paper.needsReview && visible.length === 0 && !loading && (
            /* A signed-out reader is searching the preview questions, not the paper,
               so "nothing matches" would be a false negative on a paper that
               does contain the word. Say which haystack was actually searched. */
            <p className="text-[15px] text-warm-prose">
              {withheld > 0
                ? `No match in the ${searchableCount(questions)} free questions. The other ${withheld} are behind a free account.`
                : 'Nothing in this paper matches that.'}
            </p>
          )}
        </div>

        {paper && !paper.needsReview && (
          <div className="mt-4 rounded-[24px] bg-brand p-[18px]">
            <p className="text-[17px] font-extrabold tracking-[-0.03em] text-foreground">
              Stuck on one of these?
            </p>
            {/* Was hardcoded to Maths in both the label and the href, which
                sent a reader of a History & Civics paper to maths teachers.
                The route is resolved from SUBJECT_PATH_TO_FILTER (the same
                table the subject pages themselves are built from) so the
                link can only ever point at a route that exists; anything
                without its own page falls back to the filtered browse. */}
            <Link
              to={subjectTeacherPath(paper.subject)}
              className="mt-3 inline-flex h-[46px] items-center rounded-full bg-panel px-5 text-[14px] font-bold text-card transition-transform duration-tap hover:-translate-y-0.5 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Find {displaySubject} teachers
            </Link>
          </div>
        )}

        {paper && <MorePapers items={siblings} currentId={paper.id} />}
      </main>

      {/* The canonical papers sign-in sheet, already built for exactly this
          and unused until now. Named the specific paper rather than prompting
          generically, per its own rule 4. */}
      <GateSheet
        open={gateOpen}
        onOpenChange={setGateOpen}
        flavor="papers"
        redirectTo={`/past-papers/${id ?? ''}`}
        paperTitle={paper ? [sourceName, `Class ${paper.cls} ${displaySubject}`].filter(Boolean).join(' ') : null}
        paperSubject={displaySubject || "Maths"}
      />

      <Footer seamFill="panel" />
    </div>
  );
}
