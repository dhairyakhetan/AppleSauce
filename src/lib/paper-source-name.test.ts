import { describe, expect, it } from 'vitest';

import { paperSourceName } from './school-display';

describe('paperSourceName', () => {
  it('returns the school label for a school paper', () => {
    expect(paperSourceName('Calcutta Boys’ School')).toBe("Calcutta Boys' School");
  });

  it('keeps a board paper\'s source line as stored', () => {
    expect(paperSourceName('ICSE board paper')).toBe('ICSE board paper');
  });

  it('returns null when the school is not recorded, so callers drop the line', () => {
    expect(paperSourceName('School not recorded')).toBeNull();
    expect(paperSourceName('Unnamed school')).toBeNull();
    expect(paperSourceName('History')).toBeNull();
    expect(paperSourceName(null)).toBeNull();
    expect(paperSourceName('   ')).toBeNull();
  });
});
