/**
 * Teacher counts per subject for the /subjects page.
 *
 * The page used to count teachers by their ONE primary subject_id, so it said Maths 18 and Biology 2 while the home page
 * (which reads each teacher's whole subject list) said Maths 61 and Biology 30, and 20 of 33 rows read "0 teachers"
 * (site-wide audit B2, 27 Nov 2026). This counts the same way the home page does: a teacher counts under every subject in
 * their subject text, plus their primary subject.
 */

const SUBJECT_ALIASES: Record<string, string[]> = {
  computer: ['computer', 'computers'],
  computers: ['computer', 'computers'],
  maths: ['maths', 'mathematics'],
  mathematics: ['maths', 'mathematics'],
};

export interface TeacherSubjectRow {
  subject_id?: string | null;
  /** The teacher's subject list as one comma separated text (teachers_list.subjects). */
  subjects?: string | null;
}

export function teacherMatchesSubject(
  teacher: TeacherSubjectRow,
  subject: { id: string; name: string },
): boolean {
  if (teacher.subject_id && teacher.subject_id === subject.id) return true;
  const tokens = (teacher.subjects || '')
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  const key = subject.name.trim().toLowerCase();
  const aliases = SUBJECT_ALIASES[key] || [key];
  return tokens.some((t) => aliases.includes(t));
}

export function countTeachersBySubject(
  teachers: TeacherSubjectRow[],
  subjects: { id: string; name: string }[],
): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of subjects) {
    out.set(s.id, teachers.filter((t) => teacherMatchesSubject(t, s)).length);
  }
  return out;
}

/** Subjects that have at least one teacher; when none do (the counts could not be read), every subject is kept. */
export function subjectsWithTeachers<T extends { teacherCount: number }>(subjects: T[]): T[] {
  const some = subjects.filter((s) => s.teacherCount > 0);
  return some.length > 0 ? some : subjects;
}
