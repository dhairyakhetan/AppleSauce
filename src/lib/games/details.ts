/**
 * Board, class, subject, chapter and topic: reading them, checking them, writing them the same way every time,
 * and the chapter and topic IDs made from them.
 *
 * Chapter ID = board code + class (2 digits) + subject code (3 letters) + chapter number (2 digits): CBSE11CHE01.
 * Topic ID   = chapter ID + "T" + topic number (2 digits): CBSE11CHE01T03.
 * The same details always give the same ID, so questions can be linked to their chapter without looking anything up.
 */

// ---------------------------------------------------------------- text

/** Collapses spaces and removes Markdown bold and wrappers or quotes around the whole text. Never touches the words. */
export function tidy(s: string): string {
  let t = s.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
  for (;;) {
    const m = t.match(/^(__|`|"|“)(.+)(__|`|"|”)$/);
    if (!m || (m[1] === '“' ? '”' : m[1]) !== m[3]) return t;
    t = m[2].trim();
  }
}

const SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'into', 'nor', 'of', 'on', 'or', 'per', 'than', 'the', 'to', 'via', 'vs', 'with']);
const ROMAN_WORD = /^(?:ii|iii|iv|vi|vii|viii|ix|xi|xii)$/;

/**
 * Capitalises the start of each word: "chemical reactions and equations" → "Chemical Reactions and Equations".
 * Short joining words stay lower case unless they start the name or follow ":", "–" or "(".
 * Words that already contain a capital or a digit (DNA, pH, CO2) are left as they are; Roman numerals become upper case.
 */
