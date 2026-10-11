import { useEffect, useState } from 'react';
import {
  BookOpen, GraduationCap, MapPin, IndianRupee, Wifi, Landmark, Users, Clock, X,
  School as SchoolIcon, FileText,
  type LucideIcon,
} from 'lucide-react';
import { useSearchIndex } from '@/hooks/useSearchIndex';
import { Chip } from '@/components/ui/chip';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion';
import { Sheet, SheetContent, SheetTitle, SheetClose } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { SUBJECT_DISPLAY_ORDER } from '@/utils/subjectOrder';
import type { FilterState } from '@/components/FilterPanel';
import { BentoPanel } from '@/components/layout/PageContainer';

/**
 * C6 -- components.md §2 / design.md §2.3.
 *
 * One chip-group component, TWO presentations: inside a bottom Sheet on
 * mobile (`FilterSheet`), and as a persistent 284px rail on desktop
 * (`FilterRail`). Both render the same `FilterGroupsBody` -- the body is
 * extracted once, never duplicated (components.md C6 note).
 *
 * Design's five groups are Subject / Class / Area / Rate / Mode. The app's
 * existing FilterState also carries Board, Class size and Experience -- fields
 * the mockup doesn't model but the data layer and ~35 SEO routes depend on
 * (Board in particular is part of the `filter_boards` URL contract). Per the
 * "design wins, keep functionality" rule those stay, as extra groups appended
 * after the five mandated ones, so no existing filter capability is dropped.
 */

const CLASSES = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', 'UG'];
const BOARDS = ['ICSE', 'ISC', 'CBSE', 'IGCSE', 'IB', 'State'];
/* The real, queried values -- `select distinct exam_type from papers union
   select distinct exam from bank_papers` against the live project. The
   filter spans both tables (Browse queries papers.exam_type and matches
   bank rows on their `exam`), so it needs the union of the two.

   This list was previously inferred from labels read off the rendered UI,
   and three of its four entries ('Board paper', 'Pre-board', 'Prelim')
   matched no row at all -- the real values are 'Board Examination',
   'Pre-board Examination' and 'Prelims'. Guessed facet values are worse
   than no facet: every one is a dead end that looks like a real choice.

   'chapterwise' is genuinely in the data but is a categorisation rather
   than a sitting, so it is deliberately not offered as a Category. */
const EXAM_TYPES = [
  'Board Examination',
  'Pre-board Examination',
  'Prelims',
  'Half Yearly Examination',
  'Half-Yearly',
  'Annual Examination',
  'Sample Paper',
  'Unit Test',
];
const CLASS_SIZE = ['Group', 'Solo'];
const SUBJECTS = SUBJECT_DISPLAY_ORDER;
const EXPERIENCE_OPTIONS = [
  { value: '1', label: '1+ years' },
  { value: '3', label: '3+ years' },
  { value: '5', label: '5+ years' },
  { value: '10', label: '10+ years' },
  { value: '15', label: '15+ years' },
  { value: '20', label: '20+ years' },
];

// copy.md §4 "Mode options: Home tuition / Online / At tutor's place" -- the
// data layer splits this into two Shikshaqmine columns (Mode of Teaching,
// Place of Teaching); each pill here toggles the matching underlying value.
const MODE_OPTIONS: { label: string; isActive: (f: FilterState) => boolean; toggle: (f: FilterState) => FilterState }[] = [
  {
    label: "Home tuition",
    isActive: (f) => f.placeOfTeaching.includes("Student's Home"),
    toggle: (f) => ({
      ...f,
      placeOfTeaching: f.placeOfTeaching.includes("Student's Home")
        ? f.placeOfTeaching.filter((v) => v !== "Student's Home")
        : [...f.placeOfTeaching, "Student's Home"],
    }),
  },
  {
    label: 'Online',
    isActive: (f) => f.modeOfTeaching.includes('Online'),
    toggle: (f) => ({
      ...f,
      modeOfTeaching: f.modeOfTeaching.includes('Online')
        ? f.modeOfTeaching.filter((v) => v !== 'Online')
        : [...f.modeOfTeaching, 'Online'],
    }),
  },
  {
    label: "At tutor's place",
    isActive: (f) => f.placeOfTeaching.includes("Teacher's place"),
    toggle: (f) => ({
      ...f,
      placeOfTeaching: f.placeOfTeaching.includes("Teacher's place")
        ? f.placeOfTeaching.filter((v) => v !== "Teacher's place")
        : [...f.placeOfTeaching, "Teacher's place"],
    }),
  },
];

