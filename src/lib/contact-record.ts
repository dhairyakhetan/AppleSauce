// Device-local "recorded contact" tracker.
//
// R7 / pages.md §"Reviews": the write-review button is only offered "if a
// contact was recorded for this user + teacher" — a light anti-spam trust
// signal so a review has to follow an actual WhatsApp outreach rather than
// being posted by someone who never spoke to the teacher.
//
// O-04 (a-to-z.md §5) is unresolved: there is no server-side WhatsApp-tap
// event table (`whatsapp_clicks` does not exist). Per a-to-z.md §5's
// instruction to "ship the screen without the dependent clause" rather than
// guess and build around a missing dependency, this is a client-side,
// best-effort record: not tamper-proof, not synced across devices, but it does
// gate the button on a real WhatsApp hand-off in the common case.
//
// As of the intent index this is a SHIM over src/lib/intent/store.ts. The
// `shikshaq_contacted_teachers` key is now a sub-record of
// `shikshaq.intent.v1`, holding the identical {slug, ts} shape and the
// identical cap of 100, so Account's Contacted tab and the review gate are
// unaffected. The old key is still mirrored for one release.
//
// ⚠ The gate must fail CLOSED. Every read below returns an empty list when
// storage is unreadable, so an unavailable store withholds the review button
// rather than opening it to someone who never made contact.

import { recordContactEntry } from '@/lib/intent/signals';
import { readStore } from '@/lib/intent/store';

function readAll(): { slug: string; ts: number }[] {
  try {
    return readStore().contacts;
  } catch {
    return [];
  }
}

/** Marks this teacher (by slug) as contacted on this device. */
export function recordContact(slug: string) {
  if (!slug) return;
  try {
    recordContactEntry(slug);
  } catch {
    // localStorage unavailable — gating just stays closed, fails safe.
  }
}

/** Whether this device has a recorded WhatsApp contact for this teacher. */
export function hasContactedTeacher(slug: string | null | undefined): boolean {
  if (!slug) return false;
  return readAll().some((entry) => entry.slug === slug);
}

/**
 * All recorded contacts on this device, most-recent first — used by the
 * Account page's Contacted tab (pages.md §11). Exposes the read-only shape
 * `{ slug, ts }` rather than the raw storage type so callers can't mutate it.
 */
export function readAllContacts(): { slug: string; ts: number }[] {
  return readAll();
}
