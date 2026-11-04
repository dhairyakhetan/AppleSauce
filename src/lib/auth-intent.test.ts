import { describe, expect, it } from 'vitest';
import { heroIntentFor, isStaffRedirect } from '@/lib/auth-intent';

describe('isStaffRedirect', () => {
  it('is true for the staff areas and anything beneath them', () => {
    expect(isStaffRedirect('/admin')).toBe(true);
    expect(isStaffRedirect('/admin/activity')).toBe(true);
    expect(isStaffRedirect('/hod')).toBe(true);
    expect(isStaffRedirect('/hod?tab=needs-you')).toBe(true);
    expect(isStaffRedirect('/checker')).toBe(true);
  });

  it('is false for ordinary destinations and lookalike prefixes', () => {
    expect(isStaffRedirect(null)).toBe(false);
    expect(isStaffRedirect(undefined)).toBe(false);
    expect(isStaffRedirect('')).toBe(false);
    expect(isStaffRedirect('/')).toBe(false);
    expect(isStaffRedirect('/account')).toBe(false);
    expect(isStaffRedirect('/administrators')).toBe(false);
    expect(isStaffRedirect('/hodgepodge')).toBe(false);
  });

  it('is false for an unsafe redirect even when it names a staff path', () => {
    expect(isStaffRedirect('//evil.example/admin')).toBe(false);
    expect(isStaffRedirect('https://evil.example/admin')).toBe(false);
  });
});

describe('heroIntentFor', () => {
  it('shows the staff hero for a staff redirect, whatever was stored', () => {
    expect(heroIntentFor({ kind: 'default' }, '/hod')).toEqual({ kind: 'admin' });
    expect(heroIntentFor({ kind: 'admin' }, '/admin/activity')).toEqual({ kind: 'admin' });
  });

  it('drops a stale admin intent on a plain /auth visit', () => {
    expect(heroIntentFor({ kind: 'admin' }, null)).toEqual({ kind: 'default' });
    expect(heroIntentFor({ kind: 'admin' }, '/account')).toEqual({ kind: 'default' });
  });

  it('keeps every non-staff intent untouched', () => {
    const teacher = { kind: 'teacher' } as const;
    const dashboard = { kind: 'dashboard' } as const;
    expect(heroIntentFor(teacher, null)).toBe(teacher);
    expect(heroIntentFor(dashboard, '/account')).toBe(dashboard);
  });
});
