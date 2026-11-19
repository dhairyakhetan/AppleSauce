import { describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: vi.fn(), from: vi.fn(), auth: { getSession: vi.fn(), onAuthStateChange: vi.fn() } },
}));

import {
  APPLICATION_EDITABLE,
  TEACHER_EDITABLE,
  applicationPatch,
  detailsProblem,
  normaliseApplication,
  normaliseApplications,
  normaliseReviewers,
  normaliseTeacher,
  normaliseTeachers,
  teacherPatch,
} from '@/lib/teacher-review-api';
import { listHas, listToggle } from '@/lib/teacher-options';

const appRow = {
  id: 'a1',
  name: ' Rhea Sen ',
  email: 'rhea@example.com',
  phone_number: '9000000001',
  sir_maam: "Ma'am",
  subjects: 'Maths, Physics',
  classes_taught_for_backend: '9, 10',
  min_fees: '1500',
  max_fees: 2500,
  mou_consent: true,
  status: 'pending',
  created_at: '2026-10-01T00:00:00Z',
};

describe('application shaping', () => {
  it('reads one row, keeping the contacts and turning text numbers into numbers', () => {
    const a = normaliseApplication(appRow)!;
    expect(a.email).toBe('rhea@example.com');
    expect(a.phone_number).toBe('9000000001');
    expect(a.min_fees).toBe(1500);
    expect(a.max_fees).toBe(2500);
    expect(a.status).toBe('pending');
    expect(a.mou_consent).toBe(true);
    expect(a.description).toBeNull();
  });

  it('drops a row with no id and treats an unknown status as pending', () => {
    expect(normaliseApplications([appRow, { name: 'No id' }, null, { ...appRow, id: 'a2', status: 'weird' }])).toHaveLength(2);
    expect(normaliseApplication({ ...appRow, status: 'weird' })!.status).toBe('pending');
    expect(normaliseApplications('nonsense')).toEqual([]);
  });
});

describe('teacher shaping', () => {
  const row = { id: '9001', slug: 'anil', title: 'Anil', email_id: 'a@example.com', phone_number: '9000000003', min_fees: null, is_paused: true };

  it('reads a teacher with contacts and the paused flag', () => {
    const t = normaliseTeacher(row)!;
    expect(t.id).toBe(9001);
    expect(t.email_id).toBe('a@example.com');
    expect(t.phone_number).toBe('9000000003');
    expect(t.is_paused).toBe(true);
    expect(t.min_fees).toBeNull();
  });

  it('drops a row with no usable id', () => {
    expect(normaliseTeachers([row, { title: 'x' }, { id: 'abc' }])).toHaveLength(1);
  });

  it('reads the reviewer list and treats a missing active flag as active', () => {
    const r = normaliseReviewers([{ user_id: 'u1', email: 'n@example.com', name: 'Nila', granted_at: '2026-10-08T00:00:00Z' }, { email: 'no id' }]);
    expect(r).toEqual([{ user_id: 'u1', email: 'n@example.com', name: 'Nila', active: true, granted_at: '2026-10-08T00:00:00Z' }]);
  });
});

