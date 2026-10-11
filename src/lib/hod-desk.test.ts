import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: vi.fn(), from: vi.fn(), storage: { from: vi.fn() }, auth: { getSession: vi.fn(), onAuthStateChange: vi.fn() } },
}));

import {
  buildEscalationFix,
  capUnassigned,
  historyView,
  marksTextInvalid,
  requestWouldBeDropped,
  UNASSIGNED_SHOWN,
} from '@/lib/hod-desk';
import { HISTORY_ROLES, isHod, roleWord } from '@/lib/hod-api';
import { nextTabKey } from '@/components/admin/AdminTabs';
import { supabase } from '@/integrations/supabase/client';

describe('Escalations: Save and settle', () => {
  const e = { body: '5. Find x', display_number: '5', marks: 2 as number | null };

  it('never sends the words when the reviewer did not change them (the number stays in the body)', () => {
    const r = buildEscalationFix(e, { body: '5. Find x', number: '5', marks: '3' });
    expect(r).toEqual({ patch: { body: null, display_number: '5', marks: 3 } });
  });

  it('sends edited words exactly as typed, without stripping a leading number or trimming', () => {
    const r = buildEscalationFix(e, { body: '5. Find  $x$ ', number: '5', marks: '2' });
    expect('patch' in r && r.patch.body).toBe('5. Find  $x$ ');
  });

  it('treats an untouched body as untouched even when it has odd spacing', () => {
    const body = '  7.  Solve\n$x^2=4$  ';
    const r = buildEscalationFix({ ...e, body }, { body, number: '5', marks: '2' });
    expect('patch' in r && r.patch.body).toBeNull();
  });

  it('refuses invalid marks in words', () => {
    expect(marksTextInvalid('two')).toBe(true);
    expect(marksTextInvalid('-1')).toBe(true);
    expect(marksTextInvalid('0.5')).toBe(false);
    expect(buildEscalationFix(e, { body: e.body, number: '5', marks: 'two' })).toEqual({ error: 'Marks must be a number, like 2 or 0.5.' });
  });

  it('refuses to blank a stored number or marks (the server would keep the old value and still report success)', () => {
    const noNumber = buildEscalationFix(e, { body: e.body, number: '  ', marks: '2' });
    expect('error' in noNumber).toBe(true);
    const noMarks = buildEscalationFix(e, { body: e.body, number: '5', marks: '' });
    expect('error' in noMarks).toBe(true);
  });

  it('lets a box that was already empty stay empty', () => {
    const r = buildEscalationFix({ body: 'Define x', display_number: null, marks: null }, { body: 'Define y', number: '', marks: '' });
    expect(r).toEqual({ patch: { body: 'Define y', display_number: null, marks: null } });
  });
});

describe('Escalations: source guards', () => {
  const src = readFileSync('src/components/hod/EscalationsTab.tsx', 'utf8');
  it('does not strip numbers from the words it saves', () => {
    expect(src).not.toMatch(/stripLeadingNumberPrefix/);
  });
  it('Cancel resets the number and marks as well as the words', () => {
    expect(src).toMatch(/setNumber\(e\.display_number \?\? ''\)/);
    expect(src).toMatch(/setMarks\(e\.marks != null \? String\(e\.marks\) : ''\)/);
  });
});

describe('Verifiers: a saved subject list closes the request', () => {
  it('names what the typed list leaves out', () => {
    expect(requestWouldBeDropped(['Physics', 'Chemistry'], ['Mathematics', 'physics'])).toEqual(['Chemistry']);
  });
  it('is quiet when the list covers the request or nothing was asked', () => {
    expect(requestWouldBeDropped(['Physics'], ['Mathematics', 'Physics'])).toEqual([]);
    expect(requestWouldBeDropped([], ['Mathematics'])).toEqual([]);
  });
});

describe('Assignments: the free-paper list is capped honestly', () => {
  it('shows the cap and says there are more when one extra row came back', () => {
    const rows = Array.from({ length: UNASSIGNED_SHOWN + 1 }, (_, i) => i);
    const r = capUnassigned(rows);
    expect(r.shown).toHaveLength(UNASSIGNED_SHOWN);
    expect(r.more).toBe(true);
  });
  it('says nothing when everything fits', () => {
    expect(capUnassigned([1, 2, 3])).toEqual({ shown: [1, 2, 3], more: false });
    expect(capUnassigned(Array.from({ length: UNASSIGNED_SHOWN }, (_, i) => i)).more).toBe(false);
  });
  it('the tab asks for one more than it shows', () => {
    const src = readFileSync('src/components/hod/AssignmentsTab.tsx', 'utf8');
    expect(src).toMatch(/unassignedPapers\(UNASSIGNED_SHOWN \+ 1\)/);
  });
});

