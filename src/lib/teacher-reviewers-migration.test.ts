import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/* Static checks on 20261008120000_teacher_reviewers.sql. They cannot prove the
   database behaves (the Opus reviewer rehearses the migration for that), but
   they hold the rules that were learned the hard way: every function revoked
   from public, anon AND authenticated, never granted to anon, no policy widened
   on the two tables a reviewer must not reach directly. */

const sql = readFileSync('supabase/migrations/20261008120000_teacher_reviewers.sql', 'utf8');
// Comments out, so a sentence in a comment cannot satisfy or break a check.
const code = sql.replace(/--.*$/gm, '');

const created = [...code.matchAll(/create or replace function public\.(\w+)\(/gi)].map((m) => m[1]);
const bodyOf = (name: string): string => {
  const start = code.search(new RegExp(`create or replace function public\\.${name}\\(`, 'i'));
  const rest = code.slice(start + 10);
  const next = rest.search(/create or replace function public\./i);
  return next === -1 ? code.slice(start) : code.slice(start, start + 10 + next);
};

describe('teacher reviewers migration', () => {
  it('creates the functions the client calls', () => {
    for (const fn of [
      'is_teacher_reviewer',
      'hod_add_teacher_reviewer',
      'hod_remove_teacher_reviewer',
      'hod_list_teacher_reviewers',
      'reviewer_list_applications',
      'reviewer_list_teachers',
      'reviewer_reject_application',
      'reviewer_update_application',
      'reviewer_update_teacher',
      'reviewer_approve_application',
      'approve_teacher_application',
    ]) {
      expect(created, fn).toContain(fn);
    }
  });

  it('every function it creates is named in the lock-down block', () => {
    const lock = code.slice(code.search(/do \$lock\$/i));
    // protect_teacher_fields is a trigger function: no client role may run it,
    // so it is revoked on its own (no grant), not in the grant loop.
    for (const fn of created.filter((f) => f !== 'protect_teacher_fields')) expect(lock, fn).toContain(`public.${fn}(`);
    expect(code).toContain('revoke all on function public.protect_teacher_fields() from public, anon, authenticated;');
  });

  it('a reviewer rename survives protect_teacher_fields, slug and email stay protected', () => {
    expect(code).toContain("perform set_config('shikshaq.reviewer_edit', 'on', true);");
    expect(code).toMatch(/if not v_reviewer and old\."Title" is distinct from new\."Title"/);
    expect(code).toMatch(/if old\."Slug" is distinct from new\."Slug" then\s+new\."Slug" := old\."Slug";/);
    expect(code).toMatch(/if old\."Email ID" is distinct from new\."Email ID" then\s+new\."Email ID" := old\."Email ID";/);
  });

  it('the lock-down revokes from public, anon and authenticated by name, then grants to authenticated only', () => {
    const lock = code.slice(code.search(/do \$lock\$/i));
    expect(lock).toMatch(/revoke all on function %s from public, anon, authenticated/);
    expect(lock).toMatch(/grant execute on function %s to authenticated/);
    // Every grant, wherever it is written (a statement or inside format('...')), names authenticated and nothing else.
    const grants = [...code.matchAll(/\bgrant\s+(?:select|execute|all|insert|update|delete)\b[^;'"]*/gi)].map((m) => m[0].replace(/\s+/g, ' ').trim());
    expect(grants).toEqual([
      'grant select on public.teacher_reviewers to authenticated',
      'grant execute on function %s to authenticated',
    ]);
    for (const g of grants) {
      expect(g).not.toMatch(/\banon\b|\bpublic\.(?!teacher_reviewers)|\bto public\b/i);
    }
  });

  it('the two internal helpers are revoked and never granted', () => {
    const lock = code.slice(code.search(/do \$lock\$/i));
    const internal = lock.slice(lock.indexOf("'public.reviewer_actor_name()'"));
    expect(internal).toContain("'public.reviewer_actor_name()'");
    expect(internal).toContain("'public.reviewer_log(text, text, text, text, text)'");
    expect(internal).toMatch(/revoke all on function %s from public, anon, authenticated/);
    expect(internal).not.toMatch(/grant execute/);
  });

  it('every security definer function pins its search path', () => {
    for (const fn of created) {
      const body = bodyOf(fn);
      expect(body, fn).toMatch(/security definer/i);
      expect(body, fn).toMatch(/set search_path to 'public'/i);
    }
  });

  it('every reviewer and HOD function checks the caller inside and raises 42501', () => {
    for (const fn of created.filter((f) => f.startsWith('reviewer_') && !['reviewer_actor_name', 'reviewer_log'].includes(f))) {
      const body = bodyOf(fn);
      expect(body, fn).toMatch(/is_teacher_reviewer\(\)/);
      expect(body, fn).toContain("errcode = '42501'");
    }
    for (const fn of created.filter((f) => f.startsWith('hod_'))) {
      const body = bodyOf(fn);
      expect(body, fn).toMatch(/not public\.is_hod\(\)/);
      expect(body, fn).toContain("errcode = '42501'");
    }
  });

  it('is_teacher_reviewer is true for admins and for an active row, no one else', () => {
    const body = bodyOf('is_teacher_reviewer');
    expect(body).toMatch(/public\.is_admin\(\)\s+or\s+exists/i);
    expect(body).toMatch(/r\.user_id = auth\.uid\(\) and r\.active/);
  });

  it('does not create, alter or drop a policy on the tables a reviewer must not reach directly', () => {
    const policies = [...code.matchAll(/(?:create|alter|drop)\s+policy\s+(?:if exists\s+)?"?[^"\n]*"?\s+on\s+([\w."]+)/gi)].map((m) => m[1]);
    expect(policies.length).toBeGreaterThan(0);
    for (const t of policies) expect(t).toBe('public.teacher_reviewers');
    expect(code).not.toMatch(/alter table\s+public\.(teacher_applications|"Shikshaqmine")/i);
    expect(code).not.toMatch(/(grant|revoke)[^;]*on\s+(table\s+)?public\.(teacher_applications|"Shikshaqmine")/i);
  });

  it('approve keeps its signature and every earlier check, and adds the reviewer', () => {
    const body = bodyOf('approve_teacher_application');
    expect(body).toMatch(/approve_teacher_application\(application_id uuid, admin_id uuid\)/);
    expect(body).toMatch(/auth\.uid\(\) is distinct from admin_id/);
    expect(body).toMatch(/from public\.admins where id = admin_id/);
    expect(body).toMatch(/role = 'admin'/);
    expect(body).toMatch(/is_teacher_reviewer\(\)/);
    expect(body).toMatch(/status = 'pending'/);
    expect(body).toMatch(/mou_consent is not true/);
    expect(body).toMatch(/generate_unique_slug/);
  });

  it('every action a reviewer takes writes an audit row', () => {
    for (const fn of ['reviewer_reject_application', 'reviewer_update_application', 'reviewer_update_teacher', 'reviewer_approve_application']) {
      expect(bodyOf(fn), fn).toMatch(/reviewer_log\(/);
    }
    // An approval by a non-admin is logged inside approve; the wrapper logs the admin case, so it is never logged twice.
    expect(bodyOf('approve_teacher_application')).toMatch(/if not public\.is_admin\(\) then\s+perform public\.reviewer_log/);
    expect(bodyOf('reviewer_approve_application')).toMatch(/if public\.is_admin\(\) then\s+perform public\.reviewer_log/);
    for (const fn of ['hod_add_teacher_reviewer', 'hod_remove_teacher_reviewer']) {
      expect(bodyOf(fn), fn).toMatch(/insert into public\.admin_audit_log/);
    }
  });

  it('a rejection needs a reason and an edit only touches a fixed list of fields', () => {
    expect(bodyOf('reviewer_reject_application')).toMatch(/A reason is required/);
    for (const fn of ['reviewer_update_application', 'reviewer_update_teacher']) {
      const body = bodyOf(fn);
      expect(body, fn).toMatch(/Not editable: %/);
      expect(body, fn).not.toMatch(/is_paused\s*=/);
      expect(body, fn).not.toMatch(/"?(Email ID|Phone Number|Link|Slug|Hero Image)"?\s*=/);
    }
    expect(bodyOf('reviewer_update_application')).toMatch(/Only a pending application can be edited/);
    expect(bodyOf('reviewer_update_application')).not.toMatch(/\bemail\s*=\s*case/);
    expect(bodyOf('reviewer_update_application')).not.toMatch(/\bstatus\s*=\s*case/);
  });

  it('lists name their columns instead of selecting everything', () => {
    for (const fn of ['reviewer_list_applications', 'reviewer_list_teachers']) {
      const body = bodyOf(fn);
      expect(body, fn).not.toMatch(/select\s+\*/i);
      expect(body, fn).not.toMatch(/\b[as]\.\*/);
    }
  });

  it('has no em or en dashes', () => {
    expect(sql).not.toMatch(/[–—]/);
  });
});
