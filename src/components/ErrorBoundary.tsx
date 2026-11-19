import { Component, type ErrorInfo, type ReactNode } from 'react';

import { logger } from '@/utils/logger';

/**
 * Stops one broken component taking the whole site with it.
 *
 * React unmounts the entire tree when a render throws and nothing catches it,
 * so without this a single bad value anywhere renders a blank white page: no
 * message, no navigation, no way back except a manual reload, and no signal to
 * anyone that it happened. That failure mode has already been mistaken for a
 * server outage during testing, which is exactly how it would be read by a
 * parent on a phone.
 *
 * Has to be a class. Error boundaries are the one thing hooks still cannot do
 * -- there is no useErrorBoundary, and componentDidCatch has no functional
 * equivalent.
 *
 * WHAT IT DOES NOT CATCH, so nobody assumes more than it gives:
 *   - errors inside event handlers (those do not break rendering anyway)
 *   - errors in async code that never touches a render
 *   - errors thrown during server-side rendering, which this app does not do
 * It catches the render path, which is the one that blanks the page.
 *
 * Reporting goes through logger.error, which forwards to Microsoft Clarity in
 * production. That is a weak channel -- no stack traces, no alerting, not
 * searchable by message -- but it is what exists, and a weak signal beats the
 * current zero. Replacing it with a real error service is on the guardrails
 * list; this boundary is where that would plug in.
 */

/**
 * True when this is a stale-deploy chunk failure rather than a real fault.
 *
 * The message differs per browser -- Chrome, Firefox and Safari each word it
 * their own way -- so all three are matched. Kept deliberately narrow: only a
 * dynamic-import failure qualifies, because the recovery is a reload and
 * reloading a genuinely broken page just shows the same crash twice.
 */
function isStaleChunkError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return (
    /failed to fetch dynamically imported module/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /importing a module script failed/i.test(message) ||
    /failed to load module script/i.test(message)
  );
}

/**
 * Permission to reload, granted at most once per minute.
 *
 * Without this a page that fails on EVERY load -- a genuinely missing chunk, a
 * broken CDN -- would reload forever, which is worse than the blank page this
 * whole component exists to replace. One attempt, then the panel, which is the
 * honest outcome when reloading did not help.
 *
 * Fails CLOSED: if sessionStorage is unavailable (private mode, blocked
 * storage) this returns false and the reader gets the panel and a button they
 * can press themselves. Never an unguarded reload.
 */
/* Set once this page load has been granted its reload. Every later caller in
   the same page lifetime gets `true` too: vite:preloadError (main.tsx) usually
   claims first, and the same failure then reaches getDerivedStateFromError --
   which React may also invoke more than once (StrictMode, render retries).
   Without this, those later calls saw the budget as spent and rendered
   "Something went wrong" in the moment before the reload landed. */
let reloadGrantedThisPage = false;

function claimStaleChunkReload(): boolean {
  if (reloadGrantedThisPage) return true;
  const KEY = 'shikshaq_chunk_reload_at';
  try {
    const previous = Number(window.sessionStorage.getItem(KEY) ?? 0);
    if (Number.isFinite(previous) && Date.now() - previous < 60_000) return false;
    window.sessionStorage.setItem(KEY, String(Date.now()));
    reloadGrantedThisPage = true;
    return true;
  } catch {
    return false;
  }
}

interface Props {
  children: ReactNode;
  /** Identifies which boundary fired, since there is more than one. */
  context?: string;
}

