import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ACCEPTED_TYPES,
  MAX_BYTES,
  MAX_FILES,
  UploadTimeoutError,
  isAcceptedFile,
  mergeFiles,
  uploadProgressLabel,
  withTimeout,
} from '@/lib/submit-paper-files';

const file = (name: string, type = 'image/jpeg', size = 1000) => ({ name, type, size });

describe('mergeFiles', () => {
  it('adds good files and says nothing', () => {
    const r = mergeFiles([], [file('a.jpg'), file('b.pdf', 'application/pdf')]);
    expect(r.files.map((f) => f.name)).toEqual(['a.jpg', 'b.pdf']);
    expect(r.notice).toBeNull();
  });

  it('tells the sender how many pages were left out past the tenth', () => {
    const incoming = Array.from({ length: 12 }, (_, i) => file(`p${i}.jpg`));
    const r = mergeFiles([], incoming);
    expect(r.files).toHaveLength(MAX_FILES);
    expect(r.notice).toBe('Only 10 files at a time. 2 were not added.');
  });

  it('counts room against what is already queued', () => {
    const prev = Array.from({ length: 9 }, (_, i) => file(`p${i}.jpg`));
    const r = mergeFiles(prev, [file('x.jpg'), file('y.jpg')]);
    expect(r.files).toHaveLength(10);
    expect(r.notice).toBe('Only 10 files at a time. 1 was not added.');
  });

  it('names every oversize file, not just the last', () => {
    const r = mergeFiles([], [file('big1.pdf', 'application/pdf', MAX_BYTES + 1), file('ok.jpg'), file('big2.pdf', 'application/pdf', MAX_BYTES + 5)]);
    expect(r.files.map((f) => f.name)).toEqual(['ok.jpg']);
    expect(r.notice).toContain('big1.pdf, big2.pdf are over 25MB');
  });

  it('lets a file of exactly 25MB through', () => {
    const r = mergeFiles([], [file('edge.pdf', 'application/pdf', MAX_BYTES)]);
    expect(r.files).toHaveLength(1);
    expect(r.notice).toBeNull();
  });

  it('refuses a dropped .docx, .zip or .html the way the picker would, and names it', () => {
    const r = mergeFiles([], [
      file('notes.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
      file('all.zip', 'application/zip'),
      file('page.html', 'text/html'),
      file('real.jpg'),
    ]);
    expect(r.files.map((f) => f.name)).toEqual(['real.jpg']);
    expect(r.notice).toBe('Only PDF or photos. Left out: notes.docx, all.zip, page.html.');
  });

  it('falls back to the extension when the browser reports no type', () => {
    expect(isAcceptedFile({ name: 'scan.PDF', type: '' })).toBe(true);
    expect(isAcceptedFile({ name: 'photo.jpeg', type: '' })).toBe(true);
    expect(isAcceptedFile({ name: 'macro.docm', type: '' })).toBe(false);
    expect(isAcceptedFile({ name: 'noext', type: '' })).toBe(false);
  });

  it('reports every kind of loss in one message', () => {
    const r = mergeFiles([], [file('a.zip', 'application/zip'), file('b.pdf', 'application/pdf', MAX_BYTES + 1)]);
    expect(r.notice).toContain('Only PDF or photos');
    expect(r.notice).toContain('over 25MB');
    expect(r.files).toHaveLength(0);
  });
});

describe('withTimeout', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('passes a result that arrives in time', async () => {
    await expect(withTimeout(Promise.resolve(7), 1000)).resolves.toBe(7);
  });

  it('rejects with UploadTimeoutError when the work never settles', async () => {
    const stuck = new Promise<never>(() => undefined);
    const outcome = withTimeout(stuck, 1000).catch((e) => e);
    await vi.advanceTimersByTimeAsync(1001);
    expect(await outcome).toBeInstanceOf(UploadTimeoutError);
  });

  it('keeps the real error when the work fails first', async () => {
    const boom = new Error('boom');
    await expect(withTimeout(Promise.reject(boom), 1000)).rejects.toBe(boom);
  });
});

describe('uploadProgressLabel', () => {
  it('says which file out of how many', () => {
    expect(uploadProgressLabel(2, 5)).toBe('Uploading file 2 of 5');
  });
  it('stays plain for one file or before the first starts', () => {
    expect(uploadProgressLabel(1, 1)).toBe('Uploading');
    expect(uploadProgressLabel(null, 5)).toBe('Uploading');
  });
});

describe('the bucket limits match the form', () => {
  const sql = readFileSync(
    resolve(__dirname, '../../supabase/migrations/20261011150000_paper_submissions_bucket_limits.sql'),
    'utf8',
  );
  const code = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

  it('caps size at the same 25MB the form enforces', () => {
    expect(code).toContain(`file_size_limit    = ${MAX_BYTES}`);
  });

  it('allows exactly the types the form accepts', () => {
    for (const t of ACCEPTED_TYPES) expect(code).toContain(`'${t}'`);
    const listed = code.match(/array\[([^\]]*)\]/)?.[1].split(',').map((x) => x.trim().replace(/'/g, '')) ?? [];
    expect(listed.sort()).toEqual([...ACCEPTED_TYPES].sort());
  });

  it('touches only the paper-submissions bucket', () => {
    expect(code).toContain("where id = 'paper-submissions'");
    expect(code).not.toMatch(/\bdelete\b|\bdrop\b/i);
  });
});

describe('SubmitPaper page', () => {
  const src = readFileSync(resolve(__dirname, '../pages/SubmitPaper.tsx'), 'utf8');

  it('does not pretend to clean up orphaned uploads with a delete the public cannot do', () => {
    expect(src).not.toMatch(/\.remove\(\s*paths/);
  });

  it('marks school and subject required and links the disabled button to its reason', () => {
    expect(src).toMatch(/<Field label="School the paper is from" required>/);
    expect(src).toMatch(/<Field label="Subject" required>/);
    expect(src).toContain('aria-describedby={showMissingHint ? missingHintId : undefined}');
    expect(src).toContain('id={missingHintId}');
  });

  it('takes the hidden file input out of the tab order', () => {
    expect(src).toMatch(/className="sr-only"[\s\S]{0,300}tabIndex=\{-1\}/);
  });
});
