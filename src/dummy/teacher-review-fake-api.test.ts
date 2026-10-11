import { describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: vi.fn(), from: vi.fn(), auth: { getSession: vi.fn(), onAuthStateChange: vi.fn() } },
}));

import { createFakeTeacherReviewApi, createFakeTeacherReviewerAdminApi } from '@/dummy/teacher-review-fake-api';
import type { ApplicationPatch } from '@/lib/teacher-review-api';

describe('the fake teacher review API follows the server rules', () => {
  it('lists applications newest first with contacts', async () => {
    const api = createFakeTeacherReviewApi();
    const apps = await api.applications();
    expect(apps[0].created_at >= apps[1].created_at).toBe(true);
    expect(apps.every((a) => a.email && a.phone_number)).toBe(true);
  });

  it('a rejection needs a reason, and only a pending application can be rejected', async () => {
    const api = createFakeTeacherReviewApi();
    const [first] = (await api.applications()).filter((a) => a.status === 'pending');
    await expect(api.reject(first.id, '   ')).rejects.toThrow(/reason/i);
    await api.reject(first.id, 'Not enough detail');
    expect((await api.applications()).find((a) => a.id === first.id)?.rejection_reason).toBe('Not enough detail');
    await expect(api.reject(first.id, 'again')).rejects.toThrow(/already/i);
  });

  it('approving lists the teacher with the application contacts, once', async () => {
    const api = createFakeTeacherReviewApi();
    const [first] = (await api.applications()).filter((a) => a.status === 'pending');
    const before = (await api.teachers()).length;
    const id = await api.approve(first.id);
    const teachers = await api.teachers();
    expect(teachers).toHaveLength(before + 1);
    const listed = teachers.find((t) => t.id === id)!;
    expect(listed.title).toBe(first.name);
    expect(listed.email_id).toBe(first.email);
    expect(listed.phone_number).toBe(first.phone_number);
    await expect(api.approve(first.id)).rejects.toThrow(/already processed/i);
  });

  it('only a pending application can be edited, and an unlisted key is refused by name', async () => {
    const api = createFakeTeacherReviewApi();
    const apps = await api.applications();
    const pending = apps.find((a) => a.status === 'pending')!;
    const rejected = apps.find((a) => a.status === 'rejected')!;
    await api.updateApplication(pending.id, { description: 'Edited' });
    expect((await api.applications()).find((a) => a.id === pending.id)?.description).toBe('Edited');
    await expect(api.updateApplication(rejected.id, { description: 'x' })).rejects.toThrow(/pending/i);
    await expect(api.updateApplication(pending.id, { email: 'x@example.com' } as unknown as ApplicationPatch)).rejects.toThrow(/Not editable: email/);
    await expect(api.updateApplication(pending.id, {})).rejects.toThrow(/Nothing to change/);
  });

  it('a listed teacher can be edited but not paused or given new contacts', async () => {
    const api = createFakeTeacherReviewApi();
    const [t] = await api.teachers();
    await api.updateTeacher(t.id, { description: 'Fixed' });
    expect((await api.teachers()).find((x) => x.id === t.id)?.description).toBe('Fixed');
    await expect(api.updateTeacher(t.id, { is_paused: true } as never)).rejects.toThrow(/Not editable: is_paused/);
    await expect(api.updateTeacher(t.id, { phone_number: '1' } as never)).rejects.toThrow(/Not editable/);
    expect(api.log.at(-1)).toContain('edit teacher');
  });

  it('the reviewer list adds by email, refuses an unknown account and removes', async () => {
    const api = createFakeTeacherReviewerAdminApi();
    const start = (await api.list()).filter((r) => r.active).length;
    const id = await api.add('tara.bose@example.com');
    expect((await api.list()).filter((r) => r.active)).toHaveLength(start + 1);
    await expect(api.add('nobody@example.com')).rejects.toThrow(/No account/);
    await api.remove(id);
    expect((await api.list()).filter((r) => r.active)).toHaveLength(start);
  });
});
