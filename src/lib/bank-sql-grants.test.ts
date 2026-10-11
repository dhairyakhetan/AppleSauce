import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * Guards a grant that cannot guard itself.
 *
 * `scripts/generate-bank-sql.ts` emits a schema block that an operator pastes
 * into the SQL editor to bootstrap the question bank. It is not a migration,
 * its output is gitignored, and nobody reads it -- it gets regenerated. That
 * combination is how it came to carry
 *
 *     grant select on public.bank_questions to authenticated;
 *
 * nine days after 20260918100000 revoked exactly that. Nothing was exposed,
 * because reaching the database needs a human to paste the file. But a stale
 * grant in a file nobody reads is a footgun aimed at whoever next runs an
 * import, and no typecheck or lint rule can see inside a template literal.
 *
 * So: a string assertion, which is all this needs to be.
 *
 * WHY bank_questions AND NOT bank_papers. bank_papers is deliberately readable
 * -- it holds titles, schools, years and counts, which the browse and paper
 * pages render for signed-out visitors. bank_questions holds the thing the
 * project exists to protect, and `bank_paper_questions()` is its only read
 * path: it decides from auth.uid() and writes every call to read_events. A
 * direct table grant bypasses both the gate and the audit trail.
 */

const SCRIPT = 'scripts/generate-bank-sql.ts';

describe('the generated bank schema', () => {
  /* Comments stripped first. The file explains the history of this grant in
     prose, including the offending statement verbatim, and a regex cannot tell
     an explanation from an instruction -- the first version of this test
     failed on its own documentation. Only what Postgres would execute counts. */
  const sql = readFileSync(SCRIPT, 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--') && !line.trim().startsWith('*'))
    .join('\n');

  it('never grants direct SELECT on bank_questions to a client role', () => {
    /* Matches any role list: `to authenticated`, `to anon, authenticated`,
       `to public`. The column-level form is caught too, since the table name
       and the grant keyword still sit on the same statement. */
    const offending = /grant\s+[^;]*select[^;]*\bon\s+public\.bank_questions\b[^;]*;/gi;
    const hits = sql.match(offending) ?? [];
    expect(hits).toEqual([]);
  });

  it('still revokes bank_questions from both client roles', () => {
    expect(sql).toMatch(/revoke\s+all\s+on\s+public\.bank_questions\s+from\s+anon,\s*authenticated;/i);
  });

  it('leaves bank_papers readable, because that half is intended', () => {
    /* A test that only ever says "no" would pass just as happily if someone
       deleted the whole block, so this pins the thing that must stay. */
    expect(sql).toMatch(/grant\s+select\s+on\s+public\.bank_papers\s+to\s+anon,\s*authenticated;/i);
  });
});
