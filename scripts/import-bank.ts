#!/usr/bin/env tsx
/**
 * ONE-OFF IMPORT: question bank JSON -> Supabase
 *
 * Loads data/question-bank.json into `bank_papers` and `bank_questions`
 * (created by migration 20260829_bank_papers_and_questions.sql).
 *
 * Why a script and not a migration: the bank is 2.5MB of verbatim question
 * text. Inlining that as SQL would mean escaping 6,912 maths questions by
 * hand, and the one rule this data has is that its text is never altered.
 * Here the text goes JSON.parse -> parameterised insert and is never
 * reserialised, so byte-exactness is a property of the transport rather than
 * something to hope for. The script verifies it afterwards anyway.
 *
 * Idempotent: upserts on primary key, so re-running repairs rather than
 * duplicates. Safe to run against a partially-loaded table.
 *
 * Needs SUPABASE_SERVICE_ROLE_KEY in .env — the tables are admin-write, and
 * this is an admin operation. That key is never committed and never shipped
 * to the browser; .env is already gitignored.
 *
 *   npm run import-bank
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

import { papersOf, hasYear, type BankQuestion } from './bank-source';
import { schoolLabel, isBoardPaper, hasSchool } from './school-names';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
config({ path: path.join(__dirname, '..', '.env') });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
/* Defaults to the original maths bank; `--file <path>` points it at another
   converted bank (see convert-subject-bank.ts). Same upsert-on-id path
   either way, so a second bank adds rows rather than replacing the first. */
const fileArgIndex = process.argv.indexOf('--file');
const BANK_PATH = fileArgIndex !== -1 && process.argv[fileArgIndex + 1]
  ? path.resolve(process.argv[fileArgIndex + 1])
  : path.join(__dirname, '..', 'data', 'question-bank.json');

const PAPER_BATCH = 200;
const QUESTION_BATCH = 400;

function die(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}

async function main() {
  if (!SUPABASE_URL) die('VITE_SUPABASE_URL missing from .env');
  if (!SERVICE_KEY) {
    die(
      'SUPABASE_SERVICE_ROLE_KEY missing from .env.\n\n' +
        'Supabase dashboard -> Project Settings -> API Keys -> service_role.\n' +
        'Add it to .env as:\n\n' +
        '  SUPABASE_SERVICE_ROLE_KEY=eyJ...\n\n' +
        '.env is gitignored, and this key is only ever read by this script.',
    );
  }
  if (!fs.existsSync(BANK_PATH)) die(`Question bank not found at ${BANK_PATH}`);

  const db = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const bank: BankQuestion[] = JSON.parse(fs.readFileSync(BANK_PATH, 'utf-8'));
  const papers = papersOf(bank);
  console.log(`Read ${bank.length} questions across ${papers.length} papers.`);

  /* Papers -------------------------------------------------------------- */
  const paperRows = papers.map((p) => ({
    id: p.id,
    school_raw: p.school ?? null,
    school: schoolLabel(p.school),
    is_board_paper: isBoardPaper(p.school),
    year: hasYear(p.year) ? p.year : null,
    exam: p.exam || null,
    cls: p.cls || 'X',
    subject: p.subject,
    board: p.board,
    question_count: p.questionCount,
    marks: p.marks,
    has_school: hasSchool(p.school),
    is_published: true,
    /* Explicit, not omitted -- an omitted column falls through to the
       schema default (false) with no visible decision in this file. A
       source that isn't ready for release needs a deliberate import path
       (see the 2026-09-25 English gated-release import for the pattern),
       not a silent default here. */
    needs_review: false,
  }));

  for (let i = 0; i < paperRows.length; i += PAPER_BATCH) {
    const slice = paperRows.slice(i, i + PAPER_BATCH);
    const { error } = await db.from('bank_papers').upsert(slice, { onConflict: 'id' });
    if (error) die(`Paper upsert failed at row ${i}: ${error.message}`);
    console.log(`  papers ${Math.min(i + slice.length, paperRows.length)}/${paperRows.length}`);
  }

  /* Questions ------------------------------------------------------------ */
  // `ord` is the question's position within its own paper, in source order.
  // The old reader depended on the order rows happened to sit in a JSON array;
  // a table has no inherent order, so it is recorded explicitly.
  const seen = new Map<string, number>();
  const questionRows = bank.map((r) => {
    const ord = seen.get(r.p) ?? 0;
    seen.set(r.p, ord + 1);
    return {
      id: r.i,
      paper_id: r.p,
      ord,
      number: r.n ?? null,
      body: r.t, // verbatim, untouched
      marks: r.m ?? null,
      chapter: r.c ?? null,
      qtype: r.ty ?? null,
      page: r.pg ?? null,
      figure: r.f ?? null,
      options: r.o ?? null,
    };
  });

  for (let i = 0; i < questionRows.length; i += QUESTION_BATCH) {
    const slice = questionRows.slice(i, i + QUESTION_BATCH);
    const { error } = await db.from('bank_questions').upsert(slice, { onConflict: 'id' });
    if (error) die(`Question upsert failed at row ${i}: ${error.message}`);
    console.log(`  questions ${Math.min(i + slice.length, questionRows.length)}/${questionRows.length}`);
  }

  /* Verify --------------------------------------------------------------- */
  console.log('\nVerifying...');

  const { count: paperCount } = await db
    .from('bank_papers').select('*', { count: 'exact', head: true });
  const { count: questionCount } = await db
    .from('bank_questions').select('*', { count: 'exact', head: true });
  console.log(`  rows: ${paperCount} papers (expected ${paperRows.length}), ` +
              `${questionCount} questions (expected ${questionRows.length})`);

  // Byte-exactness, checked against the source rather than assumed. Paged,
  // because the point is to compare every question and not a sample.
  let checked = 0;
  const drift: string[] = [];
  const bySourceId = new Map(questionRows.map((q) => [q.id, q]));
  const PAGE = 1000;
  for (let from = 0; from < questionRows.length; from += PAGE) {
    const { data, error } = await db
      .from('bank_questions')
      .select('id, body, ord, paper_id')
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) die(`Verification read failed: ${error.message}`);
    for (const row of data ?? []) {
      const src = bySourceId.get(row.id);
      if (!src) { drift.push(`${row.id}: in database but not in source`); continue; }
      if (src.body !== row.body) drift.push(`${row.id}: text differs`);
      if (src.ord !== row.ord) drift.push(`${row.id}: ord differs`);
      checked += 1;
    }
  }
  console.log(`  compared ${checked} question texts byte for byte`);

  if (drift.length) {
    console.error(`\n${drift.length} MISMATCHES:`);
    drift.slice(0, 10).forEach((d) => console.error(`  ${d}`));
    process.exit(1);
  }
  if (paperCount !== paperRows.length || questionCount !== questionRows.length) {
    die('Row counts do not match the source. Nothing was deleted; re-run to repair.');
  }

  console.log('\nBank imported. Every question matches the source exactly.\n');
}

main();
