/* The logic of the admin Applications page, kept free of Supabase and React so
   it can be tested on its own: the row shape, the Waiting / Approved / Rejected
   / All views, the order, "who is next", the outreach states, and the two
   decisions (approve asks first; reject needs a reason). The page and the fake
   used in dummy mode share all of it.

   Every mutation here calls the same api method with the same arguments the
   page always did: approve(id, adminId) is the approve_teacher_application RPC,
   reject(id, adminId, reason) is the update to status 'rejected'. */

export type ApplicationStatus = 'pending' | 'approved' | 'rejected';
export type TextedStatus = 'not_texted' | 'texted' | 'follow_up';

export interface TeacherApplication {
  id: string;
  name: string;
  email: string;
  phone_number: string;
  sir_maam: 'Sir' | "Ma'am";
  subjects: string | null;
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
  featured_subject: string | null;
  whatsapp_link: string | null;
  hero_image_url: string | null;
  reference_name: string | null;
  reference_number: string | null;
  min_fees: number | null;
  max_fees: number | null;
  mou_consent: boolean;
  mou_consent_timestamp: string | null;
  status: ApplicationStatus;
  texted_status: TextedStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
}

/** The columns the list reads from teacher_applications, named one by one.
 *  Each was proven readable by the admin role with
 *  has_column_privilege('authenticated', 'public.teacher_applications', col, 'SELECT')
 *  on 8 Oct 2026 (all 31 columns of the table). A NAMED column the role cannot
 *  read fails the whole request with a 401, so add to this list only after
 *  checking the same way. Keep it in step with TeacherApplication. */
export const APPLICATION_COLUMNS = [
  'id', 'name', 'email', 'phone_number', 'sir_maam', 'subjects', 'classes_taught_for_backend',
  'school_boards_catered', 'location_v2', 'students_home_areas', 'tutors_home_areas',
  'mode_of_teaching', 'class_size', 'description', 'qualifications_etc', 'years_started_teaching',
  'featured_subject', 'whatsapp_link', 'hero_image_url', 'reference_name', 'reference_number',
  'min_fees', 'max_fees', 'mou_consent', 'mou_consent_timestamp', 'status', 'texted_status',
  'reviewed_by', 'reviewed_at', 'rejection_reason', 'created_at', 'updated_at',
] as const;

/** What the page needs from the database, as one object, so dummy mode can run
 *  the real page against made-up applications. */
export interface ApprovalsApi {
  list(): Promise<TeacherApplication[]>;
  /** The approve_teacher_application RPC. */
  approve(applicationId: string, adminId: string): Promise<void>;
  /** An update to status 'rejected' with the reason the teacher can read. */
  reject(applicationId: string, adminId: string, reason: string | null): Promise<void>;
  /** An explicit update of texted_status only. */
  setTexted(applicationId: string, status: TextedStatus): Promise<void>;
  /** Names for the "reviewed by" line. */
  reviewerNames(ids: string[]): Promise<Record<string, string>>;
}

/** Someone else decided this application first. The page refreshes and says so
 *  instead of showing a generic failure or overwriting their decision. */
export class AlreadyDecidedError extends Error {
  constructor() {
    super('Application not found or already processed');
    this.name = 'AlreadyDecidedError';
  }
}

/** True for our own AlreadyDecidedError and for the wording approve_teacher_application
 *  raises when the row is no longer pending. */
export function isAlreadyDecided(e: unknown): boolean {
  if (e instanceof AlreadyDecidedError) return true;
  const msg = typeof e === 'object' && e !== null ? String((e as { message?: unknown }).message ?? '') : '';
  return /already processed/i.test(msg);
}

export const ALREADY_DECIDED_WORDS = 'Someone already decided this application. The list is updated.';

// ------------------------------------------------------------- shaping rows

const VALID_STATUS: ApplicationStatus[] = ['pending', 'approved', 'rejected'];
const VALID_TEXTED: TextedStatus[] = ['not_texted', 'texted', 'follow_up'];

