import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { EmptyNote, ListSkeleton, LoadError, ago } from '@/components/hod/HodShared';
import { AssignmentWhy } from '@/components/hod/AssignmentWhy';
import { PROFILES_KEY, TEAM_KEY } from '@/components/hod/VerifiersTab';
import { useConfirm } from '@/components/ui/use-confirm';
import { useAuth } from '@/lib/auth-context';
import { actionToneClass } from '@/lib/checker-button-styles';
import { capUnassigned, UNASSIGNED_SHOWN } from '@/lib/hod-desk';
import { paperLabel } from '@/lib/checker-progress';
import {
  MAX_BULK,
  newlyHeld,
  progressText,
  pruneSelected,
  runBulkAssign,
  selectAllLabel,
  selectAllState,
  selectFirst,
  summariseAutoAssign,
  summariseBulk,
  toggleSelected,
  type HeldPaper,
  type Outcome,
} from '@/lib/hod-bulk-assign';
import { cn } from '@/lib/utils';
import { formatGrade } from '@/lib/verifier-papers';
import {
  groupByVerifier,
  memberName,
  pickBlock,
  type HodApi,
  type HodAssignment,
  type HodTeamMember,
  type HodVerifierProfile,
  type UnassignedPaper,
} from '@/lib/hod-api';

/* "Assignments": which paper each verifier holds, with Move and Unassign, and
   the papers nobody holds with an Assign to control. A whole paper goes to
   one verifier. The server refuses a move that breaks its rules (a paper above
   the verifier's grade, details missing or expired); its reason is shown as
   written. "Auto assign all" runs the automatic hand-out straight away and
   then says how many went to whom and how many are left (the server only
   returns a count, so who got what is read back from the lists afterwards).
   Papers in the list below can be ticked and given to one verifier in one go:
   the existing one-paper call, run four at a time, at most 50 at once, each
   paper's success or refusal shown. There is no server call that auto assigns
   only a chosen few, so no auto button is offered for the ticked papers.
   Papers whose class is unknown are handed out as Class 12; papers left
   untouched for 7 days come back to the list below (20261007140000). */

export const ASSIGNMENTS_KEY = (scope: string) => ['hod', scope, 'assignments'] as const;
export const UNASSIGNED_KEY = (scope: string) => ['hod', scope, 'unassigned'] as const;

/** A person picker and its button: "Move to another verifier", "Assign to". */
function PickVerifier({
  label,
  buttonLabel,
  options,
  busy,
  onPick,
  paperClass,
  profileOf,
  extra,
}: {
  label: string;
  buttonLabel: string;
  options: HodTeamMember[];
  busy: boolean;
  /** Return false (or a promise of false) when nothing happened, so the pick stays in the box to retry. */
  onPick: (userId: string) => void | boolean | Promise<boolean | void>;
  /** The paper's class, so verifiers below it are shown but cannot be picked. */
  paperClass: string | null;
  profileOf: (userId: string) => HodVerifierProfile | undefined;
  /** Shown under the picker once someone is picked, for example "Why this paper?". */
  extra?: (userId: string) => ReactNode;
}) {
  const [value, setValue] = useState('');
  return (
    <>
    {/* One line at every width: the dropdown takes what is left, the button keeps its size. */}
    <span className="flex w-full items-center gap-1.5 sm:inline-flex sm:w-auto">
      <select
        aria-label={label}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={busy || options.length === 0}
        className="min-h-11 w-0 min-w-0 flex-1 rounded-xl bg-muted px-3 text-[14px] font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-brand sm:w-auto sm:max-w-[14rem] sm:flex-none"
      >
        <option value="">{label}</option>
        {options.map((m) => {
          const p = profileOf(m.user_id);
          const block = pickBlock(p, paperClass);
          const grade = p?.grade != null ? formatGrade(p.grade) : null;
          return (
            // The server refuses these anyway (verifier_can_take); greyed out
            // with the reason, so the HOD sees why before pressing.
            <option key={m.user_id} value={m.user_id} disabled={block !== null}>
              {memberName(m)}
              {grade ? ` (${grade})` : ''}
              {block ? `, ${block}` : ''}
            </option>
          );
        })}
      </select>
      <button
        type="button"
        disabled={busy || value === ''}
        onClick={() => {
          // Clear the box only once the move really happened. A cancelled
          // confirm or a server refusal keeps the pick, so it never looks as
          // if the click was swallowed.
          void Promise.resolve(onPick(value)).then((done) => {
            if (done !== false) setValue('');
          });
        }}
        className={cn(actionToneClass('dark'), 'shrink-0')}
      >
        {buttonLabel}
      </button>
    </span>
    {value && extra ? <div className="basis-full">{extra(value)}</div> : null}
    </>
  );
}

