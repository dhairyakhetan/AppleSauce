import { useRef, useState } from 'react';
import { errorWords } from '@/lib/hod-publish';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { EmptyNote, ListSkeleton, LoadError, Tile, ago } from '@/components/hod/HodShared';
import { VerifierDetailsForm } from '@/components/hod/VerifierDetailsForm';
import { useConfirm } from '@/components/ui/use-confirm';
import { actionToneClass } from '@/lib/checker-button-styles';
import { UNASSIGNED_SHOWN } from '@/lib/hod-desk';
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
import {
  draftFromProfile,
  gradeNotSetLine,
  planProfileSave,
  subjectChoices,
  type DetailsDraft,
} from '@/lib/verifier-profile-edit';
import { cn } from '@/lib/utils';

/* "Verifiers": how each verifier is doing (a table, plain words, scrolls
   sideways on a phone with the name held in place), and below it each
   verifier's details and preferred subjects. Each row has an "Edit details"
   control that opens a form in place: name, grade, school, board, valid until
   (hod_set_verifier_profile) and the preferred subjects as checkboxes
   (hod_set_preferred_subjects). A verifier can fill in their own details
   (20261008100000) and the HOD can change them; preferred subjects are the
   HOD's, a verifier can only ask. Anyone whose details are missing or expired
   is listed first: expired gets no new papers, missing still gets papers but
   with no class limit. */

export const TEAM_KEY = (scope: string) => ['hod', scope, 'team'] as const;
export const PROFILES_KEY = (scope: string) => ['hod', scope, 'profiles'] as const;
/** The same key and request as AssignmentsTab's unassigned list, so the two tabs share one fetch. */
const WAITING_KEY = (scope: string) => ['hod', scope, 'unassigned'] as const;
const SUBJECTS_KEY = (scope: string) => ['hod', scope, 'subjects'] as const;

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

function errorText(err: unknown): string {
  return errorWords(err, 'That did not work. Nothing was changed. Try again.');
}

