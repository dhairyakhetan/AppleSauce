import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast as sonnerToast } from 'sonner';
import { Loader2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { AdminPanelHeader, AdminStatusPill, AdminTable, AdminTableSkeleton, type AdminTableColumn, type AdminTableRow } from '@/pages/admin/AdminTable';
import { AdminEmpty, AdminError } from '@/components/admin/AdminState';
import { formatFeeRange } from '@/lib/fee-range';
import { DetailsForm } from '@/components/teacher-review/DetailsForm';
import { detailsToTeacher, teacherToDetails, type DetailsValue } from '@/components/teacher-review/details-value';
import { invalidateTeacherCache, removeCache } from '@/utils/cache';
import { TEACHERS_KEY, detailsProblem, teacherPatch, type ReviewTeacher, type TeacherReviewApi } from '@/lib/teacher-review-api';

/* Listed teachers: search, read the contacts, fix the details. A reviewer
   cannot pause, delete or re-photo a listing, and cannot change a teacher's
   phone or email here; those stay with admin. The fee range and the loading,
   error and empty states are shared with the admin Listed teachers page. */

function messageOf(e: unknown, fallback: string): string {
  const m = e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : '';
  return m && m.length < 140 ? m : fallback;
}

/** The cached teacher lists the public pages read, cleared so a saved edit shows up there too. */
function clearPublicCaches(slug: string | null) {
  try {
    if (slug) invalidateTeacherCache(slug);
    removeCache('featured_teachers_browse');
    removeCache('featured_teachers_index');
  } catch {
    // Storage blocked: the caches expire on their own.
  }
}

export function TeachersTab({ api, scope }: { api: TeacherReviewApi; scope: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: TEACHERS_KEY(scope), queryFn: () => api.teachers(), staleTime: 15_000, refetchOnMount: true });
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);
  const [form, setForm] = useState<DetailsValue | null>(null);

  const teachers = useMemo(() => q.data ?? [], [q.data]);
  const open = teachers.find((t) => t.id === openId) ?? null;

  const shown = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return teachers;
    return teachers.filter((t) =>
      [t.title, t.slug, t.email_id, t.phone_number, t.subjects].some((x) => x?.toLowerCase().includes(term)),
    );
  }, [teachers, search]);

  const close = () => {
    setOpenId(null);
    setForm(null);
  };

  const save = useMutation({
    mutationFn: (v: { teacher: ReviewTeacher; patch: ReturnType<typeof teacherPatch> }) => api.updateTeacher(v.teacher.id, v.patch),
    onSuccess: (_d, v) => {
      sonnerToast.success('Details saved');
      clearPublicCaches(v.teacher.slug);
      void qc.invalidateQueries({ queryKey: TEACHERS_KEY(scope) });
      close();
    },
    onError: (e) => sonnerToast.error(messageOf(e, 'Could not save these details')),
  });

  function onSave(t: ReviewTeacher) {
    if (!form) return;
    const after = detailsToTeacher(t, form);
    const problem = detailsProblem({ title: after.title, subjects: after.subjects, classes_taught_for_backend: after.classes_taught_for_backend, min_fees: after.min_fees, max_fees: after.max_fees });
    if (problem) {
      sonnerToast.error(problem);
      return;
    }
    const patch = teacherPatch(t, after);
    if (Object.keys(patch).length === 0) {
      close();
      return;
    }
    save.mutate({ teacher: t, patch });
  }

  const columns: AdminTableColumn[] = [
    { key: 'name', label: 'Teacher', width: '1.6fr' },
    { key: 'contact', label: 'Contact', width: '1.6fr' },
    { key: 'subjects', label: 'Subjects', width: '1.4fr', wrap: true },
    { key: 'fee', label: 'Fee per month', width: '1.2fr' },
    { key: 'status', label: 'Status', width: '0.9fr' },
  ];
  const rows: AdminTableRow[] = shown.map((t) => ({
    id: String(t.id),
    cells: [
      t.title,
      <div key="c" className="min-w-0">
        <p className="truncate">{t.phone_number ? `+91 ${t.phone_number}` : '-'}</p>
        <p className="truncate text-[12px] text-warm-label">{t.email_id ?? '-'}</p>
      </div>,
      t.subjects || '-',
      formatFeeRange(t.min_fees, t.max_fees),
      <AdminStatusPill key="s" status={t.is_paused ? 'paused' : 'live'} label={t.is_paused ? 'Paused' : 'Live'} />,
    ],
    actions: [
      {
        label: 'Edit',
        tone: 'primary',
        onClick: () => {
          setOpenId(t.id);
          setForm(teacherToDetails(t));
        },
      },
    ],
  }));

  return (
    <section aria-label="Listed teachers">
      <AdminPanelHeader title="Listed teachers" subtitle="Pausing a teacher is admin only." />
      <div className="mb-4 px-[18px]">
        <div className="relative w-full sm:w-[320px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-warm-label" aria-hidden />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email, phone or subject"
            aria-label="Search listed teachers"
            className="h-11 w-full max-w-full rounded-full bg-muted pl-9 pr-4 text-sm text-foreground placeholder:text-warm-label outline-none focus-visible:ring-2 focus-visible:ring-brand"
          />
        </div>
      </div>

      {q.isPending ? (
        <AdminTableSkeleton label="Loading the teachers" />
      ) : q.isError && !q.data ? (
        <AdminError what="the teachers" onRetry={() => void q.refetch()} className="mx-[18px]" />
      ) : shown.length === 0 ? (
        <div className="mx-[18px] rounded-2xl bg-muted">
          <AdminEmpty
            title={search.trim() ? `No teacher matches "${search.trim()}".` : 'No teachers are listed yet.'}
            hint={search.trim() ? 'Check the spelling, or search by phone number or email.' : 'Teachers appear here once an application is approved.'}
            action={search.trim() ? { label: 'Clear search', onClick: () => setSearch('') } : undefined}
          />
        </div>
      ) : (
        <AdminTable columns={columns} rows={rows} />
      )}

      <Dialog open={open !== null} onOpenChange={(o) => (!o ? close() : undefined)}>
        <DialogContent aria-describedby={undefined} className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-[20px] p-6">
          {open && form ? (
            <>
              <DialogTitle className="mb-1 text-xl font-bold text-foreground">{open.title}</DialogTitle>
              <p className="mb-4 text-[13px] text-warm-secondary">
                {open.phone_number ? `+91 ${open.phone_number}` : 'No phone'} · {open.email_id ?? 'No email'}. Contacts, the photo and pausing can only be changed by an admin.
              </p>
              <DetailsForm value={form} onChange={setForm} idPrefix="teacher-edit" disabled={save.isPending} />
              <div className="mt-5 flex flex-wrap gap-2 border-t border-warm-hairline pt-4">
                <Button disabled={save.isPending} onClick={() => onSave(open)}>
                  {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                  Save changes
                </Button>
                <Button variant="outline" disabled={save.isPending} onClick={close}>
                  Cancel
                </Button>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}
