import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { writeErrorWords } from '@/lib/admin-approval-shape';
import { Link } from 'react-router-dom';
import { useAuth } from '@/lib/auth-context';
import { useAdminGuard, AdminGuardErrorState } from '@/components/AdminConsole';
import { AdminHeader, AdminAuditNote, buildAdminNav } from '@/pages/admin/shell';
import { AdminStack } from '@/pages/admin/embed';
import { AdminPageIntroPanel } from '@/components/admin/AdminHelp';
import { AdminPanelHeader } from '@/pages/admin/AdminTable';
import { BentoPanel } from '@/components/layout/PageContainer';
import { useAdminSectionCounts } from '@/pages/admin/useAdminSectionCounts';
import { VersionHistory } from '@/components/admin/VersionHistory';
import { AdminDialog } from '@/components/admin/AdminDialog';
import { AdminEmpty, AdminError, AdminLoading } from '@/components/admin/AdminState';
import { AdminFilterChips } from '@/components/admin/AdminFilterChips';
import { AdminPillButton, adminPillClass } from '@/components/admin/AdminPillButton';
import { DebugId } from '@/components/DebugId';
import { DebugFacts } from '@/components/admin/DebugFacts';
import { olderCursor, realActivityApi, type ActivityApi, type ActivityRow, type ActivityScope, type VersionedTable } from '@/lib/activity-api';
import {
  actionWords,
  actorText,
  activitySentence,
  canOpenHistory,
  groupActivity,
  shortId,
  tableWords,
  type ActivityGroup,
} from '@/lib/activity-format';
import { relativeWords, timeWords } from '@/lib/history-labels';
import { usePageMeta } from '@/hooks/usePageMeta';
import { PREVIEW_TOOLS } from '@/lib/preview-tools';
import { isDummyMode } from '@/lib/dummy-mode';

const DummyAdminActivity = PREVIEW_TOOLS ? lazy(() => import('@/dummy/AdminActivityDummy')) : null;

/* Owner round 24: "checker logs kept and visible on admin", and every
   question's versions with a revert. One newest-first list of who checked or
   edited what (audit_review_log + content_versions + content_checks, merged
   server side by admin_activity_feed), and a History button on every
   question row that opens its versions. Actor ids and labels only: this
   list never shows a name or an email (owner, 2026-10-02).

   Admin rework, Batch 6: one edit used to show up to three times (one row per
   stream), so rows about the same question by the same actor within about two
   minutes are one line, with the other streams as "also recorded". "Show raw
   events" turns that off. The scope words match the checker log's. */

const SCOPES: { key: ActivityScope; label: string; hint: string }[] = [
  { key: 'all', label: 'Everyone', hint: 'People, AI checks and the pipeline.' },
  { key: 'people', label: 'People', hint: 'Student checkers and admins.' },
  { key: 'ai', label: 'AI and pipeline', hint: 'The AI checks and the automatic pipeline.' },
];

const PAGE = 100;

