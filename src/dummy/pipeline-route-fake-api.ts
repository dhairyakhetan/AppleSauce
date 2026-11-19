import { normaliseRoute, type PipelineRoute, type PipelineRouteApi } from '@/lib/pipeline-route';
import { EXAMPLE_ROUTE_RAW } from '@/lib/pipeline-route.fixture';

/* The papers route's fake API for dummy mode (D75). The numbers start at the
   real ones from 12 October 2026 and drift a little on every read, so the
   count tween, the lanes and "Checked ... ago" can be watched working. The
   picture queue starts with something in it, so that stop shows more than zeros.
   Nothing here is read from the real database.

   Modes: full, error (never loads), flaky (every third read after the first
   fails), empty (nothing yet), unsynced (the desk has not sent the picture or
   PDF numbers: those stops show "?"), stale (the desk last synced four days ago). */

type Mode = 'full' | 'error' | 'flaky' | 'empty' | 'unsynced' | 'stale';

type Raw = typeof EXAMPLE_ROUTE_RAW;

function start(): Raw {
  const d = JSON.parse(JSON.stringify(EXAMPLE_ROUTE_RAW)) as Raw;
  const now = Date.now();
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
  d.generated_at = iso(0);
  d.pictures = {
    ...d.pictures,
    queued_papers: 3,
    queued_pictures: 120,
    queued_bytes: 52_428_800,
    desk_synced_at: iso(20 * 60_000),
  };
  d.drive.updated_at = iso(20 * 60_000);
  d.synced = { desk_synced_at: iso(20 * 60_000), drive_synced_at: iso(20 * 60_000), registry_changed_at: iso(3 * 3_600_000) };
  return d;
}

/** `mode` reaches the other states of the page. */
export function createFakePipelineRouteApi(mode: Mode = 'full', delayMs = 700): PipelineRouteApi {
  const d = start();
  let calls = 0;
  const wait = () => new Promise((r) => setTimeout(r, delayMs));
  const step = (n: number) => Math.floor(Math.random() * (n + 1));

  function drift() {
    const s = d.registry.by_state;
    const moved = step(6);
    s.not_started = Math.max(0, s.not_started - moved);
    s.ocr_queued += moved - step(moved);
    s.ocr_done += step(3);
    d.registry.swarm_read.papers += step(2);
    d.desk.questions_passed = Math.min(d.desk.questions, d.desk.questions_passed + step(40));
    d.checking.questions = Math.max(0, d.checking.questions - step(30));
    d.open.questions_by_pile.kid = d.checking.questions;
    d.pictures.queued_pictures += step(4);
    d.pictures.queued_bytes += step(4) * 430_000;
    d.trust.checks_done = Math.min(d.trust.threshold, d.trust.checks_done + (step(3) === 0 ? 1 : 0));
    d.generated_at = new Date().toISOString();
  }

  return {
    async route(): Promise<PipelineRoute> {
      calls += 1;
      await wait();
      if (mode === 'error') throw new Error('fake pipeline route failure');
      if (mode === 'flaky' && calls > 1 && calls % 3 === 0) throw new Error('fake pipeline route failure');
      if (mode === 'empty') {
        return normaliseRoute({ generated_at: d.generated_at, registry: {}, desk: {}, open: {}, checkers: {} });
      }
      if (calls > 1) drift();
      const raw = JSON.parse(JSON.stringify(d)) as Record<string, unknown>;
      if (mode === 'unsynced') {
        raw.pictures = null;
        raw.drive = null;
        raw.synced = { desk_synced_at: null, drive_synced_at: null, registry_changed_at: d.synced.registry_changed_at };
      }
      if (mode === 'stale') {
        const old = new Date(Date.now() - 4 * 24 * 3_600_000).toISOString();
        raw.synced = { desk_synced_at: old, drive_synced_at: old, registry_changed_at: old };
      }
      return normaliseRoute(raw);
    },
  };
}
