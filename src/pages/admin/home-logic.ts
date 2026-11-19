import { ADMIN_TABS, type AdminSectionCopy, type AdminTabCopy } from '@/lib/admin-hints';
import { sumBadge, type NavBadge } from '@/pages/admin/shell';
import type { AdminCountField, AdminCountsState } from '@/pages/admin/useAdminSectionCounts';

/* The decisions the Admin page makes that need no screen: which tab and section
   an address means, what the one line under the tabs says, and which count a
   section carries. Pure, so each is checked on its own. */

type Counts = Pick<AdminCountsState, 'counts' | 'failed'>;

/** The tab an address means. A missing or unknown ?tab= is the first tab, the
 *  same as the HOD desk. */
export function resolveTab(requested: string | null): AdminTabCopy {
  return ADMIN_TABS.find((t) => t.key === requested) ?? ADMIN_TABS[0];
}

/** The section an address means inside a tab. A missing or unknown ?section=
 *  is the tab's first section. */
export function resolveSection(tab: AdminTabCopy, requested: string | null): AdminSectionCopy {
  return tab.sections.find((s) => s.key === requested) ?? tab.sections[0];
}

/** Which count a section carries as its badge. Sections not listed have none. */
export const SECTION_COUNT_FIELD: Record<string, AdminCountField> = {
  applications: 'approvals',
  reviews: 'reviews',
};

export function sectionBadge(sectionKey: string, state: Counts): NavBadge {
  const field = SECTION_COUNT_FIELD[sectionKey];
  return field ? sumBadge([field], state) : null;
}

const noun = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The line under the tabs: what the tab is for, then what is waiting when the
 *  tab has a count to give. An unreadable count adds nothing (the Retry button
 *  says so), and is never read as "nothing is waiting". */
export function tabSummary(tab: AdminTabCopy, state: Counts): string {
  if (tab.key !== 'teachers') return tab.summary;
  const { approvals, reviews } = state.counts;
  if (typeof approvals !== 'number' || typeof reviews !== 'number') return tab.summary;
  if (approvals === 0 && reviews === 0) return `${tab.summary} Nothing is waiting right now.`;
  const parts = [approvals > 0 ? noun(approvals, 'application', 'applications') : '', reviews > 0 ? noun(reviews, 'review', 'reviews') : ''].filter(Boolean);
  return `${tab.summary} Waiting for you: ${parts.join(' and ')}.`;
}

/** The address of the same page with a different tab: only ?tab= is kept, so a
 *  filter that belonged to the old tab does not follow the admin to the new one. */
export function tabSearch(tabKey: string): string {
  return `?tab=${tabKey}`;
}
