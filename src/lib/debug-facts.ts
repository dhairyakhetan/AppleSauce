/** A value a debug chip can show. Arrays are joined, booleans spelled out. */
export type DebugFactValue = string | number | boolean | null | undefined | readonly string[];

/**
 * Turn a facts object into [label, text] pairs for the admin debug chips,
 * dropping anything empty so a chip never reads "null" or "". Pure.
 */
export function debugFactEntries(facts: Record<string, DebugFactValue>): [string, string][] {
  const out: [string, string][] = [];
  for (const [label, raw] of Object.entries(facts)) {
    if (raw === null || raw === undefined) continue;
    let text: string;
    if (Array.isArray(raw)) {
      if (raw.length === 0) continue;
      text = raw.join(', ');
    } else if (typeof raw === 'boolean') {
      text = raw ? 'yes' : 'no';
    } else {
      text = String(raw);
    }
    if (text.trim() === '') continue;
    out.push([label, text]);
  }
  return out;
}
