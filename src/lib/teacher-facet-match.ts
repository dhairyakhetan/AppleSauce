/**
 * Whether a Shikshaqmine-shaped record satisfies a set of teacher facet
 * filters (subject/class/board/area/classSize/mode/place/fees/experience).
 *
 * Moved out of Browse.tsx verbatim (same tokenisation rules, same
 * subject/class synonym handling) so the search overlay's live "Teachers N"
 * preview count (src/hooks/useSearchIndex.ts) and Browse's own results count
 * are computed by the SAME function instead of two hand-maintained copies
 * that could silently drift apart -- which is exactly how the papers search
 * bug (see src/lib/paper-query.ts) happened in the first place: two
 * independent, whole-string matchers that each covered different queries.
 *
 * `record` is deliberately untyped (`Record<string, any>`) because it reads
 * the exact Shikshaqmine column names, including ones with spaces and
 * apostrophes ("Classes Taught for Backend", "Sir/Ma'am?") that don't survive
 * as a clean TS interface without a large, brittle re-declaration.
 */
import type { FilterState } from '@/components/FilterPanel';

export function filterShikshaqRecords(recordsToFilter: Record<string, any>[], effectiveFilters: FilterState): Record<string, any>[] {
  // Pre-compute lowercase filter values once (outside loop for performance)
  const subjectFiltersLower = effectiveFilters.subjects.map(s => s.toLowerCase());
  const classFiltersLower = effectiveFilters.classes.map(c => c.toLowerCase());
  const boardFiltersLower = effectiveFilters.boards.map(b => b.toLowerCase());
  const classSizeFiltersLower = effectiveFilters.classSize.map(s => s.toLowerCase());
  const areaFiltersLower = effectiveFilters.areas.map(a => a.toLowerCase());
  const modeFiltersLower = effectiveFilters.modeOfTeaching.map(m => m.toLowerCase());
  const placeFiltersLower = effectiveFilters.placeOfTeaching.map(p => p.toLowerCase());

  return recordsToFilter.filter((record: Record<string, any>) => {
    // Pre-compute lowercase values for this record once (inside loop but before checks)
    const subjectsRaw = (record.Subjects || '').toLowerCase();
    // Match by whole subject tokens (comma-separated) so "AP" matches only subject AP, not "ap" in "Geography"
    const subjectTokens = subjectsRaw.split(',').map((s: string) => s.trim()).filter(Boolean);
    const classesBackend = (record["Classes Taught for Backend"] || '').toLowerCase();
    const classesDisplay = (record["Classes Taught"] || '').toLowerCase();
    // Tokenize comma- or slash-separated values so "IB" doesn't match inside "ICSE", "Park" doesn't match "Park Street", etc.
    const tokenize = (s: string) => s.split(/\s*[,/]\s*/).map((x: string) => x.trim().toLowerCase()).filter(Boolean);
    const boardTokens = tokenize(record["School Boards Catered"] || '');
    const classSizeTokens = tokenize(record["Class Size (Group/ Solo)"] || '');
    const areaTokens = tokenize(record.Area || record["AREAS FOR FILTERING"] || '');
    const modeTokens = tokenize(record["Mode of Teaching"] || '');
    const placeTokens = tokenize(record["Place of Teaching"] || '');

    // Check subjects (match whole tokens only so AP does not match Geography)
    if (effectiveFilters.subjects.length > 0) {
      const hasSubject = subjectFiltersLower.some(subjLower => {
        const tokenMatches = (token: string) => subjectTokens.includes(token);
        const tokenMatchesAny = (tokens: string[]) => tokens.some(t => subjectTokens.includes(t));
        // Handle "Accountancy" matching "Accounts" in database for backward compatibility
        if (subjLower === 'accountancy') {
          return tokenMatchesAny(['accountancy', 'accounts']);
        }
        // Handle "Computers" matching "Computer" (singular/plural variants in DB)
        if (subjLower === 'computers') {
          return tokenMatchesAny(['computers', 'computer']);
        }
        if (subjLower === 'computer') {
          return tokenMatches('computer');
        }
        // Handle "Drawing & Painting" / "Drawing and Painting" / "Drawing" variants in DB
        if (subjLower === 'drawing & painting' || subjLower === 'drawing and painting') {
          return tokenMatchesAny(['drawing & painting', 'drawing and painting', 'drawing']);
        }
        if (subjLower === 'drawing') {
          return tokenMatches('drawing');
        }
        // Social Studies = History & Civics OR Geography (and optionally "Social Studies" in DB)
        if (subjLower === 'social studies') {
          return tokenMatchesAny(['history & civics', 'geography', 'social studies']);
        }
        return tokenMatches(subjLower);
      });
      if (!hasSubject) {
        return false;
      }
    }

    // Check classes - backend is token-based; display uses word boundary so "5" doesn't match "15"
    if (effectiveFilters.classes.length > 0) {
      const hasClass = classFiltersLower.some(classLower => {
        if (classesBackend) {
          const backendClasses = classesBackend.split(',').map(c => c.trim());
          if (backendClasses.includes(classLower)) {
            return true;
          }
        }
        if (classesDisplay) {
          const escaped = classLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          if (new RegExp(`\\b${escaped}\\b`).test(classesDisplay)) {
            return true;
          }
          return classesDisplay.includes(`class ${classLower}`) ||
                 classesDisplay.includes(`class ${classLower} -`) ||
                 classesDisplay.includes(`- ${classLower}`) ||
                 classesDisplay.includes(`class ${classLower}-`);
        }
        return false;
      });
      if (!hasClass) {
        return false;
      }
    }

    // Check boards - whole tokens only (e.g. IB matches only "IB", not inside "ICSE")
    if (effectiveFilters.boards.length > 0) {
      const hasBoard = boardFiltersLower.some(boardLower =>
        boardTokens.includes(boardLower)
      );
      if (!hasBoard) {
        return false;
      }
    }

    // Check class size - whole tokens only (e.g. "Group" only as token, not substring)
    if (effectiveFilters.classSize.length > 0) {
      const hasSize = classSizeFiltersLower.some(sizeLower =>
        classSizeTokens.includes(sizeLower)
      );
      if (!hasSize) {
        return false;
      }
    }

    // Check areas - whole tokens only (e.g. "Park" only as token, not inside "Park Street")
    if (effectiveFilters.areas.length > 0) {
      const hasArea = areaFiltersLower.some(areaLower =>
        areaTokens.includes(areaLower)
      );
      if (!hasArea) {
        return false;
      }
    }

    // Check mode of teaching - whole tokens only
    if (effectiveFilters.modeOfTeaching.length > 0) {
      const hasMode = modeFiltersLower.some(modeLower =>
        modeTokens.includes(modeLower)
      );
      if (!hasMode) {
        return false;
      }
    }

    // Check place of teaching - whole tokens only
    if (effectiveFilters.placeOfTeaching.length > 0) {
      const hasPlace = placeFiltersLower.some(placeLower =>
        placeTokens.includes(placeLower)
      );
      if (!hasPlace) {
        return false;
      }
    }

    // Check fees - filter by Min Fees and Max Fees from Shikshaqmine
    const teacherMinFees = (record["Min Fees"] != null) ? Number(record["Min Fees"]) : null;
    const teacherMaxFees = (record["Max Fees"] != null) ? Number(record["Max Fees"]) : null;
    const filterMinFees = effectiveFilters.minFees;
    const filterMaxFees = effectiveFilters.maxFees;

    // Only filter if at least one fee filter is set
    if (filterMinFees != null || filterMaxFees != null) {
      // If teacher has no fees data, exclude them
      if (teacherMinFees == null && teacherMaxFees == null) {
        return false;
      }

      // Check if fee ranges overlap
      // Filter: [filterMinFees, filterMaxFees] - user wants teachers in this range
      // Teacher: [teacherMinFees, teacherMaxFees] - teacher's actual fee range
      // Match if ranges overlap (teacher's range intersects with filter range)

      let matches = true;

      // If filter has minFees, check if teacher's range can include values >= filterMinFees
      if (filterMinFees != null) {
        if (teacherMaxFees != null) {
          // Teacher has maxFees - check if their range goes high enough (maxFees >= filterMinFees)
          matches = matches && teacherMaxFees >= filterMinFees;
        } else if (teacherMinFees != null) {
          // Teacher only has minFees - check if their minimum is acceptable (minFees >= filterMinFees)
          // If teacher charges at least filterMinFees, they match
          matches = matches && teacherMinFees >= filterMinFees;
        } else {
          matches = false;
        }
      }

      // If filter has maxFees, check if teacher's range can include values <= filterMaxFees
      if (filterMaxFees != null) {
        if (teacherMinFees != null) {
          // Teacher has minFees - check if their range goes low enough (minFees <= filterMaxFees)
          matches = matches && teacherMinFees <= filterMaxFees;
        } else if (teacherMaxFees != null) {
          // Teacher only has maxFees - check if their maximum is acceptable (maxFees <= filterMaxFees)
          // If teacher charges at most filterMaxFees, they match
          matches = matches && teacherMaxFees <= filterMaxFees;
        } else {
          matches = false;
        }
      }

      if (!matches) {
        return false;
      }
    }

    // Check experience
    if (effectiveFilters.minExperience != null) {
      const yearStarted = parseInt(record["Years they started teaching"]);
      if (!yearStarted || isNaN(yearStarted)) {
        return false;
      }
      const currentYear = new Date().getFullYear();
      const yearsExp = currentYear - yearStarted;
      if (yearsExp < parseInt(effectiveFilters.minExperience)) {
        return false;
      }
    }

    return true;
  });
}

