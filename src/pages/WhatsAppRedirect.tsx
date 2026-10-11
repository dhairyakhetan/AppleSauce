import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { getWhatsAppLinkBySlug } from '@/lib/teachers';
import { resolveTeacherWhatsAppUrl, isWhatsAppUrl } from '@/utils/whatsapp';
import { trackWhatsAppClick } from '@/utils/clarityEvents';
import { recordWhatsAppClick } from '@/utils/whatsappClickLog';
import { recordContact } from '@/lib/contact-record';
import { WhatsAppIcon } from '@/components/BrandIcons';
import { Button } from '@/components/ui/button';
import { BentoPanel } from '@/components/layout/PageContainer';
import { useAuth } from '@/lib/auth-context';

/**
 * Interstitial at /tuition-teachers/:slug/whatsapp-click.
 *
 * Exists so WhatsApp contact clicks become a real, per-teacher URL that shows
 * up in GA4 and Clarity — the teacher is readable straight off the page path.
 * Tracks the click, then forwards to WhatsApp.
 *
 * Never indexed: noindex here, Disallow in robots.txt.
 *
 * Real auth gate, not just a UI nicety on the profile page's own button:
 * this route itself used to have no guard at all, so a bare GET here — no
 * click, no sign-in, typed directly or hit by a script — resolved and
 * redirected to the teacher's real number. teacher_whatsapp_link() (see
 * migration 20260909000002_gate_teacher_contact_columns.sql) already
 * returns null to a signed-out caller server-side, so the number itself
 * cannot leak through this path any more — but redirecting a signed-out
 * visitor to Shikshaq's own support number while the screen still says
 * "Opening WhatsApp…" would be a confusing dead end, not a fix. Redirecting
 * to /auth instead is the honest behaviour. */

type Status = 'resolving' | 'redirecting' | 'manual' | 'notfound';

/** Grace period so analytics beacons flush before the page unloads. */
const REDIRECT_DELAY_MS = 500;

