import { supabase } from '@/integrations/supabase/client';

/**
 * Records a WhatsApp contact click as a durable, per-teacher row in our own
 * database (the `whatsapp_clicks` table), so the teacher dashboard's
 * Enquiries panel can show a real count instead of Clarity/GA4 numbers a
 * teacher can't see.
 *
 * Fire-and-forget and fully guarded, same rule as the Clarity/GA4 helpers
 * next to this call site: analytics must never block or break the WhatsApp
 * hand-off, so every error (including RLS or network failures) is swallowed.
 *
 * Deliberately anonymous: no user id or other identifying detail is stored,
 * only which teacher was contacted and when.
 *
 * @param slug - The teacher's slug, the per-teacher dimension to count by.
 */
export function recordWhatsAppClick(slug: string): void {
  try {
    void supabase
      .from('whatsapp_clicks')
      .insert({ teacher_slug: slug })
      .then(({ error }) => {
        if (error && import.meta.env.DEV) {
          console.warn('[whatsapp_clicks] insert failed:', error.message);
        }
      });
  } catch {
    /* never break the contact flow */
  }
}
