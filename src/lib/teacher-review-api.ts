import { supabase } from '@/integrations/supabase/client';
import { convertClassesToRoman } from '@/utils/romanNumerals';

/**
 * Client wrapper for the teacher review page (/teacher-review). Every call is
 * one of the functions in 20261008120000_teacher_reviewers.sql, each of which
 * checks is_teacher_reviewer() (admins count) inside. They are not in the
 * generated types yet, hence the `as never` casts, the same as hod-api.ts.
 *
 * Shaping and the "what changed" patches live here as pure functions so the
 * page, the fake used in dummy mode and the tests all share them.
 */

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

// ------------------------------------------------------------------ shapes

export type ApplicationStatus = 'pending' | 'approved' | 'rejected';

export interface ReviewApplication {
  id: string;
  name: string;
  email: string;
  phone_number: string;
  sir_maam: string;
  subjects: string | null;
  classes_taught_for_backend: string | null;
  school_boards_catered: string | null;
  location_v2: string | null;
  students_home_areas: string | null;
  tutors_home_areas: string | null;
  mode_of_teaching: string | null;
  class_size: string | null;
  description: string | null;
  qualifications_etc: string | null;
  years_started_teaching: string | null;
  featured_subject: string | null;
  whatsapp_link: string | null;
  hero_image_url: string | null;
  reference_name: string | null;
  reference_number: string | null;
  min_fees: number | null;
  max_fees: number | null;
  mou_consent: boolean;
  status: ApplicationStatus;
  texted_status: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  created_at: string;
}

export interface ReviewTeacher {
  id: number;
  slug: string | null;
  title: string;
  sir_maam: string | null;
  subjects: string | null;
  featured_subject: string | null;
  classes_taught_for_backend: string | null;
  classes_taught: string | null;
  school_boards_catered: string | null;
  location_v2: string | null;
  students_home_areas: string | null;
  tutors_home_areas: string | null;
  mode_of_teaching: string | null;
  class_size: string | null;
  description: string | null;
  qualifications_etc: string | null;
  years_started_teaching: string | null;
  min_fees: number | null;
  max_fees: number | null;
  hero_image: string | null;
  is_paused: boolean;
  email_id: string | null;
  phone_number: string | null;
  link: string | null;
}

export interface ReviewerRow {
  user_id: string;
  email: string | null;
  name: string | null;
  active: boolean;
  granted_at: string | null;
}

export function normaliseApplication(raw: unknown): ReviewApplication | null {
  const r = obj(raw);
  const id = str(r.id);
  if (!id) return null;
  const status = r.status === 'approved' || r.status === 'rejected' ? r.status : 'pending';
  return {
    id,
    name: str(r.name) ?? 'Unnamed',
    email: str(r.email) ?? '',
    phone_number: str(r.phone_number) ?? '',
    sir_maam: r.sir_maam === "Ma'am" ? "Ma'am" : 'Sir',
    subjects: str(r.subjects),
    classes_taught_for_backend: str(r.classes_taught_for_backend),
    school_boards_catered: str(r.school_boards_catered),
    location_v2: str(r.location_v2),
    students_home_areas: str(r.students_home_areas),
    tutors_home_areas: str(r.tutors_home_areas),
    mode_of_teaching: str(r.mode_of_teaching),
    class_size: str(r.class_size),
    description: str(r.description),
    qualifications_etc: str(r.qualifications_etc),
    years_started_teaching: str(r.years_started_teaching),
    featured_subject: str(r.featured_subject),
    whatsapp_link: str(r.whatsapp_link),
    hero_image_url: str(r.hero_image_url),
    reference_name: str(r.reference_name),
    reference_number: str(r.reference_number),
    min_fees: num(r.min_fees),
    max_fees: num(r.max_fees),
    mou_consent: r.mou_consent === true,
    status,
    texted_status: str(r.texted_status) ?? 'not_texted',
    reviewed_by: str(r.reviewed_by),
    reviewed_at: str(r.reviewed_at),
    rejection_reason: str(r.rejection_reason),
    created_at: str(r.created_at) ?? new Date(0).toISOString(),
  };
}

export function normaliseApplications(raw: unknown): ReviewApplication[] {
  return list(raw).map(normaliseApplication).filter((a): a is ReviewApplication => a !== null);
}

