/**
 * What is still missing on one step of the teacher application form, ALL of it at once.
 *
 * The form used to stop at the first mistake with a toast that disappears ("Please enter your name"), outlined nothing,
 * and showed the next one only after the next press (site-wide audit B5, 27 Nov 2026). The step now lists every problem
 * in one alert that stays on screen. Same rules as before, nothing new is required.
 */

export interface JoinStepAnswers {
  name: string;
  email: string;
  sir_maam: string;
  phone_number: string;
  subjects: string;
  school_boards_catered: string;
  classes_taught_for_backend: string;
  class_size: string;
  location_v2: string;
  students_home_areas: string;
  tutors_home_areas: string;
  mode_of_teaching: string;
  min_fees: string;
}

const STUDENT_HOME = "STUDENT'S HOME TUTORING ONLY";
const TEACHER_HOME = "TEACHER'S HOME TUTORING";
const BOTH = 'BOTH OPTIONS LISTED';

export function stepProblems(step: number, a: JoinStepAnswers): string[] {
  const out: string[] = [];
  if (step === 0) {
    if (!a.name.trim()) out.push('Please enter your name');
    if (!a.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email.trim())) out.push('Please enter a valid email address');
    if (!a.sir_maam) out.push("Please select Sir or Ma'am");
    if (a.phone_number.replace(/\D/g, '').length !== 10) out.push('WhatsApp number must be exactly 10 digits');
  } else if (step === 1) {
    if (!a.subjects.trim()) out.push('Please select at least one subject');
    if (!a.school_boards_catered.trim()) out.push('Please select at least one school board');
    if (!a.classes_taught_for_backend.trim()) out.push('Please select at least one class');
    if (!a.class_size.trim()) out.push('Please select at least one structure of classes option');
  } else if (step === 2) {
    if (!a.location_v2) {
      out.push('Please select a location option');
    } else {
      if ((a.location_v2 === STUDENT_HOME || a.location_v2 === BOTH) && !a.students_home_areas.trim()) {
        out.push("Please select at least one area for Student's Home Tutoring");
      }
      if ((a.location_v2 === TEACHER_HOME || a.location_v2 === BOTH) && !a.tutors_home_areas.trim()) {
        out.push("Please select at least one area for Teacher's Home Tutoring");
      }
    }
    if (!a.mode_of_teaching.trim()) out.push('Please select at least one mode of teaching');
  } else if (step === 3) {
    const fee = parseInt(a.min_fees.replace(/\D/g, ''), 10);
    if (!a.min_fees.trim() || Number.isNaN(fee) || fee <= 0) out.push('Please enter a monthly fee greater than ₹0');
  }
  return out;
}
