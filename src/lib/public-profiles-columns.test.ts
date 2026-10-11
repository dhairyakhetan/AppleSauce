import { readdirSync, readFileSync, statSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * Keeps the `public_profiles` view and the code that reads it in step.
 *
 * WHY THIS IS WORTH A TEST. PostgREST is asymmetric in a way that has already
 * cost this project two outages. `select('*')` silently expands to whatever
 * columns the role may read, so a revoke turns into a quietly smaller row. A
 * NAMED column the role cannot read does the opposite: it fails the WHOLE
 * request with 401, so one extra word in a select list blanks an entire
 * feature.
 *
 * Both halves of that bug class have now happened here. 218 of 376 reviews
 * rendered as "Anonymous" because the view's backing function had been
 * revoked. The obvious next move -- trimming school_college and grade out of
 * the view for privacy -- would break them all over again unless the three
 * .select() calls were trimmed in the same commit.
 *
 * So this asserts the one invariant that cannot be seen from either side
 * alone: every column any caller names must exist in the view. It is a string
 * comparison, which is all it can be, because the view lives in SQL and the
 * callers live in TSX and nothing typechecks across that gap.
 */

const MIGRATION = 'supabase/migrations/20260919120000_restore_public_profiles_view.sql';
const SRC = 'src';

/** Columns the view actually exposes, read out of the migration that defines it. */
function viewColumns(): string[] {
  const sql = readFileSync(MIGRATION, 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

  const body = /create view public\.public_profiles as\s+select\s+([\s\S]*?)\s+from\s+public\.profiles/i.exec(sql);
  if (!body) throw new Error(`Could not find the view definition in ${MIGRATION}`);

  return body[1]
    .split(',')
    .map((part) => part.trim().replace(/^p\./, ''))
    .filter(Boolean);
}

/** Every `.from('public_profiles').select(...)` in the app, with its file. */
function callSites(): { file: string; columns: string[] }[] {
  const found: { file: string; columns: string[] }[] = [];
  const pattern = /\.from\(\s*'public_profiles'\s*\)\s*\.select\(\s*'([^']+)'/g;

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      /* Forward slashes throughout, built by hand rather than via path.join:
         Node accepts them on Windows, and it keeps the file names in the
         failure message identical on every machine. */
      const full = `${dir}/${entry}`;
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) continue;

      const text = readFileSync(full, 'utf8');
      for (const match of text.matchAll(pattern)) {
        found.push({
          file: full,
          columns: match[1].split(',').map((c) => c.trim()).filter(Boolean),
        });
      }
    }
  };

  walk(SRC);
  return found;
}

describe('public_profiles', () => {
  it('exposes the columns the view is documented to expose', () => {
    /* Pins the shape itself, so that trimming a column is a deliberate edit to
       this list rather than something that slips through on the strength of
       the cross-check below passing vacuously. */
    expect(viewColumns().sort()).toEqual(
      ['avatar_url', 'full_name', 'grade', 'id', 'role', 'school_college'].sort(),
    );
  });

  it('is read from exactly the three places we know about', () => {
    /* A fourth reader is not necessarily wrong, but it needs to be looked at:
       the view is row-limited to authors of approved non-anonymous reviews, so
       any caller passing ids from somewhere other than teacher_comments_public
       will silently get fewer rows than it asked for. */
    const files = callSites().map((c) => c.file).sort();
    expect(files).toEqual([
      'src/components/TeacherComments.tsx',
      'src/pages/Index.tsx',
      'src/pages/TeacherDashboard.tsx',
    ]);
  });

  it('never names a column the view does not have', () => {
    const columns = viewColumns();
    const offenders = callSites().flatMap(({ file, columns: selected }) =>
      selected.filter((c) => !columns.includes(c)).map((c) => `${file} selects "${c}"`),
    );
    /* Not a boolean assertion: when this fails, the message should say which
       file and which column, because the runtime symptom is a blank reviews
       section with a 401 in the console and nothing pointing here. */
    expect(offenders).toEqual([]);
  });
});
