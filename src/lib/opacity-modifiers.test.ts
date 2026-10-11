import { readdirSync, readFileSync, statSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * Catches `/opacity` classes that Tailwind will silently refuse to emit.
 *
 * THE FAILURE MODE. When Tailwind cannot build an alpha channel for a class it
 * does not error and does not warn -- it emits no declaration at all. The
 * element then falls back to transparent, or to an inherited colour, and looks
 * plausible in a screenshot. That is how the capture shield shipped as an
 * invisible box with a caption, and how every sheet and dialog in the product
 * spent months opening over an undimmed page.
 *
 * TWO CAUSES, BOTH DECIDABLE WITHOUT A BUILD, WHICH IS WHY THIS IS A TEST AND
 * NOT A SCRIPT.
 *
 *   1. The token is a literal `var(--x)` holding a hex string. Tailwind can
 *      inject an alpha into `hsl(var(--x))` -- it rewrites it to
 *      `hsl(var(--x) / .45)` -- but it cannot do anything with a var() whose
 *      contents it has never seen. Use a literal hex (`bg-[#1B1A18]/45`) or an
 *      arbitrary value instead.
 *
 *   2. The number is not a step on the opacity scale, which runs 0 to 100 in
 *      fives. `bg-white/12` and `text-white/78` were both written here and both
 *      emitted nothing. Snap to the scale, or write `/[0.12]` and mean it.
 *
 * WHAT THIS TEST CORRECTS. GUARDRAILS once recorded "40 distinct classes
 * written, 0 generated" and blamed the `hsl()` tokens for lacking an
 * `<alpha-value>` placeholder. That was wrong on both counts. Tailwind handles
 * `hsl(var(--x))` by itself -- `.text-background\/70{color:hsl(var(--background) / .7)}`
 * is in the built CSS -- and the original audit had anchored its search on a
 * leading dot, so every `hover:` and `md:` variant looked missing. The real
 * figure was 94 written, 88 live, 6 dead. The six are the two causes above.
 */

/** Colour tokens declared as a bare `var(--x)` in tailwind.config.ts. */
const LITERAL_VAR_TOKENS = [
  'warm-page',
  'warm-card',
  'warm-muted',
  'warm-band',
  'warm-hairline',
  'warm-hairline-raised',
  'warm-hairline-strong',
  'warm-prose',
  'warm-secondary',
  'warm-meta',
  'warm-label',
  'panel',
  'mint',
  'mint-solid',
  'peach-tint',
  'success',
  'success-subtle-bg',
  'success-subtle-text',
  'whatsapp',
  'whatsapp-text',
  'indigo-link-on-dark',
  'facet-destructive',
  'surface-panel-light',
];

/** Tailwind's default scale. tailwind.config.ts does not override `opacity`. */
const OPACITY_SCALE = Array.from({ length: 21 }, (_, i) => i * 5);

const PREFIXES = [
  'bg', 'text', 'border', 'ring', 'from', 'to', 'via', 'fill', 'stroke',
  'divide', 'outline', 'decoration', 'placeholder', 'caret', 'shadow', 'accent',
];

/**
 * Comments are stripped first, and they have to be: the fixes for these bugs
 * all carry notes naming the broken class ("bg-[#1B1A18]/45, NOT bg-panel/45"),
 * so a scanner that cannot tell a warning from an instruction fails on the
 * documentation of the very thing it is checking.
 */
function strippedSources(): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = `${dir}/${entry}`;
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(tsx?|css)$/.test(entry) || /\.test\.tsx?$/.test(entry)) continue;
      const text = readFileSync(full, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/^\s*\/\/.*$/gm, ' ');
      out.push({ file: full, text });
    }
  };
  walk('src');
  return out;
}

function opacityClasses(): { file: string; cls: string; token: string; value: number }[] {
  const re = new RegExp(`\\b(${PREFIXES.join('|')})-([a-z0-9-]+)\\/(\\d{1,3})\\b`, 'g');
  return strippedSources().flatMap(({ file, text }) =>
    [...text.matchAll(re)]
      /* A slash after a utility is not always an alpha. Tailwind writes
         fractions the same way, and `slide-in-from-left-1/2` parses here as
         prefix "from", token "left-1", value 2. Colour tokens never end in a
         number, so that one rule separates the two meanings. */
      .filter((m) => !/\d$/.test(m[2]))
      .map((m) => ({
        file,
        cls: m[0],
        token: m[2],
        value: Number(m[3]),
      })),
  );
}

describe('opacity modifiers', () => {
  it('are never applied to a literal var() token', () => {
    const offenders = opacityClasses()
      .filter((c) => LITERAL_VAR_TOKENS.includes(c.token))
      .map((c) => `${c.file}: ${c.cls} (token "${c.token}" is a literal var, emits nothing)`);
    expect([...new Set(offenders)]).toEqual([]);
  });

  it('only use values that exist on the scale', () => {
    const offenders = opacityClasses()
      .filter((c) => !OPACITY_SCALE.includes(c.value))
      .map((c) => `${c.file}: ${c.cls} (/${c.value} is not a step; the scale runs 0-100 by fives)`);
    expect([...new Set(offenders)]).toEqual([]);
  });

  it('still names every literal var() colour token in the config', () => {
    /* The denylist above is hand-maintained, so it needs something holding it
       to the config. A new `foo: "var(--foo)"` colour would otherwise be
       silently outside the first test's reach -- which is exactly how `panel`
       came to sit directly below a "literal-hex vars, so no /opacity" warning
       without being covered by it. */
    const config = readFileSync('tailwind.config.ts', 'utf8');

    /* Counted rather than matched by name, because a token's name and its CSS
       variable do not have to agree -- `panel` is var(--panel-dark), and the
       nested ones (`success.subtle-bg`) are spelled differently again. The
       count is the honest invariant: if it moves, someone added or removed a
       literal-var colour and the list above needs the same edit. */
    const start = config.indexOf('colors: {');
    expect(start).toBeGreaterThan(-1);
    let depth = 0;
    let end = start;
    for (let i = config.indexOf('{', start); i < config.length; i++) {
      if (config[i] === '{') depth++;
      else if (config[i] === '}' && --depth === 0) {
        end = i;
        break;
      }
    }
    const colours = config.slice(start, end);
    const literalVars = colours.match(/"var\(--/g) ?? [];
    expect(literalVars.length).toBe(LITERAL_VAR_TOKENS.length);
  });
});
