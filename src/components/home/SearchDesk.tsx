import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SearchControl } from '@/components/SearchControl';
import { Chip } from '@/components/ui/chip';
import type { SearchMode } from '@/utils/searchFacets';

/* Redesign C5 (design.md §2.8, C-053).

   The overhanging search card: a bone card that overhangs the dark slab's
   bottom edge (-26px mobile / -56px desktop) holding the mode toggle, the
   search field and the popular chips. The slab above keeps only eyebrow,
   headline and lede — everything interactive lives in here.

   Reuses the existing SearchControl (mode toggle + field + facet row +
   suggestions) rather than re-implementing search, and adds the popular
   chip row underneath it per design.md §2.8. */

/* One chip row per mode. The row used to be teacher-only at both settings, so
   flipping to Past papers left "Under ₹800" and "Home tuition" — fee and
   travel filters that no paper has — sitting under a papers field. Each papers
   chip lands on /past-papers/results, which is the route that actually reads
   these filter params (/past-papers ignores them). */
const POPULAR_CHIPS: Record<SearchMode, { label: string; href: string }[]> = {
  teachers: [
    { label: 'Class 10', href: '/all-tuition-teachers-in-kolkata?filter_classes=10' },
    { label: 'Maths', href: '/all-tuition-teachers-in-kolkata?filter_subjects=Maths' },
    { label: 'Under ₹800', href: '/all-tuition-teachers-in-kolkata?filter_maxFees=800' },
    { label: 'Home tuition', href: `/all-tuition-teachers-in-kolkata?filter_placeOfTeaching=${encodeURIComponent("Student's Home")}` },
  ],
  papers: [
    { label: 'Class 10', href: '/past-papers/results?filter_classes=10' },
    { label: 'ICSE', href: '/past-papers/results?filter_boards=ICSE' },
    { label: 'CBSE', href: '/past-papers/results?filter_boards=CBSE' },
    { label: 'Maths', href: '/past-papers/results?filter_subjects=Maths' },
  ],
};

export interface SearchDeskProps {
  onModeChange?: (mode: SearchMode) => void;
  className?: string;
}

export function SearchDesk({ onModeChange, className = '' }: SearchDeskProps) {
  const navigate = useNavigate();
  const [mode, setMode] = useState<SearchMode>('teachers');
  // Mirrors the control's mode locally so this card can dress itself, while
  // still forwarding it to the page (which swaps the hero copy off it).
  const handleModeChange = useCallback((next: SearchMode) => {
    setMode(next);
    onModeChange?.(next);
  }, [onModeChange]);

  return (
    /* Handoff H-008: SearchDesk becomes a plain BentoPanel-radius'd panel —
       no overhang, no shadow. The wrapping `-mt` negative margin that used to
       hang this card off the hero block is gone from Index.tsx entirely. */
    <div className={`rounded-bento bg-card p-4 pb-[18px] sm:p-6 ${className}`}>
      {/* Owner call: desktop used to get a teachers-only 3-dropdown field
          (HeroFieldSearch) with no Teachers/Papers toggle and no free-text
          search — "the search bar is currently specialized to find a
          teacher, it needs to be very similar to mobile." One SearchControl
          at every width now — same toggle, same field, same expandable
          subject/class/area facet chips mobile already has. */}
      <SearchControl align="flex-start" stackedToggle alwaysShowModeToggle onModeChange={handleModeChange} heroDesk />

      {/* No "Popular" label. Home concepts 2a runs the facet chips straight
          under the field with nothing introducing them — the row is self-evident
          and the label was costing a chip's width of scroll on a 390px screen.
          Handoff H-010: 44px chips (was 40, below the floor), -mx-4 px-4 scroller. */}
      <div className="-mx-4 mt-2.5 overflow-x-auto px-4 pb-0.5 scrollbar-hide sm:mx-0 sm:px-0">
        {/* Was sm:w-full sm:flex-wrap — teachers' chip labels ("Under ₹800",
            "Home tuition") and papers' ("ICSE", "CBSE") aren't the same
            total width, so at sm+ the row wrapped to a different number of
            lines per mode and the whole hero's height jumped on toggle. A
            single scrolling row, the same treatment mobile already uses,
            keeps the height constant at every width regardless of which
            mode's labels are showing. */}
        <div key={mode} className="flex w-max animate-blur-swap items-center gap-2 motion-reduce:animate-none">
          {POPULAR_CHIPS[mode].map((c) => (
            <Chip
              key={c.label}
              tone="facet"
              size={44}
              className={`flex-none whitespace-nowrap px-[18px] text-[15px] font-semibold ${
                /* -deep is index.css's documented text-on-tint ink (6.79:1);
                   the solid accent gives 4.74:1 with no margin. */
                mode === 'papers' ? '!bg-brand-blue-subtle !text-brand-blue-deep' : ''
              }`}
              onClick={() => navigate(c.href)}
            >
              {c.label}
            </Chip>
          ))}
        </div>
      </div>
    </div>
  );
}
