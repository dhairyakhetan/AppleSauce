/* Who holds which position: the shapes and the plain-words rules, kept apart
   from the screen so each can be tested on its own.

   The database is the real guard (admin_grant_position and friends refuse an
   admin removing themselves, the last admin, and the owner). The functions
   here only decide what the screen offers and how a refusal is worded. */

export type PositionKey = 'admin' | 'hod' | 'verifier' | 'reviewer';

export interface PositionCopy {
  key: PositionKey;
  /** One person: "Verifier". */
  label: string;
  /** The group heading: "Verifiers". */
  plural: string;
  /** What the position lets someone do, one line. */
  does: string;
}

export const POSITIONS: PositionCopy[] = [
  { key: 'admin', label: 'Admin', plural: 'Admins', does: 'Runs the site: people, teachers and logs. Can also open the HOD desk.' },
  { key: 'hod', label: 'HOD', plural: 'HODs', does: 'Leads the verifiers and publishes papers on the HOD desk.' },
  { key: 'verifier', label: 'Verifier', plural: 'Verifiers', does: 'Checks questions on the checking screen.' },
  { key: 'reviewer', label: 'Teacher reviewer', plural: 'Teacher reviewers', does: 'Approves and edits teachers on the teacher review page.' },
];

export const POSITION_BY_KEY: Record<PositionKey, PositionCopy> = Object.fromEntries(POSITIONS.map((p) => [p.key, p])) as Record<
  PositionKey,
  PositionCopy
>;

export interface PositionHolder {
  role: PositionKey;
  /** Null for a pending grant: nobody has signed in with that email yet. */
  user_id: string | null;
  email: string;
  full_name: string | null;
  since: string;
  is_pending: boolean;
  /** The earliest admin. Nobody can remove or change them. */
  is_owner: boolean;
  is_you: boolean;
}

export type GrantResult = 'granted' | 'pending';
export type RevokeResult = 'removed' | 'pending_removed';
export type ChangeResult = 'changed' | 'pending_changed';

export interface PositionsApi {
  list: () => Promise<PositionHolder[]>;
  grant: (email: string, role: PositionKey) => Promise<GrantResult>;
  revoke: (email: string, role: PositionKey) => Promise<RevokeResult>;
  change: (email: string, from: PositionKey, to: PositionKey) => Promise<ChangeResult>;
}

/** Holders of each position, people first (A to Z by email), pending ones last. */
export function groupByPosition(rows: PositionHolder[]): Record<PositionKey, PositionHolder[]> {
  const out: Record<PositionKey, PositionHolder[]> = { admin: [], hod: [], verifier: [], reviewer: [] };
  for (const r of rows) out[r.role]?.push(r);
  for (const k of Object.keys(out) as PositionKey[]) {
    out[k].sort((a, b) => Number(a.is_pending) - Number(b.is_pending) || a.email.localeCompare(b.email));
  }
  return out;
}

/** Why this row's Remove and Change are switched off, or null when they work.
 *  Only the admin position is protected; the database enforces the same. */
export function protectedReason(h: Pick<PositionHolder, 'role' | 'is_owner' | 'is_you'>): string | null {
  if (h.role !== 'admin') return null;
  if (h.is_you) return 'This is you. Ask another admin to change your admin position.';
  if (h.is_owner) return 'This is the owner account. It cannot be removed or changed.';
  return null;
}

/** The positions this person could be changed to: every one they do not hold yet. */
export function changeTargets(rows: PositionHolder[], email: string, from: PositionKey): PositionCopy[] {
  const held = new Set(rows.filter((r) => r.email.toLowerCase() === email.toLowerCase()).map((r) => r.role));
  return POSITIONS.filter((p) => p.key !== from && !held.has(p.key));
}

function withArticle(label: string): string {
  const l = label.toLowerCase();
  return `${/^[aeiou]/.test(l) ? 'an' : 'a'} ${l}`;
}

export function grantedWords(result: GrantResult, email: string, role: PositionKey): string {
  const what = withArticle(POSITION_BY_KEY[role].label);
  return result === 'pending'
    ? `${email} has no account yet. They will become ${what} the first time they sign in with Google.`
    : `${email} is now ${what}. Ask them to reload the site once.`;
}

export function changedWords(result: ChangeResult, email: string, to: PositionKey): string {
  const what = withArticle(POSITION_BY_KEY[to].label);
  return result === 'pending_changed'
    ? `${email} will be ${what} instead, from their first Google sign-in.`
    : `${email} is now ${what}. Ask them to reload the site once.`;
}

/** The server's own refusals are already plain words, so they are shown as
 *  written. Anything else gets the fallback, never a raw database message. */
const SERVER_WORDS =
  /^(You cannot remove or change your own admin position|The owner admin account|The last admin cannot|That person already holds|That grant is already waiting|They do not hold that position|Enter a full email address|Pick a different position)/;

export function positionErrorWords(e: unknown, fallback: string): string {
  const raw = e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message ?? '') : '';
  if (SERVER_WORDS.test(raw)) return raw;
  if (/not authorized/i.test(raw)) return 'Your account is not allowed to do this. Sign in as an admin and try again.';
  return fallback;
}
