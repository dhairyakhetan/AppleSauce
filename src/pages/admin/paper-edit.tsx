import { Fragment, memo, useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Clock, FileText, Pencil } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { useAdminGuard, AdminGuardErrorState, adminToast } from '@/components/AdminConsole';
import { AdminDialog } from '@/components/admin/AdminDialog';
import { AdminEmpty, AdminError, AdminLoading } from '@/components/admin/AdminState';
import { AdminPillButton } from '@/components/admin/AdminPillButton';
import { AdminHeader, buildAdminNav } from '@/pages/admin/shell';
import { useAdminSectionCounts } from '@/pages/admin/useAdminSectionCounts';
import { AdminStatusPill } from '@/pages/admin/AdminTable';
import { BentoPanel, BentoStack } from '@/components/layout/PageContainer';
import { MathText } from '@/components/papers/math-text';
import { cn } from '@/lib/utils';
import { usePageMeta } from '@/hooks/usePageMeta';
import { displaySchool } from '@/lib/school-display';
import { bankSubjectToSite } from '@/lib/subject-vocabulary';
import { resolveDisplayNumber, showQuestionInstructions, marksShownInText } from '@/lib/bank-paper-display';
import { passageHeading } from '@/lib/checker-english';
import { isDoubtfulCrop } from '@/lib/checker-pictures';
import { DebugId } from '@/components/DebugId';
import { DebugFacts } from '@/components/admin/DebugFacts';
import { VersionHistory } from '@/components/admin/VersionHistory';
import { realActivityApi } from '@/lib/activity-api';
import { editorStateFromRow } from '@/lib/paper-edit-revert';
import { useBusyActions } from '@/lib/busy-guard';
import {
  adminPaperDraft,
  adminSaveDraftQuestion,
  adminVerifyPaper,
  adminEditBankPaper,
  snippetUrls,
  DRAFT_CONFLICT_CODE,
  type DraftRow,
  type VerifyPaperResult,
} from '@/lib/checker-api';
import {
  autosaveReducer,
  initialAutosave,
  hasEditsBeyondSave,
  saveStatusLabel,
  parseMarks,
  numberForSave,
  fieldsEqual,
  summarizeForVerify,
  verifyConfirmLines,
  verifyResultHeadline,
  depthMap,
  paperDetailValue,
  detailError,
  notSavedMessage,
  adminFlagLines,
  looksLikeRewrite,
  passagesBefore,
  sourcePdfLine,
  OCR_ONLY_REMINDER,
  BIG_EDIT_WARNING,
  type DraftFields,
  type PaperDetailField,
  type SaveStatus,
} from '@/lib/paper-edit';

/* Admin paper edit page -- W12, reshaped 2026-09-28.

   Owner: the edit page must LOOK LIKE the public paper page (BankPaper.tsx)
   while staying editable. So the top is the same exam header (school, class,
   subject, exam, year, time allowed, general instructions, incomplete note),
   each part editable where it stands, and every question is the same card
   the reader sees (number badge, marks pill, instructions, MathText body,
   options). Edit on a card swaps its text for the editor in place.

   Every question edit autosaves into the DRAFT (audit_questions, the live
   paper's working copy) through admin_save_draft_question(). Readers see
   nothing until Verify: admin_verify_paper() passes every question and flips
   the draft's paper_passed, which fires the chokepoint that copies the draft
   onto bank_questions. Nothing on this page writes bank_questions directly.

   The header fields are bank_papers columns with no draft copy. They save
   only when Save is pressed, straight to the live paper (History can undo
   them), and the page says so: a "Live" badge on the header block, one pair
   of lines above it, and "This changes the live paper now" beside Save. */

const AUTOSAVE_MS = 800;

const KIND_LABEL: Record<string, string> = {
  master_instruction: 'Paper instructions',
  section_break: 'Section',
  section_instruction: 'Section instructions',
};

type QuestionRow = DraftRow & { question_id: string };

function toFieldStrings(r: { body: string | null; display_number: string | null; marks: number | null }) {
  return editorStateFromRow(r).fields;
}