/** Every field of FilterState defaulted to "no constraint", for building an
 *  effective filter from a `Partial<FilterState>` (what extractFiltersFromQuery
 *  returns) without `filterShikshaqRecords` seeing `undefined` where it expects
 *  an array. */
export function fillFilterStateDefaults(partial: Partial<FilterState>): FilterState {
  return {
    subjects: partial.subjects ?? [],
    classes: partial.classes ?? [],
    boards: partial.boards ?? [],
    classSize: partial.classSize ?? [],
    areas: partial.areas ?? [],
    modeOfTeaching: partial.modeOfTeaching ?? [],
    placeOfTeaching: partial.placeOfTeaching ?? [],
    minFees: partial.minFees ?? null,
    maxFees: partial.maxFees ?? null,
    minExperience: partial.minExperience ?? null,
    schools: partial.schools ?? [],
    examTypes: partial.examTypes ?? [],
  };
}

/** True when at least one facet `extractFiltersFromQuery` can find is present
 *  -- the same condition Browse.tsx calls `hasActiveFiltersAfterExtraction`.
 *  Only the facets `filterShikshaqRecords` can actually test against the
 *  overlay's lightweight Shikshaqmine slice (subject/class/board/area) count
 *  here; fees and experience are deliberately excluded -- see
 *  useSearchIndex.ts's note on why the overlay preview doesn't fetch those
 *  columns. */
export function hasTeacherFacets(filters: Partial<FilterState>): boolean {
  return !!(
    filters.subjects?.length ||
    filters.classes?.length ||
    filters.boards?.length ||
    filters.areas?.length
  );
}