export function normaliseTeacher(raw: unknown): ReviewTeacher | null {
  const r = obj(raw);
  const id = num(r.id);
  if (id === null) return null;
  return {
    id,
    slug: str(r.slug),
    title: str(r.title) ?? 'Untitled',
    sir_maam: str(r.sir_maam),
    subjects: str(r.subjects),
    featured_subject: str(r.featured_subject),
    classes_taught_for_backend: str(r.classes_taught_for_backend),
    classes_taught: str(r.classes_taught),
    school_boards_catered: str(r.school_boards_catered),
    location_v2: str(r.location_v2),
    students_home_areas: str(r.students_home_areas),
    tutors_home_areas: str(r.tutors_home_areas),
    mode_of_teaching: str(r.mode_of_teaching),
    class_size: str(r.class_size),
    description: str(r.description),
    qualifications_etc: str(r.qualifications_etc),
    years_started_teaching: str(r.years_started_teaching),
    min_fees: num(r.min_fees),
    max_fees: num(r.max_fees),
    hero_image: str(r.hero_image),
    is_paused: r.is_paused === true,
    email_id: str(r.email_id),
    phone_number: str(r.phone_number),
    link: str(r.link),
  };
}

export function normaliseTeachers(raw: unknown): ReviewTeacher[] {
  return list(raw).map(normaliseTeacher).filter((t): t is ReviewTeacher => t !== null);
}

export function normaliseReviewers(raw: unknown): ReviewerRow[] {
  const out: ReviewerRow[] = [];
  for (const x of list(raw)) {
    const r = obj(x);
    const id = str(r.user_id);
    if (!id) continue;
    out.push({ user_id: id, email: str(r.email), name: str(r.name), active: r.active !== false, granted_at: str(r.granted_at) });
  }
  return out;
}

// ----------------------------------------------------------- what changed

/** The fields a reviewer may change on a pending application. The server holds the same list and refuses any other key. */
export const APPLICATION_EDITABLE = [
  'name', 'sir_maam', 'phone_number', 'whatsapp_link', 'subjects', 'classes_taught_for_backend',
  'school_boards_catered', 'location_v2', 'students_home_areas', 'tutors_home_areas',
  'mode_of_teaching', 'class_size', 'description', 'qualifications_etc',
  'years_started_teaching', 'featured_subject', 'min_fees', 'max_fees',
] as const;

/** The fields a reviewer may change on a listed teacher. Contacts, photo, slug and the paused flag are not among them. */
export const TEACHER_EDITABLE = [
  'title', 'sir_maam', 'subjects', 'featured_subject', 'classes_taught_for_backend', 'classes_taught',
  'school_boards_catered', 'location_v2', 'students_home_areas', 'tutors_home_areas',
  'mode_of_teaching', 'class_size', 'description', 'qualifications_etc',
  'years_started_teaching', 'min_fees', 'max_fees',
] as const;

export type ApplicationPatch = Partial<Record<(typeof APPLICATION_EDITABLE)[number], string | number | null>>;
export type TeacherPatch = Partial<Record<(typeof TEACHER_EDITABLE)[number], string | number | null>>;

const same = (a: unknown, b: unknown): boolean => {
  const x = a === undefined || a === '' ? null : typeof a === 'string' ? a.trim() : a;
  const y = b === undefined || b === '' ? null : typeof b === 'string' ? b.trim() : b;
  return x === y;
};

function diff<T extends object>(keys: readonly string[], before: T, after: T): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = {};
  for (const k of keys) {
    const a = (before as Record<string, unknown>)[k];
    const b = (after as Record<string, unknown>)[k];
    if (!same(a, b)) out[k] = b === undefined || b === '' ? null : typeof b === 'string' ? b.trim() : (b as string | number | null);
  }
  return out;
}

/** Only the fields that differ, so a save never rewrites what nobody touched. */
export function applicationPatch(before: ReviewApplication, after: ReviewApplication): ApplicationPatch {
  return diff(APPLICATION_EDITABLE, before, after) as ApplicationPatch;
}

/** As above; when the classes change, the display form (Roman numerals) is recomputed the way the admin page does. */
export function teacherPatch(before: ReviewTeacher, after: ReviewTeacher): TeacherPatch {
  const patch = diff(TEACHER_EDITABLE, before, after) as TeacherPatch;
  delete patch.classes_taught;
  if ('classes_taught_for_backend' in patch) {
    patch.classes_taught = convertClassesToRoman((patch.classes_taught_for_backend as string | null) ?? null);
  }
  return patch;
}