/** Makes a database row safe to render: an unknown status is "pending" (it
 *  still needs a person), an unknown texted state is "not texted". */
export function normaliseApplicationRow(row: Record<string, unknown>): TeacherApplication {
  const r = row as unknown as TeacherApplication;
  return {
    ...r,
    sir_maam: r.sir_maam === 'Sir' || r.sir_maam === "Ma'am" ? r.sir_maam : 'Sir',
    status: (VALID_STATUS as string[]).includes(r.status) ? r.status : 'pending',
    texted_status: (VALID_TEXTED as string[]).includes(r.texted_status) ? r.texted_status : 'not_texted',
    min_fees: typeof r.min_fees === 'number' ? r.min_fees : null,
    max_fees: typeof r.max_fees === 'number' ? r.max_fees : null,
  };
}

// ------------------------------------------------------------------- views

export type StatusView = 'waiting' | 'approved' | 'rejected' | 'all';

export const STATUS_VIEWS: { key: StatusView; label: string; hint: string }[] = [
  { key: 'waiting', label: 'Waiting', hint: 'Applications nobody has decided yet, oldest first.' },
  { key: 'approved', label: 'Approved', hint: 'Applications that were approved and listed.' },
  { key: 'rejected', label: 'Rejected', hint: 'Applications that were turned down.' },
  { key: 'all', label: 'All', hint: 'Every application, newest first.' },
];

/** The AdminStatusPill tone of each status. */
export const STATUS_TONE: Record<ApplicationStatus, 'pending' | 'live' | 'hidden'> = { pending: 'pending', approved: 'live', rejected: 'hidden' };

export const DEFAULT_VIEW: StatusView = 'waiting';

export function viewFromParam(v: string | null | undefined): StatusView {
  return STATUS_VIEWS.some((s) => s.key === v) ? (v as StatusView) : DEFAULT_VIEW;
}

const VIEW_STATUS: Record<StatusView, ApplicationStatus | null> = { waiting: 'pending', approved: 'approved', rejected: 'rejected', all: null };

/** The few fields the list helpers read, so the reviewer's own application type fits too. */
export interface ListableApplication {
  id: string;
  status: ApplicationStatus;
  created_at: string;
  name: string;
  email: string;
  phone_number: string;
  reference_name: string | null;
  reference_number: string | null;
  subjects?: string | null;
}

export function countsByView(apps: Pick<ListableApplication, 'status'>[]): Record<StatusView, number> {
  return {
    waiting: apps.filter((a) => a.status === 'pending').length,
    approved: apps.filter((a) => a.status === 'approved').length,
    rejected: apps.filter((a) => a.status === 'rejected').length,
    all: apps.length,
  };
}

export type SortOrder = 'newest' | 'oldest';

/** The Waiting view works the queue from the oldest; the rest read newest first. */
export function defaultOrder(view: StatusView): SortOrder {
  return view === 'waiting' ? 'oldest' : 'newest';
}

export function filterApplications<T extends ListableApplication>(apps: T[], view: StatusView, search: string): T[] {
  const want = VIEW_STATUS[view];
  const q = search.trim().toLowerCase();
  return apps.filter((a) => {
    if (want && a.status !== want) return false;
    if (!q) return true;
    return (
      a.name?.toLowerCase().includes(q) ||
      a.email?.toLowerCase().includes(q) ||
      a.phone_number?.includes(q) ||
      a.reference_name?.toLowerCase().includes(q) ||
      a.reference_number?.includes(q) ||
      a.subjects?.toLowerCase().includes(q)
    );
  });
}

export function sortApplications<T extends Pick<ListableApplication, 'created_at'>>(apps: T[], order: SortOrder): T[] {
  return [...apps].sort((a, b) => {
    const diff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    return order === 'newest' ? -diff : diff;
  });
}

