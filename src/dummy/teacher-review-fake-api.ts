/**
 * In-memory fake of the teacher review functions for dummy mode (D75). Test
 * builds only (see src/lib/dummy-mode.ts), reached solely through the
 * PREVIEW_TOOLS-gated lazy import in src/pages/TeacherReview.tsx. Every person
 * here is MADE UP; nothing touches Supabase.
 *
 * It copies the rules the screens lean on: a rejection needs a reason, only a
 * pending application can be edited, approving lists the teacher, and a key
 * outside the editable lists is refused by name.
 */

import {
  APPLICATION_EDITABLE,
  TEACHER_EDITABLE,
  type ApplicationPatch,
  type ReviewApplication,
  type ReviewTeacher,
  type ReviewerRow,
  type TeacherPatch,
  type TeacherReviewApi,
  type TeacherReviewerAdminApi,
} from '@/lib/teacher-review-api';

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

function pgError(message: string) {
  return Object.assign(new Error(message), { code: '22023', message, details: null, hint: null });
}

function app(over: Partial<ReviewApplication> & Pick<ReviewApplication, 'id' | 'name'>): ReviewApplication {
  return {
    email: 'teacher@example.com',
    phone_number: '9000000001',
    sir_maam: "Ma'am",
    subjects: 'Maths',
    classes_taught_for_backend: '9, 10',
    school_boards_catered: 'ICSE/ISC',
    location_v2: "TEACHER'S HOME TUTORING",
    students_home_areas: null,
    tutors_home_areas: 'Ballygunge',
    mode_of_teaching: 'Offline',
    class_size: 'Group',
    description: 'Made up description for a made up teacher.',
    qualifications_etc: 'MSc, made up',
    years_started_teaching: '2015',
    featured_subject: 'Maths',
    whatsapp_link: null,
    hero_image_url: null,
    reference_name: 'Made Up Reference',
    reference_number: '9000000002',
    min_fees: 1500,
    max_fees: 2500,
    mou_consent: true,
    status: 'pending',
    texted_status: 'not_texted',
    reviewed_by: null,
    reviewed_at: null,
    rejection_reason: null,
    created_at: ago(120),
    ...over,
  };
}

function teacher(over: Partial<ReviewTeacher> & Pick<ReviewTeacher, 'id' | 'title'>): ReviewTeacher {
  return {
    slug: over.title.toLowerCase().replace(/[^a-z]+/g, '-'),
    sir_maam: 'Sir',
    subjects: 'Physics',
    featured_subject: 'Physics',
    classes_taught_for_backend: '11, 12',
    classes_taught: 'XI - XII',
    school_boards_catered: 'ISC, CBSE',
    location_v2: 'BOTH OPTIONS LISTED',
    students_home_areas: 'Salt Lake',
    tutors_home_areas: 'Salt Lake',
    mode_of_teaching: 'Online, Offline',
    class_size: 'Solo',
    description: 'Made up profile text.',
    qualifications_etc: 'BSc, made up',
    years_started_teaching: '2012',
    min_fees: 2000,
    max_fees: 3000,
    hero_image: null,
    is_paused: false,
    email_id: 'listed@example.com',
    phone_number: '9000000003',
    link: 'https://wa.me/919000000003',
    ...over,
  };
}

const startApplications = (): ReviewApplication[] => [
  app({ id: 'a1000000-0000-4000-8000-000000000001', name: 'Rhea Sen', email: 'rhea.sen@example.com', created_at: ago(60) }),
  app({ id: 'a1000000-0000-4000-8000-000000000002', name: 'Imran Hossain', sir_maam: 'Sir', subjects: 'Chemistry', email: 'imran.h@example.com', phone_number: '9000000011', created_at: ago(60 * 26) }),
  app({ id: 'a1000000-0000-4000-8000-000000000003', name: 'Old Rejected Example', status: 'rejected', rejection_reason: 'Duplicate of an existing profile.', created_at: ago(60 * 24 * 6) }),
];

const startTeachers = (): ReviewTeacher[] => [
  teacher({ id: 9001, title: 'Anil Kapoor Example' }),
  teacher({ id: 9002, title: 'Sunita Rao Example', sir_maam: "Ma'am", subjects: 'English', featured_subject: 'English', classes_taught_for_backend: '6, 7, 8', classes_taught: 'VI - VIII' }),
  teacher({ id: 9003, title: 'Paused Example', is_paused: true }),
];

export interface FakeTeacherReviewApi extends TeacherReviewApi {
  reset(): void;
  /** Every change the fake accepted, newest last, so a test can see what was sent. */
  log: string[];
}

