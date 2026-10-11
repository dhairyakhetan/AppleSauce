import type { ReactNode } from 'react';
import { Heart } from 'lucide-react';
import { WhatsAppIcon } from '@/components/BrandIcons';
import { getSubjectPalette } from '@/lib/subject-palette';
import { firstNameOf, type AuthIntent } from '@/lib/auth-intent';

/* Handoff AU-004a — the eight auth heroes (variants A–H of
   `Auth Redesign.dc.html`). Fill, eyebrow, sentence and sticker cluster all
   follow the intent that opened the gate; the near-black sign-in block below
   never changes shape, only its sub-line and value-note copy.

   ⚠ Every interpolated value here is real or the variant is not used: the
   resolver falls back to `default` rather than render a hero with a blank in
   it, and `auth-intent.ts` validates the same fields on write and on read. */

export interface AuthHeroCounts {
  /** Real published paper count, for variant A's third pill. */
  papers?: number | null;
  /** Locally-known saved-teacher / opened-paper counts, for variant F. */
  savedTeachers?: number | null;
  papersOpened?: number | null;
}

type Ink = {
  /** Hero block fill. */
  fill: string;
  /** Body ink on that fill. */
  text: string;
  /** The highlighted span: a block of the opposite value. */
  markBg: string;
  markText: string;
  /** Eyebrow + "Skip" ink — the same hue at 60%. */
  quiet: string;
  /** The logo needs inverting on the two dark fills. */
  onDark: boolean;
};

/* Ink per fill. The spec spells out brand / whatsapp / brand-blue; the other
   four follow the same rule it establishes — body ink is the readable
   extreme of the fill, and the highlight block is its inverse.

   The spec says "the logo inverts to white only on the indigo fill". That is
   true of the three fills it enumerates, but variant G is `bg-panel`
   (#1B1A18) and a dark logo on near-black is invisible, so `onDark` is set
   from the fill's own value rather than from the intent name. */
const BRAND_INK: Ink = {
  fill: 'bg-brand', text: 'text-[#1F1F1F]',
  markBg: 'bg-panel', markText: 'text-[#FCFAF7]',
  quiet: 'text-[rgba(31,31,31,.6)]', onDark: false,
};
const WHATSAPP_INK: Ink = {
  fill: 'bg-whatsapp', text: 'text-whatsapp-text',
  markBg: 'bg-[#0B3D1F]', markText: 'text-[#FCFAF7]',
  quiet: 'text-[rgba(11,61,31,.65)]', onDark: false,
};
const INDIGO_INK: Ink = {
  fill: 'bg-brand-blue', text: 'text-white',
  markBg: 'bg-[#FCFAF7]', markText: 'text-brand-blue-deep',
  quiet: 'text-[rgba(255,255,255,.7)]', onDark: true,
};
const MINT_INK: Ink = {
  fill: 'bg-mint-solid', text: 'text-[#0B3D1F]',
  markBg: 'bg-[#0B3D1F]', markText: 'text-[#FCFAF7]',
  quiet: 'text-[rgba(11,61,31,.65)]', onDark: false,
};
const BONE_INK: Ink = {
  fill: 'bg-card', text: 'text-foreground',
  markBg: 'bg-panel', markText: 'text-[#FCFAF7]',
  quiet: 'text-warm-secondary', onDark: false,
};
const PANEL_INK: Ink = {
  fill: 'bg-panel', text: 'text-[#FCFAF7]',
  markBg: 'bg-card', markText: 'text-foreground',
  quiet: 'text-[rgba(249,245,241,.65)]', onDark: true,
};
const MUTED_INK: Ink = {
  fill: 'bg-muted', text: 'text-foreground',
  markBg: 'bg-panel', markText: 'text-[#FCFAF7]',
  quiet: 'text-warm-secondary', onDark: false,
};

