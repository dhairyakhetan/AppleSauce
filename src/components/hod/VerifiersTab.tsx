import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { EmptyNote, ListSkeleton, LoadError, Tile, ago } from '@/components/hod/HodShared';
import { VerifierProfileForm } from '@/components/hod/VerifierProfileForm';
import { useConfirm } from '@/components/ui/use-confirm';
import { actionToneClass } from '@/lib/checker-button-styles';
import { requestWouldBeDropped } from '@/lib/hod-desk';
import { formatGrade, formatValidUntil, parseSubjectList } from '@/lib/verifier-papers';
import {
  memberName,
  passRate,
  profileFlag,
  PROFILE_FLAG_LABEL,
  sortProfiles,
  TEAM_COLUMNS,
  type HodApi,
  type HodTeamMember,
  type HodVerifierProfile,
} from '@/lib/hod-api';
import { cn } from '@/lib/utils';

/* "Verifiers": how each verifier is doing (a table, plain words, scrolls
   sideways on a phone with the name held in place), and below it each
   verifier's details and preferred subjects. A verifier can fill in their
   own details (20261008100000) and the HOD can change them; preferred
   subjects are the HOD's, a verifier can only ask. Anyone whose details are
   missing or expired is listed first: expired gets no new papers, missing
   still gets papers but with no class limit. */

export const TEAM_KEY = (scope: string) => ['hod', scope, 'team'] as const;
export const PROFILES_KEY = (scope: string) => ['hod', scope, 'profiles'] as const;

function cell(m: HodTeamMember, key: string) {
  switch (key) {
    case 'passed_as_is': {
      const r = passRate(m);
      return (
        <>
          {m.passed_as_is}
          {r !== null ? <span className="ml-1 text-[12px] text-warm-meta">({r}%)</span> : null}
        </>
      );
    }
    case 'last_active':
      return m.last_active ? <span className="whitespace-nowrap">{ago(m.last_active)}</span> : <span className="text-warm-meta">Not yet</span>;
    default:
      return <>{String(m[key as keyof HodTeamMember] ?? '')}</>;
  }
}

