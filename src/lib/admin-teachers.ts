import DOMPurify from 'dompurify';
import { convertClassesToRoman } from '@/utils/romanNumerals';

/* The logic of the admin Listed teachers page, free of Supabase and React so it
   can be tested on its own: the row shape, the All / Live / Paused / Featured
   views, the order, what a save writes, and whether the edit form has unsaved
   changes. The page, the edit dialog and the fake used in dummy mode share it. */

export interface TeacherData {
  id: number;
  Slug: string | null;
  Title: string | null;
  Featured: boolean | null;
  "Sir/Ma'am?": string | null;
  "Featured Subject": string | null;
  "Classes Taught for Backend": string | null;
  "School Boards Catered": string | null;
  Area: string | null;
  "Mode of Teaching": string | null;
  Subjects: string | null;
  "Phone Number": string | null;
  "Classes Taught": string | null;
  "Hero Image": string | null;
  "Email ID": string | null;
  "Class Size (Group/ Solo)": string | null;
  Description: string | null;
  Video: string | null;
  "Review 1": string | null;
  "Review 2": string | null;
  "Review 3": string | null;
  Link: string | null;
  "Video Link": string | null;
  "LOCATION V2": string | null;
  "STUDENT'S HOME IN THESE AREAS": string | null;
  "TUTOR'S HOME IN THESE AREAS": string | null;
  "Qualifications etc": string | null;
  "Years they started teaching": string | null;
  "Min Fees": number | null;
  "Max Fees": number | null;
  /** Self-service pause flag (see TeacherDashboard.tsx): exactly what a
   *  teacher's own "Pause listing" control flips, and what Browse and search
   *  already filter on to hide a profile from public results. */
  is_paused?: boolean | null;
  /** Row creation timestamp, used for the "Joined" column. */
  created_at?: string | null;
  /** Set on a row when the contact details (phone, email, link) could not be
   *  read, so the page can say so and the edit form can refuse to show blanks
   *  as if they were the real values. Never written to the database: any key
   *  that starts with two underscores is left out of a save. */
  __contactsFailed?: boolean;
}

/** True when this teacher's contact details did not load. */
export function contactsFailed(t: Pick<TeacherData, '__contactsFailed'> | null | undefined): boolean {
  return t?.__contactsFailed === true;
}

export const CONTACTS_FAILED_WORDS = 'Contact details did not load. Reload before you edit phone, email or WhatsApp.';

/** What the page needs from the database, as one object, so dummy mode can run
 *  the real page against made-up teachers. */
export interface TeachersAdminApi {
  /** Every listed teacher, contact columns merged in from admin_teacher_contacts(). */
  list(): Promise<TeacherData[]>;
  /** One teacher after a save, contacts merged; null if it could not be read back. */
  fetchOne(id: number): Promise<TeacherData | null>;
  /** The full-form update, exactly what buildTeacherUpdate produced. */
  save(id: number, update: Record<string, unknown>): Promise<void>;
  /** Flips the same is_paused flag the teacher's own dashboard flips. */
  setPaused(id: number, paused: boolean): Promise<void>;
  /** Compresses and stores a profile photo; returns its public URL. */
  uploadHero(teacherId: number, file: File): Promise<string>;
}

// ------------------------------------------------------------------- views

export type TeacherView = 'all' | 'live' | 'paused' | 'featured';

export const TEACHER_VIEWS: { key: TeacherView; label: string; hint: string }[] = [
  { key: 'all', label: 'All', hint: 'Every teacher on the list.' },
  { key: 'live', label: 'Live', hint: 'Teachers parents can find on the site right now.' },
  { key: 'paused', label: 'Paused', hint: 'Hidden from parents for now. Nothing is deleted.' },
  { key: 'featured', label: 'Featured', hint: 'Teachers shown in the featured rows on the home page and Browse.' },
];

export function viewFromParam(v: string | null | undefined): TeacherView {
  return TEACHER_VIEWS.some((s) => s.key === v) ? (v as TeacherView) : 'all';
}

/** Live or Paused, and nothing else. "Featured" is a separate tag, so a featured
 *  teacher who is paused still reads as paused. */
export function teacherState(t: Pick<TeacherData, 'is_paused'>): 'live' | 'paused' {
  return t.is_paused ? 'paused' : 'live';
}

export function countsByTeacherView(ts: TeacherData[]): Record<TeacherView, number> {
  return {
    all: ts.length,
    live: ts.filter((t) => !t.is_paused).length,
    paused: ts.filter((t) => t.is_paused).length,
    featured: ts.filter((t) => t.Featured).length,
  };
}

export type TeacherSort = 'name' | 'fees' | 'joined';

export function filterTeachers(ts: TeacherData[], view: TeacherView, search: string): TeacherData[] {
  const q = search.trim().toLowerCase();
  return ts.filter((t) => {
    if (view === 'live' && t.is_paused) return false;
    if (view === 'paused' && !t.is_paused) return false;
    if (view === 'featured' && !t.Featured) return false;
    if (!q) return true;
    return (
      t.Title?.toLowerCase().includes(q) ||
      t.Slug?.toLowerCase().includes(q) ||
      t['Email ID']?.toLowerCase().includes(q) ||
      t['Phone Number']?.includes(q)
    );
  });
}