const AREA_GROUPS: { label: string; areas: string[] }[] = [
  { label: 'South Kolkata', areas: ['Alipore', 'Ballygunge', 'Behala', 'Bhowanipore', 'Gariahat', 'Garia', 'Jadavpur', 'Kasba', 'New Alipore', 'Southern Avenue', 'Tollygunge', 'Hazra'] },
  { label: 'Salt Lake & New Town', areas: ['Baguihati', 'Belur', 'Howrah', 'Joka', 'Newtown', 'Rajarhat', 'Salt Lake', 'Science City'] },
  { label: 'North Kolkata', areas: ['Dum Dum', 'Entally', 'Girish Park', 'Nagarbazar', 'Sealdah', 'Shyam Bazar', 'Tangra'] },
  { label: 'Central Kolkata', areas: ['Camac Street', 'College Street', 'Elgin', 'Minto Park', 'Park Street', 'Park Circus'] },
  { label: 'East Kolkata', areas: ['Kankurgachi', 'Laketown', 'Phoolbagan', 'Ultadanga'] },
  { label: 'South East Kolkata', areas: ['Anandapur', 'Parnasree', 'Rabindra Nagar'] },
  { label: 'Greater Kolkata', areas: ['Hooghly'] },
];

export interface FilterGroupsProps {
  filters: FilterState;
  onFilterChange: (filters: FilterState) => void;
  /** Real result count for the current filter set -- never invented (design.md §0.10). */
  resultCount: number;
  /** Browse's same-page Teachers/Past-papers toggle (viewMode). A teacher
   *  has no school or exam-type facet, and a paper has no area/fee/mode/
   *  class-size/experience -- each mode gets the groups that apply to it
   *  rather than always showing the teacher set regardless of which
   *  results are actually on screen. Defaults to 'teachers' so every
   *  existing caller (which never filters papers) keeps its current
   *  groups untouched. */
  mode?: 'teachers' | 'papers';
}

type ArrayFilterKey = 'subjects' | 'classes' | 'boards' | 'classSize' | 'areas' | 'schools' | 'examTypes';

/* core-02-filters.png heads each group with a small square icon tile and a
   sentence-case heading ("Subjects taught"), not the all-caps micro-label this
   rendered. The icons make a long sheet scannable, which an eight-group filter
   panel needs more than most screens.

   Owner mobile QA (F7): with every group's options rendered flat and always
   visible, Subjects + Classes alone filled the sheet before a user reached
   Areas -- "make each category ... an expandable dropdown". Each group is now
   an `AccordionItem` -- collapsed by default, expanding on tap to reveal its
   options -- using the project's existing shadcn Accordion primitive (already
   wired to the `accordion-down`/`accordion-up` keyframes in
   tailwind.config.ts) rather than hand-rolled collapse logic. A group opens
   by default only if it already has an active selection, so a returning user
   sees what's applied without an extra tap. */
function groupItem(
  value: string,
  label: string,
  Icon: LucideIcon,
  selectedCount: number,
  children: React.ReactNode,
) {
  return (
    /* Concentric radius fix: on the desktop rail this card sits inside
       FilterRail's BentoPanel (rounded-bento = 30px, default 20px
       padding) -- 30 - 20 = 10px, exactly rounded-md, not another copy of
       the outer 30px. The mobile sheet's body has no rounded outer
       surface around it (full-screen sheet, flat background), but 30px
       read as oversized/blobby on a compact accordion row there too, so
       the same smaller radius serves both contexts. */
    <AccordionItem
      key={value}
      value={value}
      className="overflow-hidden rounded-md border-b-0 bg-card"
    >
      <AccordionTrigger className="px-[18px] py-[14px] hover:no-underline">
        <div className="flex min-w-0 flex-1 items-center gap-[10px]">
          <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[10px] bg-muted text-warm-secondary">
            <Icon className="size-4" aria-hidden="true" />
          </span>
          <span className="truncate font-display text-[16px] font-bold tracking-[-0.02em] text-foreground">{label}</span>
          {selectedCount > 0 && (
            <span className="ml-auto flex-none text-[13px] font-bold tabular-nums text-brand-deep">
              {selectedCount}
            </span>
          )}
        </div>
      </AccordionTrigger>
      <AccordionContent className="px-[18px] pb-[18px] pt-0">{children}</AccordionContent>
    </AccordionItem>
  );
}

