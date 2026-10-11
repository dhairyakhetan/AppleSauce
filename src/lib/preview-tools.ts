/* Test-deployment-only tooling, switched by environment rather than by code.
 *
 * Both deployments build from the same branch — see CLAUDE.md. What separates
 * them is VITE_PREVIEW_TOOLS, which is set only in the kanitest Vercel
 * project. That has to be a build-time constant, not a runtime check, so the
 * live build can prove the tooling is gone rather than merely inert:
 * `import.meta.env.VITE_PREVIEW_TOOLS` is inlined by Vite, the comparison
 * folds to `false`, and everything guarded by it is dropped by tree-shaking.
 *
 *   grep -r PreviewTools dist/assets/*.js   -> nothing, on a live build
 *
 * ⚠ Anything VITE_-prefixed ships to every visitor as plain text. This flag is
 * fine to publish; a password would not be. Preview accounts signed in from
 * the browser therefore have public credentials by construction, so they must
 * be powerless throwaways. Admin is deliberately NOT one of them: it reaches
 * real teachers' applications, emails and phone numbers, so it asks for a
 * normal sign-in instead of carrying an embedded credential.
 */

/* The live Vercel project is administered from an account this team cannot
 * reach, so "VITE_PREVIEW_TOOLS is not set there" is an assumption we are
 * unable to verify or enforce. One person copying the working env vars across
 * projects, or adding the flag while debugging, would put the toggle and the
 * intent overlay on the public site.
 *
 * So the flag is no longer the only thing standing in the way. These are the
 * hostnames the live site is served on; the tooling refuses to appear on them
 * whatever the environment says.
 *
 * Deliberately a denylist of the live domain rather than an allowlist of the
 * test one: an allowlist silently disables the tooling the day the preview
 * URL changes, which is the failure we would not notice. This fails the other
 * way -- a new test domain keeps working, and the one domain that must stay
 * clean is named explicitly.
 */
const LIVE_HOSTS = ['shikshaq.in', 'www.shikshaq.in'];

function onLiveSite(): boolean {
  if (typeof window === 'undefined') return false;
  return LIVE_HOSTS.includes(window.location.hostname);
}

/** True only in a build made with VITE_PREVIEW_TOOLS=true (the test site),
 * and never on the live domain regardless of how that build was configured.
 *
 * The order of these two terms matters. `import.meta.env.VITE_PREVIEW_TOOLS`
 * is inlined by Vite, so with the flag absent this folds to `false === true`
 * and short-circuits: the whole expression is a static `false`, `onLiveSite`
 * is never called, and the tooling still tree-shakes out of the bundle
 * completely -- passwords included. Putting the runtime check first would
 * defeat that and ship the components to every visitor merely disabled.
 *
 * The hostname test therefore costs nothing in the normal case. It only does
 * work in the case we cannot otherwise prevent: a live build that somehow
 * carries the flag. */
export const PREVIEW_TOOLS =
  import.meta.env.VITE_PREVIEW_TOOLS === 'true' && !onLiveSite();

/** The roles the preview toggle can put you in.
 *
 * 'admin' is deliberately NOT a member, so adding it back is a type error
 * rather than an oversight. An admin preview would need its password in the
 * bundle, and admin reaches real teachers' applications, emails and phone
 * numbers. Sign in normally for that. */
export type PreviewRole = 'signed-out' | 'student' | 'teacher';
