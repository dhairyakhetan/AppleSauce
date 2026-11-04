import { describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: vi.fn(), from: vi.fn(), storage: { from: vi.fn() }, auth: { getSession: vi.fn(), onAuthStateChange: vi.fn() } },
}));

import type { HodVerifierProfile } from '@/lib/hod-api';
import {
  detailsChanged,
  draftFromProfile,
  gradeNotSetLine,
  planProfileSave,
  profileLengthProblem,
  sameSubjects,
  subjectChoices,
  type DetailsDraft,
} from '@/lib/verifier-profile-edit';

const profile = (over: Partial<HodVerifierProfile> = {}): HodVerifierProfile => ({
  user_id: 'u1',
  email: null,
  name: null,
  active: true,
  full_name: 'Asha Rao',
  grade: 10,
  school: 'Sample Hill School',
  board: 'ISC',
  valid_until: '2027-03-31',
  expired: false,
  missing: false,
  preferred_subjects: ['Mathematics'],
  requested_subjects: [],
  requested_at: null,
  ...over,
});

const draftOf = (p: HodVerifierProfile): DetailsDraft => draftFromProfile(p);

describe('draftFromProfile', () => {
  it('starts from what is saved, with the grade as the select shows it', () => {
    expect(draftFromProfile(profile())).toEqual({
      full_name: 'Asha Rao',
      grade: '10',
      school: 'Sample Hill School',
      board: 'ISC',
      valid_until: '2027-03-31',
    });
    expect(draftFromProfile(profile({ grade: 2 })).grade).toBe('5');
    expect(draftFromProfile(profile({ grade: null, full_name: null, name: 'Fallback' })).full_name).toBe('Fallback');
  });
});

describe('profileLengthProblem (the verifier RPC limits: name 120, school 160, board 60)', () => {
  const ok = { full_name: 'a'.repeat(120), school: 'b'.repeat(160), board: 'c'.repeat(60) };

  it('accepts values at the limit', () => {
    expect(profileLengthProblem(ok)).toBeNull();
  });

  it('counts after trimming, as the server does', () => {
    expect(profileLengthProblem({ ...ok, full_name: `  ${'a'.repeat(120)}  ` })).toBeNull();
  });

  it('names the field and the limit when one is too long', () => {
    expect(profileLengthProblem({ ...ok, full_name: 'a'.repeat(121) })).toBe('The name is too long (120 characters at most).');
    expect(profileLengthProblem({ ...ok, school: 'b'.repeat(161) })).toBe('The school is too long (160 characters at most).');
    expect(profileLengthProblem({ ...ok, board: 'c'.repeat(61) })).toBe('The board is too long (60 characters at most).');
  });
});

describe('detailsChanged', () => {
  it('is false when nothing was touched', () => {
    const p = profile();
    expect(detailsChanged(draftOf(p), p)).toBe(false);
  });

  it('ignores spaces around the name and school', () => {
    const p = profile();
    expect(detailsChanged({ ...draftOf(p), full_name: '  Asha Rao ', school: 'Sample Hill School  ' }, p)).toBe(false);
  });

  it('does not count an older 1 to 4 grade as changed just by opening the form', () => {
    const p = profile({ grade: 3 });
    expect(detailsChanged(draftOf(p), p)).toBe(false);
  });

  it('is true for a real change to any of the five fields', () => {
    const p = profile();
    const d = draftOf(p);
    expect(detailsChanged({ ...d, full_name: 'Asha' }, p)).toBe(true);
    expect(detailsChanged({ ...d, grade: '11' }, p)).toBe(true);
    expect(detailsChanged({ ...d, school: 'Other' }, p)).toBe(true);
    expect(detailsChanged({ ...d, board: 'CBSE' }, p)).toBe(true);
    expect(detailsChanged({ ...d, valid_until: '2028-03-31' }, p)).toBe(true);
  });
});

