/* Handoff AU-004a — the auth hero follows the entry intent.
 *
 * The spec is explicit that intent is *already known at the call site* ("the
 * gate sheets and the `shikshaq_pending_whatsapp` flag exist for exactly
 * this; read it, do not add a query"), so this is a sessionStorage handoff
 * written immediately before the gate opens or /auth is navigated to — not a
 * URL parameter. A query string would also leak a teacher's name and a
 * paper's title into history, referrers and analytics for no gain.
 *
 * ⚠ Intent changes what the hero *says*, never what happens after sign-in.
 * The existing `shikshaq_pending_whatsapp` auto-continue and return-URL
 * behaviour are untouched by everything in this file.
 */

export type AuthIntent =
  | { kind: 'default' }
  | { kind: 'whatsapp'; teacherName: string; subject: string; area: string; fee?: string }
  | { kind: 'save'; teacherName: string; subject: string; area: string }
  | { kind: 'paper'; title: string; board: string; school: string; subjectSlug: string }
  | { kind: 'review'; teacherName: string; subject: string; area: string }
  | { kind: 'dashboard' }
  | { kind: 'teacher' }
  | { kind: 'admin' };

const KEY = 'shikshaq.authIntent';
const TTL = 10 * 60 * 1000; // 10 minutes

const DEFAULT: AuthIntent = { kind: 'default' };

/** Every field the spec interpolates must be a real, non-empty string —
 *  "if the intent carries no object, fall back to `default` rather than
 *  rendering a hero with a blank in it". */
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

function validate(value: unknown): AuthIntent {
  if (!value || typeof value !== 'object') return DEFAULT;
  const i = value as Record<string, unknown>;
  switch (i.kind) {
    case 'whatsapp':
    case 'save':
    case 'review':
      return nonEmpty(i.teacherName) && nonEmpty(i.subject) && nonEmpty(i.area)
        ? (value as AuthIntent)
        : DEFAULT;
    case 'paper':
      return nonEmpty(i.title) && nonEmpty(i.board) && nonEmpty(i.school) && nonEmpty(i.subjectSlug)
        ? (value as AuthIntent)
        : DEFAULT;
    case 'dashboard':
    case 'teacher':
    case 'admin':
    case 'default':
      return { kind: i.kind } as AuthIntent;
    default:
      return DEFAULT;
  }
}

export function setAuthIntent(intent: AuthIntent): void {
  try {
    // Validate on the way in too, so a call site that loses its teacher name
    // to a slow query writes nothing rather than a hero with a blank in it.
    const checked = validate(intent);
    if (checked.kind === 'default' && intent.kind !== 'default') {
      sessionStorage.removeItem(KEY);
      return;
    }
    sessionStorage.setItem(KEY, JSON.stringify({ ...checked, at: Date.now() }));
  } catch {
    /* private mode / storage disabled — the default hero is a correct fallback */
  }
}

export function readAuthIntent(): AuthIntent {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return DEFAULT;
    const parsed = JSON.parse(raw) as { at?: unknown };
    if (typeof parsed?.at !== 'number' || Date.now() - parsed.at > TTL) return DEFAULT;
    return validate(parsed);
  } catch {
    return DEFAULT;
  }
}

export function clearAuthIntent(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* nothing to clear if storage is unavailable */
  }
}

/** The heroes address the teacher by first name ("One step from Rupa"), but
 *  call sites hold the display name, which may carry an honorific. */
export function firstNameOf(fullName: string): string {
  const first = fullName.trim().split(/\s+/)[0] ?? '';
  return first.replace(/[^\p{L}\p{N}'-]/gu, '') || fullName.trim();
}