export default function AdminPaperEditPage() {
  const { paperId = '' } = useParams<{ paperId: string }>();
  usePageMeta('Edit paper | Shikshaq Admin', 'Edit a paper draft and verify it for readers.');
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const actorName = profile?.full_name || user?.email || 'an admin';
  const { isAdmin, checkingAdmin, error: adminGuardError, retry } = useAdminGuard(user, { redirectOnDenied: true });

  const [rows, setRows] = useState<DraftRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [editorEpoch, setEditorEpoch] = useState(0);
  const [snippets, setSnippets] = useState<Map<string, string>>(new Map());
  const [statuses, setStatuses] = useState<Record<string, SaveStatus>>({});

  const [verifyOpen, setVerifyOpen] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<VerifyPaperResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const data = await adminPaperDraft(paperId);
      setRows(data);
      setStatuses({});
      setEditorEpoch((n) => n + 1);
      const auditPaperId = data[0]?.audit_paper_id;
      const ids = data.filter((r) => r.kind === 'question' && r.question_id).map((r) => r.question_id as string);
      if (auditPaperId && ids.length > 0) {
        snippetUrls(auditPaperId, ids).then(setSnippets).catch(() => setSnippets(new Map()));
      } else {
        setSnippets(new Map());
      }
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [paperId]);

  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin, load]);

  const paper = rows[0] ?? null;
  const items = useMemo(() => rows.filter((r): r is QuestionRow => !!r.question_id), [rows]);
  const depths = useMemo(() => depthMap(items.map((r) => ({ id: r.question_id, parent_id: r.parent_id }))), [items]);
  const passages = useMemo(() => passagesBefore(items), [items]);
  const summary = useMemo(
    () =>
      summarizeForVerify(
        items.map((r) => ({
          kind: r.kind ?? '',
          question_passed: !!r.question_passed,
          review_bucket: r.review_bucket,
          flag_reasons: r.flag_reasons,
        })),
      ),
    [items],
  );
  const firstFlaggedId = useMemo(
    () => items.find((r) => r.kind === 'question' && !r.question_passed)?.question_id ?? null,
    [items],
  );

  const unsavedCount = Object.values(statuses).filter((s) => s === 'dirty' || s === 'saving' || s === 'failed').length;
  const savingNow = Object.values(statuses).some((s) => s === 'saving' || s === 'dirty');
  const failedCount = Object.values(statuses).filter((s) => s === 'failed').length;

  // Leaving with text the server has not stored yet asks first.
  useEffect(() => {
    if (unsavedCount === 0) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [unsavedCount]);

  const onStatus = useCallback((id: string, status: SaveStatus) => {
    setStatuses((prev) => (prev[id] === status ? prev : { ...prev, [id]: status }));
  }, []);

  // Keep the page's copy of a row in step with what the server stored, so
  // the verify counts and a later reload agree with the editor.
  const onSaved = useCallback((id: string, saved: DraftFields) => {
    setRows((prev) => prev.map((r) => (r.question_id === id ? { ...r, ...saved } : r)));
  }, []);

  // 40001: someone else changed this question. Fetch the paper again and
  // hand the editor the stored version of just that question.
  const reloadQuestion = useCallback(
    async (id: string): Promise<DraftRow | null> => {
      try {
        const data = await adminPaperDraft(paperId);
        const fresh = data.find((r) => r.question_id === id) ?? null;
        if (fresh) setRows((prev) => prev.map((r) => (r.question_id === id ? fresh : r)));
        return fresh;
      } catch {
        return null;
      }
    },
    [paperId],
  );

  async function doVerify() {
    setVerifying(true);
    try {
      const result = await adminVerifyPaper(paperId);
      setVerifyOpen(false);
      setVerifyResult(result);
      await load();
    } catch (e) {
      const msg = (e as { message?: string })?.message;
      adminToast('Could not verify this paper', msg ? { description: msg } : undefined);
    } finally {
      setVerifying(false);
    }
  }

  // A header field saved straight to the live paper. The page's copy is
  // patched in place rather than reloaded, so no question editor remounts.
  const { run: runBusy } = useBusyActions();
  const saveDetail = useCallback(
    async (field: PaperDetailField, value: string): Promise<boolean> => {
      // One save per field at a time: a second press while the first is on
      // the wire is ignored and reports "not saved" so the input stays open.
      const out = await runBusy(`detail:${field}`, async () => {
        try {
          await adminEditBankPaper(paperId, field, value);
          const stored = field === 'allowed_time_minutes' ? Number(value.trim()) : value;
          setRows((prev) => prev.map((r) => ({ ...r, [field]: stored })));
          adminToast('Saved to the live paper');
          return true;
        } catch (e) {
          adminToast(notSavedMessage(e));
          return false;
        }
      });
      return out.ran ? out.value === true : false;
    },
    [paperId, runBusy],
  );

  const sectionCounts = useAdminSectionCounts();
  const nav = buildAdminNav('library', sectionCounts);

  if (checkingAdmin) {
    return (
      <BentoStack className="min-h-screen bg-muted">
        <AdminHeader nav={nav} signedInEmail={user?.email ?? actorName} />
        <BentoPanel fill="card" className="px-1.5 py-[18px] lg:px-1.5 lg:py-[18px]">
          <div className="animate-pulse space-y-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-14 rounded-2xl bg-muted" />
            ))}
          </div>
        </BentoPanel>
      </BentoStack>
    );
  }

  if (adminGuardError) return <AdminGuardErrorState onRetry={retry} />;
  if (!isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted px-4">
        <div className="max-w-[380px] rounded-bento bg-card p-8 text-center">
          <h1 className="mb-2 text-xl font-bold text-foreground">Access denied</h1>
          <p className="text-sm text-warm-secondary">You need to be an admin to access this page.</p>
        </div>
      </div>
    );
  }

  const hasDraft = !!paper?.audit_paper_id && items.length > 0;
  const confirmLines = verifyConfirmLines(summary, { isRed: !!paper?.is_red, reason: paper?.red_reason ?? null });
  const verifyBlocked = !hasDraft || summary.total === 0 || unsavedCount > 0 || verifying;

  return (
    <BentoStack className="min-h-screen bg-muted">
      <AdminHeader nav={nav} signedInEmail={user?.email ?? actorName} />

      <BentoPanel fill="card" className="px-4 py-[18px] lg:px-[18px]">
        <Link to="/admin/library" className="inline-flex min-h-11 items-center text-[13px] font-semibold text-warm-secondary hover:text-foreground">
          Back to the Library
        </Link>

        {loading && rows.length === 0 ? (
          <div className="mt-3">
            <div className="mx-auto mb-3 h-24 max-w-md animate-pulse rounded-2xl bg-muted motion-reduce:animate-none" />
            <AdminLoading shape="cards" rows={4} label="Loading the paper" />
          </div>
        ) : loadError ? (
          <AdminError what="this paper" onRetry={() => void load()} className="mt-3" />
        ) : !paper ? (
          <AdminEmpty
            title="No paper with this id."
            hint="It may have been removed. Go back to the Library to pick another."
            action={{ label: 'Back to the Library', onClick: () => navigate('/admin/library') }}
          />
        ) : (
          <div className="mx-auto max-w-[760px]">
            {/* Admin strip: state of the paper and of this draft. Kept above
                the exam header so the header itself reads like the public one. */}
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <AdminStatusPill
                status={!paper.is_published ? 'hidden' : paper.needs_review ? 'pending' : 'live'}
                label={!paper.is_published ? 'Hidden' : paper.needs_review ? 'Needs review' : 'Live'}
              />
              <DebugId label="paper" value={paperId} />
              <DebugId label="audit-paper" value={paper.audit_paper_id} />
              {hasDraft ? (
                summary.stillFlagged > 0 ? (
                  <span className="rounded-full bg-brand-subtle px-2.5 py-1 text-[12px] font-semibold text-brand-deep">
                    {summary.stillFlagged} of {summary.total} questions need review
                  </span>
                ) : (
                  <span className="rounded-full bg-mint px-2.5 py-1 text-[12px] font-semibold text-foreground">
                    All {summary.total} questions checked
                  </span>
                )
              ) : null}
              {firstFlaggedId ? (
                <a
                  href={`#q-${firstFlaggedId}`}
                  className="inline-flex min-h-11 items-center px-1 text-[13px] font-semibold text-brand-blue hover:underline"
                >
                  Go to the first one
                </a>
              ) : null}
            </div>
            <p className="mt-1 flex items-center gap-1.5 text-[13px] text-warm-meta">
              <FileText size={14} aria-hidden="true" className="shrink-0" />
              <span className="min-w-0 break-all">{sourcePdfLine(paper.source_pdf)}</span>
            </p>
            {paper.needs_review ? (
              <p className="mt-2 text-[13px] leading-relaxed text-warm-secondary">
                Readers cannot open this paper yet. Verify below puts it live once the questions read right.
              </p>
            ) : null}

            {verifyResult ? (
              <div
                role="status"
                className={cn('mt-3 rounded-2xl px-4 py-3', verifyResult.is_live ? 'bg-mint' : 'bg-brand-subtle')}
              >
                <p className="text-[15px] font-bold text-foreground">{verifyResultHeadline(verifyResult)}</p>
                {verifyResult.reason ? <p className="mt-1 text-[13px] text-foreground">{verifyResult.reason}</p> : null}
                <p className="mt-1 text-[12px] text-warm-secondary">
                  {verifyResult.questions_newly_passed} of {verifyResult.questions_total} questions were marked checked just now.
                </p>
                <button onClick={() => setVerifyResult(null)} className="mt-2 min-h-11 text-[13px] font-semibold text-warm-secondary">
                  Dismiss
                </button>
              </div>
            ) : null}

            <ul className="mt-3 space-y-1.5 rounded-2xl bg-muted px-4 py-3 text-[13px] leading-relaxed text-warm-secondary">
              <li>
                <span className="font-bold text-foreground">Header details, just below:</span> saved to the live paper the moment you press Save. History can undo them.
              </li>
              <li>
                <span className="font-bold text-foreground">Questions, further down:</span> saved as a draft. Readers see them after you press Verify.
              </li>
            </ul>

            <PaperHeader paper={paper} questionCount={summary.total} onSave={saveDetail} />

            {!hasDraft ? (
              <div className="py-8 text-center">
                <p className="text-[15px] font-bold text-foreground">Nothing to edit yet.</p>
                <p className="mx-auto mt-1 max-w-md text-pretty text-[13px] leading-[1.5] text-warm-secondary">
                  Header details above still change the live paper.
                </p>
                <Link to="/admin/library" className="mt-2 inline-flex min-h-11 items-center text-[13px] font-bold text-brand-blue hover:underline">
                  Back to the Library
                </Link>
              </div>
            ) : (
              <ol className="grid grid-cols-1 gap-3">
                {items.map((r) => {
                  const passage = passages.get(r.question_id);
                  const card =
                    r.kind === 'question' ? (
                      <QuestionEditor
                        key={`${editorEpoch}-${r.question_id}`}
                        row={r}
                        depth={depths.get(r.question_id) ?? 0}
                        snippetUrl={snippets.get(r.question_id) ?? null}
                        onStatus={onStatus}
                        onSaved={onSaved}
                        reloadQuestion={reloadQuestion}
                      />
                    ) : (
                      <li key={r.question_id} className={cn('px-1 py-1', r.kind === 'section_break' && 'text-center')}>
                        <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-warm-meta">
                          {KIND_LABEL[r.kind ?? ''] ?? 'Note on the paper'}
                        </p>
                        {r.body ? (
                          <MathText
                            text={r.body}
                            className={cn(
                              'mt-1 text-[14px] leading-[1.55] text-warm-prose',
                              r.kind === 'section_break' ? 'font-bold text-foreground' : 'italic',
                            )}
                          />
                        ) : null}
                      </li>
                    );
                  if (!passage) return card;
                  return (
                    <Fragment key={`with-passage-${r.question_id}`}>
                      {/* English passage or extract, once, before the first
                          question that uses it, as its own card like the
                          public page's context rows. Text is verbatim. */}
                      <li className="rounded-[18px] bg-card p-[16px] shadow-border">
                        <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.03em] text-warm-secondary">
                          {passageHeading(passage.kind)}
                          {passage.title ? `: ${passage.title}` : ''}
                        </p>
                        <MathText text={passage.text} className="text-[15px] leading-[1.6] text-foreground" />
                      </li>
                      {card}
                    </Fragment>
                  );
                })}
              </ol>
            )}
          </div>
        )}
      </BentoPanel>

      {hasDraft ? (
        <div className="sticky bottom-3 z-20 mx-auto w-full">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-bento bg-panel px-4 py-3 text-background">
            <div className="min-w-0 text-[13px]" aria-live="polite">
              <p className="font-bold">
                {summary.total} questions, {summary.stillFlagged} still flagged
              </p>
              <p className="opacity-80">
                {failedCount > 0
                  ? `${failedCount} not saved. Fix or retry them before verifying.`
                  : savingNow
                    ? 'Saving...'
                    : 'All changes saved'}
              </p>
            </div>
            <button
              onClick={() => setVerifyOpen(true)}
              disabled={verifyBlocked}
              className="inline-flex min-h-11 items-center justify-center rounded-full bg-mint px-5 text-[14px] font-bold text-foreground transition-transform duration-150 active:scale-[0.97] disabled:opacity-50"
            >
              Verify
            </button>
          </div>
        </div>
      ) : null}

      <AdminDialog
        open={verifyOpen}
        onOpenChange={(open) => {
          if (!open && !verifying) setVerifyOpen(false);
        }}
        title="Verify this paper?"
        size="sm"
        footer={
          <>
            <AdminPillButton variant="secondary" onClick={() => setVerifyOpen(false)} disabled={verifying}>
              Cancel
            </AdminPillButton>
            <AdminPillButton variant="primary" onClick={() => void doVerify()} busy={verifying}>
              {verifying ? 'Verifying...' : 'Verify and publish'}
            </AdminPillButton>
          </>
        }
      >
        <ul className="space-y-1.5 text-[14px] text-warm-secondary">
          {confirmLines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </AdminDialog>
    </BentoStack>
  );
}

