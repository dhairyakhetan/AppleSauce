import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: vi.fn(), from: vi.fn(), storage: { from: vi.fn() }, auth: { getSession: vi.fn(), onAuthStateChange: vi.fn(), signOut: vi.fn() } },
}));
vi.mock('@/lib/admin-debug', () => ({
  useAdminDebugToggle: () => ({ on: false, canToggle: false, toggle: () => {} }),
  useAdminDebugOn: () => false,
}));

import { TeachersBody, mergeContact } from '@/pages/admin/teachers';
import {
  CONTACTS_FAILED_WORDS,
  buildTeacherUpdate,
  contactsFailed,
  closeWithGuard,
  countsByTeacherView,
  filterTeachers,
  formIsDirty,
  initialTeacherForm,
  publicProfilePath,
  sortTeachers,
  teacherState,
  viewFromParam,
  type TeacherData,
} from '@/lib/admin-teachers';
import { createFakeTeachersApi } from '@/dummy/admin-teachers-fake-api';

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

function teacher(over: Partial<TeacherData> & Pick<TeacherData, 'id'>): TeacherData {
  return {
    Slug: `t-${over.id}`,
    Title: `Teacher ${over.id}`,
    Featured: false,
    "Sir/Ma'am?": 'Sir',
    'Featured Subject': null,
    'Classes Taught for Backend': '9, 10',
    'School Boards Catered': 'ICSE',
    Area: 'Somewhere',
    'Mode of Teaching': null,
    Subjects: 'Maths',
    'Phone Number': '9000000000',
    'Classes Taught': 'IX - X',
    'Hero Image': null,
    'Email ID': 'T@Example.com ',
    'Class Size (Group/ Solo)': null,
    Description: null,
    Video: null,
    'Review 1': null,
    'Review 2': null,
    'Review 3': null,
    Link: null,
    'Video Link': null,
    'LOCATION V2': null,
    "STUDENT'S HOME IN THESE AREAS": null,
    "TUTOR'S HOME IN THESE AREAS": null,
    'Qualifications etc': null,
    'Years they started teaching': null,
    'Min Fees': 2000,
    'Max Fees': 5000,
    is_paused: false,
    created_at: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

const noop = () => {};
const body = (over: Partial<Parameters<typeof TeachersBody>[0]>) =>
  renderToStaticMarkup(
    <TeachersBody load="ready" shown={[]} view="all" search="" onRetry={noop} onClearSearch={noop} onShowAll={noop} onEdit={noop} onTogglePause={noop} {...over} />,
  );

describe('a failed load is an error, never an empty list', () => {
  it('renders the error with Try again and not "No teachers listed"', () => {
    const html = body({ load: 'error' });
    expect(html).toContain('role="alert"');
    expect(text(html)).toContain('The teachers did not load.');
    expect(text(html)).toContain('Try again');
    expect(text(html)).not.toMatch(/No teachers listed|0 listed/i);
  });

  it('shows the empty copy only for a read that succeeded', () => {
    expect(text(body({ load: 'ready' }))).toContain('No teachers listed yet.');
    expect(text(body({ load: 'ready', view: 'paused' }))).toContain('No paused teachers.');
    expect(text(body({ load: 'ready', search: 'zz' }))).toContain('No teachers match "zz".');
  });

  it('shows a skeleton on the first load', () => {
    expect(body({ load: 'loading' })).toContain('aria-busy="true"');
  });
});

describe('status: Live or Paused, with Featured as a tag', () => {
  it('a featured teacher still reads as Live, and Featured is a separate tag', () => {
    const t = teacher({ id: 1, Featured: true });
    expect(teacherState(t)).toBe('live');
    const html = body({ shown: [t] });
    const words = text(html);
    expect(words).toContain('Live');
    expect(words).toContain('Featured');
    // the pill label is Live, the tag is outside the pill
    expect(html).toMatch(/>\s*Live\s*<\/span>\s*<span[^>]*>Featured<\/span>/);
  });

  it('a featured, paused teacher reads as Paused', () => {
    const t = teacher({ id: 2, Featured: true, is_paused: true });
    expect(teacherState(t)).toBe('paused');
    expect(text(body({ shown: [t] }))).toContain('Paused');
  });

  it('counts and filters each view', () => {
    const ts = [teacher({ id: 1, Featured: true }), teacher({ id: 2, is_paused: true }), teacher({ id: 3 }), teacher({ id: 4, Featured: true, is_paused: true })];
    expect(countsByTeacherView(ts)).toEqual({ all: 4, live: 2, paused: 2, featured: 2 });
    expect(filterTeachers(ts, 'live', '').map((t) => t.id)).toEqual([1, 3]);
    expect(filterTeachers(ts, 'paused', '').map((t) => t.id)).toEqual([2, 4]);
    expect(filterTeachers(ts, 'featured', '').map((t) => t.id)).toEqual([1, 4]);
    expect(filterTeachers(ts, 'all', 'teacher 3').map((t) => t.id)).toEqual([3]);
    expect(viewFromParam('paused')).toBe('paused');
    expect(viewFromParam('x')).toBe('all');
  });

  it('sorts by name, lowest fee and newest joined', () => {
    const ts = [
      teacher({ id: 1, Title: 'B', 'Min Fees': 3000, created_at: '2026-02-01T00:00:00.000Z' }),
      teacher({ id: 2, Title: 'A', 'Min Fees': null, created_at: '2026-03-01T00:00:00.000Z' }),
      teacher({ id: 3, Title: 'C', 'Min Fees': 1000, created_at: '2026-01-01T00:00:00.000Z' }),
    ];
    expect(sortTeachers(ts, 'name').map((t) => t.Title)).toEqual(['A', 'B', 'C']);
    expect(sortTeachers(ts, 'fees').map((t) => t.Title)).toEqual(['C', 'B', 'A']);
    expect(sortTeachers(ts, 'joined').map((t) => t.Title)).toEqual(['A', 'B', 'C']);
  });
});

describe('the fee column reads as a range', () => {
  it('never prints a half range as undefined or a dash pair', () => {
    const t = [
      teacher({ id: 1, 'Min Fees': 2000, 'Max Fees': 5000 }),
      teacher({ id: 2, 'Min Fees': 3000, 'Max Fees': null }),
      teacher({ id: 3, 'Min Fees': null, 'Max Fees': 2500 }),
      teacher({ id: 4, 'Min Fees': null, 'Max Fees': null }),
    ];
    const words = text(body({ shown: t }));
    expect(words).toContain('₹2,000 to ₹5,000');
    expect(words).toContain('₹3,000 onwards');
    expect(words).toContain('Up to ₹2,500');
    expect(words).toContain('Not set');
    expect(words).not.toMatch(/undefined|null|NaN|-undefined/);
  });
});

describe('the edit form', () => {
  it('is not dirty just because it was opened, even with the board spelling fixed', () => {
    const t = teacher({ id: 1, 'School Boards Catered': 'icse' });
    const start = initialTeacherForm(t);
    expect(start['School Boards Catered']).toBe('ICSE/ISC');
    expect(formIsDirty(start, { ...start })).toBe(false);
    expect(formIsDirty(start, { ...start, Description: '' })).toBe(false);
    expect(formIsDirty(start, { ...start, Featured: false })).toBe(false);
  });

  it('is dirty after a real edit', () => {
    const start = initialTeacherForm(teacher({ id: 1 }));
    expect(formIsDirty(start, { ...start, Title: 'Changed' })).toBe(true);
    expect(formIsDirty(start, { ...start, Featured: true })).toBe(true);
    expect(formIsDirty(start, { ...start, 'Min Fees': 2500 })).toBe(true);
  });

  it('asks before closing a dirty form and closes at once when clean', async () => {
    const confirm = vi.fn(async () => false);
    expect(await closeWithGuard({ dirty: true, saving: false, confirm })).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
    const calls = confirm.mock.calls as unknown as [{ title: string; confirmLabel: string; cancelLabel: string }][];
    expect(calls[0][0].title).toBe('Discard your changes?');
    expect(calls[0][0].confirmLabel).toBe('Discard changes');
    expect(calls[0][0].cancelLabel).toBe('Keep editing');

    expect(await closeWithGuard({ dirty: true, saving: false, confirm: async () => true })).toBe(true);

    const never = vi.fn(async () => true);
    expect(await closeWithGuard({ dirty: false, saving: false, confirm: never })).toBe(true);
    expect(never).not.toHaveBeenCalled();
  });

  it('never closes in the middle of a save', async () => {
    const confirm = vi.fn(async () => true);
    expect(await closeWithGuard({ dirty: false, saving: true, confirm })).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('a save writes the same fields as before: no Slug, id, Area or EXPANDED, Roman classes, lower-case email', () => {
    const form = { ...initialTeacherForm(teacher({ id: 7 })), EXPANDED: 'x' } as Record<string, unknown>;
    const update = buildTeacherUpdate(form);
    expect(update).not.toHaveProperty('Slug');
    expect(update).not.toHaveProperty('id');
    expect(update).not.toHaveProperty('Area');
    expect(update).not.toHaveProperty('EXPANDED');
    expect(update['Email ID']).toBe('t@example.com');
    expect(update['Classes Taught']).toBe('Class IX - X');
    expect(update.Title).toBe('Teacher 7');
    expect(update['Min Fees']).toBe(2000);
  });

  it('links to the public profile only when there is a slug', () => {
    expect(publicProfilePath({ Slug: 'a-b' })).toBe('/tuition-teachers/a-b');
    expect(publicProfilePath({ Slug: null })).toBeNull();
  });
});

describe('the fake used in dummy mode', () => {
  it('lists, pauses, saves and has no dashes in its text', async () => {
    const api = createFakeTeachersApi();
    const list = await api.list();
    expect(list.length).toBeGreaterThan(3);
    await api.setPaused(list[0].id, true);
    expect((await api.fetchOne(list[0].id))?.is_paused).toBe(true);
    await api.save(list[0].id, { Title: 'Renamed (made up)' });
    expect((await api.fetchOne(list[0].id))?.Title).toBe('Renamed (made up)');
    expect(JSON.stringify(list)).not.toMatch(/[–—]/);
    await expect(api.uploadHero(1, new File([], 'x.png'))).rejects.toThrow();
  });
});

describe('a failed contact read is said out loud and never written back', () => {
  it('a row marked contactsFailed is recognised, an ordinary row is not', () => {
    expect(contactsFailed({ __contactsFailed: true })).toBe(true);
    expect(contactsFailed({})).toBe(false);
    expect(contactsFailed(null)).toBe(false);
    expect(CONTACTS_FAILED_WORDS).not.toMatch(/[\u2013\u2014]/);
  });

  it('the marker is never part of what a save writes', () => {
    const update = buildTeacherUpdate({ ...teacher({ id: 1 }), __contactsFailed: true });
    expect(Object.keys(update).some((k) => k.startsWith('__'))).toBe(false);
  });

  it('with the contacts unread, phone, email and link are left out of the save entirely', () => {
    const update = buildTeacherUpdate({ ...teacher({ id: 1, 'Phone Number': '', 'Email ID': '', Link: '' }), __contactsFailed: true });
    expect('Phone Number' in update).toBe(false);
    expect('Email ID' in update).toBe(false);
    expect('Link' in update).toBe(false);
    expect(update.Subjects).toBe('Maths');
  });

  it('mergeContact marks every row when the read failed and none when it worked', () => {
    const row = { id: 7, Title: 'T' };
    expect(contactsFailed(mergeContact(row, new Map(), true))).toBe(true);
    expect(contactsFailed(mergeContact(row, new Map(), false))).toBe(false);
    const merged = mergeContact(row, new Map([[7, { phoneNumber: '9', link: null, emailId: null }]]), false);
    expect(merged['Phone Number']).toBe('9');
  });
});