export function titleCase(s: string): string {
  let start = true;
  return s.replace(/[\p{L}\p{N}][\p{L}\p{N}\p{M}'’]*|[:–—(]|\s-\s/gu, (tok) => {
    if (/^(?:[:–—(]|\s-\s)$/u.test(tok)) { start = true; return tok; }
    const first = start;
    start = false;
    if (/\d/.test(tok) || tok !== tok.toLowerCase()) return tok;
    if (ROMAN_WORD.test(tok)) return tok.toUpperCase();
    if (!first && SMALL.has(tok)) return tok;
    return tok[0].toUpperCase() + tok.slice(1);
  });
}

/** Edit distance (insertions, deletions, substitutions), for "did you mean" hints. */
export function distance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

export const pad2 = (n: number) => String(n).padStart(2, '0');

export type Level = 'error' | 'warn';
export interface Problem { level: Level; text: string }

export const MAX_NO = 99;
export const MAX_NAME = 120;

// ---------------------------------------------------------------- boards
// From COBSE's list of recognised boards (cobse.net.in) and the boards' own names. A board not on these lists can't be
// used: the formatter says so, and the database refuses it (private.boards in supabase/schema.sql has the same list).

export interface Board { name: string; code: string; also: string[] }

/** National and international boards, and the recognised boards run by universities. */
export const BOARDS: Board[] = [
  { name: 'CBSE', code: 'CBSE', also: ['central board of secondary education', 'ncert'] },
  { name: 'ICSE', code: 'ICSE', also: ['cisce', 'indian certificate of secondary education', 'council for the indian school certificate examinations'] },
  { name: 'ISC', code: 'ISC', also: ['indian school certificate'] },
  { name: 'NIOS', code: 'NIOS', also: ['national institute of open schooling'] },
  { name: 'IB', code: 'IB', also: ['international baccalaureate', 'ib diploma', 'ib dp', 'ib myp', 'ib pyp'] },
  { name: 'IGCSE', code: 'IGCSE', also: ['cambridge igcse', 'international gcse'] },
  { name: 'Cambridge', code: 'CAIE', also: ['caie', 'cie', 'cambridge international', 'cambridge assessment international education', 'a level', 'a levels', 'as level', 'o level', 'o levels'] },
  { name: 'Edexcel', code: 'EDEX', also: ['pearson edexcel', 'pearson', 'edexcel igcse', 'international a level', 'international a levels'] },
  { name: 'Aligarh Muslim University Board', code: 'AMU', also: ['amu', 'aligarh muslim university', 'amu board of secondary and senior secondary education'] },
  { name: 'Jamia Millia Islamia', code: 'JMI', also: ['jmi', 'jamia'] },
  { name: 'Banasthali Vidyapith', code: 'BANV', also: ['banasthali'] },
  { name: 'Dayalbagh Educational Institute', code: 'DEI', also: ['dei', 'dayalbagh'] },
  { name: 'Maharishi Patanjali Sanskrit Sansthan', code: 'MPSS', also: ['mpss'] },
];

/** Each state's main school board: the state's name and its two-letter code, plus the board's own names. */
export const STATES: Board[] = [
  { name: 'Andhra Pradesh', code: 'AP', also: ['bseap', 'bieap', 'ap'] },
  { name: 'Assam', code: 'AS', also: ['seba', 'ahsec'] },
  { name: 'Bihar', code: 'BR', also: ['bseb', 'bihar board'] },
  { name: 'Chhattisgarh', code: 'CG', also: ['cgbse'] },
  { name: 'Delhi', code: 'DL', also: ['dbse', 'delhi board of school education'] },
  { name: 'Goa', code: 'GA', also: ['gbshse'] },
  { name: 'Gujarat', code: 'GJ', also: ['gseb', 'gshseb'] },
  { name: 'Haryana', code: 'HR', also: ['hbse', 'bseh'] },
  { name: 'Himachal Pradesh', code: 'HP', also: ['hpbose', 'hp'] },
  { name: 'Jammu and Kashmir', code: 'JK', also: ['jkbose', 'j and k'] },
  { name: 'Jharkhand', code: 'JH', also: ['jac'] },
  { name: 'Karnataka', code: 'KA', also: ['kseeb', 'kseab', 'dpue', 'karnataka puc'] },
  { name: 'Kerala', code: 'KL', also: ['kbpe', 'dhse'] },
  { name: 'Madhya Pradesh', code: 'MP', also: ['mpbse', 'mp'] },
  { name: 'Maharashtra', code: 'MH', also: ['msbshse'] },
  { name: 'Manipur', code: 'MN', also: ['bosem', 'bsem', 'cohsem'] },
  { name: 'Meghalaya', code: 'ML', also: ['mbose'] },
  { name: 'Mizoram', code: 'MZ', also: ['mbse'] },
  { name: 'Nagaland', code: 'NL', also: ['nbse'] },
  { name: 'Odisha', code: 'OD', also: ['orissa', 'bse odisha', 'chse', 'chse odisha'] },
  { name: 'Punjab', code: 'PB', also: ['pseb'] },
  { name: 'Rajasthan', code: 'RJ', also: ['rbse', 'bser'] },
  { name: 'Tamil Nadu', code: 'TN', also: ['tnbse', 'samacheer', 'samacheer kalvi', 'dge tn', 'tn'] },
  { name: 'Telangana', code: 'TS', also: ['bsets', 'bse ts', 'tsbie'] },
  { name: 'Tripura', code: 'TR', also: ['tbse'] },
  { name: 'Uttar Pradesh', code: 'UP', also: ['upmsp', 'up'] },
  { name: 'Uttarakhand', code: 'UK', also: ['ubse', 'uttaranchal'] },
  { name: 'West Bengal', code: 'WB', also: ['wbbse', 'wbchse', 'wb'] },
];

/** Places whose schools follow another board (usually CBSE), so a "state board" for them is a mistake. */
const NO_BOARD = ['arunachal pradesh', 'sikkim', 'ladakh', 'puducherry', 'pondicherry', 'chandigarh', 'andaman and nicobar', 'lakshadweep', 'dadra and nagar haveli', 'daman and diu'];

type Kind = 'open' | 'madrasa' | 'sanskrit';
/** A state's other recognised boards: open schools, madrasa boards and Sanskrit boards. */
export const STATE_BOARDS: (Board & { state: string; kind: Kind })[] = [
  { state: 'Andhra Pradesh', kind: 'open', name: 'Andhra Pradesh Open School Society', code: 'APOSS', also: ['aposs'] },
  { state: 'Bihar', kind: 'open', name: 'Bihar Board of Open Schooling and Examination', code: 'BBOSE', also: ['bbose'] },
  { state: 'Chhattisgarh', kind: 'open', name: 'Chhattisgarh State Open School', code: 'CGSOS', also: ['cgsos'] },
  { state: 'Madhya Pradesh', kind: 'open', name: 'Madhya Pradesh State Open School', code: 'MPSOS', also: ['mpsos'] },
  { state: 'Rajasthan', kind: 'open', name: 'Rajasthan State Open School', code: 'RSOS', also: ['rsos'] },
  { state: 'Telangana', kind: 'open', name: 'Telangana Open School Society', code: 'TOSS', also: ['toss'] },
  { state: 'Bihar', kind: 'madrasa', name: 'Bihar State Madrasa Education Board', code: 'BSMEB', also: ['bsmeb'] },
  { state: 'Chhattisgarh', kind: 'madrasa', name: 'Chhattisgarh Madrasa Board', code: 'CGMB', also: [] },
  { state: 'Uttar Pradesh', kind: 'madrasa', name: 'Uttar Pradesh Board of Madrasa Education', code: 'UPBME', also: ['upbme'] },
  { state: 'Uttarakhand', kind: 'madrasa', name: 'Uttarakhand Madrasa Education Board', code: 'UKMEB', also: [] },
  { state: 'West Bengal', kind: 'madrasa', name: 'West Bengal Board of Madrasah Education', code: 'WBBME', also: ['wbbme'] },
  { state: 'Bihar', kind: 'sanskrit', name: 'Bihar Sanskrit Shiksha Board', code: 'BSSB', also: ['bssb'] },
  { state: 'Chhattisgarh', kind: 'sanskrit', name: 'Chhattisgarh Sanskrit Board', code: 'CGSB', also: [] },
  { state: 'Uttar Pradesh', kind: 'sanskrit', name: 'Uttar Pradesh Madhyamik Sanskrit Shiksha Parishad', code: 'UPSSP', also: ['upmssp'] },
  { state: 'Uttarakhand', kind: 'sanskrit', name: 'Uttarakhand Sanskrit Shiksha Parishad', code: 'USSP', also: ['ussp'] },
];

/** Every board, by the name the site writes it with (a state's main board is "Maharashtra State Board"). */
export const ALL_BOARDS: Board[] = [...BOARDS, ...STATES.map((s) => ({ ...s, name: `${s.name} State Board` })), ...STATE_BOARDS];

const key = (s: string) => tidy(s).normalize('NFC').toLowerCase().replace(/&/g, ' and ').replace(/[.]/g, '').replace(/\s+/g, ' ').trim();
const words = (s: string) => new RegExp(`(^|[^a-z])${s}($|[^a-z])`);
const tokens = (s: string) => s.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
/** Words that only say "it's a board": "Bihar School Examination Board" is just the Bihar board. */
const FILLER = new Set(['a', 'the', 'of', 'and', 'for', 'board', 'boards', 'state', 'council', 'school', 'schools', 'schooling', 'secondary', 'higher',
  'senior', 'intermediate', 'education', 'educational', 'examination', 'examinations', 'exam', 'exams', 'academic', 'syllabus', 'curriculum', 'govt',
  'government', 'department', 'dept', 'puc', 'society', 'madhyamik', 'uchch', 'shiksha', 'parishad', 'pariksha']);
const PHRASES = /\b(public examinations?|high school|pre[- ]university)\b/g; // "Kerala Board of Public Examination", "U.P. Board of High School"
const KINDS: Record<Kind, string[]> = { open: ['open'], madrasa: ['madrasa', 'madrassa', 'madarsa', 'madrasah', 'madarasa'], sanskrit: ['sanskrit'] };
const BOARD_NAMES = ALL_BOARDS.flatMap((b) => [key(b.name), ...b.also].map((a) => ({ a, b })));
const STATE_ALIASES = STATES.flatMap((s) => [key(s.name), ...s.also].map((a) => ({ a, s }))).sort((x, y) => y.a.length - x.a.length);

/** The board named in a box or a line, or an error: only boards on the lists above can be used. */
export function checkBoard(raw: string): { name: string; code: string | null; problem?: Problem } {
  const k = key(raw);
  if (!k) return { name: '', code: null };
  const kk = k.replace(/\bboard\b/g, ' ').replace(/\s+/g, ' ').trim();
  const known = BOARD_NAMES.find(({ a }) => a === k || a === kk)?.b;
  if (known) return { name: known.name, code: known.code };
  // a state's board, written its own way: "Bihar School Examination Board", "State Board (Maharashtra)", "Kerala syllabus",
  // and its other boards by their kind: "UP madrasa board". A school's name ("Delhi Public School") is not a board.
  const at = STATE_ALIASES.find(({ a }) => words(a).test(k));
  if (at) {
    const rest = tokens(k.replace(PHRASES, ' ').replace(words(at.a), ' ')).filter((w) => !FILLER.has(w));
    if (!rest.length) return { name: `${at.s.name} State Board`, code: at.s.code };
    const other = STATE_BOARDS.find((b) => b.state === at.s.name && rest.every((w) => KINDS[b.kind].includes(w)));
    if (other) return { name: other.name, code: other.code };
  }
  const name = tidy(raw);
  const error = (text: string) => ({ name, code: null, problem: { level: 'error' as const, text } });
  if (tokens(k).every((w) => FILLER.has(w))) return error('Which state? For example: Maharashtra State Board.');
  const none = NO_BOARD.find((p) => words(p).test(k));
  if (none) return error(`${titleCase(none)} has no school board of its own. Write the board the school follows, such as CBSE.`);
  const near = closest(k, [...BOARD_NAMES.map(({ a, b }) => ({ a, name: b.name })), ...STATES.map((x) => ({ a: key(x.name), name: `${x.name} State Board` }))]);
  if (near) return error(`Did you mean ${near}?`);
  return error(`"${name}" isn't a board on this site's list. Write the board the textbook is for, such as CBSE, ICSE or Maharashtra State Board. The guide lists them all.`);
}

/** The name whose spelling is nearest, if it is only a letter or two away (two only for long names). */
function closest(k: string, names: { a: string; name: string }[]): string | undefined {
  if (k.length < 3) return undefined;
  let best: { d: number; name: string } | undefined;
  for (const { a, name } of names) {
    if (a.length < 3) continue;
    const d = distance(k, a);
    if (d <= (a.length >= 8 ? 2 : 1) && (!best || d < best.d)) best = { d, name };
  }
  return best?.name;
}

// ---------------------------------------------------------------- class

const ROMAN: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12 };