// ---------------------------------------------------------------------------
// The exam header, as BankPaper.tsx draws it, with every part editable.

function PaperHeader({
  paper,
  questionCount,
  onSave,
}: {
  paper: DraftRow;
  questionCount: number;
  onSave: (field: PaperDetailField, value: string) => Promise<boolean>;
}) {
  const v = (f: PaperDetailField) => paperDetailValue(paper, f);
  return (
    <div className="my-5 border-b border-border pb-4 text-center">
      <p className="mb-2 flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
        {paper.is_published ? (
          <span className="inline-flex h-[26px] items-center gap-1.5 rounded-full bg-success-subtle-bg px-[10px] text-[12px] font-bold text-success-subtle-text">
            <span className="h-1.5 w-1.5 rounded-full bg-success-subtle-text" aria-hidden />
            Live
          </span>
        ) : (
          <span className="inline-flex h-[26px] items-center gap-1.5 rounded-full bg-destructive/10 px-[10px] text-[12px] font-bold text-destructive">
            <span className="h-1.5 w-1.5 rounded-full bg-destructive" aria-hidden />
            Hidden
          </span>
        )}
        <span className="text-[12px] text-warm-secondary">
          {paper.is_published ? 'Edits to these details change the live paper.' : 'Edits to these details save at once. The paper is hidden from readers.'}
        </span>
      </p>
      <p className="text-[13px] italic text-muted-foreground">
        <DetailText field="school" label="School" value={v('school')} onSave={onSave} display={(s) => displaySchool(s)} />
      </p>
      <h2 className="mt-1 font-display text-[20px] font-extrabold tracking-[-0.02em] text-foreground sm:text-[23px]">
        Class <DetailText field="cls" label="Class" value={v('cls')} onSave={onSave} />{' '}
        <DetailText field="subject" label="Subject" value={v('subject')} onSave={onSave} display={(s) => bankSubjectToSite(s)} />{' '}
        · <DetailText field="exam" label="Exam" value={v('exam')} onSave={onSave} placeholder="Add exam" />
      </h2>
      <p className="mt-0.5 text-[13px] tabular-nums text-muted-foreground">
        <DetailText field="year" label="Year" value={v('year')} onSave={onSave} placeholder="Add year" />
      </p>
      <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[13px] font-semibold tabular-nums text-foreground">
        <span>{questionCount} question{questionCount === 1 ? '' : 's'}</span>
      </div>
      <p className="mt-2 text-[13px] uppercase tracking-[0.04em] text-muted-foreground">Answer all questions</p>
      <div className="mt-3 flex flex-col items-center gap-1">
        <p className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
          <Clock size={14} strokeWidth={2.2} aria-hidden="true" />
          <DetailText
            field="allowed_time_minutes"
            label="Time allowed in minutes"
            value={v('allowed_time_minutes')}
            onSave={onSave}
            placeholder="Add time allowed"
            display={(s) => `${s} minutes allowed`}
            inputMode="numeric"
          />
        </p>
        <div className="max-w-[48ch] text-[13px] leading-[1.5] text-warm-prose">
          <DetailText
            field="general_instructions"
            label="General instructions"
            value={v('general_instructions')}
            onSave={onSave}
            placeholder="Add general instructions"
            multiline
            render={(s) => <MathText text={s} className="text-[13px] leading-[1.5] text-warm-prose" />}
          />
        </div>
      </div>
      <div className="mt-2 text-[12px] italic leading-[1.5] text-muted-foreground">
        <DetailText
          field="incomplete_note"
          label="Incomplete note"
          value={v('incomplete_note')}
          onSave={onSave}
          placeholder="Add an incomplete note"
          multiline
        />
      </div>
    </div>
  );
}

