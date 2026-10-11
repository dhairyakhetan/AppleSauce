import { describe, expect, it } from 'vitest';
import {
  HISTORY_ACTION_LABELS,
  UNDOABLE_ACTIONS,
  historyActionLabel,
  historyFieldLabel,
  historyLine,
  historySourceLabel,
  paperLabel,
  undoEffect,
} from './paper-history-labels';

const DASHES = /[–—]/;
const RAW_CODE = /[a-z]+_[a-z_]+/;

describe('paper history labels', () => {
  it('has a plain label for every action admin_undo_revision can reverse', () => {
    for (const action of UNDOABLE_ACTIONS) {
      expect(HISTORY_ACTION_LABELS[action], action).toBeTruthy();
      expect(historyActionLabel(action)).not.toMatch(RAW_CODE);
    }
    expect(historyActionLabel('admin_edit')).toBe('Edited');
    expect(historyActionLabel('admin_hide')).toBe('Hidden');
    expect(historyActionLabel('admin_restore')).toBe('Restored');
    expect(historyActionLabel('admin_delete')).toBe('Deleted');
  });

  it('falls back to plain words for a code it has never seen', () => {
    expect(historyActionLabel('something_new_from_the_db')).toBe('Changed');
    expect(historyActionLabel(null)).toBe('Changed');
    expect(historyFieldLabel('some_new_field')).toBe('Some new field');
    expect(historyFieldLabel(null)).toBe('');
    expect(historySourceLabel('weird')).toBe('');
  });

  it('turns field names and sources into words', () => {
    expect(historyFieldLabel('allowed_time_minutes')).toBe('Time allowed');
    expect(historyFieldLabel('is_published')).toBe('Visibility');
    expect(historySourceLabel('admin')).toBe('admin screen');
    expect(historySourceLabel('system')).toBe('pipeline');
  });

  it('reads a revision as "Edited, Year by Priya (admin screen)"', () => {
    expect(historyLine({ action: 'admin_edit', field: 'year', actor: 'Priya Sharma', source: 'admin' })).toBe(
      'Edited, Year by Priya Sharma (admin screen)',
    );
    expect(historyLine({ action: 'admin_hide', field: null, actor: 'Arjun Mehta', source: 'weird' })).toBe('Hidden by Arjun Mehta');
  });

  it('says what Undo will do for every undoable action, in plain words, with no dashes', () => {
    for (const action of UNDOABLE_ACTIONS) {
      const line = undoEffect({ action, field: 'year', before: '2022', after: '2023' });
      expect(line.length, action).toBeGreaterThan(10);
      expect(line).not.toMatch(DASHES);
      expect(line).not.toMatch(RAW_CODE);
    }
    expect(undoEffect({ action: 'admin_edit', field: 'year', before: '2022', after: '2023' })).toBe('This puts Year back to "2022", from "2023".');
    expect(undoEffect({ action: 'admin_hide', field: 'is_published' })).toContain('back on the site');
    expect(undoEffect({ action: 'admin_restore', field: 'is_published' })).toContain('hides the paper again');
  });

  it('never quotes question text in an undo line', () => {
    const line = undoEffect({ action: 'admin_edit', field: 'body', before: 'Find the value of x.', after: 'Find x.' });
    expect(line).not.toContain('Find');
    expect(line).toContain('Question text');
  });

  it('names the paper without a dash', () => {
    expect(paperLabel({ cls: '10', subject: 'Mathematics', year: '2019', school: 'Sample Hill School' })).toBe(
      'Class 10 Mathematics 2019, Sample Hill School',
    );
    expect(paperLabel({ school: 'Only School' })).toBe('Only School');
    expect(paperLabel({})).toBe('this paper');
    expect(paperLabel({ cls: 'X', subject: 'English', year: 2025, school: 'A School' })).not.toMatch(DASHES);
  });
});