/** One verifier's row: the disclosure button, the inline form, and the request banner. Exported for tests. */
export function ProfileRow({ p, api, scope, choices }: { p: HodVerifierProfile; api: HodApi; scope: string; choices: string[] }) {
  const qc = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const name = p.full_name ?? p.name ?? p.email ?? 'Unnamed verifier';
  const formId = `verifier-details-${p.user_id}`;
  const [open, setOpen] = useState(false);
  const [justOpened, setJustOpened] = useState(false);
  const [draft, setDraft] = useState<DetailsDraft>(() => draftFromProfile(p));
  const [selected, setSelected] = useState<string[]>(p.preferred_subjects);
  const [problem, setProblem] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [requestBusy, setRequestBusy] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const flag = profileFlag(p);
  const grade = gradeNotSetLine(p);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['hod', scope] });

  /** Opening always starts from what is saved, so a half-typed draft from last time is not shown as if it were saved. */
  function openForm() {
    setDraft(draftFromProfile(p));
    setSelected(p.preferred_subjects);
    setProblem(null);
    setError(null);
    setJustOpened(true);
    setOpen(true);
  }

  function closeForm() {
    setOpen(false);
    setJustOpened(false);
    setProblem(null);
    setError(null);
    toggleRef.current?.focus();
  }

  async function save() {
    const plan = planProfileSave(draft, selected, p);
    setProblem(plan.problem);
    setError(null);
    if (plan.problem) return;
    if (!plan.setDetails && !plan.setSubjects) {
      closeForm();
      return;
    }
    /** Saving the subject list settles a pending request and the server forgets it, so a list that leaves out
     *  something they asked for is confirmed first (Approve keeps it). */
    if (plan.dropped.length > 0) {
      const ok = await confirm({
        title: `Save without ${plan.dropped.join(', ')}?`,
        description: `${name} asked for ${p.requested_subjects.join(', ')}. Saving this list closes their request and leaves out ${plan.dropped.join(', ')}. They are not told.`,
        confirmLabel: 'Save without it',
      });
      if (!ok) return;
    }
    setBusy(true);
    let detailsSaved = false;
    try {
      if (plan.setDetails && plan.detailsInput) {
        await api.setProfile(p.user_id, plan.detailsInput);
        detailsSaved = true;
      }
      if (plan.setSubjects) await api.setPreferred(p.user_id, plan.subjects);
      toast.success(plan.setDetails && plan.setSubjects ? 'Details and subjects saved.' : plan.setDetails ? 'Details saved.' : 'Preferred subjects saved.');
      setOpen(false);
      setJustOpened(false);
      toggleRef.current?.focus();
    } catch (err) {
      setError(detailsSaved ? `The details are saved, but the subjects were not. ${errorText(err)}` : errorText(err));
    } finally {
      setBusy(false);
      refresh();
    }
  }

  const approved = parseSubjectList([...p.preferred_subjects, ...p.requested_subjects].join(', '));
  async function approveRequest() {
    setRequestBusy(true);
    setRequestError(null);
    try {
      await api.setPreferred(p.user_id, approved);
      toast.success('Approved. Those subjects are now preferred.');
      refresh();
    } catch (err) {
      setRequestError(errorText(err));
    } finally {
      setRequestBusy(false);
    }
  }

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
          {grade ? (
            <p className="text-[12px] text-warm-meta" data-testid="grade-not-set">
              {grade}
            </p>
          ) : null}
          <p className="mt-1 text-[13px] text-warm-secondary" data-testid="preferred-summary">
            Preferred subjects: {p.preferred_subjects.length > 0 ? p.preferred_subjects.join(', ') : 'none yet'}
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

      <div className="mt-3">
        <button
          ref={toggleRef}
          type="button"
          aria-expanded={open}
          aria-controls={open ? formId : undefined}
          disabled={busy}
          className={actionToneClass('muted')}
          onClick={() => (open ? closeForm() : openForm())}
        >
          Edit details
        </button>
      </div>

      {open ? (
        <div className="mt-3" id={formId}>
          <VerifierDetailsForm
            idBase={formId}
            name={name}
            draft={draft}
            onDraft={setDraft}
            subjects={selected}
            choices={choices}
            onSubjects={setSelected}
            problem={problem}
            error={error}
            busy={busy}
            autoFocus={justOpened}
            onSave={() => void save()}
            onCancel={closeForm}
            formId={`${formId}-form`}
          />
        </div>
      ) : null}

      {p.requested_subjects.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-brand-subtle px-3 py-2 text-[13px]" data-testid="subject-request">
          <span className="text-foreground">
            <span className="font-semibold">Asked for: </span>
            {p.requested_subjects.join(', ')}
            {p.requested_at ? ` (${ago(p.requested_at)})` : ''}
          </span>
          <button type="button" disabled={requestBusy} className={cn(actionToneClass('brand'), 'h-[46.5px]')} onClick={() => void approveRequest()}>
            Approve
          </button>
          {requestError ? (
            <p role="alert" className="w-full text-destructive" data-testid="request-error">
              {requestError}
            </p>
          ) : null}
        </div>
      ) : null}
      {confirmDialog}
    </li>
  );
}

export function VerifiersTab({ api, scope }: { api: HodApi; scope: string }) {
  const teamQ = useQuery({ queryKey: TEAM_KEY(scope), queryFn: () => api.team(), staleTime: 15_000, refetchOnMount: true });
  const profilesQ = useQuery({ queryKey: PROFILES_KEY(scope), queryFn: () => api.profiles(), staleTime: 15_000, refetchOnMount: true });
  /** Only feeds the subject boxes; if it fails the boxes simply offer fewer subjects. */
  const waitingQ = useQuery({ queryKey: WAITING_KEY(scope), queryFn: () => api.unassignedPapers(UNASSIGNED_SHOWN + 1), staleTime: 10_000, refetchOnMount: true });
  /** The full subject list for the boxes (hod_list_subjects); if it fails the boxes fall back to what the desk holds. */
  const subjectsQ = useQuery({ queryKey: SUBJECTS_KEY(scope), queryFn: () => api.subjects(), staleTime: 5 * 60_000 });

  if (teamQ.isLoading || profilesQ.isLoading) return <ListSkeleton label="Loading verifiers" />;
  if (teamQ.isError) return <LoadError what="The verifiers" onRetry={() => void teamQ.refetch()} />;
  const team = teamQ.data ?? [];
  if (team.length === 0) return <EmptyNote>There are no verifiers yet. An admin adds them on the Verifiers page.</EmptyNote>;
  const profiles = sortProfiles(profilesQ.data ?? []);
  const needing = profiles.filter((p) => profileFlag(p) !== null).length;
  const choices = subjectChoices({
    held: [...team.flatMap((m) => m.subjects), ...(subjectsQ.data ?? []).map((s) => s.name)],
    waiting: (waitingQ.data ?? []).map((u) => u.subject ?? '').filter(Boolean),
    profiles,
    selected: [],
  });

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
              <ProfileRow key={p.user_id} p={p} api={api} scope={scope} choices={choices} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
