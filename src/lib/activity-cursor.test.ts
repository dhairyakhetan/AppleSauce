import { describe, expect, it, vi } from 'vitest';

// The client only needs to exist for this import.
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: vi.fn() } }));

import { olderCursor } from '@/lib/activity-api';

describe('the "Show older" cursor includes rows that share the last row\'s instant', () => {
  it('moves one microsecond past the last row', () => {
    expect(olderCursor('2026-10-11T10:00:00.123456+00:00')).toBe('2026-10-11T10:00:00.123457Z');
    expect(olderCursor('2026-10-11T10:00:00.123Z')).toBe('2026-10-11T10:00:00.123001Z');
    expect(olderCursor('2026-10-11T10:00:00Z')).toBe('2026-10-11T10:00:00.000001Z');
  });

  it('carries into the next second', () => {
    expect(olderCursor('2026-10-11T10:00:59.999999+00:00')).toBe('2026-10-11T10:01:00.000000Z');
    expect(olderCursor('2026-12-31T23:59:59.999999Z')).toBe('2027-01-01T00:00:00.000000Z');
  });

  it('understands an offset and writes the same instant in UTC', () => {
    expect(olderCursor('2026-10-11T15:30:00.5+05:30')).toBe('2026-10-11T10:00:00.500001Z');
  });

  it('leaves anything that is not a timestamp alone', () => {
    expect(olderCursor('not a time')).toBe('not a time');
    expect(olderCursor('')).toBe('');
  });

  it('is later than the row it came from, so the server\'s strict "before" keeps that row\'s neighbours', () => {
    const at = '2026-10-11T10:00:00.123456+00:00';
    expect(olderCursor(at) > '2026-10-11T10:00:00.123456Z').toBe(true);
  });
});
