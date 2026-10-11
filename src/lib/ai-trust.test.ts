import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  barLabel,
  barPosition,
  buildTrustGrid,
  checksNeeded,
  DECISION_HINT,
  DECISION_LABEL,
  formatRate,
  meterStatus,
  normaliseTrustRows,
  switchState,
  trustConfirm,
  TRUST_EXPLAINER,
  trustExplainer,
  trustStatus,
} from '@/lib/ai-trust';

const base = { min_rate: 0.97, min_checked: 100, spot_check_every: 20 };

describe('AI trust formatting', () => {
  it('formats a rate as a percentage with at most one decimal', () => {
    expect(formatRate(0.9776)).toBe('97.8%');
    expect(formatRate(1)).toBe('100%');
    expect(formatRate(0.97)).toBe('97%');
    expect(formatRate(0)).toBe('0%');
    expect(formatRate(null)).toBe('No checks yet');
  });

  it('says the check count one way, below the minimum or above it', () => {
    expect(checksNeeded({ checked: 60, min_checked: 100 })).toBe('60 of 100 checks');
    expect(checksNeeded({ checked: 250, min_checked: 100 })).toBe('250 of 100 checks');
    expect(checksNeeded({ checked: 0, min_checked: 100 })).toBe('0 of 100 checks');
  });

  it('labels the tick and says in text whether the rate is above the bar', () => {
    expect(barLabel({ min_rate: 0.97 })).toBe('bar 97%');
    expect(barLabel({ min_rate: 0.95 })).toBe('bar 95%');
    expect(meterStatus({ rate: 0.98, min_rate: 0.97 })).toBe('Above the bar');
    expect(meterStatus({ rate: 0.97, min_rate: 0.97 })).toBe('Above the bar');
    expect(meterStatus({ rate: 0.91, min_rate: 0.97 })).toBe('Below the bar');
    expect(meterStatus({ rate: null, min_rate: 0.97 })).toBe('No checks yet');
  });

  it('places the fill and the bar on a 0 to 100 track', () => {
    expect(barPosition({ rate: 0.91, min_rate: 0.97 })).toEqual({ fill: 91, bar: 97 });
    expect(barPosition({ rate: null, min_rate: 0.97 })).toEqual({ fill: 0, bar: 97 });
  });

  it('words the status chip for all three states', () => {
    expect(trustStatus({ trusted: false, auto_off_at: null, auto_off_reason: null, spot_check_every: 20 })).toEqual({
      kind: 'people',
      label: 'Checked by people',
    });
    expect(trustStatus({ trusted: true, auto_off_at: null, auto_off_reason: null, spot_check_every: 20 })).toEqual({
      kind: 'trusted',
      label: 'Trusted, 1 in 20 still checked',
    });
    expect(trustStatus({ trusted: false, auto_off_at: '2026-10-07T00:00:00Z', auto_off_reason: 'it fell to 91%', spot_check_every: 20 })).toEqual({
      kind: 'auto_off',
      label: 'Switched off automatically: it fell to 91%',
    });
  });

  it('the admin button is disabled with the reason until the level is eligible', () => {
    const notYet = switchState({ trusted: false, eligible: false, checked: 60, rate: 0.93, ...base });
    expect(notYet.disabled).toBe(true);
    expect(notYet.action).toBe('trust');
    expect(notYet.reason).toBe('Not earned yet: needs 100 checks at 97% agreed. It has 60 checks at 93% agreed.');
    expect(switchState({ trusted: false, eligible: true, checked: 300, rate: 0.98, ...base })).toMatchObject({ action: 'trust', disabled: false, reason: null });
    expect(switchState({ trusted: true, eligible: false, checked: 300, rate: 0.9, ...base })).toMatchObject({ action: 'stop', disabled: false });
  });

  it('a level the system switched off says so, and what trusting it again takes, not "not earned yet"', () => {
    const off = switchState({ trusted: false, eligible: false, checked: 40, rate: 0.9, auto_off_at: '2026-10-07T00:00:00Z', ...base });
    expect(off.disabled).toBe(true);
    expect(off.reason).toBe(
      'Switched off after it fell below the bar. Trusting again needs 100 checks at 97% agreed. It has 40 checks at 90% agreed.',
    );
    expect(off.reason).not.toContain('Not earned yet');
    const offNone = switchState({ trusted: false, eligible: false, checked: 0, rate: null, auto_off_at: '2026-10-07T00:00:00Z', ...base });
    expect(offNone.reason).toBe('Switched off after it fell below the bar. Trusting again needs 100 checks at 97% agreed. No checks yet.');
    // a row that was never trusted keeps "Not earned yet"
    const never = switchState({ trusted: false, eligible: false, checked: 40, rate: 0.9, auto_off_at: null, ...base });
    expect(never.reason?.startsWith('Not earned yet:')).toBe(true);
    // earned again: the button is back, with no reason
    expect(switchState({ trusted: false, eligible: true, checked: 300, rate: 0.98, auto_off_at: '2026-10-07T00:00:00Z', ...base })).toMatchObject({
      disabled: false,
      reason: null,
    });
  });

  it('asks before trusting a level, and states what that does', () => {
    const c = trustConfirm({ level: 'high', decision: 'pass', spot_check_every: 20 });
    expect(c.title).toBe('Trust "High confidence, AI said it was right"?');
    expect(c.description).toContain('only 1 in 20 of these AI answers goes to people');
    expect(c.description).toContain('probably has an issue');
    expect(c.confirmLabel).toBe('Trust this level');
    expect(trustConfirm({ level: 'low', decision: 'fix', spot_check_every: 10 }).description).toContain('1 in 10');
    expect(`${c.title}${c.description}`).not.toMatch(/[–—]/);
  });

  it('with no checks at all the reason does not say "0 checks at No checks yet"', () => {
    const none = switchState({ trusted: false, eligible: false, checked: 0, rate: null, ...base });
    expect(none.reason).toBe('Not earned yet: needs 100 checks at 97% agreed. No checks yet.');
    expect(none.reason).not.toMatch(/\b0 checks at/);
  });

  it('builds the reason from the row, so a changed bar changes the words', () => {
    const r = switchState({ trusted: false, eligible: false, checked: 0, rate: null, min_rate: 0.95, min_checked: 150 });
    expect(r.reason).toBe('Not earned yet: needs 150 checks at 95% agreed. No checks yet.');
  });

  it('explains the rule in plain words with no dashes', () => {
    expect(TRUST_EXPLAINER).toContain('97%');
    expect(TRUST_EXPLAINER).toContain('at least 100 checks');
    expect(TRUST_EXPLAINER).not.toContain('200');
    expect(TRUST_EXPLAINER).toContain('probably has an issue');
    // the bar rule is stated once, here, and the tick is explained here
    expect(TRUST_EXPLAINER).toContain('the black mark on the bar is the 97% line');
    expect(TRUST_EXPLAINER).not.toMatch(/[–—]/);
  });

  it('the explainer follows the bar it is given', () => {
    expect(trustExplainer(250, 0.98, 10)).toContain('98% over at least 250 checks');
    expect(trustExplainer(250, 0.98, 10)).toContain('1 in 10');
  });

  it('says what each kind of AI decision means, in plain words', () => {
    expect(DECISION_LABEL.pass).toBe('AI said it was right');
    expect(DECISION_LABEL.fix).toBe('AI fixed it');
    expect(DECISION_HINT.pass).toBe('The AI kept the question as read.');
    expect(DECISION_HINT.fix).toBe('The AI corrected the words, number or marks, usually a scanning misread.');
    expect(TRUST_EXPLAINER).toContain('"AI fixed it" means');
    for (const text of [...Object.values(DECISION_LABEL), ...Object.values(DECISION_HINT)]) expect(text).not.toMatch(/[–—]/);
    expect(JSON.stringify(DECISION_LABEL)).not.toContain('changed the words');
  });

  it('falls back to the bar of 100 checks when a row does not carry one', () => {
    const [row] = normaliseTrustRows([{ level: 'high', decision: 'pass', subject: null, checked: 3 }]);
    expect(row.min_checked).toBe(100);
  });
});