describe('what a save sends', () => {
  const before = normaliseApplication(appRow)!;

  it('sends only the fields that changed', () => {
    expect(applicationPatch(before, { ...before, description: 'New text' })).toEqual({ description: 'New text' });
    expect(applicationPatch(before, { ...before, min_fees: 2000, max_fees: 3000 })).toEqual({ min_fees: 2000, max_fees: 3000 });
  });

  it('sends nothing when nothing changed, and treats empty and missing as the same', () => {
    expect(applicationPatch(before, { ...before })).toEqual({});
    expect(applicationPatch({ ...before, description: null }, { ...before, description: '' })).toEqual({});
    expect(applicationPatch(before, { ...before, name: ' Rhea Sen' })).toEqual({});
  });

  it('can clear a field with null', () => {
    const withText = { ...before, description: 'Old' };
    expect(applicationPatch(withText, { ...withText, description: null })).toEqual({ description: null });
  });

  it('never sends a key the server would refuse', () => {
    const wild = { ...before, email: 'other@example.com', status: 'approved' as const, hero_image_url: 'x', reviewed_by: 'u' };
    expect(applicationPatch(before, wild)).toEqual({});
    for (const k of Object.keys(applicationPatch(before, { ...before, name: 'Z', phone_number: '9111111111', subjects: 'Z' }))) {
      expect(APPLICATION_EDITABLE).toContain(k);
    }
  });

  it('a teacher edit recomputes the Roman class text when the classes change, and never touches contacts or the paused flag', () => {
    const t = normaliseTeacher({ id: 1, title: 'T', classes_taught_for_backend: '9, 10', classes_taught: 'IX - X', phone_number: '9000000003', email_id: 'a@example.com' })!;
    const patch = teacherPatch(t, { ...t, classes_taught_for_backend: '9, 10, 11', phone_number: '9111111111', email_id: 'b@example.com', is_paused: true });
    expect(patch).toEqual({ classes_taught_for_backend: '9, 10, 11', classes_taught: 'Class IX - XI' });
    for (const k of Object.keys(patch)) expect(TEACHER_EDITABLE).toContain(k);
    expect(TEACHER_EDITABLE).not.toContain('is_paused');
    expect(TEACHER_EDITABLE).not.toContain('phone_number');
    expect(TEACHER_EDITABLE).not.toContain('email_id');
    expect(TEACHER_EDITABLE).not.toContain('slug');
  });

  it('a teacher edit that leaves the classes alone does not resend the Roman text', () => {
    const t = normaliseTeacher({ id: 1, title: 'T', classes_taught_for_backend: '9, 10', classes_taught: 'Class IX - X' })!;
    expect(teacherPatch(t, { ...t, description: 'Better text' })).toEqual({ description: 'Better text' });
  });
});

describe('details that cannot be saved', () => {
  const ok = { name: 'A', subjects: 'Maths', classes_taught_for_backend: '9', min_fees: 1000, max_fees: 2000 };
  it('passes good details', () => {
    expect(detailsProblem(ok)).toBeNull();
    expect(detailsProblem({ ...ok, phone_number: '98765 43210' })).toBeNull();
  });
  it('says what is wrong in words', () => {
    expect(detailsProblem({ ...ok, name: '  ' })).toBe('The name cannot be empty.');
    expect(detailsProblem({ ...ok, subjects: null })).toBe('Pick at least one subject.');
    expect(detailsProblem({ ...ok, classes_taught_for_backend: '' })).toBe('Pick at least one class.');
    expect(detailsProblem({ ...ok, min_fees: 3000 })).toBe('The lowest fee is above the highest fee.');
    expect(detailsProblem({ ...ok, min_fees: -1 })).toBe('Fees cannot be negative.');
    expect(detailsProblem({ ...ok, phone_number: '12345' })).toBe('The phone number must be 10 digits.');
  });
  it('the messages have no em or en dashes', () => {
    expect(JSON.stringify([detailsProblem({ ...ok, name: '' }), detailsProblem({ ...ok, min_fees: 9999 })])).not.toMatch(/[–—]/);
  });
});

describe('comma separated lists', () => {
  it('finds a value ignoring case and spaces, and adds or removes one', () => {
    expect(listHas('Maths,  Physics', 'physics')).toBe(true);
    expect(listHas(null, 'Maths')).toBe(false);
    expect(listToggle('Maths', 'Physics', true)).toBe('Maths, Physics');
    expect(listToggle('Maths, Physics', 'maths', false)).toBe('Physics');
    expect(listToggle('Maths', 'Maths', false)).toBeNull();
    expect(listToggle('Maths', 'Maths', true)).toBe('Maths');
  });
});
