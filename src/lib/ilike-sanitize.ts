/** Escapes % and _ (ILIKE wildcards) plus the comma/backtick .or() uses as a
 * PostgREST filter separator, so free-text search can't be used to inject an
 * unintended filter clause.
 *
 * The backslash pass must run FIRST. Postgres's LIKE/ILIKE escape character
 * is backslash, so a search string that already contains one has to become
 * a literal backslash (\\) before this adds its own escapes -- otherwise a
 * user-supplied "\%" and this function's own "\" + "%" -> "\%" combine into
 * "\\%", which Postgres reads as an ESCAPED backslash followed by an
 * UNESCAPED, fully active wildcard: the exact filter-injection this
 * function exists to prevent, smuggled in via one raw backslash.
 */
export function sanitizeForIlike(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/[%_,]/g, '\\$&');
}
