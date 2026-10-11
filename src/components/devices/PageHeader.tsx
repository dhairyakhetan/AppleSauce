import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { SpeechTag } from './SpeechTag';
import { StarburstBadge } from './StarburstBadge';

/**
 * THE FIRST-FOLD SYSTEM.
 *
 * Owner verdict on the first overhaul wave (VISUAL_DIRECTION.md §9a): every
 * page opened on navbar → h1 → content, which read as boring and inconsistent.
 * The cause was structural — work was scoped per page, so twelve pages each
 * invented their own restrained opening. This component is the fix: one shared
 * opening used by every route, varied by colour, ground and accent, so pages
 * feel individual but cannot drift apart again.
 *
 * The ruling was "eyecandy yet functional" — so this is NOT a decorative band.
 * `children` is where the page's real work goes (a search field, filters, a
 * primary action) and it sits INSIDE the fold, not below it.
 *
 * Because the ground stays light (dark footer only), impact has to come from
 * saturated colour, heavy display type and pattern. Pass genuinely saturated
 * colours — tints will read as the same boring page.
 */
export interface PageHeaderProps {
  /** Small routing label above the title, e.g. "Past papers" or "ICSE". */
  eyebrow?: ReactNode;
  /** The page title. Use `emphasis` to marker-highlight part of it. */
  title: ReactNode;
  /** Supporting sentence. Keep to one line at 375px. */
  lede?: ReactNode;
  /**
   * Floating annotation tags — the replacement for a boring subtitle line.
   * Reference: pltm. Two or three maximum.
   */
  tags?: Array<{ label: ReactNode; dotColor?: string }>;
  /** Corner badge, e.g. "Free", "New". Reference: Glassdoor, bitesized. */
  badge?: { label: ReactNode; color?: string; variant?: 'burst' | 'scallop' };
  /** Accent colour driving the band, eyebrow and default tag dots. */
  accent?: string;
  /** Ground pattern behind the fold. `graph` suits papers; `ruled` suits reading. */
  ground?: 'graph' | 'ruled' | 'plain';
  /** Functional content — search, filters, CTA. This is what keeps it usable. */
  children?: ReactNode;
  className?: string;
}

export function PageHeader({
  eyebrow,
  title,
  lede,
  tags,
  badge,
  accent = 'hsl(var(--brand))',
  ground = 'graph',
  children,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        'relative overflow-hidden rounded-b-4xl bg-card px-4 pb-8 pt-6 sm:px-6',
        ground === 'graph' && 'ground-graph',
        ground === 'ruled' && 'ground-ruled',
        className
      )}
    >
      {/* Saturated colour block anchoring the fold. Sits behind content and is
          clipped by the header's own rounding, so it reads as a printed band
          rather than a floating rectangle. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full opacity-[0.13]"
        style={{ background: accent }}
      />

      <div className="relative">
        {eyebrow && (
          <span
            className="mb-2 inline-block text-label uppercase"
            style={{ color: accent }}
          >
            {eyebrow}
          </span>
        )}

        <h1 className="font-display text-display-hero text-foreground">{title}</h1>

        {lede && (
          <p className="mt-3 max-w-prose text-lede text-warm-prose">{lede}</p>
        )}

        {tags && tags.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {tags.map((t, i) => (
              <SpeechTag
                key={i}
                dotColor={t.dotColor ?? accent}
                tail={i % 2 === 0 ? 'bottom-left' : 'bottom-right'}
                tilt={i % 2 === 0 ? -1.5 : 1.5}
              >
                {t.label}
              </SpeechTag>
            ))}
          </div>
        )}

        {/* Functional slot — the "yet functional" half of the ruling. */}
        {children && <div className="mt-6">{children}</div>}
      </div>

      {badge && (
        <div className="pointer-events-none absolute right-3 top-3 hidden sm:block">
          <StarburstBadge
            variant={badge.variant ?? 'burst'}
            color={badge.color ?? accent}
            size={76}
          >
            {badge.label}
          </StarburstBadge>
        </div>
      )}
    </header>
  );
}
