/**
 * Subject palette — VISUAL_LANGUAGE.md §3.
 *
 * The eight-subject pastel system is the single biggest source of color on the
 * site. It is implemented as a GENERATOR, not eight hardcoded triples: a new
 * subject needs only a `{ h, s, l, dark }` seed.
 *
 *   tint      = hsl(h  s%  93%)   // card background
 *   solid     = hsl(h  s%  l%)    // icon tile, badge fill
 *   text      = hsl(h  45% 26%)   // title
 *   meta      = hsl(h  28% 34%)   // sub-label
 *   badgeText = dark ? #FFFFFF : #1F1F1F
 *
 * Because tint is pinned at 93% L and text at 26% L, every subject sits at an
 * identical perceived weight and identical text/tint contrast ratio.
 *
 * ---------------------------------------------------------------------------
 * INLINE-STYLE EXCEPTION (sanctioned)
 * ---------------------------------------------------------------------------
 * DESIGN_SYSTEM.md §1.1 bans raw color literals in `src/pages/**` and
 * `src/components/**`, and §1.2 bans inline `style={{...}}` for anything
 * expressible in Tailwind. Subject color is the ONE sanctioned exception: the
 * value is genuinely dynamic (derived at runtime from a data-driven subject
 * name, out of an open-ended set that includes DB-authored subjects), so it
 * cannot be a static utility class.
 *
 * The exception is narrow and has conditions:
 *   - Components MUST obtain the color from `getSubjectPalette()`. They must
 *     never write a subject hex/hsl literal of their own.
 *   - The exception covers ONLY the five returned color roles, applied via
 *     `style` (or a CSS custom property). Everything else on the element —
 *     radius, padding, type, shadow — stays in Tailwind tokens.
 *
 *   const p = getSubjectPalette(subject);
 *   <div className="rounded-2xl p-6" style={{ backgroundColor: p.tint }}>
 *     <h3 style={{ color: p.text }}>{subject}</h3>
 *
 * Values are returned as `#RRGGBB` strings. They are computed from the seed,
 * not transcribed — and they have been verified to match the expected-output
 * table in VISUAL_LANGUAGE §3 for all eight subjects, all four generated roles.
 */

export interface SubjectSeed {
  /** Hue, 0–360. */
  h: number;
  /** Saturation %, 0–100. */
  s: number;
  /** Lightness % of the `solid` role, 0–100. */
  l: number;
  /** True when `solid` is dark enough to need white badge text. */
  dark: boolean;
}

export interface SubjectPalette {
  /** Card background. */
  tint: string;
  /** Icon tile / badge fill. */
  solid: string;
  /** Title color. */
  text: string;
  /** Sub-label / meta color. */
  meta: string;
  /** Text color to use on top of `solid`. */
  badgeText: string;
}

/* VISUAL_LANGUAGE §2.1 neutrals used by the unknown-subject fallback. */
const NEUTRAL_TINT = "#F0EAE2";
const NEUTRAL_SOLID = "#7B736B";
const NEUTRAL_TEXT = "#1F1F1F";
const WHITE = "#FFFFFF";

/** Fixed lightness/saturation constants from the §3 formula. */
const TINT_L = 93;
const TEXT_S = 45;
const TEXT_L = 26;
const META_S = 28;
const META_L = 34;

/**
 * The eight seeds from VISUAL_LANGUAGE §3, verbatim.
 * Keys are the canonical palette family names, not display names.
 */
export const SUBJECT_SEEDS = {
  maths: { h: 28, s: 85, l: 65, dark: false },
  science: { h: 145, s: 55, l: 45, dark: true },
  english: { h: 180, s: 45, l: 50, dark: false },
  commerce: { h: 220, s: 60, l: 55, dark: true },
  computer: { h: 280, s: 50, l: 55, dark: true },
  hindi: { h: 0, s: 65, l: 55, dark: true },
  history: { h: 35, s: 55, l: 50, dark: false },
  geography: { h: 160, s: 50, l: 45, dark: true },
} as const satisfies Record<string, SubjectSeed>;

