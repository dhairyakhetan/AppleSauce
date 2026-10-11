import { describe, expect, it } from 'vitest';

import { isChromelessPath, isFooterlessPath } from './chromeless-routes';

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