/** "10", "10th", "Class 10", "X", "Std. 8", "Grade 7" → the text after the label, with "th" dropped from a number. */
function normClass(s: string): string {
  return tidy(s).replace(/^(?:class|grade|std\.?|standard)\s*[:\-–]?\s*/i, '').replace(/^(\d+)\s*(?:st|nd|rd|th)$/i, '$1');
}

export function checkClass(raw: string): { value: number | null; problem?: Problem } {
  const t = normClass(raw).toLowerCase();
  if (!t) return { value: null };
  const n = /^\d+$/.test(t) ? Number(t) : ROMAN[t];
  if (n === undefined) return { value: null, problem: { level: 'error', text: 'Class must be a number from 1 to 12, like 10 or X.' } };
  if (n < 1 || n > 12) return { value: null, problem: { level: 'error', text: 'Class must be from 1 to 12.' } };
  return { value: n };
}

// ---------------------------------------------------------------- subjects
// The subjects of the textbooks and syllabuses of CBSE (its academic, language and skill subjects), CISCE (ICSE and
// ISC), NIOS, the state boards, Cambridge, Edexcel and IB. Each has a fixed three-letter code (languages mostly use
// their ISO 639 codes). A subject not on this list can't be used: the formatter says so, and the database refuses it
// (private.subjects in supabase/schema.sql has the same list).

