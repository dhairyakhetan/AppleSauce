import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BookOpen } from 'lucide-react';

import { supabase } from '@/integrations/supabase/client';
import { usePageMeta } from '@/hooks/usePageMeta';
import { BentoStack, BentoPanel } from '@/components/layout/PageContainer';
import { NumberedHeading } from '@/components/ui/numbered-heading';
import { EmptyResults } from '@/components/EmptyResults';
import { ListError } from '@/components/ui/list-states';
import { SubjectCard } from '@/components/SubjectCard';
import { generateBreadcrumbSchema } from '@/utils/structuredDataGenerators';
import { injectSchemas } from '@/utils/injectSchemas';
import { useEffect } from 'react';
import { EyesPanel } from '@/components/home/EyesPanel';
import { useSentenceBuilder } from '@/hooks/useSentenceBuilder';
import { useChromeConfig } from '@/components/layout/AppShell';

/* Subjects index — the real destination for TopBar's "Subjects" link.
 *
 * Reuses the same subject-tile query shape as Index.tsx's "02 Subjects"
 * section (SubjectCard, same fields), just without that section's 10-subject
 * `desiredSubjects` allowlist — this page is the full list, the home section
 * is a curated preview of it. Counts come from `teachers_list.subject_id`,
 * a direct FK, rather than the home page's text-token matching, since a
 * dedicated index page can afford the exact join.
 */

interface Subject {
  id: string;
  name: string;
  slug: string;
  teacherCount: number;
}

export default function SubjectsPage() {
  const navigate = useNavigate();

  usePageMeta(
    'All Tuition Subjects in Kolkata | Shikshaq',
    'Browse every subject taught by verified tuition teachers in Kolkata, Maths, Science, English, Commerce, and more. Free to contact, no commission.',
  );

  // Handoff SB-005: this route renders its own eyes panel, replacing
  // AppShell's default (B4) pre-footer.
  useChromeConfig({ preFooter: 'none' });
  const {
    builderMode, setBuilderMode, slots: builderSlots, onSlotChange: handleSlotChange, onSubmit: handleBuilderSubmit,
  } = useSentenceBuilder();

  const query = useQuery({
    queryKey: ['subjects', 'index'],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const [subjectsRes, teachersRes] = await Promise.all([
        supabase.from('subjects').select('id, name, slug').order('name'),
        supabase.from('teachers_list').select('subject_id'),
      ]);

      if (subjectsRes.error) throw subjectsRes.error;
      if (teachersRes.error) throw teachersRes.error;

      const counts = new Map<string, number>();
      (teachersRes.data || []).forEach((t) => {
        if (!t.subject_id) return;
        counts.set(t.subject_id, (counts.get(t.subject_id) || 0) + 1);
      });

      const subjects: Subject[] = (subjectsRes.data || []).map((s) => ({
        id: s.id,
        name: s.name,
        slug: s.slug,
        teacherCount: counts.get(s.id) || 0,
      }));

      return subjects;
    },
  });

  const subjects = query.data ?? [];

  useEffect(() => {
    if (query.isLoading) return;
    injectSchemas([
      generateBreadcrumbSchema([
        { name: 'Home', url: '/' },
        { name: 'Subjects', url: '/subjects' },
      ]),
    ]);
    return () => {
      document.getElementById('page-schemas')?.remove();
    };
  }, [query.isLoading]);

  return (
    <div className="min-h-screen bg-background">
      <main>
        <BentoStack>
          {/* Handoff SB-002: bone header panel, replacing the dark ControlBlock. */}
          <BentoPanel fill="card" edge="top" className="px-[22px] pt-[14px] pb-[22px]">
            <NumberedHeading
              as="h1"
              line1="Browse by"
              ordinal="01"
              line2="subject"
              support="Every board, every class."
            />
          </BentoPanel>

          {/* Handoff SB-003: grid wrapped in its own panel. */}
          <BentoPanel fill="card" className="p-[22px]">
            {query.isLoading ? (
              /* Not the generic ListLoading/SkeletonCard shape (bg-card +
                 shadow-border + text lines) — SubjectCard tiles are borderless
                 tinted blocks with no shadow (SubjectCard.tsx: "structural
                 contrast is intentional", tinted cards drop the ring/shadow
                 neutral cards keep), so that shell previewed the wrong card
                 entirely. Matches the identical subject grid's own skeleton on
                 Index.tsx's "02 Subjects" section instead: a flat shimmer
                 block at the tile's own aspect, same grid-cols/gap so nothing
                 reflows when the real tiles land. */
              <div className="grid grid-cols-2 gap-2 lg:grid-cols-4" aria-busy="true" aria-live="polite">
                <span className="sr-only">Loading…</span>
                {[...Array(8)].map((_, i) => (
                  <div
                    key={i}
                    className="h-28 rounded-2xl bg-gradient-to-r from-muted via-background to-muted bg-[length:200%_100%] animate-shimmer"
                  />
                ))}
              </div>
            ) : query.isError ? (
              <ListError onRetry={() => query.refetch()} />
            ) : subjects.length > 0 ? (
              <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                {subjects.map((s) => (
                  <SubjectCard key={s.id} name={s.name} slug={s.slug} context="teachers" teacherCount={s.teacherCount} />
                ))}
              </div>
            ) : (
              <EmptyResults
                icon={<BookOpen className="h-6 w-6" strokeWidth={1.75} aria-hidden="true" />}
                heading="Subjects are being updated"
                message="Please check back shortly, you can still search for any subject directly."
                action={{ label: 'Browse all teachers', onClick: () => navigate('/all-tuition-teachers-in-kolkata') }}
              />
            )}
          </BentoPanel>

          {/* Handoff SB-005: shared tail, identical pattern to Home/Browse/PastPapers. */}
          <EyesPanel
            mode={builderMode}
            onModeChange={setBuilderMode}
            heading={(
              <>
                Still deciding? <span className="font-extrabold">We&rsquo;re watching out for you.</span>
              </>
            )}
            subline="Fill in the blanks and we'll take you straight there."
            slots={builderSlots}
            onSlotChange={handleSlotChange}
            onSubmit={handleBuilderSubmit}
          />
        </BentoStack>
      </main>
    </div>
  );
}
