import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { toast as sonnerToast } from 'sonner';
import { CheckCircle, ImageOff, Loader2, Pencil, Search, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useConfirm } from '@/components/ui/use-confirm';
import { AdminPanelHeader, AdminStatusPill, AdminTable, AdminTableSkeleton, type AdminTableColumn, type AdminTableRow } from '@/pages/admin/AdminTable';
import { AdminEmpty, AdminError } from '@/components/admin/AdminState';
import { AdminFilterChips } from '@/components/admin/AdminFilterChips';
import { DetailsForm } from '@/components/teacher-review/DetailsForm';
import { applicationToDetails, detailsToApplication, type DetailsValue } from '@/components/teacher-review/details-value';
import { validateImageSrc } from '@/utils/imageSanitizer';
import { APPLICATIONS_KEY, APPLICATION_STATUS_LABEL, TEACHERS_KEY, applicationPatch, detailsProblem, docsLabel, type ReviewApplication, type TeacherReviewApi } from '@/lib/teacher-review-api';
import { formatFeeRange } from '@/lib/fee-range';
import { STATUS_VIEWS, approveCopy, countsByView, defaultOrder, emptyCopy, filterApplications, sortApplications, viewFromParam, type StatusView } from '@/lib/admin-applications';

/* Applications: teachers who asked to join. A reviewer reads the details
   (contacts included), can fix them, then approves or rejects. Approving lists
   the teacher on the site, so it asks first; rejecting needs a reason the
   teacher can read.

   The views (Waiting, Approved, Rejected, All), their order, the wording of the
   statuses, the fee range and the loading, error and empty states are shared
   with the admin Applications page (pages/admin/approvals.tsx), so the two
   read the same. Only the admin page can record the outreach note. */

function messageOf(e: unknown, fallback: string): string {
  const m = e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : '';
  return m && m.length < 140 ? m : fallback;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <strong className="text-foreground">{label}:</strong> {children}
    </div>
  );
}

