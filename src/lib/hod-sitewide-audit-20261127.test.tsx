import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

const rpc = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a), from: vi.fn(), storage: { from: vi.fn() }, auth: { getSession: vi.fn(), onAuthStateChange: vi.fn() } },
}));

import { ProfileLoadFailed } from '@/components/ProfileLoadFailed';
import { ListEnd } from '@/components/ui/list-states';
import { createFakeHodApi } from '@/dummy/hod-fake-api';
import { heldOtherWhy, normaliseHeldOther, normaliseUnqueued, realHodApi } from '@/lib/hod-api';
import {
  errorWords,
  matchesSearch,
  notPublishedWords,
  paperIsQueued,
  paperNotOnList,
  queueErrorWords,
  QUEUE_NOT_ON_WORDS,
  unqueuedBannerListText,
  unqueuedBannerText,
} from '@/lib/hod-publish';
import { classLabel } from '@/lib/class-label';
import { stepProblems, type JoinStepAnswers } from '@/lib/join-apply-steps';
import { examLabel } from '@/lib/paper-cover-mapping';
import { diffSubjects } from '@/lib/subject-diff';
import { countTeachersBySubject, subjectsWithTeachers, teacherMatchesSubject } from '@/lib/subject-counts';

/* HOD and site-wide audit fixes, 27 Nov 2026. The SQL cannot run in CI (no database), so its load-bearing lines are pinned
   from the migration file; every screen keeps working on the OLD database shape (before the owner pastes the file). */

const MIGRATION = 'supabase/migrations/20261127110000_hod_sitewide_audit_fixes.sql';
const sql = readFileSync(MIGRATION, 'utf8')
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');
const read = (p: string) => readFileSync(p, 'utf8');

describe('the migration', () => {
  it('only creates or replaces, and closes every new function to anon', () => {
    expect(sql).not.toMatch(/create function/i);
    for (const fn of ['hod_set_question_state(uuid, text, text)', 'hod_queue_paper(uuid)', 'hod_unqueued_papers(integer)', 'hod_held_other_papers(integer)', 'hod_unassigned_papers(integer)', 'distribute_unassigned_papers()']) {
      expect(sql).toContain(`revoke all on function public.${fn} from public, anon, authenticated;`);
      expect(sql).toContain(`grant execute on function public.${fn} to authenticated;`);
    }
    expect(sql.match(/is_hod\(\)/g)!.length).toBeGreaterThanOrEqual(5);
  });

  it('Put it back gives a question back its state, or sends it to the HOD', () => {
    expect(sql).toContain("if p_state = 'reopen' and v_approval = 'awaiting' and v_q.set_aside_at is not null");
    expect(sql).toContain("v_q.review_bucket not in ('escalated', 'admin')");
    expect(sql).toContain("if v_before = 'passed' then");
    expect(sql).toContain("set review_bucket = 'admin', locked_by = null, locked_until = null");
    // The old rules are untouched.
    expect(sql).toContain('This question is still with the student checkers.');
    expect(sql).toContain("if p_state = 'set_aside' and v_approval = 'awaiting' then");
  });

  it('an HOD can queue a paper only when it is safe', () => {
    for (const guard of [
      "v_p.source is distinct from 'new_ocr'",
      "if v_p.approval_state = 'awaiting' then\n    return 'already';",
      'v_p.live_bank_paper_id is not null',
      "coalesce(v_p.is_red, false)",
      'if v_open > 0 then',
      'if v_passed = 0 then',
      "(q.figure ->> 'path') is null",
    ]) {
      expect(sql).toContain(guard);
    }
    expect(sql).toContain("approval_state = 'awaiting', approval_kind = 'new'");
    expect(sql).toContain("'queued_for_approval'");
  });

  it('the third list excludes what the other two lists already show, and skips live copies in the free list', () => {
    expect(sql).toContain('not (p.n_serv > 0 and public.paper_pictures_complete(p.id))');
    expect(sql).toContain('not (not p.wrong_pdf and g.open_questions > 0 and (g.missing_snips > 0 or g.pages_missing > 0))');
    expect(sql).toContain("where ap.source is distinct from 'live_copy'");
  });

  it('the hand-out records who pressed the button, and the background callers still record nobody', () => {
    expect(sql).toContain("values (p.paper_id, v_user, auth.uid(), 'assigned', now()) on conflict do nothing;");
    expect(sql).toContain("auth.role() = 'service_role'");
  });
});

