import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __resetMirrorForTests, mirrorSignal } from './analytics-mirror';

/**
 * Analytics code fails silently by design -- every call is wrapped so it can
 * never break the contact flow. That safety is exactly what makes it worth
 * testing: a mirror that quietly sends nothing looks identical, from inside
 * the app, to one that works. The only way anyone would notice is an empty
 * GA4 report weeks later, which is the same position we were in before.
 */

type GtagCall = [string, string, Record<string, string>?];

let gtag: ReturnType<typeof vi.fn>;
let clarity: ReturnType<typeof vi.fn>;
let dataLayer: unknown[];

function installWindow(overrides: Record<string, unknown> = {}) {
  gtag = vi.fn();
  clarity = vi.fn();
  dataLayer = [];
  (globalThis as Record<string, unknown>).window = {
    gtag,
    clarity,
    dataLayer,
    ...overrides,
  };
}

/** The gtag calls, as [_, eventName, params]. */
function events(): GtagCall[] {
  return gtag.mock.calls as GtagCall[];
}

beforeEach(() => {
  installWindow();
  __resetMirrorForTests();
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).window;
});

describe('which signals are forwarded', () => {
  it('forwards the contact funnel', () => {
    mirrorSignal('teacher_viewed', { id: 'a-teacher' });
    mirrorSignal('contact_started', { id: 'a-teacher' });
    mirrorSignal('contact_completed', { id: 'a-teacher' });

    expect(events().map((c) => c[1])).toEqual([
      'teacher_viewed',
      'contact_started',
      'contact_completed',
    ]);
  });

  it('forwards discovery signals', () => {
    mirrorSignal('search_submitted', { subject: 'Maths' });
    mirrorSignal('filters_applied', { area: 'Salt Lake' });
    mirrorSignal('builder_submitted', { subject: 'Physics' });
    expect(events()).toHaveLength(3);
  });

  it('drops the high-volume weak signals', () => {
    /* section_dwell fires on scroll. Forwarding it would bury the four
       events anyone actually wants. */
    mirrorSignal('route_viewed', { path: '/about' });
    mirrorSignal('section_dwell', { path: '/about' });
    expect(events()).toHaveLength(0);
  });

  it('uses the signal kind as the event name, so the funnel reads the same in GA4', () => {
    mirrorSignal('contact_completed', { id: 'x' });
    expect(events()[0][1]).toBe('contact_completed');
  });
});

describe('what is sent with them', () => {
  it('sends the facets that make a useful breakdown', () => {
    mirrorSignal('teacher_viewed', {
      id: 'rucha-jain',
      subject: 'Mathematics',
      area: 'Ballygunge',
      board: 'ICSE',
      classLevel: 'Class X',
    });

    expect(events()[0][2]).toEqual({
      teacher_slug: 'rucha-jain',
      subject: 'Mathematics',
      area: 'Ballygunge',
      board: 'ICSE',
      class_level: 'Class X',
    });
  });

  it('never sends free text, names or paths', () => {
    /* Account holders here include minors. The sensitive record belongs in
       read_events under a retention policy, not in a third-party analytics
       product, so this path stays boring on purpose. */
    mirrorSignal('search_submitted', {
      query: 'cheap maths tutor near my daughters school',
      name: 'A Real Person',
      path: '/some/path',
      imageUrl: 'https://example.com/photo.jpg',
      subject: 'Maths',
    });

    const params = events()[0][2] ?? {};
    expect(params).toEqual({ subject: 'Maths' });
  });

  it('takes the first value when a facet arrives as a list', () => {
    /* Browse's filters yield arrays. A breakdown by "Maths" is readable; one
       by "Maths,Physics,Chemistry" is a long tail that answers nothing. */
    mirrorSignal('filters_applied', { subject: ['Maths', 'Physics'] });
    expect(events()[0][2]?.subject).toBe('Maths');
  });

  it('skips empty and null facets rather than sending blanks', () => {
    mirrorSignal('filters_applied', { subject: '   ', area: null, board: undefined });
    expect(events()[0][2]).toEqual({});
  });

  it('skips a list whose entries are all empty', () => {
    mirrorSignal('filters_applied', { subject: [null, '', undefined] });
    expect(events()[0][2]).toEqual({});
  });

  it('truncates at the length GA4 silently rejects', () => {
    mirrorSignal('filters_applied', { subject: 'x'.repeat(250) });
    expect(events()[0][2]?.subject).toHaveLength(100);
  });
});

