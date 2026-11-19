// @vitest-environment node
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import tailwindConfig from '../../tailwind.config';
import { buttonVariants } from '@/components/ui/button';
import { actionToneClass, CHIP, type ActionTone } from '@/lib/checker-button-styles';
import { TABLE_COLUMN_RULE, TABLE_FRAME, TABLE_HEAD_LABEL, TABLE_ROW_PRESS, TABLE_ROW_RULE } from '@/lib/table-styles';
import { BAR_WELL, FIGURE_LABEL, FIGURE_NUMBER, FIGURE_TILE } from '@/lib/chart-styles';
import { ACTION_FOOTER, MENU_CHEVRON, MENU_GAP, MENU_ITEM, MENU_ITEM_CHOSEN, MENU_SURFACE, MODAL_ENTER, MODAL_SURFACE, POPOVER_SURFACE, SCRIM, SCRIM_ENTER, SHEET_MOTION, SHEET_SURFACE, TOOLTIP_SURFACE } from '@/lib/overlay-styles';

/* The tactile layer (12 Nov 2026) is a set of tokens in src/index.css and a few
   Tailwind names that map to them. These tests pin the parts other stages and
   other people lean on, and guard the "a rule is global" part: nobody may bring
   back a hand-typed press number or the orange focus ring on one control. */

