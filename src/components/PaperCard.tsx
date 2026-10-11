import { Link } from 'react-router-dom';
import { HelpCircle, Award } from 'lucide-react';
import { getSubjectPalette } from '@/lib/subject-palette';

export interface PaperCardPaper {
  id: string;
  title: string;
  school: string;
  subject: string;
  class: string;
  board: string;
  exam_type: string;
  year: number;
  /** Not yet collected by the papers table — undefined hides the stat, never "0 questions". */
  question_count?: number | null;
  total_marks?: number | null;
  file_url: string | null;
}

export type PaperCardVariant = 'recent' | 'result' | 'compact';

interface PaperCardProps {
  paper: PaperCardPaper;
  variant?: PaperCardVariant;
  /** Recent-only, factual sticker text (e.g. "New this week"). Never marketing copy. */
  sticker?: string;
}

/**
 * A paper is a MILESTONE on the wayfinding spine (VISUAL_DIRECTION §2), so the
 * card is built as a route marker: subject signpost chip, then the title, then
 * the school, then a distance-marker footer carrying class + board + year in
 * tabular numerals so a column of cards compares cleanly.
 *
 * CRISP surface (VISUAL_DIRECTION §4): these always live inside a scrollable
 * list of comparable items, so there is deliberately NO rotation, tape, torn
 * edge or grain here — not even on the `sticker`, which was previously
 * rotated 5deg. It is now a flat, square-on badge that pops in.
 *
 * Every value except subject color is a Tailwind token. The previous
 * implementation styled the entire card with inline `style` (including nine
 * inline font sizes and two raw `hsl(var(--foreground) / …)` literals), which
 * violated DESIGN_SYSTEM §1.1/§1.2 and §3. Subject color via getSubjectPalette()
 * is the one sanctioned inline-style exception.
 */
export function PaperCard({ paper, variant = 'result', sticker }: PaperCardProps) {
  const colors = getSubjectPalette(paper.subject);
  const isCompact = variant === 'compact';
  const isRecent = variant === 'recent';
  const isResult = variant === 'result';

  const stats = isResult
    ? [
        paper.question_count ? { icon: HelpCircle, label: `${paper.question_count} questions` } : null,
        paper.total_marks ? { icon: Award, label: `${paper.total_marks} marks` } : null,
      ].filter((s): s is { icon: typeof HelpCircle; label: string } => s !== null)
    : [];

  return (
    <Link
      to={`/past-papers/${paper.id}`}
      className={`shikshaq-paper-card relative flex h-full flex-col rounded-2xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
        isCompact ? 'p-4' : 'p-4 sm:p-6'
      }`}
      style={{ backgroundColor: colors.tint }}
    >
      {isRecent && sticker && (
        <span className="absolute -top-2 right-4 rounded-full bg-foreground px-3 py-1 text-label font-bold uppercase text-background">
          {sticker}
        </span>
      )}

      {!isCompact && (
        <span className="mb-3 flex flex-wrap items-center gap-2">
          {/* Signpost = subject (VISUAL_DIRECTION §2). Pointed end, subject fill. */}
          <span
            className="signpost inline-flex min-h-6 items-center py-1 pl-3 text-label font-bold uppercase"
            style={{ backgroundColor: colors.solid, color: colors.badgeText }}
          >
            {paper.subject}
          </span>
          {/* Route marker = board, distance marker = class. Tabular so a grid
              of cards lines its numerals up column-to-column. */}
          <span
            className="inline-flex min-h-6 items-center rounded-full px-3 py-1 text-label font-bold uppercase tabular-nums"
            style={{ backgroundColor: colors.tint, color: colors.text, boxShadow: `inset 0 0 0 1px ${colors.meta}` }}
          >
            Class {paper.class} · {paper.board}
          </span>
        </span>
      )}

      <span
        className={`block break-words ${isCompact ? 'text-card-title' : 'text-card-title-lg'} font-bold`}
        style={{ color: colors.text }}
      >
        {paper.title}
      </span>

      <span className="mt-1 block break-words text-meta font-medium" style={{ color: colors.meta }}>
        {paper.school}
      </span>

      {stats.length > 0 && (
        <span className="mt-3 flex flex-wrap gap-4 text-meta font-medium" style={{ color: colors.meta }}>
          {stats.map(({ icon: Icon, label }) => (
            <span key={label} className="flex items-center gap-2">
              <Icon size={13} strokeWidth={2} aria-hidden="true" />
              {label}
            </span>
          ))}
        </span>
      )}

      {/* mt-auto anchors the footer so every card in a row shares one baseline
          regardless of how many lines the title wraps to (DESIGN_SYSTEM §13). */}
      {(isRecent || isResult) && (
        <span
          className="mt-auto flex items-center justify-between gap-3 pt-4 text-label"
          style={{ color: colors.meta, boxShadow: `inset 0 1px 0 ${colors.meta}` }}
        >
          <span className="truncate">Paper © {paper.school}</span>
          <span className="flex-none font-bold tabular-nums">{paper.year}</span>
        </span>
      )}

      {isCompact && (
        <span className="mt-3 block text-meta tabular-nums" style={{ color: colors.meta }}>
          {paper.board} · Class {paper.class} · {paper.exam_type} {paper.year}
        </span>
      )}
    </Link>
  );
}