describe('sameSubjects and subjectChoices', () => {
  it('compares subject lists ignoring case, spaces and order', () => {
    expect(sameSubjects(['Physics', 'maths'], ['MATHS', ' physics '])).toBe(true);
    expect(sameSubjects(['Physics'], ['Physics', 'Maths'])).toBe(false);
    expect(sameSubjects([], [])).toBe(true);
  });

  it('offers each subject once, sorted, from everything the desk holds', () => {
    const choices = subjectChoices({
      held: ['Mathematics', 'Physics'],
      waiting: ['mathematics', 'History & Civics'],
      profiles: [{ preferred_subjects: ['Physics'], requested_subjects: ['Chemistry'] }],
      selected: [],
    });
    expect(choices).toEqual(['Chemistry', 'History & Civics', 'Mathematics', 'Physics']);
  });

  it('keeps a subject a verifier already has even when nothing on the desk holds it now', () => {
    const choices = subjectChoices({ held: [], waiting: [], profiles: [{ preferred_subjects: ['Commerce'], requested_subjects: [] }], selected: [] });
    expect(choices).toEqual(['Commerce']);
  });
});

describe('gradeNotSetLine', () => {
  it('says any paper can be given when the grade is empty and details are not expired', () => {
    expect(gradeNotSetLine(profile({ grade: null, missing: true }))).toBe('Grade not set, so any paper can be given');
  });

  it('is left off when a grade is set', () => {
    expect(gradeNotSetLine(profile({ grade: 9 }))).toBeNull();
  });

  it('is left off when expired, because an expired verifier gets no new papers at all', () => {
    expect(gradeNotSetLine(profile({ grade: null, expired: true }))).toBeNull();
  });
});

describe('planProfileSave', () => {
  it('sends nothing when neither details nor subjects changed', () => {
    const p = profile();
    const plan = planProfileSave(draftOf(p), p.preferred_subjects, p);
    expect(plan).toMatchObject({ problem: null, setDetails: false, setSubjects: false, detailsInput: null, dropped: [] });
  });

  it('saves subjects alone without checking the details, so an incomplete old profile is not blocked', () => {
    const p = profile({ school: null, board: null });
    const plan = planProfileSave({ ...draftOf(p), school: '', board: '' }, ['Mathematics', 'Physics'], p);
    expect(plan).toMatchObject({ problem: null, setDetails: false, setSubjects: true, subjects: ['Mathematics', 'Physics'] });
  });

  it('sends details alone, trimmed, with the grade as a number', () => {
    const p = profile();
    const plan = planProfileSave({ ...draftOf(p), full_name: '  Asha  ', grade: '11' }, p.preferred_subjects, p);
    expect(plan.problem).toBeNull();
    expect(plan.setDetails).toBe(true);
    expect(plan.setSubjects).toBe(false);
    expect(plan.detailsInput).toEqual({ full_name: 'Asha', grade: 11, school: 'Sample Hill School', board: 'ISC', valid_until: '2027-03-31' });
  });

  it('refuses a name over the limit and sends nothing for the details', () => {
    const p = profile();
    const plan = planProfileSave({ ...draftOf(p), full_name: 'a'.repeat(121) }, p.preferred_subjects, p);
    expect(plan.problem).toBe('The name is too long (120 characters at most).');
    expect(plan.detailsInput).toBeNull();
  });

  it('reports the first missing field in plain words when details changed', () => {
    const p = profile();
    expect(planProfileSave({ ...draftOf(p), grade: '', school: 'X' }, p.preferred_subjects, p).problem).toBe('Pick their grade.');
    expect(planProfileSave({ ...draftOf(p), school: '   ' }, p.preferred_subjects, p).problem).toBe('Enter their school.');
  });

  it('lists the requested subjects a new subject list would leave out', () => {
    const p = profile({ requested_subjects: ['Chemistry', 'Physics'] });
    const plan = planProfileSave(draftOf(p), ['Physics', 'Mathematics'], p);
    expect(plan.setSubjects).toBe(true);
    expect(plan.dropped).toEqual(['Chemistry']);
  });

  it('does not report requests dropped when the subject list is not being saved', () => {
    const p = profile({ requested_subjects: ['Chemistry'] });
    const plan = planProfileSave(draftOf(p), p.preferred_subjects, p);
    expect(plan.setSubjects).toBe(false);
    expect(plan.dropped).toEqual([]);
  });
});
