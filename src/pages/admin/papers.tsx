import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth-context';
import { recordAdminAction } from '@/lib/audit';
import { useAdminGuard, AdminGuardErrorState, adminToast, adminFieldStyle, adminPanelStyle } from '@/components/AdminConsole';
import { AdminHeader, AdminAuditNote, buildAdminNav } from '@/pages/admin/shell';
import { AdminPageIntroPanel } from '@/components/admin/AdminHelp';
import { useAdminSectionCounts, useRefreshAdminCounts } from '@/pages/admin/useAdminSectionCounts';
import { AdminTable, AdminPanelHeader, AdminStatusPill, type AdminTableColumn, type AdminTableRow, type AdminStatus } from '@/pages/admin/AdminTable';
import { BentoPanel, BentoStack } from '@/components/layout/PageContainer';
import { AdminDialog } from '@/components/admin/AdminDialog';
import { AdminEmpty, AdminError, AdminLoading } from '@/components/admin/AdminState';
import { AdminFilterChips, type AdminFilterChip } from '@/components/admin/AdminFilterChips';
import { AdminPillButton } from '@/components/admin/AdminPillButton';
import { AdminTabs } from '@/components/admin/AdminTabs';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, Plus, Search, Upload, X, FileText } from 'lucide-react';
import { SUBJECTS, CLASSES, BOARDS, EXAM_TYPES } from '@/utils/searchFacets';
import { cn } from '@/lib/utils';
import { createLatestGuard } from '@/lib/latest-guard';
import { HIDE_REASON_NOTE } from '@/lib/admin-hints';
import { usePageMeta } from '@/hooks/usePageMeta';
import { PREVIEW_TOOLS } from '@/lib/preview-tools';
import { isDummyMode } from '@/lib/dummy-mode';

const DummyPapers = PREVIEW_TOOLS ? lazy(() => import('@/dummy/AdminPapersDummy')) : null;

/* /admin/papers: Student uploads. Two views, kept in the URL (?view=):
   - pending (default): what students sent in through Submit a paper
     (paper_submissions), with Pending, Approved, Rejected and All.
   - live: the `papers` table, the papers on the site that came from an admin
     upload or an approved student upload, with Live, Hidden and All.

   Ported wholesale from the legacy src/pages/AdminPapers.tsx: the publish or
   draft form, the hide (was "take down") and restore writes, and the review
   of a student upload all keep their original Supabase calls. They now sit in
   `realPapersApi` below, in the same order with the same arguments, so the
   dummy mode can run this very page against made-up uploads.

   "Hide" always collects a reason. Restore is a single click.

   One number, once: the chips carry the per-view counts, and a count that
   could not be read shows "?" (never 0, never "No papers yet"). A failed load
   shows Try again; "No papers yet" is only for a read that succeeded and
   came back empty. */

const PAPER_CLASSES = CLASSES.filter((c) => c !== 'UG');

export interface PaperRow {
  id: string;
  title: string;
  school: string;
  subject: string;
  class: string;
  board: string;
  exam_type: string;
  year: number;
  file_url: string | null;
  is_published: boolean;
  created_at: string;
}

export type FormState = Partial<PaperRow>;

/* Not the same table as PaperRow above -- paper_submissions is the inbox a
   real student's /submit-a-paper upload lands in (migration
   20260829072445_paper_submissions.sql). "Review promotes it into `papers`;
   this row stays as the audit trail" per that migration's own comment. */
export interface SubmissionRow {
  id: string;
  created_at: string;
  school: string;
  board: string | null;
  class: string | null;
  subject: string;
  year: string | null;
  exam_type: string | null;
  submitter_name: string | null;
  submitter_contact: string | null;
  file_paths: string[];
  status: 'pending' | 'approved' | 'rejected';
  review_note: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
}

export interface PaperPayload {
  title: string;
  school: string;
  subject: string;
  class: string;
  board: string;
  exam_type: string;
  year: number;
  file_url: string | null;
  is_published: boolean;
}

/** The upload is marked approved but the paper could not be switched to live.
 *  It exists as a draft; Restore on the Papers list brings it live. */
export class ApprovedNotLiveError extends Error {
  constructor(
    public paperId: string,
    public reviewedAt: string,
  ) {
    super('Upload approved, but the paper is still a draft');
    this.name = 'ApprovedNotLiveError';
  }
}

export interface ApproveInput {
  target: SubmissionRow;
  title: string;
  board: string;
  cls: string;
  examType: string;
  year: string;
  reviewerId: string;
}

/** Everything this page reads and writes, as one object so the dummy mode can
 *  run the real page against made-up uploads. */
export interface PapersApi {
  papers(): Promise<PaperRow[]>;
  submissions(): Promise<SubmissionRow[]>;
  /** Stores a PDF and returns its public address. */
  uploadPdf(file: File): Promise<string>;
  /** Cleans up a stored PDF after a failed publish. Never throws. */
  removeUploaded(fileUrl: string): Promise<void>;
  insertPaper(payload: PaperPayload): Promise<string | null>;
  setPublished(id: string, published: boolean): Promise<void>;
  signSubmissionFiles(paths: string[]): Promise<{ path: string; url: string | null }[]>;
  approveSubmission(input: ApproveInput): Promise<{ paperId: string | null; reviewedAt: string }>;
  rejectSubmission(id: string, reason: string, reviewerId: string): Promise<{ reviewedAt: string }>;
}

/* SubmitPaper.tsx's own EXAM_TYPES ('Prelim / Pre-board', 'Half-yearly',
   'Annual / Final', 'Unit test', 'Other') is a different, hand-written list
   from this one (EXAM_TYPES below, from searchFacets.ts) -- and `papers`
   has a CHECK constraint restricted to exactly this file's five values.
   Caught by inserting a real test row before wiring this up: an unmapped
   exam_type 23514-violated the constraint and would have failed to approve
   every real submission, since the public form only ever offers its own
   spelling. Approximate on open; the admin can still correct it via the
   Select in the approve dialog before publishing. */
export function mapSubmittedExamType(raw: string | null): string {
  const key = (raw ?? '').trim().toLowerCase();
  if (key.startsWith('prelim')) return 'Prelims';
  if (key.startsWith('half')) return 'Half-Yearly';
  if (key.startsWith('annual') || key.startsWith('final')) return 'Final';
  if (key.startsWith('unit')) return 'Unit Test';
  return EXAM_TYPES[0];
}

/* What the approve dialog opens with for a submission. A value the sender did
   not give ("Not sure" is stored as null), or one this site has no slot for
   (the public form offers Class UG and Exam "Other"; papers has neither), comes
   back as '' rather than as the first option. Defaulting it quietly to ICSE,
   Class 1 and Prelims let a submission go live with a board, class or exam the
   reviewer never chose. '' leaves the Select on its placeholder and keeps
   Approve switched off until a person picks. */
