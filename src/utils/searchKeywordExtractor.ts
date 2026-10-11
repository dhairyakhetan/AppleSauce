import { FilterState } from '@/components/FilterPanel';
import { AREAS, AREA_NORMALIZATION } from './area-normalization';

// Base normalization for common subjects (always available). Exported so
// src/lib/paper-query.ts (the papers-search facet parser) shares the same
// subject vocabulary instead of maintaining a second copy that could drift.
export const BASE_SUBJECT_NORMALIZATION: Record<string, string> = {
  'math': 'Maths', 'mathematics': 'Maths', 'maths': 'Maths',
  'bio': 'Biology', 'biology': 'Biology', 'biol': 'Biology',
  'chem': 'Chemistry', 'chemistry': 'Chemistry',
  'phy': 'Physics', 'physics': 'Physics',
  'eng': 'English', 'english': 'English',
  'comp': 'Computers', 'computer': 'Computers', 'computers': 'Computers', 'cs': 'Computers', 'it': 'Computers', 'coding': 'Computers',
  'hist': 'History & Civics', 'history': 'History & Civics', 'civics': 'History & Civics', 'history civics': 'History & Civics',
  'geo': 'Geography', 'geography': 'Geography',
  'eco': 'Economics', 'economics': 'Economics', 'econ': 'Economics',
  'acc': 'Accounts', 'accounts': 'Accounts', 'accountancy': 'Accounts', 'accounting': 'Accounts',
  'bst': 'Business Studies', 'business studies': 'Business Studies', 'business': 'Business Studies', 'bs': 'Business Studies',
  'pol sc': 'Political Science', 'political science': 'Political Science', 'pol science': 'Political Science', 'political': 'Political Science',
  'evs': 'Environmental Science', 'env science': 'Environmental Science', 'environmental': 'Environmental Science', 'environmental science': 'Environmental Science',
  'beng': 'Bengali', 'bengali': 'Bengali', 'bangla': 'Bengali',
  'draw': 'Drawing & Painting', 'drawing': 'Drawing & Painting', 'art': 'Drawing & Painting', 'painting': 'Drawing & Painting', 'drawing painting': 'Drawing & Painting', 'drawing & painting': 'Drawing & Painting',
  'science': 'Science', 'sci': 'Science',
  'sst': 'Social Studies', 'social studies': 'Social Studies', 'social': 'Social Studies',
  'soc': 'Sociology', 'sociology': 'Sociology',
  'psy': 'Psychology', 'psychology': 'Psychology', 'psych': 'Psychology',
  'hindi': 'Hindi',
  'sanskrit': 'Sanskrit', 'sansk': 'Sanskrit',
  'legal': 'Legal Studies', 'legal studies': 'Legal Studies', 'law': 'Legal Studies',
  'home': 'Home Science', 'home science': 'Home Science', 'home sci': 'Home Science',
  'act': 'ACT',
  'ap': 'AP', 'advanced placement': 'AP',
  'ca': 'CA', 'chartered accountant': 'CA', 'chartered accountancy': 'CA',
  'cat': 'CAT', 'common admission test': 'CAT',
  'jee': 'JEE', 'joint entrance exam': 'JEE', 'joint entrance examination': 'JEE',
  'neet': 'NEET', 'national eligibility cum entrance test': 'NEET',
  'nmat': 'NMAT',
  'sat': 'SAT', 'scholastic assessment test': 'SAT',
  'clat': 'CLAT', 'common law admission test': 'CLAT'
};

