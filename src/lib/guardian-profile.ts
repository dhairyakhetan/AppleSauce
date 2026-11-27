import type { SupabaseClient } from '@supabase/supabase-js';
import { diffSubjects } from '@/lib/subject-diff';

/* A guardian (parent) edits their profile (site-wide audit B7, 27 Nov 2026). The student form writes STUDENT columns:
   `grade` for the class and `student_subjects` for the subjects. A guardian's account keeps the child's class in
   `profiles.student_grade` and the child's subjects in `guardian_student_subjects`, so the same form would have saved to
   the wrong places. This file knows the guardian's own columns and tables and nothing else:

     name      profiles.full_name (and the sign-in name, so the header shows it)
     phone     profiles.phone (optional; ten digits when given)
     class     profiles.student_grade
     subjects  guardian_student_subjects (add what is new first, then remove only what was taken off)

   The guardian's address, relationship and child's name and school board are not on this form; they are not touched. */

/** The class choices, the same list the student form uses. */
export const GRADE_OPTIONS = [
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12',
  'UG, First Year', 'UG, Second Year', 'UG, Third Year', 'UG, Fourth Year', 'Other',
] as const;

export const GUARDIAN_NAME_MAX = 80;

export interface GuardianForm {
  full_name: string;
  phone: string;
  student_grade: string;
}

export const EMPTY_GUARDIAN_FORM: GuardianForm = { full_name: '', phone: '', student_grade: '' };

/** What the form shows, from the profile row. Nothing missing becomes "null" text. */
export function guardianFormFromRow(row: { full_name?: string | null; phone?: string | null; student_grade?: string | null } | null | undefined): GuardianForm {
  return {
    full_name: row?.full_name ?? '',
    phone: row?.phone ?? '',
    student_grade: row?.student_grade ?? '',
  };
}

export interface GuardianProblems {
  full_name?: string;
  phone?: string;
  student_grade?: string;
}

/** Plain-words problems, or an empty object when the form can be saved. */
export function guardianProblems(f: GuardianForm): GuardianProblems {
  const out: GuardianProblems = {};
  const name = f.full_name.trim();
  if (!name) out.full_name = 'Enter your name';
  else if (name.length > GUARDIAN_NAME_MAX) out.full_name = `Your name can be ${GUARDIAN_NAME_MAX} characters at most`;
  const phone = f.phone.trim();
  if (phone && !/^\d{10}$/.test(phone)) out.phone = 'Phone number must be exactly 10 digits';
  if (!f.student_grade.trim()) out.student_grade = "Select your child's class";
  return out;
}

/** The columns the save writes. Exactly these and no student column (`grade`, `school_college`...). */
export function guardianProfileUpdate(f: GuardianForm, nowIso: string): Record<string, unknown> {
  return {
    full_name: f.full_name.trim(),
    phone: f.phone.trim() || null,
    student_grade: f.student_grade.trim() || null,
    updated_at: nowIso,
  };
}

type Client = Pick<SupabaseClient, 'from' | 'auth'>;

/**
 * Saves a guardian's profile. Throws the first error it meets; the screen says "Failed to save". The name is also put on the
 * sign-in account (the header shows that name first); a failure there is returned, not thrown, because the profile row is saved.
 */
export async function saveGuardianProfile(
  client: Client,
  userId: string,
  form: GuardianForm,
  chosenSubjectIds: string[],
  options: { nameChanged: boolean; nowIso?: string } = { nameChanged: true },
): Promise<{ nameSyncFailed: boolean }> {
  const { error: profileError } = await client
    .from('profiles')
    .update(guardianProfileUpdate(form, options.nowIso ?? new Date().toISOString()))
    .eq('id', userId);
  if (profileError) throw profileError;

  // Add what is new FIRST, then remove only what was taken off: a dropped connection never leaves a guardian with no subjects.
  const { data: existing, error: readError } = await client.from('guardian_student_subjects').select('subject_id').eq('guardian_id', userId);
  if (readError) throw readError;
  const { toAdd, toRemove } = diffSubjects(((existing ?? []) as { subject_id: string }[]).map((r) => r.subject_id), chosenSubjectIds);
  if (toAdd.length > 0) {
    const { error: insertError } = await client
      .from('guardian_student_subjects')
      .insert(toAdd.map((subject_id) => ({ guardian_id: userId, subject_id })));
    if (insertError) throw insertError;
  }
  if (toRemove.length > 0) {
    const { error: deleteError } = await client.from('guardian_student_subjects').delete().eq('guardian_id', userId).in('subject_id', toRemove);
    if (deleteError) throw deleteError;
  }

  let nameSyncFailed = false;
  if (options.nameChanged) {
    try {
      const { error } = await client.auth.updateUser({ data: { full_name: form.full_name.trim() } });
      nameSyncFailed = Boolean(error);
    } catch {
      nameSyncFailed = true;
    }
  }
  return { nameSyncFailed };
}