export type SubjectFamily = keyof typeof SUBJECT_SEEDS;

/** Unknown-subject fallback, VISUAL_LANGUAGE §3. */
export const FALLBACK_SUBJECT_PALETTE: SubjectPalette = {
  tint: NEUTRAL_TINT,
  solid: NEUTRAL_SOLID,
  text: NEUTRAL_TEXT,
  meta: NEUTRAL_SOLID,
  badgeText: WHITE,
};

/** HSL → `#RRGGBB`. Standard CSS Color 4 conversion. */
function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100;
  const lig = l / 100;
  const a = sat * Math.min(lig, 1 - lig);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    const v = lig - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    return Math.round(255 * v)
      .toString(16)
      .padStart(2, "0")
      .toUpperCase();
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

/** WCAG relative luminance of a `#RRGGBB` hex color (sRGB, no alpha). */
function relativeLuminance(hex: string): number {
  const [r, g, b] = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map((c) => {
    const v = parseInt(c, 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two `#RRGGBB` hex colors. */
function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [lighter, darker] = la > lb ? [la, lb] : [lb, la];
  return (lighter + 0.05) / (darker + 0.05);
}

/** Derive the five roles from a seed. Exported so new seeds can be added.
 *
 * `seed.dark` is the *intent* ("this solid color reads as a dark surface")
 * carried over from VISUAL_LANGUAGE §3's exact h/s/l values, which are not
 * ours to alter. But intent and measured contrast drifted apart for a few
 * seeds (science/commerce/computer/hindi's solids land at 45-55% lightness —
 * legible-looking but under 4.5:1 against white for body text). Rather than
 * silently repaint the spec's colors, badgeText is picked by an actual WCAG
 * contrast check against the real rendered solid: white if it clears AA,
 * otherwise whichever of white/NEUTRAL_TEXT measures the higher contrast
 * against that solid (a straight "does white fail → use dark" fallback
 * previously assumed dark always wins, which isn't true for mid-lightness
 * solids like the blue seed — dark-on-blue measured 3.72:1, still failing).
 * The color stays exactly what the spec says, only which text sits on top
 * of it changes. */
export function paletteFromSeed(seed: SubjectSeed): SubjectPalette {
  const solid = hslToHex(seed.h, seed.s, seed.l);
  const whiteContrast = contrastRatio(solid, WHITE);
  const darkContrast = contrastRatio(solid, NEUTRAL_TEXT);
  const badgeText = whiteContrast >= 4.5
    ? WHITE
    : darkContrast > whiteContrast ? NEUTRAL_TEXT : WHITE;
  return {
    tint: hslToHex(seed.h, seed.s, TINT_L),
    solid,
    text: hslToHex(seed.h, TEXT_S, TEXT_L),
    meta: hslToHex(seed.h, META_S, META_L),
    badgeText,
  };
}

/* --------------------------------------------------------------------------
 * Matching
 * --------------------------------------------------------------------------
 * Subject strings in this codebase are NOT clean title case. They arrive from:
 *   - src/utils/searchFacets.ts SUBJECTS (33 canonical display names)
 *   - src/utils/subjectMapping.ts (route slugs, and comma-joined combos such as
 *     "Physics,Chemistry,Biology")
 *   - the Supabase `subjects` table (DB-authored, arbitrary)
 *   - teachers' comma-separated `subjects` column
 * plus alias forms: Mathematics/Maths, Computer/Computers, Accounts/
 * Accountancy, "Drawing & Painting"/"Drawing and Painting".
 *
 * Strategy, in order: normalize → exact alias → keyword scan → fallback.
 * This mirrors the existing src/utils/subjectColors.ts precedent (which already
 * folds physics/chemistry/biology into science and economics/business studies
 * into commerce) so the two agree.
 */

function normalize(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/\s*&\s*/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Normalized exact-match aliases → palette family. */
const ALIASES: Record<string, SubjectFamily> = {
  // Maths
  maths: "maths",
  math: "maths",
  mathematics: "maths",
  // Science (incl. the PCB combo and its members)
  science: "science",
  sci: "science",
  physics: "science",
  phy: "science",
  chemistry: "science",
  chem: "science",
  biology: "science",
  bio: "science",
  "environmental science": "science",
  evs: "science",
  "home science": "science",
  // English / languages
  english: "english",
  eng: "english",
  // Commerce family
  commerce: "commerce",
  "commercial studies": "commerce",
  economics: "commerce",
  econ: "commerce",
  eco: "commerce",
  accounts: "commerce",
  accountancy: "commerce",
  accounting: "commerce",
  acc: "commerce",
  "business studies": "commerce",
  bst: "commerce",
  // Computer
  computer: "computer",
  computers: "computer",
  cs: "computer",
  it: "computer",
  // Hindi
  hindi: "hindi",
  // History family
  history: "history",
  hist: "history",
  civics: "history",
  "history and civics": "history",
  "social studies": "history",
  sst: "history",
  // Geography
  geography: "geography",
  geo: "geography",
};

/**
 * Keyword scan, applied when no exact alias matches. Ordered most-specific
 * first so "computer science" resolves to `computer`, not `science`.
 */
const KEYWORDS: ReadonlyArray<readonly [string, SubjectFamily]> = [
  ["computer", "computer"],
  ["comput", "computer"],
  ["coding", "computer"],
  ["geograph", "geography"],
  ["histor", "history"],
  ["civics", "history"],
  ["social studies", "history"],
  ["hindi", "hindi"],
  ["math", "maths"],
  ["english", "english"],
  ["commerc", "commerce"],
  ["econom", "commerce"],
  ["account", "commerce"],
  ["business", "commerce"],
  ["physics", "science"],
  ["chemist", "science"],
  ["biolog", "science"],
  ["scien", "science"],
];

/** Resolve a raw subject string to a palette family, or null if unknown. */
export function resolveSubjectFamily(subject: string | null | undefined): SubjectFamily | null {
  if (!subject) return null;

  // Comma-joined combos ("Physics,Chemistry,Biology") resolve on their first
  // member, which is how the filter pills present them.
  const first = String(subject).split(",")[0];
  const key = normalize(first);
  if (!key) return null;

  const alias = ALIASES[key];
  if (alias) return alias;

  for (const [needle, family] of KEYWORDS) {
    if (key.includes(needle)) return family;
  }
  return null;
}

/**
 * Look up the palette for a subject. Case-insensitive, punctuation-insensitive,
 * and tolerant of the alias forms that exist in this codebase. Unknown subjects
 * get the neutral fallback from §3 rather than throwing.
 */
export function getSubjectPalette(subject: string | null | undefined): SubjectPalette {
  const family = resolveSubjectFamily(subject);
  return family ? paletteFromSeed(SUBJECT_SEEDS[family]) : FALLBACK_SUBJECT_PALETTE;
}

/**
 * A stable palette for something that has no subject of its own.
 *
 * The past-paper shelf needed this: every paper in the question bank is
 * Mathematics, so colouring by subject gave 193 identical orange covers, and
 * colouring by school name fell through to the neutral fallback and gave 193
 * identical beige ones. Hashing a key across the same eight seeds keeps the
 * shelf inside the palette system — no new colours, no literals — while making
 * one paper distinguishable from the next at a glance.
 *
 * Decorative by design: the colour carries no meaning here, it only separates.
 * Use `getSubjectPalette` wherever the colour is supposed to MEAN a subject.
 */
export function paletteFromKey(key: string | null | undefined): SubjectPalette {
  const k = (key ?? '').trim();
  if (!k) return FALLBACK_SUBJECT_PALETTE;
  const names = Object.keys(SUBJECT_SEEDS) as (keyof typeof SUBJECT_SEEDS)[];
  let hash = 0;
  for (let i = 0; i < k.length; i += 1) hash = (hash * 31 + k.charCodeAt(i)) >>> 0;
  return paletteFromSeed(SUBJECT_SEEDS[names[hash % names.length]]);
}

export default getSubjectPalette;