describe('Put this paper on the Ready list (B2)', () => {
  it('only a paper that is on the list can be published; a paper never queued gets its own button', () => {
    expect(paperIsQueued('awaiting')).toBe(true);
    expect(paperIsQueued(null)).toBe(false);
    expect(paperIsQueued('approved')).toBe(false);
    expect(paperNotOnList({ approval_state: null, is_live: false, kind: 'new' })).toBe(true);
    expect(paperNotOnList({ approval_state: 'awaiting', is_live: false, kind: 'new' })).toBe(false);
    expect(paperNotOnList({ approval_state: null, is_live: true, kind: 'new' })).toBe(false);
    expect(paperNotOnList({ approval_state: null, is_live: false, kind: 'retro' })).toBe(false);
  });

  it('the publish screen shows the box and the button for a paper not on the list', () => {
    const src = read('src/components/hod/PublishFlow.tsx');
    expect(src).toContain('const waiting = paperIsQueued(paper.approval_state);');
    expect(src).toContain('Put this paper on the Ready list');
    expect(src).toContain('await api.queuePaper(paperId);');
    // A paper that was never queued can still be edited here, as before.
    expect(src).toContain('const editable = !paper.is_live && (waiting || paper.approval_state === null);');
  });

  it('a refusal no longer says "still waiting for you" next to "not waiting to go live"', () => {
    expect(notPublishedWords({ code: '55000', message: 'This paper is not waiting to go live.' })).toBe(
      'Not published. Nothing was changed. This paper is not waiting to go live.',
    );
    expect(notPublishedWords({ code: '55000', message: 'This paper is not waiting to go live.' })).not.toContain('still waiting');
  });

  it('says plainly when the database file is not pasted yet', () => {
    expect(queueErrorWords({ code: 'PGRST202', message: 'Could not find the function' })).toBe(QUEUE_NOT_ON_WORDS);
    expect(queueErrorWords({ code: '55000', message: '2 questions are still open. Settle every question first.' })).toBe(
      '2 questions are still open. Settle every question first.',
    );
  });

  it('the fake follows the same rules', async () => {
    const api = createFakeHodApi();
    const waiting = await api.unqueuedPapers();
    expect(waiting).not.toBeNull();
    const first = waiting![0];
    if (first) {
      await api.queuePaper(first.audit_paper_id);
      const after = await api.unqueuedPapers();
      expect(after!.some((p) => p.audit_paper_id === first.audit_paper_id)).toBe(false);
      const preview = await api.paperPreview(first.audit_paper_id);
      expect(preview.paper.approval_state).toBe('awaiting');
    }
  });

  it('the Ready list banner names the papers when the server can, and keeps the old words when it cannot', () => {
    expect(unqueuedBannerListText(2)).toBe('2 papers are fully checked but are not on this list yet. Open each one below and put it on the list.');
    expect(unqueuedBannerListText(0)).toBeNull();
    expect(unqueuedBannerText(1)).toContain('Tell the owner');
    const src = read('src/components/hod/ReadyTab.tsx');
    expect(src).toContain('papers ? unqueuedBannerListText(count) : unqueuedBannerText(count)');
    expect(normaliseUnqueued([{ audit_paper_id: 'a', title: 'T', passed_count: 3, left_out: 1 }, { title: 'no id' }])).toEqual([
      { audit_paper_id: 'a', title: 'T', school: null, cls: null, subject: null, passed_count: 3, left_out: 1 },
    ]);
  });

  it('after the last question, the page does not promise a move that has not happened', () => {
    const src = read('src/components/hod/NeedsYouTab.tsx');
    expect(src).not.toContain('it moves on to');
    expect(src).toContain("stage === 'ready'");
    expect(src).toContain('Open it and put it on the Ready list');
  });
});