export function sortTeachers(ts: TeacherData[], by: TeacherSort): TeacherData[] {
  return [...ts].sort((a, b) => {
    if (by === 'fees') {
      const aFee = a['Min Fees'] ?? Number.POSITIVE_INFINITY;
      const bFee = b['Min Fees'] ?? Number.POSITIVE_INFINITY;
      return aFee - bFee;
    }
    if (by === 'joined') {
      const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
      return bTime - aTime;
    }
    return (a.Title || '').localeCompare(b.Title || '');
  });
}

export function emptyCopy(view: TeacherView, search: string): { title: string; hint?: string } {
  const q = search.trim();
  if (q) return { title: `No teachers match "${q}".`, hint: 'Check the spelling, or search by phone number or email.' };
  switch (view) {
    case 'live':
      return { title: 'No live teachers.', hint: 'Every teacher on the list is paused.' };
    case 'paused':
      return { title: 'No paused teachers.', hint: 'Everyone on the list is live.' };
    case 'featured':
      return { title: 'No featured teachers.', hint: 'Open a teacher and tick Featured to show them in the featured rows.' };
    default:
      return { title: 'No teachers listed yet.', hint: 'Teachers appear here once an application is approved.' };
  }
}

// ----------------------------------------------------------------- the form

export type TeacherForm = Partial<TeacherData>;

/** The text the edit form starts from: the teacher as read, with "ICSE" in the
 *  boards list spelled the way the filters spell it. */
export function initialTeacherForm(t: TeacherData): TeacherForm {
  let boards = t['School Boards Catered'];
  if (boards) {
    boards = boards
      .split(',')
      .map((b) => {
        const trimmed = b.trim();
        return trimmed.toLowerCase() === 'icse' ? 'ICSE/ISC' : trimmed;
      })
      .join(', ');
  }
  return { ...t, 'School Boards Catered': boards };
}

const norm = (v: unknown): unknown => (v === undefined || v === '' || v === false ? null : v);

/** True when the form differs from where it started. An empty box, a missing
 *  value and an unticked box count as the same, so merely opening the form (or
 *  ticking and unticking) is never "unsaved". */
export function formIsDirty(initial: TeacherForm, current: TeacherForm): boolean {
  const keys = new Set([...Object.keys(initial), ...Object.keys(current)]);
  for (const k of keys) {
    if (norm((initial as Record<string, unknown>)[k]) !== norm((current as Record<string, unknown>)[k])) return true;
  }
  return false;
}

/** What a save writes: every form field except the ones that are never edited
 *  here (EXPANDED, Slug, id, Area), with the Roman-numeral class display
 *  recomputed and the email lower-cased. Unchanged from the page's own handler. */
export function buildTeacherUpdate(form: TeacherForm): Record<string, unknown> {
  const update: Record<string, unknown> = {};
  Object.keys(form).forEach((key) => {
    if (key !== 'EXPANDED' && key !== 'Slug' && key !== 'id' && key !== 'Area' && !key.startsWith('__')) {
      update[key] = form[key as keyof TeacherData] ?? null;
    }
  });
  update['Classes Taught'] = convertClassesToRoman(form['Classes Taught for Backend'] ?? null);
  // Contact details that never loaded are not "empty": never write them back.
  if (contactsFailed(form)) {
    delete update['Phone Number'];
    delete update['Email ID'];
    delete update.Link;
  }
  if (update['Email ID'] != null && typeof update['Email ID'] === 'string') {
    update['Email ID'] = update['Email ID'].trim().toLowerCase();
  }
  return update;
}

/** Cleans a pasted photo link: http(s) or an inline image only, else null. */
export function sanitizeImageUrl(url: string): string | null {
  if (!url || typeof url !== 'string') return null;
  const sanitizedString = DOMPurify.sanitize(url.trim(), { ALLOWED_TAGS: [], ALLOWED_ATTR: [], KEEP_CONTENT: true });
  if (!sanitizedString) return null;
  try {
    const urlObj = new URL(sanitizedString);
    if (urlObj.protocol === 'http:' || urlObj.protocol === 'https:') return urlObj.href;
  } catch {
    if (sanitizedString.startsWith('data:image/')) {
      const dataUriPattern = new RegExp('^data:image/(jpeg|jpg|png|gif|webp);base64,[A-Za-z0-9+/=]+$', 'i');
      if (dataUriPattern.test(sanitizedString)) return sanitizedString;
    }
  }
  return null;
}

/** The public page of a teacher, or null when they have no slug. */
export function publicProfilePath(t: Pick<TeacherData, 'Slug'>): string | null {
  return t.Slug ? `/tuition-teachers/${encodeURIComponent(t.Slug)}` : null;
}

/** Closing the edit form: if there are unsaved edits, ask before throwing them
 *  away. Resolves true when the form should close. Never closes mid-save. */
export async function closeWithGuard(opts: {
  dirty: boolean;
  saving: boolean;
  confirm: (o: { title: string; description?: string; confirmLabel?: string; cancelLabel?: string }) => Promise<boolean>;
}): Promise<boolean> {
  if (opts.saving) return false;
  if (!opts.dirty) return true;
  return opts.confirm({
    title: 'Discard your changes?',
    description: 'You have edits to this teacher that are not saved yet. Closing now throws them away.',
    confirmLabel: 'Discard changes',
    cancelLabel: 'Keep editing',
  });
}
