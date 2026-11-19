import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/* The positions migration is applied by hand after a rehearsal, so this pins the
   properties the rehearsal proved: every admin_* function is closed to anon and
   then opened to authenticated only, checks is_admin() inside, writes the audit
   row with the acting admin, and the trigger can never block a sign-in. */

const sql = readFileSync(new URL('../../supabase/migrations/20261013100000_admin_manage_positions.sql', import.meta.url), 'utf8');

const ADMIN_FNS = ['admin_position_holders()', 'admin_grant_position(text, text)', 'admin_revoke_position(text, text)', 'admin_change_position(text, text, text)'];
const INTERNAL_FNS = [
  'position_owner_id()',
  '_holds_position(uuid, text)',
  '_grant_position(uuid, text, uuid)',
  '_revoke_position(uuid, text)',
  '_position_target_type(text)',
  '_position_audit(text, text, text, text, text)',
  '_guard_admin_removal(uuid)',
];

const esc = (s: string) => s.replace(/[\\()]/g, '\\$&');

function body(name: string): string {
  const start = sql.indexOf(`function public.${name}(`);
  if (start < 0) throw new Error(`missing ${name}`);
  const end = sql.indexOf('end $$;', start);
  return sql.slice(start, end);
}

describe('20261013100000_admin_manage_positions.sql', () => {
  it('has no em or en dashes', () => {
    expect(sql).not.toMatch(/[–—]/);
  });

  it('closes every admin_* function to public, anon and authenticated, then opens it to authenticated only', () => {
    for (const fn of ADMIN_FNS) {
      expect(sql, fn).toMatch(new RegExp(`revoke execute on function public\\.${esc(fn)}\\s+from public, anon, authenticated;`));
      expect(sql, fn).toMatch(new RegExp(`grant\\s+execute on function public\\.${esc(fn)}\\s+to authenticated;`));
    }
    expect(sql).not.toMatch(/grant\s+execute[^;]*\bto\s+(anon|public)\b/i);
  });

  it('keeps the internal helpers and the trigger function closed to every API role', () => {
    for (const fn of [...INTERNAL_FNS, 'apply_pending_role_grants()']) {
      expect(sql, fn).toMatch(new RegExp(`revoke execute on function public\\.${esc(fn)}\\s+from public, anon, authenticated;`));
      expect(sql, fn).not.toMatch(new RegExp(`grant\\s+execute on function public\\.${esc(fn)}`));
    }
  });

  it('is SECURITY DEFINER with a pinned search_path and an is_admin() check raising 42501 in each admin function', () => {
    for (const name of ['admin_position_holders', 'admin_grant_position', 'admin_revoke_position', 'admin_change_position']) {
      const fn = body(name);
      expect(fn, name).toMatch(/security definer/);
      expect(fn, name).toContain('set search_path = public, pg_temp');
      expect(fn, name).toMatch(/if not public\.is_admin\(\) then raise exception 'Not authorized' using errcode = '42501'/);
    }
  });

  it('refuses self-removal, the last admin and the owner', () => {
    const guard = body('_guard_admin_removal');
    expect(guard).toContain('p_target = auth.uid()');
    expect(guard).toContain('The last admin cannot be removed.');
    expect(guard).toContain('p_target = public.position_owner_id()');
    expect(guard).toContain('for update');
    expect(body('admin_revoke_position')).toContain("if p_role = 'admin' then perform public._guard_admin_removal");
    expect(body('admin_change_position')).toContain("if p_from = 'admin' then perform public._guard_admin_removal");
  });

  it('defines the owner as the earliest row in admins', () => {
    expect(body('position_owner_id')).toContain('order by created_at, id limit 1');
  });

  it('audits every change with the acting admin', () => {
    expect(body('_position_audit')).toContain('auth.uid()');
    expect(body('admin_grant_position')).toContain('_position_audit(');
    expect(body('admin_revoke_position')).toContain('_position_audit(');
    expect(body('admin_change_position')).toContain('_position_audit(');
  });

  it('migrates the old pending rows as verifier and replaces the old trigger and table', () => {
    expect(sql).toMatch(/insert into public\.pending_role_grants[\s\S]*'verifier'[\s\S]*from public\.pending_verifier_grants/);
    expect(sql).toContain('drop trigger if exists pending_verifier_grant on auth.users');
    expect(sql).toContain('drop function if exists public.apply_pending_verifier_grant()');
    expect(sql).toContain('drop table if exists public.pending_verifier_grants');
  });

  it('applies pending grants only for a confirmed Google sign-in and never blocks the sign-in', () => {
    const trg = body('apply_pending_role_grants');
    expect(trg).toContain('new.email_confirmed_at is not null');
    expect(trg).toMatch(/providers.*\? 'google'/);
    expect(trg.match(/exception when others then/g)?.length).toBeGreaterThanOrEqual(2);
    expect(trg).toContain('return new;');
    expect(sql).toMatch(/after insert or update of raw_app_meta_data, email_confirmed_at on auth\.users/);
  });

  it('keeps the pending table unreadable to the API roles', () => {
    expect(sql).toContain('alter table public.pending_role_grants enable row level security');
    expect(sql).toContain('revoke all on public.pending_role_grants from public, anon, authenticated');
    expect(sql).not.toMatch(/create policy[^;]*pending_role_grants/i);
  });
});
