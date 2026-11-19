/**
 * Sanitizes a WhatsApp number for use in wa.me links
 * Removes all non-digit characters and ensures proper format with country code
 * 
 * @param number - The WhatsApp number (can be in various formats)
 * @param defaultNumber - Optional default number to use if input is invalid (default: '918240980312')
 * @returns Sanitized number ready for wa.me links (e.g., '919876543210')
 */
export function sanitizeWhatsAppNumber(
  number: string | null | undefined,
  defaultNumber: string = '918240980312'
): string {
  if (!number) return defaultNumber;
  
  // Remove all non-digit characters (spaces, dashes, +, etc.)
  const cleaned = number.replace(/\D/g, '');
  
  // If empty after cleaning, return default
  if (!cleaned) return defaultNumber;
  
  // If number starts with 0, remove it (common in Indian numbers)
  const withoutLeadingZero = cleaned.startsWith('0') ? cleaned.slice(1) : cleaned;
  
  // If number already starts with 91 and is 12 digits, it's properly formatted
  if (withoutLeadingZero.startsWith('91') && withoutLeadingZero.length === 12) {
    return withoutLeadingZero;
  }
  
  // If number is 12+ digits and doesn't start with 91, assume it's already formatted with country code
  if (withoutLeadingZero.length >= 12 && !withoutLeadingZero.startsWith('91')) {
    return withoutLeadingZero;
  }
  
  // If number is 11 digits and starts with 0, remove 0 and add 91
  if (withoutLeadingZero.length === 11 && withoutLeadingZero.startsWith('0')) {
    return `91${withoutLeadingZero.slice(1)}`;
  }
  
  // If number doesn't start with country code and is 10 digits, assume it's Indian (+91)
  if (withoutLeadingZero.length === 10) {
    return `91${withoutLeadingZero}`;
  }
  
  // If number is less than 10 digits, it's likely invalid - return default
  if (withoutLeadingZero.length < 10) {
    return defaultNumber;
  }
  
  // Return as-is for any other format (might be international number)
  return withoutLeadingZero;
}

/**
 * Generates a WhatsApp wa.me link from a phone number
 * 
 * @param number - The WhatsApp number (can be in various formats)
 * @param defaultNumber - Optional default number to use if input is invalid
 * @returns Complete WhatsApp link (e.g., 'https://wa.me/919876543210')
 */
export function getWhatsAppLink(
  number: string | null | undefined,
  defaultNumber: string = '918240980312'
): string {
  const sanitized = sanitizeWhatsAppNumber(number, defaultNumber);
  return `https://wa.me/${sanitized}`;
}

/**
 * Resolves the destination WhatsApp URL for a teacher.
 *
 * The Shikshaqmine "Link" column may hold either a full URL or a bare number,
 * so both shapes are handled. Falls back to the Shikshaq support number when a
 * teacher has no link of their own.
 *
 * @param whatsappLink - The teacher's raw "Link" value, if any.
 */
export function resolveTeacherWhatsAppUrl(whatsappLink: string | null | undefined): string {
  /* '8240980312' here (10 digits, no country code) skipped
     sanitizeWhatsAppNumber's normalization entirely -- its `if (!number)
     return defaultNumber` early-return returns this literal verbatim,
     producing wa.me/8240980312 instead of wa.me/918240980312. Fixed by
     passing the already-correct 12-digit form. */
  if (!whatsappLink) return getWhatsAppLink(null, '918240980312');
  return whatsappLink.startsWith('http') ? whatsappLink : getWhatsAppLink(whatsappLink);
}

/**
 * Hosts the redirect page is allowed to forward to automatically.
 *
 * `wa.link` is the Walink short-link service and accounts for the overwhelming
 * majority of teacher links in Shikshaqmine; `wa.me` covers the rest. The
 * whatsapp.com hosts are included so hand-entered links keep working.
 */
const WHATSAPP_HOSTS = new Set(['wa.me', 'wa.link', 'whatsapp.com']);

/**
 * Whether a URL actually points at WhatsApp.
 *
 * The redirect page sends users off-site, so the destination is checked against
 * a host allowlist first. Anything else is surfaced as a button the user taps
 * deliberately rather than an automatic redirect — a bad "Link" value should
 * never turn shikshaq.in into an open redirect.
 */
export function isWhatsAppUrl(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol !== 'https:' && protocol !== 'http:') return false;
    const host = hostname.toLowerCase().replace(/^www\./, '');
    return WHATSAPP_HOSTS.has(host) || host.endsWith('.whatsapp.com');
  } catch {
    return false;
  }
}