describe('the preview of a question left out by mistake (B1)', () => {
  it('an open question with the students has no link to a list it is not in', () => {
    const src = read('src/components/hod/PaperSheet.tsx');
    expect(src).toContain("q.review_bucket === 'escalated' || q.review_bucket === 'admin'");
    expect(src).toContain('open-with-students');
  });
});

describe('Held for another reason (B3)', () => {
  it('reads the list, with a reason for each paper, and ignores a reason it does not know', () => {
    const rows = normaliseHeldOther([
      { paper_id: 'a', subject: 'Maths', open_count: 4, reason: 'wrong_pdf' },
      { paper_id: 'b', open_count: 1, reason: 'something new' },
      { open_count: 9 },
    ]);
    expect(rows.map((r) => [r.paper_id, r.reason])).toEqual([['a', 'wrong_pdf'], ['b', 'other']]);
    for (const k of ['wrong_pdf', 'english_reread', 'reference_pages', 'text', 'other'] as const) {
      expect(heldOtherWhy(k).length).toBeGreaterThan(20);
      expect(heldOtherWhy(k)).not.toMatch(/[–—]/);
    }
  });

  it('a server without the function shows nothing instead of an error', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
    await expect(realHodApi.heldOtherPapers()).resolves.toBeNull();
    rpc.mockResolvedValueOnce({ data: [{ paper_id: 'p', reason: 'text', open_count: 2 }], error: null });
    const rows = await realHodApi.heldOtherPapers(50);
    expect(rows?.[0].reason).toBe('text');
    expect(rpc).toHaveBeenLastCalledWith('hod_held_other_papers', { p_limit: 50 });
  });

  it('the Assignments tab has the third list and the wording of the other two is true', () => {
    const src = read('src/components/hod/AssignmentsTab.tsx');
    expect(src).toContain('Held for another reason');
    expect(src).toContain('api.heldOtherPapers(UNASSIGNED_SHOWN)');
    expect(src).not.toContain('Every paper with questions waiting has a checker.');
    expect(src).not.toContain('has all its pictures and pages.');
    expect(src).toContain('Hand out up to');
  });

  it('the Assignments tab shows server sentences in plain words (C6)', () => {
    const src = read('src/components/hod/AssignmentsTab.tsx');
    expect(src).not.toContain('reasonWords');
    expect(errorWords({ code: '42501', message: 'Not authorized' })).toContain('not set up for the HOD desk');
  });
});

describe('one word for leaving a question out (C2)', () => {
  it('the HOD screens say Leave out, not Set aside', () => {
    expect(read('src/components/hod/NeedsYouTab.tsx')).toMatch(/Leave out\s*\n\s*<\/button>/);
    expect(read('src/components/hod/SendToAiTab.tsx')).toContain('Left out so the paper can go live');
    expect(read('src/lib/history-labels.ts')).toContain("set_aside: 'left out'");
  });
});

describe('the lists wait for the connection (C1) and can be searched (C5)', () => {
  it('Ready, AI trust and Requests use loadGate, not isLoading', () => {
    for (const f of ['ReadyTab', 'AiTrustTab', 'RequestsTab']) {
      const src = read(`src/components/hod/${f}.tsx`);
      expect(src).toContain('loadGate(');
      expect(src).not.toMatch(/\b(q|listQ)\.isLoading\b/);
    }
  });

  it('matches every typed word against any field, ignoring case', () => {
    expect(matchesSearch('', ['x'])).toBe(true);
    expect(matchesSearch('la mart maths', ['La Martiniere', 'Class 10', 'Maths'])).toBe(true);
    expect(matchesSearch('physics', ['La Martiniere', 'Maths'])).toBe(false);
    expect(matchesSearch('10', [null, 10])).toBe(true);
  });
});