export const SUBJECTS: { name: string; code: string; also: string[] }[] = [
  { name: 'Physics', code: 'PHY', also: ['phy', 'phys', 'भौतिकी', 'भौतिक विज्ञान'] },
  { name: 'Chemistry', code: 'CHE', also: ['chem', 'रसायन', 'रसायन विज्ञान'] },
  { name: 'Biology', code: 'BIO', also: ['bio', 'life science', 'life sciences', 'जीव विज्ञान'] },
  { name: 'Mathematics', code: 'MAT', also: ['maths', 'math', 'mathematics standard', 'mathematics basic', 'maths standard', 'maths basic', 'standard mathematics', 'basic mathematics', 'international mathematics', 'गणित'] },
  { name: 'Applied Mathematics', code: 'AMA', also: ['applied maths', 'applied math'] },
  { name: 'Additional Mathematics', code: 'ADM', also: ['additional maths', 'add maths'] },
  { name: 'Further Mathematics', code: 'FMA', also: ['further maths'] },
  { name: 'Statistics', code: 'STA', also: ['stats'] },
  { name: 'Science', code: 'SCI', also: ['general science', 'sci', 'science and technology', 'combined science', 'coordinated science', 'co-ordinated science', 'integrated science', 'विज्ञान'] },
  { name: 'Environmental Studies', code: 'EVS', also: ['evs', 'the world around us', 'looking around'] },
  { name: 'Environmental Science', code: 'ENV', also: ['environmental systems and societies', 'environmental education'] },
  { name: 'Environmental Management', code: 'EMG', also: [] },
  { name: 'Biotechnology', code: 'BTE', also: ['biotech'] },
  { name: 'Computer Science', code: 'CSC', also: ['cs', 'comp sci', 'computer', 'computers', 'computer studies', 'computing'] },
  { name: 'Computer Applications', code: 'CAP', also: ['computer application'] },
  { name: 'Informatics Practices', code: 'INP', also: ['ip'] },
  { name: 'Information Technology', code: 'ITE', also: ['it', 'ict', 'information and communication technology', 'digital society'] },
  { name: 'Artificial Intelligence', code: 'AIN', also: ['ai'] },
  { name: 'Data Science', code: 'DSC', also: [] },
  { name: 'Robotics', code: 'ROB', also: ['robotics and ai', 'robotics and artificial intelligence'] },
  { name: 'Web Applications', code: 'WEB', also: ['web application'] },
  { name: 'Data Entry Operations', code: 'DEO', also: [] },
  { name: 'Engineering Graphics', code: 'EGR', also: [] },
  { name: 'Engineering Science', code: 'ESC', also: [] },
  { name: 'Electricity and Electronics', code: 'EEL', also: [] },
  { name: 'Technical Drawing', code: 'TDR', also: ['technical drawing applications'] },
  { name: 'Geometrical and Mechanical Drawing', code: 'GMD', also: [] },
  { name: 'Geometrical and Building Drawing', code: 'GBD', also: [] },
  { name: 'Design and Technology', code: 'DTE', also: [] },
  { name: 'Social Science', code: 'SST', also: ['sst', 'social studies', 'social', 'social sciences', 'सामाजिक विज्ञान'] },
  { name: 'History', code: 'HIS', also: ['hist', 'इतिहास'] },
  { name: 'Geography', code: 'GEO', also: ['geo', 'भूगोल'] },
  { name: 'Civics', code: 'CIV', also: ['citizenship', 'citizenship studies'] },
  { name: 'History and Civics', code: 'HCV', also: [] },
  { name: 'Political Science', code: 'POL', also: ['pol sci', 'polity', 'politics', 'global politics', 'राजनीति विज्ञान'] },
  { name: 'Economics', code: 'ECO', also: ['eco', 'economic', 'अर्थशास्त्र'] },
  { name: 'Sociology', code: 'SOC', also: [] },
  { name: 'Psychology', code: 'PSY', also: [] },
  { name: 'Philosophy', code: 'PHI', also: [] },
  { name: 'Anthropology', code: 'ANT', also: ['social and cultural anthropology'] },
  { name: 'Religious Studies', code: 'REL', also: ['religious education', 'religion'] },
  { name: 'Global Perspectives', code: 'GLP', also: [] },
  { name: 'Theory of Knowledge', code: 'TOK', also: ['tok'] },
  { name: 'Legal Studies', code: 'LGS', also: ['law'] },
  { name: 'Knowledge Traditions and Practices of India', code: 'KTP', also: [] },
  { name: 'Indian Culture and Heritage', code: 'ICH', also: [] },
  { name: 'General Knowledge', code: 'GKN', also: ['gk'] },
  { name: 'Moral Science', code: 'MSC', also: ['moral education', 'value education', 'values education'] },
  { name: 'Accountancy', code: 'ACC', also: ['accounts', 'accounting'] },
  { name: 'Business Studies', code: 'BST', also: ['bst', 'business', 'business management', 'business and management'] },
  { name: 'Commerce', code: 'CMR', also: [] },
  { name: 'Commercial Studies', code: 'COM', also: [] },
  { name: 'Commercial Applications', code: 'CMA', also: [] },
  { name: 'Economic Applications', code: 'ECA', also: [] },
  { name: 'Entrepreneurship', code: 'ENT', also: [] },
  { name: 'Business Administration', code: 'BAD', also: [] },
  { name: 'Taxation', code: 'TAX', also: [] },
  { name: 'Cost Accounting', code: 'CAC', also: [] },
  { name: 'Financial Markets', code: 'FIN', also: ['financial markets management', 'introduction to financial markets', 'financial literacy'] },
  { name: 'Banking', code: 'BNK', also: ['banking and insurance'] },
  { name: 'Insurance', code: 'INS', also: [] },
  { name: 'Marketing', code: 'MKT', also: ['marketing and sales'] },
  { name: 'Salesmanship', code: 'SLS', also: [] },
  { name: 'Office Procedures and Practices', code: 'OPP', also: [] },
  { name: 'Shorthand', code: 'SHO', also: ['shorthand english', 'shorthand hindi', 'stenography'] },
  { name: 'Retail', code: 'RET', also: ['retail store operations'] },
  { name: 'Tourism', code: 'TOU', also: ['introduction to tourism', 'travel and tourism'] },
  { name: 'Hospitality Management', code: 'HOS', also: ['hospitality'] },
  { name: 'Front Office Operations', code: 'FOO', also: [] },
  { name: 'Food Production', code: 'FPR', also: [] },
  { name: 'Food Nutrition and Dietetics', code: 'FND', also: ['food and nutrition', 'nutrition'] },
  { name: 'Cookery', code: 'COO', also: [] },
  { name: 'Home Science', code: 'HSC', also: [] },
  { name: 'Beauty and Wellness', code: 'BWL', also: [] },
  { name: 'Health Care', code: 'HCA', also: ['healthcare'] },
  { name: 'Medical Diagnostics', code: 'MDG', also: ['medical diagnosis'] },
  { name: 'Early Childhood Care and Education', code: 'ECC', also: ['early childhood care'] },
  { name: 'Agriculture', code: 'AGR', also: [] },
  { name: 'Horticulture', code: 'HOR', also: [] },
  { name: 'Apparel', code: 'APP', also: [] },
  { name: 'Textile Design', code: 'TXD', also: [] },
  { name: 'Fashion Studies', code: 'FAS', also: ['fashion designing', 'fashion design'] },
  { name: 'Design', code: 'DES', also: [] },
  { name: 'Design Thinking and Innovation', code: 'DTI', also: [] },
  { name: 'Multimedia', code: 'MMD', also: ['multi media', 'multi-media'] },
  { name: 'Mass Media Studies', code: 'MMS', also: ['mass media', 'mass media and communication', 'mass communication', 'media studies'] },
  { name: 'Library and Information Science', code: 'LIS', also: [] },
  { name: 'Typography and Computer Application', code: 'TCA', also: [] },
  { name: 'Geospatial Technology', code: 'GST', also: [] },
  { name: 'Electrical Technology', code: 'ETE', also: [] },
  { name: 'Electronic Technology', code: 'ETN', also: [] },
  { name: 'Electronics and Hardware', code: 'ELH', also: [] },
  { name: 'Automotive', code: 'AUT', also: [] },
  { name: 'Air Conditioning and Refrigeration', code: 'ACR', also: [] },
  { name: 'Security', code: 'SEC', also: [] },
  { name: 'Physical Activity Trainer', code: 'PAT', also: [] },
  { name: 'Foundation Skills for Sciences', code: 'FSS', also: [] },
  { name: 'Multi Skill Foundation Course', code: 'MSF', also: [] },
  { name: 'Vocational Education', code: 'VOC', also: ['kaushal bodh', 'skill education'] },
  { name: 'Art', code: 'ART', also: ['arts', 'art and design', 'visual arts', 'fine arts', 'drawing', 'art education', 'arts education', 'kriti'] },
  { name: 'Painting', code: 'PNT', also: [] },
  { name: 'Graphics', code: 'GRA', also: [] },
  { name: 'Sculpture', code: 'SCU', also: [] },
  { name: 'Applied Art', code: 'AAR', also: ['commercial art', 'applied commercial art'] },
  { name: 'Music', code: 'MUS', also: ['western music', 'indian music'] },
  { name: 'Hindustani Music', code: 'HMU', also: ['hindustani music vocal', 'hindustani music melodic instruments', 'hindustani music percussion instruments'] },
  { name: 'Carnatic Music', code: 'CMU', also: ['carnatic music vocal', 'carnatic music melodic instruments', 'carnatic music percussion instruments'] },
  { name: 'Dance', code: 'DAN', also: ['kathak', 'bharatanatyam', 'bharatnatyam', 'kuchipudi', 'odissi', 'kathakali', 'manipuri dance', 'mohiniyattam'] },
  { name: 'Drama', code: 'DRA', also: ['theatre', 'theater', 'theatre arts'] },
  { name: 'Performing Arts', code: 'PFA', also: [] },
  { name: 'Film', code: 'FLM', also: ['film studies'] },
  { name: 'Physical Education', code: 'PED', also: ['pe', 'health and physical education', 'physical and health education', 'sports', 'physical education and wellbeing', 'physical education and well-being', 'khel yatra', 'sports exercise and health science'] },
  { name: 'Yoga', code: 'YOG', also: [] },
  { name: 'National Cadet Corps', code: 'NCC', also: ['ncc'] },
  { name: 'English', code: 'ENG', also: ['eng', 'english core', 'english communicative', 'english language and literature', 'english first language', 'english as a second language', 'english second language', 'अंग्रेजी'] },
  { name: 'English Language', code: 'ENL', also: [] },
  { name: 'English Literature', code: 'ELT', also: ['literature in english', 'english lit'] },
  { name: 'Elective English', code: 'ELE', also: ['english elective'] },
  { name: 'Hindi', code: 'HIN', also: ['hindi core', 'hindi course a', 'hindi course b', 'hindi a', 'hindi b', 'हिंदी', 'हिन्दी'] },
  { name: 'Hindi Elective', code: 'HIE', also: ['elective hindi'] },
  { name: 'Sanskrit', code: 'SAN', also: ['sanskrit core', 'sanskrit elective', 'संस्कृत'] },
  { name: 'Urdu', code: 'URD', also: ['urdu core', 'urdu elective', 'urdu course a', 'urdu course b'] },
  { name: 'Punjabi', code: 'PUN', also: ['punjabi elective'] },
  { name: 'Bengali', code: 'BEN', also: ['bangla'] },
  { name: 'Tamil', code: 'TAM', also: [] },
  { name: 'Telugu', code: 'TEL', also: ['telugu telangana', 'telugu andhra pradesh'] },
  { name: 'Kannada', code: 'KAN', also: [] },
  { name: 'Malayalam', code: 'MAL', also: [] },
  { name: 'Marathi', code: 'MAR', also: [] },
  { name: 'Gujarati', code: 'GUJ', also: [] },
  { name: 'Odia', code: 'ORI', also: ['oriya'] },
  { name: 'Assamese', code: 'ASM', also: [] },
  { name: 'Manipuri', code: 'MNI', also: ['meitei', 'meiteilon'] },
  { name: 'Sindhi', code: 'SND', also: [] },
  { name: 'Kashmiri', code: 'KAS', also: [] },
  { name: 'Konkani', code: 'KOK', also: [] },
  { name: 'Nepali', code: 'NEP', also: [] },
  { name: 'Bodo', code: 'BOD', also: [] },
  { name: 'Dogri', code: 'DOI', also: [] },
  { name: 'Maithili', code: 'MAI', also: [] },
  { name: 'Santali', code: 'SAT', also: [] },
  { name: 'Mizo', code: 'MIZ', also: [] },
  { name: 'Khasi', code: 'KHA', also: [] },
  { name: 'Garo', code: 'GAR', also: [] },
  { name: 'Kokborok', code: 'KBK', also: [] },
  { name: 'Tangkhul', code: 'TNG', also: [] },
  { name: 'Lepcha', code: 'LEP', also: [] },
  { name: 'Limboo', code: 'LIM', also: ['limbu'] },
  { name: 'Bhutia', code: 'BHU', also: ['bhoti'] },
  { name: 'Tibetan', code: 'TIB', also: ['tibetian'] },
  { name: 'Rai', code: 'RAI', also: [] },
  { name: 'Gurung', code: 'GRG', also: [] },
  { name: 'Tamang', code: 'TMG', also: [] },
  { name: 'Sherpa', code: 'SHP', also: [] },
  { name: 'Thai', code: 'THA', also: [] },
  { name: 'Arabic', code: 'ARA', also: [] },
  { name: 'Persian', code: 'PER', also: ['farsi'] },
  { name: 'French', code: 'FRE', also: [] },
  { name: 'German', code: 'GER', also: [] },
  { name: 'Spanish', code: 'SPA', also: [] },
  { name: 'Russian', code: 'RUS', also: [] },
  { name: 'Japanese', code: 'JPN', also: [] },
  { name: 'Chinese', code: 'CHI', also: ['mandarin', 'chinese mandarin'] },
  { name: 'Korean', code: 'KOR', also: [] },
  { name: 'Italian', code: 'ITA', also: [] },
  { name: 'Portuguese', code: 'POR', also: [] },
  { name: 'Latin', code: 'LAT', also: [] },
  { name: 'Dzongkha', code: 'DZO', also: [] },
];
const SUBJECT_NAMES = SUBJECTS.flatMap((x) => [key(x.name), ...x.also].map((a) => ({ a, name: x.name })));

