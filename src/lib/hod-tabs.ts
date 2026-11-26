/**
 * The HOD desk's tabs: their keys, their order, the old names that still work,
 * and which count badge goes on which tab. Pure, so the order and the aliases
 * are tested without a browser. Hod.tsx adds the components.
 */

import type { HodDeskCounts } from '@/lib/hod-publish';
import { requestsBadgeLabel } from '@/lib/fix-requests';
import { UNASSIGNED_SHOWN } from '@/lib/hod-desk';

export const TAB_KEYS = [
  'needs-you',
  'send-to-ai',
  'ready',
  'uploads',
  'requests',
  'live',
  'assignments',
  'verifiers',
  'history',
  'ai-trust',
  'teacher-reviewers',
] as const;

export type TabKey = (typeof TAB_KEYS)[number];

export const DEFAULT_TAB: TabKey = 'needs-you';

/** Old links keep working: ?tab=escalated is Needs you. */
export const TAB_ALIASES: Record<string, TabKey> = {
  escalated: 'needs-you',
  'needs_you': 'needs-you',
  'ready-to-go-live': 'ready',
  'student-uploads': 'uploads',
  'live-papers': 'live',
};

/** The tab a ?tab= value means; the first tab when it is missing or unknown. */
export function resolveTabKey(requested: string | null | undefined): TabKey {
  if (!requested) return DEFAULT_TAB;
  if ((TAB_KEYS as readonly string[]).includes(requested)) return requested as TabKey;
  return TAB_ALIASES[requested] ?? DEFAULT_TAB;
}

/**
 * The number on a tab's badge, or 0 for none. The requests waiting for the HOD come from their own call
 * (hod_request_counts), so they are passed in on their own. So do the papers waiting to be handed out (the list of
 * papers nobody has, the same read the strip of counts makes): since 26 Nov 2026 nothing is handed out by itself, so
 * the Assignments tab says how many wait for an HOD to press Auto assign all.
 */
export function tabBadge(key: string, counts: HodDeskCounts | null | undefined, requestsWaiting = 0, freePapers = 0): number {
  if (key === 'requests') return requestsWaiting;
  if (key === 'assignments') return freePapers;
  if (!counts) return 0;
  switch (key) {
    case 'needs-you':
      return counts.needs_you_questions;
    case 'ready':
      // Only the papers that can really go live. The blocked ones are listed inside the tab with their reasons.
      return counts.ready_ok;
    case 'uploads':
      return counts.student_uploads_pending;
    default:
      return 0;
  }
}

/** The badge as drawn: the list of papers nobody has is read 201 at a time, so more than 200 reads "200+". */
export function tabBadgeText(key: string, n: number): string {
  return key === 'assignments' && n > UNASSIGNED_SHOWN ? `${UNASSIGNED_SHOWN}+` : String(n);
}

/** What a badge means, in words, for the tab's tooltip and screen readers. */
export function tabBadgeLabel(key: string, counts: HodDeskCounts | null | undefined, requestsWaiting = 0, freePapers = 0): string {
  if (key === 'requests') return requestsBadgeLabel(requestsWaiting);
  if (key === 'assignments') {
    const n = tabBadgeText(key, freePapers);
    return freePapers === 1 ? '1 paper waiting to be handed out' : `${n} papers waiting to be handed out`;
  }
  if (!counts) return '';
  switch (key) {
    case 'needs-you': {
      const n = counts.needs_you_questions;
      return n === 1 ? '1 question waiting for you' : `${n} questions waiting for you`;
    }
    case 'ready': {
      const ok = counts.ready_ok;
      const blocked = Math.max(0, counts.ready - ok);
      return `${ok} ${ok === 1 ? 'paper can' : 'papers can'} go live now${blocked > 0 ? `, ${blocked} blocked` : ''}`;
    }
    case 'uploads': {
      const n = counts.student_uploads_pending;
      return n === 1 ? '1 upload waiting' : `${n} uploads waiting`;
    }
    default:
      return '';
  }
}
