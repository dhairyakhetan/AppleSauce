/**
 * The file rules of the submit-a-paper form, kept out of the page so they can
 * be tested and so the storage bucket's server-side limits have one client
 * source of truth to match.
 *
 * ⚠ THESE MUST MATCH THE BUCKET. `paper-submissions` carries a file_size_limit
 * and allowed_mime_types (migration 20261011150000_paper_submissions_bucket_limits.sql)
 * that mirror MAX_BYTES and ACCEPTED_TYPES. The client check is a courtesy to
 * the sender; the bucket is the real gate, because the insert policy lets any
 * caller upload without going through this page.
 */

export const MAX_BYTES = 25 * 1024 * 1024;
export const MAX_FILES = 10;
export const ACCEPTED_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'] as const;
/** The <input accept> string. */
export const ACCEPT = ACCEPTED_TYPES.join(',');

/** A per-file ceiling so a stalled connection ends in the WhatsApp fallback
 *  rather than leaving the form on "Uploading" for ever. */
export const UPLOAD_TIMEOUT_MS = 3 * 60 * 1000;

const EXTENSION_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

/** Type the browser reports, else the one the extension implies (some phones
 *  and drag sources hand over an empty `type`). */
export function fileKind(file: { name: string; type: string }): string {
  if (file.type) return file.type.toLowerCase();
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return EXTENSION_TYPES[ext] ?? '';
}

export function isAcceptedFile(file: { name: string; type: string }): boolean {
  return (ACCEPTED_TYPES as readonly string[]).includes(fileKind(file));
}

function names(list: { name: string }[]): string {
  return list.map((f) => f.name).join(', ');
}

export interface MergeResult<T> {
  files: T[];
  /** One plain sentence per thing that was left out; null when nothing was. */
  notice: string | null;
}

/**
 * Adds `incoming` to `prev`, enforcing type, size and count, and says exactly
 * what was left out. Nothing is dropped silently: a parent who picks twelve
 * photos must be told two did not go in, or they submit an incomplete paper
 * believing every page went up.
 */
export function mergeFiles<T extends { name: string; type: string; size: number }>(
  prev: T[],
  incoming: T[],
): MergeResult<T> {
  const wrongType: T[] = [];
  const tooBig: T[] = [];
  const ok: T[] = [];
  for (const f of incoming) {
    if (!isAcceptedFile(f)) wrongType.push(f);
    else if (f.size > MAX_BYTES) tooBig.push(f);
    else ok.push(f);
  }

  const room = Math.max(0, MAX_FILES - prev.length);
  const kept = ok.slice(0, room);
  const overflow = ok.length - kept.length;

  const notes: string[] = [];
  if (wrongType.length > 0) notes.push(`Only PDF or photos. Left out: ${names(wrongType)}.`);
  if (tooBig.length > 0) {
    notes.push(`${names(tooBig)} ${tooBig.length === 1 ? 'is' : 'are'} over 25MB. Photograph the pages instead of scanning at full size.`);
  }
  if (overflow > 0) {
    notes.push(`Only ${MAX_FILES} files at a time. ${overflow} ${overflow === 1 ? 'was' : 'were'} not added.`);
  }

  return { files: [...prev, ...kept], notice: notes.length > 0 ? notes.join(' ') : null };
}

export class UploadTimeoutError extends Error {
  constructor() {
    super('upload timed out');
    this.name = 'UploadTimeoutError';
  }
}

/** Rejects with UploadTimeoutError when `work` has not settled in `ms`. The
 *  underlying request is not cancelled (storage-js takes no signal), but the
 *  form stops waiting on it. */
export function withTimeout<T>(work: PromiseLike<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new UploadTimeoutError()), ms);
    Promise.resolve(work).then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

/** "Uploading file 2 of 5", or plain "Uploading" before the first file starts. */
export function uploadProgressLabel(current: number | null, total: number): string {
  if (current == null || total <= 1) return 'Uploading';
  return `Uploading file ${current} of ${total}`;
}