/** The shared body -- icon-labelled groups of 44px pill toggles + the fee
 * slider. Rendered once, used inside both the mobile Sheet and the desktop
 * rail (design.md §2.3 / components.md C6). */
export function FilterGroupsBody({
  filters,
  onFilterChange,
  selectedTone = 'facet-on',
  mode = 'teachers',
}: Pick<FilterGroupsProps, 'filters' | 'onFilterChange' | 'mode'> & {
  /**
   * Selected-pill tone. Mobile sheet (S2 mockup) selects in orange
   * (`facet-on`, the default); the desktop rail (D2 mockup) selects in
   * solid black instead -- trusted literally per the binding-rules owner
   * override even though it diverges from the mobile treatment.
   */
  selectedTone?: 'facet-on' | 'dark';
}) {
  const isPapers = mode === 'papers';

  // Real school list, same source PastPapers'/the search overlay's own
  // facet dropdown reads -- not a second, possibly-stale copy of it.
  const { ensureLoaded, schools: realSchools } = useSearchIndex();
  useEffect(() => {
    if (isPapers) ensureLoaded();
  }, [isPapers, ensureLoaded]);

  const [subjectQuery, setSubjectQuery] = useState('');
  const filteredSubjects = subjectQuery.trim()
    ? SUBJECTS.filter((s) => s.toLowerCase().includes(subjectQuery.trim().toLowerCase()))
    : SUBJECTS;

  const [schoolQuery, setSchoolQuery] = useState('');
  const filteredSchools = schoolQuery.trim()
    ? realSchools.filter((s) => s.toLowerCase().includes(schoolQuery.trim().toLowerCase()))
    : realSchools;

  const [areaQuery, setAreaQuery] = useState('');
  const filteredAreaGroups = areaQuery.trim()
    ? AREA_GROUPS.map((g) => ({
        label: g.label,
        areas: g.areas.filter((a) => a.toLowerCase().includes(areaQuery.trim().toLowerCase())),
      })).filter((g) => g.areas.length > 0)
    : AREA_GROUPS;

  const toggle = (category: ArrayFilterKey, value: string) => {
    const current = filters[category];
    onFilterChange({
      ...filters,
      [category]: current.includes(value) ? current.filter((v) => v !== value) : [...current, value],
    });
  };

  /* Owner mobile QA (F7) "reduce the size of the chips": visual size only  -- 
     the invisible `.tap-44` overlay Chip already applies to every interactive
     chip (ui/chip.tsx) keeps the real tap target at the 44px floor regardless
     of how small the label reads, so shrinking height/padding/type here never
     drops below the accessible minimum.

     px-2.5, not px-3: at the rail's 184px usable width, "Accounts" and
     "Economics" missed pairing onto one row by 3px at px-3, so an 8-9 letter
     subject routinely sat alone on its own row with ~100px empty beside it.
     Measured live -- the same 4px-per-side trim (paired with the container's
     gap-[6px] below, was 8px) lets Accounts+Economics and several other
     pairs share a row instead. */
  const pill = (label: string, active: boolean, onClick: () => void, key?: string) => (
    <Chip
      key={key ?? label}
      tone={active ? selectedTone : 'facet'}
      size={44}
      onClick={onClick}
      aria-pressed={active}
      className="h-9 px-2.5 text-meta"
    >
      {label}
    </Chip>
  );

  const feeMin = filters.minFees ?? 0;
  const feeMax = filters.maxFees ?? 20000;
  const modeSelectedCount = MODE_OPTIONS.filter((opt) => opt.isActive(filters)).length;
  const feeSelectedCount = filters.minFees != null || filters.maxFees != null ? 1 : 0;
  const experienceSelectedCount = filters.minExperience != null ? 1 : 0;

  /* Every group starts collapsed, including ones that already carry a
     selection. Auto-opening on an active filter sounded helpful, but arriving
     from a "Maths teachers" chip means subjects is pre-filled, so the rail
     opened onto thirty-odd subject options and pushed every other group off
     the screen -- on the exact journey where the reader has already told us
     what they want. The count badge on each header says what is applied, so
     nothing is hidden by keeping them shut. */

  return (
    <>
    <Accordion type="multiple" className="flex flex-col gap-seam">
      {groupItem(
        'subjects',
        'Subjects taught',
        BookOpen,
        filters.subjects.length,
        <div className="flex flex-col gap-3">
          {/* Owner mobile QA (F7) "everything ... goes for search ... it's
              becoming too long" -- Subjects (33 options) is the other flat
              list long enough to need in-list search alongside Areas. */}
          <Input
            type="search"
            value={subjectQuery}
            onChange={(e) => setSubjectQuery(e.target.value)}
            placeholder="Search subjects…"
            aria-label="Search subjects"
            className="h-10 text-sm"
          />
          {filteredSubjects.length === 0 ? (
            <p className="text-body-secondary text-warm-meta">No subjects match &ldquo;{subjectQuery}&rdquo;.</p>
          ) : (
            <div className="flex flex-wrap gap-[6px]">
              {filteredSubjects.map((s) => pill(s, filters.subjects.includes(s), () => toggle('subjects', s)))}
            </div>
          )}
        </div>,
      )}

      {groupItem(
        'classes',
        'Classes taught',
        GraduationCap,
        filters.classes.length,
        // Handoff O-003: number grid, not chips -- grid-cols-6 gap-2, h-11
        // rounded-[14px], selected bg-brand-subtle/text-brand-deep.
        <div className="grid grid-cols-6 gap-2">
          {CLASSES.map((c) => {
            const selected = filters.classes.includes(c);
            return (
              <button
                key={c}
                type="button"
                onClick={() => toggle('classes', c)}
                aria-pressed={selected}
                aria-label={c === 'UG' ? 'UG' : `Class ${c}`}
                /* M14/D8.4: this grid is a raw <button>, not the Chip
                   primitive (whose "no active:scale" is a documented,
                   intentional spec exception elsewhere) -- it had neither a
                   pressed state nor a visible focus ring, so a keyboard
                   user got no feedback at all and a tap only ever showed
                   the *toggled* colour, never a distinct "registering the
                   tap" state. motion-reduce drops the scale, keeping the
                   colour change. */
                className={`flex h-11 items-center justify-center rounded-[14px] text-[14px] font-extrabold tabular-nums transition-[background-color,color,transform] duration-tap active:scale-[0.96] motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                  selected ? 'bg-brand-subtle text-brand-deep' : 'bg-muted text-foreground'
                }`}
              >
                {c}
              </button>
            );
          })}
        </div>,
      )}

      {/* Areas/Fee/Mode are teacher-only facets -- a paper has no travel
          radius, no fee and no "online vs at home". */}
      {!isPapers && groupItem(
        'areas',
        'Areas',
        MapPin,
        filters.areas.length,
        <div className="flex flex-col gap-4">
          <Input
            type="search"
            value={areaQuery}
            onChange={(e) => setAreaQuery(e.target.value)}
            placeholder="Search areas…"
            aria-label="Search areas"
            className="h-10 text-sm"
          />
          {filteredAreaGroups.length === 0 ? (
            <p className="text-body-secondary text-warm-meta">No areas match &ldquo;{areaQuery}&rdquo;.</p>
          ) : (
            filteredAreaGroups.map((group) => (
              <div key={group.label}>
                <p className="mb-2 text-label font-medium uppercase tracking-wide text-warm-meta">{group.label}</p>
                <div className="flex flex-wrap gap-[6px]">
                  {group.areas.map((a) => pill(a, filters.areas.includes(a), () => toggle('areas', a), a))}
                </div>
              </div>
            ))
          )}
        </div>,
      )}

      {!isPapers && groupItem(
        'fee',
        'Monthly fee',
        IndianRupee,
        feeSelectedCount,
        <div className="flex flex-col gap-3">
          {/* Two-handle range: simple overlaid <input type=range> pair -- no
              slider primitive exists in the codebase yet, and the values map
              onto the app's existing monthly Min/Max Fees filter (the only
              fee granularity the data has -- see report). */}
          <div className="relative h-11">
            <div className="pointer-events-none absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-muted" />
            <div
              className="pointer-events-none absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-brand"
              style={{
                left: `${(feeMin / 20000) * 100}%`,
                right: `${100 - (feeMax / 20000) * 100}%`,
              }}
            />
            <input
              type="range"
              min={0}
              max={20000}
              step={500}
              value={feeMin}
              aria-label="Minimum fees per month"
              onChange={(e) => {
                const v = Math.min(Number(e.target.value), feeMax);
                onFilterChange({ ...filters, minFees: v > 0 ? v : null });
              }}
              className="range-thumb pointer-events-none absolute inset-x-0 top-1/2 h-11 w-full -translate-y-1/2 appearance-none bg-transparent"
            />
            <input
              type="range"
              min={0}
              max={20000}
              step={500}
              value={feeMax}
              aria-label="Maximum fees per month"
              onChange={(e) => {
                const v = Math.max(Number(e.target.value), feeMin);
                onFilterChange({ ...filters, maxFees: v < 20000 ? v : null });
              }}
              className="range-thumb pointer-events-none absolute inset-x-0 top-1/2 h-11 w-full -translate-y-1/2 appearance-none bg-transparent"
            />
          </div>
          <p className="text-body-secondary text-warm-meta tabular-nums">
            ₹{feeMin.toLocaleString('en-IN')} - ₹{feeMax.toLocaleString('en-IN')}/mo
          </p>
        </div>,
      )}

      {!isPapers && groupItem(
        'mode',
        'Mode of teaching',
        Wifi,
        modeSelectedCount,
        <div className="flex flex-wrap gap-[6px]">
          {MODE_OPTIONS.map((opt) =>
            pill(opt.label, opt.isActive(filters), () => onFilterChange(opt.toggle(filters)), opt.label),
          )}
        </div>,
      )}

      {/* Kept for functionality -- not one of design.md's five groups, but the
          only way to set board/class-size/experience filters, and Board feeds
          the `filter_boards` URL contract the SEO routes depend on. Board
          applies to both teachers and papers, so it's the one group that
          never gets hidden by mode. */}
      {groupItem(
        'boards',
        'Boards',
        Landmark,
        filters.boards.length,
        <div className="flex flex-wrap gap-[6px]">
          {BOARDS.map((b) => pill(b, filters.boards.includes(b), () => toggle('boards', b), b))}
        </div>,
      )}

      {/* School + Category (exam_type) -- papers-only, the two facets a
          teacher card has nothing equivalent to. */}
      {isPapers && groupItem(
        'schools',
        'School',
        SchoolIcon,
        filters.schools.length,
        <div className="flex flex-col gap-3">
          <Input
            type="search"
            value={schoolQuery}
            onChange={(e) => setSchoolQuery(e.target.value)}
            placeholder="Search schools…"
            aria-label="Search schools"
            className="h-10 text-sm"
          />
          {filteredSchools.length === 0 ? (
            <p className="text-body-secondary text-warm-meta">
              {realSchools.length === 0 ? 'Loading schools…' : `No schools match "${schoolQuery}".`}
            </p>
          ) : (
            <div className="scrollbar-slim flex max-h-[220px] flex-wrap gap-[8px] overflow-y-auto">
              {filteredSchools.map((s) => pill(s, filters.schools.includes(s), () => toggle('schools', s), s))}
            </div>
          )}
        </div>,
      )}

      {isPapers && groupItem(
        'examTypes',
        'Category',
        FileText,
        filters.examTypes.length,
        <div className="flex flex-wrap gap-[6px]">
          {EXAM_TYPES.map((e) => pill(e, filters.examTypes.includes(e), () => toggle('examTypes', e), e))}
        </div>,
      )}

      {!isPapers && groupItem(
        'classSize',
        'Class size',
        Users,
        filters.classSize.length,
        <div className="flex flex-wrap gap-[6px]">
          {CLASS_SIZE.map((s) =>
            pill(s === 'Solo' ? 'One-on-one' : s, filters.classSize.includes(s), () => toggle('classSize', s), s),
          )}
        </div>,
      )}

      {!isPapers && groupItem(
        'experience',
        'Experience',
        Clock,
        experienceSelectedCount,
        <Select
          value={filters.minExperience || 'all'}
          onValueChange={(value) => onFilterChange({ ...filters, minExperience: value === 'all' ? null : value })}
        >
          <SelectTrigger className="h-11 w-full text-sm">
            <SelectValue placeholder="Any experience" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any experience</SelectItem>
            {EXPERIENCE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>,
      )}
      </Accordion>

      <style>{`
        .range-thumb::-webkit-slider-thumb {
          pointer-events: auto;
          appearance: none;
          width: 22px;
          height: 22px;
          border-radius: 9999px;
          background: hsl(var(--brand));
          border: 3px solid hsl(var(--background));
          box-shadow: 0 1px 4px hsl(var(--foreground) / 0.3);
          cursor: pointer;
        }
        .range-thumb::-moz-range-thumb {
          pointer-events: auto;
          width: 22px;
          height: 22px;
          border-radius: 9999px;
          background: hsl(var(--brand));
          border: 3px solid hsl(var(--background));
          box-shadow: 0 1px 4px hsl(var(--foreground) / 0.3);
          cursor: pointer;
        }
        .range-thumb::-webkit-slider-runnable-track { background: transparent; }
        .range-thumb::-moz-range-track { background: transparent; }
      `}</style>
    </>
  );
}

export function activeFilterCount(filters: FilterState): number {
  return (
    filters.subjects.length +
    filters.classes.length +
    filters.boards.length +
    filters.classSize.length +
    filters.areas.length +
    filters.modeOfTeaching.length +
    filters.placeOfTeaching.length +
    filters.schools.length +
    filters.examTypes.length +
    (filters.minFees != null ? 1 : 0) +
    (filters.maxFees != null ? 1 : 0) +
    (filters.minExperience != null ? 1 : 0)
  );
}

const EMPTY_FILTERS: FilterState = {
  subjects: [],
  classes: [],
  boards: [],
  classSize: [],
  areas: [],
  modeOfTeaching: [],
  placeOfTeaching: [],
  minFees: null,
  maxFees: null,
  minExperience: null,
  schools: [],
  examTypes: [],
};

/** Mobile presentation -- genuinely full-screen popup (owner mobile QA F7:
 * "Filter should be a full screen pop up" -- the previous 85vh bottom sheet
 * left a visible strip of the page above it). `h-[100dvh]` rather than
 * `100vh`: the dynamic viewport unit accounts for a mobile browser's
 * address-bar chrome so the sheet is never clipped short of the real
 * viewport. Stack: sticky header (Filters title + close X, Clear all) →
 * scrollable body (flex:1, min-height:0, overflow-y:auto) → sticky footer (N
 * filters active + Show N teachers). No Apply button -- chips apply instantly
 * (components.md §7); the footer's button just closes the sheet, same as the
 * header's X. */
export function FilterSheet({
  open,
  onOpenChange,
  filters,
  onFilterChange,
  resultCount,
  resultCountPending = false,
  onClear,
  mode = 'teachers',
  restoreFocusRef,
}: FilterGroupsProps & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Clears every filter at once. The sheet applies chips instantly and has no
   *  Apply button, so without this the only way back from a nine-filter dead
   *  end was to un-tap nine chips one at a time. */
  onClear?: () => void;
  /** RM2 -- true while `resultCount` is a network-derived number that may not
   *  yet reflect the latest chip tap (the caller's instant, no-network pool
   *  estimate isn't ready yet). The CTA dims the number and shows a small
   *  spinner instead of a confidently-stale one; never set once the caller
   *  can answer instantly. */
  resultCountPending?: boolean;
  /** R4G3: this sheet's `open` is driven externally (a plain button in the
   *  caller, not a `SheetTrigger`), so Radix has no trigger of its own to
   *  return focus to on close -- Escape, the X and "Show N teachers" all left
   *  focus on `<body>`. The caller passes a ref to whatever opened the sheet
   *  (its "Filters" button) and gets it focused back on every close path. */
  restoreFocusRef?: React.RefObject<HTMLElement>;
}) {
  const count = activeFilterCount(filters);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        hideCloseButton
        aria-describedby={undefined}
        onCloseAutoFocus={(e) => {
          if (restoreFocusRef?.current) {
            e.preventDefault();
            restoreFocusRef.current.focus();
          }
        }}
        /* Round-1 deferral: this full-screen sheet had no entrance animation
           of its own -- SheetContent's shared slide-in-from-bottom still
           applies (untouched), but this is the one sheet in the product
           that wants the site's *lift* timing rather than the generic
           500ms/ease-snap every other sheet/dialog shares (that spec is
           intentionally shared in ui/sheet.tsx, which this stream doesn't
           own -- overridden here per-instance instead). The `!` modifier is
           load-bearing: this project's `cn()` only teaches tailwind-merge
           about its custom font-size scale, not custom duration/easing
           theme keys, so `duration-500` and `duration-lift` are two
           unrelated Tailwind classes to it -- both would ship in the
           className, and without `!important` which one wins depends on
           unrelated Tailwind generation order, not source order here.
           duration-lift (300ms) in, duration-exit (130ms) out -- CRAFT.md
           "exits are softer and shorter than
           enters" -- both on ease-settle. Adds a fade so the motion reads
           as opacity+transform (CRAFT.md §2), not transform alone.
           motion-reduce collapses the slide distance to 0 and keeps only
           the fade, per CRAFT.md's "keep the fades, drop the movement". */
        className="flex h-[100dvh] max-h-[100dvh] flex-col rounded-none p-0 !ease-settle data-[state=open]:!duration-lift data-[state=closed]:!duration-exit data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 motion-reduce:data-[state=open]:!slide-in-from-bottom-0 motion-reduce:data-[state=closed]:!slide-out-to-bottom-0"
      >
        {/* Sticky header. The default Radix close X that SheetContent renders
            (top-right, 40px, 70% opacity) is hidden via
            `[&>button:last-child]:hidden` above in favour of this one: owner
            mobile QA (F7) "There should be a visible X also" -- at full-screen
            size a small corner glyph wasn't prominent enough, so this is a
            44px circular disc sitting in the header next to the title,
            unmistakable regardless of what else is on the page. */}
        {/* Handoff O-002: header -- bg-card rounded-b-bento, sticky. */}
        <div className="sticky top-0 z-10 flex flex-none items-center justify-between gap-3 rounded-b-bento bg-card px-5 pb-4 pt-[14px]">
          {/* SheetTitle, not a bare h2: Radix needs a DialogTitle inside
              DialogContent to label the dialog for assistive tech, and warns
              otherwise. It renders an h2 anyway, so nothing changes visually. */}
          <SheetTitle className="font-display text-[21px] font-extrabold tracking-[-0.03em] text-foreground">Filters</SheetTitle>
          <div className="flex flex-none items-center gap-[6px]">
            {/* "a Clear all chip appears once two or more are active"
                (micro-03-buttons-fields.png). It was rendered unconditionally, so
                a sheet with nothing selected offered to clear nothing -- the same
                empty-affordance problem as the "0 filters active" line beneath it.
                Two, not one: clearing a single filter is a tap on the chip
                itself. */}
            {count >= 2 && (
              <button
                type="button"
                onClick={() => onFilterChange(EMPTY_FILTERS)}
                className="flex h-11 flex-none items-center rounded-full bg-muted px-[14px] text-[14px] font-semibold text-warm-secondary transition-colors duration-tap hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                Clear all
              </button>
            )}
            <SheetClose className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-muted text-foreground transition-colors duration-tap hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
              <X className="h-5 w-5" aria-hidden="true" />
              <span className="sr-only">Close filters</span>
            </SheetClose>
          </div>
        </div>

        {/* Scrollable body -- must stay flex:1/min-height:0 or long option sets
            clip (design.md §2.3). */}
        <div className="min-h-0 flex-1 overflow-y-auto bg-background px-[16px] pb-[16px] pt-[4px]">
          <FilterGroupsBody filters={filters} onFilterChange={onFilterChange} mode={mode} />
        </div>

        {/* Handoff O-002: footer -- bg-card rounded-t-bento, pinned. */}
        <div className="flex flex-none items-center justify-between gap-[10px] rounded-t-bento bg-card px-5 pb-[26px] pt-4">
          {/* core-02-filters.png shows "2 filters active" alongside two chosen
              chips. With nothing chosen this read "0 filters active", which is
              the same advertise-a-zero pattern found on About, sign-in and the
              trust strip -- and here it is also just noise, since the sheet you
              have not touched yet obviously has no filters on. Empty until
              there is something to report. */}
          {/* The count doubles as the way out once anything is on: undoing a
              filter set one chip at a time was the only route back. */}
          {count > 0 && onClear ? (
            <button
              type="button"
              onClick={onClear}
              className="-mx-1 flex min-h-11 items-center px-1 text-[13px] font-semibold text-warm-secondary underline underline-offset-2 transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Clear {count} filter{count === 1 ? '' : 's'}
            </button>
          ) : (
            <span className="text-[13px] text-warm-secondary">
              {count > 0 ? `${count} filter${count === 1 ? '' : 's'} active` : ''}
            </span>
          )}
          <Button
            variant="primary"
            size={54}
            className="rounded-full px-[22px] text-[15px] font-bold"
            onClick={() => onOpenChange(false)}
          >
            {/* RM2: while the count is only a network number that may not
                reflect the chip just tapped yet, dim it and show a small
                spinner instead of a confidently-stale "Show N" -- the caller
                only sets resultCountPending when it has no instant,
                no-network estimate to show yet (see Browse.tsx). */}
            {resultCountPending && (
              <span
                aria-hidden="true"
                className="mr-2 inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent align-[-2px] motion-reduce:animate-none"
              />
            )}
            <span className={resultCountPending ? 'opacity-60 transition-opacity duration-tap' : 'transition-opacity duration-tap'}>
              Show {resultCount} {mode === 'papers' ? 'papers' : 'teachers'}
            </span>
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Desktop presentation -- persistent 284px rail, the sheet's content
 * unwrapped (design.md §5 / components.md C6). No Clear-all/footer chrome;
 * the sticky filter bar above the results carries the applied chips and the
 * global "Clear all" already. */
export function FilterRail({ filters, onFilterChange, mode = 'teachers' }: FilterGroupsProps) {
  return (
    <nav aria-label="Filters" className="hidden lg:block lg:w-[284px] lg:flex-none">
      {/* Handoff B-014: the rail is a BentoPanel now -- sticky top-24, no
          border/shadow, separated from the results panel by fill alone.
          fill="muted", not "card": with the lg:gap-8 that used to sit
          between the rail and the results panel now closed to gap-0, two
          "card" fills touching left no visible seam at all -- "separated by
          fill alone" was a promise this code never actually kept. */}
      <BentoPanel fill="muted" className="sticky top-24">
        {/* The group labels below are h3. The mobile sheet gives them an h2
            ("Filters") to sit under; the rail draws no such title, which left a
            h1 -> h3 skip on desktop. This supplies the level without adding a
            heading the mockup does not show. */}
        <h2 className="sr-only">Filters</h2>
        <FilterGroupsBody filters={filters} onFilterChange={onFilterChange} selectedTone="dark" mode={mode} />
      </BentoPanel>
    </nav>
  );
}