// Function to build dynamic subject normalization from database subjects
function buildSubjectNormalization(subjects: { name: string; slug: string }[]): Record<string, string> {
  // Start with both base normalization and static normalization
  const normalization: Record<string, string> = { ...BASE_SUBJECT_NORMALIZATION, ...SUBJECT_NORMALIZATION };
  
  subjects.forEach(subject => {
    const name = subject.name;
    const nameLower = name.toLowerCase();
    const slug = subject.slug.toLowerCase();
    
    // Add exact name match
    normalization[nameLower] = name;
    
    // Add slug match
    if (slug !== nameLower) {
      normalization[slug] = name;
    }
    
    // Generate common variations for new subjects
    // Remove common words and create variations
    const words = nameLower.split(/\s+/);
    
    // Add first word as abbreviation if it's a multi-word subject
    if (words.length > 1) {
      const firstWord = words[0];
      if (firstWord.length >= 3) {
        normalization[firstWord] = name;
      }
    }
    
    // Add acronym if subject has multiple words
    if (words.length > 1) {
      const acronym = words.map(w => w[0]).join('');
      if (acronym.length >= 2) {
        normalization[acronym] = name;
      }
    }
    
    // Add variations without spaces
    const noSpace = nameLower.replace(/\s+/g, '');
    if (noSpace !== nameLower) {
      normalization[noSpace] = name;
    }
    
    // Add variations with hyphens
    const withHyphen = nameLower.replace(/\s+/g, '-');
    if (withHyphen !== nameLower && withHyphen !== noSpace) {
      normalization[withHyphen] = name;
    }
  });
  
  return normalization;
}

const CLASSES = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
const BOARDS = ['ICSE', 'CBSE', 'IGCSE', 'IB', 'State'];
const MODE_OF_TEACHING = ['Online', 'Offline'];

// --- NORMALIZATION MAPS ---
// Static subject normalization (merged with dynamic normalization)
const SUBJECT_NORMALIZATION: Record<string, string> = {
  // Maths variations
  'math': 'Maths', 'mathematics': 'Maths', 'maths': 'Maths',
  
  // Biology variations
  'bio': 'Biology', 'biology': 'Biology', 'biol': 'Biology',
  
  // Chemistry variations
  'chem': 'Chemistry', 'chemistry': 'Chemistry',
  
  // Physics variations
  'phy': 'Physics', 'physics': 'Physics',
  
  // English variations
  'eng': 'English', 'english': 'English',
  
  // Computers variations
  'comp': 'Computers', 'computer': 'Computers', 'computers': 'Computers', 'cs': 'Computers', 'it': 'Computers', 'coding': 'Computers',
  
  // History & Civics variations
  'hist': 'History & Civics', 'history': 'History & Civics', 'civics': 'History & Civics', 'history civics': 'History & Civics',
  
  // Geography variations
  'geo': 'Geography', 'geography': 'Geography',
  
  // Economics variations
  'eco': 'Economics', 'economics': 'Economics', 'econ': 'Economics',
  
  // Accounts variations
  'acc': 'Accounts', 'accounts': 'Accounts', 'accountancy': 'Accounts', 'accounting': 'Accounts',
  
  // Business Studies variations
  'bst': 'Business Studies', 'business studies': 'Business Studies', 'business': 'Business Studies', 'bs': 'Business Studies',
  
  // Political Science variations
  'pol sc': 'Political Science', 'political science': 'Political Science', 'pol science': 'Political Science', 'political': 'Political Science',
  
  // Environmental Science variations
  'evs': 'Environmental Science', 'env science': 'Environmental Science', 'environmental': 'Environmental Science', 'environmental science': 'Environmental Science',
  
  // Bengali variations
  'beng': 'Bengali', 'bengali': 'Bengali', 'bangla': 'Bengali',
  
  // Drawing & Painting variations
  'draw': 'Drawing & Painting', 'drawing': 'Drawing & Painting', 'art': 'Drawing & Painting', 'painting': 'Drawing & Painting', 'drawing painting': 'Drawing & Painting', 'drawing & painting': 'Drawing & Painting',
  
  // Science variations (maps to Science subject)
  'science': 'Science', 'sci': 'Science',
  
  // Social Studies variations
  'sst': 'Social Studies', 'social studies': 'Social Studies', 'social': 'Social Studies',
  
  // Sociology variations
  'soc': 'Sociology', 'sociology': 'Sociology',
  
  // Psychology variations
  'psy': 'Psychology', 'psychology': 'Psychology', 'psych': 'Psychology',
  
  // Hindi variations
  'hindi': 'Hindi',
  
  // Sanskrit variations
  'sanskrit': 'Sanskrit', 'sansk': 'Sanskrit',
  
  // Legal Studies variations
  'legal': 'Legal Studies', 'legal studies': 'Legal Studies', 'law': 'Legal Studies',
  
  // Home Science variations
  'home': 'Home Science', 'home science': 'Home Science', 'home sci': 'Home Science',
  
  // Competitive exams - ACT
  'act': 'ACT',
  
  // Competitive exams - AP
  'ap': 'AP', 'advanced placement': 'AP',
  
  // Competitive exams - CA
  'ca': 'CA', 'chartered accountant': 'CA', 'chartered accountancy': 'CA',
  
  // Competitive exams - CAT
  'cat': 'CAT', 'common admission test': 'CAT',
  
  // Competitive exams - JEE
  'jee': 'JEE', 'joint entrance exam': 'JEE', 'joint entrance examination': 'JEE',
  
  // Competitive exams - NEET
  'neet': 'NEET', 'national eligibility cum entrance test': 'NEET',
  
  // Competitive exams - NMAT
  'nmat': 'NMAT',
  
  // Competitive exams - SAT
  'sat': 'SAT', 'scholastic assessment test': 'SAT',

  // Competitive exams - CLAT
  'clat': 'CLAT', 'common law admission test': 'CLAT'
};

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'he', 'in', 'is', 'it', 'its', 'of', 'on', 'that', 'the', 'to', 'was', 'will', 'with', 'teacher', 'teachers', 'tutor', 'tutors', 'tuition', 'need', 'want', 'looking', 'find',
  // Conversational filler. Without these, "best physics teacher" leaves "best"
  // as the name query and fuzzy-matches it against real teacher names.
  // NOTE: do not add 'home' (subject key for Home Science) or 'class'/'classes'
  // (drive class-number extraction) — STOP_WORDS is checked before matching.
  'i', 'me', 'my', 'we', 'you', 'best', 'good', 'top', 'great', 'near', 'nearby', 'around', 'please', 'any', 'some', 'someone', 'who', 'can', 'get', 'give', 'show', 'search', 'help'
]);

