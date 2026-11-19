/**
 * Cache utility for client-side data caching
 * Uses localStorage with TTL (time-to-live) support
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number; // Time to live in milliseconds
}

// Cache TTL constants (in milliseconds)
export const CACHE_TTL = {
  SUBJECTS: 24 * 60 * 60 * 1000, // 24 hours - subjects rarely change
  TEACHERS_LIST: 30 * 60 * 1000, // 30 minutes - teachers update occasionally
  SHIKSHAQMINE: 30 * 60 * 1000, // 30 minutes - Shikshaqmine data updates occasionally
  TEACHER_PROFILE: 15 * 60 * 1000, // 15 minutes - individual teacher profiles
  FEATURED_TEACHERS: 10 * 60 * 1000, // 10 minutes - featured teachers update more frequently
  UPVOTES: 5 * 60 * 1000, // 5 minutes - upvote counts change frequently
  SHIKSHAQMINE_CHUNK: 30 * 60 * 1000, // 30 minutes - for chunked Shikshaqmine fetches
  USER_PROFILE: 10 * 60 * 1000, // 10 minutes - user profile data (role, name) changes infrequently
  RELATION_IDS: 5 * 60 * 1000, // 5 minutes - a user's liked/upvoted/studies-with id sets
} as const;

const CACHE_PREFIX = 'shikshaq_cache_';

/**
 * Get a cached value if it exists and hasn't expired
 */
export function getCache<T>(key: string): T | null {
  try {
    const cached = localStorage.getItem(CACHE_PREFIX + key);
    if (!cached) return null;

    const entry: CacheEntry<T> = JSON.parse(cached);
    const now = Date.now();
    
    // Check if cache has expired
    if (now - entry.timestamp > entry.ttl) {
      // Cache expired, remove it
      localStorage.removeItem(CACHE_PREFIX + key);
      return null;
    }

    return entry.data;
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('Cache read error:', error);
    }
    return null;
  }
}

/**
 * Set a value in cache with TTL
 */
export function setCache<T>(key: string, data: T, ttl: number): void {
  try {
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      ttl,
    };
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry));
  } catch (error) {
    // If storage is full, try to clear old cache entries
    if (error instanceof DOMException && error.code === 22) {
      clearExpiredCache();
      try {
        const entry: CacheEntry<T> = {
          data,
          timestamp: Date.now(),
          ttl,
        };
        localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry));
      } catch (retryError) {
        if (import.meta.env.DEV) {
          console.warn('Cache write error after cleanup:', retryError);
        }
      }
    } else {
      if (import.meta.env.DEV) {
        console.warn('Cache write error:', error);
      }
    }
  }
}

/**
 * Remove a specific cache entry
 */
export function removeCache(key: string): void {
  try {
    localStorage.removeItem(CACHE_PREFIX + key);
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('Cache remove error:', error);
    }
  }
}

/**
 * Clear all expired cache entries
 */
export function clearExpiredCache(): void {
  try {
    const keys = Object.keys(localStorage);
    const now = Date.now();
    
    keys.forEach(key => {
      if (key.startsWith(CACHE_PREFIX)) {
        try {
          const cached = localStorage.getItem(key);
          if (cached) {
            const entry: CacheEntry<any> = JSON.parse(cached);
            if (now - entry.timestamp > entry.ttl) {
              localStorage.removeItem(key);
            }
          }
        } catch (error) {
          // Invalid cache entry, remove it
          localStorage.removeItem(key);
        }
      }
    });
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('Cache cleanup error:', error);
    }
  }
}

/**
 * Clear all cache entries (useful for testing or forced refresh)
 */
export function clearAllCache(): void {
  try {
    const keys = Object.keys(localStorage);
    keys.forEach(key => {
      if (key.startsWith(CACHE_PREFIX)) {
        localStorage.removeItem(key);
      }
    });
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('Cache clear error:', error);
    }
  }
}

/**
 * Generate cache key for teachers list query
 */
export function getTeachersListCacheKey(limit?: number): string {
  return `teachers_list_${limit || 200}`;
}

/**
 * Generate cache key for Shikshaqmine chunk query
 */
export function getShikshaqmineChunkCacheKey(slugs: string[]): string {
  // Sort slugs for consistent cache key. v2: the query now selects a fixed
  // column subset instead of '*' — versioned so old full-row cache entries
  // don't get reused as if they matched the new shape.
  const sortedSlugs = [...slugs].sort().join(',');
  return `shikshaqmine_chunk_v2_${sortedSlugs}`;
}

/**
 * Generate cache key for teacher profile
 */
export function getTeacherProfileCacheKey(slug: string): string {
  return `teacher_profile_${slug}`;
}

/**
 * Generate cache key for Shikshaqmine by slug
 */
export function getShikshaqmineBySlugCacheKey(slug: string): string {
  return `shikshaqmine_slug_${slug}`;
}

/**
 * Generate cache key for user profile
 */
export function getUserProfileCacheKey(userId: string): string {
  return `user_profile_${userId}`;
}

/**
 * Invalidate cache for a specific teacher (when teacher data is updated)
 */
export function invalidateTeacherCache(slug: string): void {
  removeCache(getTeacherProfileCacheKey(slug));
  removeCache(getShikshaqmineBySlugCacheKey(slug));
  // Also clear teachers list cache since it might include this teacher
  // Clear all teachers list cache keys
  const keys = Object.keys(localStorage);
  keys.forEach(key => {
    if (key.startsWith(CACHE_PREFIX + 'teachers_list_')) {
      localStorage.removeItem(key);
    }
  });
}

/**
 * Invalidate cache for a specific user profile (when profile is updated)
 */
export function invalidateUserProfileCache(userId: string): void {
  removeCache(getUserProfileCacheKey(userId));
}

/**
 * Cleanup, deferred off the critical path.
 *
 * This used to call clearExpiredCache() synchronously during module
 * evaluation. That function enumerates every localStorage key and JSON.parses
 * each of ours, and ours hold 500-row teacher pages and 200-slug Shikshaqmine
 * chunks -- so it was hundreds of KB of synchronous main-thread parsing while
 * the browser was still trying to render first paint, on a module imported by
 * the eager bundle.
 *
 * Nothing needs it to have happened by then. Expired entries are already
 * checked on read (getCache returns null past the TTL), so this pass only
 * reclaims space; doing it a moment later costs nothing and doing it during
 * boot costs a visibly slower first paint on a low-end Android.
 *
 * Index.tsx and Browse.tsx also each called clearExpiredCache() on mount, so
 * a single page load did this full scan three times. Those calls are gone;
 * this is the one scheduler.
 */
if (typeof window !== 'undefined') {
  const w = window as Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  };
  if (typeof w.requestIdleCallback === 'function') {
    w.requestIdleCallback(() => clearExpiredCache(), { timeout: 5000 });
  } else {
    setTimeout(clearExpiredCache, 3000);
  }

  // Periodic cleanup for long sessions.
  setInterval(clearExpiredCache, 60 * 60 * 1000);
}
