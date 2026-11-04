import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: vi.fn(), from: vi.fn(), storage: { from: vi.fn() }, auth: { getSession: vi.fn(), onAuthStateChange: vi.fn(), signOut: vi.fn() } },
}));

import { supabase } from '@/integrations/supabase/client';
import { realHodApi } from '@/lib/hod-api';
import { createFakeHodApi } from '@/dummy/hod-fake-api';
import { GL } from '@/dummy/hod-golive-fake';
import { CheckChips, RouteTrail } from '@/components/hod/RouteTrail';
import { allChecksPass, canPublishNow } from '@/lib/hod-publish';

/* The dummy desk is what the owner clicks through, so it has to obey the same
   rules as the server: these tests are the rules in the server's words. */

describe('dummy desk: Needs you', () => {
  it('lists papers with open questions and counts them as the badge does', async () => {
    const api = createFakeHodApi();
    const papers = await api.needsYouPapers();
    const counts = await api.deskCounts();
    expect(papers.length).toBeGreaterThanOrEqual(3);
    expect(counts.needs_you_questions).toBe(papers.reduce((n, p) => n + p.escalated + p.admin_bucket, 0));
    expect(counts.ready).toBe(2);
    expect(counts.ready_ok).toBe(1);
  });

  it('pass, set aside (needs a note) and undo with reopen', async () => {
    const api = createFakeHodApi();
    const [q1, q2] = await api.needsYouQuestions(GL.maths);
    await expect(api.setQuestionState(q1.id, 'set_aside', '')).rejects.toThrow('Say why the question is set aside');
    expect(await api.setQuestionState(q1.id, 'pass')).toBe('passed');
    expect(await api.setQuestionState(q2.id, 'set_aside', 'torn page')).toBe('set_aside');
    expect((await api.needsYouQuestions(GL.maths)).length).toBe(0);
    expect(await api.setQuestionState(q1.id, 'reopen')).toBe('open');
    expect((await api.needsYouQuestions(GL.maths)).map((q) => q.id)).toEqual([q1.id]);
  });

  it('a fix is versioned: a stale version is refused, a good one returns the next', async () => {
    const api = createFakeHodApi();
    const [q] = await api.needsYouQuestions(GL.maths);
    await expect(api.editQuestion(q.id, q.version + 5, { body: 'x' })).rejects.toMatchObject({ code: '40001' });
    expect(await api.editQuestion(q.id, q.version, { body: ' exactly  as typed ' })).toBe(q.version + 1);
    expect((await api.needsYouQuestions(GL.maths))[0].body).toBe(' exactly  as typed ');
  });

  it('send back works for a student question, not for the other pile', async () => {
    const api = createFakeHodApi();
    const qs = await api.needsYouQuestions(GL.maths);
    const sent = qs.find((q) => q.review_bucket === 'escalated')!;
    const other = qs.find((q) => q.review_bucket === 'admin')!;
    await expect(api.sendBack(other.id, '')).rejects.toThrow();
    await api.sendBack(sent.id, 'look again');
    expect((await api.needsYouQuestions(GL.maths)).map((q) => q.id)).not.toContain(sent.id);
  });
});