export function AdminActivityPage({
  api = realActivityApi,
  dummy = false,
  banner,
}: {
  api?: ActivityApi;
  dummy?: boolean;
  banner?: ReactNode;
}) {
  usePageMeta('Question changes | Shikshaq admin', 'Who checked or edited what, newest first.');
  const { user, profile } = useAuth();
  const actorName = dummy ? 'admin@example.com' : profile?.full_name || user?.email || 'Signed-in admin';
  const guard = useAdminGuard(dummy ? null : user, { redirectOnDenied: !dummy });
  const isAdmin = dummy ? true : guard.isAdmin;
  const checkingAdmin = dummy ? false : guard.checkingAdmin;
  const sectionCounts = useAdminSectionCounts();

  const [scope, setScope] = useState<ActivityScope>('people');
  const [raw, setRaw] = useState(false);
  const [rows, setRows] = useState<ActivityRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [done, setDone] = useState(false);
  const [open, setOpen] = useState<{ table: VersionedTable; rowId: string } | null>(null);
  const requestId = useRef(0);

  const load = useCallback(
    async (next: ActivityScope) => {
      const id = ++requestId.current;
      setRows(null);
      setError(null);
      setDone(false);
      try {
        const got = await api.feed(next, null, PAGE);
        if (id !== requestId.current) return;
        setRows(got);
        setDone(got.length < PAGE);
      } catch (e) {
        if (id !== requestId.current) return;
        const code = (e as { code?: unknown } | null)?.code;
        setError(
          code === '42501'
            ? writeErrorWords(e, '')
            : 'Could not load the activity. Check your internet and try again.',
        );
      }
    },
    [api],
  );

  useEffect(() => {
    if (isAdmin) void load(scope);
  }, [isAdmin, scope, load]);

  async function loadMore() {
    if (!rows || rows.length === 0) return;
    setLoadingMore(true);
    setError(null);
    try {
      const older = await api.feed(scope, olderCursor(rows[rows.length - 1].at), PAGE);
      const seen = new Set(rows.map((r) => `${r.stream}:${r.event_id}`));
      const fresh = older.filter((r) => !seen.has(`${r.stream}:${r.event_id}`));
      setRows([...rows, ...fresh]);
      // Nothing new means the page was only rows already shown: there is no more.
      setDone(older.length < PAGE || fresh.length === 0);
    } catch {
      setError('Could not load older activity. Try again.');
    } finally {
      setLoadingMore(false);
    }
  }

  // Grouping runs on everything loaded so far, so a group that straddles two
  // pages still joins up after Show older.
  const groups: ActivityGroup<ActivityRow>[] = useMemo(
    () => (rows ? (raw ? rows.map((r) => ({ head: r, also: [] })) : groupActivity(rows)) : []),
    [rows, raw],
  );

  const nav = buildAdminNav('activity', sectionCounts);

  if (checkingAdmin) {
    return (
      <AdminStack>
        <AdminHeader nav={nav} signedInEmail={dummy ? 'admin@example.com' : user?.email ?? actorName} />
        <BentoPanel fill="card" className="px-[18px] py-[18px] lg:px-[18px] lg:py-[18px]">
          <AdminLoading shape="rows" rows={5} label="Loading the activity" />
        </BentoPanel>
        <AdminAuditNote />
      </AdminStack>
    );
  }
  if (guard.error && !dummy) return <AdminGuardErrorState onRetry={guard.retry} />;
  if (!isAdmin) return null;

  const hidden = rows ? rows.length - groups.length : 0;

  return (
    <AdminStack>
      <AdminHeader nav={nav} signedInEmail={dummy ? 'admin@example.com' : user?.email ?? actorName} />
      <AdminPageIntroPanel page="activity" />
      {banner}
      <BentoPanel fill="card" className="px-1.5 py-[18px] lg:px-1.5 lg:py-[18px]">
        <AdminPanelHeader
          title="Question changes"
          meta={rows ? `${groups.length} shown, newest first` : undefined}
        />

        <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 px-[18px]">
          <AdminFilterChips
            label="Whose changes"
            chips={SCOPES.map((s) => ({ key: s.key, label: s.label, hint: s.hint, noCount: true }))}
            value={scope}
            onChange={(k) => setScope(k as ActivityScope)}
            defaultValue="all"
            onClear={() => setScope('all')}
          />
          <AdminPillButton
            variant={raw ? 'primary' : 'secondary'}
            size="sm"
            aria-pressed={raw}
            onClick={() => setRaw((v) => !v)}
            title="One edit is recorded by up to three logs. Show every record instead of one line per edit."
          >
            Show raw events
          </AdminPillButton>
        </div>

        <div className="px-[18px]">
          {error && !rows ? (
            <AdminError what="the activity" detail={error} onRetry={() => void load(scope)} />
          ) : rows === null ? (
            <AdminLoading shape="rows" rows={5} label="Loading the activity" />
          ) : rows.length === 0 ? (
            <AdminEmpty
              title="Nothing here yet"
              hint={
                scope === 'people'
                  ? 'No checker or admin has checked or edited a question yet. Try Everyone to see the AI and pipeline too.'
                  : 'No activity recorded for this view yet.'
              }
              action={scope !== 'all' ? { label: 'Show everyone', onClick: () => setScope('all') } : undefined}
            />
          ) : (
            <>
              <ol className="divide-y divide-warm-hairline">
                {groups.map((g) => (
                  <ActivityItem
                    key={`${g.head.stream}:${g.head.event_id}`}
                    group={g}
                    onOpen={(row) =>
                      setOpen({ table: (row.table_name as VersionedTable) ?? 'audit_questions', rowId: row.question_id! })
                    }
                  />
                ))}
              </ol>
              {!raw && hidden > 0 ? (
                <p className="mt-3 text-[12px] text-warm-meta">
                  {hidden} {hidden === 1 ? 'record is' : 'records are'} folded into the lines above. Show raw events lists every one.
                </p>
              ) : null}
              {error ? (
                <div className="mt-3">
                  <AdminError what="older activity" detail={error} onRetry={() => void loadMore()} />
                </div>
              ) : null}
              {!done ? (
                <div className="mt-4 flex justify-center">
                  <AdminPillButton variant="secondary" busy={loadingMore} onClick={() => void loadMore()}>
                    {loadingMore ? 'Loading...' : 'Show older'}
                  </AdminPillButton>
                </div>
              ) : (
                <p className="mt-4 text-center text-[12px] text-warm-meta">That is everything for this view.</p>
              )}
            </>
          )}
        </div>
      </BentoPanel>
      <AdminAuditNote />

      <AdminDialog
        open={open !== null}
        onOpenChange={(o) => {
          if (!o) setOpen(null);
        }}
        title="History of this question"
        size="md"
        footer={
          <AdminPillButton variant="secondary" size="sm" onClick={() => setOpen(null)}>
            Close
          </AdminPillButton>
        }
      >
        {open ? <VersionHistory api={api} table={open.table} rowId={open.rowId} /> : null}
      </AdminDialog>
    </AdminStack>
  );
}

