import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: vi.fn(), from: vi.fn(), storage: { from: vi.fn() }, auth: { getSession: vi.fn(), onAuthStateChange: vi.fn() } },
}));

import { stepFromParam } from '@/components/hod/PublishFlow';
import { HeaderEditor, saveAllLabel } from '@/components/hod/HeaderEditor';
import { CheckChips } from '@/components/hod/RouteTrail';
import { CHECKS, PUBLISH_FIELDS } from '@/lib/hod-publish';

/* The go-live screen fixes from the owner's audit of 26 Nov 2026. Node has no DOM, so the screen is checked with
   rendered markup and with its source text. */

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const flow = read('./PublishFlow.tsx');

describe('the step lives in the address', () => {
  it('reads ?step= and falls back to the paper', () => {
    expect(stepFromParam('checks')).toBe('checks');
    expect(stepFromParam('publish')).toBe('publish');
    expect(stepFromParam(null)).toBe('paper');
    expect(stepFromParam('nonsense')).toBe('paper');
  });
  it('writes the step into the address, keeping the paper', () => {
    expect(flow).toContain("next.set('step', s)");
    expect(flow).toContain('new URLSearchParams(prev)');
  });
});

describe('unsaved work is never thrown away silently', () => {
  it('asks before a step change, Back to the list, and a reload', () => {
    expect(flow).toContain('title: UNSAVED_TITLE');
    expect(flow).toContain("addEventListener('beforeunload'");
    expect(flow).toContain('<UnsavedContext.Provider value={registry}>');
    // Back to the list goes through the same question.
    expect(flow).toContain('onClick={(ev) => void leave(ev, deskLink(\'ready\'))}');
    // Every step button, Back and Next go through go(), which asks first.
    expect(flow).not.toMatch(/onClick=\{\(\) => setStep\(/);
  });
});

describe('moving around', () => {
  it('keeps the step bar on screen and starts a new step at the top', () => {
    // Below the site's own fixed header, so it is never hidden under it.
    expect(flow).toMatch(/className="sticky top-20 z-30[^"]*"\s+data-testid="step-bar"/);
    expect(flow).toContain("topRef.current?.scrollIntoView?.({ block: 'start' })");
  });
  it('hides the next-step button on the last step instead of fading it', () => {
    expect(flow).toContain('stepIndex < STEPS.length - 1 ?');
    expect(flow).not.toContain('disabled={stepIndex === STEPS.length - 1}');
  });
  it('"Show me" walks through the marked questions with Next marked', () => {
    expect(flow).toContain("showMarked('junk')");
    expect(flow).toContain("showMarked('pictures')");
    expect(flow).toContain('Next marked');
    expect(flow).toContain('currentId={currentId}');
  });
  it('every red check chip and the "checks to fix" pill lead to the fix', () => {
    expect(flow).toContain('<CheckChips checks={data.checks} onPick={goToFix} />');
    expect(flow).toContain("onClick={() => void go('checks')}");
  });
});

describe('the words', () => {
  it('says what back-office problems mean for the HOD', () => {
    expect(flow).not.toMatch(/database editor|sitemap|queue run/);
    expect(flow).toContain('Pictures cannot be copied to the site yet. Tell the owner.');
  });
  it('has no dashes', () => {
    expect(flow).not.toMatch(/[–—]/);
    expect(read('./PaperSheet.tsx')).not.toMatch(/[–—]/);
    expect(read('./HeaderEditor.tsx')).not.toMatch(/[–—]/);
  });
});

describe('publishing', () => {
  it('clears the left-out tick when the number of questions left out changes', () => {
    const block = flow.slice(flow.indexOf('const leftOutNow'), flow.indexOf('}, [leftOutNow]);'));
    expect(block).toContain('setConfirmedLeftOut(false)');
  });
  it('offers the next paper ready to go live after publishing', () => {
    expect(flow).toContain('Next paper ready to go live');
    expect(flow).toContain('nextReadyPaper(next.data, paperId)');
  });
  it('the Details step has one General instructions editor and no inner scroll box on phones', () => {
    const details = flow.slice(flow.indexOf("step === 'details'"), flow.indexOf("step === 'publish'"));
    expect(details).toContain('editInstructions={false}');
    expect(details).toContain('mode="all"');
    expect(details).toContain('lg:max-h-[70vh] lg:overflow-y-auto');
    expect(details).not.toMatch(/"max-h-\[70vh\] overflow-y-auto/);
    expect(details).toContain('Show the photo');
  });
});

describe('HeaderEditor, the Details boxes', () => {
  const values = Object.fromEntries(PUBLISH_FIELDS.map((f) => [f.key, '']));
  it('one "Save all changes" button instead of one per box, and plain tick boxes for "prints no time"', () => {
    const html = renderToStaticMarkup(<HeaderEditor mode="all" fields={PUBLISH_FIELDS} values={values} save={async () => undefined} onSaved={() => undefined} />);
    expect(html.match(/type="submit"/g)).toHaveLength(1);
    expect(html).toContain('Save all changes');
    expect(html).toContain('This paper prints no time');
    expect(html.match(/data-testid="header-tick"/g)).toHaveLength(2);
    expect(html).not.toContain('<option value="true">Yes</option><option value="false">No</option></select></div><button');
  });
  it('Live papers keeps a Save per box', () => {
    const html = renderToStaticMarkup(
      <HeaderEditor fields={PUBLISH_FIELDS.filter((f) => f.kind !== 'tick')} values={values} save={async () => undefined} onSaved={() => undefined} />,
    );
    expect((html.match(/type="submit"/g) ?? []).length).toBeGreaterThan(5);
  });
  it('counts the changes on the button', () => {
    expect(saveAllLabel(0)).toBe('Save all changes');
    expect(saveAllLabel(1)).toBe('Save 1 change');
    expect(saveAllLabel(3)).toBe('Save 3 changes');
  });
});

describe('check chips', () => {
  const checks = CHECKS.map((c, i) => ({ key: c.key, label: c.label, ok: i !== 1, detail: '' }));
  it('a red chip is a button only where the screen asks for it', () => {
    const tappable = renderToStaticMarkup(<CheckChips checks={checks} onPick={() => undefined} />);
    expect(tappable.match(/<button/g)).toHaveLength(1);
    expect(tappable).toContain('Show me how to fix it');
    const plain = renderToStaticMarkup(<CheckChips checks={checks} />);
    expect(plain).not.toContain('<button');
  });
});
