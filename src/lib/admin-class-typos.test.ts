import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/* A Tailwind class glued to the next one ("min-h-9rounded-full") matches no
   class at all, so the min height, the pill shape and the margin all vanish
   and nothing fails. It shipped in four files before anyone saw it. Scan every
   .tsx under src/ for `min-h-<number><letter>`. */

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsxFiles(p));
    else if (name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

describe('class strings', () => {
  it('has no min-h class glued to the next class', () => {
    const bad: string[] = [];
    for (const f of tsxFiles('src')) {
      const src = readFileSync(f, 'utf8');
      src.split(/\r?\n/).forEach((line, i) => {
        // a backtick before it means a comment quoting the typo (AdminPillButton.tsx does), not a class
        if (/(?<!`)min-h-\d+[a-z]/.test(line)) bad.push(`${f.replace(/\\/g, '/')}:${i + 1}: ${line.trim().slice(0, 100)}`);
      });
    }
    expect(bad).toEqual([]);
  });
});