/** The empty-list wording, one line per view. Only ever shown after a read that SUCCEEDED. */
export function emptyCopy(view: StatusView, search: string): { title: string; hint?: string } {
  const q = search.trim();
  if (q) return { title: `No applications match "${q}".`, hint: 'Check the spelling, or search by phone number or email.' };
  switch (view) {
    case 'waiting':
      return { title: 'No applications are waiting.', hint: 'New ones appear here as teachers apply.' };
    case 'approved':
      return { title: 'No approved applications yet.' };
    case 'rejected':
      return { title: 'No rejected applications.' };
    default:
      return { title: 'No applications yet.' };
  }
}

// ------------------------------------------------------------ next in queue

/** The id to open after `currentId` is decided: the next waiting application
 *  after it in the list on screen, else the nearest waiting one before it, else
 *  null (the queue is empty and the dialog closes). */
export function nextToOpen(shown: Pick<ListableApplication, 'id' | 'status'>[], currentId: string): string | null {
  const i = shown.findIndex((a) => a.id === currentId);
  const after = shown.slice(i + 1).find((a) => a.status === 'pending');
  if (after) return after.id;
  const before = [...shown.slice(0, Math.max(i, 0))].reverse().find((a) => a.status === 'pending');
  return before ? before.id : null;
}

/** Previous and next neighbours of `currentId` in the list on screen. */
export function neighbours(shown: Pick<ListableApplication, 'id'>[], currentId: string): { prev: string | null; next: string | null; index: number } {
  const index = shown.findIndex((a) => a.id === currentId);
  return {
    index,
    prev: index > 0 ? shown[index - 1].id : null,
    next: index >= 0 && index < shown.length - 1 ? shown[index + 1].id : null,
  };
}

// ------------------------------------------------------------ outreach state

export const TEXTED_OPTIONS: { key: TextedStatus; label: string }[] = [
  { key: 'not_texted', label: 'Not texted' },
  { key: 'texted', label: 'Texted' },
  { key: 'follow_up', label: 'Follow up' },
];

export function textedLabel(s: TextedStatus): string {
  return TEXTED_OPTIONS.find((o) => o.key === s)?.label ?? 'Not texted';
}

// ---------------------------------------------------------------- decisions

export function approveCopy(name: string) {
  return {
    title: `Approve ${name}?`,
    description: 'They will be listed on the site straight away and can be found by parents.',
    confirmLabel: 'Approve and list',
  };
}

export interface ConfirmFn {
  (o: { title: string; description?: string; confirmLabel?: string }): Promise<boolean>;
}

/** Approving puts a teacher in front of parents, so it asks first. Resolves
 *  'cancelled' without touching the api if the admin says no. */
export async function approveWithConfirm(opts: {
  app: Pick<TeacherApplication, 'id' | 'name'>;
  adminId: string;
  api: Pick<ApprovalsApi, 'approve'>;
  confirm: ConfirmFn;
}): Promise<'approved' | 'cancelled'> {
  const ok = await opts.confirm(approveCopy(opts.app.name));
  if (!ok) return 'cancelled';
  await opts.api.approve(opts.app.id, opts.adminId);
  return 'approved';
}

/** Rejecting needs a reason the teacher can read. No reason, no call. */
export async function rejectWithReason(opts: {
  app: Pick<TeacherApplication, 'id'>;
  adminId: string;
  reason: string;
  api: Pick<ApprovalsApi, 'reject'>;
}): Promise<'rejected' | 'needs_reason'> {
  const reason = opts.reason.trim();
  if (!reason) return 'needs_reason';
  await opts.api.reject(opts.app.id, opts.adminId, reason);
  return 'rejected';
}

/** The row as the list should show it right after a decision, before the quiet refetch. */
export function withDecision(app: TeacherApplication, status: 'approved' | 'rejected', adminId: string, reason: string | null, now = new Date()): TeacherApplication {
  return {
    ...app,
    status,
    reviewed_by: adminId,
    reviewed_at: now.toISOString(),
    updated_at: now.toISOString(),
    rejection_reason: status === 'rejected' ? reason : app.rejection_reason,
  };
}