/** The subject named in a box or a line, or an error: only subjects on the list above can be used. */
export function checkSubject(raw: string): { name: string; code: string | null; problem?: Problem } {
  const k = key(raw);
  if (!k) return { name: '', code: null };
  const known = SUBJECTS.find((x) => k === key(x.name) || x.also.includes(k));
  if (known) return { name: known.name, code: known.code };
  const name = tidy(raw);
  const near = k.length >= 4 ? closest(k, SUBJECT_NAMES.filter(({ a }) => a.length >= 4)) : undefined;
  if (near) return { name, code: null, problem: { level: 'error', text: `Did you mean ${near}?` } };
  return { name, code: null, problem: { level: 'error', text: `"${name}" isn't a subject on this site's list. Write the textbook's subject, such as Science or Mathematics. The guide lists them all.` } };
}

// ---------------------------------------------------------------- chapter and topic

/** "10: Light", "Chapter 10 - Light", "10. Light", "Light" or "10" → number and name. For a topic "10.2" means topic 2. */
export function parseNumbered(s: string, kind: 'chapter' | 'topic'): { no: number | null; name: string } {
  const t = tidy(s).replace(kind === 'chapter' ? /^(?:chapter|ch|lesson)\b\.?\s*/i : /^(?:topic|sub-?topic|section)\b\.?\s*/i, '');
  const m = t.match(/^(\d+(?:\.\d+)*)(?:\s*[:\-–—.)]\s*|\s+|$)(.*)$/);
  if (!m) return { no: null, name: t.replace(/^[:\-–—.)]\s*/, '') };
  const parts = m[1].split('.').map(Number);
  return { no: kind === 'chapter' ? parts[0] : parts[parts.length - 1], name: tidy(m[2]) };
}