/** Why a set of details cannot be saved, in words, or null when they can. */
export function detailsProblem(d: {
  name?: string | null;
  title?: string | null;
  subjects: string | null;
  classes_taught_for_backend: string | null;
  min_fees: number | null;
  max_fees: number | null;
  phone_number?: string | null;
}): string | null {
  const name = d.name ?? d.title;
  if (name !== undefined && !name?.trim()) return 'The name cannot be empty.';
  if (!d.subjects?.trim()) return 'Pick at least one subject.';
  if (!d.classes_taught_for_backend?.trim()) return 'Pick at least one class.';
  if ((d.min_fees !== null && d.min_fees < 0) || (d.max_fees !== null && d.max_fees < 0)) return 'Fees cannot be negative.';
  if (d.min_fees !== null && d.max_fees !== null && d.min_fees > d.max_fees) return 'The lowest fee is above the highest fee.';
  if (d.phone_number !== undefined && d.phone_number !== null && d.phone_number.replace(/\D/g, '').length !== 10) {
    return 'The phone number must be 10 digits.';
  }
  return null;
}

/** What an application's status is called on every screen that lists them (admin and reviewer alike). */
export const APPLICATION_STATUS_LABEL: Record<ApplicationStatus, string> = {
  pending: 'Waiting',
  approved: 'Approved',
  rejected: 'Rejected',
};

/** What was sent with an application, in plain words. */
export function docsLabel(a: { hero_image_url: string | null; reference_name: string | null }): string {
  if (a.hero_image_url) return 'Photo and references';
  if (a.reference_name) return 'References only';
  return 'No photo or references';
}

/** React Query keys, one place, scoped so the dummy and the real data never mix. */
export const APPLICATIONS_KEY = (scope: string) => ['teacher-review', scope, 'applications'] as const;
export const TEACHERS_KEY = (scope: string) => ['teacher-review', scope, 'teachers'] as const;

// --------------------------------------------------------------------- API

export interface TeacherReviewApi {
  isReviewer(): Promise<boolean>;
  applications(): Promise<ReviewApplication[]>;
  teachers(): Promise<ReviewTeacher[]>;
  /** Approves a pending application and lists the teacher; returns the new teacher's id. */
  approve(applicationId: string): Promise<number>;
  /** A reason is required; the teacher can read it. */
  reject(applicationId: string, reason: string): Promise<void>;
  updateApplication(applicationId: string, patch: ApplicationPatch): Promise<void>;
  updateTeacher(teacherId: number, patch: TeacherPatch): Promise<void>;
}

export interface TeacherReviewerAdminApi {
  list(): Promise<ReviewerRow[]>;
  add(email: string): Promise<string>;
  remove(userId: string): Promise<void>;
}

async function call(fn: string, args?: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await supabase.rpc(fn as never, (args ?? {}) as never);
  if (error) throw error;
  return data;
}

export async function isTeacherReviewer(): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_teacher_reviewer' as never);
  if (error) return false;
  return Boolean(data);
}

export const realTeacherReviewApi: TeacherReviewApi = {
  isReviewer: isTeacherReviewer,
  async applications() {
    return normaliseApplications(await call('reviewer_list_applications'));
  },
  async teachers() {
    return normaliseTeachers(await call('reviewer_list_teachers'));
  },
  async approve(applicationId) {
    return Number(await call('reviewer_approve_application', { p_id: applicationId }));
  },
  async reject(applicationId, reason) {
    await call('reviewer_reject_application', { p_id: applicationId, p_reason: reason.trim() });
  },
  async updateApplication(applicationId, patch) {
    await call('reviewer_update_application', { p_id: applicationId, p_patch: patch });
  },
  async updateTeacher(teacherId, patch) {
    await call('reviewer_update_teacher', { p_id: teacherId, p_patch: patch });
  },
};

/** Granting and revoking the role: HODs and admins (hod_* functions check is_hod()). */
export const realTeacherReviewerAdminApi: TeacherReviewerAdminApi = {
  async list() {
    return normaliseReviewers(await call('hod_list_teacher_reviewers'));
  },
  async add(email) {
    return (await call('hod_add_teacher_reviewer', { p_email: email.trim() })) as string;
  },
  async remove(userId) {
    await call('hod_remove_teacher_reviewer', { p_user_id: userId });
  },
};
