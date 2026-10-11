import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Pins supabase/migrations/20260930100000_route_only_verified_pages.sql:
 * routing needs a verified page and an un-flagged PDF, the function stays
 * SECURITY DEFINER with a pinned search_path, and it is revoked from public,
 * anon and authenticated BY NAME (CLAUDE.md: revoking from public alone
 * leaves Supabase's role-name grants in place).
 */
const SQL = readFileSync(
  resolve(__dirname, '../../supabase/migrations/20260930100000_route_only_verified_pages.sql'),
  'utf-8',
);
const SIG = 'public.route_maths_admin_to_checkers(boolean, text[])';

describe('route_only_verified_pages migration', () => {
  it('requires a verified page and no pdf_mismatch flag', () => {
    expect(SQL).toContain("(aq.source ->> 'page_verified') = 'true'");
    expect(SQL).toContain("'pdf_mismatch' = any");
  });

  it('keeps SECURITY DEFINER and a pinned search_path', () => {
    expect(SQL).toMatch(/security definer/i);
    expect(SQL).toMatch(/set search_path = public, pg_temp/i);
  });

  it('revokes from public, anon and authenticated by name', () => {
    for (const role of ['public', 'anon', 'authenticated']) {
      expect(SQL).toContain(`revoke all on function ${SIG} from ${role};`);
    }
    expect(SQL).not.toMatch(/grant execute on function public\.route_maths/i);
  });

  it('logs each move back to admin', () => {
    expect(SQL).toContain("'route_back_unverified_page'");
  });

  it('writes no em or en dashes', () => {
    expect(SQL).not.toMatch(/[–—]/);
  });
});
