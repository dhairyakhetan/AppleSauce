/**
 * In-memory fake of the admin Listed teachers api for dummy mode (D75). Test
 * builds only (see src/lib/dummy-mode.ts), reached solely through the
 * PREVIEW_TOOLS-gated lazy import in src/pages/admin/teachers.tsx. Every
 * teacher here is MADE UP; nothing touches Supabase.
 *
 * `?load=error` on the URL makes the FIRST list read fail so the error state
 * can be seen; Try again then succeeds. The state is per page load.
 */

import type { TeacherData, TeachersAdminApi } from '@/lib/admin-teachers';

const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

function teacher(over: Partial<TeacherData> & Pick<TeacherData, 'id' | 'Title'>): TeacherData {
  return {
    Slug: over.Title.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, ''),
    Featured: false,
    "Sir/Ma'am?": "Ma'am",
    'Featured Subject': 'Maths',
    'Classes Taught for Backend': '9, 10',
    'School Boards Catered': 'ICSE/ISC, CBSE',
    Area: 'Ballygunge',
    'Mode of Teaching': 'Offline',
    Subjects: 'Maths',
    'Phone Number': '9000000201',
    'Classes Taught': 'IX - X',
    'Hero Image': null,
    'Email ID': 'teacher@example.com',
    'Class Size (Group/ Solo)': 'Group',
    Description: 'Made up profile text for a made up teacher.',
    Video: null,
    'Review 1': 'Made up review one.',
    'Review 2': null,
    'Review 3': null,
    Link: null,
    'Video Link': null,
    'LOCATION V2': "TEACHER'S HOME TUTORING",
    "STUDENT'S HOME IN THESE AREAS": null,
    "TUTOR'S HOME IN THESE AREAS": 'Ballygunge, Gariahat',
    'Qualifications etc': 'MSc (made up)',
    'Years they started teaching': '2014',
    'Min Fees': 2000,
    'Max Fees': 5000,
    is_paused: false,
    created_at: daysAgo(100),
    ...over,
  };
}

function seed(): TeacherData[] {
  return [
    teacher({ id: 1, Title: 'Aparna Mitra (made up)', Featured: true, Subjects: 'Maths, Physics, Chemistry, Biology, Computer Science', Area: 'Ballygunge, Gariahat, Dhakuria, Jodhpur Park', created_at: daysAgo(400) }),
    teacher({ id: 2, Title: 'Biswajit Roy (made up)', "Sir/Ma'am?": 'Sir', Subjects: 'English', 'Min Fees': 3000, 'Max Fees': null, Area: 'Salt Lake', created_at: daysAgo(300) }),
    teacher({ id: 3, Title: 'Charulata Ghosh (made up)', Subjects: 'History, Geography', 'Min Fees': null, 'Max Fees': 2500, is_paused: true, Area: 'Behala', created_at: daysAgo(200) }),
    teacher({ id: 4, Title: 'Dipankar Sarkar (made up)', "Sir/Ma'am?": 'Sir', Subjects: 'Physics', 'Min Fees': null, 'Max Fees': null, Featured: true, is_paused: true, Area: 'New Town', created_at: daysAgo(150) }),
    teacher({ id: 5, Title: 'Elina Chatterjee (made up)', Subjects: 'Biology, Chemistry', 'Min Fees': 0, 'Max Fees': 4000, Area: 'Tollygunge', created_at: daysAgo(90) }),
    teacher({ id: 6, Title: 'Firoz Khan (made up)', "Sir/Ma'am?": 'Sir', Subjects: 'Maths', Area: 'Park Circus', 'Min Fees': 1500, 'Max Fees': 1500, created_at: daysAgo(40) }),
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

export interface FakeTeachersApi extends TeachersAdminApi {
  reset(): void;
}

export function createFakeTeachersApi(): FakeTeachersApi {
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
    async fetchOne(id) {
      await wait(60);
      const r = rows.find((x) => x.id === id);
      return r ? { ...r } : null;
    },
    async save(id, update) {
      await wait();
      rows = rows.map((r) => (r.id === id ? ({ ...r, ...update } as TeacherData) : r));
    },
    async setPaused(id, paused) {
      await wait(60);
      rows = rows.map((r) => (r.id === id ? { ...r, is_paused: paused } : r));
    },
    async uploadHero() {
      await wait(60);
      throw new Error('Photo uploads are switched off in dummy mode');
    },
    reset() {
      rows = seed();
    },
  };
}
