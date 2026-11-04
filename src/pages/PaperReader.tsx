import { useEffect, useMemo, useRef, useState } from 'react';
import { recordPaperSubject } from '@/lib/activity-trail';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink, Lock, Maximize2, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { EmptyResults } from '@/components/EmptyResults';
import { usePageMeta } from '@/hooks/usePageMeta';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth-context';
import { getSubjectPalette } from '@/lib/subject-palette';
import { recordVisit } from '@/lib/recently-visited';
import { GateSheet } from '@/components/auth/gate-sheet';
import { setAuthIntent } from '@/lib/auth-intent';
import { DisclaimerStrip } from '@/components/papers/disclaimer-strip';
import { PaperDisclaimerDialog } from '@/components/papers/paper-disclaimer-dialog';
import { MorePapers } from '@/components/papers/more-papers';
import { generateBreadcrumbSchema } from '@/utils/structuredDataGenerators';
import { injectSchemas } from '@/utils/injectSchemas';
import { reportLoadError } from '@/lib/load-error';
import { fileStateFrom, isShareDismissed, siblingNeighbours, type FileState } from '@/lib/paper-reader-helpers';

// No file_url here: papers.file_url is no longer anon-selectable at all
// (column-level REVOKE, migration 20260909000003_gate_paper_file_url.sql).
// Fetched separately, only once signed in, through paper_file_url() — see
// the `fileUrl` state below.
interface Paper {
  id: string;
  title: string;
  school: string;
  subject: string;
  class: string;
  board: string;
  exam_type: string;
  year: number;
}

const PAPER_COLUMNS = 'id,title,school,subject,class,board,exam_type,year,is_published';

interface SiblingPaper {
  id: string;
  title: string;
  year: number;
}

const CONTAINER = 'mx-auto w-full max-w-5xl px-4 sm:px-6 lg:px-8';
const SKELETON = 'bg-gradient-to-r from-muted via-background to-muted bg-[length:200%_100%] animate-shimmer';
const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';
/* Same ring, offset against the dark reader ground instead of the page bone. */
const FOCUS_DARK =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-panel';

/**
 * NOTE on scope vs. the design_handoff spec (pages/PaperReader.md):
 *
 * The spec was written against a prototype that has per-question structured
 * content (sections, numbered questions, sub-parts, MCQ options, tables,
 * figures) and a "show question 1 free, then lock" gate. The real `papers`
 * table (supabase/migrations/20260812000001_create_papers_table.sql) has no
 * such structure — a paper is just metadata plus one `file_url` pointing at
 * an admin-uploaded PDF in the public `paper-files` bucket. There is also no
 * reading-history table and no per-user free-read-allowance table.
 *
 * Rather than fabricate fake section/question markup (which would misrepresent
 * a real school's actual paper — the one thing this screen is explicitly
 * warned not to do), this implementation:
 *  - Renders the real PDF in-page via an iframe with the native toolbar
 *    suppressed (no target=_blank, no download link surfaced by us).
 *  - Gates the entire body for signed-out visitors instead of a literal
 *    "question 1 free" partial reveal, since a flat PDF has no question
 *    boundary to reveal to. No iframe `src` is rendered in the DOM for a
 *    signed-out visitor.
 *  - Omits the "{n} questions remaining" pill and the rail's per-question
 *    index grid, since both require question-level data that doesn't exist
 *    (an invented count would violate the "live Supabase data, never
 *    fabricated" rule harder than omitting it does).
 *  - Ships NO reading-progress indicator. There used to be one: a bar across
 *    the top of the page fed by window scroll across the paper-body card's
 *    bounding box. It was a lie. The card is a single fixed-height block, so
 *    the bar hit ~100% the moment that block scrolled past the viewport,
 *    whether the student had read one page or forty — and the PDF renders in
 *    the browser's native (often cross-origin) viewer whose internal scroll
 *    position is not readable, so nothing honest could be computed from the
 *    page at all. Rather than dress a fake number up as a smaller fake number,
 *    it is gone. The viewer instead offers real controls (full screen, open in
 *    a new tab) which are the things a student actually wanted when they
 *    reached for the scrollbar on a phone.
 *  - Deliberately does NOT imply "continue reading" / reading history exists
 *    (VISUAL_DIRECTION §9.2): there is no reading-progress table in the DB.
 *  - Reading a paper NOW records to history: paper_reads exists (migration
 *    20260818140000) and this file upserts a row on open for a signed-in
 *    reader. What it records is an OPEN, not a finish — see the effect below
 *    for why a finish is not observable here.
 */