describe('Assignments: moving a paper away from someone is confirmed', () => {
  const src = readFileSync('src/components/hod/AssignmentsTab.tsx', 'utf8');
  it('Take it myself and Move go through reassign(), which asks first', () => {
    expect(src).toMatch(/void reassign\(a, myId, 'you'/);
    expect(src).toMatch(/void reassign\(a, uid, nameOf\(uid\)/);
    expect(src).not.toMatch(/act\(\(\) => api\.assignPaper\(a\.paper_id, (myId|uid)/);
  });
  it('a failed team or grades load is shown, not read as an empty team', () => {
    expect(src).toMatch(/teamQ\.isError/);
    expect(src).toMatch(/profilesQ\.isError/);
  });
});

describe('History', () => {
  it('keeps the rows on screen when a later page fails', () => {
    expect(historyView({ isLoading: false, isError: true, rowCount: 100 })).toBe('rows');
  });
  it('shows the error only when there is nothing to keep', () => {
    expect(historyView({ isLoading: false, isError: true, rowCount: 0 })).toBe('error');
    expect(historyView({ isLoading: false, isError: false, rowCount: 0 })).toBe('empty');
    expect(historyView({ isLoading: true, isError: false, rowCount: 0 })).toBe('loading');
  });
  it('sends the role words the server uses', () => {
    expect(HISTORY_ROLES.map((r) => r.value)).toEqual(['', 'admin', 'hod', 'verifier']);
    expect(roleWord('verifier')).toBe('Verifier');
    expect(roleWord('checker')).toBe('Verifier');
  });
});

describe('is_hod: a failed call is not "not an HOD"', () => {
  it('throws on an RPC error and answers on success', async () => {
    const rpc = supabase.rpc as unknown as ReturnType<typeof vi.fn>;
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'network' } });
    await expect(isHod()).rejects.toBeTruthy();
    rpc.mockResolvedValueOnce({ data: false, error: null });
    await expect(isHod()).resolves.toBe(false);
    rpc.mockResolvedValueOnce({ data: true, error: null });
    await expect(isHod()).resolves.toBe(true);
  });
  it('the page shows a retry for a failed check', () => {
    const src = readFileSync('src/pages/Hod.tsx', 'utf8');
    expect(src).toMatch(/\.catch\(\(\) =>/);
    expect(src).toMatch(/checkFailed/);
  });
});

describe('HOD tabs follow the ARIA tabs pattern', () => {
  it('arrows, Home and End move between the tab keys', () => {
    const keys = ['escalated', 'assignments', 'history'];
    expect(nextTabKey(keys, 'escalated', 'ArrowRight')).toBe('assignments');
    expect(nextTabKey(keys, 'escalated', 'ArrowLeft')).toBe('history');
    expect(nextTabKey(keys, 'assignments', 'End')).toBe('history');
    expect(nextTabKey(keys, 'history', 'Home')).toBe('escalated');
    expect(nextTabKey(keys, 'history', 'a')).toBeNull();
  });
  it('only the selected tab is a Tab stop', () => {
    const src = readFileSync('src/pages/Hod.tsx', 'utf8');
    expect(src).toMatch(/tabIndex=\{active\.key === t\.key \? 0 : -1\}/);
    expect(src).toMatch(/onKeyDown=\{onTabKeyDown\}/);
  });
});

describe('Teacher reviewers', () => {
  const src = readFileSync('src/components/hod/TeacherReviewersTab.tsx', 'utf8');
  it('a failed load is not drawn as an empty team, and can be retried', () => {
    expect(src).not.toMatch(/setRows\(\[\]\)/);
    expect(src).toMatch(/data-testid="reviewers-load-error"/);
  });
  it('each Remove button names the person', () => {
    expect(src).toMatch(/aria-label=\{`Remove \$\{r\.name \|\| r\.email \|\| 'this person'\}`\}/);
  });
});

describe('20261011140000 hod_desk_fixes', () => {
  const s = readFileSync('supabase/migrations/20261011140000_hod_desk_fixes.sql', 'utf8');
  it('applies the role filter inside the limited scan, not after it', () => {
    const fn = s.slice(s.indexOf('function public.hod_action_history'), s.indexOf('function public.hod_unassign'));
    expect(fn).not.toMatch(/\* 3/);
    expect(fn).not.toMatch(/where p_role is null or l\.role = p_role/);
    expect(fn).toMatch(/v_role is null\s+or v_role = case/);
    expect(fn.indexOf('v_role is null')).toBeLessThan(fn.indexOf('limit greatest'));
  });
  it('accepts the old word checker for verifier', () => {
    expect(s).toMatch(/when p_role = 'checker' then 'verifier'/);
  });
  it('hod_unassign refuses when nothing was open instead of returning silently', () => {
    const fn = s.slice(s.indexOf('function public.hod_unassign'));
    expect(fn).toMatch(/if v_a\.id is null then\s+raise exception/);
  });
  it('keeps the signatures and re-closes both functions to anon', () => {
    expect(s).toMatch(/revoke all on function %s from public, anon, authenticated/);
    expect(s).toMatch(/has_function_privilege\('anon'/);
    expect(s).not.toMatch(/drop function/i);
  });
});
