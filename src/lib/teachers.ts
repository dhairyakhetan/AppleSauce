/**
 * Shared data-layer for the teachers_list <-> Shikshaqmine relationship.
 *
 * teachers_list is the derived/synced subset table (lowercase `slug`).
 * Shikshaqmine is the wide, human-authored source-of-truth table (columns
 * with spaces and apostrophes: "Sir/Ma'am?", "Subjects", "Classes Taught",
 * "LOCATION V2", "STUDENT'S HOME IN THESE AREAS", "Slug", ...).
 *
 * There is no database-level FK between the two — every page used to
 * re-implement this join in JavaScript, each with its own casing, chunking,
 * caching and `select('*')` calls. This module is the ONE place that does it.
 *
 * A real fix would be a database VIEW joining the two tables; see
 * supabase/migrations/20260817000000_teachers_with_shikshaqmine_view.sql
 * for a drafted (NOT applied) version of that.
 */
import { supabase } from '@/integrations/supabase/client';
import {
  getCache,
  setCache,
  CACHE_TTL,
  getShikshaqmineChunkCacheKey,
  getShikshaqmineBySlugCacheKey,
} from '@/utils/cache';

// Supabase/PostgREST has a practical limit on `.in()` list size and URL
// length; chunk any bulk slug/id lookup to stay well under it.
const CHUNK_SIZE = 150;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Minimal Shikshaqmine row shape used across pages (Sir/Ma'am + fallback subject),
 * plus the card-level fields TeacherCard's grid/row/rail variants need: WhatsApp
 * link, years of experience (derived from "Years they started teaching"), fee
 * range and area. All of these are optional/nullable on the source table, and
 * stay optional all the way through to TeacherCard's props — a missing value
 * means the corresponding pill is simply not rendered, never a fabricated "₹0".
 */
export interface ShikshaqmineBasic {
  Slug: string;
  sirMaam: string | null;
  firstSubject: string | null;
  whatsappLink: string | null;
  /** Derived from "Years they started teaching" vs. the current year. Null when unparseable. */
  experienceYears: number | null;
  minFees: number | null;
  maxFees: number | null;
  area: string | null;
}

/* No "Link" here any more -- Shikshaqmine.Link (the WhatsApp number) is no
   longer anon-selectable at all (column-level REVOKE, see migration
   20260909000002_gate_teacher_contact_columns.sql), and asking for it in
   this list would fail the WHOLE query with "permission denied" for every
   signed-out visitor, not just omit the one field. Resolved separately,
   only when actually needed, through teacher_whatsapp_link() -- see
   resolveWhatsAppLink() below. */
const BASIC_COLUMNS =
  '"Slug","Sir/Ma\'am?","Subjects","Years they started teaching","Min Fees","Max Fees","Area","LOCATION V2"';

/** "2016" / 2016 -> years of experience vs. the current year. Null when unparseable or nonsensical. */
export function deriveExperienceYears(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  const yearStarted = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
  if (!yearStarted || isNaN(yearStarted)) return null;
  const currentYear = new Date().getFullYear();
  const years = currentYear - yearStarted;
  return years > 0 && years < 80 ? years : null;
}

/**
 * Fetch a lean Shikshaqmine slice (Slug, "Sir/Ma'am?", Subjects, Link, Years
 * they started teaching, Min/Max Fees, Area) for a set of slugs, chunked and
 * cached. This replaces the `select('*')` + manual chunking that used to live
 * in LikedTeachers/MyTeachers/StudentDashboard/GuardianDashboard, and is now
 * also the card-level fetch behind Index/Browse's featured-teacher shelves.
 */
export async function getShikshaqmineBasicBySlugs(slugs: string[]): Promise<Map<string, ShikshaqmineBasic>> {
  const map = new Map<string, ShikshaqmineBasic>();
  const uniqueSlugs = Array.from(new Set(slugs.filter(Boolean)));
  if (uniqueSlugs.length === 0) return map;

  const missing: string[] = [];
  for (const slug of uniqueSlugs) {
    const cached = getCache<ShikshaqmineBasic>(getShikshaqmineBySlugCacheKey(slug) + '_basic_v2');
    if (cached) map.set(slug, cached);
    else missing.push(slug);
  }
  if (missing.length === 0) return map;

  for (const group of chunk(missing, CHUNK_SIZE)) {
    const cacheKey = getShikshaqmineChunkCacheKey(group) + '_basic_v2';
    let rows = getCache<any[]>(cacheKey);

    if (!rows) {
      const { data, error } = await (supabase
        .from('Shikshaqmine')
        .select(BASIC_COLUMNS) as any)
        .in('Slug', group);

      if (error) {
        if (import.meta.env.DEV) console.warn('getShikshaqmineBasicBySlugs error:', error);
        continue;
      }
      rows = data ?? [];
      setCache(cacheKey, rows, CACHE_TTL.SHIKSHAQMINE_CHUNK);
    }

    for (const record of rows as any[]) {
      const slug = record.Slug as string;
      if (!slug) continue;
      const subjectsRaw: string | null = record.Subjects ?? null;
      const firstSubject = subjectsRaw ? subjectsRaw.split(',')[0].trim() || null : null;
      const basic: ShikshaqmineBasic = {
        Slug: slug,
        sirMaam: record["Sir/Ma'am?"] ?? null,
        firstSubject,
        whatsappLink: record['Link'] ?? null,
        experienceYears: deriveExperienceYears(record['Years they started teaching']),
        minFees: record['Min Fees'] != null ? Number(record['Min Fees']) : null,
        maxFees: record['Max Fees'] != null ? Number(record['Max Fees']) : null,
        area: record['Area'] ?? record['LOCATION V2'] ?? null,
      };
      map.set(slug, basic);
      setCache(getShikshaqmineBySlugCacheKey(slug) + '_basic_v2', basic, CACHE_TTL.SHIKSHAQMINE);
    }
  }

  return map;
}

export interface TeacherCardLite {
  id: string;
  name: string;
  slug: string;
  image_url: string | null;
  subjects: { name: string; slug: string } | null;
  sirMaam?: string | null;
  whatsappLink?: string | null;
  experienceYears?: number | null;
  minFees?: number | null;
  maxFees?: number | null;
  area?: string | null;
}

/* The subjects table is small and effectively static, and getTeachersByIds
   fetched all of it on every call -- twice per teacher profile view, once for
   each recommendation rail. Held as a shared promise for the page session, so
   concurrent callers await one request instead of racing identical ones.
   Nulled on failure so a transient error does not cache an empty table for
   the rest of the session. */
let subjectsTablePromise: Promise<{ name: string; slug: string }[]> | null = null;

function loadSubjectsTable(): Promise<{ name: string; slug: string }[]> {
  if (!subjectsTablePromise) {
    /* An async wrapper rather than .then() on the query builder: Supabase's
       builder is a PromiseLike, so .then() gives back something without
       .catch/.finally and does not satisfy Promise<T>. */
    subjectsTablePromise = (async () => {
      const { data, error } = await supabase.from('subjects').select('name, slug');
      if (error) {
        subjectsTablePromise = null;
        return [];
      }
      return (data ?? []) as { name: string; slug: string }[];
    })();
  }
  return subjectsTablePromise;
}

/**
 * teachers_list rows for a set of ids, enriched with Sir/Ma'am (and a
 * fallback subject derived from Shikshaqmine.Subjects when teachers_list has
 * no `subjects` relationship row). Used by LikedTeachers, MyTeachers,
 * StudentDashboard and GuardianDashboard's "saved teachers" lists.
 */
export async function getTeachersByIds(ids: string[]): Promise<TeacherCardLite[]> {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (uniqueIds.length === 0) return [];

  /* Promise.all, not a serial for-await. Each chunk is an independent query
     against a different id set, so awaiting them one at a time made the total
     latency the SUM of every round trip instead of the slowest one. The
     sibling fetchShikshaqmineChunked in this same file already fans out this
     way; this loop and the one above were the two stragglers. */
  const groups = chunk(uniqueIds, CHUNK_SIZE);
  const settled = await Promise.all(
    groups.map(async (group) => {
      const { data, error } = await supabase
        .from('teachers_list')
        .select('id, name, slug, image_url, subjects(name, slug)')
        .in('id', group);
      if (error) throw error;
      return (data as any[]) || [];
    }),
  );
  const results: TeacherCardLite[] = settled.flat();

  if (results.length === 0) return [];

  const slugs = results.map((t) => t.slug);
  const [basicMap, subjectsTableData] = await Promise.all([
    getShikshaqmineBasicBySlugs(slugs),
    loadSubjectsTable(),
  ]);

  return results.map((teacher) => {
    const basic = basicMap.get(teacher.slug);
    let subjects = teacher.subjects as { name: string; slug: string } | null;
    if (!subjects && basic?.firstSubject) {
      const match = subjectsTableData.find(
        (s: any) => s.name.toLowerCase() === basic.firstSubject!.toLowerCase()
      );
      subjects = match
        ? { name: match.name, slug: match.slug }
        : { name: basic.firstSubject, slug: basic.firstSubject.toLowerCase().replace(/\s+/g, '-') };
    }
    return {
      ...teacher,
      subjects,
      sirMaam: basic?.sirMaam ?? null,
      whatsappLink: basic?.whatsappLink ?? null,
      experienceYears: basic?.experienceYears ?? null,
      minFees: basic?.minFees ?? null,
      maxFees: basic?.maxFees ?? null,
      area: basic?.area ?? null,
    };
  });
}

/** Full Shikshaqmine profile fields used by the teacher profile page. */
export interface ShikshaqmineProfile {
  sirMaam: string | null;
  subjectsFromShikshaq: string | null;
  classesTaught: string | null;
  classesTaughtForBackend: string | null;
  area: string | null;
  boardsTaught: string | null;
  classSize: string | null;
  modeOfTeaching: string | null;
  placeOfTeaching: string | null;
  locationV2: string | null;
  studentsHomeAreas: string | null;
  tutorsHomeAreas: string | null;
  expanded: string | null;
  description: string | null;
  qualificationsEtc: string | null;
  teachingSinceRaw: string | number | null;
  review1: string | null;
  review2: string | null;
  review3: string | null;
  whatsappLink: string | null;
  minFees: number | null;
  maxFees: number | null;
}

// No "Link" here — same reason as BASIC_COLUMNS above. Resolved separately
// through resolveWhatsAppLink() / teacher_whatsapp_link() only when needed.
const PROFILE_COLUMNS =
  '"Slug","Sir/Ma\'am?","Subjects","Classes Taught","Classes Taught for Backend","Area","School Boards Catered","Class Size (Group/ Solo)","Mode of Teaching","Place of Teaching","LOCATION V2","STUDENT\'S HOME IN THESE AREAS","TUTOR\'S HOME IN THESE AREAS","EXPANDED","Description","Qualifications etc","Years they started teaching","Review 1","Review 2","Review 3","Min Fees","Max Fees"';

function mapShikshaqmineProfileRow(row: any): ShikshaqmineProfile {
  return {
    sirMaam: row["Sir/Ma'am?"] ?? null,
    subjectsFromShikshaq: row['Subjects'] ?? null,
    classesTaught: row['Classes Taught'] ?? null,
    classesTaughtForBackend: row['Classes Taught for Backend'] ?? null,
    area: row['Area'] ?? null,
    boardsTaught: row['School Boards Catered'] ?? null,
    classSize: row['Class Size (Group/ Solo)'] ?? null,
    modeOfTeaching: row['Mode of Teaching'] ?? null,
    placeOfTeaching: row['Place of Teaching'] ?? null,
    locationV2: row['LOCATION V2'] ?? row['Location V2'] ?? row['location_v2'] ?? null,
    studentsHomeAreas:
      row["STUDENT'S HOME IN THESE AREAS"] ??
      row["student's home in these areas"] ??
      row["Student's home in these areas"] ??
      null,
    tutorsHomeAreas: row["TUTOR'S HOME IN THESE AREAS"] ?? row["Tutor's home in these areas"] ?? null,
    expanded: row['EXPANDED'] ?? row['Expanded'] ?? row['expanded'] ?? null,
    description: row['Description'] ?? null,
    qualificationsEtc: row['Qualifications etc'] ?? null,
    teachingSinceRaw: row['Years they started teaching'] ?? null,
    review1: row['Review 1'] ?? null,
    review2: row['Review 2'] ?? null,
    review3: row['Review 3'] ?? null,
    whatsappLink: row['Link'] ?? row['link'] ?? null,
    minFees: row['Min Fees'] != null ? Number(row['Min Fees']) : null,
    maxFees: row['Max Fees'] != null ? Number(row['Max Fees']) : null,
  };
}

/** Fetch the full Shikshaqmine profile slice for one slug, cached. */
export async function getShikshaqmineProfileBySlug(slug: string): Promise<ShikshaqmineProfile | null> {
  const cacheKey = getShikshaqmineBySlugCacheKey(slug);
  const cached = getCache<any>(cacheKey);
  if (cached) return mapShikshaqmineProfileRow(cached);

  const { data, error } = await (supabase.from('Shikshaqmine').select(PROFILE_COLUMNS) as any)
    .eq('Slug', slug)
    .maybeSingle();

  if (error) {
    if (import.meta.env.DEV) console.warn('getShikshaqmineProfileBySlug error:', error);
    return null;
  }
  if (!data) return null;
  setCache(cacheKey, data, CACHE_TTL.SHIKSHAQMINE);
  return mapShikshaqmineProfileRow(data);
}

/** teachers_list row (with subjects relation) joined with the Shikshaqmine profile slice, by slug. */
export async function getTeacherBySlug<T = any>(slug: string): Promise<{ teacher: T | null; shikshaqmine: ShikshaqmineProfile | null }> {
  const teacherCacheKey = `teacher_profile_row_${slug}`;
  let teacherData = getCache<T>(teacherCacheKey);

  /* Both reads are keyed on the same slug and neither depends on the other's
     result, so they go in parallel. This used to await teachers_list first and
     only then start the Shikshaqmine fetch, which put two full round trips in
     series at the top of the most-linked page type on the site (148 indexed
     teacher URLs). The Shikshaqmine result is discarded if the teacher turns
     out not to exist -- one wasted request on a 404 path, against one saved
     round trip on every real profile view. */
  const [teacherResult, shikshaqmineResult] = await Promise.all([
    teacherData
      ? Promise.resolve(null)
      : supabase
          .from('teachers_list')
          .select('*, subjects(name, slug)')
          .eq('slug', slug)
          .maybeSingle(),
    getShikshaqmineProfileBySlug(slug),
  ]);

  if (teacherResult) {
    const { data, error } = teacherResult;
    if (error) {
      if (import.meta.env.DEV) console.warn('getTeacherBySlug (teachers_list) error:', error);
    } else if (data) {
      teacherData = data as unknown as T;
      setCache(teacherCacheKey, teacherData, CACHE_TTL.TEACHER_PROFILE);
    }
  }

  return { teacher: teacherData ?? null, shikshaqmine: teacherData ? shikshaqmineResult : null };
}

/** Only the WhatsApp link for a slug — used by the WhatsApp redirect
 *  interstitial. Reads through teacher_whatsapp_link(), not the table
 *  directly: Shikshaqmine.Link is no longer anon-selectable at all (column-
 *  level REVOKE, migration 20260909000002_gate_teacher_contact_columns.sql),
 *  and the function itself is the real gate — it returns null for a
 *  signed-out caller regardless of what this function is told, so there is
 *  no client-side flag here that could ask for more than that. */
export async function getWhatsAppLinkBySlug(slug: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('teacher_whatsapp_link', { p_slug: slug });
  if (error) {
    if (import.meta.env.DEV) console.warn('getWhatsAppLinkBySlug error:', error);
    return null;
  }
  return data ?? null;
}

/* ---------------------------------------------------------------------------
   Paging and chunking mechanics, lifted out of Browse.tsx.

   docs/REDESIGN_STATUS.md flagged Browse's data layer as the one big open item
   and set the boundary for any extraction: move the MECHANICS (how many rows a
   page holds, how slugs are chunked, how the is_paused retry works) and leave
   the SEMANTICS (filterShikshaqRecords, applyServerPrefilters, SHIKSHAQ_COLUMNS)
   in Browse, because those are FilterState-aware and are not generic lookups.
   That is exactly the line these two functions sit on — neither knows what a
   filter is.

   Cache and staleness are injected rather than imported so this file stays
   free of Browse's cache-key scheme and its request-generation guard.
--------------------------------------------------------------------------- */

export interface PageAllOptions {
  /** Column list passed straight to .select(). */
  selectCols: string;
  pageSize?: number;
  /** Safety cap. pageSize * maxPages is the most rows this will ever return. */
  maxPages?: number;
  /** Return true to abandon: a newer request has superseded this one. */
  isStale?: () => boolean;
}

/**
 * Page `teachers_list` in `is_featured desc, name` order up to the cap.
 *
 * `truncated` reports that the table holds more rows than the cap allows, which
 * the caller surfaces to the user rather than silently showing a partial list.
 */
export async function pageAllTeachers(
  opts: PageAllOptions,
): Promise<{ rows: any[]; truncated: boolean; failed: boolean }> {
  const pageSize = opts.pageSize ?? 500;
  const maxPages = opts.maxPages ?? 6;
  const isStale = opts.isStale ?? (() => false);

  const { data: firstPage, error, count } = await supabase
    .from('teachers_list')
    .select(opts.selectCols, { count: 'exact' })
    .order('is_featured', { ascending: false })
    .order('name')
    .range(0, pageSize - 1);

  if (isStale()) return { rows: [], truncated: false, failed: false };
  if (error || !firstPage) return { rows: [], truncated: false, failed: true };

  let rows: any[] = firstPage;
  const totalCount = count ?? firstPage.length;

  for (let page = 1; page < maxPages && rows.length < totalCount; page++) {
    const from = page * pageSize;
    const { data: nextPage, error: pageError } = await supabase
      .from('teachers_list')
      .select(opts.selectCols)
      .order('is_featured', { ascending: false })
      .order('name')
      .range(from, from + pageSize - 1);

    if (isStale()) return { rows: [], truncated: false, failed: false };
    if (pageError || !nextPage) break;
    rows = rows.concat(nextPage);
  }

  return { rows, truncated: totalCount > rows.length, failed: false };
}

export interface ChunkedShikshaqmineOptions {
  slugs: string[];
  /** Caller owns the column list — it is FilterState-aware, so it stays there. */
  columns: string;
  chunkSize?: number;
  isStale?: () => boolean;
  /** Optional per-chunk cache. Both halves must be supplied or neither. */
  cache?: {
    key: (slugs: string[], withPaused: boolean) => string;
    get: (key: string) => any[] | null;
    set: (key: string, rows: any[]) => void;
  };
}

/**
 * Fetch Shikshaqmine rows for a slug list, chunked so no single `.in()` grows
 * unbounded.
 *
 * is_paused is a live column (migration 20260816160605, boolean not null
 * default false) — on the current schema every chunk succeeds on its first
 * attempt and the retry path below never fires. It stays as a whole-batch
 * fallback rather than being deleted: if a FUTURE schema change ever drops or
 * renames the column, a per-chunk retry would mix shapes across chunks and
 * make `'is_paused' in row` — which the caller uses to decide whether pause
 * filtering is even possible — true for some rows and false for others in the
 * same result set. Retrying the whole batch keeps that boolean meaningful.
 */
export async function fetchShikshaqmineChunked(
  opts: ChunkedShikshaqmineOptions,
): Promise<{ rows: any[]; withPaused: boolean; partialFailure: boolean }> {
  const chunkSize = opts.chunkSize ?? 200;
  const isStale = opts.isStale ?? (() => false);

  const chunks: string[][] = [];
  for (let i = 0; i < opts.slugs.length; i += chunkSize) {
    const chunk = opts.slugs.slice(i, i + chunkSize);
    if (chunk.length > 0) chunks.push(chunk);
  }
  if (chunks.length === 0) return { rows: [], withPaused: false, partialFailure: false };

  const runChunk = async (chunk: string[], withPaused: boolean) => {
    const key = opts.cache?.key(chunk, withPaused);
    if (key) {
      const cached = opts.cache!.get(key);
      if (cached) return { data: cached, error: null as any };
    }
    const result = await (supabase
      .from('Shikshaqmine')
      .select(opts.columns + (withPaused ? ', is_paused' : '')) as any)
      .in('Slug', chunk);
    if (key && result.data && !result.error) opts.cache!.set(key, result.data);
    return result;
  };

  let withPaused = true;
  let results = await Promise.all(chunks.map((c) => runChunk(c, true)));
  if (isStale()) return { rows: [], withPaused: false, partialFailure: false };

  if (results.some((r: any) => r.error)) {
    withPaused = false;
    results = await Promise.all(chunks.map((c) => runChunk(c, false)));
    if (isStale()) return { rows: [], withPaused: false, partialFailure: false };
  }

  return {
    rows: results.flatMap((r: any) => r.data || []),
    withPaused,
    partialFailure: results.some((r: any) => r.error),
  };
}