describe('fix then pass that half fails (C8)', () => {
  it('says the words are saved and does not reuse the old version', () => {
    const src = read('src/components/hod/NeedsYouTab.tsx');
    expect(src).toContain('class WordsSavedNotPassed');
    expect(src).toContain('Your words are saved. The question is not passed yet:');
  });
});

describe('words that were wrong (C7, C9, P2, P3, P4, P8)', () => {
  it('each says what is true', () => {
    expect(read('src/pages/admin/checkers.tsx')).toContain('go back to Papers nobody has');
    expect(read('src/components/hod/PaperSheet.tsx')).toContain("toast.success('Line removed from the paper.'");
    expect(read('src/components/hod/PaperSheet.tsx')).not.toContain('taken out of the preview');
    expect(read('src/lib/admin-hints.ts')).not.toContain('can be hidden or brought back');
    expect(read('src/components/hod/LiveTab.tsx')).toContain('Title, school, exam, year or board');
    expect(read('src/components/hod/VerifiersTab.tsx')).toContain('Only an admin can switch a checker off');
  });
});

describe('a failed profile read is not "no role" (site-wide B1)', () => {
  it('shows a retry and never the role form', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ProfileLoadFailed onRetry={() => undefined} />
      </MemoryRouter>,
    );
    expect(html).toContain('We could not load your account.');
    expect(html).toContain('Try again');
    expect(html).not.toContain('Student');
  });

  it('every place that used to send a failed read to the role chooser now stops', () => {
    expect(read('src/hooks/use-require-role.tsx')).toContain('if (profileFailed) return;');
    expect(read('src/lib/auth-context.tsx')).toContain('setProfileFailed(failed);');
    const auth = read('src/pages/Auth.tsx');
    expect(auth).toContain('setProfileCheckFailed(true);');
    expect(auth).not.toMatch(/catch \(error\) \{[^}]*navigate\(to, \{ replace: true \}\);[^}]*\}\s*\};\s*\n\s*\n\s*setProfileCheckFailed/);
    const sel = read('src/pages/SelectRole.tsx');
    expect(sel).toContain('setCheckFailed(true);');
    expect(sel).toContain('if (user && checkFailed)');
    expect(read('src/pages/Account.tsx')).toContain('if (profileFailed) return <ProfileLoadFailed');
  });
});

describe('subjects page counts (site-wide B2)', () => {
  const subjects = [
    { id: 's1', name: 'Maths' },
    { id: 's2', name: 'Biology' },
    { id: 's3', name: 'Psychology' },
  ];
  const teachers = [
    { subject_id: 's1', subjects: 'Maths, Physics' },
    { subject_id: null, subjects: 'Mathematics, Biology' },
    { subject_id: 's2', subjects: null },
  ];
  it('counts a teacher under every subject they teach, like the home page', () => {
    const c = countTeachersBySubject(teachers, subjects);
    expect(c.get('s1')).toBe(2);
    expect(c.get('s2')).toBe(2);
    expect(c.get('s3')).toBe(0);
    expect(teacherMatchesSubject({ subjects: 'Computers' }, { id: 'x', name: 'Computer' })).toBe(true);
  });
  it('hides subjects nobody teaches, unless that would hide everything', () => {
    expect(subjectsWithTeachers([{ teacherCount: 3 }, { teacherCount: 0 }])).toEqual([{ teacherCount: 3 }]);
    expect(subjectsWithTeachers([{ teacherCount: 0 }])).toEqual([{ teacherCount: 0 }]);
  });
});

describe('small honest words (site-wide B3, B4, B9)', () => {
  it('"Unknown" is not shown as an exam kind', () => {
    expect(examLabel('Unknown')).toBe('');
    expect(examLabel(' unknown ')).toBe('');
    expect(examLabel('Pre-board')).toBe('Pre-board');
  });
  it('the end-of-list line says what the list is, and only talks about an area when it can widen one', () => {
    expect(renderToStaticMarkup(<ListEnd count={4} what="saved teachers" />)).toContain('That is all 4 saved teachers.');
    expect(renderToStaticMarkup(<ListEnd count={4} what="saved teachers" />)).not.toContain('area');
    expect(renderToStaticMarkup(<ListEnd count={4} />)).toContain('for this search');
    expect(renderToStaticMarkup(<ListEnd count={4} what="teachers" onWiden={() => undefined} />)).toContain('Widen your area');
  });
  it('"Class" goes only in front of a class', () => {
    expect(classLabel('10')).toBe('Class 10');
    expect(classLabel('XII')).toBe('Class XII');
    expect(classLabel('Other')).toBe('Other');
    expect(classLabel('UG, First Year')).toBe('UG, First Year');
    expect(classLabel('')).toBeNull();
  });
});

