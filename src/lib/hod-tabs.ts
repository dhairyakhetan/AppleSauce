/**
 * The HOD desk's tabs: their keys, their order, the old names that still work,
 * and which count badge goes on which tab. Pure, so the order and the aliases
 * are tested without a browser. Hod.tsx adds the components.
 */

import type { HodDeskCounts } from '@/lib/hod-publish';

export const TAB_KEYS = [
  'needs-you',
  'ready',
  'uploads',
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

/** The number on a tab's badge, or 0 for none. */
export function tabBadge(key: string, counts: HodDeskCounts | null | undefined): number {
  if (!counts) return 0;
  switch (key) {
    case 'needs-you':
      return counts.needs_you_questions;
    case 'ready':
      return counts.ready;
    case 'uploads':
      return counts.student_uploads_pending;
    default:
      return 0;
  }
}

/** What a badge means, in words, for the tab's tooltip and screen readers. */
export function tabBadgeLabel(key: string, counts: HodDeskCounts | null | undefined): string {
  if (!counts) return '';
  switch (key) {
    case 'needs-you': {
      const n = counts.needs_you_questions;
      return n === 1 ? '1 question waiting for you' : `${n} questions waiting for you`;
    }
    case 'ready': {
      const n = counts.ready;
      return `${n} ${n === 1 ? 'paper' : 'papers'} ready, ${counts.ready_ok} can go live now`;
    }
    case 'uploads': {
      const n = counts.student_uploads_pending;
      return n === 1 ? '1 upload waiting' : `${n} uploads waiting`;
    }
    default:
      return '';
  }
}
