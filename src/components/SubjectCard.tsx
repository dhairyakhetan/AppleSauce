import { Link } from 'react-router-dom';
import { memo } from 'react';
import {
  Atom,
  BookOpen,
  Brain,
  Briefcase,
  Calculator,
  Dna,
  FileSpreadsheet,
  FlaskConical,
  Globe,
  GraduationCap,
  House,
  Landmark,
  Languages,
  Leaf,
  Monitor,
  Palette,
  Scale,
  Stethoscope,
  Target,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import { getSubjectPalette, paletteFromSeed, resolveSubjectFamily, SUBJECT_SEEDS } from '@/lib/subject-palette';

// Deterministic per-subject shape variant so the same subject always gets the
// same mark across renders/reloads (matches the seeded-palette determinism
// above), instead of a random flicker.
const SHAPE_VARIANTS = ['blob', 'star', 'squiggle'] as const;

// Subjects outside the 8 seeded families (Sanskrit, Bengali, JEE, NEET, ...)
// resolve to `FALLBACK_SUBJECT_PALETTE` — a single flat grey that looks dull
// and "broken" sitting in an otherwise colorful grid. Rather than inventing a
// new hex, an unmatched subject is deterministically assigned one of the 8
// existing seed families (same generator, same formula) by hashing its name —
// so overflow subjects still look intentional and stay visually stable across
// renders/reloads instead of looking grey-and-forgotten.
const SEED_FAMILIES = Object.values(SUBJECT_SEEDS);

function hashString(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function paletteForSubject(name: string) {
  if (resolveSubjectFamily(name)) return getSubjectPalette(name);
  const seed = SEED_FAMILIES[hashString(name) % SEED_FAMILIES.length];
  return paletteFromSeed(seed);
}

export type SubjectCardContext = 'teachers' | 'papers';

interface SubjectCardProps {
  name: string;
  slug: string;
  /** Icon override — if omitted, an icon is resolved internally by subject
   *  name (one per subject, chosen once here rather than per page). */
  iconComponent?: React.ReactNode;
  index?: number;
  isVisible?: boolean;
  /** Which surface this tile renders for. Controls the meta line copy and
   *  the navigation target. Defaults to 'teachers' (original behaviour). */
  context?: SubjectCardContext;
  /** Live teacher count for this subject — required copy in teachers context. */
  teacherCount?: number;
  /** Live paper count for this subject — shown in both contexts. */
  paperCount?: number;
}

// Icons are lucide, one per subject, chosen once here rather than repeated
// per page. Keys match `src/utils/searchFacets.ts` SUBJECTS plus known aliases
// ("Mathematics" for "Maths", "Computer" for "Computers").
const SUBJECT_ICONS: Record<string, typeof BookOpen> = {
  Accounts: Landmark,
  ACT: GraduationCap,
  AP: GraduationCap,
  Bengali: Languages,
  Biology: Dna,
  'Business Studies': Briefcase,
  CA: FileSpreadsheet,
  CAT: Target,
  Chemistry: FlaskConical,
  CLAT: Scale,
  Commerce: TrendingUp,
  Computer: Monitor,
  Computers: Monitor,
  'Drawing & Painting': Palette,
  Economics: Wallet,
  English: BookOpen,
  'Environmental Science': Leaf,
  Geography: Globe,
  Hindi: Languages,
  'History & Civics': Landmark,
  'Home Science': House,
  JEE: Atom,
  'Legal Studies': Scale,
  Maths: Calculator,
  Mathematics: Calculator,
  NEET: Stethoscope,
  NMAT: GraduationCap,
  Physics: Atom,
  'Political Science': Landmark,
  Psychology: Brain,
  SAT: GraduationCap,
  Science: FlaskConical,
  Sanskrit: Languages,
  'Social Studies': Globe,
  Sociology: Users,
};

function pluralize(count: number, word: string) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function SubjectCardComponent({
  name,
  iconComponent,
  context = 'teachers',
  teacherCount = 0,
  paperCount = 0,
}: SubjectCardProps) {
  const Icon = SUBJECT_ICONS[name] ?? BookOpen;
  const palette = paletteForSubject(name);

  // Both contexts go to the fast, generic filtered listing rather than a
  // subject's dedicated SEO page — those pages (SubjectPage.tsx/BoardPage.tsx)
  // stay reserved for search-engine traffic; real in-app clicks get the
  // quicker Browse/PastPapers view with the same filter pre-applied.
  const href =
    context === 'papers'
      ? `/past-papers/results?filter_subjects=${encodeURIComponent(name)}`
      : `/all-tuition-teachers-in-kolkata?filter_subjects=${encodeURIComponent(name)}`;

  // DESIGN_SYSTEM §13 "never render a literal zero": with papers data still
  // unseeded, every card in the grid was reading "... · 0 papers" — not an
  // honest "empty" state but a broken-looking one, repeated on every tile.
  // Drop the paper-count clause entirely when there's nothing to report.
  const meta =
    context === 'papers'
      ? pluralize(paperCount, 'paper')
      : paperCount > 0
        ? `${pluralize(teacherCount, 'teacher')} · ${pluralize(paperCount, 'paper')}`
        : pluralize(teacherCount, 'teacher');

  /* VISUAL_LANGUAGE §3/§5 — subject-tinted card: background = subject `tint`,
     icon tile = subject `solid` holding a `badgeText`-coloured icon, title in
     subject `text`, meta in subject `meta`. "Structural contrast is
     intentional" (§5): tinted cards drop the ring/shadow that neutral cards
     (TeacherCard) keep — the tint alone carries the surface. Inline style is
     the sanctioned exception for getSubjectPalette values. */
  // No signpost clip-path. It cut a pointed left edge into every card, which is
  // what was clipping the icon tile, and Home concepts 2a draws these as plain
  // rounded rectangles — the tint and the icon carry the identity.

  return (
    <Link
      to={href}
      /* Geometry straight off Home concepts 2a: radius 18, padding 14, a 30px
         icon tile at radius 10 with 10px below it, name 19px/800/-0.03em, meta
         12.5px 2px under it. Was radius 16 / padding 16 / a 40px tile at radius
         8, which read as a chunkier, blunter card than the mosaic the spec
         draws. */
      className="relative block min-h-11 rounded-[18px] p-[14px] text-left transition-transform duration-hover hover:-translate-y-0.5 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none motion-reduce:hover:translate-y-0"
      style={{ backgroundColor: palette.tint }}
    >
      {/* No cut-paper mark. The spec's subject tile is the tint, the icon, the
          name and the count — nothing else. The decorative shape added here sat
          at -bottom-4 -right-4 under overflow-hidden, so what it actually
          produced was a clipped wedge in the corner of every card. */}
      <span
        className="mb-[10px] flex h-[30px] w-[30px] items-center justify-center rounded-[10px]"
        style={{ backgroundColor: palette.solid, color: palette.badgeText }}
      >
        {iconComponent ?? <Icon className="h-4 w-4" strokeWidth={2} aria-hidden="true" />}
      </span>
      <h3
        className="truncate font-display text-[19px] font-extrabold tracking-[-0.03em] text-balance"
        style={{ color: palette.text }}
        title={name}
      >
        {name}
      </h3>
      <p className="mt-0.5 truncate text-[13px] tabular-nums" style={{ color: palette.meta }}>
        {meta}
      </p>
    </Link>
  );
}

export const SubjectCard = memo(SubjectCardComponent);