const ROOT = resolve(__dirname, '../..');
const css = readFileSync(join(ROOT, 'src/index.css'), 'utf8');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe('tactile tokens in index.css', () => {
  it('defines the press scales, the strong ease-out, the disabled opacity and the focus ring', () => {
    expect(css).toMatch(/--press-scale:\s*0\.97;/);
    expect(css).toMatch(/--press-scale-small:\s*0\.94;/);
    expect(css).toMatch(/--press-scale-card:\s*0\.99;/);
    expect(css).toMatch(/--ease-out-strong:\s*cubic-bezier\(0\.23, 1, 0\.32, 1\);/);
    expect(css).toMatch(/--disabled-opacity:\s*0\.6;/);
    expect(css).toMatch(/--focus-ring:\s*hsl\(var\(--ring\)\);/);
  });

  it('defines the whole shadow family stages 2 and 3 reuse', () => {
    for (const name of ['button', 'button-hover', 'card', 'card-lift', 'table', 'menu', 'popover', 'modal']) {
      expect(css, `--shadow-${name}`).toMatch(new RegExp(`--shadow-${name}:`));
    }
  });

  it('keeps every shadow crisp: no blur radius above 8px in the family', () => {
    const block = css.slice(css.indexOf('--shadow-ink:'), css.indexOf('--shadow-border:'));
    const drops = [...block.matchAll(/0 (\d+)px (\d+)px (?:-?\d+px |0 )?rgb\(/g)];
    expect(drops.length).toBeGreaterThanOrEqual(8);
    // "0 y blur spread colour": the blur is the 2nd number
    for (const m of drops) expect(Number(m[2])).toBeLessThanOrEqual(8);
  });

  it('turns every press squeeze off under prefers-reduced-motion', () => {
    const at = css.indexOf('Tactile press, reduced motion');
    expect(at).toBeGreaterThan(0);
    const block = css.slice(at, at + 700);
    expect(block).toContain('prefers-reduced-motion: reduce');
    expect(block).toMatch(/--press-scale:\s*1;/);
    expect(block).toMatch(/--press-scale-small:\s*1;/);
    expect(block).toMatch(/--press-scale-card:\s*1;/);
  });
});

describe('tactile names in tailwind.config', () => {
  const ext = (tailwindConfig.theme as { extend: Record<string, Record<string, unknown>> }).extend;

  it('maps the shadow names to the tokens', () => {
    expect(ext.boxShadow.button).toBe('var(--shadow-button)');
    expect(ext.boxShadow.card).toBe('var(--shadow-card)');
    expect(ext.boxShadow['card-lift']).toBe('var(--shadow-card-lift)');
    expect(ext.boxShadow.menu).toBe('var(--shadow-menu)');
    expect(ext.boxShadow.modal).toBe('var(--shadow-modal)');
  });

  it('reads the solid edge at the element, so a control can set its own colour', () => {
    expect(String(ext.boxShadow.solid)).toContain('var(--tactile-edge)');
  });

  it('names the three press scales and the disabled opacity', () => {
    expect(ext.scale).toEqual({
      press: 'var(--press-scale)',
      'press-small': 'var(--press-scale-small)',
      'press-card': 'var(--press-scale-card)',
    });
    expect(ext.opacity.disabled).toBe('var(--disabled-opacity)');
  });

  it('makes the bare ease-out and the default easing the strong ease-out', () => {
    const e = ext.transitionTimingFunction as Record<string, string>;
    expect(e.out).toBe('cubic-bezier(0.23, 1, 0.32, 1)');
    expect(e.DEFAULT).toBe('cubic-bezier(0.23, 1, 0.32, 1)');
  });
});

describe('the shared button recipes', () => {
  it('give every redesign variant an edge, and every filled one the same press', () => {
    for (const v of ['primary', 'indigo', 'whatsapp', 'muted', 'dark'] as const) {
      expect(buttonVariants({ variant: v }), v).toMatch(/shadow-(solid|button)/);
    }
    expect(buttonVariants({ variant: 'primary' })).toContain('[--tactile-edge:var(--brand-deep)]');
    expect(buttonVariants({ variant: 'indigo' })).toContain('[--tactile-edge:var(--brand-blue-deep)]');
  });

  it('use the shared focus ring and disabled opacity, and name the properties they animate', () => {
    const base = buttonVariants({ variant: 'primary' });
    expect(base).toContain('focus-visible:ring-focus');
    expect(base).toContain('disabled:opacity-disabled');
    expect(base).not.toMatch(/transition-all/);
  });

  it("give the checker's action buttons an edge, the press and the shared focus ring", () => {
    const tones: ActionTone[] = ['mint', 'dark', 'brand', 'muted', 'outline'];
    for (const t of tones) {
      const c = actionToneClass(t);
      expect(c, t).toContain('active:scale-press');
      expect(c, t).toContain('focus-visible:ring-focus');
      expect(c, t).toContain('disabled:opacity-disabled');
    }
    for (const t of ['mint', 'dark', 'brand', 'muted'] as const) expect(actionToneClass(t), t).toMatch(/shadow-(solid|button)/);
    expect(CHIP).toContain('active:scale-press-small');
  });
});

describe('a rule is global: no one-off press numbers or orange focus rings come back', () => {
  const files = walk(join(ROOT, 'src'));

  it('uses no hand-typed active:scale-[0.9x]; presses name the shared scales', () => {
    const bad = files.filter((f) => /active:scale-\[0\.9\d*\]/.test(readFileSync(f, 'utf8')));
    expect(bad.map((f) => f.replace(ROOT, ''))).toEqual([]);
  });

  it('dims a disabled control with the one token, not a hand-typed 50, 60 or 70', () => {
    const bad = files.filter((f) => /disabled:opacity-(50|60|70)(?![0-9])/.test(readFileSync(f, 'utf8')));
    expect(bad.map((f) => f.replace(ROOT, ''))).toEqual([]);
  });

  it('uses the one focus-ring colour, not the brand orange, on focus-visible rings', () => {
    const bad = files.filter((f) => /focus-visible:ring-brand(?![-a-zA-Z/])/.test(readFileSync(f, 'utf8')));
    expect(bad.map((f) => f.replace(ROOT, ''))).toEqual([]);
  });
});

describe('stage 2: tables share one recipe', () => {
  it('frames a table with a 0.5px edge and the table drop, and rules rows and columns at 0.5px', () => {
    expect(TABLE_FRAME).toContain('shadow-table');
    expect(TABLE_FRAME).toContain('border-[0.5px]');
    expect(TABLE_ROW_RULE).toContain('border-t-[0.5px]');
    expect(TABLE_COLUMN_RULE).toContain('border-l-[0.5px]');
  });

  it('keeps header labels in an ink that reaches 4.5:1 (secondary, not the quaternary 3.5:1 one)', () => {
    expect(TABLE_HEAD_LABEL).toContain('text-warm-secondary');
    expect(TABLE_HEAD_LABEL).not.toContain('text-warm-label');
  });

  it('gives a pressable row the card-level press, and not while a button inside it is pressed', () => {
    expect(TABLE_ROW_PRESS).toContain('scale-press-card');
    expect(TABLE_ROW_PRESS).toContain(':not(:has(button:active))');
    expect(TABLE_ROW_PRESS).not.toMatch(/transition-all/);
  });

  it('puts every table frame through the shared recipe, not a hand-typed shadow or rule', () => {
    const hod = readFileSync(join(ROOT, 'src/components/hod/VerifiersTab.tsx'), 'utf8');
    const admin = readFileSync(join(ROOT, 'src/pages/admin/AdminTable.tsx'), 'utf8');
    expect(hod).toContain('TABLE_FRAME');
    expect(admin).toContain('TABLE_ROW_PRESS');
    expect(admin).not.toMatch(/shadow-\[inset_0_-1px_0_#/);
  });
});

describe('stage 2: charts share one recipe', () => {
  it('sinks a bar track into its card with a hairline ring and a short shade, nothing blurrier than 1px', () => {
    expect(BAR_WELL).toContain('inset_0_1px_1px_0');
    expect(BAR_WELL).toContain('inset_0_0_0_0.5px');
  });

  it('draws a stat tile as a 24/32 number over a 13/20 label on a raised card', () => {
    expect(FIGURE_NUMBER).toContain('text-[24px]');
    expect(FIGURE_NUMBER).toContain('leading-8');
    expect(FIGURE_NUMBER).toContain('tabular-nums');
    expect(FIGURE_LABEL).toContain('text-[13px]');
    expect(FIGURE_LABEL).toContain('leading-5');
    expect(FIGURE_TILE).toContain('shadow-card');
  });

  it('does not animate a data figure: the tile and the well carry no transition', () => {
    for (const c of [BAR_WELL, FIGURE_TILE, FIGURE_NUMBER]) expect(c).not.toMatch(/transition|animate-/);
  });
});

describe('stage 3: menus, popovers, dialogs and sheets share one recipe', () => {
  const css3 = css.slice(css.indexOf('Overlay motion (tactile design pass'));
  const rule = (sel: string) => {
    const at = css3.indexOf(sel);
    expect(at, sel).toBeGreaterThan(-1);
    return css3.slice(at, css3.indexOf('}', at));
  };

  it('opens a menu in 150ms from scale .97 with a fade and closes it in 120ms', () => {
    expect(css3).toMatch(/@keyframes overlay-menu-in \{ from \{ opacity: 0; scale: \.97; \}/);
    expect(rule('.overlay-menu[data-state="delayed-open"]')).toContain('overlay-menu-in 150ms var(--ease-out-strong)');
    expect(rule('.overlay-menu[data-state="closed"]')).toContain('overlay-menu-out 120ms var(--ease-out-strong)');
  });

  it('brings a dialog in over 240ms with a 16px rise and out over 200ms', () => {
    expect(css3).toMatch(/@keyframes overlay-modal-in \{ from \{ opacity: 0; translate: 0 16px; \}/);
    expect(rule('.overlay-modal[data-state="open"]')).toContain('240ms');
    expect(rule('.overlay-modal[data-state="closed"]')).toContain('200ms');
  });

  it('lifts a bottom sheet in 320ms and drops it in 200ms, solid the whole way (no opacity in its keyframes)', () => {
    expect(rule('.overlay-sheet-bottom[data-state="open"]')).toContain('320ms');
    expect(rule('.overlay-sheet-bottom[data-state="closed"]')).toContain('200ms');
    const kf = css3.slice(css3.indexOf('@keyframes overlay-sheet-bottom-in'), css3.indexOf('@keyframes overlay-sheet-top-in'));
    expect(kf).not.toContain('opacity');
  });

  it('never leaves slower than it arrived', () => {
    const ms = (sel: string) => Number(/ (\d+)ms/.exec(rule(sel))![1]);
    expect(ms('.overlay-menu[data-state="closed"]')).toBeLessThan(ms('.overlay-menu[data-state="delayed-open"]'));
    expect(ms('.overlay-modal[data-state="closed"]')).toBeLessThan(ms('.overlay-modal[data-state="open"]'));
    expect(ms('.overlay-sheet-bottom[data-state="closed"]')).toBeLessThan(ms('.overlay-sheet-bottom[data-state="open"]'));
  });

  it('turns every overlay into a plain crossfade when the reader asked for less movement', () => {
    const at = css.search(/@media \(prefers-reduced-motion: reduce\) \{\r?\n {2}\.overlay-menu/);
    expect(at).toBeGreaterThan(0);
    const block = css.slice(at, at + 1900);
    for (const sel of ['.overlay-menu[data-state="open"]', '.overlay-modal[data-state="open"]', '.overlay-sheet-bottom[data-state="open"]', '.overlay-enter-modal']) expect(block).toContain(sel);
    expect(block).toContain('animation-name: overlay-fade-in !important');
    expect(block).toContain('animation-name: overlay-fade-out !important');
  });

  it('draws a menu as the raised card colour with the menu shadow and 8px corners, and no border', () => {
    expect(MENU_SURFACE).toContain('shadow-menu');
    expect(MENU_SURFACE).toContain('rounded-[8px]');
    expect(MENU_SURFACE).toContain('bg-popover');
    expect(MENU_SURFACE).not.toMatch(/(^| )border( |$)/);
    expect(MENU_SURFACE).toContain('origin-[var(--radix-popper-transform-origin)]');
    expect(MENU_SURFACE).toContain('overlay-menu');
  });

  it('keeps menu items 44px on a phone and 40px with a mouse, 2px apart, each with its own fading fill', () => {
    expect(MENU_GAP).toContain('gap-[2px]');
    expect(MENU_ITEM).toContain('min-h-11');
    expect(MENU_ITEM).toContain('md:min-h-10');
    expect(MENU_ITEM).toContain('transition-colors');
    expect(MENU_ITEM).toContain('data-[highlighted]:bg-muted');
    expect(MENU_ITEM).not.toMatch(/transition-all/);
  });

  it('makes the chosen item two steps up (accent) and the highlighted one step up (muted), with no tick', () => {
    expect(MENU_ITEM_CHOSEN).toContain('data-[state=checked]:bg-accent');
    expect(MENU_ITEM_CHOSEN).toContain('data-[state=checked]:data-[highlighted]:bg-accent');
    for (const f of ['select', 'dropdown-menu']) {
      const src = readFileSync(join(ROOT, `src/components/ui/${f}.tsx`), 'utf8');
      expect(src, f).not.toContain('ItemIndicator');
    }
  });

  it('turns the trigger chevron over while the menu is open, and flips it at once for reduced motion', () => {
    expect(MENU_CHEVRON).toContain('group-data-[state=open]:rotate-180');
    expect(MENU_CHEVRON).toContain('duration-150');
    expect(css).toMatch(/\.overlay-chevron \{ transition: none !important; \}/);
  });

  it('gives popovers and tooltips the popover shadow, no border, and the menu arrival', () => {
    for (const c of [POPOVER_SURFACE, TOOLTIP_SURFACE]) {
      expect(c).toContain('shadow-popover');
      expect(c).toContain('overlay-menu');
      expect(c).not.toMatch(/(^| )border( |$)/);
    }
    expect(POPOVER_SURFACE).toContain('rounded-[24px]'); // the site's own (Handoff O-008/O-009)
  });

  it('draws a dialog and a sheet as the card colour with the modal shadow, and slides a sheet from its own side', () => {
    for (const c of [MODAL_SURFACE, MODAL_ENTER, SHEET_SURFACE]) {
      expect(c).toContain('shadow-modal');
      expect(c).toContain('bg-card');
    }
    expect(MODAL_SURFACE).toContain('overlay-modal');
    expect(Object.values(SHEET_MOTION)).toEqual(['overlay-sheet-top', 'overlay-sheet-bottom', 'overlay-sheet-left', 'overlay-sheet-right']);
  });

  it("keeps the site's own dim: 45% near-black, no blur (Handoff O-001 rule 2)", () => {
    for (const c of [SCRIM, SCRIM_ENTER]) {
      expect(c).toContain('bg-[#1B1A18]/45');
      expect(c).not.toContain('blur');
    }
  });

  it('puts Cancel on the left and the confirm on the right, the confirm on top and full width on a phone', () => {
    expect(ACTION_FOOTER).toContain('flex-col-reverse');
    expect(ACTION_FOOTER).toContain('sm:flex-row');
    expect(ACTION_FOOTER).toContain('sm:justify-end');
    expect(ACTION_FOOTER).toContain('gap-2');
  });

  it('builds every shared overlay primitive from the recipe, not a hand-typed shadow', () => {
    const want: Record<string, string[]> = {
      dialog: ['MODAL_SURFACE', 'SCRIM', 'ACTION_FOOTER'],
      sheet: ['SHEET_SURFACE', 'SHEET_MOTION', 'SCRIM', 'ACTION_FOOTER'],
      'alert-dialog': ['MODAL_SURFACE', 'SCRIM', 'ACTION_FOOTER'],
      'dropdown-menu': ['MENU_SURFACE', 'MENU_ITEM', 'MENU_ITEM_CHOSEN'],
      select: ['MENU_SURFACE', 'MENU_ITEM', 'MENU_ITEM_CHOSEN', 'MENU_CHEVRON'],
      popover: ['POPOVER_SURFACE'],
      tooltip: ['TOOLTIP_SURFACE'],
      'hover-card': ['POPOVER_SURFACE'],
    };
    for (const [file, names] of Object.entries(want)) {
      const src = readFileSync(join(ROOT, `src/components/ui/${file}.tsx`), 'utf8');
      for (const n of names) expect(src, `${file} uses ${n}`).toContain(n);
      expect(src, file).not.toMatch(/shadow-(lg|md)\b|0_18px_44px|bg-black\/80/);
    }
  });

  it('plays no overlay animation with the old 500ms scrim or the overshoot curve', () => {
    const sheet = readFileSync(join(ROOT, 'src/components/ui/sheet.tsx'), 'utf8');
    expect(sheet).not.toMatch(/duration-500|slide-in-from|animate-in/);
    const search = readFileSync(join(ROOT, 'src/components/SearchControl.tsx'), 'utf8');
    const shell = search.slice(search.indexOf('const dropdownShell'), search.indexOf('const sectionLabel'));
    expect(shell).not.toContain('cubic-bezier(0.34,1.56');
    expect(shell).toContain('overlay-enter-menu');
    expect(shell).toContain('shadow-menu');
  });
});