/** The result of "Auto assign all" or a bulk assign. The wrapper is always on the page so a screen reader announces what appears in it. */
export function OutcomePanel({ outcome, onDismiss }: { outcome: Outcome | null; onDismiss: () => void }) {
  return (
    <div role="status" aria-live="polite" data-testid="assign-outcome">
      {outcome ? (
        <div
          className={cn(
            'rounded-[18px] p-4 text-[14px] text-foreground',
            outcome.tone === 'good' ? 'bg-mint' : outcome.tone === 'bad' ? 'bg-destructive/10' : 'bg-brand-subtle',
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <p className="font-bold">{outcome.headline}</p>
            <button type="button" onClick={onDismiss} className="tap-44 -my-2 shrink-0 font-semibold underline">
              Dismiss
            </button>
          </div>
          {outcome.lines.map((l) => (
            <p key={l} className="mt-1 text-warm-secondary">
              {l}
            </p>
          ))}
          {outcome.failures.length > 0 ? (
            <ul className="mt-2 space-y-1" data-testid="assign-failures">
              {outcome.failures.map((f, i) => (
                <li key={`${f.label}-${i}`}>
                  <span className="font-semibold">{f.label}:</span> {f.reason}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** The bar that stays at the bottom of the screen while papers are ticked. */
export function BulkBar({
  count,
  options,
  value,
  onValue,
  onAssign,
  onClear,
  progress,
}: {
  count: number;
  options: { value: string; label: string }[];
  value: string;
  onValue: (v: string) => void;
  onAssign: () => void;
  onClear: () => void;
  /** Set while the run is going. */
  progress: { done: number; total: number } | null;
}) {
  const running = progress !== null;
  return (
    <div
      role="region"
      aria-label="Assign the ticked papers"
      className="sticky bottom-3 z-20 mt-3 rounded-[18px] bg-card p-4 shadow-border"
      data-testid="bulk-bar"
    >
      <div className="flex items-center justify-between gap-2">
        <p id="bulk-bar-label" className="text-[14px] font-bold text-foreground">
          Assign {count} selected to
        </p>
        <button type="button" disabled={running} onClick={onClear} className="tap-44 shrink-0 rounded-full bg-muted px-4 text-[14px] font-semibold text-warm-secondary disabled:opacity-50">
          Clear
        </button>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <select
          aria-labelledby="bulk-bar-label"
          value={value}
          onChange={(e) => onValue(e.target.value)}
          disabled={running}
          className="min-h-11 w-0 min-w-0 flex-1 rounded-xl bg-muted px-3 text-[14px] font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-brand sm:w-auto sm:max-w-[18rem] sm:flex-none sm:basis-72"
        >
          <option value="">Choose a verifier</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={running || value === ''}
          aria-busy={running || undefined}
          onClick={onAssign}
          className={cn(actionToneClass('brand'), 'shrink-0')}
        >
          {running ? 'Assigning...' : 'Assign'}
        </button>
      </div>
      {running ? (
        <p className="mt-2 text-[13px] text-warm-secondary" data-testid="bulk-progress">
          {progressText(progress.done, progress.total)}
        </p>
      ) : (
        <p className="mt-2 hidden text-[12px] text-warm-meta sm:block">The server checks each paper. A paper it refuses stays ticked and is listed with its reason.</p>
      )}
    </div>
  );
}

/** "Select all 12" with a box that shows none, some or all. */
export function SelectAllRow({ listLength, selectedCount, onChange }: { listLength: number; selectedCount: number; onChange: () => void }) {
  const state = selectAllState(selectedCount, listLength);
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl px-3 text-[14px] font-semibold text-foreground">
      <input
        type="checkbox"
        checked={state === 'all'}
        aria-label={selectAllLabel(listLength)}
        ref={(el) => {
          if (el) el.indeterminate = state === 'some';
        }}
        onChange={onChange}
        className="h-5 w-5 shrink-0 accent-[hsl(var(--brand))]"
      />
      <span>{selectAllLabel(listLength)}</span>
      <span className="ml-auto text-[13px] font-normal text-warm-secondary" data-testid="selected-count">
        {selectedCount} selected
      </span>
    </label>
  );
}

const heldNow = (list: HodAssignment[]): HeldPaper[] =>
  list.map((a) => ({ paper_id: a.paper_id, user_id: a.user_id, name: a.checker_name ?? 'Unnamed verifier' }));

export function AssignmentsTab({ api, scope }: { api: HodApi; scope: string }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  /** The HOD's own id, for "Assign to me". In dummy mode there is no sign-in, so a fixed fake id stands in. */
  const myId = user?.id ?? (scope === 'dummy' ? 'dummy-me' : null);
  const { confirm, confirmDialog } = useConfirm();
  const [busy, setBusy] = useState(false);
  /** Set while the slow hand-out runs, so the button says what is happening. */
  const [giving, setGiving] = useState(false);
  /** The server's reason for the last refusal, kept on screen (a toast is gone too fast to read). */
  const [refusal, setRefusal] = useState<string | null>(null);
  /** Ticked papers (ids). Only ids still on the list count; see `chosen` below. */
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [bulkTarget, setBulkTarget] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  /** The last hand-out or bulk result, kept on screen until dismissed. */
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const outcomeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (outcome) outcomeRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [outcome]);
  const assignmentsQ = useQuery({ queryKey: ASSIGNMENTS_KEY(scope), queryFn: () => api.assignments(), staleTime: 10_000, refetchOnMount: true });
  const unassignedQ = useQuery({ queryKey: UNASSIGNED_KEY(scope), queryFn: () => api.unassignedPapers(UNASSIGNED_SHOWN + 1), staleTime: 10_000, refetchOnMount: true });
  const teamQ = useQuery({ queryKey: TEAM_KEY(scope), queryFn: () => api.team(), staleTime: 15_000, refetchOnMount: true });
  const profilesQ = useQuery({ queryKey: PROFILES_KEY(scope), queryFn: () => api.profiles(), staleTime: 15_000, refetchOnMount: true });
  const profileOf = (id: string) => (profilesQ.data ?? []).find((p) => p.user_id === id);
  /** Why someone holds nothing, when it is not just "nothing to give out". */
  const whyIdle = (id: string): string | null => {
    const p = profileOf(id);
    if (!profilesQ.data || !p) return null;
    if (p.expired) return 'Their details have expired, so no new papers are given to them. Update them on Verifiers.';
    return null;
  };

  const refresh = () => void qc.invalidateQueries({ queryKey: ['hod', scope] });
  const verifiers = (teamQ.data ?? []).filter((m) => m.active);

  /** Runs one change. True when it went through, false when the server refused it. */
  async function act(fn: () => Promise<unknown>, done: (r: unknown) => string): Promise<boolean> {
    setBusy(true);
    setRefusal(null);
    try {
      const r = await fn();
      toast.success(done(r));
      refresh();
      return true;
    } catch (err) {
      const raw = err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : '';
      const reason = raw || 'That did not work. Try again.';
      setRefusal(reason);
      // The banner sits at the top of the tab, which may be scrolled out of view
      // from a row far down the list, so say it where the HOD is looking as well.
      toast.error(reason, { duration: 10_000 });
      // A refusal often means the lists on screen are out of date.
      refresh();
      return false;
    } finally {
      setBusy(false);
    }
  }

  const nameOf = (id: string) => {
    const m = verifiers.find((c) => c.user_id === id);
    return m ? memberName(m) : 'that verifier';
  };

  /** Auto assign all: the server returns only a count, so who got what is read back from the lists. */
  async function autoAssignAll() {
    const waiting = unassignedQ.data?.length ?? 0;
    const ok = await confirm({
      title: waiting > 0 ? `Hand out ${waiting > UNASSIGNED_SHOWN ? `${UNASSIGNED_SHOWN}+` : waiting} free ${waiting === 1 ? 'paper' : 'papers'} now?` : 'Hand out the free papers now?',
      description: 'Each paper goes to one verifier, never above their grade. You will see how many went to whom and how many are left. Taking a paper back is one tap on its row.',
      confirmLabel: 'Auto assign all',
    });
    if (!ok) return;
    setBusy(true);
    setGiving(true);
    setRefusal(null);
    setOutcome(null);
    const readAssignments = () => qc.fetchQuery({ queryKey: ASSIGNMENTS_KEY(scope), queryFn: () => api.assignments(), staleTime: 0 });
    const readFree = () => qc.fetchQuery({ queryKey: UNASSIGNED_KEY(scope), queryFn: () => api.unassignedPapers(UNASSIGNED_SHOWN + 1), staleTime: 0 });
    try {
      const before = heldNow(await readAssignments().catch(() => assignmentsQ.data ?? []));
      const gave = await api.distribute();
      let perPerson: { name: string; count: number }[] | null = null;
      let left: number | null = null;
      let leftIsAtLeast = false;
      try {
        const [afterHeld, afterFree] = await Promise.all([readAssignments(), readFree()]);
        perPerson = newlyHeld(before, heldNow(afterHeld));
        left = Math.min(afterFree.length, UNASSIGNED_SHOWN);
        leftIsAtLeast = afterFree.length > UNASSIGNED_SHOWN;
      } catch {
        // The hand-out itself worked; only the read-back failed, so say only what the server said.
      }
      setOutcome(summariseAutoAssign({ gave, perPerson, left, leftIsAtLeast }));
      refresh();
    } catch (err) {
      const raw = err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : '';
      setRefusal(raw || 'That did not work. Try again.');
      refresh();
    } finally {
      setGiving(false);
      setBusy(false);
    }
  }

  /** Gives every ticked paper to one person with the existing one-paper call, four at a time. */
  async function bulkAssign(items: { paperId: string; label: string }[]) {
    const toId = bulkTarget;
    if (!toId || items.length === 0) return;
    const targetName = toId === myId ? 'you' : nameOf(toId);
    setBusy(true);
    setRefusal(null);
    setOutcome(null);
    setProgress({ done: 0, total: items.length });
    try {
      const results = await runBulkAssign(items, (paperId) => api.assignPaper(paperId, toId), {
        onProgress: (done, total) => setProgress({ done, total }),
      });
      setOutcome(summariseBulk(results, targetName));
      // Refused papers stay ticked, so the same choice can be retried or changed.
      setSelected(new Set(results.filter((r) => !r.ok).map((r) => r.paperId)));
    } finally {
      setProgress(null);
      setBusy(false);
      refresh();
    }
  }

  async function unassign(a: HodAssignment) {
    const ok = await confirm({
      title: `Take ${paperLabel(a)} back from ${a.checker_name ?? 'this verifier'}?`,
      description: 'The paper goes back to the pool and can be given out again. Work already done on it stays.',
      confirmLabel: 'Unassign',
    });
    if (!ok) return;
    await act(() => api.unassign(a.assignment_id), () => 'Paper taken back.');
  }

  /** Moving a paper takes it from its holder, so ask first, naming who loses it (like Unassign does). */
  async function reassign(a: HodAssignment, toId: string, toName: string, done: string): Promise<boolean> {
    const ok = await confirm({
      title: `Move ${paperLabel(a)} from ${a.checker_name ?? 'this verifier'} to ${toName}?`,
      description: `${a.checker_name ?? 'They'} will no longer have this paper. Work already done on it stays.`,
      confirmLabel: 'Move it',
    });
    if (!ok) return false;
    return act(() => api.assignPaper(a.paper_id, toId), () => done);
  }

  if (assignmentsQ.isLoading || unassignedQ.isLoading || teamQ.isLoading) return <ListSkeleton label="Loading assignments" />;
  if (assignmentsQ.isError) return <LoadError what="The assignments" onRetry={() => void assignmentsQ.refetch()} />;
  // Without the team every picker would be empty and read as "nobody to give it to".
  if (teamQ.isError) return <LoadError what="The list of verifiers" onRetry={() => void teamQ.refetch()} />;

  const groups = groupByVerifier(assignmentsQ.data ?? []);
  const idle = verifiers.filter((m) => !groups.some((g) => g.user_id === m.user_id));
  const { shown: free, more: moreFree } = capUnassigned(unassignedQ.data ?? []);
  /** The ticked papers still on the list, in list order (a paper given out meanwhile drops out by itself). */
  const chosen = free.filter((p) => selected.has(p.paper_id));
  /** Who a bulk assign can go to: the HOD themself first, then every active verifier. */
  const bulkOptions = [
    ...(myId ? [{ value: myId, label: 'Me' }] : []),
    ...verifiers
      .filter((m) => m.user_id !== myId)
      .map((m) => {
        const grade = profileOf(m.user_id)?.grade;
        return { value: m.user_id, label: `${memberName(m)}${grade != null ? ` (${formatGrade(grade)})` : ''}` };
      }),
  ];

  const row = (a: HodAssignment) => (
    <li key={a.assignment_id} className="rounded-2xl bg-card p-3" data-testid="assignment-row">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[14px] font-semibold text-foreground">{paperLabel(a)}</p>
          <p className="text-[12px] text-warm-meta">
            {a.remaining} {a.remaining === 1 ? 'question' : 'questions'} left · {!a.given_by_name || a.given_by_name === 'Automatic' ? 'Given automatically' : `Given by ${a.given_by_name}`}
            {a.assigned_at ? ` ${ago(a.assigned_at)}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {myId && a.user_id !== myId ? (
            <button
              type="button"
              disabled={busy}
              className={actionToneClass('brand')}
              onClick={() => void reassign(a, myId, 'you', 'Moved to you. Open it from My papers.')}
            >
              Take it myself
            </button>
          ) : null}
          <PickVerifier
            label="Move to another verifier"
            buttonLabel="Move"
            busy={busy}
            options={verifiers.filter((m) => m.user_id !== a.user_id)}
            paperClass={a.cls}
            profileOf={profileOf}
            onPick={(uid) => reassign(a, uid, nameOf(uid), `Moved to ${nameOf(uid)}.`)}
          />
          <button type="button" disabled={busy} onClick={() => void unassign(a)} className={actionToneClass('muted')}>
            Unassign
          </button>
        </div>
      </div>
      <AssignmentWhy api={api} scope={scope} checkerId={a.user_id} paperId={a.paper_id} />
    </li>
  );

  return (
    <div className="space-y-8">
      {profilesQ.isError ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-muted px-4 py-3 text-[14px] text-foreground" data-testid="profiles-error">
          <span>Grades and details did not load, so the pickers cannot grey out verifiers who are below a paper's class. The server still checks each move.</span>
          <button type="button" onClick={() => void profilesQ.refetch()} className="tap-44 font-semibold text-brand-blue">
            Try again
          </button>
        </div>
      ) : null}
      {refusal ? (
        <div role="alert" className="flex items-start justify-between gap-3 rounded-2xl bg-destructive/10 px-4 py-3 text-[14px] text-destructive" data-testid="assign-refusal">
          <span>{refusal}</span>
          <button type="button" onClick={() => setRefusal(null)} className="shrink-0 font-semibold underline">
            Dismiss
          </button>
        </div>
      ) : null}

      <section aria-labelledby="who-has-what">
        <h2 id="who-has-what" className="mb-2 text-[16px] font-bold text-foreground">
          Who has what
        </h2>
        {groups.length === 0 && idle.length === 0 ? (
          <EmptyNote>No paper is assigned to anyone right now.</EmptyNote>
        ) : (
          <ul className="space-y-3">
            {groups.map((g) => (
              <li key={g.user_id} className="rounded-[18px] bg-muted p-3" data-testid="verifier-load">
                <p className="mb-2 px-1 text-[15px] font-bold text-foreground">
                  {g.name}
                  <span className="ml-2 text-[12px] font-normal text-warm-meta">
                    {g.papers.length} {g.papers.length === 1 ? 'paper' : 'papers'}
                  </span>
                </p>
                <ul className="space-y-2">{g.papers.map(row)}</ul>
              </li>
            ))}
            {idle.map((m) => (
              <li key={m.user_id} className="rounded-[18px] bg-muted p-3">
                <p className="px-1 text-[15px] font-bold text-foreground">
                  {memberName(m)} <span className="ml-2 text-[12px] font-normal text-warm-meta">no papers yet</span>
                </p>
                {whyIdle(m.user_id) ? (
                  <p className="mt-0.5 px-1 text-[13px] text-warm-secondary" data-testid="idle-reason">
                    {whyIdle(m.user_id)}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="papers-nobody-has">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 id="papers-nobody-has" className="text-[16px] font-bold text-foreground">
            Papers nobody has
          </h2>
          <button
            type="button"
            disabled={busy}
            aria-busy={giving || undefined}
            className={actionToneClass('brand')}
            onClick={() => void autoAssignAll()}
          >
            {giving ? 'Assigning papers...' : 'Auto assign all'}
          </button>
        </div>
        <p className="mb-2 text-[13px] text-warm-secondary">
          Papers go to verifiers automatically, a whole paper to one verifier and never above their grade. A verifier with no grade recorded can get any
          paper. A paper whose class is not known can go to any verifier. A paper with nothing done on it for 7 days comes back
          here by itself.
        </p>
        <div ref={outcomeRef} className="mb-2 scroll-mb-24">
          <OutcomePanel outcome={outcome} onDismiss={() => setOutcome(null)} />
        </div>
        {unassignedQ.isError ? (
          <LoadError what="The list of free papers" onRetry={() => void unassignedQ.refetch()} />
        ) : free.length === 0 ? (
          <EmptyNote>Every paper with questions waiting has a verifier.</EmptyNote>
        ) : (
          <>
          <SelectAllRow
            listLength={free.length}
            selectedCount={chosen.length}
            onChange={() => setSelected(chosen.length > 0 && chosen.length >= Math.min(free.length, MAX_BULK) ? new Set() : selectFirst(free.map((p) => p.paper_id)))}
          />
          <ul className="mt-1 space-y-2">
            {free.map((p: UnassignedPaper) => {
              const ticked = selected.has(p.paper_id);
              return (
              <li
                key={p.paper_id}
                className={cn('rounded-2xl bg-muted p-3', ticked && 'ring-2 ring-brand')}
                data-testid="free-paper"
              >
               <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                <label className="flex min-h-11 min-w-0 cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    checked={ticked}
                    disabled={busy || (!ticked && chosen.length >= MAX_BULK)}
                    aria-label={`Select ${paperLabel(p)}`}
                    onChange={() => setSelected((s) => toggleSelected(pruneSelected(s, free.map((f) => f.paper_id)), p.paper_id))}
                    className="h-5 w-5 shrink-0 accent-[hsl(var(--brand))]"
                  />
                  <span className="min-w-0">
                    <span className="block text-[14px] font-semibold text-foreground">{paperLabel(p)}</span>
                    <span className="block text-[12px] text-warm-meta">
                      {p.open_count} {p.open_count === 1 ? 'question' : 'questions'} waiting
                      {p.cls ? '' : ' · class not known'}
                    </span>
                  </span>
                </label>
                <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                  {myId ? (
                    <button
                      type="button"
                      disabled={busy}
                      className={actionToneClass('brand')}
                      onClick={() => void act(() => api.assignPaper(p.paper_id, myId), () => 'Given to you. Open it from My papers.')}
                    >
                      Assign to me
                    </button>
                  ) : null}
                  <PickVerifier
                    label="Assign to"
                    buttonLabel="Assign"
                    busy={busy}
                    options={verifiers}
                    paperClass={p.cls}
                    profileOf={profileOf}
                    onPick={(uid) => act(() => api.assignPaper(p.paper_id, uid), () => `Given to ${nameOf(uid)}.`)}
                    extra={(uid) => <AssignmentWhy api={api} scope={scope} checkerId={uid} paperId={p.paper_id} />}
                  />
                </div>
               </div>
              </li>
              );
            })}
          </ul>
          {chosen.length > 0 || progress ? (
            <BulkBar
              count={progress ? progress.total : chosen.length}
              options={bulkOptions}
              value={bulkTarget}
              onValue={setBulkTarget}
              onAssign={() => void bulkAssign(chosen.map((p) => ({ paperId: p.paper_id, label: paperLabel(p) })))}
              onClear={() => setSelected(new Set())}
              progress={progress}
            />
          ) : null}
          {moreFree ? (
            <p className="mt-2 rounded-2xl bg-muted px-4 py-3 text-[13px] text-warm-secondary" data-testid="free-more">
              More papers than these have no verifier. This list shows the first {UNASSIGNED_SHOWN}, in subject and class order. Give some out and the rest come into view.
            </p>
          ) : null}
          </>
        )}
      </section>
      {confirmDialog}
    </div>
  );
}