function DetailText({
  field,
  label,
  value,
  onSave,
  placeholder,
  display,
  render,
  multiline,
  inputMode,
}: {
  field: PaperDetailField;
  label: string;
  value: string;
  onSave: (field: PaperDetailField, value: string) => Promise<boolean>;
  placeholder?: string;
  display?: (v: string) => string;
  render?: (v: string) => ReactNode;
  multiline?: boolean;
  inputMode?: 'numeric';
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function open() {
    setDraft(value);
    setError(null);
    setEditing(true);
  }

  async function save() {
    const problem = detailError(field, draft);
    if (problem) {
      setError(problem);
      return;
    }
    if (draft === value) {
      setEditing(false);
      return;
    }
    setSaving(true);
    const ok = await onSave(field, draft);
    setSaving(false);
    if (ok) setEditing(false);
  }

  if (editing) {
    const common = {
      value: draft,
      autoFocus: true,
      'aria-label': label,
      onChange: (e: { target: { value: string } }) => {
        setDraft(e.target.value);
        setError(null);
      },
      onKeyDown: (e: { key: string; preventDefault: () => void }) => {
        if (e.key === 'Escape') setEditing(false);
        if (e.key === 'Enter' && !multiline) {
          e.preventDefault();
          void save();
        }
      },
      className:
        'w-full rounded-xl bg-muted px-3 py-2 text-left text-[15px] font-normal not-italic normal-case tracking-normal text-foreground outline-none focus:ring-2 focus:ring-brand',
    };
    return (
      <span className="my-1 inline-flex w-full max-w-md flex-col items-stretch gap-1.5 align-top">
        {multiline ? <textarea rows={3} {...common} /> : <input inputMode={inputMode} {...common} />}
        {error ? <span className="text-left text-[13px] font-normal not-italic text-destructive">{error}</span> : null}
        <span className="text-left text-[12px] font-semibold not-italic text-warm-secondary">This changes the live paper now.</span>
        <span className="flex gap-2">
          <AdminPillButton variant="primary" size="sm" onClick={() => void save()} busy={saving}>
            {saving ? 'Saving...' : 'Save'}
          </AdminPillButton>
          <AdminPillButton variant="secondary" size="sm" onClick={() => setEditing(false)} disabled={saving}>
            Cancel
          </AdminPillButton>
        </span>
      </span>
    );
  }

  const empty = value.trim() === '';
  return (
    <button
      type="button"
      onClick={open}
      aria-label={empty ? placeholder ?? `Add ${label.toLowerCase()}` : `Edit ${label.toLowerCase()}`}
      className={cn(
        'group inline-flex min-h-8 max-w-full items-center gap-1 rounded-md px-0.5 text-inherit transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
        empty && 'font-semibold not-italic text-brand-blue',
      )}
    >
      {empty ? (
        <span>{placeholder ?? `Add ${label.toLowerCase()}`}</span>
      ) : render ? (
        render(value)
      ) : (
        <span>{display ? display(value) : value}</span>
      )}
      <Pencil size={12} aria-hidden="true" className="shrink-0 opacity-40 group-hover:opacity-100" />
    </button>
  );
}

// ---------------------------------------------------------------------------

interface QuestionEditorProps {
  row: QuestionRow;
  depth: number;
  snippetUrl: string | null;
  onStatus: (id: string, status: SaveStatus) => void;
  onSaved: (id: string, saved: DraftFields) => void;
  reloadQuestion: (id: string) => Promise<DraftRow | null>;
}

const QuestionEditor = memo(function QuestionEditor({ row, depth, snippetUrl, onStatus, onSaved, reloadQuestion }: QuestionEditorProps) {
  const id = row.question_id;
  const [fields, setFields] = useState(() => toFieldStrings(row));
  const [state, dispatch] = useReducer(autosaveReducer, initialAutosave);
  const [editing, setEditing] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  const [lostText, setLostText] = useState<string | null>(null);

  // What the server holds. p_body_before is always this body.
  const baselineRef = useRef<DraftFields>({ body: row.body ?? '', display_number: row.display_number, marks: row.marks });
  const fieldsRef = useRef(fields);
  fieldsRef.current = fields;
  const stateRef = useRef(state);
  stateRef.current = state;
  // D76: the text as it was when the page loaded, what "only a reading fix"
  // is measured against (not the last save, or small steps would add up).
  const loadedBodyRef = useRef(row.body ?? '');

  useEffect(() => {
    onStatus(id, state.status);
  }, [id, state.status, onStatus]);

  // The save currently on the wire, so an unmount flush can wait for it and
  // then send with the body it stored as p_body_before.
  const inFlightRef = useRef<Promise<void> | null>(null);

  const saveNow = useCallback(async () => {
    const f = fieldsRef.current;
    const marks = parseMarks(f.marks);
    if (!marks.ok) {
      dispatch({ type: 'save_fail', error: 'Marks must be a number, like 4 or 0.5.' });
      return;
    }
    if (f.body.trim() === '') {
      dispatch({ type: 'save_fail', error: 'Question text cannot be blank.' });
      return;
    }
    const next: DraftFields = { body: f.body, display_number: numberForSave(f.number), marks: marks.value };
    dispatch({ type: 'save_start' });
    if (fieldsEqual(next, baselineRef.current)) {
      dispatch({ type: 'save_ok' });
      return;
    }
    try {
      const saved = await adminSaveDraftQuestion(id, next, baselineRef.current.body);
      const stored: DraftFields = saved
        ? { body: saved.body, display_number: saved.display_number, marks: saved.marks != null ? Number(saved.marks) : null }
        : next;
      baselineRef.current = stored;
      onSaved(id, stored);
      dispatch({ type: 'save_ok' });
    } catch (e) {
      const err = e as { code?: string; message?: string };
      if (err?.code === DRAFT_CONFLICT_CODE) {
        dispatch({ type: 'conflict' });
        setLostText(f.body);
        const fresh = await reloadQuestion(id);
        if (fresh) {
          baselineRef.current = editorStateFromRow(fresh).baseline;
          setFields(toFieldStrings(fresh));
        }
        return;
      }
      dispatch({ type: 'save_fail', error: err?.message || 'Could not save. Check your connection.' });
    }
  }, [id, onSaved, reloadQuestion]);

  const save = useCallback(() => {
    const p = saveNow().finally(() => {
      if (inFlightRef.current === p) inFlightRef.current = null;
    });
    inFlightRef.current = p;
    return p;
  }, [saveNow]);

  // Debounced autosave: each edit restarts the timer.
  useEffect(() => {
    if (state.status !== 'dirty') return;
    const t = setTimeout(() => void save(), AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [state.status, state.editVersion, save]);

  // Leaving the page (or a reload after Verify) with a pending edit still
  // sends it rather than dropping it -- including keystrokes typed while a
  // save was on the wire, which wait for that save and then follow it.
  useEffect(
    () => () => {
      if (!hasEditsBeyondSave(stateRef.current)) return;
      const pending = inFlightRef.current;
      if (pending) void pending.then(() => saveNow());
      else void saveNow();
    },
    [saveNow],
  );

  // A version was put back from the Versions dialog. The server's copy
  // changed under the open editor, so fetch it and reset everything derived
  // from the old one. Pending edits are dropped on purpose: the admin chose
  // to put an older version back.
  const onReverted = useCallback(async () => {
    const fresh = await reloadQuestion(id);
    if (!fresh) {
      adminToast('The version was put back, but this page could not refresh it', { description: 'Reload the page to see it here.' });
      return;
    }
    const next = editorStateFromRow(fresh);
    baselineRef.current = next.baseline;
    loadedBodyRef.current = next.loadedBody;
    setFields(next.fields);
    setLostText(null);
    dispatch({ type: 'reset' });
  }, [id, reloadQuestion]);

  function edit(patch: Partial<typeof fields>) {
    setFields((prev) => ({ ...prev, ...patch }));
    dispatch({ type: 'edit' });
  }

  const passed = !!row.question_passed;
  const escalated = row.review_bucket === 'escalated' && !passed;
  const flagLines = passed ? [] : adminFlagLines(row.flag_reasons, row.flag_detail);
  const statusLabel = saveStatusLabel(state.status);
  const lineCount = fields.body.split('\n').length;
  // Same rule as the checker: a crop that may be of a different question is
  // never shown next to the text (it invites "fixing" correct words).
  const showPicture = editing && !!snippetUrl && !imgFailed && !isDoubtfulCrop(row.source as Record<string, unknown> | null);
  const shownNumber = resolveDisplayNumber(fields.number || null, undefined, row.number_path);
  const marksValue = parseMarks(fields.marks);
  const marksNum = marksValue.ok ? marksValue.value : null;
  const bigEdit = useMemo(() => looksLikeRewrite(loadedBodyRef.current, fields.body), [fields.body]);
  const textId = `q-text-${id}`;

  return (
    <li
      id={`q-${id}`}
      className={cn(
        'min-w-0 scroll-mt-24 rounded-[18px] bg-muted p-[16px]',
        !passed && 'ring-2 ring-inset ring-brand',
      )}
      style={depth > 0 ? { marginLeft: `${Math.min(depth, 3) * 12}px` } : undefined}
    >
      {/* The public card's meta line: number badge, marks pill. Then this
          page's own state, pushed right. */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {shownNumber ? (
          <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-brand-blue px-1.5 text-[12px] font-extrabold tabular-nums text-white">
            {shownNumber}
          </span>
        ) : null}
        {marksNum !== null && !marksShownInText(marksNum, fields.body) ? (
          <span className="rounded-full bg-card px-2 py-0.5 text-[12px] font-bold tabular-nums text-foreground shadow-border">
            {marksNum} {marksNum === 1 ? 'mark' : 'marks'}
          </span>
        ) : null}
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-[12px] font-semibold',
            passed ? 'bg-mint text-foreground' : escalated ? 'bg-brand text-foreground' : 'bg-brand-subtle text-brand-deep',
          )}
        >
          {passed ? 'Checked' : escalated ? 'Sent for help' : 'Needs review'}
        </span>
        <DebugId label="question" value={id} />
        <DebugId label="live-question" value={row.live_bank_question_id} />
        <DebugFacts facts={{ flags: row.flag_reasons ?? [], bucket: row.review_bucket, status: row.status }} />
        <span
          aria-live="polite"
          className={cn(
            'ml-auto text-[12px] font-semibold',
            state.status === 'failed' || state.status === 'conflict' ? 'text-destructive' : 'text-warm-meta',
          )}
        >
          {statusLabel}
        </span>
        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          aria-expanded={editing}
          aria-controls={textId}
          className="inline-flex min-h-11 items-center gap-1 rounded-full px-3 text-[13px] font-semibold text-warm-secondary transition-colors duration-150 hover:bg-card hover:text-foreground active:scale-[0.96]"
        >
          {editing ? 'Done' : (
            <>
              <Pencil size={13} aria-hidden="true" />
              Edit
            </>
          )}
        </button>
        <button
          type="button"
          onClick={() => setVersionsOpen(true)}
          className="inline-flex min-h-11 items-center rounded-full px-3 text-[13px] font-semibold text-warm-secondary transition-colors duration-150 hover:bg-card hover:text-foreground active:scale-[0.96]"
        >
          Versions
        </button>
      </div>

      <AdminDialog
        open={versionsOpen}
        onOpenChange={setVersionsOpen}
        title="Question versions"
        size="md"
        footer={
          <AdminPillButton variant="secondary" onClick={() => setVersionsOpen(false)}>
            Close
          </AdminPillButton>
        }
      >
        {versionsOpen ? <VersionHistory api={realActivityApi} table="audit_questions" rowId={id} onReverted={() => void onReverted()} /> : null}
      </AdminDialog>

      {flagLines.length > 0 ? (
        <div className="mb-2.5 rounded-[12px] bg-brand-subtle px-3 py-2">
          <p className="text-[12px] font-bold text-brand-deep">Why this needs review</p>
          <ul className="mt-1 space-y-0.5 text-[13px] leading-[1.45] text-foreground">
            {flagLines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {showQuestionInstructions(row.instructions) ? (
        <MathText text={row.instructions as string} className="mb-1.5 text-[13px] italic leading-[1.5] text-warm-secondary" />
      ) : null}

      <div id={textId}>
        {editing ? (
          <div className={cn('grid gap-3', showPicture && 'lg:grid-cols-2')}>
            {showPicture ? (
              <div className="flex max-h-[40vh] items-center justify-center overflow-hidden rounded-[12px] bg-card lg:max-h-[60vh]">
                <img
                  src={snippetUrl as string}
                  alt={`The printed question ${row.display_number ?? ''}`.trim()}
                  loading="lazy"
                  onError={() => setImgFailed(true)}
                  className="h-full w-full object-contain"
                />
              </div>
            ) : null}
            <div className="min-w-0">
              <p className="mb-2 text-[12px] leading-[1.45] text-warm-secondary">{OCR_ONLY_REMINDER}</p>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1.5 text-[13px] font-semibold text-warm-secondary">
                  No.
                  <input
                    value={fields.number}
                    onChange={(e) => edit({ number: e.target.value })}
                    aria-label="Question number"
                    className="h-11 w-20 rounded-xl bg-card px-2 text-center text-[15px] font-bold text-foreground outline-none focus:ring-2 focus:ring-brand"
                  />
                </label>
                <label className="flex items-center gap-1.5 text-[13px] font-semibold text-warm-secondary">
                  Marks
                  <input
                    value={fields.marks}
                    onChange={(e) => edit({ marks: e.target.value })}
                    inputMode="decimal"
                    aria-label="Marks"
                    className="h-11 w-16 rounded-xl bg-card px-2 text-center text-[15px] text-foreground outline-none focus:ring-2 focus:ring-brand"
                  />
                </label>
              </div>
              <textarea
                value={fields.body}
                onChange={(e) => edit({ body: e.target.value })}
                rows={Math.min(Math.max(lineCount + 1, 3), 18)}
                aria-label="Question text"
                spellCheck={false}
                autoFocus
                className="w-full rounded-xl bg-card p-3 text-[15px] leading-relaxed text-foreground outline-none focus:ring-2 focus:ring-brand"
              />
              {bigEdit ? (
                <p role="status" className="mt-1.5 rounded-[10px] bg-brand-subtle px-3 py-2 text-[13px] font-semibold text-brand-deep">
                  {BIG_EDIT_WARNING}
                </p>
              ) : null}
              <p className="mt-2 text-[12px] font-semibold text-warm-meta">How readers will see it</p>
              <div className="mt-1 rounded-[12px] bg-card p-3">
                <MathText text={fields.body} className="text-[15px] leading-[1.6] text-foreground" />
              </div>
              {!showPicture ? (
                <p className="mt-2 text-[12px] text-warm-meta">No picture of the printed question to compare with.</p>
              ) : null}
            </div>
          </div>
        ) : (
          <MathText text={fields.body} className="text-[15px] leading-[1.6] text-foreground" />
        )}
      </div>

      {row.options && row.options.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1">
          {row.options.map((o, i) => (
            <li key={`${id}-opt-${i}`} className="flex gap-2">
              <span aria-hidden="true" className="mt-[9px] h-1 w-1 flex-none rounded-full bg-warm-label" />
              <MathText
                text={`${o.label ? `(${o.label}) ` : ''}${o.text ?? ''}`}
                className="text-[14px] leading-[1.55] text-warm-prose"
              />
            </li>
          ))}
        </ul>
      ) : null}

      {state.status === 'failed' ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {state.error ? <p className="text-[13px] text-destructive">{state.error}</p> : null}
          <button
            type="button"
            onClick={() => dispatch({ type: 'edit' })}
            className="min-h-11 rounded-full bg-card px-4 text-[13px] font-semibold text-foreground"
          >
            Retry
          </button>
        </div>
      ) : null}
      {lostText !== null ? (
        <div className="mt-2 rounded-[12px] bg-brand-subtle p-3">
          <p className="text-[13px] font-semibold text-foreground">
            Someone else changed this question, so their version is loaded above. Your text was not saved:
          </p>
          <textarea
            readOnly
            value={lostText}
            rows={Math.min(Math.max(lostText.split('\n').length, 2), 8)}
            aria-label="Your unsaved text"
            className="mt-2 w-full rounded-xl bg-card p-2 text-[13px] text-foreground"
          />
          <button onClick={() => setLostText(null)} className="mt-1 min-h-11 text-[13px] font-semibold text-warm-secondary">
            Dismiss
          </button>
        </div>
      ) : null}
    </li>
  );
});
