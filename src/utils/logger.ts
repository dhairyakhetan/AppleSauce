/**
 * Development-only logger utility
 * Prevents console logs from appearing in production builds
 */

const isDev = import.meta.env.DEV;

declare global {
  interface Window {
    clarity?: (...args: unknown[]) => void;
  }
}

/**
 * Reports a production error to Microsoft Clarity (already loaded via
 * index.html) so failures that would otherwise be silently swallowed by
 * `if (import.meta.env.DEV) console.error(...)` call sites are visible
 * somewhere in prod. No dedicated error-tracking service (e.g. Sentry) is
 * wired up, so this is a lightweight stand-in using infra already present.
 */
function reportProdError(context: string, error: unknown) {
  try {
    if (typeof window === 'undefined' || typeof window.clarity !== 'function') return;
    const message = error instanceof Error ? error.message : String(error);
    window.clarity('set', 'error_context', context);
    window.clarity('event', 'app_error');
    // Keep a trimmed message as a tag too, since Clarity events alone aren't searchable by text.
    window.clarity('set', 'error_message', message.slice(0, 200));
  } catch {
    /* error reporting must never itself throw */
  }
}

export const logger = {
  log: (...args: any[]) => {
    if (isDev) {
      console.log(...args);
    }
  },
  /**
   * Logs to console in DEV, and additionally reports to Clarity in production
   * so real user-facing failures aren't invisible to the team. Pass a short
   * `context` string identifying the call site (e.g. 'JoinApply.submit').
   */
  error: (context: string, ...args: any[]) => {
    if (isDev) {
      console.error(context, ...args);
    } else {
      reportProdError(context, args[0]);
    }
  },
  warn: (...args: any[]) => {
    if (isDev) {
      console.warn(...args);
    }
  },
  info: (...args: any[]) => {
    if (isDev) {
      console.info(...args);
    }
  },
};

