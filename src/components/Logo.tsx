import * as React from 'react';
import { Link } from 'react-router-dom';
import logoImage from '@/assets/shikshaq-logo.svg';

interface LogoProps {
  className?: string;
  showText?: boolean;
  size?: 'sm' | 'md' | 'lg' | 'nav';
  desktopSize?: 'sm' | 'md' | 'lg' | 'nav';
  /** Mark is authored dark-on-transparent; force it to solid white for use
   *  on dark surfaces (e.g. the footer's `bg-panel`) instead of going
   *  invisible. Loses the small orange accent dot in that mode — acceptable
   *  since it's already a one-off flourish, not the brand orange token. */
  onDark?: boolean;
  /** Intercept the click, e.g. to open the product tour on the home page
   *  instead of navigating to a route the user is already on. Call
   *  preventDefault() to suppress the navigation. */
  onClick?: React.MouseEventHandler<HTMLAnchorElement>;
  /** Override the accessible name when the click does something other than
   *  navigate home. */
  ariaLabel?: string;
  /**
   * The nav logo is above the fold and must load eagerly. Every other
   * placement (footer, pre-footer) should defer — an /impeccable audit flagged
   * three copies of this mark all loading eagerly on one page.
   */
  priority?: boolean;
}

export function Logo({ className = '', showText = false, size = 'md', desktopSize, onDark = false, onClick, ariaLabel = 'Shikshaq home', priority = false }: LogoProps) {
  // SVG is 252x92, so aspect ratio is ~2.74:1 (wider than tall)
  // NOTE: every class below is a complete literal string so Tailwind's JIT
  // scanner can see it. Never build these with template interpolation.
  const sizeClasses = {
    sm: 'h-7 w-auto', // ~28px height, auto width to maintain aspect
    md: 'h-12 w-auto', // ~48px height
    lg: 'h-16 w-auto', // ~64px height
    nav: 'h-10 w-auto', // 40px height, matches the Shikshaq Search prototype navbar
  } as const;

  // Mobile size -> desktop (>=768px) size
  const responsiveClasses = {
    sm: {
      sm: 'h-7 w-auto md:h-7',
      md: 'h-7 w-auto md:h-12',
      lg: 'h-7 w-auto md:h-16',
      nav: 'h-7 w-auto md:h-10',
    },
    md: {
      sm: 'h-12 w-auto md:h-7',
      md: 'h-12 w-auto md:h-12',
      lg: 'h-12 w-auto md:h-16',
      nav: 'h-12 w-auto md:h-10',
    },
    lg: {
      sm: 'h-16 w-auto md:h-7',
      md: 'h-16 w-auto md:h-12',
      lg: 'h-16 w-auto md:h-16',
      nav: 'h-16 w-auto md:h-10',
    },
    nav: {
      sm: 'h-10 w-auto md:h-7',
      md: 'h-10 w-auto md:h-12',
      lg: 'h-10 w-auto md:h-16',
      nav: 'h-10 w-auto md:h-10',
    },
  } as const;

  // If desktopSize is provided, use responsive classes
  const responsiveSizeClass = desktopSize
    ? responsiveClasses[size][desktopSize]
    : sizeClasses[size];

  return (
    <Link
      to="/"
      aria-label={ariaLabel}
      onClick={onClick}
      className={`flex items-center gap-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 ${className}`}
    >
      <img
        src={logoImage}
        alt="Shikshaq"
        width={252}
        height={92}
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        // `block` kills the inline-image baseline gap that was pushing the mark
        // a pixel low against adjacent text; `select-none` stops drag-ghosting.
        className={`${responsiveSizeClass} block flex-shrink-0 select-none object-contain ${
          onDark ? 'brightness-0 invert' : ''
        }`}
      />
      {showText && (
        <span className={`text-base font-semibold leading-none ${onDark ? 'text-white' : 'text-foreground'}`}>
          Shikshaq.in
        </span>
      )}
    </Link>
  );
}

