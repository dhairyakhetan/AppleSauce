import { supabase } from '@/integrations/supabase/client';

/* The teacher total the whole site shows.

   A teacher can pause their own listing (Shikshaqmine.is_paused, the toggle on
   their dashboard). A paused teacher stays in teachers_list, so a plain row
   count of teachers_list over-reports by exactly the number paused. Browse
   drops paused teachers from every list it renders, so a headline that counts
   them promises cards the page never shows. This is the same subtraction,
   kept in one place so the header, the trust strip, the filter sheet, the
   home page and About cannot drift apart.

   The site_counts() RPC still returns a `teachers` column, but it counts
   paused listings too and is not read for teachers. */

/** Pure: how many teacher slugs survive the pause filter. A row with no slug
 *  cannot be paused, so it counts, exactly as Browse keeps it. */
export function countListedTeachers(
  teacherSlugs: ReadonlyArray<string | null | undefined>,
  pausedSlugs: ReadonlySet<string>,
): number {
  let listed = 0;
  for (const slug of teacherSlugs) {
    if (!slug || !pausedSlugs.has(slug)) listed += 1;
  }
  return listed;
}

/** The listed teacher total, or null if any read fails. Null is drawn as
 *  nothing by every caller; a guessed figure is never shown. */
export async function fetchListedTeacherCount(): Promise<number | null> {
  try {
    const { data: pausedRows, error: pausedError } = await supabase
      .from('Shikshaqmine')
      .select('Slug')
      .eq('is_paused', true);
    if (pausedError) return null;
    const pausedSlugs = new Set(
      (pausedRows ?? []).map((r) => r.Slug).filter((s): s is string => Boolean(s)),
    );

    const PAGE = 1000;
    const slugs: (string | null)[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('teachers_list')
        .select('slug')
        .order('slug')
        .range(from, from + PAGE - 1);
      if (error) return null;
      slugs.push(...(data ?? []).map((r) => r.slug));
      if (!data || data.length < PAGE) break;
    }
    return countListedTeachers(slugs, pausedSlugs);
  } catch {
    return null;
  }
}
