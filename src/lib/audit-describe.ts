import type { AdminStatus } from '@/pages/admin/AdminTable';

/* AD-008: When · Who · Action · Target · Result, with Action a plain bold
   verb phrase and Result the AD-004 status pill. The audit_log table has
   no separate "resulting status" column (it's an append-only record of the
   action taken, not a live snapshot of the target's current state) and both
   are derived here from the same `action`/`target_type` the row already
   carries, keyed on the exact action/targetType strings every
   recordAdminAction() call site in this codebase actually uses. Anything
   not in the map falls back to an honest, unstyled phrase rather than a
   guessed one. */
const ACTION_META: Record<string, { verb: string; result: string; status: AdminStatus }> = {
  'approve:teacher_application': { verb: 'Approved teacher', result: 'Live', status: 'live' },
  'reject:teacher_application': { verb: 'Rejected application', result: 'Rejected', status: 'hidden' },
  'edit:teacher': { verb: 'Edited teacher', result: 'Updated', status: 'paused' },
  'unlist:teacher': { verb: 'Paused teacher', result: 'Paused', status: 'paused' },
  'relist:teacher': { verb: 'Unpaused teacher', result: 'Live', status: 'live' },
  'publish:paper': { verb: 'Published paper', result: 'Live', status: 'live' },
  'takedown:paper': { verb: 'Took down paper', result: 'Hidden', status: 'hidden' },
  'approve:paper_submission': { verb: 'Approved student upload', result: 'Approved', status: 'live' },
  'reject:paper_submission': { verb: 'Rejected student upload', result: 'Rejected', status: 'hidden' },
  'approve:comment': { verb: 'Published review', result: 'Live', status: 'live' },
  'delete:comment': { verb: 'Removed review', result: 'Removed', status: 'hidden' },
  'edit:recommendation': { verb: 'Updated recommendation', result: 'Updated', status: 'paused' },
  'reject:recommendation': { verb: 'Dismissed recommendation', result: 'Dismissed', status: 'hidden' },
  'delete:upvotes': { verb: 'Cleared upvotes', result: 'Cleared', status: 'paused' },
  'delete:feedback': { verb: 'Deleted feedback', result: 'Removed', status: 'hidden' },
  'grant_checker:checker': { verb: 'Added a verifier', result: 'Added', status: 'live' },
  'revoke_checker:checker': { verb: 'Removed a verifier', result: 'Removed', status: 'hidden' },
  'grant_hod:hod': { verb: 'Made someone an HOD', result: 'Added', status: 'live' },
  'revoke_hod:hod': { verb: 'Removed an HOD', result: 'Removed', status: 'hidden' },
};

export function describeAction(row: { action: string; target_type: string }): { verb: string; result: string; status: AdminStatus } {
  const known = ACTION_META[`${row.action}:${row.target_type}`];
  if (known) return known;
  const action = (row.action ?? '').replace(/_/g, ' ').trim();
  const target = (row.target_type ?? '').replace(/_/g, ' ').trim();
  const verb = `${action.charAt(0).toUpperCase()}${action.slice(1)} ${target}`.trim();
  return { verb: verb || 'Something was recorded', result: 'Recorded', status: 'paused' };
}

