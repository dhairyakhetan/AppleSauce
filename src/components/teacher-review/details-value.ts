import type { ReviewApplication, ReviewTeacher } from '@/lib/teacher-review-api';

/* The shape the details form edits, and the two-way adapters between it and an
   application or a listed teacher (a teacher's name is called title). Kept out
   of DetailsForm.tsx so that file only exports the component. */

export interface DetailsValue {
  name: string;
  sir_maam: string | null;
  subjects: string | null;
  featured_subject: string | null;
  classes_taught_for_backend: string | null;
  school_boards_catered: string | null;
  location_v2: string | null;
  students_home_areas: string | null;
  tutors_home_areas: string | null;
  mode_of_teaching: string | null;
  class_size: string | null;
  description: string | null;
  qualifications_etc: string | null;
  years_started_teaching: string | null;
  min_fees: number | null;
  max_fees: number | null;
  /** Present for applications only. */
  phone_number?: string;
  whatsapp_link?: string | null;
}

export function applicationToDetails(a: ReviewApplication): DetailsValue {
  return {
    name: a.name,
    sir_maam: a.sir_maam,
    subjects: a.subjects,
    featured_subject: a.featured_subject,
    classes_taught_for_backend: a.classes_taught_for_backend,
    school_boards_catered: a.school_boards_catered,
    location_v2: a.location_v2,
    students_home_areas: a.students_home_areas,
    tutors_home_areas: a.tutors_home_areas,
    mode_of_teaching: a.mode_of_teaching,
    class_size: a.class_size,
    description: a.description,
    qualifications_etc: a.qualifications_etc,
    years_started_teaching: a.years_started_teaching,
    min_fees: a.min_fees,
    max_fees: a.max_fees,
    phone_number: a.phone_number,
    whatsapp_link: a.whatsapp_link,
  };
}

export function detailsToApplication(a: ReviewApplication, d: DetailsValue): ReviewApplication {
  return {
    ...a,
    name: d.name,
    sir_maam: d.sir_maam ?? a.sir_maam,
    subjects: d.subjects,
    featured_subject: d.featured_subject,
    classes_taught_for_backend: d.classes_taught_for_backend,
    school_boards_catered: d.school_boards_catered,
    location_v2: d.location_v2,
    students_home_areas: d.students_home_areas,
    tutors_home_areas: d.tutors_home_areas,
    mode_of_teaching: d.mode_of_teaching,
    class_size: d.class_size,
    description: d.description,
    qualifications_etc: d.qualifications_etc,
    years_started_teaching: d.years_started_teaching,
    min_fees: d.min_fees,
    max_fees: d.max_fees,
    phone_number: d.phone_number ?? a.phone_number,
    whatsapp_link: d.whatsapp_link ?? null,
  };
}

export function teacherToDetails(t: ReviewTeacher): DetailsValue {
  return {
    name: t.title,
    sir_maam: t.sir_maam,
    subjects: t.subjects,
    featured_subject: t.featured_subject,
    classes_taught_for_backend: t.classes_taught_for_backend,
    school_boards_catered: t.school_boards_catered,
    location_v2: t.location_v2,
    students_home_areas: t.students_home_areas,
    tutors_home_areas: t.tutors_home_areas,
    mode_of_teaching: t.mode_of_teaching,
    class_size: t.class_size,
    description: t.description,
    qualifications_etc: t.qualifications_etc,
    years_started_teaching: t.years_started_teaching,
    min_fees: t.min_fees,
    max_fees: t.max_fees,
  };
}

export function detailsToTeacher(t: ReviewTeacher, d: DetailsValue): ReviewTeacher {
  return {
    ...t,
    title: d.name,
    sir_maam: d.sir_maam,
    subjects: d.subjects,
    featured_subject: d.featured_subject,
    classes_taught_for_backend: d.classes_taught_for_backend,
    school_boards_catered: d.school_boards_catered,
    location_v2: d.location_v2,
    students_home_areas: d.students_home_areas,
    tutors_home_areas: d.tutors_home_areas,
    mode_of_teaching: d.mode_of_teaching,
    class_size: d.class_size,
    description: d.description,
    qualifications_etc: d.qualifications_etc,
    years_started_teaching: d.years_started_teaching,
    min_fees: d.min_fees,
    max_fees: d.max_fees,
  };
}