describe('counting a visit once', () => {
  it('counts one teacher once per session however many times it remounts', () => {
    mirrorSignal('teacher_viewed', { id: 'same-teacher' });
    mirrorSignal('teacher_viewed', { id: 'same-teacher' });
    mirrorSignal('teacher_viewed', { id: 'same-teacher' });
    expect(events()).toHaveLength(1);
  });

  it('still counts different teachers separately', () => {
    mirrorSignal('teacher_viewed', { id: 'teacher-a' });
    mirrorSignal('teacher_viewed', { id: 'teacher-b' });
    expect(events()).toHaveLength(2);
  });

  it('does not dedupe the contact steps', () => {
    /* Pressing message twice is two attempts, and the gap between attempts
       and completions is the number worth watching. */
    mirrorSignal('contact_started', { id: 'teacher-a' });
    mirrorSignal('contact_started', { id: 'teacher-a' });
    expect(events()).toHaveLength(2);
  });

  it('sends an un-identified view rather than swallowing it', () => {
    /* An undercounted funnel is the worse failure: a missing step looks like
       a drop-off that never happened. */
    mirrorSignal('teacher_viewed', {});
    mirrorSignal('teacher_viewed', {});
    expect(events()).toHaveLength(2);
  });
});

describe('Clarity', () => {
  it('tags the teacher on the contact steps', () => {
    mirrorSignal('contact_started', { id: 'teacher-a' });
    expect(clarity).toHaveBeenCalledWith('set', 'teacher_slug', 'teacher-a');
    expect(clarity).toHaveBeenCalledWith('event', 'contact_started');
  });

  it('does not tag on a mere profile view', () => {
    /* Clarity custom tags are session-scoped, so tagging every view leaves
       the tag showing whichever profile happened to be last. */
    mirrorSignal('teacher_viewed', { id: 'teacher-a' });
    expect(clarity).not.toHaveBeenCalled();
  });
});

describe('it cannot break the product', () => {
  it('survives gtag throwing', () => {
    installWindow({ gtag: () => { throw new Error('blocked by an extension'); } });
    expect(() => mirrorSignal('contact_completed', { id: 'x' })).not.toThrow();
  });

  it('survives clarity throwing', () => {
    installWindow({ clarity: () => { throw new Error('blocked'); } });
    expect(() => mirrorSignal('contact_started', { id: 'x' })).not.toThrow();
  });

  it('survives there being no window at all', () => {
    delete (globalThis as Record<string, unknown>).window;
    expect(() => mirrorSignal('contact_completed', { id: 'x' })).not.toThrow();
  });

  it('falls back to dataLayer before the gtag shim initialises', () => {
    /* Which is exactly when the first teacher_viewed of a session fires. */
    installWindow({ gtag: undefined });
    mirrorSignal('teacher_viewed', { id: 'teacher-a', subject: 'Maths' });
    expect((globalThis as { window: { dataLayer: unknown[] } }).window.dataLayer).toEqual([
      { event: 'teacher_viewed', teacher_slug: 'teacher-a', subject: 'Maths' },
    ]);
  });

  it('does nothing when both channels are missing', () => {
    installWindow({ gtag: undefined, clarity: undefined, dataLayer: undefined });
    expect(() => mirrorSignal('contact_completed', { id: 'x' })).not.toThrow();
  });
});