describe('AI trust card', () => {
  const src = readFileSync('src/components/hod/AiTrustTab.tsx', 'utf8');

  it('asks before trusting, then saves with the same arguments as before; stopping stays one tap', () => {
    const flip = src.slice(src.indexOf('async function flip()'), src.indexOf('return (\n    <div className="flex flex-col gap-3'));
    expect(flip).toMatch(/if \(sw\.action === 'trust'\)/);
    expect(flip.indexOf('await confirm(')).toBeGreaterThan(-1);
    expect(flip.indexOf('await confirm(')).toBeLessThan(flip.indexOf('api.setAiTrust('));
    expect(flip).toContain("api.setAiTrust(row.level, row.decision, sw.action === 'trust')");
    expect(flip).toContain('if (!ok) return;');
  });

  it('draws the bar once in words, a real chevron, and no per-card "The bar is" line', () => {
    expect(src).not.toContain('The bar is {');
    expect(src).toContain('barLabel(row)');
    expect(src).toContain('meterStatus(row)');
    expect(src).toContain('<ChevronDown');
    expect(src).toContain('motion-reduce:transition-none');
    expect(src).not.toMatch(/>\s*v\s*<\/span>/);
  });
});

describe('AI trust grid', () => {
  const rows = normaliseTrustRows([
    { level: 'high', decision: 'pass', subject: null, checked: 312, as_is: 305, rate: '0.9776', waiting: 5, trusted: false, eligible: true, ...base },
    { level: 'high', decision: 'pass', subject: 'Physics', checked: 30, as_is: 29, rate: 0.9667, waiting: 1, ...base },
    { level: 'high', decision: 'pass', subject: 'Mathematics', checked: 180, as_is: 176, rate: 0.9778, waiting: 4, ...base },
    { level: 'low', decision: 'fix', subject: null, checked: 10, as_is: 4, rate: 0.4, waiting: 0, ...base },
    { level: 'bogus', decision: 'pass', subject: null },
  ]);

  it('drops an unknown level and reads numbers from strings', () => {
    expect(rows).toHaveLength(4);
    expect(rows[0].rate).toBeCloseTo(0.9776);
    expect(rows[0].eligible).toBe(true);
  });

  it('builds 3 levels by 2 decisions, with subjects most checked first', () => {
    const grid = buildTrustGrid(rows);
    expect(grid).toHaveLength(3);
    expect(grid.every((line) => line.length === 2)).toBe(true);
    const highPass = grid[0][0];
    expect(highPass.level).toBe('high');
    expect(highPass.decision).toBe('pass');
    expect(highPass.total?.checked).toBe(312);
    expect(highPass.subjects.map((s) => s.subject)).toEqual(['Mathematics', 'Physics']);
    expect(grid[0][1].total).toBeNull();
    expect(grid[2][1].total?.checked).toBe(10);
  });
});
