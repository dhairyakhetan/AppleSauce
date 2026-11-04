import { lazy, Suspense, useCallback, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { useAdminGuard, AdminGuardErrorState, adminToast } from '@/components/AdminConsole';
import { recordAdminAction } from '@/lib/audit';
import { toast as sonnerToast } from 'sonner';
import imageCompression from 'browser-image-compression';
import { usePageMeta } from '@/hooks/usePageMeta';
import { invalidateTeacherCache, removeCache } from '@/utils/cache';
import { AdminHeader, AdminAuditNote, buildAdminNav } from '@/pages/admin/shell';
import { AdminStack } from '@/pages/admin/embed';
import { AdminPageIntroPanel } from '@/components/admin/AdminHelp';
import { AdminEmpty, AdminError } from '@/components/admin/AdminState';
import { AdminFilterChips, type AdminFilterChip } from '@/components/admin/AdminFilterChips';
import { TeacherEditDialog } from '@/components/admin/TeacherEditDialog';
import { AdminTable, AdminTableSkeleton, AdminPanelHeader, AdminStatusPill, type AdminTableColumn, type AdminTableRow } from '@/pages/admin/AdminTable';
import { BentoPanel } from '@/components/layout/PageContainer';
import { fetchAdminContacts } from '@/lib/teacher-contact';
import { formatFeeRange } from '@/lib/fee-range';
import { formatDistanceToNow } from 'date-fns';
import { timeWords } from '@/lib/history-labels';
import { PREVIEW_TOOLS } from '@/lib/preview-tools';
import { isDummyMode } from '@/lib/dummy-mode';
import {
  CONTACTS_FAILED_WORDS,
  TEACHER_VIEWS,
  contactsFailed,
  countsByTeacherView,
  emptyCopy,
  filterTeachers,
  sortTeachers,
  teacherState,
  viewFromParam,
  type TeacherData,
  type TeacherSort,
  type TeacherView,
  type TeachersAdminApi,
} from '@/lib/admin-teachers';

/* Handoff 09i AD-005 "Listed teachers". Queries and mutations are ported from
   the legacy src/pages/AdminTeachers.tsx (Shikshaqmine table), unchanged. What
   changed is how the page behaves:

   - A failed read says so, with Try again. It never reads "No teachers listed".
   - All / Live / Paused / Featured are chips with their own counts. The status
     pill says Live or Paused only; Featured is a small tag beside it.
   - The fee column reads as a range ("Rs 2,000 to Rs 5,000"), never "2000-undefined".
   - The edit form is grouped, keeps Save on screen and asks before it throws
     edits away (components/admin/TeacherEditDialog.tsx).
   - After a pause or a save the row is patched in place; the list never re-skeletons.

   The page takes its database as `api`, so dummy mode (test builds only) can
   run it against made-up teachers. */

const DummyTeachers = PREVIEW_TOOLS ? lazy(() => import('@/dummy/AdminTeachersDummy')) : null;

const TEACHERS_KEY = (scope: string) => ['admin', 'teachers', scope] as const;

/* Exactly the column subset migration 20260918100000 grants `authenticated`
   on Shikshaqmine -- everything except the contact columns (Email ID, Phone
   Number, Link), which come from admin_teacher_contacts() instead. Not
   select('*'): that 401s the WHOLE request here (verified directly against
   the REST endpoint -- table-level SELECT was revoked outright, then
   re-granted per-column, which is the one shape where PostgREST does not
   silently narrow a wildcard select), which is exactly the "Failed to load
   teachers" bug this replaced. Cast to `any` on use, matching Browse.tsx's
   own SHIKSHAQ_COLUMNS pattern: supabase-js's compile-time select-string
   parser does not resolve a column list this long into a usable row type. */
const SHIKSHAQMINE_ADMIN_COLUMNS =
  '"Area","Class Size (Group/ Solo)","Classes Taught","Classes Taught for Backend","Description",' +
  '"EXPANDED","Featured","Featured Subject","Hero Image","LOCATION V2","MOU","Max Fees","Min Fees",' +
  '"Mode of Teaching","Place of Teaching","Qualifications etc","Review 1","Review 2","Review 3",' +
  '"STUDENT\'S HOME IN THESE AREAS","School Boards Catered","Sir/Ma\'am?","Slug","Subjects",' +
  '"TUTOR\'S HOME IN THESE AREAS","Title","Video","Video Link","Years they started teaching",id,is_paused';

type ContactMap = Map<number, { phoneNumber: string | null; link: string | null; emailId: string | null }>;

/** Reads the contacts; a failure is remembered, not swallowed, so the page can say so. */
async function readContacts(): Promise<{ contacts: ContactMap; failed: boolean }> {
  try {
    return { contacts: await fetchAdminContacts(), failed: false };
  } catch {
    return { contacts: new Map(), failed: true };
  }
}

export function mergeContact(row: Record<string, unknown>, contacts: ContactMap, failed = false): TeacherData {
  const c = contacts.get(row.id as number);
  const merged = c
    ? { ...row, 'Phone Number': c.phoneNumber ?? row['Phone Number'] ?? null, Link: c.link ?? row.Link ?? null, 'Email ID': c.emailId ?? row['Email ID'] ?? null }
    : row;
  return (failed ? { ...merged, __contactsFailed: true } : merged) as unknown as TeacherData;
}

export const realTeachersApi: TeachersAdminApi = {
  /* The contact columns come separately: migration 20260918100000 revoked
     table-level SELECT on Shikshaqmine from `authenticated` outright and
     re-granted it on a named column subset only (contact columns excluded on
     purpose). admin_teacher_contacts() still supplies Phone Number, Link and
     Email ID. */
  async list() {
    const [rowsResult, { contacts, failed }] = await Promise.all([
      (supabase.from('Shikshaqmine').select(SHIKSHAQMINE_ADMIN_COLUMNS) as any).order('Title', { ascending: true }),
      readContacts(),
    ]);
    const { data, error } = rowsResult;
    if (error) throw error;
    return (data || []).map((row: Record<string, unknown>) => mergeContact(row, contacts, failed));
  },
  async fetchOne(id) {
    const [{ data, error }, { contacts, failed }] = await Promise.all([
      (supabase.from('Shikshaqmine').select(SHIKSHAQMINE_ADMIN_COLUMNS) as any).eq('id', id).single(),
      readContacts(),
    ]);
    if (error || !data) return null;
    return mergeContact(data as Record<string, unknown>, contacts, failed);
  },
  async save(id, update) {
    const { error } = await supabase.from('Shikshaqmine').update(update as any).eq('id', id);
    if (error) throw error;
  },
  async setPaused(id, paused) {
    const { error } = await supabase.from('Shikshaqmine').update({ is_paused: paused } as any).eq('id', id);
    if (error) throw error;
  },
  async uploadHero(teacherId, file) {
    let compressed: File;
    try {
      compressed = await imageCompression(file, { maxSizeMB: 1, maxWidthOrHeight: 1920, useWebWorker: true, fileType: file.type });
    } catch (compressionError) {
      if (import.meta.env.DEV) console.warn('Image compression failed, using original file:', compressionError);
      compressed = file;
    }
    const fileName = `hero-images/${teacherId}-${Date.now()}.jpg`;
    const { data, error } = await supabase.storage.from('hero-images').upload(fileName, compressed, { cacheControl: '3600', upsert: false, contentType: 'image/jpeg' });
    if (error) throw error;
    const {
      data: { publicUrl },
    } = supabase.storage.from('hero-images').getPublicUrl(data.path);
    return publicUrl;
  },
};

/** Clears the localStorage caches touched by any Shikshaqmine mutation (edit, pause, feature). */
function invalidateCachesFor(teacher: Pick<TeacherData, 'Slug'>) {
  try {
    if (teacher.Slug) invalidateTeacherCache(teacher.Slug);
    removeCache('featured_teachers_browse');
    removeCache('featured_teachers_index');
    Object.keys(localStorage).forEach((key) => {
      if (key.includes('shikshaq_cache_') && key.includes('shikshaqmine')) localStorage.removeItem(key);
    });
  } catch {
    // Storage blocked: the caches expire on their own.
  }
}

// AD-005 columns: Name, Area, Subjects, Fee, Status, Joined. The real
// Shikshaqmine schema has no `updated_at` (only the `created_at` join
// timestamp), so the last column is "Joined" rather than the spec's "Updated".
const COLUMNS: AdminTableColumn[] = [
  { key: 'name', label: 'Name', width: '1.8fr' },
  { key: 'area', label: 'Area', width: '1fr', wrap: true },
  { key: 'subjects', label: 'Subjects', width: '1.6fr', wrap: true },
  { key: 'fee', label: 'Fee per month', width: '1.2fr' },
  { key: 'status', label: 'Status', width: '1.2fr' },
  { key: 'joined', label: 'Joined', width: '1fr' },
];

export type TeachersLoad = 'loading' | 'error' | 'ready';

/** The body of the panel: skeleton, error, empty or the table. A failed read
 *  shows the error and NEVER an empty-state sentence. */
export function TeachersBody({
  load,
  shown,
  view,
  search,
  rowBusyId,
  onRetry,
  onClearSearch,
  onShowAll,
  onEdit,
  onTogglePause,
}: {
  load: TeachersLoad;
  shown: TeacherData[];
  view: TeacherView;
  search: string;
  rowBusyId?: string | null;
  onRetry: () => void;
  onClearSearch: () => void;
  onShowAll: () => void;
  onEdit: (t: TeacherData) => void;
  onTogglePause: (t: TeacherData) => void;
}) {
  if (load === 'loading') return <AdminTableSkeleton label="Loading the teachers" />;
  if (load === 'error') return <AdminError what="the teachers" onRetry={onRetry} className="mx-[18px]" />;
  if (shown.length === 0) {
    const copy = emptyCopy(view, search);
    const action = search.trim() ? { label: 'Clear search', onClick: onClearSearch } : view !== 'all' ? { label: 'Show all teachers', onClick: onShowAll } : undefined;
    return (
      <div className="mx-[18px] rounded-2xl bg-muted">
        <AdminEmpty title={copy.title} hint={copy.hint} action={action} />
      </div>
    );
  }
  const rows: AdminTableRow[] = shown.map((t) => {
    const state = teacherState(t);
    const busy = rowBusyId === String(t.id);
    return {
      id: String(t.id),
      cells: [
        t.Title || 'Untitled',
        t.Area || '-',
        t.Subjects || '-',
        formatFeeRange(t['Min Fees'], t['Max Fees']),
        <span key="status" className="flex flex-wrap items-center gap-1.5">
          <AdminStatusPill status={state} label={state === 'paused' ? 'Paused' : 'Live'} />
          {t.Featured ? <span className="rounded-full bg-brand-subtle px-2 py-0.5 text-[11px] font-bold text-brand-deep">Featured</span> : null}
        </span>,
        // Every date cell in an admin table is the same: relative, muted, with the full time on hover.
        t.created_at ? (
          <span key="joined" className="text-warm-meta" title={timeWords(t.created_at)}>
            {formatDistanceToNow(new Date(t.created_at), { addSuffix: true })}
          </span>
        ) : (
          '-'
        ),
      ],
      actions: [
        { label: busy ? '...' : 'Edit', tone: 'primary', onClick: () => onEdit(t), disabled: busy },
        { label: busy ? '...' : t.is_paused ? 'Unpause' : 'Pause', tone: t.is_paused ? 'mint' : 'muted', onClick: () => onTogglePause(t), disabled: busy },
      ],
    };
  });
  return <AdminTable columns={COLUMNS} rows={rows} />;
}

export function AdminTeachersPage({
  api = realTeachersApi,
  dummy = false,
  banner,
}: {
  api?: TeachersAdminApi;
  dummy?: boolean;
  banner?: ReactNode;
}) {
  usePageMeta('Listed teachers | Shikshaq Admin', 'Teachers already on the site: edit a profile, pause one or bring one back.');
  const { user, profile } = useAuth();
  const actorName = dummy ? 'admin@example.com' : profile?.full_name || user?.email || 'an admin';
  const guard = useAdminGuard(dummy ? null : user, { redirectOnDenied: !dummy });
  const isAdmin = dummy ? true : guard.isAdmin;
  const checkingAdmin = dummy ? false : guard.checkingAdmin;
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();

  const scope = dummy ? 'dummy' : 'live';
  const key = TEACHERS_KEY(scope);
  const view = viewFromParam(params.get('view'));
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<TeacherSort>('name');
  const [editing, setEditing] = useState<TeacherData | null>(null);
  const [saving, setSaving] = useState(false);
  const [rowBusyId, setRowBusyId] = useState<string | null>(null);

  const q = useQuery({ queryKey: key, queryFn: () => api.list(), enabled: !!isAdmin, staleTime: 15_000, refetchOnMount: true, retry: false });
  const teachers = useMemo(() => q.data ?? [], [q.data]);
  const load: TeachersLoad = q.data ? 'ready' : q.isError ? 'error' : 'loading';
  const counts = useMemo(() => countsByTeacherView(teachers), [teachers]);
  const shown = useMemo(() => sortTeachers(filterTeachers(teachers, view, search), sortBy), [teachers, view, search, sortBy]);

  const setView = useCallback(
    (next: TeacherView) => {
      setParams(
        (p) => {
          const n = new URLSearchParams(p);
          if (next === 'all') n.delete('view');
          else n.set('view', next);
          return n;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const patchRow = useCallback(
    (updated: TeacherData) => {
      qc.setQueryData<TeacherData[]>(key, (old) => (old ? old.map((t) => (t.id === updated.id ? updated : t)) : old));
    },
    [qc, key],
  );

  const audit = (action: string, t: Pick<TeacherData, 'id' | 'Title'>) => {
    if (dummy || !user) return;
    void recordAdminAction({ actorId: user.id, actorName, action, targetType: 'teacher', targetId: String(t.id), targetLabel: t.Title || 'teacher' });
  };

  // Edit: the full-form save, ported from legacy handleSave().
  const handleSave = async (teacher: TeacherData, update: Record<string, unknown>) => {
    try {
      setSaving(true);
      await api.save(teacher.id, update);
      sonnerToast.success('Teacher updated successfully');
      audit('edit', teacher);
      if (!dummy) invalidateCachesFor(teacher);
      const fresh = await api.fetchOne(teacher.id).catch(() => null);
      if (fresh) patchRow(fresh);
      else await qc.invalidateQueries({ queryKey: key });
      setEditing(null);
    } catch (error) {
      if (import.meta.env.DEV) console.error('Error updating teacher:', error);
      sonnerToast.error('Failed to update teacher');
    } finally {
      setSaving(false);
    }
  };

  /* Pause / Unpause toggles the same self-service `is_paused` flag the
     teacher's own "Pause listing" control flips. No reason is collected.
     AD-005: pause is reversible, so it gets no confirmation dialog; it applies
     at once and offers a toast with Undo instead. */
  const commitPauseToggle = async (teacher: TeacherData, nextPaused: boolean) => {
    setRowBusyId(String(teacher.id));
    try {
      await api.setPaused(teacher.id, nextPaused);
      audit(nextPaused ? 'unlist' : 'relist', teacher);
      if (!dummy) invalidateCachesFor(teacher);
      patchRow({ ...teacher, is_paused: nextPaused });
      adminToast(nextPaused ? `"${teacher.Title}" paused` : `"${teacher.Title}" unpaused`, {
        description: nextPaused ? 'Hidden from Browse and search results.' : 'Visible in Browse and search results again.',
        undo: () => void commitPauseToggle({ ...teacher, is_paused: nextPaused }, !nextPaused),
      });
    } catch (error) {
      if (import.meta.env.DEV) console.error('Error toggling is_paused:', error);
      sonnerToast.error(nextPaused ? 'Failed to pause teacher' : 'Failed to unpause teacher');
    } finally {
      setRowBusyId(null);
    }
  };

  const signedIn = dummy ? 'admin@example.com' : user?.email ?? actorName;
  // Counts come from the shared hook inside AdminHeader; no page-level plumbing.
  const nav = buildAdminNav('teachers');

  if (!dummy && guard.error) return <AdminGuardErrorState onRetry={guard.retry} />;
  if (!checkingAdmin && !isAdmin) return null;

  const known = load === 'ready';
  const chips: AdminFilterChip[] = TEACHER_VIEWS.map((v) => ({
    key: v.key,
    label: v.label,
    hint: v.hint,
    ...(known ? { count: counts[v.key] } : load === 'loading' ? { noCount: true } : {}),
  }));

  return (
    <AdminStack>
      <AdminHeader nav={nav} signedInEmail={signedIn} />
      {banner}
      <AdminPageIntroPanel page="teachers" />

      {/* AD-003 gives this panel literally: `px-1.5 py-[18px]`. Table at 6px,
          heading at 24px; the inner `px-[18px]` rows are unchanged. */}
      <BentoPanel fill="card" className="px-1.5 py-[18px] lg:px-1.5 lg:py-[18px]">
        <AdminPanelHeader title="Listed teachers" />

        <div className="mb-4 flex flex-col gap-3 px-[18px]">
          <AdminFilterChips chips={chips} value={view} onChange={setView} onClear={() => setView('all')} defaultValue="all" label="Which teachers to show" />
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1 sm:w-[260px] sm:flex-none">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-warm-label" aria-hidden />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search teachers..."
                aria-label="Search teachers"
                className="h-10 w-full max-w-full rounded-full bg-muted pl-9 pr-4 text-sm text-foreground placeholder:text-warm-label outline-none transition-shadow duration-150 focus-visible:ring-2 focus-visible:ring-brand"
              />
            </div>
            <Select value={sortBy} onValueChange={(v) => setSortBy(v as TeacherSort)}>
              <SelectTrigger aria-label="Order" className="h-10 w-[150px] shrink-0 rounded-full border-0 bg-muted text-sm font-semibold sm:w-[170px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name">Name (A to Z)</SelectItem>
                <SelectItem value="fees">Fees: low to high</SelectItem>
                <SelectItem value="joined">Joined: newest</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {teachers.some((t) => contactsFailed(t)) ? (
          <AdminError what="the contact details" detail={CONTACTS_FAILED_WORDS} onRetry={() => void q.refetch()} className="mx-[18px] mb-3" />
        ) : null}

        {q.isError && q.data ? (
          <AdminError what="the latest teachers" detail="You are looking at the list as it was a moment ago." onRetry={() => void q.refetch()} className="mx-[18px] mb-3" />
        ) : null}

        <div aria-busy={q.isFetching && !!q.data}>
          <TeachersBody
            load={load}
            shown={shown}
            view={view}
            search={search}
            rowBusyId={rowBusyId}
            onRetry={() => void q.refetch()}
            onClearSearch={() => setSearch('')}
            onShowAll={() => setView('all')}
            onEdit={setEditing}
            onTogglePause={(t) => void commitPauseToggle(t, !t.is_paused)}
          />
        </div>
      </BentoPanel>

      <AdminAuditNote />

      <TeacherEditDialog
        teacher={editing}
        saving={saving}
        onSave={(t, update) => void handleSave(t, update)}
        onClose={() => setEditing(null)}
        uploadHero={(id, file) => api.uploadHero(id, file)}
      />
    </AdminStack>
  );
}

export default function AdminTeachersPageRoute() {
  if (DummyTeachers && isDummyMode()) {
    return (
      <Suspense fallback={null}>
        <DummyTeachers />
      </Suspense>
    );
  }
  return <AdminTeachersPage />;
}
