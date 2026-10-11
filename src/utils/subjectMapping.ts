// Map of subject path slugs to subject filter values
// Special cases:
// - Science maps to Physics, Chemistry, Biology (comma-separated = OR logic)
// - Commercial Studies maps to Commerce
export const SUBJECT_PATH_TO_FILTER: Record<string, string> = {
  '/maths-tuition-teachers-in-kolkata': 'Maths',
  '/english-tuition-teachers-in-kolkata': 'English',
  '/science-tuition-teachers-in-kolkata': 'Physics,Chemistry,Biology', // Science = Physics OR Chemistry OR Biology
  '/commercial-studies-tuition-teachers-in-kolkata': 'Commerce', // Commercial Studies = Commerce
  '/physics-tuition-teachers-in-kolkata': 'Physics',
  '/chemistry-tuition-teachers-in-kolkata': 'Chemistry',
  '/biology-tuition-teachers-in-kolkata': 'Biology',
  '/computer-tuition-teachers-in-kolkata': 'Computers',
  '/hindi-tuition-teachers-in-kolkata': 'Hindi',
  '/history-tuition-teachers-in-kolkata': 'History & Civics', // Note: FilterPanel uses 'History & Civics'
  '/geography-tuition-teachers-in-kolkata': 'Geography',
  '/social-studies-tuition-teachers-in-kolkata': 'History & Civics,Geography', // Social Studies = History & Civics OR Geography
  '/economics-tuition-teachers-in-kolkata': 'Economics',
  '/accounts-tuition-teachers-in-kolkata': 'Accounts',
  '/business-studies-tuition-teachers-in-kolkata': 'Business Studies',
  '/commerce-tuition-teachers-in-kolkata': 'Commerce',
  '/psychology-tuition-teachers-in-kolkata': 'Psychology',
  '/sociology-tuition-teachers-in-kolkata': 'Sociology',
  '/political-science-tuition-teachers-in-kolkata': 'Political Science',
  '/environmental-science-tuition-teachers-in-kolkata': 'Environmental Science',
  '/bengali-tuition-teachers-in-kolkata': 'Bengali',
  '/drawing-tuition-teachers-in-kolkata': 'Drawing & Painting',
  '/sat-tuition-teachers-in-kolkata': 'SAT',
  '/act-tuition-teachers-in-kolkata': 'ACT',
  '/cat-tuition-teachers-in-kolkata': 'CAT',
  '/nmat-tuition-teachers-in-kolkata': 'NMAT',
  '/gmat-tuition-teachers-in-kolkata': 'GMAT',
  '/ca-tuition-teachers-in-kolkata': 'CA',
  '/cfa-tuition-teachers-in-kolkata': 'CFA',
  '/clat-tuition-teachers-in-kolkata': 'CLAT',
};

/**
 * Get the filter query parameter for a subject path
 * @param path The subject page path (e.g., '/biology-tuition-teachers-in-kolkata')
 * @returns The filter query string (e.g., '?filter_subjects=Biology')
 */
export function getSubjectFilterQuery(path: string): string {
  const filterValue = SUBJECT_PATH_TO_FILTER[path];
  if (!filterValue) return '';
  return `?filter_subjects=${encodeURIComponent(filterValue)}`;
}