/** A chapter or topic: its number (null when missing or out of range), its name capitalised, and any problem. */
export function checkNumbered(value: string, kind: 'chapter' | 'topic'): { no: number | null; name: string; problem?: Problem } {
  const { no, name } = parseNumbered(value, kind);
  const Kind = kind === 'chapter' ? 'Chapter' : 'Topic';
  const inRange = no !== null && no >= 1 && no <= MAX_NO;
  const problem: Problem | undefined = no !== null && !inRange ? { level: 'error', text: `${Kind} number must be from 1 to ${MAX_NO}.` }
    : name.length > MAX_NAME ? { level: 'error', text: `${Kind} name is longer than ${MAX_NAME} characters.` }
    : kind === 'chapter' && no === null ? { level: 'warn', text: 'Add the chapter number, for example "3: Acids". It is part of the chapter ID.' }
    : !name && kind === 'chapter' ? { level: 'warn', text: 'Add the chapter name, for example "3: Acids". Questions can\'t be sent without it.' }
    : !name ? { level: 'warn', text: `Add the ${kind} name.` }
    : undefined;
  return { no: inRange ? no : null, name: titleCase(name), problem };
}

// ---------------------------------------------------------------- IDs

export function chapterId(boardCode: string | null, cls: number | null, subjectCode: string | null, chapterNo: number | null): string | null {
  return boardCode && cls && subjectCode && chapterNo ? `${boardCode}${pad2(cls)}${subjectCode}${pad2(chapterNo)}` : null;
}

