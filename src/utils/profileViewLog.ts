import { supabase } from '@/integrations/supabase/client';

/**
 * Records a teacher profile view as a durable, per-teacher row in our own
 * database (the `profile_views` table), the same pattern whatsappClickLog.ts
 * already uses for Enquiries -- so the teacher dashboard can show a real
 * "how many people looked at my listing" count instead of a number only
 * GA4/Clarity have and a teacher can never see.
 *
 * Fire-and-forget and fully guarded: analytics must never block or break the
 * profile page rendering, so every error (including RLS or network
 * failures) is swallowed.
 *
 * Deliberately anonymous: no user id or other identifying detail is stored,
 * only which teacher was viewed and when.
 *
 * @param slug - The teacher's slug, the per-teacher dimension to count by.
 */
export function recordProfileView(slug: string): void {
  try {
    void supabase
      .from('profile_views')
      .insert({ teacher_slug: slug })
      .then(({ error }) => {
        if (error && import.meta.env.DEV) {
          console.warn('[profile_views] insert failed:', error.message);
        }
      });
  } catch {
    /* never break the profile page */
  }
}
