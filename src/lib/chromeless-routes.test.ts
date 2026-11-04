import { describe, expect, it } from 'vitest';

import { isChromelessLocation, isChromelessPath, isFooterlessPath, isVerifyScreen } from './chromeless-routes';

describe('isFooterlessPath', () => {
  it('drops the footer and pre-footer on the paper checker only', () => {
    expect(isFooterlessPath('/checker')).toBe(true);
    expect(isFooterlessPath('/checker/')).toBe(true);
    expect(isFooterlessPath('/')).toBe(false);
    expect(isFooterlessPath('/past-papers')).toBe(false);
    expect(isFooterlessPath('/checkers')).toBe(false);
  });

  it('drops the footer on the work screens for the HOD and the teacher reviewers too', () => {
    expect(isFooterlessPath('/hod')).toBe(true);
    expect(isFooterlessPath('/teacher-review')).toBe(true);
    expect(isFooterlessPath('/teacher-review/')).toBe(true);
    expect(isFooterlessPath('/teacher-reviews')).toBe(false);
  });

  it('keeps the checker out of the chromeless list, so its top nav stays', () => {
    expect(isChromelessPath('/checker')).toBe(false);
  });
});

describe('the verify screen shows no site header', () => {
  it('is the checker with a paper and verify=1, and nothing else', () => {
    expect(isVerifyScreen('/checker', '?paper=abc&verify=1')).toBe(true);
    expect(isVerifyScreen('/checker/', '?paper=abc&verify=1&dummy=1')).toBe(true);
    expect(isVerifyScreen('/checker', '?paper=abc')).toBe(false);
    expect(isVerifyScreen('/checker', '?verify=1')).toBe(false);
    expect(isVerifyScreen('/checker', '')).toBe(false);
    expect(isVerifyScreen('/checker/practice', '?paper=abc&verify=1')).toBe(false);
    expect(isVerifyScreen('/hod', '?paper=abc&verify=1')).toBe(false);
  });

  it('is chromeless there, while the other checker pages keep the normal header', () => {
    expect(isChromelessLocation('/checker', '?paper=abc&verify=1')).toBe(true);
    expect(isChromelessLocation('/checker', '')).toBe(false);
    expect(isChromelessLocation('/checker', '?paper=abc')).toBe(false);
    expect(isChromelessLocation('/checker/practice', '')).toBe(false);
    expect(isChromelessLocation('/checker/help', '')).toBe(false);
    // The older answer still holds for every other route.
    expect(isChromelessLocation('/auth', '')).toBe(true);
    expect(isChromelessLocation('/', '')).toBe(false);
  });
});
