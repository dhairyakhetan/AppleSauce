import Fuse from 'fuse.js';

export interface TeacherRecord {
  id: string | number;
  name: string;
  [key: string]: any;
}

const fuseOptions = {
  includeScore: true,
  threshold: 0.3, 
  keys: ['name'],
  minMatchCharLength: 3,
};

// Memoize the Fuse instance so we don't rebuild the index when the dataset hasn't changed
let _cachedFuseRecords: TeacherRecord[] | null = null;
let _cachedFuseInstance: Fuse<TeacherRecord> | null = null;

function getFuseInstance<T extends TeacherRecord>(records: T[]): Fuse<T> {
  if (_cachedFuseRecords !== records) {
    _cachedFuseInstance = new Fuse(records, fuseOptions) as Fuse<TeacherRecord>;
    _cachedFuseRecords = records;
  }
  return _cachedFuseInstance as Fuse<T>;
}

export function searchByNameWithScores<T extends TeacherRecord>(
  records: T[], 
  query: string
): Array<{ item: T; score: number }> {
  if (!query || query.trim().length < 3) {
    return [];
  }

  const fuse = getFuseInstance(records);
  const results = fuse.search(query);
  return results.map(result => ({
    item: result.item,
    score: result.score || 1.0
  }));
}

/**
 * Performs a fuzzy search on teacher names.
 * @param records All teacher records
 * @param query The search string (e.g., "Rahul", "Priya Ma'am")
 * @returns Array of matching teacher records
 */
export function searchByName<T extends TeacherRecord>(records: T[], query: string): T[] {
  const results = searchByNameWithScores(records, query);
  return results.map(result => result.item);
}