export interface AuthHero {
  ink: Ink;
  eyebrow: string;
  /** The h1. `mark` is the highlighted span; lines break exactly as drawn. */
  sentence: ReactNode;
  /** Single-line 36px headline (variant H only). */
  compact?: boolean;
  stickers: ReactNode;
  /** First element of the dark block. */
  subline: string;
  /** AU-007 value note. */
  /** Value-note tile colour follows intent: green, orange or indigo. */
}

/* `break-words` matters here: variant D interpolates a real paper title, and a
   long one ("Mathematics Prelim Paper …") made this inline-block wider than
   the hero's content column. With the `-mx-[6px]` bleed on top, that pushed
   the whole document past the viewport at 320px. */
const Mark = ({ ink, children }: { ink: Ink; children: ReactNode }) => (
  <span className={`inline-block -mx-[6px] max-w-full break-words rounded-[10px] px-[6px] font-black ${ink.markBg} ${ink.markText}`}>
    {children}
  </span>
);

/** The stickers sit in a fixed-height well so the sign-in block below never
    moves between variants. Rotations are dropped for reduced motion and at
    lg, matching the existing cluster. */
const Well = ({ h, children }: { h: number; children: ReactNode }) => (
  <div className="relative mt-5" style={{ height: h }} aria-hidden="true">{children}</div>
);

const TILT = 'motion-reduce:rotate-0 lg:rotate-0';
const LIFT = 'shadow-[0_6px_18px_rgba(0,0,0,.10)]';

/** A fragment of the teacher's own card — the same identity the visitor was
    looking at when the gate opened, so the hero is visibly about them. */
function TeacherFragment({ name, subject, area }: { name: string; subject: string; area: string }) {
  const palette = getSubjectPalette(subject);
  return (
    <span className={`absolute left-0 top-0 flex max-w-full items-center gap-3 rounded-[18px] bg-card p-3 -rotate-3 ${TILT} ${LIFT}`}>
      <span
        className="flex h-11 w-11 flex-none items-center justify-center rounded-[14px] font-display text-[17px] font-extrabold"
        style={{ backgroundColor: palette.tint, color: palette.text }}
      >
        {name.slice(0, 1).toUpperCase()}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[15px] font-bold text-foreground">{name}</span>
        <span className="block truncate text-[13px] text-warm-meta">{subject} · {area}</span>
      </span>
    </span>
  );
}

const Pill = ({ className, style, children }: { className: string; style?: React.CSSProperties; children: ReactNode }) => (
  <span className={`inline-flex h-9 items-center whitespace-nowrap rounded-full px-4 text-[14px] font-extrabold ${LIFT} ${className}`} style={style}>
    {children}
  </span>
);