export function ActivityItem({ group, onOpen }: { group: ActivityGroup<ActivityRow>; onOpen: (row: ActivityRow) => void }) {
  const { head: row, also } = group;
  const actor = actorText(row);
  const historyRow = [row, ...also].find((r) => canOpenHistory(r)) ?? null;
  const question = `${tableWords(row.table_name)}${row.question_label ? ` ${row.question_label}` : ''}`;
  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-1.5 py-3">
      <time
        dateTime={row.at}
        title={relativeWords(row.at)}
        className="w-[132px] shrink-0 pt-0.5 text-[12px] tabular-nums text-warm-meta"
      >
        {timeWords(row.at)}
      </time>
      <div className="min-w-0 flex-1 basis-[220px]">
        <p className="text-pretty text-[14px] font-semibold leading-[1.4] text-foreground">{activitySentence(row)}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[12px] text-warm-secondary">
          <span title={row.actor_user_id ? undefined : actor.full}>{actor.who}</span>
          {row.question_id ? <span>· {question}</span> : null}
          {row.paper_title ? <span>· {row.paper_title}</span> : null}
          {row.version != null ? <span className="tabular-nums">· v{row.version}</span> : null}
        </p>
        {row.detail ? <p className="mt-0.5 break-words text-[12px] text-warm-meta">{row.detail}</p> : null}
        {also.length ? (
          <p className="mt-0.5 text-[12px] text-warm-meta">
            Also recorded: {Array.from(new Set(also.map((r) => actionWords(r.action, r.question_label).toLowerCase()))).join('; ')}
          </p>
        ) : null}
        <span className="mt-1 inline-flex flex-wrap gap-1">
          <DebugId label="person" value={row.actor_user_id} />
          <DebugId label="question" value={row.question_id} />
          <DebugId label="paper" value={row.paper_id} />
          <DebugFacts facts={{ stream: row.stream, event: row.event_id, action: row.action }} />
        </span>
      </div>
      {historyRow || row.actor_user_id ? (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {row.actor_user_id ? (
            <Link
              to={`/admin/checker-log/${encodeURIComponent(row.actor_user_id)}`}
              title={`Open the day log of ${shortId(row.actor_user_id)}`}
              className={adminPillClass('quiet', 'sm', 'px-3')}
            >
              Their log
            </Link>
          ) : null}
          {historyRow ? (
            <AdminPillButton variant="secondary" size="sm" className="px-3.5" onClick={() => onOpen(historyRow)}>
              History
            </AdminPillButton>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export default function AdminActivity() {
  if (DummyAdminActivity && isDummyMode()) {
    return (
      <Suspense fallback={null}>
        <DummyAdminActivity />
      </Suspense>
    );
  }
  return <AdminActivityPage />;
}
