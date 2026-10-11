/**
 * The choices a teacher's details are picked from, in one place: the admin
 * teachers page and the teacher review page both offer exactly these. They
 * match the browse filters, so a value picked here is a value the filters find.
 */

export const SUBJECTS = [
  'Accounts', 'ACT', 'AP', 'Bengali', 'Biology', 'Business Studies', 'CA', 'CAT', 'Chemistry',
  'CLAT', 'Commerce', 'Computers', 'Drawing & Painting', 'Economics', 'English', 'Environmental Science',
  'Geography', 'Hindi', 'History & Civics', 'Home Science', 'JEE', 'Legal Studies', 'Maths',
  'NEET', 'NMAT', 'Physics', 'Political Science', 'Psychology', 'SAT', 'Science',
  'Sanskrit', 'Social Studies', 'Sociology',
];

export const CLASSES = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', 'UG'];

export const BOARDS = ['ICSE/ISC', 'CBSE', 'IGCSE', 'IB', 'State', 'N/A'];

export const AREAS = [
  'Alipore', 'Ballygunge', 'Behala', 'Bhowanipore', 'Gariahat', 'Garia', 'Jadavpur', 'Kasba',
  'New Alipore', 'Southern Avenue', 'Tollygunge', 'Hazra',
  'Baguihati', 'Belur', 'Howrah', 'Joka', 'Newtown', 'Rajarhat', 'Salt Lake', 'Science City',
  'Dum Dum', 'Entally', 'Girish Park', 'Nagarbazar', 'Sealdah', 'Shyam Bazar', 'Tangra',
  'Camac Street', 'College Street', 'Elgin', 'Minto Park', 'Park Street', 'Park Circus',
  'Kankurgachi', 'Laketown', 'Phoolbagan', 'Ultadanga',
  'Anandapur', 'Parnasree', 'Rabindra Nagar',
  'Hooghly',
].sort();

export const MODE_OF_TEACHING = ['Online', 'Offline'];
export const CLASS_SIZE = ['Group', 'Solo'];
export const SIR_MAAM = ['Sir', "Ma'am"];
export const LOCATION_OPTIONS = ["TEACHER'S HOME TUTORING", "STUDENT'S HOME TUTORING ONLY", 'BOTH OPTIONS LISTED'];

const norm = (v: string) => v.trim().toLowerCase();

/** Whether a comma separated list holds the value (ignoring case and spaces). */
export function listHas(list: string | null | undefined, value: string): boolean {
  if (!list) return false;
  return list.split(',').some((v) => norm(v) === norm(value));
}

/** The list with the value added or removed, as the comma separated text the database stores; null when empty. */
export function listToggle(list: string | null | undefined, value: string, on: boolean): string | null {
  const current = (list ?? '').split(',').map((v) => v.trim()).filter(Boolean);
  const without = current.filter((v) => norm(v) !== norm(value));
  const next = on ? [...without, value] : without;
  return next.length ? next.join(', ') : null;
}