export default function PaperReader() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  const [paper, setPaper] = useState<Paper | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  // Separate from fileUrl so "still asking" and "asking failed" never read as
  // "this paper has no file".
  const [fileState, setFileState] = useState<FileState>('loading');
  const [fileTick, setFileTick] = useState(0);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [siblings, setSiblings] = useState<SiblingPaper[]>([]);
  const [openedAt] = useState(() => new Date());
  const viewerRef = useRef<HTMLDivElement>(null);
  const [gateOpen, setGateOpen] = useState(false);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    async function fetchPaper() {
      setLoading(true);
      setNotFound(false);
      setLoadError(false);
      try {
        const { data, error } = await supabase.from('papers').select(PAPER_COLUMNS).eq('id', id).maybeSingle();
        if (error) throw error;
        if (cancelled) return;
        if (!data) {
          setNotFound(true);
        } else {
          setPaper(data as Paper);
        }
      } catch {
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchPaper();
    return () => { cancelled = true; };
  }, [id, retryTick]);

  /* Record that this reader opened this paper.
   *
   * The note above explains why there is no reading-progress indicator: the PDF
   * renders in a cross-origin viewer whose scroll position cannot be read, so
   * "reached the last page" is not observable from here. The spec advances the
   * weekly goal on the last page; that trigger does not exist, so this records
   * the event that IS real — the paper was opened — rather than inferring a
   * finish that was never detected.
   *
   * That is also the spec's own vocabulary elsewhere: account-04's student
   * dashboard counts "Papers opened", not papers finished.
   *
   * Signed-in only, because RLS scopes a row to its owner and an anonymous
   * reader has no owner. Unique on (user, paper), so re-opening the same paper
   * does not inflate anything; the conflict is ignored rather than treated as
   * an error. Fire-and-forget: a failed insert must never interrupt reading.
   */
  useEffect(() => {
    if (!paper || !user) return;
    void supabase
      .from('paper_reads')
      .upsert({ user_id: user.id, paper_id: paper.id }, { onConflict: 'user_id,paper_id', ignoreDuplicates: true })
      .then(({ error }) => {
        if (error && import.meta.env.DEV) console.warn('paper_reads upsert failed:', error.message);
      });
  }, [paper, user]);

  /* Sibling papers (same subject/class/board) — feeds the signed-in prev/
     next rail AND the "more papers like this" section at the bottom, which
     is NOT signed-in gated: title/year are already public metadata (the
     anon column grant on `papers` covers them), so unlike file_url there is
     nothing here worth withholding from a visitor who hasn't signed in. */
  useEffect(() => {
    if (!paper) { setSiblings([]); return; }
    let cancelled = false;
    async function fetchSiblings() {
      const { data, error } = await supabase
        .from('papers')
        .select('id,title,year')
        .eq('is_published', true)
        .eq('subject', paper.subject)
        .eq('class', paper.class)
        .eq('board', paper.board)
        .order('year', { ascending: false })
        .order('title', { ascending: true })
        .limit(50);
      if (!cancelled && error) reportLoadError('paper.siblings', error, { what: 'the other papers in this set' });
      if (!cancelled && data) setSiblings(data as SiblingPaper[]);
    }
    fetchSiblings();
    return () => { cancelled = true; };
  }, [paper]);

  /* Feeds H-005 branch 5 ("Two papers open in ICSE Physics. Want a tutor for
     it?"). Separate from recordVisit below: that one is the Recently-visited
     rail's per-item history, this is the one board+subject pair the hero
     greets you with. */
  useEffect(() => {
    if (!paper) return;
    recordPaperSubject({ board: paper.board, subject: paper.subject });
  }, [paper]);

  // Record this visit for the home page's "Recently visited" section
  // (device-local only, see src/lib/recently-visited.ts).
  useEffect(() => {
    if (!paper) return;
    recordVisit({
      type: 'paper',
      id: paper.id,
      title: paper.title,
      subtitle: `${paper.subject} · ${paper.school}`,
      path: `/past-papers/${paper.id}`,
    });
  }, [paper?.id]);

  usePageMeta(
    // Suffix was " | Shikshaq Past Papers" (23 chars) vs. every other route's
    // " | Shikshaq" (11 chars) — on real data this pushed titles to 67-74+
    // chars, well past the point Google truncates in the SERP (measured live:
    // "Mathematics Prelim Paper 1 | La Martiniere for Boys | Shikshaq Past
    // Papers" = 74 chars). paper.title/paper.school are real, variable-length
    // data that shouldn't be truncated blind, so this only trims the one part
    // that's actually fixed, saving 12 chars on every paper page.
    paper ? `${paper.title} | ${paper.school} | Shikshaq` : 'Past paper | Shikshaq',
    paper ? `${paper.subject} Class ${paper.class} ${paper.board} paper from ${paper.school}, shared free on Shikshaq.` : 'Read a free past year question paper on Shikshaq.'
  );

  // This page had zero structured data despite being the one route with real
  // per-item educational content (title, subject, board, class, year) —
  // LearningResource is schema.org's type for exactly this. Breadcrumb mirrors
  // the pattern already used on SchoolPage/TeacherProfile.
  useEffect(() => {
    if (!paper) return;
    injectSchemas([
      {
        '@context': 'https://schema.org',
        '@type': 'LearningResource',
        name: paper.title,
        description: `${paper.subject} Class ${paper.class} ${paper.board} paper from ${paper.school}.`,
        educationalLevel: paper.class,
        about: paper.subject,
        provider: { '@type': 'Organization', name: 'Shikshaq', url: 'https://www.shikshaq.in' },
        dateCreated: String(paper.year),
      },
      generateBreadcrumbSchema([
        { name: 'Home', url: '/' },
        { name: 'Past papers', url: '/past-papers' },
        { name: paper.title, url: `/past-papers/${paper.id}` },
      ]),
    ]);
    return () => {
      const existing = document.getElementById('page-schemas');
      if (existing) existing.remove();
    };
  }, [paper]);

  // Full-screen the viewer shell (not the iframe itself, so the watermark
  // layer above it travels with it). Presentation only — no data, no history.
  function openFullScreen() {
    const el = viewerRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  }

  // Siblings are newest first; previous is the older paper, next the newer.
  const { previous: prevPaper, next: nextPaper } = useMemo(() => siblingNeighbours(siblings, id), [siblings, id]);

  const signedIn = !authLoading && !!user;
  // Whether there's anything to put in the rail column at all. Drives
  // whether the two-column grid renders — without this, a signed-in reader
  // with no sibling papers (or a signed-out visitor) gets an empty second
  // column and the same lopsided "dead space on the right" layout this file
  // was fixed to avoid.
  const hasRail = signedIn && !!(prevPaper || nextPaper);

  // Opens the gate sheet automatically once we know the visitor is signed
  // out and the paper metadata (not the file) has resolved — design.md §6.5:
  // "never fetch the paper before auth". file_url only ever reaches the DOM
  // in the `signedIn` branch below.
  useEffect(() => {
    if (!loading && !authLoading && paper && !signedIn) {
      /* Handoff AU-004a: variant D's hero, so /auth names the paper the
         visitor was actually trying to open. Set alongside the gate, not
         instead of it — the gate's own behaviour is unchanged. */
      setAuthIntent({
        kind: 'paper',
        title: paper.title ?? '',
        board: paper.board ?? '',
        school: paper.school ?? '',
        subjectSlug: paper.subject ?? '',
      });
      setGateOpen(true);
    } else setGateOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, authLoading, !!paper, signedIn]);

  // The file itself, fetched separately and only once actually signed in —
  // this IS "never fetch the paper before auth" (the comment above already
  // named the rule; this effect is what now actually enforces it). Reads
  // through paper_file_url(), which returns null server-side to a
  // signed-out caller regardless of what's asked for, so there is nothing
  // client-side that could request it early.
  useEffect(() => {
    if (!paper || !signedIn) { setFileUrl(null); setFileState('loading'); return; }
    let cancelled = false;
    setFileState('loading');
    supabase.rpc('paper_file_url', { p_paper_id: paper.id }).then(({ data, error }) => {
      if (cancelled) return;
      const state = fileStateFrom({ data: (data as string | null) ?? null, error });
      if (error) {
        reportLoadError('paper.file', error, { what: "this paper's file", retry: () => setFileTick((t) => t + 1) });
      }
      setFileUrl(state === 'ready' ? (data as string) : null);
      setFileState(state);
    });
    return () => { cancelled = true; };
  }, [paper, signedIn, fileTick]);

  // Share the real paper URL — the path of least resistance for passing a
  // paper along should be "share the link", not a screenshot. No website can
  // actually block OS-level screenshots/screen recording, so this is
  // deterrence-by-convenience, not enforcement: give the easy option and let
  // it win on its own merits.
  async function handleShare(p: Paper) {
    const shareUrl = `${window.location.origin}/past-papers/${p.id}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: p.title, url: shareUrl });
        return;
      } catch (err) {
        // They closed the share sheet on purpose: nothing was wrong, so do not
        // copy to the clipboard or announce "Link copied" behind their back.
        if (isShareDismissed(err)) return;
        // Anything else (no share target, blocked): fall through to clipboard.
      }
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success('Link copied');
    } catch {
      toast.error(`Could not copy the link. Copy it from here: ${shareUrl}`);
    }
  }

  const colors = paper ? getSubjectPalette(paper.subject) : null;

  // ---------------- Loading shell ----------------
  if (loading || authLoading) {
    return (
      /* Dark ground here too, so there is no light-to-dark flash before the
         S5 reader paints. */
      <div className="flex min-h-screen flex-col bg-panel">
        <main className={`flex-1 ${CONTAINER} pb-16 pt-6`}>
          <div className={`mb-4 h-4 w-32 rounded-lg ${SKELETON}`} />
          <div className={`mb-3 h-6 w-72 max-w-full rounded-full ${SKELETON}`} />
          <div className={`h-12 w-3/4 max-w-xl rounded-lg ${SKELETON}`} />
          <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-[2fr,1fr] sm:gap-8">
            <div className={`h-96 rounded-2xl ${SKELETON}`} />
            <div className={`h-56 rounded-2xl ${SKELETON}`} />
          </div>
        </main>
      </div>
    );
  }

  // ---------------- Not found / error ----------------
  if (notFound || loadError || !paper) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <main className={`flex-1 ${CONTAINER} pb-16 pt-8`}>
          <Link
            to="/past-papers"
            className="mb-[18px] inline-flex min-h-11 items-center text-sm font-semibold text-muted-foreground transition-colors duration-tap hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            ← Back to papers
          </Link>
          <EmptyResults
            heading={loadError ? 'Unable to load this paper right now' : "This paper isn't available"}
            message={loadError ? 'Check your connection and try again.' : "It may have been removed, or the link is incorrect. It's still free to browse the rest of the collection."}
            action={loadError ? { label: 'Try again', onClick: () => setRetryTick((n) => n + 1) } : { label: 'Browse past papers', onClick: () => navigate('/past-papers') }}
          />
        </main>
      </div>
    );
  }

  return (
    /* S5: the reader is a dark immersive screen — the near-black panel token
       as ground, compact header bar, dark disclaimer strip, the paper itself
       the only light surface on the page. */
    <div className="flex min-h-screen flex-col bg-panel">
      {/* The fake reading-progress bar that used to sit here is gone on
          purpose — see the file-level note. Nothing replaces it: an honest
          "you are viewing this paper" indicator is what the page title
          already is. */}
{/* S5 header bar: padding 14px 16px, gap 12px, 1px white/10% bottom
          hairline; 36px round back disc; 14px/700 title; 11.5px white/60%
          meta. The old light hero band (subject signpost + pill row +
          page-title h1) is replaced by this, per "mockup wins" — but every
          field it carried (class, board, exam type, year) is preserved in
          the meta line below so no data is dropped. */}
      {/* Handoff RD-002: ring, not a border. */}
      <header className="pr-hide-print shadow-[inset_0_-1px_0_rgba(255,255,255,.10)]">
        <div className={`${CONTAINER} flex items-center gap-3 py-[14px]`}>
          <Link
            to="/past-papers"
            aria-label="Back to papers"
            className={`flex h-11 w-11 flex-none items-center justify-center rounded-full text-white transition-colors duration-tap ease-tap hover:bg-white/20 focus-visible:ring-offset-panel ${FOCUS}`}
          >
            {/* Mockup draws a 36px disc; the visual stays 36px and the 44px
                floor is met by the surrounding tap target. */}
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10">
              <ArrowLeft size={17} strokeWidth={2.4} aria-hidden="true" />
            </span>
          </Link>

          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[14px] font-bold text-white">{paper.title}</h1>
            {/* Wraps rather than ellipsis-clipping: the mockup truncates this
                line, but clipping would hide real metadata on a 390px screen. */}
            <p className="text-[12px] tabular-nums text-white/60">
              {paper.school} · {paper.board} Class {paper.class} · {paper.exam_type} · {paper.year}
            </p>
          </div>

          <button
            type="button"
            onClick={() => void handleShare(paper)}
            aria-label="Share this paper"
            className={`flex h-11 w-11 flex-none items-center justify-center rounded-full text-white transition-colors duration-tap ease-tap hover:bg-white/20 focus-visible:ring-offset-panel ${FOCUS}`}
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10">
              <Share2 size={16} strokeWidth={2.2} aria-hidden="true" />
            </span>
          </button>
        </div>
      </header>

      {/* F4 — permanent strip under the header, regardless of sign-in state.
          School name is per-paper data, never static copy. Deliberately NOT
          .pr-hide-print: this carries the copyright notice, so if a visitor
          does print the page (Ctrl+P bypasses no client-side control), the
          copyright/attribution line should still be there — only the document
          viewport itself is withheld from print, further down. */}
      <div>
        <PaperDisclaimerDialog />
        <DisclaimerStrip tone="dark" school={paper.school} />
      </div>

      <main className={`flex-1 ${CONTAINER} pb-16 pt-4`}>

        {/* Only true once there IS an account to watermark with — this used to
            render for signed-out visitors too, where it was simply false. */}
        {signedIn && (
          <div className="pr-hide-print mt-3 flex items-center gap-2 text-[12px] text-white/60">
            <Lock size={14} strokeWidth={2} aria-hidden="true" />
            This page is watermarked with your account and the time you opened it.
          </div>
        )}

        <div
          className={`pr-hide-print mt-4 ${
            hasRail
              ? 'grid grid-cols-1 gap-6 sm:grid-cols-[2fr,1fr] sm:gap-8'
              : `mx-auto grid grid-cols-1 ${signedIn ? 'max-w-3xl' : 'max-w-2xl'}`
          }`}
        >
          {/* ---------------- Paper body ---------------- */}
          {/* S5: the paper is the one light surface on the dark ground —
              radius 12px, no hairline (the mockup separates it with a drop
              shadow against the dark panel, not a border). */}
          <div
            /* Handoff RD-004: radius unchanged (12px) — this is not a bento
               panel — plus a lift shadow so it reads as the one lit surface
               on the dark ground. */
            className={`${signedIn ? 'p-3 pb-0 sm:p-4 sm:pb-0' : 'p-0'} relative select-none overflow-hidden rounded-xl bg-card shadow-[0_18px_40px_rgba(0,0,0,.45)]`}
            onContextMenu={(e) => e.preventDefault()}
            onCopy={(e) => e.preventDefault()}
          >
            {signedIn ? (
              fileUrl ? (
                <>
                  {/* Viewer controls. The embedded native PDF viewer's pinch-zoom
                      is unreliable on mobile Safari and there is no custom
                      zoom/pagination here (adding a JS PDF renderer is out of
                      scope), so the honest fix is to give the student a way OUT
                      of the embed: full screen, or the browser's own viewer in a
                      new tab where zoom and page controls actually work.
                      `fileUrl` only exists in this component's state once
                      paper_file_url() has actually returned it to a signed-in
                      caller — see the effect above. The underlying storage
                      bucket is still public if you already have the URL (a
                      residual gap, not this fix's job to close), but nothing
                      here hands it to a visitor who never signed in. */}
                  {/* Handoff RD-005: one h48 r999 bg-white/10 track. The
                     entry's −/percentage/+ zoom group isn't built: this
                     embed has no custom zoom (the file's own top-of-file
                     note explains why — the native viewer's zoom is used
                     instead, and adding a JS PDF renderer to get a real
                     zoom control is out of scope) — a non-functional zoom
                     readout would be dishonest UI, so the track keeps the
                     two real actions instead. "Open in a new tab" ->
                     "Open full PDF", restyled indigo per the entry. */}
                  <div className="mb-3 flex h-12 w-fit items-center gap-1 rounded-full bg-white/10 p-1">
                    <button
                      type="button"
                      onClick={openFullScreen}
                      className={`tap-44 flex h-9 items-center gap-2 rounded-full px-4 text-[13px] font-semibold text-white transition-colors duration-tap ease-tap hover:bg-white/10 active:scale-[0.97] ${FOCUS_DARK}`}
                    >
                      <Maximize2 className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                      Full screen
                    </button>
                    <a
                      href={fileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`tap-44 flex h-9 items-center gap-2 rounded-full bg-brand-blue px-4 text-[13px] font-bold text-white transition-colors duration-tap ease-tap hover:bg-brand-blue-hover active:scale-[0.97] ${FOCUS_DARK}`}
                    >
                      <ExternalLink className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                      Open full PDF
                    </a>
                  </div>

                  {/* Taller than the old fixed 78vh on phones, and sized in dvh
                      so the mobile URL bar collapsing doesn't clip the page. */}
                  <div
                    ref={viewerRef}
                    className="relative h-[78dvh] min-h-96 overflow-hidden rounded-lg bg-background"
                  >
                    <iframe
                      title={paper.title}
                      src={`${fileUrl}#toolbar=0&navpanes=0&view=FitH`}
                      className="h-full w-full border-0"
                    />
                    {/* Watermark layer: absolute, decorative, pointer-events none so
                        the iframe underneath stays fully interactive (scroll/zoom). */}
                    <div className="pointer-events-none absolute inset-0 z-[2] overflow-hidden" aria-hidden="true">
                      <div className="absolute -left-20 -top-20 flex flex-col gap-6 [transform:rotate(-24deg)_scale(1.7)]">
                        {Array.from({ length: 14 }).map((_, i) => (
                          <span
                            key={i}
                            className="block whitespace-nowrap font-mono text-label font-semibold text-foreground/[.075]"
                            style={{ marginLeft: (i % 3) * 40 }}
                          >
                            {(user?.email || 'shikshaq')} · {openedAt.toLocaleString('en-IN')}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </>
              ) : fileState === 'loading' ? (
                <div className="pb-4" role="status" aria-label="Loading the paper">
                  <div className={`h-12 w-48 rounded-full ${SKELETON}`} />
                  <div className={`mt-3 h-[60dvh] min-h-80 rounded-lg ${SKELETON}`} />
                </div>
              ) : fileState === 'error' ? (
                <div className="pb-6">
                  <EmptyResults
                    className="bg-transparent shadow-none"
                    heading="Couldn't load this paper"
                    message="The paper is here but its file did not come through. Check your connection and try again."
                    action={{ label: 'Try again', onClick: () => setFileTick((t) => t + 1) }}
                  />
                </div>
              ) : (
                <div className="pb-6">
                  <EmptyResults
                    className="bg-transparent shadow-none"
                    heading="This paper's file hasn't been uploaded yet"
                    message="The listing is here but the PDF itself is still missing. Check back soon."
                    action={{ label: 'Browse other papers', onClick: () => navigate('/past-papers') }}
                  />
                </div>
              )
            ) : (
              // Signed-out: no file_url ever reaches the DOM here. design.md
              // §6.5 — the gate is a bottom sheet over a BLURRED page, not a
              // full inline wall. This is the blurred page: real paper meta
              // (title/subject/school), no PDF, `select-none` + blur so
              // nothing behind the sheet is actually readable.
              <div className="relative overflow-hidden rounded-2xl">
                <div aria-hidden className="pointer-events-none select-none blur-md" style={{ backgroundColor: colors?.tint }}>
                  <div className="flex h-[60dvh] min-h-80 flex-col justify-end p-6 sm:p-12">
                    <span
                      className="mb-3 inline-flex w-fit items-center rounded-full px-3 py-1 text-label font-bold uppercase"
                      style={{ backgroundColor: colors?.solid, color: colors?.badgeText }}
                    >
                      {paper.subject}
                    </span>
                    <span className="block h-6 w-3/4 rounded bg-foreground/10" />
                    <span className="mt-3 block h-4 w-1/2 rounded bg-foreground/10" />
                    <span className="mt-8 block h-3 w-full rounded bg-foreground/10" />
                    <span className="mt-2 block h-3 w-full rounded bg-foreground/10" />
                    <span className="mt-2 block h-3 w-2/3 rounded bg-foreground/10" />
                  </div>
                </div>

                <div className="absolute inset-0 flex items-center justify-center bg-foreground/10 p-4">
                  <button
                    type="button"
                    onClick={() => setGateOpen(true)}
                    className={`flex min-h-12 items-center gap-2 rounded-full bg-brand-blue px-8 text-body font-semibold text-white shadow-glow-brand-blue transition-transform duration-tap ease-tap hover:-translate-y-0.5 active:scale-[0.97] motion-reduce:hover:translate-y-0 ${FOCUS}`}
                  >
                    <Lock className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
                    Sign in to read this paper
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ---------------- Rail ---------------- */}
          {/* The old redundant "shared for personal study only" note card is
              gone: it restated the disclaimer strip already pinned under the
              header (same "don't redistribute" / "schools can request
              removal" points), just competing for attention from a
              disconnected floating position instead of reinforcing it. One
              clear disclaimer beats two half-attended ones. What's left in
              the rail is real navigation, so it only renders when there's
              actually something to navigate to — no more empty rail column
              leaving dead space next to a signed-out visitor's blurred
              preview. */}
          {signedIn && (prevPaper || nextPaper) && (
            <div className="pr-rail grid gap-2">
              {/* Route markers along the same stretch of road: the previous
                  and next paper in this subject/class/board run. This is
                  sibling navigation, NOT reading history — nothing here
                  claims the student has read anything (VISUAL_DIRECTION
                  §9.2). */}
              {/* Handoff RD-007: radius 16->20, fill white/.06->white/.07,
                  py-3->py-[14px], label 50% white (was the indigo link tone). */}
              {prevPaper && (
                <Link
                  to={`/past-papers/${prevPaper.id}`}
                  className={`flex min-h-11 flex-col justify-center rounded-[20px] bg-white/[.07] px-4 py-[14px] transition-colors duration-tap ease-tap hover:bg-white/10 ${FOCUS_DARK}`}
                >
                  <span className="block text-[12px] font-bold uppercase tracking-[.04em] text-white/50">← Previous</span>
                  <span className="mt-1 block break-words text-[14px] font-semibold tabular-nums text-white">{prevPaper.title} ({prevPaper.year})</span>
                </Link>
              )}
              {nextPaper && (
                <Link
                  to={`/past-papers/${nextPaper.id}`}
                  className={`flex min-h-11 flex-col justify-center rounded-[20px] bg-white/[.07] px-4 py-[14px] transition-colors duration-tap ease-tap hover:bg-white/10 ${FOCUS_DARK}`}
                >
                  <span className="block text-[12px] font-bold uppercase tracking-[.04em] text-white/50">Next →</span>
                  <span className="mt-1 block break-words text-[14px] font-semibold tabular-nums text-white">{nextPaper.title} ({nextPaper.year})</span>
                </Link>
              )}
            </div>
          )}
        </div>

        {/* Handoff RD-008: the one orange object on this page — new, this
            block didn't exist before. Copy is subject-scoped, built from the
            paper's own subject, never hardcoded. */}
        <div className="pr-hide-print mt-6 rounded-[24px] bg-brand p-[18px]">
          <p className="font-display text-[17px] font-extrabold tracking-[-0.03em] text-[#1F1F1F]">
            Need a tutor for {paper.subject}?
          </p>
          <Link
            to={`/all-tuition-teachers-in-kolkata?filter_subjects=${encodeURIComponent(paper.subject)}`}
            className={`mt-3 inline-flex h-[46px] items-center rounded-full bg-panel px-5 text-[15px] font-bold text-[#FCFAF7] transition-transform duration-tap ease-tap hover:-translate-y-0.5 active:scale-[0.97] ${FOCUS_DARK}`}
          >
            Browse {paper.subject} teachers
          </Link>
        </div>

        <MorePapers items={siblings} currentId={paper.id} />
      </main>

      <GateSheet
        open={gateOpen}
        onOpenChange={setGateOpen}
        redirectTo={`/past-papers/${id}`}
        flavor="papers"
        paperTitle={paper?.title ?? null}
        paperSubject={paper?.subject ?? null}
      />

      <style>{`
        @media print {
          /*
           * NOTE: .pr-hide-print is applied to the grid wrapping the paper
           * body (including the iframe) further up, so Ctrl+P no longer
           * renders the PDF itself, not just the chrome around it. This is
           * still only a client-side print stylesheet, not real access
           * control on its own — but the URL it's hiding is no longer
           * reachable by a signed-out visitor at all (paper_file_url() RPC,
           * migration 20260909000003_gate_paper_file_url.sql), so what's
           * left is narrower than it was: once someone has genuinely signed
           * in and been handed the URL, it's still a plain public Supabase
           * storage bucket link, reusable/downloadable outside this page.
           * Closing that residual gap needs short-lived signed URLs and/or
           * an authenticated proxy endpoint that streams the PDF instead of
           * exposing a bucket URL at all — out of this page's scope.
           */
          .pr-hide-print { display: none !important; }
        }
        .pr-rail {
          position: sticky;
          top: 96px;
          align-self: start;
        }
        @media (max-width: 700px) {
          .pr-rail { position: static; top: auto; }
        }
      `}</style>
    </div>
  );
}