export const topicId = (chapter: string | null, topicNo: number | null) => (chapter && topicNo ? `${chapter}T${pad2(topicNo)}` : null);

/** Board mismatches worth a warning, such as ICSE in class 11 (that is ISC). */
export function boardClassProblem(boardCode: string | null, cls: number | null): string | undefined {
  if (!cls) return undefined;
  if (boardCode === 'ICSE' && cls >= 11) return 'ICSE ends at class 10. Classes 11 and 12 are ISC.';
  if (boardCode === 'ISC' && cls <= 10) return 'ISC is for classes 11 and 12. Up to class 10 it is ICSE.';
  if (boardCode === 'IGCSE' && cls >= 11) return 'IGCSE ends at grade 10. For 11 and 12 use Cambridge or IB.';
  return undefined;
}

// ---------------------------------------------------------------- detail lines

export type MetaKey = 'board' | 'class' | 'subject' | 'chapter' | 'topic' | 'difficulty';

const META = /^(board|class|grade|std|standard|subject|chapter|ch|lesson|topic|sub-?topic|section|difficulty|level)\b\.?\s*(.*)$/i;
const KEY_OF: Record<string, MetaKey> = {
  board: 'board', class: 'class', grade: 'class', std: 'class', standard: 'class', subject: 'subject',
  chapter: 'chapter', ch: 'chapter', lesson: 'chapter', topic: 'topic', subtopic: 'topic', 'sub-topic': 'topic', section: 'topic',
  difficulty: 'difficulty', level: 'difficulty',
};

