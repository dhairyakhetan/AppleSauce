import { DebugId } from '@/components/DebugId';
import { useAdminDebugOn } from '@/lib/admin-debug';
import { debugFactEntries, type DebugFactValue } from '@/lib/debug-facts';

/**
 * Admin debug mode, beyond ids (owner round 24: "admin debug toggle shows
 * path, file name, paper id, question id, version history"): a row of chips
 * for the facts a review screen already holds, such as the version a
 * question is at, its flag codes, whether its page was verified.
 *
 * Same gate as <DebugId>: renders NOTHING (null, not a hidden element) unless
 * the signed-in account is an admin with debug mode on. Imported only from
 * the checker and the admin pages, which are lazy routes, so it is never in
 * the chunk a signed-out visitor loads. Fetches nothing.
 */
export function DebugFacts({ facts, className }: { facts: Record<string, DebugFactValue>; className?: string }) {
  const on = useAdminDebugOn();
  if (!on) return null;
  const entries = debugFactEntries(facts);
  if (entries.length === 0) return null;
  return (
    <span className={className ? `inline-flex flex-wrap gap-1 ${className}` : 'inline-flex flex-wrap gap-1'}>
      {entries.map(([label, value]) => (
        <DebugId key={label} label={label} value={value} />
      ))}
    </span>
  );
}