interface State {
  hasError: boolean;
  message: string;
  /* True for exactly the renders where a guarded auto-reload is about to
     happen. Decided in getDerivedStateFromError -- BEFORE the first paint of
     the error UI -- specifically so that paint never shows "Something went
     wrong": a reader who is about to be silently reloaded a moment later
     should see a neutral loading state, not a message that reads like a
     crash and gets contradicted a heartbeat later. See render() below. */
  recovering: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '', recovering: false };

  static getDerivedStateFromError(error: unknown): State {
    /* claimStaleChunkReload is called here, not in componentDidCatch, so the
       one decision it makes (may we reload this time, or did we already try
       in the last minute) is made exactly once per error and is the same
       decision both the render below and componentDidCatch's actual reload
       act on -- there is no second call to disagree with the first. */
    return {
      hasError: true,
      message: error instanceof Error ? error.message : String(error),
      recovering: isStaleChunkError(error) && claimStaleChunkReload(),
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logger.error(
      `ErrorBoundary:${this.props.context ?? 'app'}`,
      error,
      info.componentStack,
    );

    if (this.state.recovering) {
      /* Not a bug in the page: the visitor is holding an index.html that
         references chunk filenames which no longer exist, because a deploy
         landed while they were reading. Their next route change asks for a
         file the server no longer has, Vercel's SPA rewrite answers with
         index.html, and the browser refuses it as the wrong MIME type.

         Reloading fetches the current index.html and the current filenames,
         which fixes it completely. Doing it automatically matters most on the
         day it will happen most: merging to main republishes every hashed
         asset, so everyone reading at that moment is holding a stale document.
         Asking them to press a button is a worse answer than just doing it. */
      window.location.reload();
    }
  }

  private reset = () => {
    /* A full reload rather than clearing the error state. Whatever produced
       the bad render is usually still in memory -- a cached query result, a
       corrupted localStorage entry -- so re-rendering the same tree tends to
       throw again immediately and look like the button does nothing. */
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    if (this.state.recovering) {
      /* Same "depend on nothing" rule as the panel below applies here too --
         plain markup, inline styles, no router. role="status" rather than
         "alert": this is not a fault being reported, it is a reload already
         under way, and a screen reader announcing it as an alert would tell
         the reader something is wrong exactly when nothing is. */
      return (
        <div
          role="status"
          aria-live="polite"
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
            background: '#F9F5F1',
            color: '#1F1B17',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            textAlign: 'center',
          }}
        >
          <p style={{ fontSize: '15px', lineHeight: 1.6, color: 'var(--error-secondary-text, #5A524A)' }}>
            Loading the latest version…
          </p>
        </div>
      );
    }

    return (
      /* Deliberately plain: this renders when the app is known to be in a bad
         state, so it uses no design-system component, no context, no data
         fetch and no router. Anything it depended on could be the thing that
         just broke. Inline styles for the same reason -- if the stylesheet
         failed to load, Tailwind classes would render an unstyled page. */
      <div
        role="alert"
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          background: '#F9F5F1',
          color: '#1F1B17',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          textAlign: 'center',
        }}
      >
        <div style={{ maxWidth: '420px' }}>
          <h1 style={{ fontSize: '22px', fontWeight: 800, margin: '0 0 10px', lineHeight: 1.25 }}>
            Something went wrong on this page
          </h1>
          <p style={{ fontSize: '15px', lineHeight: 1.6, margin: '0 0 20px', color: 'var(--error-secondary-text, #5A524A)' }}>
            Not your fault, and nothing you did is lost. Reloading usually fixes
            it. If it keeps happening, tell us and we will look.
          </p>
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={this.reset}
              style={{
                minHeight: '44px', padding: '0 20px', borderRadius: '999px',
                border: 'none', background: '#FF8000', color: '#fff',
                fontSize: '15px', fontWeight: 700, cursor: 'pointer',
              }}
            >
              Reload the page
            </button>
            {/* A plain anchor, not a router Link: the router may be the thing
                that broke, and a hard navigation always works. */}
            <a
              href="/"
              style={{
                minHeight: '44px', padding: '0 20px', borderRadius: '999px',
                display: 'inline-flex', alignItems: 'center',
                border: '1px solid #D5CBBE', color: '#1F1B17',
                fontSize: '15px', fontWeight: 600, textDecoration: 'none',
              }}
            >
              Go to the home page
            </a>
          </div>
          {import.meta.env.DEV && this.state.message && (
            <pre
              style={{
                marginTop: '20px', padding: '12px', textAlign: 'left',
                background: '#F4EFE8', borderRadius: '10px', fontSize: '12px',
                whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#5A524A',
              }}
            >
              {this.state.message}
            </pre>
          )}
        </div>
      </div>
    );
  }
}

/* Exported under prefixed names for the tests. The component itself is the
   public surface; these two are decisions worth pinning independently, because
   getting either wrong is worse than having no boundary at all. */
export { isStaleChunkError as __isStaleChunkError, claimStaleChunkReload as __claimStaleChunkReload };
/** Tests only: a real reload starts a fresh module, which this simulates. */
export function __resetReloadGrantForTests(): void {
  reloadGrantedThisPage = false;
}

/* Plain names for main.tsx's `vite:preloadError` listener (below the test
   aliases, not instead of them, so the existing test imports keep working
   unchanged). Sharing this exact function -- not a re-implementation -- means
   the listener and this boundary spend the same one-reload-per-minute budget
   from the same sessionStorage key, so a failure that fires both cannot burn
   two reloads instead of one. */
export { isStaleChunkError, claimStaleChunkReload };