export function resolveAuthHero(intent: AuthIntent, counts: AuthHeroCounts): AuthHero {
  switch (intent.kind) {
    /* B — the visitor tapped "Message on WhatsApp" on a teacher. */
    case 'whatsapp': {
      const first = firstNameOf(intent.teacherName);
      const palette = getSubjectPalette(intent.subject);
      return {
        ink: WHATSAPP_INK,
        eyebrow: `One step from ${first}`,
        sentence: (<>Sign in, then<br /><Mark ink={WHATSAPP_INK}>message {first}</Mark><br />on WhatsApp.</>),
        stickers: (
          <Well h={120}>
            <TeacherFragment name={intent.teacherName} subject={intent.subject} area={intent.area} />
            {intent.fee ? (
              <span className="absolute bottom-0 right-[6%]">
                <Pill className={`rotate-[5deg] ${TILT}`} style={{ backgroundColor: palette.tint, color: palette.text }}>
                  {intent.fee}
                </Pill>
              </span>
            ) : (
              <span className={`absolute bottom-0 right-[6%] flex h-9 w-9 rotate-[5deg] items-center justify-center rounded-full bg-whatsapp text-whatsapp-text ring-2 ring-white/70 ${TILT} ${LIFT}`}>
                <WhatsAppIcon className="h-4 w-4" />
              </span>
            )}
          </Well>
        ),
        subline: "We'll take you straight to the chat",
      };
    }

    /* C — the visitor tapped the heart on a teacher. */
    case 'save': {
      const first = firstNameOf(intent.teacherName);
      return {
        ink: BRAND_INK,
        eyebrow: 'Keep your shortlist',
        /* The spec writes the mark as "keep her/him". We do not store a
           teacher's gender anywhere, and guessing it from a name would be
           wrong as often as it was right, so the line keeps the same shape
           and length without asserting one. */
        sentence: (<>Save {first},<br /><Mark ink={BRAND_INK}>keep them</Mark><br />for later.</>),
        stickers: (
          <Well h={120}>
            <TeacherFragment name={intent.teacherName} subject={intent.subject} area={intent.area} />
            <span className={`absolute bottom-0 right-[6%] inline-flex h-9 items-center gap-2 rounded-full bg-panel px-4 text-[14px] font-extrabold text-[#FCFAF7] rotate-[5deg] ${TILT} ${LIFT}`}>
              <Heart className="h-4 w-4 fill-current" aria-hidden="true" />
              Saved
            </span>
          </Well>
        ),
        subline: `Sign in and we'll add ${first} to your saved teachers`,
      };
    }

    /* D — the visitor tapped a locked paper. */
    case 'paper': {
      const palette = getSubjectPalette(intent.subjectSlug);
      return {
        ink: INDIGO_INK,
        eyebrow: 'One step from the paper',
        sentence: (<>Sign in to<br /><Mark ink={INDIGO_INK}>open {intent.title}</Mark>.</>),
        stickers: (
          <Well h={120}>
            <span
              className={`absolute left-0 top-0 flex h-[98px] w-[76px] flex-col justify-end rounded-[10px] p-2 -rotate-6 ${TILT} ${LIFT}`}
              style={{ backgroundColor: palette.tint, color: palette.text }}
            >
              <span className="text-label font-bold uppercase">{intent.board}</span>
            </span>
            <span className="absolute left-[96px] top-[14px] max-w-[calc(100%-96px)]">
              <Pill className="truncate bg-card text-foreground">{intent.school}</Pill>
            </span>
            <span className="absolute bottom-[6px] left-[96px]">
              <Pill className="bg-brand-blue-subtle text-brand-blue-deep">Free to read</Pill>
            </span>
          </Well>
        ),
        subline: 'Sign in once and the paper opens',
      };
    }

    /* E — the visitor tapped "Write a review". */
    case 'review':
      return {
        ink: MINT_INK,
        eyebrow: `Review ${intent.teacherName}`,
        sentence: (<>Say how the<br /><Mark ink={MINT_INK}>classes went</Mark><br />for you.</>),
        stickers: (
          <Well h={120}>
            <TeacherFragment name={intent.teacherName} subject={intent.subject} area={intent.area} />
            <span className="absolute bottom-0 right-[4%]">
              <Pill className={`rotate-[4deg] bg-mint text-[#24603D] ${TILT}`}>Your name, or anonymous</Pill>
            </span>
          </Well>
        ),
        subline: 'Sign in so we know the review is real',
      };

    /* F — the visitor tried to reach their own account. */
    case 'dashboard': {
      const t = counts.savedTeachers ?? 0;
      const p = counts.papersOpened ?? 0;
      return {
        ink: BONE_INK,
        eyebrow: 'Your shelf',
        sentence: (<>Your saved<br /><Mark ink={BONE_INK}>teachers are</Mark><br />still here.</>),
        stickers: (
          <Well h={104}>
            <span className="absolute left-0 top-1 flex items-center">
              <span className="flex">
                {['bg-brand', 'bg-brand-blue', 'bg-whatsapp'].map((bg, i) => (
                  <span key={bg} className={`flex h-10 w-10 items-center justify-center rounded-full ring-2 ring-card ${bg}`} style={{ marginLeft: i === 0 ? 0 : -14 }} />
                ))}
              </span>
              {/* Saved teachers live in Supabase (`liked_teachers`), so while
                  the visitor is signed out these counts are genuinely unknown
                  — and the spec forbids a hero with a placeholder in it. The
                  line is therefore omitted rather than guessed; the avatar
                  cluster and the "Nothing was lost" pill carry the variant on
                  their own. Auth.tsx passes nothing here today; the props
                  exist so a real count can be shown the moment one is known. */}
              {t > 0 || p > 0 ? (
                <span className="ml-3 text-[14px] font-bold text-foreground">
                  {t} {t === 1 ? 'teacher' : 'teachers'}, {p} {p === 1 ? 'paper' : 'papers'}
                </span>
              ) : null}
            </span>
            <span className="absolute bottom-0 left-0">
              <Pill className="bg-muted text-foreground">Nothing was lost</Pill>
            </span>
          </Well>
        ),
        subline: 'Sign in with the same account and it all comes back',
      };
    }

    /* G — the visitor is applying to be listed. */
    case 'teacher':
      return {
        ink: PANEL_INK,
        eyebrow: 'Teaching on Shikshaq',
        sentence: (<>List yourself.<br /><Mark ink={PANEL_INK}>Keep every</Mark><br />rupee you charge.</>),
        stickers: (
          <Well h={120}>
            <span className="absolute left-0 top-0"><Pill className={`-rotate-2 bg-brand text-[#1F1F1F] ${TILT}`}>No listing fee</Pill></span>
            <span className="absolute right-[4%] top-[46px]"><Pill className={`rotate-[3deg] bg-card text-foreground ${TILT}`}>No commission</Pill></span>
            <span className="absolute bottom-0 left-[8%]"><Pill className={`-rotate-1 bg-white/10 text-[#FCFAF7] ${TILT}`}>~3 days to review</Pill></span>
          </Well>
        ),
        subline: 'Sign in to start your application',
      };

    /* H — a staff redirect. Nothing here may look promotional. */
    case 'admin':
      return {
        ink: MUTED_INK,
        eyebrow: 'Staff access',
        compact: true,
        sentence: (<>Shikshaq admin</>),
        stickers: (
          <Well h={52}>
            <span className="absolute left-0 top-0">
              <Pill className="bg-card text-foreground shadow-none">Approvals · Papers · Audit</Pill>
            </span>
          </Well>
        ),
        subline: 'Sign in with your staff account',
      };

    /* A — the default. Explicitly NOT counts: three pills naming what the
       account unlocks. */
    default: {
      const papers = counts.papers ?? 0;
      const rows: Array<[string, string, string]> = [
        ['bg-whatsapp', 'Message teachers on WhatsApp', '-rotate-[1.5deg]'],
        ['bg-brand', 'Keep a shortlist of teachers', 'rotate-[1deg]'],
        ['bg-brand-blue', papers > 0 ? `Open all ${papers.toLocaleString("en-IN")} past papers` : 'Open every past paper', '-rotate-1'],
      ];
      return {
        ink: BRAND_INK,
        eyebrow: 'Free account',
        sentence: (<>An account<br /><Mark ink={BRAND_INK}>saves your</Mark><br />side of it.</>),
        stickers: (
          <Well h={120}>
            {rows.map(([dot, label, tilt], i) => (
              <span
                key={label}
                className={`absolute left-0 inline-flex h-9 items-center gap-2.5 whitespace-nowrap rounded-full bg-card px-4 text-[14px] font-extrabold text-foreground ${tilt} ${TILT} ${LIFT}`}
                style={{ top: i * 42 }}
              >
                <span className={`h-2 w-2 flex-none rounded-full ${dot}`} />
                {label}
              </span>
            ))}
          </Well>
        ),
        subline: 'Sign in to continue to Shikshaq',
      };
    }
  }
}
