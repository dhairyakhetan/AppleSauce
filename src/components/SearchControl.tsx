import { useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Search, GraduationCap, ChevronDown, Clock, ArrowRight, X,
  BookOpen, MapPin, Landmark, School as SchoolIcon,
} from 'lucide-react';
import {
  SUBJECTS, CLASSES, BOARDS, AREAS,
  TEACHER_FACET_KEYS, PAPER_FACET_KEYS, FACET_LABELS,
  type SearchMode, type FacetKey,
} from '@/utils/searchFacets';
import { useSearchIndex, type TeacherHit, type PaperHit } from '@/hooks/useSearchIndex';
import { useExitPresence } from '@/hooks/useExitPresence';
import { useMediaQuery } from '@/hooks/use-mobile';
import { useIntent } from '@/lib/intent-context';
import { recordSignal } from '@/lib/intent/signals';
import { suggestedSearches } from '@/lib/intent/copy';
import { extractFiltersFromQuery } from '@/utils/searchKeywordExtractor';
import { parsePaperQuery } from '@/lib/paper-query';
import { getRecentSearches, addRecentSearch, type RecentSearch } from '@/utils/recentSearches';
import { setSearchExpanded } from '@/hooks/useSearchExpanded';
import { isMeteredConnection } from '@/lib/net-conditions';
import { displaySchool, rawSchoolsFor } from '@/lib/school-display';

type Selections = Record<FacetKey, string[]>;

const EMPTY_SELECTIONS: Selections = { subject: [], cls: [], area: [], board: [], school: [] };

/* 'Past papers', not 'Papers' -- the handoff labels this tab in full, and it
   matches the nav and the footer toggle, which already said 'Past papers'.
   The two read as different destinations when they are the same one. */
const MODE_LABEL: Record<SearchMode, string> = { teachers: 'Teachers', papers: 'Past papers' };

const POPULAR: Record<SearchMode, string[]> = {
  teachers: ['Maths near Ballygunge', 'Physics Class 10', 'ICSE teachers', 'Online tuition', 'Class 12 Chemistry'],
  papers: ['ICSE Class 10 Maths', 'CBSE Class 12', 'Class 10 Science 2024', 'State Board Bengali', 'ISC Prelims'],
};

const FACET_ICON: Record<FacetKey, typeof BookOpen> = {
  subject: BookOpen,
  cls: GraduationCap,
  area: MapPin,
  board: Landmark,
  school: SchoolIcon,
};

/* Per-mode accent classes. DESIGN_SYSTEM.md §2: accents only -- orange for
   teachers, blue for papers. No literals anywhere in this file. */
const ACCENT = {
  teachers: {
    solid: 'bg-brand text-brand-foreground hover:bg-brand-hover',
    subtle: 'bg-brand-subtle text-brand',
    text: 'text-brand',
    ring: 'focus-visible:ring-brand',
  },
  papers: {
    solid: 'bg-brand-blue text-brand-blue-foreground hover:bg-brand-blue-hover',
    subtle: 'bg-brand-blue-subtle text-brand-blue',
    text: 'text-brand-blue',
    ring: 'focus-visible:ring-brand-blue',
  },
} as const;

/* Shared focus treatment -- §1.5 requires a visible ring on every interactive element. */
const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background';

function toggleValue(arr: string[], v: string): string[] {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
}

function facetDisplayLabel(key: FacetKey, values: string[]): string {
  if (values.length === 0) return FACET_LABELS[key];
  if (values.length === 1) return values[0];
  return `${values[0]} +${values.length - 1}`;
}

function initial(name: string): string {
  return (name.trim()[0] || '?').toUpperCase();
}

interface SearchControlProps {
  className?: string;
  /** Wrapper + inner row alignment. 'center' for the homepage hero, 'flex-start' for left-aligned page heroes. */
  align?: 'center' | 'flex-start';
  /** Segmented toggle placement: inline inside the bar (default) or stacked above it. Never both. */
  stackedToggle?: boolean;
  /**
   * Renders the field for a dark control block: translucent white fill, white
   * text, white/45 placeholder.
   *
   * pages.md §2 puts browse's search field INSIDE the near-black block
   * ("`bg-white/10` field, white text, white/45 placeholder"), where home's
   * sits in its own bone card overhanging the block. Same component, two
   * grounds -- without this the browse field rendered bone-on-black, which is
   * the one combination the spec never draws.
   */
  onDark?: boolean;
  /** Only meaningful with `stackedToggle`: keeps the stacked toggle visible at rest instead of
   *  gating it behind `reveal` (expanded/focused). Lets a page surface Teachers/Papers as an
   *  always-present control on first fold without touching the reveal-gated bar/facet-row logic. */
  alwaysShowModeToggle?: boolean;
  /** Force a starting mode instead of inferring it from the current route. */
  initialMode?: SearchMode;
  /** Notified whenever the mode changes, so a page can morph copy (headline, placeholder text) alongside it. */
  onModeChange?: (mode: SearchMode) => void;
  /**
   * Handoff H-009: the home hero's field grows to 60px / rounded-[24px] /
   * bg-muted with a dedicated 46px round submit disc, instead of the shared
   * h-14/rounded-2xl/shadow-border bar Browse and PastPapers still use. Opt-in
   * so this session's Home work doesn't reach into those other pages' own
   * change-log entries ahead of their turn.
   */
  heroDesk?: boolean;
  /** Hide the Subject/Class/Area facet row. Browse carries a full filter rail
   *  of its own, so the row there was a second, weaker copy of the same
   *  controls sitting directly above them. */
  hideFacets?: boolean;
  /**
   * Desktop-only: renders the facet trigger chips (Subject/Class/Board/
   * School or Area, per mode) in a persistent row to the right of the search
   * bar, instead of only after the control is focused/expanded. Opt-in  -- 
   * most callers want the quieter reveal-gated behaviour; PastPapers' hero
   * has the horizontal room and asked for the filters visible up front.
   */
  inlineFacetsDesktop?: boolean;
  /**
   * R3S1: pre-fills the free-text field from a search the reader already
   * made -- e.g. `/past-papers/results`'s own in-place edit control, seeded
   * from that page's `q` URL param. Only read once, on mount (an initial
   * value, not a controlled prop) -- a caller that wants it to track a
   * changing URL re-mounts with a `key`, same as any other initial-value
   * prop. Every existing caller omits this, so `q` still starts empty
   * exactly as before.
   */
  initialQuery?: string;
  /**
   * Same initial-value contract as `initialQuery`, for the facet chips
   * (subject/class/board/school/area). Partial: a caller only supplies the
   * facet keys its mode actually has (PAPER_FACET_KEYS or
   * TEACHER_FACET_KEYS) -- the rest default to unselected, same as
   * `EMPTY_SELECTIONS` always has.
   */
  initialSelections?: Partial<Selections>;
}

