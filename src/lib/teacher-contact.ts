import { supabase } from '@/integrations/supabase/client';

/**
 * Read the contact columns that migration 20260917120000 revokes.
 *
 * WHY A FALLBACK RATHER THAN JUST CALLING THE RPC. A schema change and a code
 * deploy cannot land in the same instant, and this project has no staging
 * database -- both deployments share one Supabase project, so the migration is
 * live the moment it runs, whichever order things happen in. Written this way
 * the code is correct on BOTH sides of it:
 *
 *   before the migration   the RPC does not exist, PostgREST answers PGRST202,
 *                          and the direct select still works because the
 *                          columns are still granted
 *   after the migration    the RPC answers, and the direct select would have
 *                          silently returned nothing for those columns
 *
 * That second failure mode is the reason this exists at all. PostgREST expands
 * `select('*')` to the columns a role may read rather than erroring, so the old
 * code would not have failed loudly -- the teacher's phone field would simply
 * have arrived undefined, TeacherDashboard's own validation would then have
 * refused to save, and the teacher would have seen a required-field error on a
 * field that is not on screen.
 *
 * ONCE THE MIGRATION IS APPLIED the fallback branch is dead code and can be
 * deleted. It is left in deliberately until then.
 */

export interface TeacherContact {
  id: number | null;
  slug: string | null;
  emailId: string | null;
  phoneNumber: string | null;
  link: string | null;
}

/** PostgREST's code for "no function matches" -- i.e. the migration has not run yet. */
function isMissingFunction(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === 'PGRST202' || /function .* does not exist/i.test(error.message ?? '');
}

/** The signed-in teacher's own contact columns. */
export async function fetchOwnContact(email: string): Promise<TeacherContact | null> {
  const { data, error } = await supabase.rpc('teacher_own_contact' as never);

  if (!isMissingFunction(error)) {
    if (error) throw error;
    const rows = (data ?? []) as unknown;
    const row = (Array.isArray(rows) ? rows[0] : rows) as
      | { id: number; slug: string; email_id: string; phone_number: string; link: string }
      | undefined;
    if (!row) return null;
    return {
      id: row.id ?? null,
      slug: row.slug ?? null,
      emailId: row.email_id ?? null,
      phoneNumber: row.phone_number ?? null,
      link: row.link ?? null,
    };
  }

  // Pre-migration path.
  const { data: legacy, error: legacyError } = await (supabase
    .from('Shikshaqmine')
    .select('id, "Slug", "Email ID", "Phone Number", "Link"') as never as {
      eq: (c: string, v: string) => { maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: unknown }> };
    })
    .eq('Email ID', email)
    .maybeSingle();

  if (legacyError) throw legacyError;
  if (!legacy) return null;
  return {
    id: (legacy.id as number) ?? null,
    slug: (legacy.Slug as string) ?? null,
    emailId: (legacy['Email ID'] as string) ?? null,
    phoneNumber: (legacy['Phone Number'] as string) ?? null,
    link: (legacy.Link as string) ?? null,
  };
}

/** Every teacher's contact columns, for the admin console. */
export async function fetchAdminContacts(): Promise<Map<number, TeacherContact>> {
  const map = new Map<number, TeacherContact>();

  const { data, error } = await supabase.rpc('admin_teacher_contacts' as never);

  if (!isMissingFunction(error)) {
    if (error) throw error;
    for (const row of (data ?? []) as Array<{ id: number; slug: string; email_id: string; phone_number: string; link: string }>) {
      map.set(row.id, {
        id: row.id, slug: row.slug ?? null, emailId: row.email_id ?? null,
        phoneNumber: row.phone_number ?? null, link: row.link ?? null,
      });
    }
    return map;
  }

  // Pre-migration path.
  const { data: legacy, error: legacyError } = await (supabase
    .from('Shikshaqmine')
    .select('id, "Slug", "Email ID", "Phone Number", "Link"') as never as
      Promise<{ data: Array<Record<string, unknown>> | null; error: unknown }>);

  if (legacyError) throw legacyError;
  for (const row of legacy ?? []) {
    const id = row.id as number;
    map.set(id, {
      id, slug: (row.Slug as string) ?? null, emailId: (row['Email ID'] as string) ?? null,
      phoneNumber: (row['Phone Number'] as string) ?? null, link: (row.Link as string) ?? null,
    });
  }
  return map;
}
