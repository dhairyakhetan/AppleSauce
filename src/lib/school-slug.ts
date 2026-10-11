/**
 * School name <-> URL slug.
 *
 * `papers.school` is free text typed by whoever uploaded the paper, so there is
 * no id to route on. The slug is derived from the name and matched back by
 * comparing slugs rather than by storing one — that way a school renamed in the
 * data does not strand its URL silently; it 404s, which is visible.
 */
export function schoolSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
