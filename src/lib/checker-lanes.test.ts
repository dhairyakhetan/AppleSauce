import { existsSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  FLAG_LANES,
  LANES,
  LANE_OWNERS,
  PREFIX_LANES,
  askedOfStudent,
  describeLanes,
  laneForCode,
  unmappedCodes,
} from './checker-lanes';

/* The committed copy of the pipeline's lanes.json. checker-lanes.ts carries the
   same tables as code; these tests fail if either drifts or a flag has no lane. */
const copy = JSON.parse(readFileSync('src/content/checker-lanes.json', 'utf8')) as {
  owners: Record<string, string>;
  lanes: Record<string, { name: string; owner: string; what_to_do: string }>;
  flags: Record<string, { lane: string }>;
  prefixes: Record<string, { lane: string }>;
};

const PIPELINE = 'C:/Users/kanis/Desktop/Shikshaq Papers/pipeline/auditor/pipeline/lanes.json';

describe('checker lanes', () => {
  it('maps every flag in lanes.json to a lane that exists', () => {
    for (const [code, v] of Object.entries(copy.flags)) {
      expect(FLAG_LANES[code], code).toBe(v.lane);
      expect(laneForCode(code), code).not.toBeNull();
      expect(laneForCode(code)!.id, code).toBe(v.lane);
    }
    expect(Object.keys(FLAG_LANES).sort()).toEqual(Object.keys(copy.flags).sort());
  });

  it('carries the same lanes, owners and prefixes as lanes.json', () => {
    expect(Object.keys(LANES).sort()).toEqual(Object.keys(copy.lanes).sort());
    for (const [id, lane] of Object.entries(copy.lanes)) {
      expect(LANES[id].name).toBe(lane.name);
      expect(LANES[id].owner).toBe(lane.owner);
      expect(LANES[id].what_to_do).toBe(lane.what_to_do);
    }
    expect(LANE_OWNERS).toEqual(copy.owners);
    expect(PREFIX_LANES).toEqual(Object.fromEntries(Object.entries(copy.prefixes).map(([k, v]) => [k, v.lane])));
  });

  it('matches the pipeline file when it is on this machine', () => {
    if (!existsSync(PIPELINE)) return; // CI has no pipeline folder
    const live = JSON.parse(readFileSync(PIPELINE, 'utf8'));
    expect(live.lanes).toEqual(copy.lanes);
    expect(live.flags).toEqual(copy.flags);
    expect(live.prefixes).toEqual(copy.prefixes);
    expect(live.owners).toEqual(copy.owners);
  });

  it('resolves split_from_ and gate_ prefixes', () => {
    expect(laneForCode('split_from_3f0c9a52-0000-4000-8000-000000000000')!.id).toBe('joined_or_split');
    expect(laneForCode('gate_source')!.id).toBe('english_release');
  });

  it('reports a code with no lane instead of hiding it', () => {
    expect(laneForCode('brand_new_code')).toBeNull();
    expect(unmappedCodes(['ocr_fused', 'brand_new_code', 'brand_new_code', ''])).toEqual(['brand_new_code']);
    const s = describeLanes(['brand_new_code'], null);
    expect(s.blocks).toEqual([]);
    expect(s.unmapped).toEqual([{ code: 'brand_new_code', sentence: 'Brand new code' }]);
  });

  it('puts what a student settles first, and groups codes of one lane', () => {
    const s = describeLanes(['chapter_unresolved', 'marks_mismatch', 'missing_marks'], null);
    expect(s.blocks.map((b) => b.lane.id)).toEqual(['marks', 'label']);
    expect(s.blocks[0].codes).toEqual(['marks_mismatch', 'missing_marks']);
    expect(s.blocks[0].asked).toBe(true);
    expect(s.blocks[1].asked).toBe(false);
    expect(askedOfStudent(LANES.find_on_page ?? LANES.duplicate)).toBe(false);
  });

  it('never shows machine evidence or a pasted transcription as "what the computer noticed"', () => {
    const detail = JSON.stringify({
      other: 'AI check: guardrail G1, G2 | suggestion: {"body": "Question 6. Name the bank."}',
      marks_mismatch: 'The marks add up to 100, the paper says 80.',
    });
    const s = describeLanes(['other', 'marks_mismatch'], detail);
    const shown = s.blocks.map((b) => b.detail ?? '').join(' ');
    expect(shown).not.toMatch(/suggestion|guardrail|body/i);
    expect(s.blocks.find((b) => b.lane.id === 'marks')!.detail).toBe('The marks add up to 100, the paper says 80.');
  });

  it('uses no em or en dash in lane wording', () => {
    for (const lane of Object.values(LANES)) {
      expect(lane.name + lane.what_to_do).not.toMatch(/[–—]/);
    }
  });
});