describe('the teacher form lists everything missing on a step (site-wide B5)', () => {
  const blank: JoinStepAnswers = {
    name: '', email: '', sir_maam: '', phone_number: '', subjects: '', school_boards_catered: '', classes_taught_for_backend: '',
    class_size: '', location_v2: '', students_home_areas: '', tutors_home_areas: '', mode_of_teaching: '', min_fees: '',
  };
  it('step 1 names all four problems at once', () => {
    expect(stepProblems(0, blank)).toEqual([
      'Please enter your name',
      'Please enter a valid email address',
      "Please select Sir or Ma'am",
      'WhatsApp number must be exactly 10 digits',
    ]);
    expect(stepProblems(0, { ...blank, name: 'A', email: 'a@b.co', sir_maam: 'Sir', phone_number: '98765 43210' })).toEqual([]);
  });
  it('the location step asks for the right areas', () => {
    expect(stepProblems(2, { ...blank, location_v2: 'BOTH OPTIONS LISTED', mode_of_teaching: 'Offline' })).toEqual([
      "Please select at least one area for Student's Home Tutoring",
      "Please select at least one area for Teacher's Home Tutoring",
    ]);
    expect(stepProblems(2, blank)).toEqual(['Please select a location option', 'Please select at least one mode of teaching']);
  });
  it('the fee and the other steps keep their old rules', () => {
    expect(stepProblems(3, { ...blank, min_fees: '0' })).toEqual(['Please enter a monthly fee greater than ₹0']);
    expect(stepProblems(3, { ...blank, min_fees: '1,500' })).toEqual([]);
    expect(stepProblems(1, blank)).toHaveLength(4);
    expect(stepProblems(4, blank)).toEqual([]);
  });
  it('the form shows them in an alert that stays', () => {
    const src = read('src/pages/JoinApply.tsx');
    expect(src).toContain('data-testid="step-errors"');
    expect(src).toContain('role="alert"');
  });
});

describe('saving a student profile never empties the subject list (site-wide B6)', () => {
  it('adds first, then removes only what was taken off', () => {
    expect(diffSubjects(['a', 'b'], ['b', 'c'])).toEqual({ toAdd: ['c'], toRemove: ['a'] });
    expect(diffSubjects([], ['a'])).toEqual({ toAdd: ['a'], toRemove: [] });
    expect(diffSubjects(['a'], ['a'])).toEqual({ toAdd: [], toRemove: [] });
    const src = read('src/pages/Account.tsx');
    expect(src.indexOf('.insert(toAdd.map')).toBeLessThan(src.indexOf(".in('subject_id', toRemove)"));
    expect(src).not.toContain("await supabase.from('student_subjects').delete().eq('student_id', user.id);");
  });
});

describe('small things (site-wide B8, B10, B11, B12, B13, A8)', () => {
  it('each is in place', () => {
    expect(read('src/components/auth/AuthHero.tsx')).toContain('rgba(31,31,31,.82)');
    expect(read('src/components/TeacherComments.tsx')).toContain('min-h-11 px-1 py-0');
    expect(read('src/pages/TeacherProfile.tsx')).toContain("'Teacher not found | Shikshaq'");
    expect(read('src/pages/Contact.tsx')).toContain('data-testid="contact-how"');
    expect(read('src/pages/TeacherDashboard.tsx')).toContain("toast('That page is for teachers.');");
    expect(read('src/pages/TeacherTermsAgreement.tsx')).toContain('data-testid="terms-sign-out"');
  });
});
