import { profileInputProblem, type HodVerifierProfile, type ProfileInput } from '@/lib/hod-api';
import { requestWouldBeDropped } from '@/lib/hod-desk';
import { gradeSelectValue, parseSubjectList } from '@/lib/verifier-papers';
import { DEFAULT_VALID_UNTIL } from '@/components/hod/VerifierProfileForm';

/* The logic behind the Verifiers tab's "Edit details" form, with no React in
   it so it can be tested directly. The form saves two things: the details
   (hod_set_verifier_profile) and the preferred subjects (hod_set_preferred_subjects).
   Each is sent only when it changed, so saving one never rewrites the other. */

/** The same limits verifier_set_my_profile enforces on a verifier's own details (20261011220000). */
export const PROFILE_LIMITS = { name: 120, school: 160, board: 60 } as const;

/** The editable fields as the form holds them: strings, exactly as typed or picked. */
export interface DetailsDraft {
  full_name: string;
  grade: string;
  school: string;
  board: string;
  valid_until: string;
}

export function draftFromProfile(p: HodVerifierProfile): DetailsDraft {
  return {
    full_name: p.full_name ?? p.name ?? '',
    grade: gradeSelectValue(p.grade),
    school: p.school ?? '',
    board: p.board ?? '',
    valid_until: p.valid_until ?? DEFAULT_VALID_UNTIL,
  };
}

/** Too-long details, in plain words, or null. Counted after trimming, as the server counts them. */
export function profileLengthProblem(d: Pick<DetailsDraft, 'full_name' | 'school' | 'board'>): string | null {
  if (d.full_name.trim().length > PROFILE_LIMITS.name) return `The name is too long (${PROFILE_LIMITS.name} characters at most).`;
  if (d.school.trim().length > PROFILE_LIMITS.school) return `The school is too long (${PROFILE_LIMITS.school} characters at most).`;
  if (d.board.trim().length > PROFILE_LIMITS.board) return `The board is too long (${PROFILE_LIMITS.board} characters at most).`;
  return null;
}

/** Whether any detail differs from what is saved. The grade compares as the select shows it, so an
 *  older 1 to 4 grade (shown as "Under grade 6") does not count as changed by opening the form. */
export function detailsChanged(draft: DetailsDraft, p: HodVerifierProfile): boolean {
  const base = draftFromProfile(p);
  return (
    draft.full_name.trim() !== base.full_name.trim() ||
    draft.grade !== base.grade ||
    draft.school.trim() !== base.school.trim() ||
    draft.board.trim() !== base.board.trim() ||
    draft.valid_until !== base.valid_until
  );
}

/** Same subjects, ignoring case and order. */
export function sameSubjects(a: string[], b: string[]): boolean {
  const ka = [...new Set(a.map((s) => s.trim().toLowerCase()).filter(Boolean))].sort();
  const kb = [...new Set(b.map((s) => s.trim().toLowerCase()).filter(Boolean))].sort();
  return ka.length === kb.length && ka.every((s, i) => s === kb[i]);
}

/**
 * The choices for the subject boxes: subjects that have papers on this desk. The server
 * refuses a subject with no papers, so the list is built from data the desk already holds:
 * what verifiers hold, what is waiting for a verifier, what any verifier prefers or asked for,
 * and what this verifier has selected now. Deduplicated ignoring case, sorted.
 */
export function subjectChoices(parts: {
  held: string[];
  waiting: string[];
  profiles: Pick<HodVerifierProfile, 'preferred_subjects' | 'requested_subjects'>[];
  selected: string[];
}): string[] {
  const all = [
    ...parts.held,
    ...parts.waiting,
    ...parts.profiles.flatMap((p) => [...p.preferred_subjects, ...p.requested_subjects]),
    ...parts.selected,
  ];
  const byKey = new Map<string, string>();
  for (const raw of all) {
    const s = (raw ?? '').trim().replace(/\s+/g, ' ');
    if (!s) continue;
    const key = s.toLowerCase();
    if (!byKey.has(key)) byKey.set(key, s);
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b));
}

/** The one-line note under a verifier with no grade. Auto-assign reads a missing grade as "any paper";
 *  an expired verifier gets no new papers at all, so the note is left off for them. */
export function gradeNotSetLine(p: Pick<HodVerifierProfile, 'grade' | 'expired'>): string | null {
  if (p.grade != null || p.expired) return null;
  return 'Grade not set, so any paper can be given';
}

export interface SavePlan {
  /** The first problem to show, in plain words, or null. Only details are checked, and only when they changed. */
  problem: string | null;
  setDetails: boolean;
  detailsInput: ProfileInput | null;
  setSubjects: boolean;
  /** What the preferred list will be if it is saved. */
  subjects: string[];
  /** Requested subjects the new list would leave out. Saving then closes the request, so the page asks first. */
  dropped: string[];
}

/** What a Save press will send, given the draft, the selected subjects and the saved profile. */
export function planProfileSave(draft: DetailsDraft, selected: string[], p: HodVerifierProfile): SavePlan {
  const setDetails = detailsChanged(draft, p);
  const setSubjects = !sameSubjects(selected, p.preferred_subjects);
  const subjects = parseSubjectList(selected.join(', '));
  const dropped = setSubjects ? requestWouldBeDropped(p.requested_subjects, subjects) : [];
  if (setDetails) {
    const problem =
      profileLengthProblem(draft) ??
      profileInputProblem({
        full_name: draft.full_name,
        grade: draft.grade,
        school: draft.school,
        board: draft.board,
        valid_until: draft.valid_until,
      });
    const detailsInput: ProfileInput | null = problem
      ? null
      : { full_name: draft.full_name.trim(), grade: Number(draft.grade), school: draft.school.trim(), board: draft.board.trim(), valid_until: draft.valid_until };
    return { problem, setDetails, detailsInput, setSubjects, subjects, dropped };
  }
  return { problem: null, setDetails, detailsInput: null, setSubjects, subjects, dropped };
}