describe('dummy desk: Ready to go live', () => {
  it('shows one paper that passes all four checks and one that does not', async () => {
    const api = createFakeHodApi();
    const ready = await api.readyPapers();
    const green = ready.find((p) => p.audit_paper_id === GL.chem)!;
    const red = ready.find((p) => p.audit_paper_id === GL.econ2)!;
    expect(green.all_ok).toBe(true);
    expect(red.all_ok).toBe(false);
    expect(red.checks.filter((c) => !c.ok).map((c) => c.key)).toEqual(['pictures_present', 'header_complete', 'scanner_junk_gone']);
  });

  it('the preview carries header, questions, counts and checks', async () => {
    const api = createFakeHodApi();
    const p = await api.paperPreview(GL.econ2);
    expect(p.paper.header.school).toBe('Riverside Academy');
    expect(p.counts).toMatchObject({ total: 4, passed: 3, set_aside: 1 });
    expect(p.checks).toHaveLength(4);
    expect(p.questions.find((q) => q.scanner_junk)).toBeTruthy();
  });

  it('refuses to publish a red paper, in the server words, and changes nothing', async () => {
    const api = createFakeHodApi();
    await expect(api.approvePaper(GL.econ2, '', true)).rejects.toThrow(/This paper cannot go live yet\./);
    expect((await api.readyPapers()).length).toBe(2);
  });

  it('header fields save one at a time and turn the check green', async () => {
    const api = createFakeHodApi();
    await expect(api.updatePublishMeta(GL.econ2, 'cls', '')).rejects.toThrow('This cannot be left blank.');
    await expect(api.updatePublishMeta(GL.econ2, 'marks', '5000')).rejects.toThrow();
    await api.updatePublishMeta(GL.econ2, 'year', '2023');
    await api.updatePublishMeta(GL.econ2, 'allowed_time_minutes', '120');
    await api.updatePublishMeta(GL.econ2, 'general_instructions', 'Answer all questions.');
    const p = await api.paperPreview(GL.econ2);
    expect(p.checks.find((c) => c.key === 'header_complete')?.ok).toBe(true);
    expect(p.paper.header.year).toBe('2023');
  });

  it('a junk fix clears the junk check, and a put-back question is open again', async () => {
    const api = createFakeHodApi();
    const p = await api.paperPreview(GL.econ2);
    const junk = p.questions.find((q) => q.scanner_junk)!;
    await api.editQuestion(junk.id, junk.version, { body: 'Distinguish between a market and a mall.' });
    const aside = p.questions.find((q) => q.state === 'set_aside')!;
    await api.setQuestionState(aside.id, 'reopen');
    const after = await api.paperPreview(GL.econ2);
    expect(after.checks.find((c) => c.key === 'scanner_junk_gone')?.ok).toBe(true);
    expect(after.counts.open).toBe(1);
    expect(after.checks.find((c) => c.key === 'questions_checked')?.ok).toBe(false);
  });

  it('publishes a green paper: it leaves Ready, shows in Live papers and gives a live id', async () => {
    const api = createFakeHodApi();
    const out = await api.approvePaper(GL.chem, 'looks right');
    expect(out.live_bank_paper_id).toBeTruthy();
    expect((await api.readyPapers()).map((p) => p.audit_paper_id)).not.toContain(GL.chem);
    const live = await api.livePapers();
    expect(live[0].paper_id).toBe(out.live_bank_paper_id);
    await expect(api.approvePaper(GL.chem)).rejects.toThrow('This paper is not waiting to go live.');
  });

  it('left-out questions need the confirmation, as the server will', async () => {
    const api = createFakeHodApi();
    // Make econ2 green except for the one left-out question.
    const p = await api.paperPreview(GL.econ2);
    const junk = p.questions.find((q) => q.scanner_junk)!;
    await api.editQuestion(junk.id, junk.version, { body: 'Distinguish between a market and a mall.' });
    const pic = p.questions.find((q) => q.has_picture)!;
    await api.setQuestionState(pic.id, 'set_aside', 'picture missing');
    await api.updatePublishMeta(GL.econ2, 'year', '2023');
    await api.updatePublishMeta(GL.econ2, 'allowed_time_minutes', '120');
    await api.updatePublishMeta(GL.econ2, 'general_instructions', 'Answer all.');
    const after = await api.paperPreview(GL.econ2);
    expect(allChecksPass(after.checks)).toBe(true);
    expect(after.counts.set_aside).toBe(2);
    expect(canPublishNow(after.checks, after.counts.set_aside, false, true)).toBe(false);
    await expect(api.approvePaper(GL.econ2)).rejects.toThrow(/2 questions are left out/);
    expect((await api.approvePaper(GL.econ2, '', true)).question_count).toBe(2);
  });
});

