import { describe, it, expect } from 'vitest';
import { actionLabel, actorKindLabel, actorDisplayName, buildTimeline } from './question-timeline';
import type { QuestionHistoryRow } from './team-dashboard-api';

describe('actionLabel', () => {
  it('maps known actions to plain words', () => {
    expect(actionLabel('checker_pass')).toBe('Marked as right');
    expect(actionLabel('ai_flagged')).toBe('Flagged by the computer');
    expect(actionLabel('checker_ask_help')).toBe('Asked for help');
  });

  it('falls back to a capitalized, underscore-free word for an unknown action', () => {
    expect(actionLabel('some_new_thing')).toBe('Some new thing');
  });
});

describe('actorKindLabel', () => {
  it('labels every known kind', () => {
    expect(actorKindLabel('ai')).toBe('The computer');
    expect(actorKindLabel('admin')).toBe('An admin');
    expect(actorKindLabel('checker')).toBe('A checker');
    expect(actorKindLabel('system')).toBe('The system');
  });

  it('falls back to "Someone" for an unrecognised kind', () => {
    expect(actorKindLabel('mystery')).toBe('Someone');
  });
});

describe('actorDisplayName', () => {
  it('prefers a real name over the kind label', () => {
    expect(actorDisplayName({ actor_kind: 'checker', actor_name: 'Priya Das' })).toBe('Priya Das');
  });

  it('falls back to the kind label when the name is the literal "system"', () => {
    expect(actorDisplayName({ actor_kind: 'ai', actor_name: 'system' })).toBe('The computer');
  });

  it('falls back to the kind label when the name is empty', () => {
    expect(actorDisplayName({ actor_kind: 'system', actor_name: '' })).toBe('The system');
  });
});

function row(over: Partial<QuestionHistoryRow>): QuestionHistoryRow {
  return {
    at: '2026-09-29T00:00:00Z',
    actor_kind: 'checker',
    actor_name: 'system',
    action: 'checker_pass',
    detail: null,
    before: null,
    after: null,
    ...over,
  };
}

describe('buildTimeline', () => {
  it('sorts rows oldest first regardless of input order', () => {
    const rows = [
      row({ at: '2026-09-29T10:00:00Z', action: 'checker_pass' }),
      row({ at: '2026-09-29T08:00:00Z', action: 'created' }),
      row({ at: '2026-09-29T09:00:00Z', action: 'ai_flagged' }),
    ];
    const timeline = buildTimeline(rows);
    expect(timeline.map((t) => t.what)).toEqual(['Question added', 'Flagged by the computer', 'Marked as right']);
  });

  it('only carries a diff when before or after is present', () => {
    const [noDiff] = buildTimeline([row({ before: null, after: null })]);
    expect(noDiff.diff).toBeNull();

    const [withDiff] = buildTimeline([row({ before: 'old text', after: 'new text' })]);
    expect(withDiff.diff).toEqual({ before: 'old text', after: 'new text' });
  });

  it('treats a blank or whitespace-only detail as no detail', () => {
    const [entry] = buildTimeline([row({ detail: '   ' })]);
    expect(entry.detail).toBeNull();
  });

  it('keeps a real detail string', () => {
    const [entry] = buildTimeline([row({ detail: 'I cannot read the words' })]);
    expect(entry.detail).toBe('I cannot read the words');
  });

  it('shows the actor kind label when actor_name is the literal "system"', () => {
    const [entry] = buildTimeline([row({ actor_kind: 'ai', actor_name: 'system', action: 'ai_flagged' })]);
    expect(entry.who).toBe('The computer');
  });

  it('shows a real name over the kind label', () => {
    const [entry] = buildTimeline([row({ actor_kind: 'admin', actor_name: 'Rina Sen' })]);
    expect(entry.who).toBe('Rina Sen');
  });
});