export function submittedReviewDefaults(s: {
  board: string | null;
  class: string | null;
  exam_type: string | null;
}): { board: string; cls: string; examType: string } {
  const key = (s.exam_type ?? '').trim().toLowerCase();
  const examKnown = ['prelim', 'half', 'annual', 'final', 'unit'].some((k) => key.startsWith(k));
  return {
    board: s.board && BOARDS.includes(s.board) ? s.board : '',
    cls: s.class && PAPER_CLASSES.includes(s.class) ? s.class : '',
    examType: examKnown ? mapSubmittedExamType(s.exam_type) : '',
  };
}

function submissionStatusTone(status: SubmissionRow['status']): AdminStatus {
  if (status === 'approved') return 'live';
  if (status === 'rejected') return 'hidden';
  return 'pending';
}

const BLANK_FORM: FormState = {
  title: '',
  school: '',
  subject: SUBJECTS[0],
  class: PAPER_CLASSES[0],
  board: BOARDS[0],
  exam_type: EXAM_TYPES[0],
  year: new Date().getFullYear(),
};

export type RequiredPaperField = 'title' | 'school' | 'subject' | 'class' | 'board' | 'year';

/** The required fields of the upload form that are still empty. */
export function missingPaperFields(f: FormState): RequiredPaperField[] {
  const out: RequiredPaperField[] = [];
  if (!f.title?.trim()) out.push('title');
  if (!f.school?.trim()) out.push('school');
  if (!f.subject) out.push('subject');
  if (!f.class) out.push('class');
  if (!f.board) out.push('board');
  if (!f.year) out.push('year');
  return out;
}

/** The row written to `papers`. `publish` is the button the admin pressed:
 *  "Publish this paper" passes true and "Save as draft" passes false, so the
 *  label always says what happens. (It used to depend on a checkbox the
 *  buttons ignored: "Save as draft" saved a live paper.) */
export function buildPaperPayload(f: FormState, publish: boolean): PaperPayload {
  return {
    title: (f.title ?? '').trim(),
    school: (f.school ?? '').trim(),
    subject: f.subject as string,
    class: f.class as string,
    board: f.board as string,
    exam_type: f.exam_type || EXAM_TYPES[0],
    year: Number(f.year),
    file_url: f.file_url || null,
    is_published: publish,
  };
}

const PAPER_COLUMNS = 'id,title,school,subject,class,board,exam_type,year,file_url,is_published,created_at';
const SUBMISSION_COLUMNS =
  'id,created_at,school,board,class,subject,year,exam_type,submitter_name,submitter_contact,file_paths,status,review_note,reviewed_at,reviewed_by';

export const realPapersApi: PapersApi = {
  async papers() {
    /* An explicit column list, not select('*').
       PostgREST expands `*` to the columns the current role MAY read and
       does NOT error on the ones it may not. So a column revoke turns this
       query into a silently smaller row: no failure, no warning, just fields
       that are suddenly undefined. Naming the columns means that decision
       would fail loudly here instead of quietly emptying the admin screen. */
    const { data, error } = await supabase.from('papers').select(PAPER_COLUMNS).order('created_at', { ascending: false });
    if (error) throw error;
    return (data as PaperRow[]) || [];
  },

  async submissions() {
    const { data, error } = await supabase.from('paper_submissions').select(SUBMISSION_COLUMNS).order('created_at', { ascending: false });
    if (error) throw error;
    return (data as SubmissionRow[]) || [];
  },

  async uploadPdf(file) {
    const fileName = `papers/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
    const { error } = await supabase.storage.from('paper-files').upload(fileName, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: 'application/pdf',
    });
    if (error) throw error;
    const {
      data: { publicUrl },
    } = supabase.storage.from('paper-files').getPublicUrl(fileName);
    return publicUrl;
  },

  async removeUploaded(fileUrl) {
    const marker = '/paper-files/';
    const idx = fileUrl.indexOf(marker);
    if (idx === -1) return;
    const path = fileUrl.slice(idx + marker.length);
    try {
      await supabase.storage.from('paper-files').remove([path]);
    } catch {
      /* best effort */
    }
  },

  async insertPaper(payload) {
    const { data, error } = await supabase.from('papers').insert(payload).select('id').single();
    if (error) throw error;
    return data?.id ?? null;
  },

  async setPublished(id, published) {
    const { error } = await supabase.from('papers').update({ is_published: published }).eq('id', id);
    if (error) throw error;
  },

  /* The `paper-submissions` bucket is private (an unreviewed upload from a
     stranger, per that migration's own comment), so a plain public URL would
     404. Regenerated every open rather than cached: signed URLs expire. */
  async signSubmissionFiles(paths) {
    return Promise.all(
      paths.map(async (path) => {
        const { data, error } = await supabase.storage.from('paper-submissions').createSignedUrl(path, 60 * 10);
        return { path, url: error ? null : data?.signedUrl ?? null };
      }),
    );
  },

  /* Approve: promotes the submission into the real `papers` table and marks
     the submission reviewed. `papers.file_url` is a single column -- a
     submission can carry several photographed pages, but there is nowhere to
     put more than one, so only the first file is copied across; this is an
     existing schema limitation. The copy goes through the client (download
     then re-upload) because the `paper-submissions` bucket is private and
     `paper-files` is the bucket uploadPdf already writes to -- same bucket,
     same path convention, so an approved submission's paper opens exactly like
     one uploaded directly through this page. */
  async approveSubmission({ target, title, board, cls, examType, year, reviewerId }) {
    let file_url: string | null = null;
    const firstPath = target.file_paths[0];
    if (firstPath) {
      const { data: fileBlob, error: downloadError } = await supabase.storage.from('paper-submissions').download(firstPath);
      if (downloadError) throw downloadError;
      const baseName = firstPath.split('/').pop() || 'submission';
      const destPath = `papers/${Date.now()}-${baseName.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
      const { error: uploadError } = await supabase.storage
        .from('paper-files')
        .upload(destPath, fileBlob, { cacheControl: '3600', upsert: false });
      if (uploadError) throw uploadError;
      file_url = supabase.storage.from('paper-files').getPublicUrl(destPath).data.publicUrl;
    }

    const yearNum = Number(year);
    const { data: inserted, error: insertError } = await supabase
      .from('papers')
      .insert({
        title,
        school: target.school,
        subject: target.subject,
        class: cls || PAPER_CLASSES[0],
        board: board || BOARDS[0],
        /* Must be one of EXAM_TYPES' exact spellings -- papers has a CHECK
           constraint on this column and the submission's own exam_type (a
           different vocabulary written by SubmitPaper.tsx) violates it
           outright. examType is seeded by mapSubmittedExamType() and editable
           in the dialog, never the raw submission value. */
        exam_type: EXAM_TYPES.includes(examType) ? examType : EXAM_TYPES[0],
        year: Number.isFinite(yearNum) && yearNum >= 2000 && yearNum <= 2100 ? yearNum : new Date().getFullYear(),
        file_url,
        /* Created as a draft and only made live once the upload is marked
           approved. The other order could leave a live paper behind an upload
           that still reads Pending when the second write failed. */
        is_published: false,
      })
      .select('id')
      .single();
    if (insertError) throw insertError;
    const paperId: string | null = inserted?.id ?? null;

    const reviewedAt = new Date().toISOString();
    const { error: reviewError } = await supabase
      .from('paper_submissions')
      .update({ status: 'approved', reviewed_at: reviewedAt, reviewed_by: reviewerId })
      .eq('id', target.id);
    if (reviewError) {
      // Nothing went live. Remove the draft so a retry does not leave a twin.
      if (paperId) {
        try {
          await supabase.from('papers').delete().eq('id', paperId);
        } catch {
          /* best effort: a leftover draft is hidden and harmless */
        }
      }
      throw reviewError;
    }

    if (paperId) {
      const { error: liveError } = await supabase.from('papers').update({ is_published: true }).eq('id', paperId);
      if (liveError) throw new ApprovedNotLiveError(paperId, reviewedAt);
    }
    return { paperId, reviewedAt };
  },

  async rejectSubmission(id, reason, reviewerId) {
    const reviewedAt = new Date().toISOString();
    const { error } = await supabase
      .from('paper_submissions')
      .update({ status: 'rejected', review_note: reason, reviewed_at: reviewedAt, reviewed_by: reviewerId })
      .eq('id', id);
    if (error) throw error;
    return { reviewedAt };
  },
};

