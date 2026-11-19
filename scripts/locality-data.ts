/**
 * Reads the teacher rows that locality pages are built from, with the anon key.
 *
 * Explicit column list, deliberately. anon has no SELECT on Shikshaqmine
 * "Link", "Phone Number" or "Email ID": naming one would fail the whole request
 * with a permission error, and select('*') would silently return a smaller row.
 * None of them is needed, so none is named.
 *
 * A teacher counts only if they are in teachers_list (published) and have not
 * paused their listing, the same two rules the public search applies.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { LocalityTeacher } from '../src/lib/locality';

const PAGE = 1000;

type Query = { range: (from: number, to: number) => Promise<{ data: unknown[] | null; error: { message: string } | null }> };

async function fetchAll<T>(build: () => Query, label: string, fail: (m: string) => never): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) fail(`${label}: ${error.message}`);
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

interface MineRow {
  Slug: string | null;
  "Sir/Ma'am?": string | null;
  Subjects: string | null;
  'Classes Taught': string | null;
  Area: string | null;
  'School Boards Catered': string | null;
}

export async function fetchLocalityTeachers(
  supabase: SupabaseClient,
  fail: (message: string) => never,
): Promise<LocalityTeacher[]> {
  const listed = await fetchAll<{ slug: string; name: string }>(
    () => supabase.from('teachers_list').select('slug, name').order('name') as unknown as Query,
    'teachers_list',
    fail,
  );
  const mine = await fetchAll<MineRow>(
    () => supabase
      .from('Shikshaqmine')
      .select('"Slug","Sir/Ma\'am?","Subjects","Classes Taught","Area","School Boards Catered"') as unknown as Query,
    'Shikshaqmine',
    fail,
  );
  const paused = await fetchAll<{ Slug: string | null }>(
    () => supabase.from('Shikshaqmine').select('Slug').eq('is_paused', true) as unknown as Query,
    'Shikshaqmine.is_paused',
    fail,
  );

  const pausedSlugs = new Set(paused.map((r) => (r.Slug ?? '').toLowerCase()));
  const bySlug = new Map(mine.filter((r) => r.Slug).map((r) => [String(r.Slug).toLowerCase(), r]));

  const teachers: LocalityTeacher[] = [];
  for (const t of listed) {
    const key = t.slug.toLowerCase();
    const m = bySlug.get(key);
    if (!m || pausedSlugs.has(key)) continue;
    teachers.push({
      slug: t.slug,
      name: t.name,
      honorific: m["Sir/Ma'am?"] ?? '',
      subjects: m.Subjects ?? '',
      classes: m['Classes Taught'] ?? '',
      area: m.Area ?? '',
      boards: m['School Boards Catered'] ?? '',
    });
  }
  return teachers;
}