export function ApplicationsTab({ api, scope }: { api: TeacherReviewApi; scope: string }) {
  const qc = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const q = useQuery({ queryKey: APPLICATIONS_KEY(scope), queryFn: () => api.applications(), staleTime: 15_000, refetchOnMount: true });
  const [search, setSearch] = useState('');
  const [view, setView] = useState<StatusView>(viewFromParam(null));
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<DetailsValue | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [imageFailed, setImageFailed] = useState(false);

  const apps = useMemo(() => q.data ?? [], [q.data]);
  const open = apps.find((a) => a.id === openId) ?? null;
  const counts = useMemo(() => countsByView(apps), [apps]);

  const shown = useMemo(() => sortApplications(filterApplications(apps, view, search), defaultOrder(view)), [apps, search, view]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: APPLICATIONS_KEY(scope) });
    void qc.invalidateQueries({ queryKey: TEACHERS_KEY(scope) });
  };
  const close = () => {
    setOpenId(null);
    setEditing(null);
    setRejecting(false);
    setReason('');
    setImageFailed(false);
  };

  const approve = useMutation({
    mutationFn: (id: string) => api.approve(id),
    onSuccess: (_n, id) => {
      sonnerToast.success(`${apps.find((a) => a.id === id)?.name ?? 'The teacher'} is approved and listed`);
      refresh();
      close();
    },
    onError: (e) => sonnerToast.error(messageOf(e, 'Could not approve this application')),
  });
  const reject = useMutation({
    mutationFn: (v: { id: string; reason: string }) => api.reject(v.id, v.reason),
    onSuccess: () => {
      sonnerToast.success('Application rejected');
      refresh();
      close();
    },
    onError: (e) => sonnerToast.error(messageOf(e, 'Could not reject this application')),
  });
  const save = useMutation({
    mutationFn: (v: { id: string; patch: ReturnType<typeof applicationPatch> }) => api.updateApplication(v.id, v.patch),
    onSuccess: () => {
      sonnerToast.success('Details saved');
      setEditing(null);
      refresh();
    },
    onError: (e) => sonnerToast.error(messageOf(e, 'Could not save these details')),
  });

  const busy = approve.isPending || reject.isPending || save.isPending;

  async function onApprove(a: ReviewApplication) {
    const ok = await confirm(approveCopy(a.name));
    if (ok) approve.mutate(a.id);
  }

  function onSave(a: ReviewApplication) {
    if (!editing) return;
    const after = detailsToApplication(a, editing);
    const problem = detailsProblem({ ...after, phone_number: after.phone_number });
    if (problem) {
      sonnerToast.error(problem);
      return;
    }
    const patch = applicationPatch(a, after);
    if (Object.keys(patch).length === 0) {
      setEditing(null);
      return;
    }
    save.mutate({ id: a.id, patch });
  }

  const columns: AdminTableColumn[] = [
    { key: 'who', label: 'Applicant', width: '1.6fr' },
    { key: 'contact', label: 'Contact', width: '1.6fr' },
    { key: 'subjects', label: 'Subjects', width: '1.4fr', wrap: true },
    { key: 'sent', label: 'Sent', width: '1fr' },
    { key: 'status', label: 'Status', width: '1fr' },
  ];
  const rows: AdminTableRow[] = shown.map((a) => ({
    id: a.id,
    cells: [
      a.name,
      <div key="c" className="min-w-0">
        <p className="truncate">+91 {a.phone_number}</p>
        <p className="truncate text-[12px] text-warm-label">{a.email}</p>
      </div>,
      a.subjects || '-',
      formatDistanceToNow(new Date(a.created_at), { addSuffix: true }),
      <AdminStatusPill key="s" status={a.status === 'approved' ? 'live' : a.status === 'rejected' ? 'hidden' : 'pending'} label={APPLICATION_STATUS_LABEL[a.status]} />,
    ],
    actions: [
      {
        label: a.status === 'pending' ? 'Review' : 'Open',
        tone: 'primary',
        onClick: () => {
          setOpenId(a.id);
          setEditing(null);
          setRejecting(false);
          setImageFailed(false);
        },
      },
    ],
  }));

  return (
    <section aria-label="Applications">
      <AdminPanelHeader title="Applications" />
      <div className="mb-4 flex flex-col gap-3 px-[18px]">
        <AdminFilterChips
          chips={STATUS_VIEWS.map((v) => ({ key: v.key, label: v.label, hint: v.hint, ...(q.data ? { count: counts[v.key] } : q.isPending ? { noCount: true } : {}) }))}
          value={view}
          onChange={(k) => setView(viewFromParam(k))}
          onClear={() => setView('waiting')}
          defaultValue="waiting"
          label="Which applications to show"
        />
        <div className="relative w-full sm:w-[280px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-warm-label" aria-hidden />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email or phone"
            aria-label="Search applications"
            className="h-11 w-full max-w-full rounded-full bg-muted pl-9 pr-4 text-sm text-foreground placeholder:text-warm-label outline-none focus-visible:ring-2 focus-visible:ring-brand"
          />
        </div>
      </div>

      {q.isPending ? (
        <AdminTableSkeleton label="Loading the applications" />
      ) : q.isError && !q.data ? (
        <AdminError what="the applications" onRetry={() => void q.refetch()} className="mx-[18px]" />
      ) : shown.length === 0 ? (
        <div className="mx-[18px] rounded-2xl bg-muted">
          <AdminEmpty
            title={emptyCopy(view, search).title}
            hint={emptyCopy(view, search).hint}
            action={search.trim() ? { label: 'Clear search', onClick: () => setSearch('') } : view !== 'all' ? { label: 'Show all applications', onClick: () => setView('all') } : undefined}
          />
        </div>
      ) : (
        <AdminTable columns={columns} rows={rows} />
      )}

      <Dialog open={open !== null} onOpenChange={(o) => (!o ? close() : undefined)}>
        <DialogContent aria-describedby={undefined} className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-[20px] p-6">
          {open ? (
            <>
              <DialogTitle className="mb-4 text-xl font-bold text-foreground">{open.name}</DialogTitle>

              {editing ? (
                <div>
                  <DetailsForm value={editing} onChange={setEditing} idPrefix="app-edit" disabled={save.isPending} />
                  <div className="mt-5 flex flex-wrap gap-2 border-t border-warm-hairline pt-4">
                    <Button disabled={save.isPending} onClick={() => onSave(open)}>
                      {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                      Save changes
                    </Button>
                    <Button variant="outline" disabled={save.isPending} onClick={() => setEditing(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                  <div>
                    <h3 className="mb-2 text-sm font-semibold text-foreground">Contact</h3>
                    <div className="space-y-1.5 text-[14px] text-warm-prose">
                      <Row label="Email">{open.email}</Row>
                      <Row label="Phone">+91 {open.phone_number}</Row>
                      {open.whatsapp_link ? <Row label="WhatsApp">{open.whatsapp_link}</Row> : null}
                      <Row label="Sir or Ma'am">{open.sir_maam}</Row>
                      {open.reference_name ? <Row label="Reference">{open.reference_name}{open.reference_number ? `, +91 ${open.reference_number}` : ''}</Row> : null}
                    </div>
                  </div>
                  <div>
                    <h3 className="mb-2 text-sm font-semibold text-foreground">Teaching</h3>
                    <div className="space-y-1.5 text-[14px] text-warm-prose">
                      <Row label="Subjects">{open.subjects || 'Not said'}</Row>
                      <Row label="Classes">{open.classes_taught_for_backend || 'Not said'}</Row>
                      <Row label="Boards">{open.school_boards_catered || 'Not said'}</Row>
                      <Row label="Where">{open.location_v2 || 'Not said'}</Row>
                      <Row label="Mode">{open.mode_of_teaching || 'Not said'}</Row>
                      <Row label="Fees per month">{formatFeeRange(open.min_fees, open.max_fees)}</Row>
                    </div>
                  </div>
                  {open.description ? (
                    <div className="md:col-span-2">
                      <h3 className="mb-2 text-sm font-semibold text-foreground">About them</h3>
                      <p className="text-[14px] text-warm-prose">{open.description}</p>
                    </div>
                  ) : null}
                  {open.qualifications_etc ? (
                    <div className="md:col-span-2">
                      <h3 className="mb-2 text-sm font-semibold text-foreground">Qualifications</h3>
                      <p className="text-[14px] text-warm-prose">{open.qualifications_etc}</p>
                    </div>
                  ) : null}
                  {open.hero_image_url ? (
                    <div className="md:col-span-2">
                      <h3 className="mb-2 text-sm font-semibold text-foreground">Profile photo</h3>
                      {imageFailed ? (
                        <div className="flex h-48 w-full max-w-md flex-col items-center justify-center gap-2 rounded-2xl bg-muted text-warm-label">
                          <ImageOff className="h-6 w-6" aria-hidden />
                          <span className="text-[13px]">The photo could not be loaded</span>
                        </div>
                      ) : (
                        <img src={validateImageSrc(open.hero_image_url)} alt={`${open.name}, as sent with the application`} onError={() => setImageFailed(true)} className="h-48 w-full max-w-md rounded-2xl object-cover" />
                      )}
                    </div>
                  ) : null}
                  <div className="md:col-span-2 space-y-1 text-[14px] text-warm-prose">
                    <Row label="Status">{APPLICATION_STATUS_LABEL[open.status]}</Row>
                    <Row label="Sent with it">{docsLabel(open)}</Row>
                    <Row label="Sent">{new Date(open.created_at).toLocaleString()}</Row>
                    {open.rejection_reason ? <Row label="Reason given">{open.rejection_reason}</Row> : null}
                  </div>

                  {open.status === 'pending' ? (
                    <div className="flex flex-col gap-3 border-t border-warm-hairline pt-4 md:col-span-2">
                      {rejecting ? (
                        <div className="flex flex-col gap-2">
                          <label htmlFor="reject-reason" className="text-[13px] font-semibold text-foreground">
                            Reason (required, the teacher can read this)
                          </label>
                          <Textarea id="reject-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Say why this application is being rejected" className="min-h-[80px]" />
                          <div className="flex gap-2">
                            <Button variant="destructive" disabled={!reason.trim() || busy} onClick={() => reject.mutate({ id: open.id, reason: reason.trim() })}>
                              {reject.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <XCircle className="h-4 w-4" aria-hidden />}
                              Confirm rejection
                            </Button>
                            <Button variant="outline" onClick={() => { setRejecting(false); setReason(''); }}>
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          <Button disabled={busy} onClick={() => void onApprove(open)}>
                            {approve.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CheckCircle className="h-4 w-4" aria-hidden />}
                            Approve
                          </Button>
                          <Button variant="outline" disabled={busy} onClick={() => setEditing(applicationToDetails(open))}>
                            <Pencil className="h-4 w-4" aria-hidden />
                            Edit details
                          </Button>
                          <Button variant="outline" disabled={busy} onClick={() => setRejecting(true)}>
                            <XCircle className="h-4 w-4" aria-hidden />
                            Reject
                          </Button>
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              )}
            </>
          ) : null}
        </DialogContent>
      </Dialog>
      {confirmDialog}
    </section>
  );
}