function AnalyticsTable({ team }: { team: HodTeamMember[] }) {
  const activeCount = team.filter((m) => m.active).length;
  const today = team.reduce((a, m) => a + m.reviewed_today, 0);
  const week = team.reduce((a, m) => a + m.reviewed_7d, 0);
  const waiting = team.reduce((a, m) => a + m.questions_waiting, 0);
  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label="Active verifiers" value={activeCount} />
        <Tile label="Done today" value={today} hint="Questions all verifiers dealt with today." />
        <Tile label="Last 7 days" value={week} hint="Questions all verifiers dealt with in the last seven days." />
        <Tile label="Waiting to verify" value={waiting} hint="Questions in papers held by verifiers that nobody has settled yet." />
      </div>
      <div className="overflow-x-auto rounded-2xl bg-muted" data-testid="team-table-wrap">
        <table className="w-full min-w-[60rem] border-separate border-spacing-0 text-left text-[14px]" aria-label="Verifiers and how they are doing">
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-10 bg-muted px-4 py-3 text-[12px] font-bold uppercase tracking-[.04em] text-warm-secondary">
                Verifier
              </th>
              {TEAM_COLUMNS.map((c) => (
                <th key={c.key} scope="col" title={c.hint} className="px-3 py-3 text-[12px] font-bold uppercase tracking-[.04em] text-warm-secondary">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {team.map((m) => (
              <tr key={m.user_id} className={cn(!m.active && 'opacity-60')} data-testid="team-row">
                <th scope="row" className="sticky left-0 z-10 border-t border-warm-hairline bg-muted px-4 py-3 font-semibold text-foreground">
                  <span className="block max-w-[11rem] truncate">{memberName(m)}</span>
                  {m.active ? null : <span className="block text-[12px] font-normal text-warm-meta">Not active</span>}
                </th>
                {TEAM_COLUMNS.map((c) => (
                  <td key={c.key} className="border-t border-warm-hairline px-3 py-3 align-top tabular-nums text-foreground">
                    {cell(m, c.key)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ProfileRow({ p, api, scope }: { p: HodVerifierProfile; api: HodApi; scope: string }) {
  const qc = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const [editing, setEditing] = useState(false);
  const saved = p.preferred_subjects.join(', ');
  const [subjects, setSubjects] = useState(saved);
  // Show what was saved: the server stores the papers' own spelling
  // ("maths" saves as "Mathematics", 20261007170000).
  useEffect(() => setSubjects(saved), [saved]);
  const [busy, setBusy] = useState(false);
  /** The server's reason, kept on screen: "No papers in Astrology. Subjects with papers: ..." is too long for a toast. */
  const [refusal, setRefusal] = useState<string | null>(null);
  const flag = profileFlag(p);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['hod', scope] });

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    setRefusal(null);
    try {
      await fn();
      toast.success(ok);
      refresh();
      return true;
    } catch (err) {
      const raw = err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : '';
      setRefusal(raw || 'That did not work. Try again.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  const name = p.full_name ?? p.name ?? p.email ?? 'Unnamed verifier';

  /** Saving the box settles a pending request and the server forgets it, so a list that leaves out
   *  something they asked for is confirmed first (Approve keeps it). */
  async function saveSubjects() {
    const typed = parseSubjectList(subjects);
    const left = requestWouldBeDropped(p.requested_subjects, typed);
    if (left.length > 0) {
      const ok = await confirm({
        title: `Save without ${left.join(', ')}?`,
        description: `${name} asked for ${p.requested_subjects.join(', ')}. Saving this list closes their request and leaves out ${left.join(', ')}. They are not told.`,
        confirmLabel: 'Save without it',
      });
      if (!ok) return;
    }
    await run(() => api.setPreferred(p.user_id, typed), 'Preferred subjects saved.');
  }
  const approved = parseSubjectList([...p.preferred_subjects, ...p.requested_subjects].join(', '));

  return (
    <li className="rounded-2xl bg-muted p-4" data-testid="profile-row">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[15px] font-bold text-foreground">{name}</p>
          <p className="text-[13px] text-warm-secondary">
            {p.missing
              ? 'No details yet'
              : `${formatGrade(p.grade)} · ${p.school ?? 'No school'} · ${p.board ?? 'No board'} · valid until ${formatValidUntil(p.valid_until)}`}
          </p>
        </div>
        {flag ? (
          <span
            className={cn(
              'rounded-full px-2.5 py-1 text-[12px] font-bold',
              flag === 'request' ? 'bg-brand-subtle text-foreground' : 'bg-destructive/10 text-destructive',
            )}
            data-testid="profile-flag"
          >
            {PROFILE_FLAG_LABEL[flag]}
          </span>
        ) : null}
      </div>

      {editing ? (
        <div className="mt-3">
          <VerifierProfileForm
            initial={p}
            busy={busy}
            onCancel={() => setEditing(false)}
            onSave={(input) => void run(() => api.setProfile(p.user_id, input), 'Details saved.').then((ok) => ok && setEditing(false))}
          />
        </div>
      ) : (
        <div className="mt-2">
          <button type="button" className={actionToneClass('muted')} disabled={busy} onClick={() => setEditing(true)}>
            {p.missing ? 'Fill in details' : p.expired ? 'Refresh details' : 'Edit details'}
          </button>
        </div>
      )}

      <div className="mt-3 text-[13px]">
        <label htmlFor={`pref-${p.user_id}`} className="font-semibold text-foreground">
          Preferred subjects
        </label>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <input
            id={`pref-${p.user_id}`}
            value={subjects}
            onChange={(e) => setSubjects(e.target.value)}
            placeholder="Mathematics, Physics"
            className="min-h-[40px] min-w-[14rem] flex-1 rounded-xl bg-card px-3 text-[14px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-brand"
          />
          <button
            type="button"
            disabled={busy}
            className={actionToneClass('dark')}
            onClick={() => void saveSubjects()}
          >
            Save subjects
          </button>
        </div>
        {refusal ? (
          <p role="alert" className="mt-2 rounded-xl bg-destructive/10 px-3 py-2 text-[13px] text-destructive" data-testid="profile-refusal">
            {refusal}
          </p>
        ) : null}
        {p.requested_subjects.length > 0 ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl bg-brand-subtle px-3 py-2" data-testid="subject-request">
            <span className="text-foreground">
              <span className="font-semibold">Asked for: </span>
              {p.requested_subjects.join(', ')}
              {p.requested_at ? ` (${ago(p.requested_at)})` : ''}
            </span>
            <button
              type="button"
              disabled={busy}
              className={actionToneClass('mint')}
              onClick={() =>
                void run(() => api.setPreferred(p.user_id, approved), 'Approved. Those subjects are now preferred.').then((ok) => {
                  if (ok) setSubjects(approved.join(', '));
                })
              }
            >
              Approve
            </button>
          </div>
        ) : null}
      </div>
      {confirmDialog}
    </li>
  );
}

export function VerifiersTab({ api, scope }: { api: HodApi; scope: string }) {
  const teamQ = useQuery({ queryKey: TEAM_KEY(scope), queryFn: () => api.team(), staleTime: 15_000, refetchOnMount: true });
  const profilesQ = useQuery({ queryKey: PROFILES_KEY(scope), queryFn: () => api.profiles(), staleTime: 15_000, refetchOnMount: true });

  if (teamQ.isLoading || profilesQ.isLoading) return <ListSkeleton label="Loading verifiers" />;
  if (teamQ.isError) return <LoadError what="The verifiers" onRetry={() => void teamQ.refetch()} />;
  const team = teamQ.data ?? [];
  if (team.length === 0) return <EmptyNote>There are no verifiers yet. An admin adds them on the Verifiers page.</EmptyNote>;
  const profiles = sortProfiles(profilesQ.data ?? []);
  const needing = profiles.filter((p) => profileFlag(p) !== null).length;

  return (
    <div className="space-y-8">
      <section aria-labelledby="verifier-analytics">
        <h2 id="verifier-analytics" className="mb-2 text-[16px] font-bold text-foreground">
          How they are doing
        </h2>
        <AnalyticsTable team={team} />
      </section>
      <section aria-labelledby="verifier-details">
        <h2 id="verifier-details" className="text-[16px] font-bold text-foreground">
          Details and subjects
        </h2>
        <p className="mb-2 text-[13px] text-warm-secondary">
          {needing > 0 ? `${needing} need${needing === 1 ? 's' : ''} your attention and are listed first.` : 'Everyone is set up.'} Verifiers can fill in their own
          details and you can change them. Only you set preferred subjects; a verifier can ask and you approve here.
        </p>
        {profilesQ.isError ? (
          <LoadError what="The verifier details" onRetry={() => void profilesQ.refetch()} />
        ) : (
          <ul className="space-y-3">
            {profiles.map((p) => (
              <ProfileRow key={p.user_id} p={p} api={api} scope={scope} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
