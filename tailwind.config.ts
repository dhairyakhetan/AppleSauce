import type { Config } from "tailwindcss";

export default {
  /* micro-06-non-negotiables rule 6: "Hover effects are desktop-only; on touch
     the same state arrives on press instead." Without this flag Tailwind emits
     bare `:hover`, which a touch browser fires on tap and then LEAVES APPLIED
     until you tap something else — so a tapped teacher card stayed lifted and
     shadowed while you read it, and every `hover:-translate-y-0.5` on the site
     behaved as a sticky post-tap state rather than a hover.

     `hoverOnlyWhenSupported` wraps every hover: utility in
     @media (hover: hover), so they apply on a mouse and never on a finger. The
     `active:` states that carry the press feedback are untouched. One flag,
     because the alternative is hand-guarding several hundred call sites. */
  future: {
    hoverOnlyWhenSupported: true,
  },
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      /* Matches the DESIGN_SYSTEM.md §4 standard container:
         mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8 */
      padding: {
        DEFAULT: "1rem",
        sm: "1.5rem",
        lg: "2rem",
      },
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      /* Height-based variants. Tailwind ships width breakpoints only, but the
         axis that actually runs out on a full-screen takeover (the onboarding
         tour, the filter sheet) is height: a landscape phone is 740x380, and
         at 380px a layout tuned for width has nowhere to put anything. `short`
         is the point below which such a screen must re-lay-out rather than
         merely shrink. */
      screens: {
        short: { raw: "(max-height: 620px)" },
        "short-landscape": { raw: "(max-height: 560px) and (orientation: landscape)" },
      },
      fontFamily: {
        sans: ['Geist', 'system-ui', '-apple-system', 'sans-serif'],
        /* `serif` used to duplicate the sans stack verbatim — a lie, since
           nothing about it was serif. Repointed at the new display grotesk
           (task item #1) rather than removed: several later agents will want
           a `font-serif` escape hatch for "heavy display type" call sites
           that don't fit the tokenized `text-display-*` scale below (e.g. a
           one-off oversized numeral). Wide-heavy Archivo axis settings live
           on `fontFamily.display`; `serif` is a plain alias to the same
           family so both names resolve identically — pick `font-display` for
           new work, `font-serif` only exists for that escape-hatch case. */
        serif: ['Archivo', 'system-ui', '-apple-system', 'sans-serif'],
        /* VISUAL_LANGUAGE character layer — heavy expressive grotesk for
           display type only. Variable font, both axes (width 62-125,
           weight 100-900) loaded in index.html so `font-display font-black`
           (wght 900) and stretched/condensed variants are all reachable via
           arbitrary `[font-stretch:*]` if a later agent needs them. Body
           copy stays on `font-sans` (Geist) always — never use this for body
           text or long-form copy. */
        display: ['Archivo', 'system-ui', '-apple-system', 'sans-serif'],
      },
      colors: {
        /* Brand accents — DESIGN_SYSTEM.md §2. Accents, not surfaces. */
        brand: {
          DEFAULT: "hsl(var(--brand))",           // #FF8000
          foreground: "hsl(var(--brand-foreground))",
          hover: "hsl(var(--brand-hover))",
          subtle: "hsl(var(--brand-subtle))",     // #FFF4E8 — VISUAL_LANGUAGE §2.2 tint
          deep: "hsl(var(--brand-deep))",         // #B35900 — text-on-tint
        },
        "brand-blue": {
          DEFAULT: "hsl(var(--brand-blue))",      // #4351FF
          foreground: "hsl(var(--brand-blue-foreground))",
          hover: "hsl(var(--brand-blue-hover))",
          subtle: "hsl(var(--brand-blue-subtle))", // #EDEEFF — VISUAL_LANGUAGE §2.2 tint
          deep: "hsl(var(--brand-blue-deep))",     // #2E3AD6 — text-on-tint
        },

        /* Extended warm neutral scale — VISUAL_LANGUAGE.md §2.1. Roles the
           semantic tokens don't cover. Literal-hex vars, so no `/opacity`. */
        warm: {
          page: "var(--warm-page)",                       // #F9F5F1
          card: "var(--warm-card)",                       // #FCFAF7 (bone)
          muted: "var(--warm-muted)",                     // #F0EAE2
          band: "var(--warm-band)",                       // #F2ECE4 stripe band
          hairline: "var(--warm-hairline)",               // #E7DFD5
          "hairline-raised": "var(--warm-hairline-raised)", // #E4DCD2
          "hairline-strong": "var(--warm-hairline-strong)", // #D8CFC4

          /* Warm text ramp — VISUAL_LANGUAGE.md §2.1.
             ⚠ `secondary` / `meta` / `label` knowingly fail the 4.5:1 floor in
             DESIGN_SYSTEM.md §1.5. That is an owner-approved exception, not a
             bug — see the long note at the token definitions in index.css.
             Do not darken them.
               text-warm-prose      #4A443E  long-form body copy
               text-warm-secondary  #7B736B  secondary text (== muted-foreground)
               text-warm-meta       #8B837A  card meta
               text-warm-label      #A39A90  uppercase labels           */
          prose: "var(--text-prose)",
          secondary: "var(--text-secondary)",
          meta: "var(--text-tertiary)",
          label: "var(--text-quaternary)",
        },
        /* Near-black slab / footer — VISUAL_LANGUAGE.md §2.1. */
        panel: "var(--panel-dark)",                       // #1B1A18
        /* Mint stat-card fill — VISUAL_LANGUAGE.md §8. */
        mint: "var(--mint)",                              // #E3F7EC
        "mint-solid": "var(--mint-solid)",                // #34B268 — AU-004a hero E
        "peach-tint": "var(--peach-tint)",                // #FCECDE

        /* Facet/status accents promoted from searchFacets.ts — see index.css
           for the collision notes on facet-destructive vs destructive, and
           surface-panel-light vs panel. */
        success: {
          DEFAULT: "var(--success)",
          "subtle-bg": "var(--success-subtle-bg)",
          "subtle-text": "var(--success-subtle-text)",
        },
        whatsapp: {
          DEFAULT: "var(--whatsapp)",
          text: "var(--whatsapp-text)",
        },
        "indigo-link-on-dark": "var(--indigo-link-on-dark)",
        "facet-destructive": "var(--facet-destructive)",
        "surface-panel-light": "var(--surface-panel-light)",

        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      /* DESIGN_SYSTEM.md §5: rounded-lg (controls), rounded-2xl (cards/panels),
         rounded-full (pills/avatars). `full` comes from the Tailwind defaults,
         which `extend` merges with — do not redefine it. */
      borderRadius: {
        lg: "var(--radius)",   // 0.75rem
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        "2xl": "1rem",
        "3xl": "1.5rem",
        /* VISUAL_LANGUAGE.md §1.1/§6 — 32px, the saturated slabs only. */
        "4xl": "2rem",
        /* Handoff T-001 — bento stack panels, 30px, between the 20px card
           and the 32px slab. */
        bento: "1.875rem",
      },
      /* DESIGN_SYSTEM.md §5: depth comes from these, never border + shadow. */
      boxShadow: {
        border: "var(--shadow-border)",
        "border-hover": "var(--shadow-border-hover)",
        /* VISUAL_LANGUAGE.md §2.2 / §8 — coloured glows and the two
           special stat-card shadows. Saturated surfaces only. */
        "glow-brand": "var(--shadow-glow-brand)",
        "glow-brand-blue": "var(--shadow-glow-brand-blue)",
        "glow-brand-tight": "var(--shadow-glow-brand-tight)",
        "glow-brand-blue-tight": "var(--shadow-glow-brand-blue-tight)",
        "card-bone": "var(--shadow-card-bone)",
        "card-mint": "var(--shadow-card-mint)",
        pill: "var(--shadow-pill)",
      },
      /* ---- Unified type scale (task #2) -------------------------------------
         ONE scale, as real fontSize tokens (each entry: [size, {lineHeight,
         letterSpacing}]). Replaces BOTH prior systems:
           - DESIGN_SYSTEM.md §3's Tailwind-class scale (text-4xl font-semibold
             tracking-tight, etc.) — those classes still work, but new code
             should prefer the named tokens below so tracking/leading travel
             with the size instead of being re-typed at every call site.
           - VISUAL_LANGUAGE.md §4's arbitrary clamp()-in-inline-style scale
             (`style={{ fontSize: 'clamp(34px,5.6vw,66px)' }}`) — every one of
             those clamps is reproduced here verbatim as a token, so no call
             site ever needs an inline style for type again.

         Mapping old -> new (mechanical migration for later agents):
           DESIGN_SYSTEM §3 "Display (hero h1)"      -> text-display-hero
           DESIGN_SYSTEM §3 "Page title (h1)"        -> text-page-title
           DESIGN_SYSTEM §3 "Section (h2)"           -> text-section-head
           DESIGN_SYSTEM §3 "Subsection (h3)"        -> text-subsection
           DESIGN_SYSTEM §3 "Card title (h4)"        -> text-card-title
           DESIGN_SYSTEM §3 "Body"                   -> text-body
           DESIGN_SYSTEM §3 "Secondary body"         -> text-body-secondary
           DESIGN_SYSTEM §3 "Meta / caption"         -> text-meta
           DESIGN_SYSTEM §3 "Label / eyebrow"        -> text-label (pair with
                                                         uppercase tracking-wide
                                                         font-semibold utility
                                                         classes as before)
           VISUAL_LANGUAGE §4 "Home H1"              -> text-display-hero
                                                         (same clamp(34px,5.6vw,66px))
           VISUAL_LANGUAGE §4 "Section H2"           -> text-section-head
                                                         (same clamp(23px,3vw,34px))
           VISUAL_LANGUAGE §4 "Subject card name"    -> text-card-title-lg (23px)
           VISUAL_LANGUAGE §4 "Paper card title"     -> text-card-title-lg
                                                         (20-21px, use the 21px token)
           VISUAL_LANGUAGE §4 "Lede paragraph"       -> text-lede (17px)
           VISUAL_LANGUAGE §4 "Body" (15px)          -> text-body-secondary
           VISUAL_LANGUAGE §4 "Card meta" (13.5px)   -> text-meta
           VISUAL_LANGUAGE §4 "Uppercase label"      -> text-label (11.5px, use
                                                         with the .label-uppercase
                                                         utility in index.css for
                                                         the 0.04em tracking + 700)

         Display sizes get tight negative tracking per the task brief. Fluid
         sizes use clamp() so they're tokenized AND responsive — no arbitrary
         values needed at call sites. Non-fluid sizes (card title, body, meta,
         label) come from the exact VISUAL_LANGUAGE §4 px values since those
         were never meant to be fluid. */
      fontSize: {
        /* Solved so the clamp hits the handoff endpoints exactly rather than
           being eyeballed: 40px at 390 (2a) and 86px at 1440 (design.md §5).
           Was 34..66, which computed 35.4px on a 390 phone — the hero read a
           full size smaller than drawn. */
        "display-hero": ["clamp(2.5rem, 1.4321rem + 4.381vw, 5.375rem)", { lineHeight: "0.96", letterSpacing: "-0.04em" }],
        "page-title": ["clamp(1.75rem, 1.55rem + 1vw, 2.5rem)", { lineHeight: "1.05", letterSpacing: "-0.025em" }],
        /* 27px at 390, 46px at 1440, per the numbered-heading spec. Was
           23..34, so section heads sat a size under the drawing at both ends. */
        "section-head": ["clamp(1.6875rem, 1.2464rem + 1.810vw, 2.875rem)", { lineHeight: "1", letterSpacing: "-0.04em" }],
        subsection: ["1.125rem", { lineHeight: "1.3", letterSpacing: "-0.01em" }],
        "card-title": ["1rem", { lineHeight: "1.35", letterSpacing: "-0.01em" }],
        "card-title-lg": ["1.4375rem", { lineHeight: "1.15", letterSpacing: "-0.04em" }],
        lede: ["1.0625rem", { lineHeight: "1.55", letterSpacing: "0" }],
        body: ["1rem", { lineHeight: "1.5", letterSpacing: "0" }],
        "body-secondary": ["0.9375rem", { lineHeight: "1.6", letterSpacing: "0" }],
        /* 14px, was 13.5px. */
        meta: ["0.875rem", { lineHeight: "1.4", letterSpacing: "0" }],
        /* 12px, was 11.5px. Uppercase at 11.5 was the smallest type on the
           site and the hardest to read on a phone, so this is the one merge
           here that is an accessibility improvement as well as a tidy-up. */
        label: ["0.75rem", { lineHeight: "1.2", letterSpacing: "0.04em" }],

        /* ---- The sizes the product actually uses ------------------------
           Measured, not guessed: 607 arbitrary `text-[Npx]` values across 43
           distinct sizes. The semantic ramp above covers 11.5/13.5/15/16/17/
           18/23, but the codebase keeps reaching for sizes it does not have —
           14px appears 65 times, 13px 48, 14.5px 59, 12.5px 44. That is a gap
           in the scale, not 500 mistakes.

           DELIBERATELY SIZE-ONLY, with no paired lineHeight or letterSpacing.
           The semantic tokens above carry metrics, so swapping `text-[14px]`
           for a metric-carrying token would change line-height on every call
           site that does not set its own `leading-` — 154 of them. These are
           declared bare so `text-[14px]` -> `text-14` is a byte-for-byte
           no-op, which is the whole point of adding them.

           The half-pixel rungs -- 12.5, 14.5, 15.5 -- were removed along with
           the 230 arbitrary half-pixel call sites they existed to catch. They
           had no usages left, and a scale that offers 14 AND 14.5 invites the
           drift it was meant to stop.

           For NEW work prefer the semantic tokens above: they carry the
           metrics and say what the text is for. These exist so existing
           arbitrary values have somewhere to land, and so the next person
           reaching for 14px finds a token instead of typing brackets. */
        "10": "0.625rem",
        "11": "0.6875rem",
        "12": "0.75rem",
        "13": "0.8125rem",
        "14": "0.875rem",
        "19": "1.1875rem",
        "20": "1.25rem",
        "21": "1.3125rem",
        "22": "1.375rem",
        "24": "1.5rem",
        "26": "1.625rem",
      },
      /* ---- Spacing (task #5) -------------------------------------------------
         DESIGN_SYSTEM.md §4 only ever *documented* an allowed step list
         (1,2,3,4,6,8,12,16,20,24); nothing in config enforced it, so `p-5` /
         `gap-7` / arbitrary `[13px]` values still typecheck and build fine —
         they always did, because those are just core Tailwind spacing scale
         entries that were never removed. This does NOT add new spacing steps
         (the documented list is already 1:1 with Tailwind's default scale, so
         there is nothing to "add" as tokens) — it narrows `spacing` to expose
         ONLY the approved steps plus the values components already depend on
         (0, px, full, and the fractional/percentage keys Tailwind ships by
         default for flex/grid utilities), which is the closest this file can
         get to making the rule mechanically enforceable. NOTE: this still
         does not block arbitrary bracket values like `p-[13px]` — Tailwind's
         arbitrary-value syntax bypasses the `spacing` theme key entirely by
         design. That half of the rule genuinely needs a lint rule (e.g. an
         eslint-plugin-tailwindcss rule or a stylelint regex over the built
         class list), which is out of scope for this token layer. */
      spacing: {
        0: "0px",
        px: "1px",
        1: "0.25rem",
        2: "0.5rem",
        3: "0.75rem",
        4: "1rem",
        /* Handoff T-002 — the 6px seam between stacked bento panels. */
        seam: "0.375rem",
        6: "1.5rem",
        8: "2rem",
        12: "3rem",
        16: "4rem",
        20: "5rem",
        24: "6rem",
      },
      /* ---- Motion vocabulary (task #4) --------------------------------------
         Named duration/easing tokens so components stop hand-rolling
         `transition-colors duration-150`. Values chosen to match what's
         already in use across the app (150ms colour/press transitions per
         DESIGN_SYSTEM.md §6, 200-300ms for lift/elevation, the §7
         cubic-bezier(.16,1,.3,1) "settle" curve already used by fade-slide-up/
         card-reveal/hero-swap/fan-in). Reach for `duration-tap` /
         `duration-hover` / `ease-settle` etc. instead of typing raw ms values.
         `--duration-tap` / `--duration-hover` are also exposed on the
         CSS-variable layer in index.css so the same numbers are usable
         outside Tailwind's transition-duration utility (e.g. inside a
         @keyframes % step or a JS spring config). */
      transitionDuration: {
        tap: "150ms",
        hover: "200ms",
        lift: "300ms",
        pop: "400ms",
        entrance: "500ms",
        /* CRAFT.md §2: "exits are softer and shorter than enters" — every
           `duration-entrance` (500ms) an element enters with should exit
           faster than it arrived. 130ms sits under `tap` (150ms), the
           shortest duration already in use, so an exit never reads as
           slower than a press. */
        exit: "130ms",
      },
      transitionTimingFunction: {
        /* Handoff M-001: the same curve as `settle` above, under the name
           the motion-and-animation spec uses ("ease-snap"). Added rather
           than renaming `settle` — that name is already load-bearing on
           fade-slide-up/card-reveal/hero-swap/fan-in and other consumers
           across the app; `ease-out` (Tailwind's built-in) is the spec's
           other curve and needs no addition. */
        snap: "cubic-bezier(0.16, 1, 0.3, 1)",
        settle: "cubic-bezier(0.16, 1, 0.3, 1)",
        tap: "ease-out",
        pop: "cubic-bezier(0.34, 1.56, 0.64, 1)",
      },
      /* DESIGN_SYSTEM.md §6 — permitted motion ONLY. The other 27
         keyframes/animations (scale-pop, blur-reveal, glow-pulse, icon-spin,
         stagger-fade-up, slide-in-left/right, chip-slide, count-up,
         badge-bounce, icon-bounce, avatar-reveal, ring-pulse, stat-reveal,
         underline-grow, slide-down-fade, tab-switch, rating-star-fill,
         progress-fill, testimonial-slide, float-subtle, pulse-ring,
         slide-up-full, fade-in, slide-up, width-expand) were removed after
         verifying with grep that no file under src/ references them.
         Do not re-add. Hover/press are transitions, not animations. */
      keyframes: {
        /* One-shot hint that a rail scrolls: it drifts left and settles back,
           the way a thumbed page does. Small (6px) and single-pass — a looping
           twitch reads as a broken animation rather than an invitation. */
        /* Pull-to-refresh (fun-03.png, F3). "One soft bounce" on release —
           overshoots past 1 and settles, a single pass, not a loop. */
        "pull-bounce": {
          "0%": { transform: "scale(1)" },
          "40%": { transform: "scale(1.12)" },
          "70%": { transform: "scale(0.97)" },
          "100%": { transform: "scale(1)" },
        },
        /* "Pill pulses twice" while the real refresh is in flight. */
        "pull-pulse": {
          "0%, 100%": { transform: "scale(1)", opacity: "1" },
          "25%": { transform: "scale(1.08)", opacity: "0.85" },
          "50%": { transform: "scale(1)", opacity: "1" },
          "75%": { transform: "scale(1.08)", opacity: "0.85" },
        },
        "rail-nudge": {
          "0%, 100%": { transform: "translateX(0)" },
          "40%": { transform: "translateX(-6px)" },
        },
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        fadeSlideUp: {
          from: { opacity: "0", transform: "translateY(24px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        /* Handoff M-012: the product tour's step change — its own 10px
           travel distance, distinct from fadeSlideUp's 24px, so kept as a
           separate keyframe rather than overloading that one's value. */
        tourStepIn: {
          from: { opacity: "0", transform: "translateY(10px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        /* Handoff M-013: the welcome screen's five sticker pills. Its own 6px
           travel, distinct from tourStepIn's 10px and fadeSlideUp's 24px —
           kept separate for the same reason tourStepIn is. */
        stickerIn: {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        /* M-013: the panel itself only fades — it does not travel. */
        panelFade: {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        cardReveal: {
          from: { opacity: "0", transform: "translateY(20px) scale(0.97)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        /* Browse's result grid: a real fetch (up to a few seconds) lands the
           whole page of cards at once, and cardReveal's plain fade/scale made
           that read as a single flat pop rather than results settling in.
           blur→sharp is what reads as "arriving" rather than "appearing" —
           same idea as blurSwap, shorter travel since a grid card is a much
           smaller element than a hero line. */
        cardBlurIn: {
          from: { opacity: "0", filter: "blur(6px)", transform: "translateY(10px)" },
          to: { opacity: "1", filter: "blur(0px)", transform: "translateY(0)" },
        },
        shimmer: {
          from: { "background-position": "-200% 0" },
          to: { "background-position": "200% 0" },
        },

        /* ---- VISUAL_LANGUAGE.md §7 additions to the whitelist -------------
           These four, and only these four, join the contract's §6 list.
           `heroSwap` previously lived as a bare @keyframes in index.css with
           no utility attached to it; it has been moved here (same values) so
           there is one definition and a real `animate-hero-swap` class. */
        heroSwap: {
          from: { opacity: "0", filter: "blur(9px)", transform: "translateY(14px)" },
          to: { opacity: "1", filter: "blur(0)", transform: "translateY(0)" },
        },
        sparkle: {
          "0%, 100%": { opacity: "0", transform: "scale(0.5) rotate(0deg)" },
          "45%": { opacity: "0.95", transform: "scale(1) rotate(45deg)" },
        },
        /* `to: none` is the literal §7 value and is intentional. It clears
           only THIS element's entrance transform; the §8 per-card tilt lives
           on a parent wrapper and survives. Never put a rotation on the same
           element as `animate-fan-in`. */
        fanIn: {
          from: { opacity: "0", transform: "translateY(18px) rotate(0deg) scale(0.94)" },
          to: { opacity: "1", transform: "none" },
        },
        /* `bob` writes translateY only, so it composes with a tilt applied on
           a PARENT element — that is how the §8 stat cluster is built (see the
           three-element structure documented in index.css). `--bob-rotate` is
           an escape hatch for the case where rotation and float must share one
           element; leave it unset on the stat cards. Defaults to 0deg. */
        bob: {
          "0%, 100%": { transform: "translateY(0) rotate(var(--bob-rotate, 0deg))" },
          "50%": { transform: "translateY(-9px) rotate(var(--bob-rotate, 0deg))" },
        },

        /* ---- Motion vocabulary additions (task #4) -------------------------
           `pop` — sticker/badge appearance matching the reference energy: a
           slight overshoot scale-in, using the new `pop` easing token above.
           Pairs with `.sticker` / `.tape-*` utilities in index.css. Finite,
           not ambient — safe to use anywhere, no desktop-only guard needed. */
        pop: {
          from: { opacity: "0", transform: "scale(0.8)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        /* The mobile search bar detaching from the page and settling as a
           pinned sheet. Deliberately shallower than `pop`: a full-bleed bar
           scaling from 0.8 reads as a zoom, where a 3% lift with overshoot
           reads as the bar coming forward. */
        /* Copy that changes subject rather than merely re-entering: the hero
           headline and its eyebrow swapping between teachers and past papers.
           The blur is what sells it as the same line re-focusing on something
           else, where a plain fade reads as two unrelated lines. */
        blurSwap: {
          from: { opacity: "0", filter: "blur(10px)", transform: "translateY(8px)" },
          to: { opacity: "1", filter: "blur(0px)", transform: "translateY(0)" },
        },
        /* One-shot blink for the hero's linked name. The line names something
           you can go to, and with no underline nothing said so; a single blink
           as the page settles points at it once and then leaves it alone. */
        heroBlink: {
          "0%, 100%": { opacity: "1" },
          "18%, 58%": { opacity: "0.4" },
          "38%, 78%": { opacity: "1" },
        },
        searchPop: {
          from: { opacity: "0", transform: "translateY(-8px) scale(0.97)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        /* PaperResults' result-count landing: a once-only glow under the
           count tag in `--count-glow-color` (set inline from the active
           subject's real palette solid, via getSubjectPalette — never a new
           color). Rises and fully fades, no loop, so a page with a real
           strong match count reads as a small win rather than inert text. */
        countGlow: {
          "0%, 100%": { boxShadow: "0 0 0 0 transparent" },
          "35%": { boxShadow: "0 3px 10px -2px var(--count-glow-color, transparent)" },
        },
        /* CornerMascot's sleeping "Zzz" — opacity/transform only, per CRAFT.md
           §2. Ambient and infinite, but only ever mounted inside the mascot's
           own `hidden lg:flex` root, so — like `sparkle`/`bob` above — it
           never reaches a phone. */
        zFloat: {
          "0%": { opacity: "0", transform: "translateY(0)" },
          "18%": { opacity: "1" },
          "75%": { opacity: "1" },
          "100%": { opacity: "0", transform: "translateY(-13px)" },
        },
        /* The papers route on /admin/pipeline (docs/CRAFT.md §8). A parcel
           travels one lane: opacity and transform only. --lane-len is the
           lane's length, set on the lane; --route-dur is how long a crossing
           takes, set from the count flowing through it. */
        routeDotY: {
          "0%": { opacity: "0", transform: "translateY(0)" },
          "15%, 85%": { opacity: "1" },
          "100%": { opacity: "0", transform: "translateY(calc(var(--lane-len, 2rem) - 0.5rem))" },
        },
        routeDotX: {
          "0%": { opacity: "0", transform: "translateX(0)" },
          "15%, 85%": { opacity: "1" },
          "100%": { opacity: "0", transform: "translateX(calc(var(--lane-len, 2.25rem) - 0.5rem))" },
        },
        /* The dashed elbow between the two rows: the dashes march along it. */
        routeDash: {
          to: { strokeDashoffset: "-12" },
        },
      },
      animation: {
        "route-dot-y": "routeDotY var(--route-dur, 5s) linear infinite",
        "route-dot-x": "routeDotX var(--route-dur, 5s) linear infinite",
        "route-dash": "routeDash calc(var(--route-dur, 5s) / 5) linear infinite",
        "rail-nudge": "rail-nudge 0.9s cubic-bezier(0.16, 1, 0.3, 1) 1",
        "pull-bounce": "pull-bounce 0.26s cubic-bezier(0.34, 1.56, 0.64, 1) 1",
        /* Exactly two pulses, once — not a loop, since "refreshing" is a
           finite state that ends when the list re-enters. Duration matches
           MIN_REFRESHING_MS in use-pull-to-refresh.ts so the animation is
           never cut off mid-pulse by a fast-resolving refetch. */
        "pull-pulse": "pull-pulse 0.8s ease-in-out 1",
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-slide-up": "fadeSlideUp 0.5s cubic-bezier(0.16, 1, 0.3, 1) both",
        "tour-step-in": "tourStepIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) both",
        "sticker-in": "stickerIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) both",
        "panel-fade": "panelFade 0.5s cubic-bezier(0.16, 1, 0.3, 1) both",
        "card-reveal": "cardReveal 0.45s cubic-bezier(0.16, 1, 0.3, 1) both",
        "count-glow": "countGlow 0.6s cubic-bezier(0.16, 1, 0.3, 1) 1",
        "card-blur-in": "cardBlurIn 0.4s cubic-bezier(0.16, 1, 0.3, 1) both",
        shimmer: "shimmer 1.5s ease-in-out infinite",

        /* VISUAL_LANGUAGE.md §7. `sparkle` and `bob` are ambient infinite
           loops and are DESKTOP-ONLY — index.css hard-disables them below
           1024px so they can never run on a mid-range Android phone. */
        "hero-swap": "heroSwap 0.5s cubic-bezier(0.16, 1, 0.3, 1) both",
        sparkle: "sparkle 2.6s ease-in-out infinite",
        "fan-in": "fanIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) both",
        bob: "bob 6s ease-in-out infinite",

        /* Task #4 addition. Use with an `animation-delay` utility (Tailwind
           core supports `[animation-delay:80ms]`) per staggered list item for
           entrance choreography — see the `.stagger-children` utility in
           index.css for a no-JS way to stagger a list/grid's direct children
           automatically without hand-writing a delay per item. */
        pop: "pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) both",
        "search-pop": "searchPop 0.34s cubic-bezier(0.34, 1.56, 0.64, 1) both",
        "blur-swap": "blurSwap 0.42s cubic-bezier(0.16, 1, 0.3, 1) both",
        "hero-blink": "heroBlink 1.15s ease-in-out 0.55s 1 both",
        "z-float": "zFloat 2.4s cubic-bezier(0.16, 1, 0.3, 1) infinite",
      },
    },
  },
  /* Tailwind loads this config through its own CJS pipeline, so require()
     is the working form here and an ESM import is not a safe swap. */
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
