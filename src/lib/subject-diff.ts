/** What to add and what to remove to turn the subjects a student has into the subjects they chose (site-wide audit B6). */
export function diffSubjects(current: string[], chosen: string[]): { toAdd: string[]; toRemove: string[] } {
  const have = new Set(current);
  const want = new Set(chosen);
  return {
    toAdd: [...want].filter((id) => !have.has(id)),
    toRemove: [...have].filter((id) => !want.has(id)),
  };
}
