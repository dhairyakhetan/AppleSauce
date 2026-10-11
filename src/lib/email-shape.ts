/** A cheap shape check before asking the server, not a claim of RFC 5322
 *  correctness. Used by the "add a checker by email" admin page so an
 *  obviously-mistyped address never round-trips to the server first; the
 *  RPC itself remains the real authority (it looks the account up by email
 *  and fails if none exists). Kept in its own module, with no Supabase
 *  import, so it can be unit tested without a DOM/localStorage shim. */
export function looksLikeEmail(value: string): boolean {
  const trimmed = value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}
