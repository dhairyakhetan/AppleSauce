import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// teachers.ts imports the Supabase client, which needs a browser localStorage.
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));

import { TEACHER_PROFILE_COLUMNS } from './teachers';
import { generateTeacherPersonSchema } from '@/utils/structuredDataGenerators';

/* 12 October 2026: a signed-out visitor could read all 148 teachers' WhatsApp
   numbers with one REST call, teachers_list?select=slug,whatsapp_number. Both
   anon and authenticated held table-level SELECT, so the gated function
   teacher_whatsapp_link() was a side door nobody needed to use. Migration
   20261012700000_revoke_teacher_whatsapp_column.sql closes it. A column that is
   NAMED in a query but revoked fails the WHOLE request, so once that migration
   is applied no front-end code may name the column, and nothing may
   select('*') from teachers_list. These tests hold both halves. */

const ROOT = resolve(__dirname, '../..');

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules' || name === 'dist') continue;
      walk(full, out);
    } else if (/\.(ts|tsx|js|mjs)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

/* Generated types legitimately list every column; tests quote the name. */
const files = [...walk(join(ROOT, 'src')), ...walk(join(ROOT, 'scripts')), ...walk(join(ROOT, 'api'))].filter(
  (f) => !/\.test\.(ts|tsx)$/.test(f) && !f.replace(/\\/g, '/').endsWith('src/integrations/supabase/types.ts'),
);

describe('teachers_list.whatsapp_number is not reachable from anon-facing code', () => {
  it('scans a real set of files', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('no source file names whatsapp_number', () => {
    const offenders = files.filter((f) => /whatsapp_number/.test(readFileSync(f, 'utf8')));
    expect(offenders.map((f) => f.slice(ROOT.length))).toEqual([]);
  });

  it('no source file selects * from teachers_list', () => {
    const offenders = files.filter((f) =>
      /from\(\s*['"`]teachers_list['"`]\s*\)\s*\.select\(\s*['"`]\s*\*/.test(readFileSync(f, 'utf8')),
    );
    expect(offenders.map((f) => f.slice(ROOT.length))).toEqual([]);
  });

  it('the profile read uses an explicit column list with no contact column', () => {
    expect(TEACHER_PROFILE_COLUMNS).not.toMatch(/\*/);
    expect(TEACHER_PROFILE_COLUMNS).not.toMatch(/whatsapp|phone|email|link/i);
    expect(TEACHER_PROFILE_COLUMNS).toMatch(/\bslug\b/);
  });

  it('getTeacherBySlug selects TEACHER_PROFILE_COLUMNS, not a star', () => {
    const src = readFileSync(join(ROOT, 'src/lib/teachers.ts'), 'utf8');
    expect(src).toMatch(/\.select\(TEACHER_PROFILE_COLUMNS\)/);
    expect(src).not.toMatch(/\.select\(\s*['"`]\*/);
  });

  it('tap-to-WhatsApp still resolves through the gated RPC', () => {
    const src = readFileSync(join(ROOT, 'src/lib/teachers.ts'), 'utf8');
    expect(src).toMatch(/supabase\.rpc\('teacher_whatsapp_link'/);
    const profile = readFileSync(join(ROOT, 'src/pages/TeacherProfile.tsx'), 'utf8');
    expect(profile).toMatch(/lookupWhatsAppLink\(teacher\.slug\)/);
  });
});

describe('teacher profile JSON-LD carries no telephone', () => {
  it('emits no telephone or contactPoint, even if a caller passes a number', () => {
    const schema = generateTeacherPersonSchema({
      url: 'https://www.shikshaq.in/tuition-teachers/x',
      name: 'Test Teacher',
      area: 'Ballygunge',
      subjects: ['Maths'],
      classesTaught: ['10'],
      // A stray property from an old caller must not turn into a telephone.
      ...({ phoneNumber: '9000000000' } as object),
    });
    const json = JSON.stringify(schema);
    expect(json).not.toMatch(/telephone/i);
    expect(json).not.toMatch(/contactPoint/i);
    expect(json).not.toMatch(/9000000000/);
  });

  it('TeacherProfile and the prerender pass no phone number to the generator', () => {
    const profile = readFileSync(join(ROOT, 'src/pages/TeacherProfile.tsx'), 'utf8');
    expect(profile).not.toMatch(/phoneNumber/);
    const prerender = readFileSync(join(ROOT, 'scripts/prerender.ts'), 'utf8');
    const call = prerender.slice(prerender.indexOf('generateTeacherPersonSchema({'));
    expect(call.slice(0, call.indexOf('});'))).not.toMatch(/phone|telephone/i);
  });
});

describe('migration 20261012700000_revoke_teacher_whatsapp_column', () => {
  const sql = readFileSync(
    join(ROOT, 'supabase/migrations/20261012700000_revoke_teacher_whatsapp_column.sql'),
    'utf8',
  );
  const code = sql
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');

  it('revokes table SELECT from public, anon and authenticated by name', () => {
    for (const role of ['public', 'anon', 'authenticated']) {
      expect(code).toMatch(new RegExp(`revoke select on public\\.teachers_list from ${role};`));
      expect(code).toMatch(new RegExp(`revoke select \\(whatsapp_number\\) on public\\.teachers_list from ${role};`));
    }
  });

  it('grants the other columns back and never grants whatsapp_number', () => {
    const grant = code.match(/grant select \(([\s\S]*?)\) on public\.teachers_list to anon, authenticated;/);
    expect(grant).not.toBeNull();
    expect(grant![1]).not.toMatch(/whatsapp_number/);
    for (const col of ['id', 'name', 'slug', 'subject_id', 'image_url', 'is_featured']) {
      expect(grant![1]).toMatch(new RegExp(`\\b${col}\\b`));
    }
  });

  it('names the deploy order so it is not applied ahead of the code', () => {
    expect(sql).toMatch(/DEPLOY ORDER/);
  });
});
