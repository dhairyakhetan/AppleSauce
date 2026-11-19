/* Is this reader in West Bengal?

   Shikshaq lists tuition teachers in Kolkata. Someone opening it from Pune or
   Delhi should be told that before they spend time filtering a list that
   cannot serve them — but told once, quietly, and with the useful alternative
   attached rather than a dead end.

   Deliberately narrow about how it answers that:

   - The coordinates never leave the device. No reverse-geocoding service, no
     IP lookup, no request of any kind. The position is compared against a
     bounding box here and then discarded; only the yes/no answer is kept.
   - A bounding box is coarse — it takes in slivers of the neighbouring states
     and misses nothing of West Bengal. That trade is deliberate: the cost of a
     false "you are outside" is showing an unnecessary notice, and a box that
     errs toward "inside" keeps that rare.
   - Nothing prompts on load. `ensure()` only reads a permission the reader has
     already granted; `request()` is the one that may prompt, and it is called
     from a place where location is obviously relevant.
   - The answer is cached, so the browser is asked once per day at most. */

const KEY = 'shikshaq.region';
const TTL = 24 * 60 * 60 * 1000;

/* West Bengal's extent, padded slightly. Errs toward including the reader. */
const WB = { minLat: 21.2, maxLat: 27.4, minLng: 85.6, maxLng: 90.0 };

export type RegionStatus = 'unknown' | 'inside' | 'outside';

interface Cached {
  status: RegionStatus;
  at: number;
}

function read(): RegionStatus {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return 'unknown';
    const c = JSON.parse(raw) as Cached;
    if (!c || typeof c.at !== 'number' || Date.now() - c.at > TTL) return 'unknown';
    return c.status === 'inside' || c.status === 'outside' ? c.status : 'unknown';
  } catch {
    return 'unknown';
  }
}

function write(status: RegionStatus): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ status, at: Date.now() } satisfies Cached));
  } catch {
    /* private mode — the notice simply will not show. Not worth an exception. */
  }
}

export function cachedRegion(): RegionStatus {
  return read();
}

function locate(): Promise<RegionStatus> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve('unknown');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        const inside =
          lat >= WB.minLat && lat <= WB.maxLat && lng >= WB.minLng && lng <= WB.maxLng;
        const status: RegionStatus = inside ? 'inside' : 'outside';
        write(status);
        resolve(status);
      },
      () => resolve('unknown'),
      /* A coarse fix is all a bounding box needs, and the low-accuracy
         provider is far cheaper on a phone's battery than GPS. */
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 10 * 60 * 1000 },
    );
  });
}

/**
 * Answers only from cache or from a permission the reader already granted.
 * Never prompts — safe to call on mount.
 */
export async function ensureRegion(): Promise<RegionStatus> {
  const cached = read();
  if (cached !== 'unknown') return cached;
  try {
    const perm = await navigator.permissions?.query({ name: 'geolocation' as PermissionName });
    if (perm?.state !== 'granted') return 'unknown';
  } catch {
    return 'unknown';
  }
  return locate();
}

/** May show the browser's permission prompt. Call from a user action. */
export async function requestRegion(): Promise<RegionStatus> {
  const cached = read();
  if (cached !== 'unknown') return cached;
  return locate();
}