export function createFakeTeacherReviewApi(): FakeTeacherReviewApi {
  let apps = startApplications();
  let teachers = startTeachers();
  let nextId = 9100;
  const log: string[] = [];

  const refuseUnknown = (patch: Record<string, unknown>, allowed: readonly string[]) => {
    const bad = Object.keys(patch).filter((k) => !allowed.includes(k));
    if (bad.length) throw pgError(`Not editable: ${bad.join(', ')}`);
    if (Object.keys(patch).length === 0) throw pgError('Nothing to change');
  };

  return {
    log,
    reset() {
      apps = startApplications();
      teachers = startTeachers();
      log.length = 0;
    },
    async isReviewer() {
      return true;
    },
    async applications() {
      return apps.map((a) => ({ ...a })).sort((x, y) => y.created_at.localeCompare(x.created_at));
    },
    async teachers() {
      return teachers.map((t) => ({ ...t })).sort((x, y) => x.title.localeCompare(y.title));
    },
    async approve(id) {
      const a = apps.find((x) => x.id === id);
      if (!a || a.status !== 'pending') throw pgError('Application not found or already processed');
      if (!a.mou_consent) throw pgError('Application cannot be approved without MOU consent');
      const newId = nextId++;
      apps = apps.map((x) => (x.id === id ? { ...x, status: 'approved', reviewed_at: new Date().toISOString() } : x));
      teachers = [
        ...teachers,
        teacher({
          id: newId,
          title: a.name,
          sir_maam: a.sir_maam,
          subjects: a.subjects,
          featured_subject: a.featured_subject,
          classes_taught_for_backend: a.classes_taught_for_backend,
          classes_taught: null,
          school_boards_catered: a.school_boards_catered,
          location_v2: a.location_v2,
          students_home_areas: a.students_home_areas,
          tutors_home_areas: a.tutors_home_areas,
          mode_of_teaching: a.mode_of_teaching,
          class_size: a.class_size,
          description: a.description,
          qualifications_etc: a.qualifications_etc,
          years_started_teaching: a.years_started_teaching,
          min_fees: a.min_fees,
          max_fees: a.max_fees,
          email_id: a.email,
          phone_number: a.phone_number,
          link: a.whatsapp_link ?? `https://wa.me/91${a.phone_number}`,
        }),
      ];
      log.push(`approve ${a.name}`);
      return newId;
    },
    async reject(id, reason) {
      if (!reason.trim()) throw pgError('A reason is required');
      const a = apps.find((x) => x.id === id);
      if (!a || a.status !== 'pending') throw pgError('Application already processed');
      apps = apps.map((x) => (x.id === id ? { ...x, status: 'rejected', rejection_reason: reason.trim(), reviewed_at: new Date().toISOString() } : x));
      log.push(`reject ${a.name}: ${reason.trim()}`);
    },
    async updateApplication(id, patch: ApplicationPatch) {
      refuseUnknown(patch, APPLICATION_EDITABLE);
      const a = apps.find((x) => x.id === id);
      if (!a) throw pgError('Application not found');
      if (a.status !== 'pending') throw pgError('Only a pending application can be edited');
      apps = apps.map((x) => (x.id === id ? { ...x, ...(patch as Partial<typeof x>) } : x));
      log.push(`edit application ${a.name}: ${Object.keys(patch).sort().join(', ')}`);
    },
    async updateTeacher(id, patch: TeacherPatch) {
      refuseUnknown(patch, TEACHER_EDITABLE);
      const t = teachers.find((x) => x.id === id);
      if (!t) throw pgError('Teacher not found');
      teachers = teachers.map((x) => (x.id === id ? { ...x, ...(patch as Partial<typeof x>) } : x));
      log.push(`edit teacher ${t.title}: ${Object.keys(patch).sort().join(', ')}`);
    },
  };
}

export function createFakeTeacherReviewerAdminApi(): TeacherReviewerAdminApi {
  let rows: ReviewerRow[] = [
    { user_id: 'f4000000-0000-4000-8000-000000000001', email: 'nila.das@example.com', name: 'Nila Das', active: true, granted_at: ago(60 * 24 * 3) },
  ];
  const known: Record<string, { id: string; name: string | null }> = {
    'tara.bose@example.com': { id: 'd2222222-0000-4000-8000-000000000001', name: 'Tara Bose' },
    'ravi.k@example.com': { id: 'd2222222-0000-4000-8000-000000000004', name: null },
  };
  return {
    async list() {
      return rows.map((r) => ({ ...r }));
    },
    async add(email) {
      const key = email.trim().toLowerCase();
      if (key.startsWith('nobody')) throw new Error(`No account with the email ${email}; they must sign up first`);
      const who = known[key];
      const id = who?.id ?? crypto.randomUUID();
      rows = [{ user_id: id, email: email.trim(), name: who?.name ?? null, active: true, granted_at: new Date().toISOString() }, ...rows.filter((r) => r.user_id !== id)];
      return id;
    },
    async remove(userId) {
      rows = rows.map((r) => (r.user_id === userId ? { ...r, active: false } : r));
    },
  };
}
