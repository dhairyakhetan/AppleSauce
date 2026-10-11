import { describe, expect, it } from 'vitest';

import { BLOG_SUBJECTS } from './blog-stats';

/**
 * `src/content/blog-stats.ts` is generated (`npm run generate-blog-stats`),
 * not hand-written, and the blog's whole premise is that its numbers are
 * counted, not asserted. Every topic page states a "questions set" total and
 * separately renders a mark-value breakdown ("What it is usually worth") of
 * the same population -- a reader who adds up the visible bars must get the
 * same total as the stat tile above it, every time.
 *
 * This broke silently for 68 of 106 topics: `markValues` only counted
 * questions with a recorded, positive mark value, so any question with no
 * mark on record vanished from the breakdown while still being counted in
 * `questions`. The generator now carries the remainder explicitly as
 * `unspecifiedMarks`, and this test is the guard against it happening again.
 */
describe('blog-stats: every topic reconciles', () => {
  const allTopics = Object.entries(BLOG_SUBJECTS).flatMap(([subject, stats]) =>
    stats.topics.map((topic) => ({ subject, topic })),
  );

  it('has at least one subject with topics to check', () => {
    expect(allTopics.length).toBeGreaterThan(0);
  });

  it.each(allTopics.map(({ subject, topic }) => [`${subject} / ${topic.name}`, topic] as const))(
    '%s: markValues + unspecifiedMarks sums to questions',
    (_label, topic) => {
      const sum = topic.markValues.reduce((acc, m) => acc + m.count, 0) + topic.unspecifiedMarks;
      expect(sum).toBe(topic.questions);
    },
  );

  it('never reports a negative unspecifiedMarks count', () => {
    for (const { topic } of allTopics) {
      expect(topic.unspecifiedMarks).toBeGreaterThanOrEqual(0);
    }
  });
});