describe('dummy desk: Live papers, uploads, trust, why', () => {
  it('hide needs a reason and restore needs it hidden', async () => {
    const api = createFakeHodApi();
    await expect(api.hidePaper('live-1', ' ')).rejects.toThrow('Say why the paper is being hidden.');
    await api.hidePaper('live-1', 'wrong pictures');
    await expect(api.hidePaper('live-1', 'again')).rejects.toThrow();
    let counts = await api.deskCounts();
    expect(counts.hidden).toBe(3);
    await api.restorePaper('live-1');
    await expect(api.restorePaper('live-1')).rejects.toThrow();
    counts = await api.deskCounts();
    expect(counts.hidden).toBe(2);
  });

  it('edits a live detail and refuses a blank class', async () => {
    const api = createFakeHodApi();
    await api.editLivePaper('live-2', 'exam', 'Final');
    expect((await api.livePapers()).find((p) => p.paper_id === 'live-2')?.exam).toBe('Final');
    await expect(api.editLivePaper('live-2', 'cls', '')).rejects.toThrow('This cannot be left blank.');
    await expect(api.editLivePaper('live-2', 'is_published', 'false')).rejects.toThrow(/not editable/);
  });

  it('uploads: reject needs a note, a decision is final, and the pending badge falls', async () => {
    const api = createFakeHodApi();
    const pending = await api.studentUploads('pending');
    expect(pending).toHaveLength(2);
    await expect(api.reviewUpload(pending[0].id, 'rejected', '')).rejects.toThrow('Say why it is rejected.');
    await api.reviewUpload(pending[0].id, 'rejected', 'Too dark');
    await api.reviewUpload(pending[1].id, 'approved');
    await expect(api.reviewUpload(pending[1].id, 'approved')).rejects.toThrow(/already been/);
    expect((await api.deskCounts()).student_uploads_pending).toBe(0);
    expect((await api.studentUploads('all')).length).toBe(4);
  });

  it('the trail follows the paper: Ready papers are Ready, published ones Live', async () => {
    const api = createFakeHodApi();
    let trail = await api.paperTrail();
    expect(trail.find((t) => t.audit_paper_id === GL.chem)?.stage).toBe('ready');
    expect(trail.find((t) => t.audit_paper_id === GL.maths)?.stage).toBe('needs_you');
    expect(trail.find((t) => t.audit_paper_id === GL.history)?.stage).toBe('checking');
    await api.approvePaper(GL.chem);
    trail = await api.paperTrail();
    expect(trail.find((t) => t.audit_paper_id === GL.chem)?.stage).toBe('live');
  });

  it('gives the overall trust counter and a plain reason list for an assignment', async () => {
    const api = createFakeHodApi();
    const o = await api.aiTrustOverall();
    expect(o.threshold).toBe(100);
    expect(o.reached).toBe(false);
    const why = await api.explainAssignment('c1000000-0000-4000-8000-000000000001', GL.history);
    expect(why.reasons.length).toBeGreaterThan(2);
    expect(why.summary).not.toMatch(/[–—]/);
  });

  it('start over restores the first state', async () => {
    const api = createFakeHodApi();
    await api.approvePaper(GL.chem);
    api.reset();
    expect((await api.readyPapers()).length).toBe(2);
  });
});

describe('route trail and check chips markup', () => {
  it('highlights the current stop, ticks earlier ones and says it in words', () => {
    const html = renderToStaticMarkup(<RouteTrail stage="needs_you" />);
    expect(html).toContain('aria-current="step"');
    expect(html.match(/data-state="done"/g)).toHaveLength(2);
    expect(html.match(/data-state="later"/g)).toHaveLength(2);
    expect(html).toContain('Where it is: step 3 of 5, Needs you.');
    for (const w of ['Read', 'Checking by students', 'Needs you', 'Ready', 'Live']) expect(html).toContain(w);
  });

  it('draws each check with a word as well as a colour', () => {
    const html = renderToStaticMarkup(
      <CheckChips
        checks={[
          { key: 'questions_checked', label: 'a', ok: true, detail: '' },
          { key: 'pictures_present', label: 'b', ok: false, detail: '' },
          { key: 'header_complete', label: 'c', ok: true, detail: '' },
          { key: 'scanner_junk_gone', label: 'd', ok: false, detail: '' },
        ]}
      />,
    );
    expect(html).toContain('Every question checked');
    expect(html).toContain('Pictures present');
    expect(html).toContain('Header complete');
    expect(html).toContain('Scanner junk gone');
    expect(html.match(/: passes/g)).toHaveLength(2);
    expect(html.match(/: needs fixing/g)).toHaveLength(2);
  });
});

describe('the real call sends the left-out confirmation only when it is ticked', () => {
  it('omits p_confirm_left_out otherwise, so a server that does not know it still answers', async () => {
    const rpc = vi.mocked(supabase.rpc);
    rpc.mockResolvedValue({ data: { live_bank_paper_id: 'x', question_count: 3 }, error: null } as never);
    await realHodApi.approvePaper('p1', 'ok');
    expect(rpc).toHaveBeenLastCalledWith('hod_approve_paper', { p_audit_paper_id: 'p1', p_note: 'ok' });
    await realHodApi.approvePaper('p1', '', true);
    expect(rpc).toHaveBeenLastCalledWith('hod_approve_paper', { p_audit_paper_id: 'p1', p_note: null, p_confirm_left_out: true });
  });
});
