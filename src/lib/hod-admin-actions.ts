import { recordAdminAction } from '@/lib/audit';
import type { HodAdminApi, HodRow } from '@/lib/hod-api';

/* Making and removing an HOD, with the audit row. Kept out of the component
   so the exact audit strings (grant_hod, revoke_hod) and the order of events
   (the write succeeds first, the audit row follows, and the audit never blocks
   or fails the write) can be tested without rendering anything.

   admin_add_hod / admin_remove_hod write to audit_review_log on the server;
   admin_audit_log, which the Admin actions page reads, gets its row here. */

export interface AdminActor {
  id: string;
  name: string;
}

/** Calls admin_add_hod with the email, then records grant_hod. Returns the new HOD's user id. */
export async function grantHod(hodApi: HodAdminApi, email: string, actor: AdminActor | null): Promise<string> {
  const newId = await hodApi.addHod(email);
  if (actor) {
    void recordAdminAction({
      actorId: actor.id,
      actorName: actor.name,
      action: 'grant_hod',
      targetType: 'hod',
      targetId: typeof newId === 'string' && newId ? newId : email,
      targetLabel: email,
    });
  }
  return newId;
}

/** Calls admin_remove_hod with the user id, then records revoke_hod. */
export async function revokeHod(hodApi: HodAdminApi, hod: HodRow, actor: AdminActor | null): Promise<void> {
  await hodApi.removeHod(hod.user_id);
  if (actor) {
    void recordAdminAction({
      actorId: actor.id,
      actorName: actor.name,
      action: 'revoke_hod',
      targetType: 'hod',
      targetId: hod.user_id,
      targetLabel: hod.email ?? hod.name ?? hod.user_id,
    });
  }
}
