import { CheckSquare, ClipboardList, Shield, UserCheck, type LucideIcon } from 'lucide-react';

import type { RoleLink, TeamKey } from '@/lib/role-home';

/**
 * How each staff team looks in the account menu: its own icon per link and its
 * own accent. Accents are existing design tokens, written as whole class names
 * (Tailwind cannot build `/opacity` on a `var()` hex colour, so none is used):
 *
 *   papers    brand-blue (indigo tint, deep indigo text)
 *   teachers  success    (green tint, deep green text)
 *   admin     brand      (orange tint, deep orange text)
 *
 * Adding a team: a key in role-home.ts, a link there, and an entry here.
 */

export const LINK_ICON: Record<RoleLink['key'], LucideIcon> = {
  verify: CheckSquare,
  hod: ClipboardList,
  'review-teachers': UserCheck,
  admin: Shield,
};

export const TEAM_STYLE: Record<TeamKey, { chip: string; label: string }> = {
  papers: { chip: 'bg-brand-blue-subtle text-brand-blue-deep', label: 'text-brand-blue-deep' },
  teachers: { chip: 'bg-success-subtle-bg text-success-subtle-text', label: 'text-success-subtle-text' },
  admin: { chip: 'bg-brand-subtle text-brand-deep', label: 'text-brand-deep' },
};
