import { beforeEach, describe, expect, it } from 'vitest';
import { claimFirstVisitPopup, resetFirstVisitPopup } from './first-visit-popup';

describe('first-visit pop-up slot', () => {
  beforeEach(() => resetFirstVisitPopup());

  it('gives the slot to the first asker only', () => {
    expect(claimFirstVisitPopup()).toBe(true);
    expect(claimFirstVisitPopup()).toBe(false);
    expect(claimFirstVisitPopup()).toBe(false);
  });

  it('is open again in a fresh visit', () => {
    claimFirstVisitPopup();
    resetFirstVisitPopup();
    expect(claimFirstVisitPopup()).toBe(true);
  });
});
