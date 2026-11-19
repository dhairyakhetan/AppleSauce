import { lazy, type ComponentType } from 'react';

/* The body of every section of the Admin page: the old admin page of that name,
   unchanged, drawn inside its tab (see embed.tsx for what "inside" changes).
   Each is the page's default export, so dummy mode keeps working: the default
   export picks the made-up data on its own.

   Keyed by the section key in admin-hints.ts (ADMIN_TABS). Lazy, so opening
   the Admin page loads only the section on screen. */

const Positions = lazy(() => import('@/pages/admin/positions'));
const Checkers = lazy(() => import('@/pages/admin/checkers'));
const Team = lazy(() => import('@/pages/admin/team'));
const Approvals = lazy(() => import('@/pages/admin/approvals'));
const Reviews = lazy(() => import('@/pages/admin/reviews'));
const Teachers = lazy(() => import('@/pages/admin/teachers'));
const Activity = lazy(() => import('@/pages/admin/activity'));
const CheckerLog = lazy(() => import('@/pages/admin/checker-log'));
const Audit = lazy(() => import('@/pages/admin/audit'));
const Pipeline = lazy(() => import('@/pages/admin/pipeline'));
const Feedback = lazy(() => import('@/pages/admin/feedback'));

const Verifiers = () => <Checkers view="verifiers" />;
const Hods = () => <Checkers view="hods" />;
const Reviewers = () => <Checkers view="reviewers" />;

export const SECTION_BODY: Record<string, ComponentType> = {
  positions: Positions,
  verifiers: Verifiers,
  hods: Hods,
  reviewers: Reviewers,
  progress: Team,
  applications: Approvals,
  reviews: Reviews,
  listed: Teachers,
  'question-changes': Activity,
  'checker-activity': CheckerLog,
  'admin-actions': Audit,
  pipeline: Pipeline,
  feedback: Feedback,
};