export type LoadState = 'loading' | 'ok' | 'error';

export type ListView = 'loading' | 'error' | 'search-empty' | 'none-yet' | 'filter-empty' | 'rows';

/** Which body a list shows. A failed read is `error`, never `none-yet`: "No
 *  papers yet" is only for a read that succeeded and came back empty. Pure, so
 *  it is tested without a login. */
export function listView(q: { state: LoadState; total: number; shown: number; searching: boolean }): ListView {
  if (q.state === 'loading') return 'loading';
  if (q.state === 'error') return 'error';
  if (q.shown > 0) return 'rows';
  if (q.searching) return 'search-empty';
  return q.total === 0 ? 'none-yet' : 'filter-empty';
}
type View = 'pending' | 'live';
type UploadFilter = 'waiting' | 'approved' | 'rejected' | 'all';
type PaperFilter = 'live' | 'hidden' | 'all';

/** An upload's status in the admin's words, matching the page help: Pending, Approved, Rejected. */
export const statusWords = (s: SubmissionRow['status']): string => (s === 'pending' ? 'Pending' : s === 'approved' ? 'Approved' : 'Rejected');

export function AdminPapersPage({
  api = realPapersApi,
  dummy = false,
  banner,
}: {
  api?: PapersApi;
  dummy?: boolean;
  banner?: ReactNode;
}) {
  usePageMeta('Student uploads | Shikshaq Admin', 'Read, approve or reject papers students sent in, and hide or restore live papers.');
  const { user, profile } = useAuth();
  const actorName = dummy ? 'admin@example.com' : profile?.full_name || user?.email || 'an admin';
  const actorId = dummy ? 'dummy-admin' : user?.id;
  const guard = useAdminGuard(dummy ? null : user, { redirectOnDenied: !dummy });
  const isAdmin = dummy ? true : guard.isAdmin;
  const checkingAdmin = dummy ? false : guard.checkingAdmin;
  const refreshCounts = useRefreshAdminCounts();
  const sectionCounts = useAdminSectionCounts();

  const [searchParams, setSearchParams] = useSearchParams();
  const view: View = searchParams.get('view') === 'live' ? 'live' : 'pending';
  const setView = (v: View) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (v === 'pending') next.delete('view');
        else next.set('view', v);
        return next;
      },
      { replace: true },
    );

  const [papers, setPapers] = useState<PaperRow[]>([]);
  const [papersState, setPapersState] = useState<LoadState>('loading');
  const [submissions, setSubmissions] = useState<SubmissionRow[]>([]);
  const [submissionsState, setSubmissionsState] = useState<LoadState>('loading');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [uploadFilter, setUploadFilter] = useState<UploadFilter>('waiting');
  const [paperFilter, setPaperFilter] = useState<PaperFilter>('live');

  // Upload flow (ported from the legacy Upload sub-tab; lives in a dialog here).
  const [uploadOpen, setUploadOpen] = useState(false);
  const [formData, setFormData] = useState<FormState>(BLANK_FORM);
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState<'publish' | 'draft' | null>(null);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  // Hide flow. A reason is required, unlike the legacy silent overflow toggle.
  const [hideTarget, setHideTarget] = useState<PaperRow | null>(null);
  const [hideReason, setHideReason] = useState('');
  const [hideBusy, setHideBusy] = useState(false);
  const [restoreBusyId, setRestoreBusyId] = useState<string | null>(null);

  const [reviewTarget, setReviewTarget] = useState<SubmissionRow | null>(null);
  const signGuard = useRef(createLatestGuard());
  const [reviewFileUrls, setReviewFileUrls] = useState<{ path: string; url: string | null }[]>([]);
  const [reviewFilesLoading, setReviewFilesLoading] = useState(false);
  const [approveTitle, setApproveTitle] = useState('');
  // Editable, pre-filled from the submission -- exam_type in particular is
  // never trusted as-is (see mapSubmittedExamType's comment).
  const [approveBoard, setApproveBoard] = useState('');
  const [approveClass, setApproveClass] = useState('');
  const [approveExamType, setApproveExamType] = useState('');
  const [approveYear, setApproveYear] = useState('');
  const [showReject, setShowReject] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [reviewBusy, setReviewBusy] = useState(false);

  // First load shows the skeleton. A quiet refetch (after an action) keeps the
  // rows on screen, and if it fails the rows stay and a toast says so.
  const loadPapers = useCallback(
    async (quiet = false) => {
      if (!quiet) setPapersState('loading');
      try {
        setPapers(await api.papers());
        setPapersState('ok');
      } catch (error) {
        if (import.meta.env.DEV) console.error('Error fetching papers:', error);
        if (quiet) adminToast('Could not refresh the live papers');
        else setPapersState('error');
      }
    },
    [api],
  );

  const loadSubmissions = useCallback(
    async (quiet = false) => {
      if (!quiet) setSubmissionsState('loading');
      try {
        setSubmissions(await api.submissions());
        setSubmissionsState('ok');
      } catch (error) {
        if (import.meta.env.DEV) console.error('Error fetching submissions:', error);
        if (quiet) adminToast('Could not refresh the student uploads');
        else setSubmissionsState('error');
      }
    },
    [api],
  );

  useEffect(() => {
    if (isAdmin) {
      void loadPapers();
      void loadSubmissions();
    }
  }, [isAdmin, loadPapers, loadSubmissions]);

  const matchesSearch = (text: string[]) => {
    const q = searchQuery.trim().toLowerCase();
    return !q || text.some((t) => t.toLowerCase().includes(q));
  };
  const byDate = (a: { created_at: string }, b: { created_at: string }) => {
    const diff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    return sortOrder === 'newest' ? -diff : diff;
  };

  const filteredPapers = useMemo(
    () =>
      papers
        .filter((p) => (paperFilter === 'all' ? true : paperFilter === 'live' ? p.is_published : !p.is_published))
        .filter((p) => matchesSearch([p.title, p.school, p.subject]))
        .sort(byDate),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [papers, paperFilter, searchQuery, sortOrder],
  );

  const filteredSubmissions = useMemo(
    () =>
      submissions
        .filter((s) => (uploadFilter === 'all' ? true : uploadFilter === 'waiting' ? s.status === 'pending' : s.status === uploadFilter))
        .filter((s) => matchesSearch([s.school, s.subject, s.submitter_name ?? '']))
        .sort(byDate),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [submissions, uploadFilter, searchQuery, sortOrder],
  );

  function handleChange<K extends keyof FormState>(field: K, value: FormState[K]) {
    setFormData((prev) => ({ ...prev, [field]: value }));
  }

  function openUpload() {
    setFormData(BLANK_FORM);
    setAttempted(false);
    setUploadOpen(true);
  }

  function closeUpload() {
    setUploadOpen(false);
    setFormData(BLANK_FORM);
    setAttempted(false);
  }

  async function handleFileUpload(file: File) {
    if (file.type !== 'application/pdf') {
      adminToast('Only PDF files are supported');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      adminToast('File must be under 20MB');
      return;
    }
    try {
      setUploadingFile(true);
      handleChange('file_url', await api.uploadPdf(file));
      adminToast('File uploaded');
    } catch (error) {
      if (import.meta.env.DEV) console.error('Upload error:', error);
      adminToast('File upload failed');
    } finally {
      setUploadingFile(false);
    }
  }

  function handleDropZoneDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFileUpload(file);
  }

  const missing = missingPaperFields(formData);

  async function handleSave(publish: boolean) {
    if (uploadingFile) {
      adminToast('Wait for the PDF to finish uploading');
      return;
    }
    setAttempted(true);
    if (missing.length > 0) {
      adminToast('Fill in the fields marked Required');
      return;
    }
    try {
      setSaving(publish ? 'publish' : 'draft');
      const payload = buildPaperPayload(formData, publish);
      const newId = await api.insertPaper(payload);
      adminToast(publish ? 'Paper published' : 'Paper saved as a draft');
      if (!dummy && user) {
        void recordAdminAction({
          actorId: user.id,
          actorName,
          action: 'publish',
          targetType: 'paper',
          targetId: newId || payload.title,
          targetLabel: payload.title,
        });
      }
      void loadPapers(true);
      closeUpload();
    } catch (error) {
      if (import.meta.env.DEV) console.error('Save error:', error);
      /* The PDF, if any, already made it to storage before this insert ran --
         clean it up so a failed publish doesn't leave an orphaned file nothing
         in `papers` will ever reference. */
      if (formData.file_url) {
        void api.removeUploaded(formData.file_url);
        // The stored file is gone, so the form must not keep pointing at it.
        handleChange('file_url', null);
        adminToast('Failed to save paper', { description: 'The PDF was removed again. Upload it once more, then publish.' });
      } else {
        adminToast('Failed to save paper');
      }
    } finally {
      setSaving(null);
    }
  }

  function openHide(paper: PaperRow) {
    setHideTarget(paper);
    setHideReason('');
  }

  function closeHide() {
    setHideTarget(null);
    setHideReason('');
  }

  async function confirmHide() {
    if (!hideTarget) return;
    const reason = hideReason.trim();
    if (!reason) {
      adminToast('A reason is required to hide a paper');
      return;
    }
    const target = hideTarget;
    try {
      setHideBusy(true);
      await api.setPublished(target.id, false);
      setPapers((prev) => prev.map((p) => (p.id === target.id ? { ...p, is_published: false } : p)));
      adminToast('Paper hidden');
      refreshCounts();
      if (!dummy && user) {
        void recordAdminAction({
          actorId: user.id,
          actorName,
          action: 'takedown',
          targetType: 'paper',
          targetId: target.id,
          targetLabel: target.title,
          reason,
        });
      }
      closeHide();
    } catch (error) {
      if (import.meta.env.DEV) console.error('Hide error:', error);
      adminToast('Failed to hide the paper');
    } finally {
      setHideBusy(false);
    }
  }

  async function handleRestore(paper: PaperRow) {
    try {
      setRestoreBusyId(paper.id);
      await api.setPublished(paper.id, true);
      setPapers((prev) => prev.map((p) => (p.id === paper.id ? { ...p, is_published: true } : p)));
      adminToast('Paper restored');
      refreshCounts();
      if (!dummy && user) {
        void recordAdminAction({
          actorId: user.id,
          actorName,
          action: 'publish',
          targetType: 'paper',
          targetId: paper.id,
          targetLabel: paper.title,
        });
      }
    } catch (error) {
      if (import.meta.env.DEV) console.error('Restore error:', error);
      adminToast('Failed to restore the paper');
    } finally {
      setRestoreBusyId(null);
    }
  }

  /* Opens the review dialog and, for any upload, resolves signed URLs for its
     files. */
  async function openReview(submission: SubmissionRow) {
    setReviewTarget(submission);
    setApproveTitle(`${submission.subject}${submission.exam_type ? ` ${submission.exam_type}` : ''}`.trim());
    const defaults = submittedReviewDefaults(submission);
    setApproveBoard(defaults.board);
    setApproveClass(defaults.cls);
    setApproveExamType(defaults.examType);
    const yearNum = Number(submission.year);
    setApproveYear(String(Number.isFinite(yearNum) && yearNum >= 2000 && yearNum <= 2100 ? yearNum : new Date().getFullYear()));
    setShowReject(false);
    setRejectReason('');
    setReviewFileUrls(submission.file_paths.map((path) => ({ path, url: null })));
    // Only the upload now open may receive its links; an earlier one that
    // answers late is dropped.
    const token = signGuard.current.next();
    if (submission.file_paths.length === 0) {
      setReviewFilesLoading(false);
      return;
    }
    setReviewFilesLoading(true);
    try {
      const signed = await api.signSubmissionFiles(submission.file_paths);
      if (signGuard.current.isCurrent(token)) setReviewFileUrls(signed);
    } catch (error) {
      if (import.meta.env.DEV) console.error('Error signing submission files:', error);
    } finally {
      if (signGuard.current.isCurrent(token)) setReviewFilesLoading(false);
    }
  }

  function closeReview() {
    signGuard.current.cancel();
    setReviewFilesLoading(false);
    setReviewTarget(null);
    setReviewFileUrls([]);
    setApproveTitle('');
    setApproveBoard('');
    setApproveClass('');
    setApproveExamType('');
    setApproveYear('');
    setShowReject(false);
    setRejectReason('');
  }

  async function handleApprove() {
    if (!reviewTarget || !actorId) return;
    if (!approveTitle.trim()) {
      adminToast('A title is required to publish this paper');
      return;
    }
    if (!approveBoard || !approveClass || !approveExamType) {
      adminToast('Choose the board, class and exam type before publishing');
      return;
    }
    if (reviewTarget.file_paths.length === 0) {
      adminToast('This upload has no files, so there is nothing to publish. Reject it instead.');
      return;
    }
    const target = reviewTarget;
    try {
      setReviewBusy(true);
      const { paperId, reviewedAt } = await api.approveSubmission({
        target,
        title: approveTitle.trim(),
        board: approveBoard,
        cls: approveClass,
        examType: approveExamType,
        year: approveYear,
        reviewerId: actorId,
      });
      setSubmissions((prev) =>
        prev.map((s) => (s.id === target.id ? { ...s, status: 'approved', reviewed_at: reviewedAt, reviewed_by: actorId } : s)),
      );
      adminToast('Upload approved and published');
      refreshCounts();
      if (!dummy) {
        void recordAdminAction({
          actorId,
          actorName,
          action: 'approve',
          targetType: 'paper_submission',
          targetId: target.id,
          targetLabel: `${target.school} - ${target.subject}`,
        });
        if (paperId) {
          void recordAdminAction({
            actorId,
            actorName,
            action: 'publish',
            targetType: 'paper',
            targetId: paperId,
            targetLabel: approveTitle.trim(),
          });
        }
      }
      void loadPapers(true);
      closeReview();
    } catch (error) {
      if (import.meta.env.DEV) console.error('Approve submission error:', error);
      if (error instanceof ApprovedNotLiveError) {
        // The upload is approved and the paper exists, only as a draft.
        setSubmissions((prev) =>
          prev.map((s) => (s.id === target.id ? { ...s, status: 'approved', reviewed_at: error.reviewedAt, reviewed_by: actorId } : s)),
        );
        refreshCounts();
        void loadPapers(true);
        closeReview();
        adminToast('Upload approved, but the paper is not live yet', {
          description: 'It is saved as a draft. Open the Papers list and press Restore to put it on the site.',
        });
      } else {
        adminToast('Failed to approve this upload');
      }
    } finally {
      setReviewBusy(false);
    }
  }

  async function handleRejectSubmission() {
    if (!reviewTarget || !actorId) return;
    const reason = rejectReason.trim();
    if (!reason) {
      adminToast('A reason is required to reject an upload');
      return;
    }
    const target = reviewTarget;
    try {
      setReviewBusy(true);
      const { reviewedAt } = await api.rejectSubmission(target.id, reason, actorId);
      setSubmissions((prev) =>
        prev.map((s) =>
          s.id === target.id ? { ...s, status: 'rejected', review_note: reason, reviewed_at: reviewedAt, reviewed_by: actorId } : s,
        ),
      );
      adminToast('Upload rejected');
      refreshCounts();
      if (!dummy) {
        void recordAdminAction({
          actorId,
          actorName,
          action: 'reject',
          targetType: 'paper_submission',
          targetId: target.id,
          targetLabel: `${target.school} - ${target.subject}`,
          reason,
        });
      }
      closeReview();
    } catch (error) {
      if (import.meta.env.DEV) console.error('Reject submission error:', error);
      adminToast('Failed to reject this upload');
    } finally {
      setReviewBusy(false);
    }
  }

  const nav = buildAdminNav('submissions', sectionCounts);
  const signedIn = user?.email ?? actorName;

  if (checkingAdmin) {
    return (
      <BentoStack className="min-h-screen bg-muted">
        <AdminHeader nav={nav} signedInEmail={signedIn} />
        <BentoPanel fill="card" className="px-1.5 py-[18px] lg:px-1.5 lg:py-[18px]">
          <AdminLoading shape="table" rows={5} label="Checking your access" className="px-[18px]" />
        </BentoPanel>
        <AdminAuditNote />
      </BentoStack>
    );
  }

  if (!dummy && guard.error) return <AdminGuardErrorState onRetry={guard.retry} />;

  if (!isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted px-4">
        <div className={cn(adminPanelStyle, 'max-w-[380px] p-8 text-center')}>
          <h1 className="mb-2 text-xl font-bold text-foreground">Access denied</h1>
          <p className="text-sm text-warm-secondary">You need to be an admin to access this page.</p>
        </div>
      </div>
    );
  }

  const papersOk = papersState === 'ok';
  const submissionsOk = submissionsState === 'ok';
  const countOf = (ok: boolean, n: number) => (ok ? n : undefined);
  const pendingCount = countOf(submissionsOk, submissions.filter((s) => s.status === 'pending').length);

  const uploadChips: AdminFilterChip[] = [
    { key: 'waiting', label: 'Pending', count: pendingCount },
    { key: 'approved', label: 'Approved', count: countOf(submissionsOk, submissions.filter((s) => s.status === 'approved').length) },
    { key: 'rejected', label: 'Rejected', count: countOf(submissionsOk, submissions.filter((s) => s.status === 'rejected').length) },
    { key: 'all', label: 'All', count: countOf(submissionsOk, submissions.length) },
  ];
  const paperChips: AdminFilterChip[] = [
    { key: 'live', label: 'Live', count: countOf(papersOk, papers.filter((p) => p.is_published).length) },
    { key: 'hidden', label: 'Hidden', count: countOf(papersOk, papers.filter((p) => !p.is_published).length) },
    { key: 'all', label: 'All', count: countOf(papersOk, papers.length) },
  ];

  // Columns: Title, School, Board, Class, Year, Status. The real `papers`
  // schema has only an `is_published` boolean, so a live row gets Open and
  // Hide (destructive, tinted, last) and a hidden row gets the one real
  // action the schema supports: Restore (mint).
  const columns: AdminTableColumn[] = [
    { key: 'title', label: 'Title', width: '2fr', wrap: true },
    { key: 'school', label: 'School', width: '1.4fr', wrap: true },
    { key: 'board', label: 'Board', width: '0.8fr' },
    { key: 'class', label: 'Class', width: '0.6fr' },
    { key: 'year', label: 'Year', width: '0.6fr' },
    { key: 'status', label: 'Status', width: '0.9fr' },
  ];

  const rows: AdminTableRow[] = filteredPapers.map((p) => ({
    id: p.id,
    cells: [
      p.title,
      p.school,
      p.board,
      p.class,
      String(p.year),
      <AdminStatusPill key="status" status={p.is_published ? 'live' : 'hidden'} label={p.is_published ? 'Live' : 'Hidden'} />,
    ],
    actions: p.is_published
      ? [
          { label: 'Open', tone: 'primary', onClick: () => window.open(`/past-papers/${p.id}`, '_blank', 'noopener') },
          { label: 'Hide', tone: 'destructive', onClick: () => openHide(p) },
        ]
      : [
          { label: restoreBusyId === p.id ? '...' : 'Restore', tone: 'mint', onClick: () => void handleRestore(p), disabled: restoreBusyId === p.id },
        ],
  }));

  const submissionColumns: AdminTableColumn[] = [
    { key: 'school', label: 'School', width: '1.6fr', wrap: true },
    { key: 'subject', label: 'Subject', width: '1fr', wrap: true },
    { key: 'board', label: 'Board', width: '0.8fr' },
    { key: 'class', label: 'Class', width: '0.6fr' },
    { key: 'submitter', label: 'Submitted by', width: '1.4fr', wrap: true },
    { key: 'status', label: 'Status', width: '0.9fr' },
  ];

  const submissionRows: AdminTableRow[] = filteredSubmissions.map((s) => ({
    id: s.id,
    cells: [
      s.school,
      s.subject,
      s.board || 'Not given',
      s.class || 'Not given',
      s.submitter_name || 'Not given',
      <AdminStatusPill key="status" status={submissionStatusTone(s.status)} label={statusWords(s.status)} />,
    ],
    actions: [{ label: s.status === 'pending' ? 'Review' : 'View', tone: 'primary', onClick: () => void openReview(s) }],
  }));

  const searching = searchQuery.trim().length > 0;
  const searchSlot = (
    <div className="relative min-w-0 max-w-full flex-1 sm:w-[280px] sm:flex-none">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-warm-meta" aria-hidden />
      <input
        type="search"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder={view === 'live' ? 'Search papers...' : 'Search uploads...'}
        aria-label={view === 'live' ? 'Search papers' : 'Search uploads'}
        className="h-11 w-full rounded-full bg-muted pl-9 pr-4 text-sm text-foreground placeholder:text-warm-label outline-none transition-shadow duration-150 focus-visible:ring-2 focus-visible:ring-brand"
      />
    </div>
  );

  const sortSlot = (
    <Select value={sortOrder} onValueChange={(v) => setSortOrder(v as 'newest' | 'oldest')}>
      <SelectTrigger aria-label="Sort order" className="h-11 w-[132px] rounded-full border-0 bg-muted text-sm font-semibold sm:w-[160px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="newest">Newest first</SelectItem>
        <SelectItem value="oldest">Oldest first</SelectItem>
      </SelectContent>
    </Select>
  );

  const liveView = listView({ state: papersState, total: papers.length, shown: filteredPapers.length, searching });
  const pendingView = listView({ state: submissionsState, total: submissions.length, shown: filteredSubmissions.length, searching });

  const livePanel = (
    <div>
      <AdminFilterChips
        chips={paperChips}
        value={paperFilter}
        onChange={(k) => setPaperFilter(k as PaperFilter)}
        onClear={() => setPaperFilter('live')}
        defaultValue="live"
        label="Show papers"
      />
      <div className="mb-3 mt-3 flex items-center gap-2">{searchSlot}{sortSlot}</div>
      {liveView === 'loading' ? (
        <AdminLoading shape="table" rows={5} label="Loading the live papers" />
      ) : liveView === 'error' ? (
        <AdminError what="the live papers" onRetry={() => void loadPapers()} />
      ) : liveView === 'search-empty' ? (
        <AdminEmpty title={`No papers match "${searchQuery.trim()}".`} action={{ label: 'Clear search', onClick: () => setSearchQuery('') }} />
      ) : liveView === 'none-yet' ? (
        <AdminEmpty title="No papers yet." hint="Upload one, or approve a student upload." action={{ label: 'Upload a paper', onClick: openUpload }} />
      ) : liveView === 'filter-empty' ? (
        <AdminEmpty
          title={paperFilter === 'hidden' ? 'No hidden papers.' : 'No live papers.'}
          hint="Another filter may have some."
          action={{ label: 'Show all papers', onClick: () => setPaperFilter('all') }}
        />
      ) : (
        <AdminTable columns={columns} rows={rows} />
      )}
    </div>
  );

  const pendingPanel = (
    <div>
      <AdminFilterChips
        chips={uploadChips}
        value={uploadFilter}
        onChange={(k) => setUploadFilter(k as UploadFilter)}
        onClear={() => setUploadFilter('waiting')}
        defaultValue="waiting"
        label="Show uploads"
      />
      <div className="mb-3 mt-3 flex items-center gap-2">{searchSlot}{sortSlot}</div>
      {pendingView === 'loading' ? (
        <AdminLoading shape="table" rows={4} label="Loading the student uploads" />
      ) : pendingView === 'error' ? (
        <AdminError what="the student uploads" onRetry={() => void loadSubmissions()} />
      ) : pendingView === 'search-empty' ? (
        <AdminEmpty title={`No uploads match "${searchQuery.trim()}".`} action={{ label: 'Clear search', onClick: () => setSearchQuery('') }} />
      ) : pendingView === 'none-yet' ? (
        <AdminEmpty title="No student uploads yet." hint="When a student sends in a paper it will be listed here." />
      ) : pendingView === 'filter-empty' ? (
        <AdminEmpty
          title={uploadFilter === 'waiting' ? 'Nothing pending.' : `No ${uploadFilter} uploads.`}
          hint="Another filter may have some."
          action={uploadFilter === 'all' ? undefined : { label: 'Show all uploads', onClick: () => setUploadFilter('all') }}
        />
      ) : (
        <AdminTable columns={submissionColumns} rows={submissionRows} />
      )}
    </div>
  );

  const fieldInvalid = (f: RequiredPaperField) => attempted && missing.includes(f);
  const inputClass = cn(
    adminFieldStyle,
    'w-full px-3 text-foreground outline-none transition-shadow duration-150 focus-visible:ring-2 focus-visible:ring-brand',
  );
  const requiredNote = (f: RequiredPaperField, id: string) =>
    fieldInvalid(f) ? (
      <p id={`${id}-error`} className="mt-1 text-[12px] font-semibold text-destructive">
        Required
      </p>
    ) : null;

  return (
    <BentoStack className="min-h-screen bg-muted">
      <AdminHeader nav={nav} signedInEmail={signedIn} />
      {banner}
      <AdminPageIntroPanel page="submissions" />

      <BentoPanel fill="card" className="px-1.5 py-[18px] lg:px-1.5 lg:py-[18px]">
        <AdminPanelHeader
          title="Student uploads"
          action={
            view === 'live' ? (
              <AdminPillButton variant="primary" onClick={openUpload}>
                <Plus className="h-4 w-4" aria-hidden />
                Upload a paper
              </AdminPillButton>
            ) : undefined
          }
        />
        <div className="px-[18px]">
          <AdminTabs
            label="Student uploads view"
            value={view}
            onChange={(k) => setView(k as View)}
            tabs={[
              { key: 'pending', label: 'From students', count: submissionsState === 'loading' ? undefined : (pendingCount ?? null) },
              { key: 'live', label: 'Live papers' },
            ]}
          >
            {view === 'live' ? livePanel : pendingPanel}
          </AdminTabs>
        </div>
      </BentoPanel>

      <AdminAuditNote />

      {/* Hide dialog: a reason is required (hard requirement, unlike the
          legacy silent overflow-disc toggle). */}
      <AdminDialog
        open={!!hideTarget}
        onOpenChange={(open) => {
          if (!open) closeHide();
        }}
        title={hideTarget ? `Hide "${hideTarget.title}"?` : 'Hide this paper?'}
        description="The paper stops being readable straight away. Restore brings it back."
        size="sm"
        footer={
          <>
            <AdminPillButton variant="secondary" onClick={closeHide}>
              Cancel
            </AdminPillButton>
            <AdminPillButton variant="destructive" onClick={() => void confirmHide()} disabled={!hideReason.trim()} busy={hideBusy}>
              {hideBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              Hide paper
            </AdminPillButton>
          </>
        }
      >
        <Label htmlFor="hide-reason" className="mb-1.5 block text-[14px] font-semibold text-foreground">
          Reason <span className="font-normal text-warm-meta">{HIDE_REASON_NOTE}</span>
        </Label>
        <Textarea
          id="hide-reason"
          value={hideReason}
          onChange={(e) => setHideReason(e.target.value)}
          placeholder="e.g. Copyright complaint from the school"
          rows={3}
          autoFocus
          aria-required="true"
        />
      </AdminDialog>

      {/* Upload dialog: dropzone, storage upload and the paper details form.
          The two buttons say what happens: Publish goes live, Save as draft
          does not. */}
      <AdminDialog
        open={uploadOpen}
        onOpenChange={(open) => {
          if (!open) closeUpload();
        }}
        title="Upload a paper"
        description="Fields marked * are required."
        size="md"
        footer={
          <>
            <AdminPillButton variant="secondary" onClick={() => void handleSave(false)} busy={saving === 'draft'} disabled={saving === 'publish' || uploadingFile}>
              Save as draft
            </AdminPillButton>
            <AdminPillButton variant="primary" onClick={() => void handleSave(true)} busy={saving === 'publish'} disabled={saving === 'draft' || uploadingFile}>
              {saving === 'publish' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              Publish this paper
            </AdminPillButton>
          </>
        }
      >
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDropZoneDrop}
          className={cn(
            'rounded-2xl p-[26px] text-center shadow-[0_0_0_1px_var(--warm-hairline)] transition-colors',
            dragOver ? 'bg-warm-muted' : 'bg-warm-card',
          )}
        >
          {formData.file_url ? (
            <div className="flex items-center justify-center gap-2">
              <a href={formData.file_url} target="_blank" rel="noopener noreferrer" className="truncate text-sm text-foreground underline">
                {formData.file_url.split('/').pop()}
              </a>
              <button type="button" onClick={() => handleChange('file_url', null)} aria-label="Remove file" className="tap-44 text-warm-meta">
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <label className="block cursor-pointer rounded-xl has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
              {uploadingFile ? (
                <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin text-warm-meta" />
              ) : (
                <Upload className="mx-auto mb-2 h-5 w-5 text-warm-meta" />
              )}
              <div className="text-[15px] font-semibold text-foreground">{uploadingFile ? 'Uploading...' : 'Drop a paper PDF here'}</div>
              <div className="mt-1 text-[13px] text-warm-meta">One file, or click to browse</div>
              <input
                type="file"
                accept="application/pdf"
                className="sr-only"
                disabled={uploadingFile}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleFileUpload(f);
                  e.target.value = '';
                }}
              />
            </label>
          )}
        </div>

        <div className="mt-4 space-y-4">
          <div>
            <Label htmlFor="u-title" className="mb-1.5 block text-[14px] font-semibold text-foreground">Title *</Label>
            <input
              id="u-title"
              value={formData.title || ''}
              onChange={(e) => handleChange('title', e.target.value)}
              placeholder="e.g. Prelims 2025"
              aria-required="true"
              aria-invalid={fieldInvalid('title') || undefined}
              aria-describedby={fieldInvalid('title') ? 'u-title-error' : undefined}
              className={inputClass}
            />
            {requiredNote('title', 'u-title')}
          </div>
          <div>
            <Label htmlFor="u-school" className="mb-1.5 block text-[14px] font-semibold text-foreground">School *</Label>
            <input
              id="u-school"
              value={formData.school || ''}
              onChange={(e) => handleChange('school', e.target.value)}
              placeholder="e.g. La Martiniere for Boys"
              aria-required="true"
              aria-invalid={fieldInvalid('school') || undefined}
              aria-describedby={fieldInvalid('school') ? 'u-school-error' : undefined}
              className={inputClass}
            />
            {requiredNote('school', 'u-school')}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label className="mb-1.5 block text-[14px] font-semibold text-foreground">Subject *</Label>
              <Select value={formData.subject} onValueChange={(v) => handleChange('subject', v)}>
                <SelectTrigger aria-label="Subject" className={cn(adminFieldStyle, 'h-auto border-0')}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SUBJECTS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1.5 block text-[14px] font-semibold text-foreground">Class *</Label>
              <Select value={formData.class} onValueChange={(v) => handleChange('class', v)}>
                <SelectTrigger aria-label="Class" className={cn(adminFieldStyle, 'h-auto border-0')}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAPER_CLASSES.map((c) => <SelectItem key={c} value={c}>Class {c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1.5 block text-[14px] font-semibold text-foreground">Board *</Label>
              <Select value={formData.board} onValueChange={(v) => handleChange('board', v)}>
                <SelectTrigger aria-label="Board" className={cn(adminFieldStyle, 'h-auto border-0')}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {BOARDS.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1.5 block text-[14px] font-semibold text-foreground">Exam type</Label>
              <Select value={formData.exam_type} onValueChange={(v) => handleChange('exam_type', v)}>
                <SelectTrigger aria-label="Exam type" className={cn(adminFieldStyle, 'h-auto border-0')}><SelectValue placeholder="Choose an exam type" /></SelectTrigger>
                <SelectContent>
                  {EXAM_TYPES.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="u-year" className="mb-1.5 block text-[14px] font-semibold text-foreground">Year *</Label>
            <input
              id="u-year"
              type="number"
              value={formData.year ?? ''}
              onChange={(e) => handleChange('year', e.target.value === '' ? undefined : Number(e.target.value))}
              aria-required="true"
              aria-invalid={fieldInvalid('year') || undefined}
              aria-describedby={fieldInvalid('year') ? 'u-year-error' : undefined}
              className={inputClass}
            />
            {requiredNote('year', 'u-year')}
          </div>
        </div>
      </AdminDialog>

      {/* Upload review dialog. Pending uploads get the file list and
          Approve or Reject; decided ones are read-only (kept for the audit
          trail). */}
      <AdminDialog
        open={!!reviewTarget}
        onOpenChange={(open) => {
          if (!open) closeReview();
        }}
        title={reviewTarget ? `${reviewTarget.school} · ${reviewTarget.subject}` : 'Student upload'}
        size="md"
        footer={
          reviewTarget && reviewTarget.status === 'pending' ? (
            showReject ? (
              <>
                <AdminPillButton
                  variant="secondary"
                  onClick={() => {
                    setShowReject(false);
                    setRejectReason('');
                  }}
                >
                  Cancel
                </AdminPillButton>
                <AdminPillButton variant="destructive" onClick={() => void handleRejectSubmission()} disabled={!rejectReason.trim()} busy={reviewBusy}>
                  Confirm rejection
                </AdminPillButton>
              </>
            ) : (
              <>
                <AdminPillButton variant="secondary" onClick={() => setShowReject(true)}>
                  Reject
                </AdminPillButton>
                <AdminPillButton variant="primary" onClick={() => void handleApprove()} disabled={!approveTitle.trim() || !approveBoard || !approveClass || !approveExamType || reviewTarget.file_paths.length === 0} busy={reviewBusy}>
                  Approve and publish
                </AdminPillButton>
              </>
            )
          ) : (
            <AdminPillButton variant="secondary" onClick={closeReview}>
              Close
            </AdminPillButton>
          )
        }
      >
        {reviewTarget ? (
          <>
            <div className="space-y-1.5 text-[14px] text-warm-prose">
              <div><strong className="text-foreground">Board:</strong> {reviewTarget.board || 'Not given'}</div>
              <div><strong className="text-foreground">Class:</strong> {reviewTarget.class || 'Not given'}</div>
              <div><strong className="text-foreground">Year:</strong> {reviewTarget.year || 'Not given'}</div>
              <div><strong className="text-foreground">Exam type:</strong> {reviewTarget.exam_type || 'Not given'}</div>
              <div><strong className="text-foreground">Submitted by:</strong> {reviewTarget.submitter_name || 'Not given'}{reviewTarget.submitter_contact ? ` (${reviewTarget.submitter_contact})` : ''}</div>
              <div><strong className="text-foreground">Submitted:</strong> {new Date(reviewTarget.created_at).toLocaleString()}</div>
            </div>

            <div className="mt-4">
              <Label className="mb-1.5 block text-[14px] font-semibold text-foreground">Files ({reviewTarget.file_paths.length})</Label>
              {reviewTarget.file_paths.length === 0 ? (
                <p className="text-[14px] text-warm-meta">No files were attached to this upload, so it cannot be published. Reject it instead.</p>
              ) : reviewFilesLoading ? (
                <p className="flex items-center gap-2 text-[14px] text-warm-meta">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Preparing files...
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {reviewFileUrls.map((f, i) => (
                    <li key={f.path}>
                      {f.url ? (
                        <a
                          href={f.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex min-h-10 items-center gap-1.5 text-[14px] font-semibold text-brand-blue hover:text-brand-blue-deep"
                        >
                          <FileText className="h-4 w-4" aria-hidden /> File {i + 1}
                        </a>
                      ) : (
                        <span className="text-[14px] text-warm-meta">File {i + 1} (could not be opened)</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {reviewTarget.status === 'pending' ? (
              <div className="mt-5 flex flex-col gap-3 border-t border-warm-hairline pt-4">
                {showReject ? (
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="reject-note" className="text-[13px] font-semibold text-foreground">
                      Reason <span className="font-normal text-warm-meta">(required, kept in the admin audit log)</span>
                    </Label>
                    <Textarea
                      id="reject-note"
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      placeholder="e.g. Pages are unreadable, please resend clearer photos"
                      rows={3}
                      autoFocus
                      aria-required="true"
                    />
                  </div>
                ) : (
                  <>
                    <div>
                      <Label htmlFor="approve-title" className="mb-1.5 block text-[14px] font-semibold text-foreground">
                        Title (shown on the paper's page)
                      </Label>
                      <input
                        id="approve-title"
                        value={approveTitle}
                        onChange={(e) => setApproveTitle(e.target.value)}
                        placeholder="e.g. Prelims 2025"
                        className={inputClass}
                      />
                      {reviewTarget.file_paths.length > 1 ? (
                        <p className="mt-1.5 text-[12px] text-warm-meta">
                          Only the first file is published. The papers table holds one file per paper.
                        </p>
                      ) : null}
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <div>
                        <Label className="mb-1.5 block text-[14px] font-semibold text-foreground">Board</Label>
                        <Select value={approveBoard} onValueChange={setApproveBoard}>
                          <SelectTrigger aria-label="Board" className={cn(adminFieldStyle, 'h-auto border-0')}><SelectValue placeholder="Choose a board" /></SelectTrigger>
                          <SelectContent>
                            {BOARDS.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="mb-1.5 block text-[14px] font-semibold text-foreground">Class</Label>
                        <Select value={approveClass} onValueChange={setApproveClass}>
                          <SelectTrigger aria-label="Class" className={cn(adminFieldStyle, 'h-auto border-0')}><SelectValue placeholder="Choose a class" /></SelectTrigger>
                          <SelectContent>
                            {PAPER_CLASSES.map((c) => <SelectItem key={c} value={c}>Class {c}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label htmlFor="approve-year" className="mb-1.5 block text-[14px] font-semibold text-foreground">Year</Label>
                        <input
                          id="approve-year"
                          type="number"
                          value={approveYear}
                          onChange={(e) => setApproveYear(e.target.value)}
                          className={inputClass}
                        />
                      </div>
                    </div>
                    <div>
                      <Label className="mb-1.5 block text-[14px] font-semibold text-foreground">
                        Exam type <span className="font-normal text-warm-meta">(guessed from "{reviewTarget.exam_type || 'not given'}", please check it)</span>
                      </Label>
                      <Select value={approveExamType} onValueChange={setApproveExamType}>
                        <SelectTrigger aria-label="Exam type" className={cn(adminFieldStyle, 'h-auto border-0')}><SelectValue placeholder="Choose an exam type" /></SelectTrigger>
                        <SelectContent>
                          {EXAM_TYPES.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="mt-5 border-t border-warm-hairline pt-4 text-[14px] text-warm-prose">
                <div>
                  <strong className="text-foreground">Status:</strong>{' '}
                  {statusWords(reviewTarget.status)}
                  {reviewTarget.reviewed_at ? ` on ${new Date(reviewTarget.reviewed_at).toLocaleString()}` : ''}
                </div>
                {reviewTarget.review_note ? (
                  <div className="mt-1"><strong className="text-foreground">Note:</strong> {reviewTarget.review_note}</div>
                ) : null}
              </div>
            )}
          </>
        ) : null}
      </AdminDialog>
    </BentoStack>
  );
}

export default function AdminPapers() {
  if (DummyPapers && isDummyMode()) {
    return (
      <Suspense fallback={null}>
        <DummyPapers />
      </Suspense>
    );
  }
  return <AdminPapersPage />;
}