/** Removes a Markdown heading mark, a bullet and bold from a line. Spaces inside are kept, so a box can be typed into word by word. */
const unmark = (line: string) => line.replace(/^\s*#{1,6}\s*/, '').replace(/^\s*[-*•]\s+/, '').replace(/\*\*/g, '').replace(/^\s+/, '');
export const plainLine = (line: string) => tidy(unmark(line));

/**
 * A detail line such as "Chapter 3: Acids", "Class 10", "**Board:** CBSE" or "## Topic 2 - Indicators", or null.
 * The value is the text after the label (and after ":" or "-"), as written.
 * A sentence that only starts with one of the words ("Class of compounds that ...") is not a detail line.
 */
export function readMeta(line: string): { key: MetaKey; value: string } | null {
  if (/[|\t]/.test(line)) return null;
  const m = unmark(line).match(META);
  if (!m) return null;
  const k = KEY_OF[m[1].toLowerCase()];
  const rest = m[2];
  if (k === 'chapter' || k === 'topic') {
    const r = rest.match(/^(\d+(?:\.\d+)*)?\s*([:\-–—.)]\s*)?(.*)$/)!;
    if (!r[1] && !r[2]) return null;
    if (!r[1] && !tidy(r[3])) return null;
    return { key: k, value: rest.replace(/^[:\-–—]\s?/, '') };
  }
  if (k === 'class') {
    const r = rest.match(/^([:\-–—]\s?)?(.*)$/)!;
    if (!r[1] && !/^(?:\d+\s*(?:st|nd|rd|th)?|xii|xi|x|ix|viii|vii|vi|v|iv|iii|ii|i)$/i.test(r[2].trim())) return null;
    return { key: k, value: r[2] };
  }
  const r = rest.match(/^[:\-–—]\s?(.*)$/);
  return r ? { key: k, value: r[1] } : null;
}

// ---------------------------------------------------------------- the four boxes, kept in the text

export type DetailKey = 'board' | 'class' | 'subject' | 'chapter';
export const DETAIL_KEYS: DetailKey[] = ['board', 'class', 'subject', 'chapter'];
export const LABEL: Record<DetailKey, string> = { board: 'Board', class: 'Class', subject: 'Subject', chapter: 'Chapter' };

const detailOf = (line: string) => {
  const m = readMeta(line);
  return m && m.key in LABEL ? (m as { key: DetailKey; value: string }) : null;
};

/** Where a box's line is: among the detail lines at the top of the text, before the first topic or question. -1 if none. */
function find(lines: string[], k: DetailKey): number {
  const end = lines.findIndex((l) => l.trim() && !detailOf(l));
  return lines.findIndex((l, i) => (end < 0 || i < end) && detailOf(l)?.key === k);
}

/** What the four boxes show: their lines at the top of the text. */
export function readDetails(text: string): Record<DetailKey, string> {
  const lines = text.split('\n');
  const get = (k: DetailKey) => {
    const i = find(lines, k);
    return i < 0 ? '' : detailOf(lines[i])!.value;
  };
  return { board: get('board'), class: get('class'), subject: get('subject'), chapter: get('chapter') };
}

/** The line (from 1) a box writes to, or null when it has none yet. */
export function detailLine(text: string, k: DetailKey): number | null {
  const i = find(text.split('\n'), k);
  return i < 0 ? null : i + 1;
}

/** Typing in a box writes its line at the top of the text (in the order Board, Class, Subject, Chapter); emptying it removes the line. */
export function writeDetail(text: string, k: DetailKey, value: string): string {
  const v = value.replace(/\s*[|\t\r\n]+\s*/g, ' ');
  const lines = text.split('\n');
  const at = find(lines, k);
  const line = k === 'chapter' && /^\d/.test(v) ? `Chapter ${v}` : `${LABEL[k]}: ${v}`;
  if (at >= 0) lines.splice(at, 1, ...(v.trim() ? [line] : []));
  else if (v.trim()) lines.splice(Math.max(-1, ...DETAIL_KEYS.slice(0, DETAIL_KEYS.indexOf(k)).map((b) => find(lines, b))) + 1, 0, line);
  return lines.join('\n');
}

const CHECK: Record<DetailKey, (v: string) => { problem?: Problem }> = {
  board: checkBoard, class: checkClass, subject: checkSubject, chapter: (v) => checkNumbered(v, 'chapter'),
};

/** A box's problem, shown under it. */
export const checkDetail = (k: DetailKey, value: string): Problem | undefined => (value.trim() ? CHECK[k](value).problem : undefined);

/** A box's value written the standard way (CBSE, 11, Chemistry, "1: Some Basic Concepts"), or as it was if it can't be read. */
export function standardDetail(k: DetailKey, value: string): string {
  if (!value.trim()) return '';
  if (k === 'board') { const b = checkBoard(value); return b.code ? b.name : value; }
  if (k === 'class') return String(checkClass(value).value ?? value);
  if (k === 'subject') return checkSubject(value).name || value;
  const c = checkNumbered(value, 'chapter');
  if (c.problem?.level === 'error') return value;
  return c.no === null ? c.name : c.name ? `${c.no}: ${c.name}` : String(c.no);
}

/** The chapter ID the four boxes make, if they are all there. */
export function detailsId(d: Record<DetailKey, string>): string | null {
  return chapterId(checkBoard(d.board).code, checkClass(d.class).value, checkSubject(d.subject).code, checkNumbered(d.chapter, 'chapter').no);
}
