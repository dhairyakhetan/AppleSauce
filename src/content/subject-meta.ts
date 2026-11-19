/**
 * Subject page search metadata: the ONE source for the title and description
 * of every /{subject}-tuition-teachers-in-kolkata route.
 *
 * SubjectPage.tsx (what the browser sets) and scripts/prerender.ts (what a
 * crawler that does not run JavaScript reads) both import from here. They used
 * to hold separate copies and had drifted: the prerender derived its label by
 * title-casing the URL, so "sat" became "Sat" and "ca" became "Ca".
 *
 * The URL and the H1 keep "tuition teachers in Kolkata"; only the <title> says
 * "Home Tutors" (owner-approved SEO brief, 2026-09-30).
 */

export interface SubjectMeta {
  /** How the subject is written in prose: "Maths", "SAT", "Business Studies". */
  label: string;
  description: string;
}

/** `{Subject} Home Tutors in Kolkata: Verified Tuition Teachers | Shikshaq` */
export function subjectSeoTitle(label: string): string {
  return `${label} Home Tutors in Kolkata: Verified Tuition Teachers | Shikshaq`;
}

export const SUBJECT_META: Record<string, SubjectMeta> = {
  '/maths-tuition-teachers-in-kolkata': {
    label: 'Maths',
    description: 'Find experienced Maths tutors in Kolkata for CBSE, ICSE, IGCSE, State Board, and JEE preparation. Connect directly for free. No commission, no middlemen.',
  },
  '/english-tuition-teachers-in-kolkata': {
    label: 'English',
    description: 'Find English tutors in Kolkata for all boards and classes. Language, literature, grammar, and writing skills. Connect directly for free on Shikshaq.',
  },
  '/science-tuition-teachers-in-kolkata': {
    label: 'Science',
    description: 'Find Science tutors in Kolkata covering Physics, Chemistry, and Biology for Classes 6-12. CBSE, ICSE, IGCSE, and State Board. Free on Shikshaq.',
  },
  '/physics-tuition-teachers-in-kolkata': {
    label: 'Physics',
    description: 'Find Physics tutors in Kolkata for Classes 9-12 and JEE preparation. CBSE, ICSE, IGCSE, and State Board. Connect directly for free on Shikshaq.',
  },
  '/chemistry-tuition-teachers-in-kolkata': {
    label: 'Chemistry',
    description: 'Find Chemistry tutors in Kolkata for Classes 9-12 and JEE/NEET preparation. CBSE, ICSE, IGCSE, and State Board. Connect directly for free on Shikshaq.',
  },
  '/biology-tuition-teachers-in-kolkata': {
    label: 'Biology',
    description: 'Find Biology tutors in Kolkata for Classes 9-12 and NEET preparation. CBSE, ICSE, IGCSE, and State Board. Connect directly for free on Shikshaq.',
  },
  '/computer-tuition-teachers-in-kolkata': {
    label: 'Computer',
    description: 'Find Computer Science tutors in Kolkata for programming (Python, Java, C++), IT fundamentals, and school curricula. Free on Shikshaq.',
  },
  '/hindi-tuition-teachers-in-kolkata': {
    label: 'Hindi',
    description: 'Find Hindi language and literature tutors in Kolkata for CBSE, ICSE, and IGCSE students. Connect directly for free on Shikshaq.',
  },
  '/history-tuition-teachers-in-kolkata': {
    label: 'History',
    description: 'Find History tutors in Kolkata for Indian and world history, Classes 6-12. CBSE, ICSE, and State Board. Connect directly for free on Shikshaq.',
  },
  '/geography-tuition-teachers-in-kolkata': {
    label: 'Geography',
    description: 'Find Geography tutors in Kolkata for physical and human geography, Classes 6-12. CBSE, ICSE, and State Board. Connect directly for free on Shikshaq.',
  },
  '/economics-tuition-teachers-in-kolkata': {
    label: 'Economics',
    description: 'Find Economics tutors in Kolkata for micro and macro economics, Classes 11-12, and competitive exams. Connect directly for free on Shikshaq.',
  },
  '/accounts-tuition-teachers-in-kolkata': {
    label: 'Accounts',
    description: 'Find Accounts tutors in Kolkata for Classes 11-12 and CA preparation. CBSE, ICSE, and State Board. Connect directly for free on Shikshaq.',
  },
  '/business-studies-tuition-teachers-in-kolkata': {
    label: 'Business Studies',
    description: 'Find Business Studies tutors in Kolkata for Classes 11-12 across all boards. Connect directly for free on Shikshaq.',
  },
  '/commerce-tuition-teachers-in-kolkata': {
    label: 'Commerce',
    description: 'Find Commerce tutors in Kolkata covering Accounts, Economics, and Business Studies for Classes 11-12. Connect directly for free on Shikshaq.',
  },
  '/commercial-studies-tuition-teachers-in-kolkata': {
    label: 'Commercial Studies',
    description: 'Find Commercial Studies tutors in Kolkata. Practical business education and commercial applications. Connect directly for free on Shikshaq.',
  },
  '/psychology-tuition-teachers-in-kolkata': {
    label: 'Psychology',
    description: 'Find Psychology tutors in Kolkata for IGCSE, IB, and Class 11-12. Behavioural sciences and introduction to psychology. Connect directly for free on Shikshaq.',
  },
  '/sociology-tuition-teachers-in-kolkata': {
    label: 'Sociology',
    description: 'Find Sociology tutors in Kolkata for Classes 11-12. Social structures, culture, and society. Connect directly for free on Shikshaq.',
  },
  '/political-science-tuition-teachers-in-kolkata': {
    label: 'Political Science',
    description: 'Find Political Science tutors in Kolkata for Indian polity and international relations, Classes 11-12. Connect directly for free on Shikshaq.',
  },
  '/environmental-science-tuition-teachers-in-kolkata': {
    label: 'Environmental Science',
    description: 'Find Environmental Science tutors in Kolkata for primary and middle school students. Connect directly for free on Shikshaq.',
  },
  '/bengali-tuition-teachers-in-kolkata': {
    label: 'Bengali',
    description: 'Find Bengali language tutors in Kolkata for CBSE, ICSE, and West Bengal State Board students. Connect directly for free on Shikshaq.',
  },
  '/drawing-tuition-teachers-in-kolkata': {
    label: 'Drawing',
    description: 'Find Drawing and Painting tutors in Kolkata for art, sketching, and visual arts for all age groups. Connect directly for free on Shikshaq.',
  },
  '/sat-tuition-teachers-in-kolkata': {
    label: 'SAT',
    description: 'Find SAT tutors in Kolkata for Digital SAT preparation and US college admissions. Connect directly for free on Shikshaq.',
  },
  '/act-tuition-teachers-in-kolkata': {
    label: 'ACT',
    description: 'Find ACT tutors in Kolkata for American College Testing preparation. Connect directly for free on Shikshaq.',
  },
  '/cat-tuition-teachers-in-kolkata': {
    label: 'CAT',
    description: 'Find CAT tutors in Kolkata for MBA entrance preparation. Connect directly for free on Shikshaq.',
  },
  '/nmat-tuition-teachers-in-kolkata': {
    label: 'NMAT',
    description: 'Find NMAT tutors in Kolkata for NMIMS Management Aptitude Test preparation. Connect directly for free on Shikshaq.',
  },
  '/gmat-tuition-teachers-in-kolkata': {
    label: 'GMAT',
    description: 'Find GMAT tutors in Kolkata for Graduate Management Admission Test preparation. Connect directly for free on Shikshaq.',
  },
  '/ca-tuition-teachers-in-kolkata': {
    label: 'CA',
    description: 'Find CA tutors in Kolkata for Chartered Accountancy foundation, intermediate, and final preparation. Connect directly for free on Shikshaq.',
  },
  '/cfa-tuition-teachers-in-kolkata': {
    label: 'CFA',
    description: 'Find CFA tutors in Kolkata for Chartered Financial Analyst certification preparation. Connect directly for free on Shikshaq.',
  },
  '/clat-tuition-teachers-in-kolkata': {
    label: 'CLAT',
    description: 'Find CLAT tutors in Kolkata for Common Law Admission Test preparation. Connect directly for free on Shikshaq.',
  },
  '/social-studies-tuition-teachers-in-kolkata': {
    label: 'Social Studies',
    description: 'Find Social Studies tutors in Kolkata covering History, Civics, and Geography. Connect directly for free on Shikshaq.',
  },
};