export default function WhatsAppRedirect() {
  const { slug } = useParams<{ slug: string }>();
  const routerLocation = useLocation();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  const [status, setStatus] = useState<Status>('resolving');
  const [url, setUrl] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);

  // The profile page passes the already-resolved URL through router state, so
  // the common path needs no round-trip. State lives in memory only — it can't
  // be set by a crafted link, so this isn't an open-redirect surface.
  const stateUrl = (routerLocation.state as { url?: string; name?: string } | null)?.url;
  const stateName = (routerLocation.state as { url?: string; name?: string } | null)?.name;

  // Guards against firing analytics twice under StrictMode's double-invoke.
  const trackedRef = useRef(false);

  useEffect(() => {
    // Redirect pages must never be indexed.
    const robots = document.createElement('meta');
    robots.name = 'robots';
    robots.content = 'noindex, nofollow';
    document.head.appendChild(robots);
    return () => robots.remove();
  }, []);

  // The real gate. Waits for authLoading to settle so a signed-in visitor on
  // a slow connection isn't bounced to /auth for the instant before their
  // session resolves. Once settled, no user means /auth — not this page's
  // own resolve effect below, which would otherwise fall through to
  // Shikshaq's support number and call that "Opening WhatsApp…".
  useEffect(() => {
    if (authLoading || user || !slug) return;
    // No setAuthIntent 'whatsapp' call here: that variant needs a real
    // subject and area (auth-intent.ts validates and drops anything with a
    // blank field back to the default hero), and this page only ever has a
    // teacher's name, never their subject/area — the profile page is where
    // that intent is set, before the visitor ever reaches this route. Direct
    // hits get the default sign-in hero, which is honest rather than blank.
    navigate('/auth', { replace: true });
  }, [authLoading, user, slug, navigate]);

  useEffect(() => {
    if (authLoading || !user) return;
    let cancelled = false;
    let cleanupTimer: (() => void) | undefined;

    async function resolve() {
      if (!slug) {
        setStatus('notfound');
        return;
      }

      if (stateName) setName(stateName);

      let target = stateUrl ?? null;

      // Direct hit, refresh, or shared link: no router state, so look the
      // teacher up by slug and resolve the destination here instead.
      if (!target) {
        /* Both lookups key off the same slug and neither feeds the other, so
           they run together. Awaiting them in sequence doubled the round
           trips on a redirect interstitial, which is a screen whose entire
           job is to be over quickly — latency here IS the experience. */
        const [teacherRes, rawLink] = await Promise.all([
          supabase.from('teachers_list').select('name, slug').eq('slug', slug).maybeSingle(),
          getWhatsAppLinkBySlug(slug),
        ]);

        if (cancelled) return;

        const teacher = teacherRes.data;
        if (!teacher) {
          setStatus('notfound');
          return;
        }
        setName((teacher as { name?: string }).name ?? null);

        target = resolveTeacherWhatsAppUrl(rawLink);
      }

      if (cancelled) return;
      setUrl(target);

      if (!trackedRef.current) {
        trackedRef.current = true;
        trackWhatsAppClick(slug); // already fires the GA4 whatsapp_click event itself
        recordWhatsAppClick(slug);
      }

      // Anything that isn't WhatsApp is shown as a button the user taps
      // deliberately, never an automatic hop off the domain.
      if (!isWhatsAppUrl(target)) {
        setStatus('manual');
        return;
      }

      // R7 write-review gate (pages.md §"Reviews") — only a real WhatsApp
      // hand-off counts as a "recorded contact", not just landing on this
      // interstitial, so this fires after the isWhatsAppUrl check above.
      if (slug) recordContact(slug);

      setStatus('redirecting');

      // Brief pause before leaving so the analytics beacons can flush. GA4 uses
      // sendBeacon and survives unload, but Clarity buffers its events and an
      // instant navigation drops them — which would defeat the point of this
      // page. Also stops the "Opening WhatsApp…" state flashing past unread.
      const timer = window.setTimeout(() => {
        // replace() so this page never enters history — Back returns to the
        // profile rather than bouncing through the redirect again.
        window.location.replace(target);
      }, REDIRECT_DELAY_MS);
      cleanupTimer = () => window.clearTimeout(timer);
    }

    resolve();
    return () => {
      cancelled = true;
      cleanupTimer?.();
    };
  }, [slug, stateUrl, stateName]);

  const profilePath = slug ? `/tuition-teachers/${slug}` : '/all-tuition-teachers-in-kolkata';

  if (status === 'notfound') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background p-6 text-center">
        <h1 className="text-lg font-semibold text-foreground">Teacher not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          We couldn't find this teacher. They may no longer be listed.
        </p>
        <Button asChild variant="primary" size={44} className="mt-6">
          <Link to="/all-tuition-teachers-in-kolkata">Browse all teachers</Link>
        </Button>
      </div>
    );
  }

  /* Handoff O-012: full-height bg-mint panel, chromeless (registered in
     AppShell's WHATSAPP_REDIRECT_PATTERN — this route had no chromeless
     entry at all before, so it was rendering with the full nav/footer
     chrome the entry explicitly rules out). Structure and copy match the
     entry's own list: disc, h1, one line naming the teacher and stating
     fees/timings are between the two parties, a required manual-open
     fallback, a back row. Click recording and resolveTeacherWhatsAppUrl
     above are untouched. */
  return (
    <div className="min-h-screen bg-background">
      <BentoPanel fill="mint" edge="top" className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
        {/* --whatsapp disc, not bg-mint's own green — mint is the unrelated
            Science-subject tint and design.md's hard rule is that WhatsApp
            green appears nowhere else, so the disc needs the real brand
            token even while it sits on a mint panel. */}
        <span
          className="inline-flex h-[76px] w-[76px] items-center justify-center rounded-full bg-whatsapp"
          style={{ boxShadow: '0 14px 34px rgba(37,211,102,.32)' }}
        >
          <WhatsAppIcon className="h-[38px] w-[38px] text-whatsapp-text" />
        </span>
        <h1 className="mt-6 font-display text-[30px] font-black leading-[1.05] tracking-[-0.045em] text-[#24603D]">
          {/* 'manual' means the resolved target isn't actually a wa.me link
             (a real, pre-existing fallback path) — "Opening WhatsApp…" would
             be wrong there, so that one branch keeps its own accurate copy;
             every other status uses the entry's literal heading. */}
          {status === 'manual' ? 'Ready to message' : 'Opening WhatsApp…'}
        </h1>
        <p className="mx-auto mt-2 max-w-[34ch] text-[15px] leading-[1.6] text-[#3E6F53]">
          {name
            ? `Connecting you with ${name}. Fees and timings are settled directly between you two. Shikshaq takes no commission.`
            : 'Fees and timings are settled directly between you and the teacher. Shikshaq takes no commission.'}
        </p>

        {/* Required, not optional: app handoff to WhatsApp fails often enough
            that a screen with no escape is a dead end. */}
        {url && (
          <Button asChild variant="muted" size={48} className="mt-6 w-full max-w-[280px] !bg-card !text-foreground">
            <a href={url} rel="noopener noreferrer">
              {status === 'manual' ? 'Open WhatsApp' : 'Nothing happened? Open it manually'}
            </a>
          </Button>
        )}

        <Link to={profilePath} className="tap-44 mt-2 text-[14px] font-semibold text-[#3E6F53]">
          {name ? `Back to ${name}'s profile` : 'Back to profile'}
        </Link>
      </BentoPanel>
    </div>
  );
}
