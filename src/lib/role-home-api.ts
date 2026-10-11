import { supabase } from '@/integrations/supabase/client';
import { homeFor, type Roles } from '@/lib/role-home';

const safe = (p: PromiseLike<boolean>): Promise<boolean> => Promise.resolve(p).catch(() => false);

/** Read the four staff roles for a signed-in person. Any failure counts as "not that role": this only decides where to land, never what is allowed. */
export async function readRoles(userId: string): Promise<Roles> {
  const [admin, hod, checker, reviewer] = await Promise.all([
    safe(
      supabase
        .from('admins')
        .select('id')
        .eq('id', userId)
        .maybeSingle()
        .then(({ data, error }) => !error && Boolean(data)),
    ),
    safe(supabase.rpc('is_hod' as never).then(({ data, error }) => !error && Boolean(data))),
    safe(supabase.rpc('is_paper_checker' as never).then(({ data, error }) => !error && Boolean(data))),
    safe(supabase.rpc('is_teacher_reviewer' as never).then(({ data, error }) => !error && Boolean(data))),
  ]);
  return { isAdmin: admin, isHod: hod, isChecker: checker, isTeacherReviewer: reviewer };
}

/** The page a person should start on after signing in with no page to return to, or null for the ordinary home. */
export async function resolveRoleHome(userId: string): Promise<string | null> {
  return homeFor(await readRoles(userId));
}
