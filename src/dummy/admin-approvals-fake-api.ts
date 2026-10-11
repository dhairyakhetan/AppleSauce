/**
 * In-memory fake of the admin Applications api for dummy mode (D75). Test
 * builds only (see src/lib/dummy-mode.ts), reached solely through the
 * PREVIEW_TOOLS-gated lazy import in src/pages/admin/approvals.tsx. Every
 * person here is MADE UP; nothing touches Supabase.
 *
 * `?load=error` on the URL makes the FIRST list read fail so the error state
 * can be seen; Try again then succeeds. The state is per page load.
 */

import type { ApprovalsApi, TeacherApplication, TextedStatus } from '@/lib/admin-applications';

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

function app(over: Partial<TeacherApplication> & Pick<TeacherApplication, 'id' | 'name'>): TeacherApplication {
  const created = over.created_at ?? hoursAgo(30);
  return {
    email: `${over.id}@example.com`,
    phone_number: '9000000000',
    sir_maam: "Ma'am",
    subjects: 'Maths',
    classes_taught_for_backend: '9, 10',
    school_boards_catered: 'ICSE/ISC, CBSE',
    location_v2: "TEACHER'S HOME TUTORING",
    students_home_areas: null,
    tutors_home_areas: 'Ballygunge, Gariahat',
    mode_of_teaching: 'Offline',
    class_size: 'Group',
    description: 'Made up description for a made up teacher. Eight years of classroom teaching and a calm, patient style.',
    qualifications_etc: 'MSc (made up), BEd (made up)',
    years_started_teaching: '2016',
    featured_subject: 'Maths',
    whatsapp_link: null,
    hero_image_url: null,
    reference_name: 'Made Up Reference',
    reference_number: '9000000100',
    min_fees: 2000,
    max_fees: 5000,
    mou_consent: true,
    mou_consent_timestamp: created,
    status: 'pending',
    texted_status: 'not_texted',
    reviewed_by: null,
    reviewed_at: null,
    rejection_reason: null,
    created_at: created,
    updated_at: created,
    ...over,
  };
}

function seed(): TeacherApplication[] {
  return [
    app({ id: 'app-a', name: 'Ananya Rao (made up)', phone_number: '9000000011', created_at: hoursAgo(96), subjects: 'Maths, Physics', classes_taught_for_backend: '9, 10, 11, 12', tutors_home_areas: 'Salt Lake, Sector V, New Town, Rajarhat, Baguiati', texted_status: 'texted' }),
    app({ id: 'app-b', name: 'Bikram Sen (made up)', sir_maam: 'Sir', phone_number: '9000000012', created_at: hoursAgo(60), subjects: 'Chemistry', hero_image_url: null, reference_name: null, reference_number: null, min_fees: 3000, max_fees: null, texted_status: 'follow_up' }),
    app({ id: 'app-c', name: 'Chandra Iyer (made up)', phone_number: '9000000013', created_at: hoursAgo(40), subjects: 'English, History, Geography', classes_taught_for_backend: '6, 7, 8, 9, 10', min_fees: null, max_fees: 2500, location_v2: 'BOTH OPTIONS LISTED', students_home_areas: 'Behala, Tollygunge' }),
    app({ id: 'app-d', name: 'Debashis Paul (made up)', sir_maam: 'Sir', phone_number: '9000000014', created_at: hoursAgo(12), subjects: 'Biology', class_size: 'Solo', hero_image_url: 'data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22400%22 height=%22300%22%3E%3Crect width=%22400%22 height=%22300%22 fill=%22%23d9d2c7%22/%3E%3C/svg%3E' }),
    app({ id: 'app-e', name: 'Esha Dutta (made up)', phone_number: '9000000015', created_at: hoursAgo(6), subjects: 'Computer Science', featured_subject: 'Computer Science', mode_of_teaching: 'Online, Offline' }),
    app({ id: 'app-f', name: 'Farhan Ali (made up)', sir_maam: 'Sir', phone_number: '9000000016', created_at: hoursAgo(200), status: 'approved', reviewed_by: 'dummy-admin', reviewed_at: hoursAgo(150), subjects: 'Maths', texted_status: 'texted' }),
    app({ id: 'app-g', name: 'Gouri Basu (made up)', phone_number: '9000000017', created_at: hoursAgo(240), status: 'rejected', reviewed_by: 'dummy-admin', reviewed_at: hoursAgo(220), rejection_reason: 'We could not reach the reference given. Please apply again with a working number.', subjects: 'Hindi' }),
  ];
}

function loadMode(): string | null {
  try {
    return new URLSearchParams(window.location.search).get('load');
  } catch {
    return null;
  }
}

const wait = (ms = 120) => new Promise((r) => setTimeout(r, ms));

export interface FakeApprovalsApi extends ApprovalsApi {
  reset(): void;
}

export function createFakeApprovalsApi(): FakeApprovalsApi {
  let rows = seed();
  let firstRead = true;
  return {
    async list() {
      await wait();
      const fail = firstRead && loadMode() === 'error';
      firstRead = false;
      if (fail) throw new Error('Made up load failure');
      return rows.map((r) => ({ ...r }));
    },
    async approve(id, adminId) {
      await wait();
      const now = new Date().toISOString();
      rows = rows.map((r) => (r.id === id ? { ...r, status: 'approved', reviewed_by: adminId, reviewed_at: now, updated_at: now } : r));
    },
    async reject(id, adminId, reason) {
      await wait();
      if (!reason || !reason.trim()) throw new Error('A rejection needs a reason');
      const now = new Date().toISOString();
      rows = rows.map((r) => (r.id === id ? { ...r, status: 'rejected', reviewed_by: adminId, reviewed_at: now, updated_at: now, rejection_reason: reason } : r));
    },
    async setTexted(id, status: TextedStatus) {
      await wait(60);
      rows = rows.map((r) => (r.id === id ? { ...r, texted_status: status } : r));
    },
    async reviewerNames(ids) {
      return Object.fromEntries(ids.map((i) => [i, 'Made Up Admin']));
    },
    reset() {
      rows = seed();
    },
  };
}
