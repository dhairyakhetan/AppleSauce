import type { AuditApi, AuditRow } from '@/lib/audit-api';

/**
 * In-memory fake of the admin audit log read (D75), for previewing
 * /admin/audit without an admin sign-in. Test builds only: reached solely
 * through the PREVIEW_TOOLS-gated lazy import in admin/audit.tsx. Every
 * admin, teacher and paper here is MADE UP. `mode` reaches the other two
 * states: 'empty' (a real, empty log) and 'error' (the read fails).
 */

const NOW = Date.UTC(2026, 9, 7, 9, 30);
const minutes = (m: number) => new Date(NOW - m * 60_000).toISOString();

const PEOPLE = ['Priya Sharma', 'Arjun Mehta', 'Kabir Rao'];

const SEED: Omit<AuditRow, 'id' | 'created_at'>[] = [
  { actor_name: PEOPLE[0], action: 'approve', target_type: 'teacher_application', target_label: 'Anika Bose (Mathematics)', reason: null },
  { actor_name: PEOPLE[1], action: 'publish', target_type: 'paper', target_label: 'ICSE Class 10 Physics, 2026', reason: null },
  { actor_name: PEOPLE[0], action: 'grant_checker', target_type: 'checker', target_label: 'dev.kumar@example.com', reason: null },
  { actor_name: PEOPLE[2], action: 'reject', target_type: 'paper_submission', target_label: 'Sample upload from a student', reason: 'The scan was cut off' },
  { actor_name: PEOPLE[1], action: 'delete', target_type: 'comment', target_label: 'A review on Meera Joshi', reason: 'Spam' },
  { actor_name: PEOPLE[0], action: 'grant_hod', target_type: 'hod', target_label: 'rina.sen@example.com', reason: null },
  { actor_name: PEOPLE[2], action: 'unlist', target_type: 'teacher', target_label: 'Sanjay Paul (English)', reason: null },
  { actor_name: PEOPLE[1], action: 'takedown', target_type: 'paper', target_label: 'CBSE Class 9 Geography, 2025', reason: 'Pages out of order' },
  { actor_name: PEOPLE[0], action: 'revoke_checker', target_type: 'checker', target_label: 'old.verifier@example.com', reason: null },
  { actor_name: PEOPLE[2], action: 'hold_batch', target_type: 'paper_batch', target_label: 'Twelve ISC Biology papers', reason: null },
  { actor_name: PEOPLE[1], action: 'edit', target_type: 'recommendation', target_label: 'Recommended teacher: Tanvi Das', reason: null },
  { actor_name: PEOPLE[0], action: 'delete', target_type: 'feedback', target_label: 'Feedback from a visitor', reason: null },
];

function build(count: number): AuditRow[] {
  return Array.from({ length: count }, (_, i) => ({
    ...SEED[i % SEED.length],
    id: `audit-demo-${i + 1}`,
    // newest first: 7 minutes apart at first, then hours, then days
    created_at: minutes(i < 4 ? 7 + i * 7 : i < 8 ? 90 + i * 140 : 3000 + i * 1300),
  }));
}

export function createFakeAuditApi(mode: 'full' | 'empty' | 'error' = 'full', delayMs = 250): AuditApi {
  const tick = () => new Promise((r) => setTimeout(r, delayMs));
  return {
    async list(limit) {
      await tick();
      if (mode === 'error') throw new Error('The audit log could not be read.');
      if (mode === 'empty') return [];
      return build(Math.min(limit, 14));
    },
  };
}
