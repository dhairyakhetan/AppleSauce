/**
 * Each role lands on one home (owner, 7 Oct 2026: "UI is too confusing to
 * navigate"). Pure: which page a person starts on and which links the account
 * menu offers, given the roles they hold. The roles themselves are read from
 * the database by role-home-api.ts and the badge hooks.
 *
 * Since 8 Oct 2026 the staff links are grouped by team, each team with its own
 * section in the menu: the papers team (verify papers, HOD desk), the teachers
 * team (review teachers) and admin. More teams will follow the same shape: add
 * a team key, its links and its look in team-style.ts.
 *
 * is_paper_checker(), is_hod() and is_teacher_reviewer() are all true for an
 * admin, so the order below decides: admin, then HOD, then checker, then
 * teacher reviewer.
 */

export interface Roles {
  isAdmin: boolean;
  isHod: boolean;
  isChecker: boolean;
  isTeacherReviewer: boolean;
}

export const ADMIN_HOME = '/admin';
export const HOD_HOME = '/hod';
export const CHECKER_HOME = '/checker';
export const TEACHER_REVIEW_HOME = '/teacher-review';

/** Where this person starts, or null when they hold no staff role (the ordinary site home). */
export function homeFor(r: Roles): string | null {
  if (r.isAdmin) return ADMIN_HOME;
  if (r.isHod) return HOD_HOME;
  if (r.isChecker) return CHECKER_HOME;
  if (r.isTeacherReviewer) return TEACHER_REVIEW_HOME;
  return null;
}

export type TeamKey = 'papers' | 'teachers' | 'admin';

export interface RoleLink {
  key: 'verify' | 'hod' | 'review-teachers' | 'admin';
  to: string;
  label: string;
  team: TeamKey;
}

export interface RoleGroup {
  team: TeamKey;
  /** The small section label above the links. */
  label: string;
  links: RoleLink[];
}

/** The order the sections appear in, and what each is called. */
export const TEAMS: { team: TeamKey; label: string }[] = [
  { team: 'papers', label: 'Papers team' },
  { team: 'teachers', label: 'Teachers team' },
  { team: 'admin', label: 'Admin team' },
];

/** Every staff link a person has, in the order they are shown (team by team). */
export function roleLinks(r: Roles): RoleLink[] {
  const out: RoleLink[] = [];
  if (r.isChecker) out.push({ key: 'verify', to: CHECKER_HOME, label: 'Verify papers', team: 'papers' });
  if (r.isHod) out.push({ key: 'hod', to: HOD_HOME, label: 'HOD desk', team: 'papers' });
  if (r.isTeacherReviewer) out.push({ key: 'review-teachers', to: TEACHER_REVIEW_HOME, label: 'Review teachers', team: 'teachers' });
  if (r.isAdmin) out.push({ key: 'admin', to: ADMIN_HOME, label: 'Admin', team: 'admin' });
  return out;
}

/** The staff links grouped by team. A team with no link for this person is left out, label and all. */
export function roleGroups(r: Roles): RoleGroup[] {
  const links = roleLinks(r);
  return TEAMS.map((t) => ({ team: t.team, label: t.label, links: links.filter((l) => l.team === t.team) })).filter(
    (g) => g.links.length > 0,
  );
}
