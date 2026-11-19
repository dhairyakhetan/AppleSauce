/**
 * Microsoft Clarity custom event helpers.
 *
 * Clarity is loaded via a tag in index.html and exposes a global window.clarity(...).
 * No type ships with that tag, so we declare a minimal global here.
 */
declare global {
  interface Window {
    clarity?: (...args: unknown[]) => void;
    gtag?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
  }
}

/**
 * Records a per-teacher WhatsApp contact click in Microsoft Clarity.
 *
 * Sets a `teacher_slug` custom tag (the filterable per-teacher dimension) and
 * fires a `whatsapp_click` custom event (the action being counted). Defensively
 * guarded so it never throws if Clarity hasn't loaded — analytics must never
 * break the contact flow.
 *
 * @param slug - The teacher's slug, used as the filterable dimension.
 */
export function trackWhatsAppClick(slug: string): void {
  if (typeof window === 'undefined') return;

  // Clarity — session-replay dimension.
  try {
    if (typeof window.clarity === 'function') {
      // custom tag = the filterable per-teacher dimension
      window.clarity('set', 'teacher_slug', slug);
      // custom event = the action being counted
      window.clarity('event', 'whatsapp_click');
    }
  } catch {
    /* analytics must never break the contact flow */
  }

  /* GA4 — this is the conversion. Messaging a teacher is the product's whole
     point, and it was previously recorded ONLY in Clarity, so nothing about it
     was queryable or reportable: no conversion, no per-subject or per-area
     breakdown, no way to tell which listings actually earn contact.
     gtag is loaded in index.html (G-F19DCXZM2J); dataLayer is the GTM
     fallback for when the gtag shim has not initialised yet. */
  try {
    if (typeof window.gtag === 'function') {
      window.gtag('event', 'whatsapp_click', {
        teacher_slug: slug,
        event_category: 'contact',
      });
    } else if (Array.isArray(window.dataLayer)) {
      window.dataLayer.push({ event: 'whatsapp_click', teacher_slug: slug });
    }
  } catch {
    /* same rule: never break the contact flow */
  }
}
