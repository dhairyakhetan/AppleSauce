import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Eyebrow } from '@/components/ui/eyebrow';
import type { SubjectContent } from '@/content/subject-seo';
import { GHAR_PE_HEADING, gharPeParagraph } from '@/content/ghar-pe';

/**
 * Phase 13 (C-040 / C-041): the substantive-content block rendered on every
 * subject/board SEO route (~35 routes off SubjectPage.tsx / BoardPage.tsx via
 * Browse.tsx). Surfaces the SUBJECT_CONTENT / BOARD_CONTENT entry written in
 * src/content/subject-seo.ts — intro prose, "what a good tutor covers"
 * bullets, an FAQ accordion, and an internal-link cluster — so each of the
 * ~35 routes is substantively unique rather than a shared listing with a
 * different <title>.
 *
 * No mockup file for the S15/S16 secondary-screen frames existed on disk at
 * implementation time (searched repo-wide for *.dc.html — zero matches), so
 * this renders with the existing token system (design.md's spacing scale,
 * Eyebrow, existing FAQ accordion visual language from src/components/FAQ.tsx)
 * rather than transcribed literal px. Flagged in the phase report per the
 * "mockup wins, report every conflict" rule — there was no mockup to conflict
 * with.
 */
export function SEOContentBlock({
  content,
  label,
  gharPe = false,
}: {
  content: SubjectContent;
  label: string;
  /** Subject pages only: adds the "Ghar pe tuition in Kolkata" section. */
  gharPe?: boolean;
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <section className="mx-auto mt-10 w-full max-w-6xl px-5 sm:px-6 lg:px-8">
      <div className="grid gap-8 lg:grid-cols-[1.3fr_1fr]">
        {/* Intro + covers */}
        <div>
          <Eyebrow as="p" className="mb-2">
            About {label} tuition in Kolkata
          </Eyebrow>
          <p className="text-body-secondary leading-relaxed text-warm-secondary">
            {content.intro}
          </p>

          {/* Lower-casing the label blindly produced "What a good icse tutor
              covers" on every board route and on acronym subjects (ISC, IGCSE,
              CBSE, SAT, CAT, CA, CFA, CLAT). Acronyms keep their case; ordinary
              words are lower-cased so the sentence still reads naturally. */}
          <h2 className="mt-8 mb-3 text-lg font-bold tracking-tight text-foreground">
            What a good {/^[A-Z0-9&\s/-]+$/.test(label) ? label : label.toLowerCase()} tutor covers
          </h2>
          <ul className="grid gap-2.5">
            {content.covers.map((item) => (
              <li key={item} className="flex gap-2.5 text-body-secondary text-warm-secondary">
                <span aria-hidden="true" className="mt-[7px] h-1.5 w-1.5 flex-none rounded-full bg-brand" />
                <span>{item}</span>
              </li>
            ))}
          </ul>

          {gharPe && (
            <>
              <h2 className="mt-8 mb-3 text-lg font-bold tracking-tight text-foreground">{GHAR_PE_HEADING}</h2>
              <p className="text-body-secondary leading-relaxed text-warm-secondary">{gharPeParagraph(label)}</p>
            </>
          )}
        </div>

        {/* FAQ accordion */}
        <div>
          <h2 className="mb-3 text-lg font-bold tracking-tight text-foreground">Frequently asked</h2>
          <div className="grid gap-2">
            {content.faqs.map((faq, index) => {
              const isOpen = openIndex === index;
              return (
                <div key={faq.question} className="rounded-2xl bg-card shadow-border">
                  <button
                    type="button"
                    onClick={() => setOpenIndex(isOpen ? null : index)}
                    aria-expanded={isOpen}
                    className="flex min-h-11 w-full items-center justify-between gap-4 rounded-2xl border-0 bg-transparent px-5 py-4 text-left text-[15px] font-semibold text-foreground cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    <span>{faq.question}</span>
                    <span
                      aria-hidden="true"
                      className="flex-shrink-0 text-warm-meta transition-transform duration-200"
                      style={{ fontSize: 18, lineHeight: 1, transform: isOpen ? 'rotate(45deg)' : 'none' }}
                    >
                      +
                    </span>
                  </button>
                  {isOpen && (
                    <p className="m-0 px-5 pb-4 text-sm leading-relaxed text-warm-secondary">
                      {faq.answer}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Internal-link cluster */}
      {content.internalLinks.length > 0 && (
        <div className="mt-8 flex flex-wrap items-center gap-2 border-t border-border/60 pt-6">
          <span className="text-sm font-semibold text-warm-meta">See also:</span>
          {content.internalLinks.map((link) => (
            <Link
              key={link.href}
              to={link.href}
              className="shikshaq-tap inline-flex min-h-11 items-center rounded-full bg-panel/[0.06] px-4 text-sm font-semibold text-foreground transition-colors duration-150 hover:bg-panel/[0.1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {link.label}
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

export default SEOContentBlock;