// Experience filter buckets (same as FilterPanel). Map extracted years to bucket value.
const EXPERIENCE_BUCKETS = [20, 15, 10, 5, 3, 1];
function yearsToExperienceBucket(years: number): string | null {
  for (const bucket of EXPERIENCE_BUCKETS) {
    if (years >= bucket) return String(bucket);
  }
  return null;
}

const ADDRESS_INDICATORS = new Set([
  'sector', 'sec', 'ward', 'block', 'phase', 'lane', 'road', 'st', 'street', 'no', 'flat', 'apt', 'plot', 'number', 'pin'
]);

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    // Drop apostrophes so "ma'am" and "maam" normalise to the same token.
    .replace(/['’]/g, '')
    // Punctuation becomes a separator, so "maths,physics" and "Maths!" tokenise
    // the same way a space-separated query would. "+", "&" and "-" are kept:
    // they carry meaning in "10+ years", "Drawing & Painting" and "pre-school".
    .replace(/[^\p{L}\p{N}+&\-\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Optimal string alignment distance (Damerau-Levenshtein restricted to
 * adjacent transpositions).
 *
 * Plain Levenshtein scores a transposition as 2, which would miss the most
 * common phone typo: "englsih" for "english". Bails out early once the
 * distance cannot beat `max`.
 */
function editDistance(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;

  let prev2: number[] = [];
  let prev: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  let curr: number[] = [];

  for (let i = 1; i <= a.length; i++) {
    curr = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prev2[j - 2] + 1);
      }
      curr[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = curr;
  }
  return prev[b.length];
}

/**
 * Typo-tolerant lookup against a controlled vocabulary.
 *
 * Only runs as a last resort, after every exact subject/area/board match has
 * failed, so a correctly spelled term never reaches it. Kept deliberately
 * tight — one edit for short words, two for long ones, and the first letter
 * must match — because the tokens that land here are usually teacher names,
 * and a loose threshold would turn a name into a subject filter.
 */
function fuzzyVocabMatch(word: string, vocab: Iterable<string>): string | null {
  if (word.length < 5) return null;
  const budget = word.length >= 8 ? 2 : 1;

  let best: string | null = null;
  let bestDist = budget + 1;

  for (const term of vocab) {
    // Multi-word vocabulary entries aren't comparable to a single token.
    if (term.length < 5 || term.includes(' ')) continue;
    if (term[0] !== word[0]) continue;
    const d = editDistance(word, term, budget);
    if (d < bestDist) {
      bestDist = d;
      best = term;
      if (d === 1) break;
    }
  }
  return bestDist <= budget ? best : null;
}

/**
 * Removes a vocabulary term from the query as a whole word.
 *
 * Deliberately anchored: an unanchored replace lets the key "math" eat the
 * middle of "mathematics" and leave "ematics" behind, which then gets fuzzy
 * matched against teacher names. Escaped too, since these terms come from the
 * subjects table and may contain regex characters.
 */
function stripTerm(text: string, term: string): string {
  if (!term) return text;
  return text.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(term)}(?![\\p{L}\\p{N}])`, 'giu'), ' ');
}

export function extractFiltersFromQuery(query: string, subjects?: { name: string; slug: string }[]): Partial<FilterState> {
  if (!query || query.trim().length < 2) return {};

  const normalizedQuery = normalizeText(query);
  
  // Build subject normalization dynamically if subjects are provided
  const SUBJECT_NORMALIZATION = subjects ? buildSubjectNormalization(subjects) : BASE_SUBJECT_NORMALIZATION;
  
  const extractedFilters: Partial<FilterState> = {
    subjects: [], classes: [], boards: [], classSize: [], areas: [], modeOfTeaching: [], minExperience: null,
  };

  // --- STEP 1: Handle Multi-Word Areas & Subjects First (Priority) ---
  let remainingQuery = normalizedQuery;

  // 1A. Check Area Normalization Map (Multi-word matches)
  Object.keys(AREA_NORMALIZATION).forEach(key => {
    if (key.includes(' ') && remainingQuery.includes(key)) {
      const area = AREA_NORMALIZATION[key];
      if (!extractedFilters.areas!.includes(area)) {
        extractedFilters.areas!.push(area);
        remainingQuery = remainingQuery.replace(key, ''); 
      }
    }
  });

  // 1B. Check Subject Normalization Map (Multi-word matches)
  // Handle multi-word subjects first (e.g., "environmental science" before "science")
  Object.keys(SUBJECT_NORMALIZATION).forEach(key => {
    if (key.includes(' ') && remainingQuery.includes(key)) {
      const subject = SUBJECT_NORMALIZATION[key];
      if (!extractedFilters.subjects!.includes(subject)) {
        extractedFilters.subjects!.push(subject);
        remainingQuery = remainingQuery.replace(key, '');
      }
    }
  });
  
  // Handle composite subjects as standalone words (after multi-word matches to avoid conflicts)
  // This ensures "environmental science" is handled first, then standalone "science"
  
  // Science can mean either the subject "Science" OR the composite (Physics, Chemistry, Biology)
  // We'll add both "Science" subject and the composite subjects
  if (remainingQuery.includes('science') && !remainingQuery.includes('environmental science') && 
      !remainingQuery.includes('political science') && !remainingQuery.includes('home science')) {
    // Add "Science" as a subject
    if (!extractedFilters.subjects!.includes('Science')) {
      extractedFilters.subjects!.push('Science');
    }
    // Also add composite science subjects
    const scienceSubjects = ['Physics', 'Chemistry', 'Biology'];
    scienceSubjects.forEach(subj => {
      if (!extractedFilters.subjects!.includes(subj)) {
        extractedFilters.subjects!.push(subj);
      }
    });
    remainingQuery = remainingQuery.replace(/\bscience\b/gi, '');
  }
  
  // Social Studies / SST → Social Studies, History & Civics, Geography (all shown in advanced filters; filter matches History/Geography)
  if (remainingQuery.match(/\b(social\s+studies|sst)\b/gi)) {
    if (!extractedFilters.subjects!.includes('Social Studies')) {
      extractedFilters.subjects!.push('Social Studies');
    }
    const socialStudiesSubjects = ['History & Civics', 'Geography'];
    socialStudiesSubjects.forEach(subj => {
      if (!extractedFilters.subjects!.includes(subj)) {
        extractedFilters.subjects!.push(subj);
      }
    });
    remainingQuery = remainingQuery.replace(/\b(social\s+studies|sst)\b/gi, '');
  }
  
  // 2nd Language / 3rd Language → Hindi, Bengali, Sanskrit, German, French (and others)
  if (remainingQuery.match(/\b(2nd\s+lang|2nd\s+language|3rd\s+lang|3rd\s+language|second\s+lang|second\s+language|third\s+lang|third\s+language)\b/gi)) {
    const languageSubjects = ['Hindi', 'Bengali', 'Sanskrit', 'German', 'French'];
    languageSubjects.forEach(subj => {
      if (!extractedFilters.subjects!.includes(subj)) {
        extractedFilters.subjects!.push(subj);
      }
    });
    remainingQuery = remainingQuery.replace(/\b(2nd\s+lang|2nd\s+language|3rd\s+lang|3rd\s+language|second\s+lang|second\s+language|third\s+lang|third\s+language)\b/gi, '');
  }
  
  // Commerce → Commerce only (NOT Accounts, Economics, Business Studies)
  if (remainingQuery.match(/\bcommerce\b/gi)) {
    if (!extractedFilters.subjects!.includes('Commerce')) {
      extractedFilters.subjects!.push('Commerce');
    }
    remainingQuery = remainingQuery.replace(/\bcommerce\b/gi, '');
  }
  
  // Competitive Exams → SAT, ACT, CAT, NMAT, GMAT, CA, CFA, JEE
  if (remainingQuery.match(/\b(competitive\s+exam|competitive\s+exams)\b/gi)) {
    const competitiveSubjects = ['SAT', 'ACT', 'CAT', 'NMAT', 'GMAT', 'CA', 'CFA', 'JEE', 'CLAT'];
    competitiveSubjects.forEach(subj => {
      if (!extractedFilters.subjects!.includes(subj)) {
        extractedFilters.subjects!.push(subj);
      }
    });
    remainingQuery = remainingQuery.replace(/\b(competitive\s+exam|competitive\s+exams)\b/gi, '');
  }
  
  // CA / Chartered Accountant / Chartered Accountancy → CA
  if (remainingQuery.match(/\b(ca|chartered\s+accountant|chartered\s+accountancy)\b/gi)) {
    if (!extractedFilters.subjects!.includes('CA')) {
      extractedFilters.subjects!.push('CA');
    }
    remainingQuery = remainingQuery.replace(/\b(ca|chartered\s+accountant|chartered\s+accountancy)\b/gi, '');
  }
  
  // Humanities → Psychology, Sociology, Political Science, Legal Studies, Home Science
  if (remainingQuery.match(/\bhumanities\b/gi)) {
    const humanitiesSubjects = ['Psychology', 'Sociology', 'Political Science'];
    // Note: Legal Studies and Home Science will be added when they exist in database
    humanitiesSubjects.forEach(subj => {
      if (!extractedFilters.subjects!.includes(subj)) {
        extractedFilters.subjects!.push(subj);
      }
    });
    remainingQuery = remainingQuery.replace(/\bhumanities\b/gi, '');
  }
  
  // Literature / Language → English
  if (remainingQuery.match(/\b(literature|language)\b/gi)) {
    if (!extractedFilters.subjects!.includes('English')) {
      extractedFilters.subjects!.push('English');
    }
    remainingQuery = remainingQuery.replace(/\b(literature|language)\b/gi, '');
  }

  // --- Experience extraction (e.g. "5 years experience", "10+ yrs", "experienced") ---
  const experiencePatterns = [
    /\b(\d+)\s*\+\s*(?:year|years|yr|yrs)(?:\s+experience)?\b/gi,
    /\b(?:year|years|yr|yrs)?\s*(\d+)\s*(?:year|years|yr|yrs)(?:\s+experience)?\b/gi,
    /\bexperienced\b/gi,
  ];
  for (const re of experiencePatterns) {
    const m = remainingQuery.match(re);
    if (m) {
      if (/\bexperienced\b/i.test(m[0])) {
        extractedFilters.minExperience = '5';
        remainingQuery = remainingQuery.replace(/\bexperienced\b/gi, ' ');
      } else {
        const numRe = /(\d+)/;
        const numMatch = m[0].match(numRe);
        if (numMatch) {
          const years = parseInt(numMatch[1], 10);
          if (years >= 1 && years <= 99) {
            const bucket = yearsToExperienceBucket(years);
            if (bucket) {
              extractedFilters.minExperience = bucket;
              remainingQuery = remainingQuery.replace(re, ' ');
            }
          }
        }
      }
      break;
    }
  }

  // --- STEP 2: Process Single Words ---
  const words = remainingQuery.split(/\s+/).filter(w => w.length > 0);

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const prevWord = i > 0 ? words[i-1] : '';

    if (STOP_WORDS.has(word)) continue;

    // A. Class Extraction
    if (['class', 'grade', 'std', 'standard'].includes(word)) {
      const nextWord = words[i+1];
      if (nextWord && /^\d+$/.test(nextWord)) {
        if (CLASSES.includes(nextWord)) extractedFilters.classes!.push(nextWord);
        i++; 
        continue;
      }
      continue;
    }
    
    if (/^\d+(th|nd|rd|st)$/.test(word)) {
      const num = word.replace(/\D/g, '');
      if (CLASSES.includes(num)) extractedFilters.classes!.push(num);
      continue;
    }

    if (/^\d+$/.test(word)) {
      if (ADDRESS_INDICATORS.has(prevWord)) continue; 
      if (CLASSES.includes(word)) extractedFilters.classes!.push(word);
      continue;
    }

            // B. Subject Matching
            // Special handling for composite subjects
            
            // Science can mean either the subject "Science" OR the composite (Physics, Chemistry, Biology)
            // We'll add both "Science" subject and the composite subjects
            if (word === 'science' || word === 'sci') {
              // Add "Science" as a subject
              if (!extractedFilters.subjects!.includes('Science')) {
                extractedFilters.subjects!.push('Science');
              }
              // Also add composite science subjects
              const scienceSubjects = ['Physics', 'Chemistry', 'Biology'];
              scienceSubjects.forEach(subj => {
                if (!extractedFilters.subjects!.includes(subj)) extractedFilters.subjects!.push(subj);
              });
              continue;
            }
            
            // SST → Social Studies, History & Civics, Geography
            if (word === 'sst') {
              if (!extractedFilters.subjects!.includes('Social Studies')) extractedFilters.subjects!.push('Social Studies');
              const socialStudiesSubjects = ['History & Civics', 'Geography'];
              socialStudiesSubjects.forEach(subj => {
                if (!extractedFilters.subjects!.includes(subj)) extractedFilters.subjects!.push(subj);
              });
              continue;
            }
            
            // Commerce → Commerce only
            if (word === 'commerce') {
              if (!extractedFilters.subjects!.includes('Commerce')) {
                extractedFilters.subjects!.push('Commerce');
              }
              continue;
            }
            
            // CA → CA
            if (word === 'ca') {
              if (!extractedFilters.subjects!.includes('CA')) {
                extractedFilters.subjects!.push('CA');
              }
              continue;
            }
            
            // Humanities → Psychology, Sociology, Political Science
            if (word === 'humanities') {
              const humanitiesSubjects = ['Psychology', 'Sociology', 'Political Science'];
              humanitiesSubjects.forEach(subj => {
                if (!extractedFilters.subjects!.includes(subj)) extractedFilters.subjects!.push(subj);
              });
              continue;
            }
            
            // Literature / Language → English
            if (word === 'literature' || word === 'language') {
              if (!extractedFilters.subjects!.includes('English')) {
                extractedFilters.subjects!.push('English');
              }
              continue;
            }
            
            // Check normalization map (built dynamically)
            if (SUBJECT_NORMALIZATION[word]) {
              const subject = SUBJECT_NORMALIZATION[word];
              if (!extractedFilters.subjects!.includes(subject)) extractedFilters.subjects!.push(subject);
              continue;
            }
            
            // Also check direct subject name matches from database.
            // Require subject name/slug to be at least 4 chars when matching as substring of query,
            // so "aparna" (a name) is not matched as subject "AP" (word.includes("ap")).
            // Require word boundary when subject contains query so "social" matches "Social Studies" not "Sociology".
            const MIN_SUBJECT_LENGTH_FOR_SUBSTRING = 4;
            if (subjects) {
              const wordBoundary = new RegExp(`\\b${escapeRegex(word)}\\b`);
              const directSubjectMatch = subjects.find(s => {
                const nameLower = s.name.toLowerCase();
                const slug = s.slug.toLowerCase();
                const exactMatch = nameLower === word || slug === word;
                const queryContainsSubject = (key: string) => key.length >= MIN_SUBJECT_LENGTH_FOR_SUBSTRING && word.includes(key);
                const subjectContainsQueryAsWord = wordBoundary.test(nameLower) || wordBoundary.test(slug);
                return exactMatch || subjectContainsQueryAsWord || queryContainsSubject(nameLower) || queryContainsSubject(slug);
              });
              if (directSubjectMatch && !extractedFilters.subjects!.includes(directSubjectMatch.name)) {
                extractedFilters.subjects!.push(directSubjectMatch.name);
                continue;
              }
            }

    // C. Area Matching
    // 1. Check normalization map (Handles "tollygunj", "bhowanipur", "alipur")
    if (AREA_NORMALIZATION[word]) {
      const area = AREA_NORMALIZATION[word];
      if (!extractedFilters.areas!.includes(area)) extractedFilters.areas!.push(area);
      continue;
    }
    
    // 2. Check DIRECTLY against the main AREAS list (Handles "Alipore", "Kasba", "Ruby")
    const directAreaMatch = AREAS.find(a => a.toLowerCase() === word);
    if (directAreaMatch) {
      if (!extractedFilters.areas!.includes(directAreaMatch)) extractedFilters.areas!.push(directAreaMatch);
      continue;
    }

    // D. Board Matching
    const boardMatch = BOARDS.find(b => b.toLowerCase() === word);
    if (boardMatch) {
      extractedFilters.boards!.push(boardMatch);
      continue;
    }

    // E. Mode & Size
    if (word === 'online' || word === 'offline') {
      extractedFilters.modeOfTeaching!.push(word.charAt(0).toUpperCase() + word.slice(1));
      continue;
    }
    if (word === 'group' || word === 'solo') {
      extractedFilters.classSize!.push(word.charAt(0).toUpperCase() + word.slice(1));
      continue;
    }

    // F. Typo fallback — last resort, so correctly spelled terms never reach it.
    // Without this, "phyics" or "englsih" extracted nothing at all and the whole
    // query fell through to a name search that could not match either.
    const fuzzySubjectKey = fuzzyVocabMatch(word, Object.keys(SUBJECT_NORMALIZATION));
    if (fuzzySubjectKey) {
      const subject = SUBJECT_NORMALIZATION[fuzzySubjectKey];
      if (!extractedFilters.subjects!.includes(subject)) extractedFilters.subjects!.push(subject);
      continue;
    }

    const fuzzyAreaKey = fuzzyVocabMatch(word, Object.keys(AREA_NORMALIZATION));
    if (fuzzyAreaKey) {
      const area = AREA_NORMALIZATION[fuzzyAreaKey];
      if (!extractedFilters.areas!.includes(area)) extractedFilters.areas!.push(area);
      continue;
    }
  }

  // --- STEP 3: Cleanup ---
  const result: Partial<FilterState> = {};
  if (extractedFilters.subjects!.length) result.subjects = [...new Set(extractedFilters.subjects)];
  if (extractedFilters.classes!.length) result.classes = [...new Set(extractedFilters.classes)];
  if (extractedFilters.boards!.length) result.boards = [...new Set(extractedFilters.boards)];
  if (extractedFilters.areas!.length) result.areas = [...new Set(extractedFilters.areas)];
  if (extractedFilters.classSize!.length) result.classSize = [...new Set(extractedFilters.classSize)];
  if (extractedFilters.modeOfTeaching!.length) result.modeOfTeaching = [...new Set(extractedFilters.modeOfTeaching)];
  if (extractedFilters.minExperience != null) result.minExperience = extractedFilters.minExperience;

  return result;
}

/**
 * Extracts the name part from a query by removing filter keywords.
 * This helps identify when a user is searching for both a name and filters.
 * @param query The search query (e.g., "aparna chemistry")
 * @param extractedFilters The filters that were extracted from the query
 * @returns The remaining query text that likely contains a name
 */
export function extractNameFromQuery(query: string, extractedFilters: Partial<FilterState>, subjects?: { name: string; slug: string }[]): string {
  if (!query || query.trim().length < 3) {
    return '';
  }

  // Build subject normalization dynamically if subjects are provided
  const SUBJECT_NORMALIZATION = subjects ? buildSubjectNormalization(subjects) : BASE_SUBJECT_NORMALIZATION;

  let remainingQuery = normalizeText(query);

  // Remove extracted subjects from query
  if (extractedFilters.subjects && extractedFilters.subjects.length > 0) {
    extractedFilters.subjects.forEach(subject => {
      // Remove subject and its variations
      remainingQuery = stripTerm(remainingQuery, subject.toLowerCase());
      // Also check normalization map. Longest keys first so "mathematics" is
      // consumed whole rather than "math" clipping it to "ematics".
      Object.entries(SUBJECT_NORMALIZATION)
        .filter(([, value]) => value === subject)
        .sort(([a], [b]) => b.length - a.length)
        .forEach(([key]) => {
          remainingQuery = stripTerm(remainingQuery, key);
        });
    });
  }

  // Remove extracted classes from query
  if (extractedFilters.classes && extractedFilters.classes.length > 0) {
    extractedFilters.classes.forEach(cls => {
      // Remove "class X", "Xth", or just "X"
      remainingQuery = remainingQuery.replace(new RegExp(`\\bclass\\s*${cls}\\b`, 'gi'), '');
      remainingQuery = remainingQuery.replace(new RegExp(`\\b${cls}(th|nd|rd|st)\\b`, 'gi'), '');
      remainingQuery = remainingQuery.replace(new RegExp(`\\b${cls}\\b`, 'gi'), '');
    });
  }

  // Remove extracted areas from query
  if (extractedFilters.areas && extractedFilters.areas.length > 0) {
    extractedFilters.areas.forEach(area => {
      remainingQuery = stripTerm(remainingQuery, area.toLowerCase());
      // Also check normalization map (longest alias first)
      Object.entries(AREA_NORMALIZATION)
        .filter(([, value]) => value === area)
        .sort(([a], [b]) => b.length - a.length)
        .forEach(([key]) => {
          remainingQuery = stripTerm(remainingQuery, key);
        });
    });
  }

  // Remove extracted boards from query
  if (extractedFilters.boards && extractedFilters.boards.length > 0) {
    extractedFilters.boards.forEach(board => {
      remainingQuery = stripTerm(remainingQuery, board.toLowerCase());
    });
  }

  // Remove experience phrases so they don't end up in name part
  if (extractedFilters.minExperience != null) {
    remainingQuery = remainingQuery.replace(/\b\d+\s*\+\s*(?:year|years|yr|yrs)(?:\s+experience)?\b/gi, ' ');
    remainingQuery = remainingQuery.replace(/\b(?:\d+\s+)?(?:year|years|yr|yrs)(?:\s+experience)?\b/gi, ' ');
    remainingQuery = remainingQuery.replace(/\bexperienced\b/gi, ' ');
  }

  // Remove stop words and clean up
  const words = remainingQuery.split(/\s+/).filter(w => {
    const word = w.trim();
    if (word.length === 0 || STOP_WORDS.has(word)) return false;

    // A misspelled term that the extractor resolved fuzzily is still sitting
    // here verbatim — stripTerm only removes correctly spelled aliases. Left in,
    // "phyics" would extract Physics *and* run a name search for "phyics" that
    // matches nobody, which is worse than not understanding the typo at all.
    const fuzzySubject = fuzzyVocabMatch(word, Object.keys(SUBJECT_NORMALIZATION));
    if (fuzzySubject && extractedFilters.subjects?.includes(SUBJECT_NORMALIZATION[fuzzySubject])) return false;

    const fuzzyArea = fuzzyVocabMatch(word, Object.keys(AREA_NORMALIZATION));
    if (fuzzyArea && extractedFilters.areas?.includes(AREA_NORMALIZATION[fuzzyArea])) return false;

    return true;
  });

  return words.join(' ').trim();
}