export function SearchControl({ className = '', align = 'center', stackedToggle = false, alwaysShowModeToggle = false, onDark = false, initialMode, onModeChange, heroDesk = false, hideFacets = false, inlineFacetsDesktop = false, initialQuery, initialSelections }: SearchControlProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { ensureLoaded, search, schools, ready, featuredTeachers, recentPapers } = useSearchIndex();

  const [mode, setMode] = useState<SearchMode>(initialMode || (location.pathname === '/past-papers' ? 'papers' : 'teachers'));
  /* mode_changed was a typed, weighted SignalKind (types.ts) with no producer
     anywhere in the app -- a reader deliberately switching Teachers <-> Papers
     told the intent index nothing. Wraps setMode rather than adding the call
     at every click site, so a future toggle can't be added without it.
     pickRecent's setMode is left alone: that restores UI state ahead of a
     search that has not been submitted yet, and search_submitted already
     carries the mode once it is. */
  const changeMode = useCallback((m: SearchMode) => {
    setMode(m);
    recordSignal('mode_changed', { mode: m });
  }, []);
  const { intent } = useIntent();
  // Frozen with the rest of the intent index (see intent-context.tsx's freeze
  // rule) -- the resting chips don't reshuffle while this control is open,
  // only between one page view and the next. Falls back to the same
  // hardcoded POPULAR list this always showed when the index has nothing.
  const restingChips = useMemo(() => suggestedSearches(mode, intent) ?? POPULAR[mode], [mode, intent]);

  useEffect(() => {
    onModeChange?.(mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Below ~560px the collapsed bar's fixed-width children (mode toggle, Search
  // button) don't leave room for the input -- shrink them so nothing overflows
  // the viewport on small phones.
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 560px)');
    const onMq = () => setNarrow(mq.matches);
    onMq();
    mq.addEventListener('change', onMq);
    return () => mq.removeEventListener('change', onMq);
  }, []);

  /* 430px, not the 768px mobile breakpoint: the placeholder fits fine on a

     large phone and a small tablet, and this should only shorten the copy

     where it genuinely does not fit. */

  const isNarrow = useMediaQuery('(max-width: 430px)');


  const [q, setQ] = useState(initialQuery ?? '');
  const [field, setField] = useState<FacetKey | 'q' | null>(null);
  const [expanded, setExpanded] = useState(false);
  /* R4G4: the roving highlight for the search overlay's combobox pattern.
     -1 means nothing is highlighted (Enter falls through to `runSearch`);
     otherwise it indexes `flatOptions` below, and Enter activates that
     option instead. Reset whenever the option set itself changes so a stale
     index never points at last render's list. */
  const [activeOptionIndex, setActiveOptionIndex] = useState(-1);
  // Read from the document-level Escape handler below, which is mounted
  // once (empty dep array) -- a ref, not a dependency, so it always sees the
  // latest value without re-subscribing the listener on every keystroke.
  const activeOptionIndexRef = useRef(-1);
  useEffect(() => { activeOptionIndexRef.current = activeOptionIndex; }, [activeOptionIndex]);
  const [selections, setSelections] = useState<Selections>(() => (
    initialSelections ? { ...EMPTY_SELECTIONS, ...initialSelections } : EMPTY_SELECTIONS
  ));
  const [recents, setRecents] = useState<RecentSearch[]>([]);

  /* Persistent inline chips (inlineFacetsDesktop) open their own small
     per-chip dropdown instead of routing through `field`, which is what
     drives the whole reveal/pinned/scrim search-popup machinery below. A
     quick "pick a subject" tap on the hero was launching the full
     fixed-position, scroll-locked, scrim-and-close-button overlay meant for
     the search field itself -- this keeps that interaction lightweight and
     anchored to the chip that opened it. Only meaningful with
     inlineFacetsDesktop; unused otherwise. */
  const [inlineOpenFacet, setInlineOpenFacet] = useState<FacetKey | null>(null);
  const inlineGroupRef = useRef<HTMLDivElement>(null);

  /* Was a bare `ensureLoaded()` on mount. Every page carrying a search bar
     (Home, Browse, Past papers) therefore pulled the entire search index  -- 
     teachers_list at limit 2000, plus bank_papers and papers -- into the
     first-paint connection window, for a feature the reader has not
     touched yet. Measured on Home: 25 concurrent REST calls against the
     browser's 6-per-host limit, the tail not settling until ~4.5s, with
     these three among the heaviest.

     Deferred to idle instead, so it still preloads (search is instant when
     it IS opened) without competing with above-the-fold data. `expandBar`
     also calls it, so focusing the field never waits on the idle callback,
     and ensureLoaded is idempotent (shared module-level loadPromise), so
     the two paths can safely race. */
  useEffect(() => {
    /* Not on a metered connection. Idle is the right time to preload, but
       "idle" says nothing about cost: this is ~550KB of teacher and paper
       JSON, speculatively, for a control most visitors never open, and on a
       Kolkata 3G connection it competes with the teacher photos that ARE on
       screen. route-prefetch.ts already refused to speculate under Save-Data
       or 2g; the single largest speculative download in the app had no such
       guard, which is backwards. Same rule, now shared (lib/net-conditions).
       expandBar() still calls ensureLoaded directly, so a reader who actually
       opens search gets the index on any connection -- this only declines to
       guess on their behalf. */
    if (isMeteredConnection()) return;

    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    if (typeof w.requestIdleCallback === 'function') {
      const handle = w.requestIdleCallback(() => { void ensureLoaded(); }, { timeout: 2500 });
      return () => w.cancelIdleCallback?.(handle);
    }
    const timer = setTimeout(() => { void ensureLoaded(); }, 1200);
    return () => clearTimeout(timer);
  }, [ensureLoaded]);

  const reveal = expanded || field !== null;

  // The facet row animates open from max-h-0. During that transition the browser can leave
  // it mid-scroll (observed at scrollLeft ≈ 75 on first paint at 375px), hiding the first
  // facet chips before the user has touched anything. Reset to the start whenever it opens.
  const facetRowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (reveal && facetRowRef.current) facetRowRef.current.scrollLeft = 0;
  }, [reveal]);

  // Only the stacked-toggle wrapper below reads this -- the bar, facet row, and scrim
  // stay tied to `reveal` so the rest of the expand/collapse choreography is untouched.
  const stackedToggleVisible = stackedToggle && (reveal || alwaysShowModeToggle);

  // "Focused mode", every width now: once revealed, the bar/facet-row/results
  // pin near the top of the viewport instead of sitting wherever the collapsed
  // pill happened to be in normal flow, the scrim darkens further, and
  // background scroll locks. Was mobile-only (isMobile, <768px) -- desktop kept
  // the plain in-flow dropdown, which meant an open search on a wide screen
  // didn't block scroll and could visually collide with page content below it
  // (the recurring "search bar overlaps X" reports). Same pinned treatment at
  // every width now; there is no narrower-viewport-only branch left to gate on.
  //
  // `pinEngaged` deliberately lags `reveal` by one animation frame. The very
  // tap/click that focuses the field is what sets `reveal` true -- if pinning
  // (a `relative` → `fixed inset-x-3 top-3` swap) applied on that SAME render,
  // the control physically jumped out from under the pointer mid-gesture: the
  // browser resolves `mousedown` against the field at its in-flow position, the
  // reflow happens before `mouseup`, and the click/tap that completes the
  // gesture lands on whatever page content the jump just exposed underneath  -- 
  // a teacher card, a "See all" link, anything that happened to sit at that
  // pixel. That is what read as the popup "taking me" somewhere else and
  // "overflowing": it wasn't the popup misbehaving, it was a real navigation on
  // an unrelated element one frame after open. Engaging the pin a frame later
  // lets the tap resolve against the field first; the pin then settles in
  // without ever occupying the space under an in-flight pointer.
  const [pinEngaged, setPinEngaged] = useState(false);
  useEffect(() => {
    if (!reveal) {
      setPinEngaged(false);
      return;
    }
    const id = requestAnimationFrame(() => setPinEngaged(true));
    return () => cancelAnimationFrame(id);
  }, [reveal]);
  const pinned = reveal && pinEngaged;

  // Notifies the sticky header to drop below the scrim while this control is
  // expanded, so nothing of the header shows through the scrim unblurred.
  useEffect(() => {
    setSearchExpanded(reveal);
    return () => setSearchExpanded(false);
  }, [reveal]);

  // Locks background scroll while pinned open, at every width now -- the scrim
  // alone doesn't stop the page from being dragged/scrolled (touch) or wheeled
  // (desktop) underneath it. Storing and restoring scrollY (instead of a bare
  // `overflow:hidden`) avoids the page jumping back to the top on iOS Safari
  // when the lock engages/releases.
  useEffect(() => {
    if (!pinned) return;
    const y = window.scrollY;
    const body = document.body.style;
    body.position = 'fixed';
    body.top = `-${y}px`;
    body.left = '0';
    body.right = '0';
    body.width = '100%';
    body.overflow = 'hidden';
    return () => {
      body.position = '';
      body.top = '';
      body.left = '';
      body.right = '';
      body.width = '';
      body.overflow = '';
      window.scrollTo(0, y);
    };
  }, [pinned]);

  const accent = ACCENT[mode];
  const facetKeys = mode === 'teachers' ? TEACHER_FACET_KEYS : PAPER_FACET_KEYS;
  const hasChips = facetKeys.some((k) => selections[k].length > 0);

  /* Deferred so the input never waits on the index. The field updates from
     the keystroke at high priority; re-running Fuse over every teacher and
     paper is allowed to land a frame later, and React drops intermediate
     queries when someone types faster than a search completes. Typing stays
     at the speed of the keyboard however large the index grows. */
  const deferredQ = useDeferredValue(q);
  const results = useMemo(() => search(deferredQ), [deferredQ, search]);
  const trimmedQ = q.trim();

  // Collapse on outside click / Escape
  useEffect(() => {
    function handlePointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setField(null);
        setExpanded(false);
      }
      // Independent of the above: the inline chip dropdown isn't part of
      // the reveal/pinned popup, so it gets its own outside-click check
      // against its own group rather than piggybacking on rootRef (which
      // it's a descendant of either way).
      if (inlineGroupRef.current && !inlineGroupRef.current.contains(e.target as Node)) {
        setInlineOpenFacet(null);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        /* R4G4: was an unconditional close-and-blur, which lost focus to
           `<body>` on every Escape. First Escape only drops a keyboard
           highlight if one is active (the roving combobox highlight),
           keeping focus and the overlay exactly as they were -- standard
           combobox behaviour is "Escape clears the highlight before it does
           anything else". Only once nothing is highlighted does Escape
           close the overlay/panel/dropdown, and even then focus is left
           alone -- it was already in the search input, which is what opened
           this overlay in the first place, so there is nowhere else for it
           to go back to. */
        if (activeOptionIndexRef.current >= 0) {
          setActiveOptionIndex(-1);
          return;
        }
        setField(null);
        setExpanded(false);
        setInlineOpenFacet(null);
      }
    }
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const expandBar = useCallback(() => {
    setExpanded(true);
    setField('q');
    setRecents(getRecentSearches());
    /* Guarantees the index for the one interaction that actually needs it,
       rather than relying on the idle preload above having already run.
       Idempotent, so this is free when it has. */
    void ensureLoaded();
  }, [ensureLoaded]);

  const buildParams = useCallback((query: string, sel: Selections, forMode: SearchMode, years?: string[]) => {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (sel.subject.length) params.set('filter_subjects', sel.subject.join(','));
    if (sel.cls.length) params.set('filter_classes', sel.cls.join(','));
    if (sel.board.length) params.set('filter_boards', sel.board.join(','));
    if (forMode === 'teachers' && sel.area.length) params.set('filter_areas', sel.area.join(','));
    /* sel.school holds the FACET LABEL (a merged display name can cover
       several raw bank_papers.school spellings/abbreviations -- see
       school-display.ts). Expanded back to every raw value it covers here,
       at the one place a papers-page URL gets built, so the results page
       still filters by the raw column and a merged label's results stay
       complete rather than matching only whichever single raw spelling
       happened to be picked. */
    if (forMode === 'papers' && sel.school.length) {
      const rawSchools = Array.from(new Set(sel.school.flatMap((label) => rawSchoolsFor(label))));
      params.set('filter_schools', rawSchools.join(','));
    }
    if (forMode === 'papers' && years?.length) params.set('filter_years', years.join(','));
    return params.toString();
  }, []);

  const closeControl = useCallback(() => {
    setField(null);
    setExpanded(false);
  }, []);

  const runSearch = useCallback(() => {
    /* Every facet the overlay holds, in full. recordSearch() only ever took
       three of them and only the first value of each, so a search made with
       two subjects and a board selected reached the index as one subject and
       nothing else. recordSignal takes the arrays directly; the hero's
       one-sentence trail record still reads the primary of each, which it
       derives itself. */
    /* A bare keyword search -- no chip picked, just typed text -- used to reach
       the index as `query` alone, which types.ts is explicit never becomes a
       slot value. "maths tutor ballygunge" told the intent index nothing,
       despite being a strong/explicit signal kind. extractFiltersFromQuery is
       the same typo-tolerant vocabulary matcher Browse.tsx already runs on
       this exact query once it lands there (to filter results) -- reused here
       so the signal recorded at the MOMENT of submission already carries what
       the reader typed, rather than depending on a second, weaker
       (medium/derived) extraction Browse happens to also do on mount.
       Chip selections still win where both exist: a picked chip is a more
       deliberate statement than a word inside a free-text query. */
    const extracted = trimmedQ ? extractFiltersFromQuery(trimmedQ) : {};
    /* Papers: parse the typed text into class/subject/board/year facets
       BEFORE routing, and union them with any chips the reader picked by
       hand (a chip is a deliberate choice and always kept). The query that
       actually reaches PaperResults' `q` param is only the leftover free
       text (a school name, a typo) -- passing the raw "12 math cbse" through
       verbatim is exactly what made the results page's ilike search return
       nothing, see paper-query.ts. Teachers keeps its existing behaviour:
       Browse.tsx already re-parses `q` itself (extractFiltersFromQuery),
       so the raw query still works there. */
    const parsedPapers = mode === 'papers' && trimmedQ ? parsePaperQuery(trimmedQ) : null;
    const papersSelections: Selections | null = parsedPapers
      ? {
          ...selections,
          subject: Array.from(new Set([...selections.subject, ...parsedPapers.subjects])),
          cls: Array.from(new Set([...selections.cls, ...parsedPapers.classes])),
          board: Array.from(new Set([...selections.board, ...parsedPapers.boards])),
        }
      : null;
    recordSignal('search_submitted', {
      query: trimmedQ || null,
      subject: selections.subject.length ? selections.subject : extracted.subjects,
      classLevel: selections.cls.length ? selections.cls : extracted.classes,
      area: selections.area.length ? selections.area : extracted.areas,
      board: selections.board.length ? selections.board : extracted.boards,
      school: selections.school,
      mode,
    });
    const qs = papersSelections
      ? buildParams(parsedPapers!.freeText, papersSelections, mode, parsedPapers!.years.map(String))
      : buildParams(trimmedQ, selections, mode);
    const path = mode === 'teachers' ? '/all-tuition-teachers-in-kolkata' : '/past-papers';
    navigate(qs ? `${path}?${qs}` : path);
    closeControl();
  }, [trimmedQ, mode, selections, buildParams, navigate, closeControl]);

  const seeAll = useCallback((forMode: SearchMode) => {
    if (trimmedQ) addRecentSearch(trimmedQ, forMode);
    const path = forMode === 'teachers' ? '/all-tuition-teachers-in-kolkata' : '/past-papers';
    navigate(trimmedQ ? `${path}?q=${encodeURIComponent(trimmedQ)}` : path);
    closeControl();
  }, [trimmedQ, navigate, closeControl]);

  const openTeacher = useCallback((t: TeacherHit) => {
    if (trimmedQ) addRecentSearch(trimmedQ, 'teachers');
    navigate(`/tuition-teachers/${t.slug}`);
    closeControl();
  }, [trimmedQ, navigate, closeControl]);

  const openPaper = useCallback((p: PaperHit) => {
    if (trimmedQ) addRecentSearch(trimmedQ, 'papers');
    // Always route through the reader. This previously did
    // `window.open(p.file_url)`, handing out the raw public bucket URL and
    // walking straight past the reader's sign-in wall, its visit tracking and
    // its redistribution notice -- so the "gate" wasn't one for anybody who
    // arrived via search. Papers without a file still fall back to a filtered
    // browse rather than a dead click.
    if (p.id) {
      navigate(`/past-papers/${p.id}`);
    } else {
      navigate(`/past-papers?q=${encodeURIComponent(`${p.title} ${displaySchool(p.school)}`)}`);
    }
    closeControl();
  }, [trimmedQ, navigate, closeControl]);

  const pickRecent = useCallback((r: RecentSearch) => {
    setQ(r.q);
    setMode(r.mode);
    setField('q');
  }, []);

  const pickPopular = useCallback((label: string) => {
    setQ(label);
    setField('q');
  }, []);

  const panelOpen = field !== null && field !== 'q';
  const overlayOpen = field === 'q';
  const panelPresence = useExitPresence(panelOpen);
  const overlayPresence = useExitPresence(overlayOpen);
  const overlayResting = overlayOpen && trimmedQ === '';
  const overlayTyping = overlayOpen && trimmedQ !== '';

  // Freeze the facet/overlay content while a dropdown plays its exit transition,
  // since `field` already resets to null the instant a close is triggered.
  const lastFacetFieldRef = useRef<FacetKey | null>(null);
  if (panelOpen) lastFacetFieldRef.current = field as FacetKey;
  const displayField = (panelOpen ? field : lastFacetFieldRef.current) as FacetKey | null;

  const lastOverlayStateRef = useRef({ resting: false, typing: false });
  if (overlayOpen) lastOverlayStateRef.current = { resting: overlayResting, typing: overlayTyping };
  const displayOverlayResting = overlayOpen ? overlayResting : lastOverlayStateRef.current.resting;
  const displayOverlayTyping = overlayOpen ? overlayTyping : lastOverlayStateRef.current.typing;
  const searchActive = trimmedQ.length >= 2;

  const teacherCount = results.teachersTotal;
  const paperCount = results.papersTotal;
  const currentCount = mode === 'teachers' ? teacherCount : paperCount;
  const otherCount = mode === 'teachers' ? paperCount : teacherCount;
  const indexLoading = !ready;
  const showEmptyBanner = overlayTyping && searchActive && !indexLoading && currentCount === 0;
  const totalCount = teacherCount + paperCount;

  /* R4G4 -- WAI-ARIA combobox pattern for the suggestions overlay. One flat,
     ordered list of every currently-visible, selectable suggestion (in the
     same order they render below), each with a stable id used for both the
     DOM node's own `id` and the input's `aria-activedescendant`. Arrow keys
     move `activeOptionIndex` through this list; Enter activates the
     highlighted one, or falls through to `runSearch` when nothing is
     highlighted. Mouse/touch is untouched -- every option keeps its own
     onClick exactly as before, this only adds a second way to reach the
     same `select()`. */
  /* Per-instance ids (useId) so two controls on one page never collide, and
     slugged labels: an IDREF with a space ("Class 10") is two ids to
     aria-activedescendant, so the highlighted chip would be lost. */
  const idBase = `search-${useId().replace(/:/g, "")}`;
  const idSafe = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const listboxId = `${idBase}-listbox`;
  const chipOptionId = (label: string) => `${idBase}-chip-${idSafe(label)}`;
  const recentOptionId = (i: number) => `${idBase}-recent-${i}`;
  const teacherOptionId = (id: string) => `${idBase}-teacher-${idSafe(id)}`;
  const paperOptionId = (id: string) => `${idBase}-paper-${idSafe(id)}`;

  const flatOptions = useMemo(() => {
    type FlatOption = { id: string; select: () => void };
    const opts: FlatOption[] = [];
    if (overlayResting) {
      restingChips.forEach((label) => opts.push({ id: chipOptionId(label), select: () => pickPopular(label) }));
      recents.forEach((r, i) => opts.push({ id: recentOptionId(i), select: () => pickRecent(r) }));
      const teachersShelfOpts: FlatOption[] = featuredTeachers.map((t) => ({
        id: teacherOptionId(t.id), select: () => openTeacher(t),
      }));
      const papersShelfOpts: FlatOption[] = recentPapers.map((p) => ({
        id: paperOptionId(p.id), select: () => openPaper(p),
      }));
      // Same DOM order as the shelves render in below (mode leads).
      if (mode === 'papers') opts.push(...papersShelfOpts, ...teachersShelfOpts);
      else opts.push(...teachersShelfOpts, ...papersShelfOpts);
    } else if (overlayTyping && searchActive && !indexLoading) {
      const teacherOpts: FlatOption[] = teacherCount > 0
        ? results.teachers.map((t) => ({ id: teacherOptionId(t.id), select: () => openTeacher(t) }))
        : [];
      const paperOpts: FlatOption[] = paperCount > 0
        ? results.papers.map((p) => ({ id: paperOptionId(p.id), select: () => openPaper(p) }))
        : [];
      if (mode === 'papers') opts.push(...paperOpts, ...teacherOpts);
      else opts.push(...teacherOpts, ...paperOpts);
    }
    return opts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    overlayResting, overlayTyping, searchActive, indexLoading, mode,
    restingChips, recents, featuredTeachers, recentPapers,
    teacherCount, paperCount, results,
  ]);

  // A stale highlight pointing at last render's list is worse than none  -- 
  // drop it the moment the option set can have changed (query edited, mode
  // flipped, or the overlay itself opening/closing).
  useEffect(() => {
    setActiveOptionIndex(-1);
  }, [mode, deferredQ, overlayOpen]);

  const activeOption = activeOptionIndex >= 0 ? flatOptions[activeOptionIndex] : undefined;
  const highlightClass = (id: string) =>
    activeOption?.id === id ? 'bg-accent ring-2 ring-ring ring-inset' : '';

  /* Owner's "search that finds results" delight moment (CRAFT §2): the result
     rows should settle in the first time a query actually returns something,
     not replay their entrance on every keystroke -- each keystroke swaps in a
     different set of teacher/paper ids, so without this guard the mapped
     buttons below (new keys every time) remounted and re-played
     animate-card-blur-in on every character typed, which reads as flicker,
     not delight. Resets once the overlay closes, so the next open earns its
     own first-results moment again. */
  const [resultsIntroduced, setResultsIntroduced] = useState(false);
  useEffect(() => {
    if (!overlayOpen) {
      setResultsIntroduced(false);
      return;
    }
    if (totalCount > 0) setResultsIntroduced(true);
  }, [overlayOpen, totalCount]);
  const resultCardEntranceClass = resultsIntroduced ? '' : 'animate-card-blur-in';

  // Shared by the popup's facet panel and the inline chips' own dropdown  -- 
  // both list the same option set for a given facet key.
  const optionsForFacet = useCallback((key: FacetKey | null): string[] => {
    if (!key) return [];
    switch (key) {
      case 'subject': return SUBJECTS;
      case 'cls': return mode === 'papers' ? CLASSES.filter((c) => c !== 'UG') : CLASSES;
      case 'area': return AREAS;
      case 'board': return BOARDS;
      case 'school': return schools;
      default: return [];
    }
  }, [mode, schools]);

  const facetPanelOptions = useMemo(() => optionsForFacet(displayField), [optionsForFacet, displayField]);

  /* Guided step-through (brief: "once they choose a filter they should
     automatically guide to the next filter"): the facet immediately after
     `key` in this mode's own order, or null once it was the last one. Used
     by both the popup's "Narrow it" panel and the inline chips' dropdown so
     picking a value always advances to the next unfilled decision instead
     of leaving the user to reopen the row themselves. */
  const nextFacetAfter = useCallback((key: FacetKey): FacetKey | null => {
    // facetKeys is TeacherFacetKey[] | PaperFacetKey[] -- a union of two
    // narrower arrays, so TS's own indexOf overload resolution narrows the
    // accepted argument to their intersection rather than the full FacetKey
    // `key` is typed as. Both key and facetKeys agree at runtime (key only
    // ever comes from this same mode's facetKeys to begin with); the cast
    // just tells TS what's already true.
    const keys = facetKeys as readonly FacetKey[];
    const idx = keys.indexOf(key);
    return keys[idx + 1] ?? null;
  }, [facetKeys]);

  /* Dropdown surface: one shared shell for the facet panel and the suggestions
     overlay. §5 -- shadow-border only, never border + shadow.

     M21: was one 200ms duration both ways. CRAFT §2 wants an entrance in the
     200-300ms band and an exit shorter/softer than that -- bumped the open to
     300ms and the close now uses the `exit` token (130ms) instead of sharing
     the entrance's timing. */
  const dropdownShell = (closing: boolean) =>
    `absolute left-0 right-0 top-[calc(100%+0.75rem)] z-20 rounded-2xl bg-card text-left shadow-border-hover transition-[opacity,translate] ease-[cubic-bezier(0.34,1.56,0.64,1)] ${
      closing ? 'duration-exit opacity-0 -translate-y-1' : 'duration-300 opacity-100 translate-y-0'
    } ${pinned ? 'max-h-[max(220px,calc(100vh-240px))] overflow-y-auto' : ''}`;

  const sectionLabel = 'text-xs font-medium uppercase tracking-wide text-muted-foreground';

  /* grid-cols-2, not flex + flex-1. `flex-1` is `flex: 1 1 0%`, but a flex
     item will not shrink below its own min-content, and with
     `whitespace-nowrap` that floor is the label width -- so "Past papers" held
     94px while "Teachers" took the 76px left over. The two segments were never
     equal, and the indicator (a fixed `calc(50% - 0.25rem)`) sat under neither
     of them properly. Grid cells are exactly half each, which is what the
     indicator has always assumed. */
  const segmentedToggle = (
    <div className="relative grid grid-cols-2 flex-none rounded-full bg-muted p-1">
      {/* Was a framer-motion spring. framer-motion costs 41kB gzip on the
          eager critical path and this was one of only two real usages in the
          whole app, so a CSS transform transition does the same job for
          nothing. translate-x-full is exactly the old x: '100%' -- both are
          100% of the element's own width, and the element is half the track. */}
      <span
        aria-hidden="true"
        className={`absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-full shadow-border backdrop-blur-sm transition-transform duration-300 ease-snap motion-reduce:transition-none ${
          mode === 'papers' ? 'bg-brand-blue' : 'bg-panel'
        }`}
        /* An explicit transform rather than Tailwind's translate-x-full.
           The utility sets --tw-translate-x and rebuilds the whole transform
           from seven --tw-* variables; on this element that composite resolved
           to the identity matrix even with every variable correctly defined
           and the class matching, so the indicator never moved. An identical
           element built in isolation animated fine, which makes it some
           interaction with this subtree rather than a missing class -- not
           worth chasing when one declaration removes the dependency entirely.
           Inline also guarantees it wins, which for a two-state indicator is
           what we want. Verified moving in both directions. */
        style={{ transform: mode === 'papers' ? 'translateX(100%)' : 'translateX(0)' }}
      />
      {(['teachers', 'papers'] as SearchMode[]).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => changeMode(m)}
          aria-pressed={mode === m}
          /* whitespace-nowrap + tracking-tight: "Past papers" is the longer of
             the two labels, and at the fixed 40px toggle height (pages.md §1)
             plus this button's own px padding, it was wrapping to 2 lines on
             narrow phones and blowing out the pill's height. Tightened
             tracking buys back a few px before padding needs to shrink
             further, rather than truncating the label. */
          className={`relative z-10 flex min-h-11 min-w-0 items-center justify-center whitespace-nowrap rounded-full text-sm font-medium tracking-tight transition-colors duration-150 ${FOCUS} focus-visible:ring-ring ${
            narrow ? 'px-2.5' : 'px-3.5'
          } ${mode === m ? 'font-bold text-background' : 'text-muted-foreground'}`}
        >
          {MODE_LABEL[m]}
          {searchActive && !indexLoading && (
            <span
              className={`ml-1.5 tabular-nums text-xs font-semibold ${
                mode === m ? 'text-background/65' : 'text-muted-foreground/70'
              }`}
            >
              {m === 'teachers' ? teacherCount : paperCount}
            </span>
          )}
        </button>
      ))}
    </div>
  );

  const rowBase = `flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors duration-150 hover:bg-muted ${FOCUS} focus-visible:ring-ring`;

  return (
    <>
      {/* Scrim: dims and blurs the rest of the page while the control is
          expanded, like a modal. Click anywhere on it to collapse.

          The z-index depends on whether the control is PINNED, which now
          happens at every width once `reveal` settles (see `pinned` above).
          Pinned, the control itself sits at z-70, so the scrim belongs above
          the nav at z-65 and covers everything. The lighter/lower z-30 branch
          only ever shows for the single frame between `reveal` turning true
          and `pinEngaged` catching up a frame later -- kept rather than
          removed, since that's still a real (if brief) state. */}
      <div
        onClick={closeControl}
        aria-hidden={!reveal}
        className={`fixed inset-0 backdrop-blur-md transition-opacity duration-300 ${
          pinned ? 'z-[65] bg-foreground/55' : 'z-30 bg-foreground/20'
        } ${reveal ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
      />
      <div
        ref={rootRef}
        /* The base width is conditional, not `w-full` plus a `w-auto` override.
           This is a plain template string -- no tailwind-merge -- so when pinned
           BOTH classes were emitted and `w-full` won on stylesheet order. With
           `inset-x-3` pinning the left edge at 12px, a 100%-of-viewport width
           put the right edge at 402px on a 390px screen: the results panel,
           the submit disc and the mode toggle were all sliced by 12px, which
           is the "things are overflowing / touching the corners" report. When
           pinned the two insets define the width, so it must not be set. */
        className={`${pinned ? '' : 'w-full'} ${align === 'center' ? 'mx-auto' : ''} ${
          pinned
            ? 'fixed inset-x-3 top-[max(0.75rem,env(safe-area-inset-top))] z-[70] max-w-none animate-search-pop motion-reduce:animate-none'
            /* z-[45] was unconditional -- TopBar is z-40 and fixed, so on any
               page where this control sits in the normal scroll flow near
               the top, scrolling slid the (at-rest) search bar's box up
               past/through the fixed navbar and it painted ON TOP of it
               (45 > 40), even though nothing was actually open. Only needs
               to clear the navbar while genuinely showing its dropdown/
               facets (`reveal`) -- at rest it stays below it instead. */
            /* inlineFacetsDesktop:!reveal narrows the field specifically at
               xl -- the chip row + its own Search button sit to the field's
               right at a fixed content width (each chip sized for its
               label, not flexible), and on a ~1024-1200px width there
               wasn't room left for all four chips plus the button once it
               moved outside the bar; the row pushed past the viewport edge
               and put a horizontal scrollbar on the whole page. Trading
               some of the field's own width back to the row it shares
               fixes that without capping how many facets show. Was `lg:`
               (1024) until PastPapers.tsx nested this control's only
               `inlineFacetsDesktop` caller inside a card rather than a
               full-bleed panel -- 1024px minus that card's own edges never
               had room for both the shrunk field AND the chip row+button in
               the same line, so the row (and sometimes the button itself)
               ran past the card into the panel's own `overflow-hidden` and
               vanished. `xl:` (1280) is the first breakpoint with enough
               spare width for both; below it the chips fall back to
               wrapping under the field, same as they already do below
               `lg`. */
            : `relative ${reveal ? 'z-[45]' : 'z-20'} ${expanded ? 'max-w-3xl' : 'max-w-2xl'} ${
                /* flex-col below xl so the chip row can sit in flow under
                   the field (order-last on the row) and give the parent card
                   real height, instead of the card guessing it with padding. */
                inlineFacetsDesktop && !reveal ? 'flex flex-col xl:block xl:max-w-lg' : ''
              }`
        } ${className}`}
      >
        {/* Pinned close button -- the only way to leave the expanded search
            was clicking the scrim or hitting Escape, neither of which is
            discoverable. Was top-left; on mobile that corner sits directly
            over the mode toggle/facet chips stacked above the field
            (stackedToggle), so the two overlapped. Bottom-right of the
            whole pinned card instead -- nothing else renders there at any
            width, toggle included. */}
        {pinned && (
          <button
            type="button"
            onClick={closeControl}
            aria-label="Close search"
            className={`absolute -bottom-2 -right-2 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-card text-foreground shadow-border-hover transition-colors duration-150 hover:bg-muted active:scale-[0.96] ${FOCUS} focus-visible:ring-ring`}
          >
            <X className="h-5 w-5" strokeWidth={2.25} aria-hidden="true" />
          </button>
        )}

        {/* Persistent desktop filter row -- the facet chips normally only
            show once the control is focused/expanded (the "Narrow it" row
            below), which on a wide hero with room to spare just reads as
            filters that don't exist until you go looking. Positioned off
            the root's own box so it never touches the reveal-gated facet
            row's absolute-positioned siblings; hidden once `reveal` is true
            since the focused-state UI (which includes this same row, just
            below the field) takes over from there.

            Each chip owns a small dropdown anchored to itself, driven by
            `inlineOpenFacet` rather than `field` -- `field` is what turns on
            the whole reveal/pinned/scrim search popup below, and a tap on
            "Subject" here isn't the same gesture as focusing the search
            field. Picking a value advances straight to the next facet's
            dropdown (nextFacetAfter) so filling Subject → Class → Board
            reads as one guided pass instead of four separate opens; the
            main bar's own Search button (already brand-solid, per mode)
            sits right there the whole time for whenever they're done. */}
        {inlineFacetsDesktop && !reveal && (
          <div
            ref={inlineGroupRef}
            /* Below xl: same chips, but there's no room to the field's
               right at that width, so they wrap onto their own row under
               the field instead of sitting beside it -- still visible
               before the user has tapped anything, which was the point;
               previously this whole block was lg-only and mobile only ever
               saw facets after focusing the field. (xl, not lg -- see the
               root className's own note on why.) */
            className={`pointer-events-auto relative order-last mt-2 flex flex-wrap items-center gap-2 xl:absolute xl:left-[calc(100%+12px)] xl:right-auto xl:top-0 xl:mt-0 xl:flex-nowrap ${
              heroDesk ? 'xl:h-[60px]' : 'xl:h-14'
            }`}
          >
            {facetKeys.map((key) => {
              const Icon = FACET_ICON[key];
              const selected = selections[key].length > 0;
              const open = inlineOpenFacet === key;
              const options = optionsForFacet(open ? key : null);
              return (
                <div key={key} className="relative">
                  <button
                    type="button"
                    onClick={() => setInlineOpenFacet((cur) => (cur === key ? null : key))}
                    aria-expanded={open}
                    className={`flex h-11 flex-none items-center gap-2 whitespace-nowrap rounded-full px-4 text-sm font-medium transition-colors duration-150 active:scale-[0.96] ${FOCUS} focus-visible:ring-ring ${
                      selected ? accent.solid : `${accent.subtle} hover:opacity-90`
                    }`}
                  >
                    <Icon className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                    {facetDisplayLabel(key, selections[key])}
                    <ChevronDown className={`h-3 w-3 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
                  </button>

                  {open && (
                    <div className="absolute left-0 top-[calc(100%+0.5rem)] z-30 min-w-[260px] max-w-[320px] rounded-2xl bg-card p-3 text-left shadow-border-hover">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <span className={sectionLabel}>{FACET_LABELS[key]}</span>
                        <button
                          type="button"
                          onClick={() => setInlineOpenFacet(nextFacetAfter(key))}
                          className={`flex h-9 flex-none items-center gap-1.5 rounded-full pl-4 pr-3 text-sm font-bold transition-colors duration-150 active:scale-[0.96] ${FOCUS} focus-visible:ring-ring ${accent.solid}`}
                        >
                          {nextFacetAfter(key) ? 'Next' : 'Done'}
                          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </div>
                      {options.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          {key === 'school' ? 'No schools yet. Check back once papers are added.' : 'No options available yet.'}
                        </p>
                      ) : (
                        <div className="scrollbar-slim -mr-1 flex max-h-[160px] flex-wrap gap-2 overflow-y-auto overscroll-contain pr-2 stagger-children">
                          {options.map((opt) => {
                            const picked = selections[key].includes(opt);
                            return (
                              <button
                                key={opt}
                                type="button"
                                aria-pressed={picked}
                                onClick={() => setSelections((s) => ({ ...s, [key]: toggleValue(s[key], opt) }))}
                                className={`flex min-h-11 items-center rounded-full px-4 text-sm font-medium transition-colors duration-150 active:scale-[0.96] motion-safe:animate-pop ${FOCUS} focus-visible:ring-ring ${
                                  picked ? accent.solid : 'bg-muted text-foreground hover:bg-accent'
                                }`}
                              >
                                {opt}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {/* The bar's own Search button only hides at xl in this mode
                (see its `inlineFacetsDesktop` note) -- below xl it's still
                the one visible Search button, so this replacement stays
                xl-only too. Without the gate, mobile/tablet briefly had two
                Search buttons: the bar's own plus this one wrapped onto a
                lone third row under the chips. Last in the row at xl so it
                reads as "field, then filters, then go" left to right
                instead of sitting before the filters it follows. */}
            <button
              type="button"
              onClick={runSearch}
              className={`hidden h-11 flex-none items-center gap-2 whitespace-nowrap rounded-full px-5 text-sm font-bold transition-colors duration-150 active:scale-[0.96] xl:flex ${FOCUS} ${accent.solid} ${accent.ring}`}
            >
              Search
              <ArrowRight className="h-4 w-4" strokeWidth={2.5} aria-hidden="true" />
            </button>
          </div>
        )}

        {stackedToggle && (
          <div
            /* M22: `margin` is layout-affecting (non-composited) alongside
               max-height/opacity, which already carry the disclosure
               animation on their own -- dropped from the transitioned
               property list so the margin snaps with the state change
               instead of forcing an extra reflow every frame. */
            className={`flex overflow-hidden transition-[max-height,opacity] duration-300 ease-out ${
              align === 'center' ? 'justify-center' : 'justify-start'
            } ${stackedToggleVisible ? 'mb-3 max-h-16 opacity-100' : 'mb-0 max-h-0 opacity-0'}`}
          >
            {segmentedToggle}
          </div>
        )}

        <div className="relative">
          {/* The search field. §11 hero spec: full width, h-14, rounded-2xl,
              shadow-border, leading icon, text-base (16px so iOS never zooms).
              Handoff H-009 overrides this to a 60px/rounded-[24px]/bg-muted
              field with its own 46px round submit disc when heroDesk is set. */}
          <div
            className={
              heroDesk
                ? 'flex h-[60px] items-center gap-[10px] rounded-[24px] bg-muted pl-[18px] pr-2 transition-shadow duration-150 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background'
                : `flex h-14 items-center gap-2 rounded-2xl pl-4 pr-2 transition-shadow duration-150 ${
                    onDark
                      ? 'bg-white/10 focus-within:bg-white/[0.14]'
                      : 'bg-card shadow-border focus-within:shadow-border-hover'
                  }`
            }
          >
            <Search
              className={heroDesk ? 'h-[19px] w-[19px] flex-none text-warm-meta' : `h-5 w-5 flex-none ${onDark ? 'text-white/45' : 'text-muted-foreground'}`}
              strokeWidth={2.25}
              aria-hidden="true"
            />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => { setQ(e.target.value); setField('q'); setExpanded(true); }}
              onFocus={expandBar}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  if (flatOptions.length === 0) return;
                  e.preventDefault();
                  setActiveOptionIndex((i) => (i + 1) % flatOptions.length);
                  return;
                }
                if (e.key === 'ArrowUp') {
                  if (flatOptions.length === 0) return;
                  e.preventDefault();
                  setActiveOptionIndex((i) => (i - 1 + flatOptions.length) % flatOptions.length);
                  return;
                }
                if (e.key === 'Home' && flatOptions.length > 0) {
                  e.preventDefault();
                  setActiveOptionIndex(0);
                  return;
                }
                if (e.key === 'End' && flatOptions.length > 0) {
                  e.preventDefault();
                  setActiveOptionIndex(flatOptions.length - 1);
                  return;
                }
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (activeOption) activeOption.select();
                  else runSearch();
                }
              }}
              role="combobox"
              aria-autocomplete="list"
              aria-haspopup="listbox"
              aria-expanded={overlayOpen}
              aria-controls={listboxId}
              aria-activedescendant={activeOption?.id}
              aria-label={mode === 'teachers' ? 'Search teachers' : 'Search past papers'}
              /* The placeholder says what the field accepts rather than
                 showing one example, because the field really does take all of
                 them. That copy does not fit a phone, and it was not failing
                 gracefully: at 375px the input is 152px wide while "Subject,
                 class or area" needs 161px and "Board, class, subject or
                 school" needs 227px, so the first rendered as "Subject, class
                 or are" -- cut mid-word, which reads as a broken page rather
                 than a long label.
                 Measured, not guessed: the row is 331px and the Search button
                 alone takes 115px of it, so no amount of rewording fits the
                 papers copy on a narrow phone. Below 431px it uses a shorter
                 form that still names what the field takes; above that the
                 full wording returns. */
              placeholder={
                mode === 'teachers'
                  ? isNarrow ? 'Subject, class, area' : 'Subject, class or area'
                  : isNarrow ? 'Board, class, subject' : 'Board, class, subject or school'
              }
              /* h-full, not the intrinsic 24px line box: the field reads as a
                 60px (or 56px) row, so the whole row has to be focusable  -- 
                 otherwise the 18px above and below the text is a dead zone and
                 the real tap target is well under the 44px floor (C-011). An
                 input centres its own value vertically, so this is a no-op
                 visually. */
              /* `focus-visible:outline-none`, not just `outline-none`. The
                 global focus rule in index.css is scoped with
                 `:not([class*="focus-visible:outline-"])`, so a plain
                 `outline-none` does not exclude an element -- the field was
                 getting the global 2px outline plus its 4px white halo, drawn
                 as a hard RECTANGLE inside a rounded-[24px] pill. The
                 indicator now lives on the pill itself as a focus-within
                 ring, so focus is still clearly shown, in the field's own
                 shape. */
              className={
                heroDesk
                  ? 'h-full min-w-0 flex-1 border-0 bg-transparent text-base text-foreground outline-none focus-visible:outline-none placeholder:text-warm-prose'
                  : `h-full min-w-0 flex-1 border-0 bg-transparent text-base outline-none focus-visible:outline-none ${
                      onDark ? 'text-white placeholder:text-white/45' : 'text-foreground placeholder:text-muted-foreground'
                    }`
              }
            />

            {/* Inline segmented toggle */}
            {!stackedToggle && segmentedToggle}

            <button
              type="button"
              onClick={runSearch}
              aria-label="Search"
              /* inlineFacetsDesktop hides this copy at xl: that mode gets its
                 own Search button after the chip row instead (extreme
                 right, once the chips it's meant to follow), so this one
                 would otherwise sit both before the chips AND duplicate it.
                 Still the only Search button below xl, where the chip row
                 itself is hidden. */
              className={`${inlineFacetsDesktop && !reveal ? 'xl:hidden' : ''} ${
                heroDesk
                  ? `flex h-[46px] flex-none items-center justify-center gap-2 rounded-full px-5 text-sm font-bold transition-colors duration-150 active:scale-[0.96] ${FOCUS} ${accent.solid} ${accent.ring}`
                  : `flex h-11 flex-none items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors duration-150 active:scale-[0.96] ${FOCUS} ${accent.solid} ${accent.ring} ${
                      narrow ? 'w-11' : 'px-4'
                    }`
              }`}
            >
              {/* Arrow, not a magnifier. dc.html draws this as a 44x44 orange
                  tile holding `M5 12h14M13 6l6 6-6 6` -- the magnifier already
                  sits at the other end of the field, so repeating it says
                  nothing, where the arrow says "go".
                  heroDesk carries the "Search" label too now -- an icon-only
                  disc read as decoration rather than the button that
                  actually submits, per owner review; text on every width
                  this control renders at removes the ambiguity. */}
              <ArrowRight className={heroDesk ? 'h-[18px] w-[18px]' : 'h-[17px] w-[17px]'} strokeWidth={2.5} aria-hidden="true" />
              {(heroDesk || !narrow) && <span className="whitespace-nowrap">Search</span>}
            </button>
          </div>

          {/* Facet row -- horizontal snap-scroll on mobile, never ragged wrapped rows (§11). */}
          <div
            /* M22: same fix as the stacked-toggle wrapper above -- margin
               dropped from the transitioned properties, max-height/opacity
               carry the animation alone. */
            className={`overflow-hidden transition-[max-height,opacity] duration-300 ease-out ${
              reveal && !hideFacets ? 'mt-3 max-h-48 opacity-100' : 'invisible mt-0 max-h-0 opacity-0'
            }`}
          >
            <div className={`relative ${pinned ? 'rounded-2xl bg-card px-3 py-2.5 shadow-border' : ''}`}>
              {/* The "Narrow it" label lives OUTSIDE the scroller. It used to be the scroller's
                  first child, which meant it scrolled away from the very chips it labels -- and
                  because this row animates open (max-h-0 → max-h-40), the browser landed it at
                  scrollLeft ≈ 75 on first paint, so mobile users never saw it at all. */}
              <span className={`${sectionLabel} mb-1.5 block ${align === 'center' ? 'sm:text-center' : ''}`}>
                Narrow it
              </span>
              <div
                key={mode}
                ref={facetRowRef}
                /* key={mode}: Area (teachers) and School (papers) are different
                   facet sets, so a mode switch swaps this row's chips outright  -- 
                   animate-fade-slide-up (the project's one whitelisted entrance
                   keyframe) cross-fades that swap instead of it snapping,
                   matching the resting shelf below. */
                className={`flex snap-x animate-fade-slide-up items-center gap-2 overflow-x-auto scrollbar-hide sm:flex-wrap sm:overflow-visible ${
                  align === 'center' ? 'sm:justify-center' : 'sm:justify-start'
                }`}
              >
              {facetKeys.map((key) => {
                const Icon = FACET_ICON[key];
                const selected = selections[key].length > 0;
                const open = field === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setField(open ? 'q' : key)}
                    aria-expanded={open}
                    className={`flex min-h-11 flex-none snap-start items-center gap-2 whitespace-nowrap rounded-full px-4 text-sm font-medium transition-colors duration-150 active:scale-[0.96] ${FOCUS} focus-visible:ring-ring ${
                      /* accent.subtle (idle) → accent.solid (has a value):
                         one mode-matched hue applied to the whole facet
                         cluster, not a per-chip neutral gray -- same "exactly
                         one accent" reading as the rest of the page, just
                         carried by every chip in this row instead of none of
                         them. */
                      selected ? accent.solid : `${accent.subtle} hover:opacity-90`
                    }`}
                  >
                    <Icon className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                    {facetDisplayLabel(key, selections[key])}
                    <ChevronDown
                      className={`h-3 w-3 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
                      aria-hidden="true"
                    />
                  </button>
                );
              })}
              {hasChips && (
                <button
                  type="button"
                  onClick={() => setSelections(EMPTY_SELECTIONS)}
                  className={`flex min-h-11 flex-none items-center whitespace-nowrap rounded-lg px-2 text-sm font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground ${FOCUS} focus-visible:ring-ring`}
                >
                  Clear
                </button>
              )}
              </div>
            </div>
          </div>

          {/* Facet panel */}
          {panelPresence.mounted && displayField && (
            <div className={`${dropdownShell(panelPresence.closing)} p-4 sm:p-6`}>
              {/* Owner revision: auto-jumping to the next facet the instant
                  one value was picked didn't leave room to pick a second
                  value in the SAME facet first ("board" can be multi-select
                  too) -- replaced with a plain toggle below (stays open,
                  multi-select) plus this explicit Next, right half of the
                  header per the brief, bigger than a text link since it's
                  now the primary way through the sequence rather than an
                  automatic side-effect. */}
              <div className="mb-3 flex items-center justify-between gap-3">
                <span className={sectionLabel}>{FACET_LABELS[displayField]}</span>
                <button
                  type="button"
                  onClick={() => setField(nextFacetAfter(displayField) ?? 'q')}
                  className={`flex h-9 flex-none items-center gap-1.5 rounded-full pl-4 pr-3 text-sm font-bold transition-colors duration-150 active:scale-[0.96] ${FOCUS} focus-visible:ring-ring ${accent.solid}`}
                >
                  {nextFacetAfter(displayField) ? 'Next' : 'Done'}
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
              {facetPanelOptions.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {displayField === 'school' ? 'No schools yet. Check back once papers are added.' : 'No options available yet.'}
                </p>
              ) : (
                // M11: a small entrance stagger on the first render of this facet's
                // option set (a facet switch remounts every button, since the
                // option list itself changes) -- reads as the panel presenting its
                // choices rather than the whole list just appearing at once.
                <div className="scrollbar-slim -mr-1 flex max-h-[130px] flex-wrap gap-2 overflow-y-auto overscroll-contain pr-2 stagger-children">
                  {facetPanelOptions.map((opt) => {
                    const picked = selections[displayField].includes(opt);
                    return (
                      <button
                        key={opt}
                        type="button"
                        aria-pressed={picked}
                        onClick={() => setSelections((s) => ({ ...s, [displayField]: toggleValue(s[displayField], opt) }))}
                        className={`flex min-h-11 items-center rounded-full px-4 text-sm font-medium transition-colors duration-150 active:scale-[0.96] motion-safe:animate-pop ${FOCUS} focus-visible:ring-ring ${
                          picked ? accent.solid : 'bg-muted text-foreground hover:bg-accent'
                        }`}
                      >
                        {opt}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Suggestions overlay -- the combobox's listbox (R4G4). Section
              labels/banners/skeletons inside it are plain content, not
              options; every actual suggestion below carries role="option"
              plus the matching id from `flatOptions`. */}
          {overlayPresence.mounted && (
            <div
              id={listboxId}
              role="listbox"
              aria-label={mode === 'teachers' ? 'Teacher suggestions' : 'Past paper suggestions'}
              className={`${dropdownShell(overlayPresence.closing)} overflow-hidden`}
            >
              {displayOverlayResting && (
                /* key={mode} cross-fades the whole resting shelf (facet-driven
                   copy, popular chips, suggestions) in on a mode switch instead
                   of the content just snapping to its Papers/Teachers values  -- 
                   requirement 6. animate-fade-slide-up is the project's one
                   whitelisted entrance keyframe (tailwind.config.ts), reused
                   rather than inventing a new one. */
                <div key={mode} className="animate-blur-swap p-4 sm:p-6 motion-reduce:animate-none">
                  <div className={`${sectionLabel} mb-2`}>Popular right now</div>
                  <div className="flex snap-x gap-2 overflow-x-auto scrollbar-hide sm:flex-wrap sm:overflow-visible">
                    {restingChips.map((label) => (
                      <button
                        key={label}
                        id={chipOptionId(label)}
                        role="option"
                        aria-selected={activeOption?.id === chipOptionId(label)}
                        type="button"
                        onClick={() => pickPopular(label)}
                        className={`flex min-h-11 flex-none snap-start items-center whitespace-nowrap rounded-full px-4 text-sm font-medium transition-colors duration-150 active:scale-[0.96] ${FOCUS} focus-visible:ring-ring ${accent.subtle} ${highlightClass(chipOptionId(label))}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {recents.length > 0 && (
                    <>
                      <div className={`${sectionLabel} mb-2 mt-6`}>Recent searches</div>
                      <div className="grid gap-1">
                        {recents.map((r, i) => (
                          <button
                            key={`${r.q}-${i}`}
                            id={recentOptionId(i)}
                            role="option"
                            aria-selected={activeOption?.id === recentOptionId(i)}
                            type="button"
                            onClick={() => pickRecent(r)}
                            className={`${rowBase} ${highlightClass(recentOptionId(i))}`}
                          >
                            <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-muted">
                              <Clock className="h-4 w-4 text-muted-foreground" strokeWidth={2} aria-hidden="true" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-base font-semibold text-foreground">{r.q}</span>
                              <span className="block text-sm text-muted-foreground">in {MODE_LABEL[r.mode]}</span>
                            </span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                  {/* Suggested/recent shelf -- teachers flavor reuses the same real
                      `is_featured` column Browse.tsx's "Featured teachers" shelf
                      reads; papers flavor is the head of the already
                      year-descending papers fetch. Hidden (not a fabricated
                      empty state) until the index has real rows to show. */}
                  {/* Both shelves at rest, not just the active mode's. The
                      typing state already shows teachers AND papers together
                      ("both types always shown here"); resting showed only one,
                      so opening the control told you less than typing one letter
                      into it did. Active mode leads, and the order is the DOM's
                      so focus follows what you see. */}
                  {(() => {
                    const teachersShelf =
                      featuredTeachers.length > 0 ? (
                        <div key="shelf-teachers">
                          <div className={`${sectionLabel} mb-2 mt-6`}>Suggested teachers</div>
                          {/* Was a single-column list ("not just top to
                              bottom") -- a real grid at sm+ now, where there's
                              width to actually use for more than one card a
                              row. */}
                          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                            {featuredTeachers.map((t) => (
                              <button
                                key={t.id}
                                id={teacherOptionId(t.id)}
                                role="option"
                                aria-selected={activeOption?.id === teacherOptionId(t.id)}
                                type="button"
                                onClick={() => openTeacher(t)}
                                className={`${rowBase} ${highlightClass(teacherOptionId(t.id))}`}
                              >
                                <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-brand-subtle text-sm font-semibold text-brand">
                                  {initial(t.name)}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-base font-semibold text-foreground">{t.name}</span>
                                  <span className="block truncate text-sm text-muted-foreground">
                                    {[t.subjects?.split(',')[0]?.trim(), t.location?.split(',')[0]?.trim()].filter(Boolean).join(' · ')}
                                  </span>
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null;
                    const papersShelf =
                      recentPapers.length > 0 ? (
                        <div key="shelf-papers">
                          <div className={`${sectionLabel} mb-2 mt-6`}>Recently added papers</div>
                          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                            {recentPapers.map((p) => (
                              <button
                                key={p.id}
                                id={paperOptionId(p.id)}
                                role="option"
                                aria-selected={activeOption?.id === paperOptionId(p.id)}
                                type="button"
                                onClick={() => openPaper(p)}
                                className={`${rowBase} ${highlightClass(paperOptionId(p.id))}`}
                              >
                                <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-brand-blue-subtle text-sm font-semibold text-brand-blue">
                                  {initial(displaySchool(p.school))}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-base font-semibold text-foreground">{p.title}</span>
                                  <span className="block truncate text-sm text-muted-foreground">
                                    {displaySchool(p.school)} · {p.board} Class {p.class}
                                  </span>
                                </span>
                                <span className="flex-none text-xs tabular-nums text-muted-foreground">{p.year}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null;
                    return mode === 'papers'
                      ? [papersShelf, teachersShelf]
                      : [teachersShelf, papersShelf];
                  })()}
                </div>
              )}

              {displayOverlayTyping && (
                <div key={mode} className="animate-blur-swap motion-reduce:animate-none">
                  {/* Loading -- skeleton matching the result rows' shape (§9). */}
                  {searchActive && indexLoading && (
                    <div className="grid gap-2 p-4 sm:p-6" aria-busy="true" aria-live="polite">
                      <span className="sr-only">Searching…</span>
                      {[0, 1, 2].map((i) => (
                        <div key={i} className="flex items-center gap-3">
                          <div className="h-10 w-10 flex-none rounded-lg bg-muted bg-[length:200%_100%] animate-shimmer" />
                          <div className="min-w-0 flex-1 space-y-2">
                            <div className="h-4 w-1/2 rounded-lg bg-muted bg-[length:200%_100%] animate-shimmer" />
                            <div className="h-3 w-1/3 rounded-lg bg-muted bg-[length:200%_100%] animate-shimmer" />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {showEmptyBanner && (
                    <div className="p-4 sm:p-6">
                      <p className="text-base font-semibold text-foreground">
                        Nothing matches &ldquo;{trimmedQ}&rdquo; in {MODE_LABEL[mode]}
                      </p>
                      {otherCount > 0 ? (
                        <>
                          <p className="mt-2 text-sm text-muted-foreground">
                            But we found {otherCount} {mode === 'teachers' ? 'past paper' : 'teacher'}{otherCount === 1 ? '' : 's'} for this, see below.
                          </p>
                          <button
                            type="button"
                            onClick={() => changeMode(mode === 'teachers' ? 'papers' : 'teachers')}
                            className={`mt-4 flex min-h-11 items-center rounded-lg px-4 text-sm font-medium transition-colors duration-150 active:scale-[0.96] ${FOCUS} focus-visible:ring-ring bg-muted text-foreground hover:bg-accent`}
                          >
                            Search {MODE_LABEL[mode === 'teachers' ? 'papers' : 'teachers']} instead
                          </button>
                        </>
                      ) : (
                        <p className="mt-2 text-sm text-muted-foreground">
                          Try a different subject, class, or spelling.
                        </p>
                      )}
                    </div>
                  )}

                  {!searchActive && (
                    <p className="p-4 text-sm text-muted-foreground sm:p-6">
                      Keep typing to search teachers and papers…
                    </p>
                  )}

                  {/* Group order follows the mode in the DOM, not with CSS
                      `order`. Reordering visually while leaving the DOM alone
                      put the group you asked for first on screen but second in
                      the tab and screen-reader sequence -- WCAG 2.4.3. */}
                  {(() => {
                    const teachersGroup =
                      searchActive && teacherCount > 0 ? (
                        <div key="teachers" className="border-b border-border p-4 sm:p-6">
                          <div className="mb-2 flex items-baseline justify-between gap-2">
                            <span className={sectionLabel}>Teachers</span>
                            <span className="flex-none whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                              {teacherCount} found
                            </span>
                          </div>
                          <div className="grid gap-2 stagger-children sm:grid-cols-2 lg:grid-cols-3">
                            {results.teachers.map((t) => (
                              <button
                                key={t.id}
                                id={teacherOptionId(t.id)}
                                role="option"
                                aria-selected={activeOption?.id === teacherOptionId(t.id)}
                                type="button"
                                onClick={() => openTeacher(t)}
                                className={`${rowBase} ${resultCardEntranceClass} ${highlightClass(teacherOptionId(t.id))}`}
                              >
                                <span className="flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-brand-subtle text-sm font-semibold text-brand">
                                  {initial(t.name)}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-base font-semibold text-foreground">{t.name}</span>
                                  <span className="block truncate text-sm text-muted-foreground">
                                    {[t.subjects?.split(',')[0]?.trim(), t.location?.split(',')[0]?.trim()].filter(Boolean).join(' · ')}
                                  </span>
                                </span>
                              </button>
                            ))}
                          </div>
                          <button
                            type="button"
                            onClick={() => seeAll('teachers')}
                            className={`mt-2 flex min-h-11 items-center whitespace-nowrap rounded-lg px-1 text-sm font-medium text-brand transition-colors duration-150 hover:underline ${FOCUS} focus-visible:ring-ring`}
                          >
                            See all {teacherCount} teacher{teacherCount === 1 ? '' : 's'} →
                          </button>
                        </div>
                      ) : null;
                    const papersGroup =
                      paperCount > 0 ? (
                        <div key="papers" className="border-b border-border p-4 sm:p-6">
                          <div className="mb-2 flex items-baseline justify-between gap-2">
                            <span className={sectionLabel}>Past Papers</span>
                            <span className="flex-none whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                              {paperCount} found
                            </span>
                          </div>
                          <div className="grid gap-2 stagger-children sm:grid-cols-2 lg:grid-cols-3">
                            {results.papers.map((p) => (
                              <button
                                key={p.id}
                                id={paperOptionId(p.id)}
                                role="option"
                                aria-selected={activeOption?.id === paperOptionId(p.id)}
                                type="button"
                                onClick={() => openPaper(p)}
                                className={`${rowBase} ${resultCardEntranceClass} ${highlightClass(paperOptionId(p.id))}`}
                              >
                                <span className="flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-brand-blue-subtle text-sm font-semibold text-brand-blue">
                                  {initial(displaySchool(p.school))}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-base font-semibold text-foreground">{p.title}</span>
                                  <span className="block truncate text-sm text-muted-foreground">
                                    {displaySchool(p.school)} · {p.board} Class {p.class}
                                  </span>
                                </span>
                                <span className="flex-none text-xs tabular-nums text-muted-foreground">{p.year}</span>
                              </button>
                            ))}
                          </div>
                          <button
                            type="button"
                            onClick={() => seeAll('papers')}
                            className={`mt-2 flex min-h-11 items-center whitespace-nowrap rounded-lg px-1 text-sm font-medium text-brand-blue transition-colors duration-150 hover:underline ${FOCUS} focus-visible:ring-ring`}
                          >
                            See all {paperCount} paper{paperCount === 1 ? '' : 's'} →
                          </button>
                        </div>
                      ) : null;
                    return mode === 'papers'
                      ? [papersGroup, teachersGroup]
                      : [teachersGroup, papersGroup];
                  })()}

                  {totalCount > 0 && (
                    <p className="bg-muted px-4 py-3 text-xs text-muted-foreground sm:px-6">
                      Press Enter to see all {MODE_LABEL[mode]} results · both types always shown here
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
