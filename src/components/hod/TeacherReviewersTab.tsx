import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { toast as sonnerToast } from 'sonner';
import { UserPlus } from 'lucide-react';
import { useConfirm } from '@/components/ui/use-confirm';
import { looksLikeEmail } from '@/lib/email-shape';
import { realTeacherReviewerAdminApi, type ReviewerRow, type TeacherReviewerAdminApi } from '@/lib/teacher-review-api';
import type { HodTabProps } from '@/pages/Hod';

/* Teacher reviewers: the people on the teachers team, who can approve, reject
   and edit teachers at /teacher-review without being admin. An HOD or an admin
   adds one by the email they signed up with, and can remove them again. The
   server checks is_hod() on each call (admins count). */

export function TeacherReviewersTab({ reviewerApi }: HodTabProps) {
  return <TeacherReviewersSection api={reviewerApi ?? realTeacherReviewerAdminApi} />;
}

export function TeacherReviewersSection({ api }: { api: TeacherReviewerAdminApi }) {
  const [rows, setRows] = useState<ReviewerRow[] | null>(null);
  const [email, setEmail] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The list itself failed to load: not the same thing as an empty team. */
  const [loadFailed, setLoadFailed] = useState(false);
  const { confirm, confirmDialog } = useConfirm();

  const load = useCallback(async () => {
    try {
      setRows(await api.list());
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
      sonnerToast.error('Failed to load the teacher reviewers');
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const active = (rows ?? []).filter((r) => r.active);

  async function add(e: FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!looksLikeEmail(trimmed)) {
      setError('Type the email the person signed up with.');
      return;
    }
    setError(null);
    setAdding(true);
    try {
      await api.add(trimmed);
      setEmail('');
      sonnerToast.success(`${trimmed} is now a teacher reviewer`);
      await load();
    } catch (err) {
      setError(
        err instanceof Error && /no account|not found|sign up/i.test(err.message)
          ? 'No Shikshaq account has that email yet. They may not have signed up, or they used a different email.'
          : 'Could not add that person. Check the email and try again.',
      );
    } finally {
      setAdding(false);
    }
  }

  async function remove(r: ReviewerRow) {
    const who = r.name ?? r.email ?? 'this person';
    const ok = await confirm({
      title: `Remove ${who} from the teachers team?`,
      description: 'They will no longer be able to open the teacher review page. What they already approved, rejected or edited stays as it is.',
      confirmLabel: 'Remove',
    });
    if (!ok) return;
    try {
      await api.remove(r.user_id);
      sonnerToast.success(`${who} removed from the teachers team`);
      await load();
    } catch {
      sonnerToast.error('Failed to remove that person');
    }
  }

  return (
    <section aria-labelledby="reviewers-heading" data-testid="teacher-reviewers">
      <h2 id="reviewers-heading" className="text-[15px] font-bold text-foreground">
        Teacher reviewers
      </h2>
      <p className="mt-1 max-w-2xl text-pretty text-[14px] leading-snug text-warm-secondary">
        People on the teachers team can approve, reject and edit teachers, and they can see teachers' phone numbers and emails. They cannot reach anything else in admin. Add someone by the email they signed up with.
      </p>

      <form onSubmit={add} className="mt-4 flex max-w-xl flex-wrap items-end gap-2">
        <label className="flex min-w-[220px] flex-1 flex-col gap-1">
          <span className="text-[12px] font-semibold text-warm-secondary">Email of the person to add</span>
          <input
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setError(null);
            }}
            placeholder="name@example.com"
            className="h-11 w-full rounded-full bg-muted px-4 text-sm text-foreground placeholder:text-warm-label outline-none focus-visible:ring-2 focus-visible:ring-brand"
          />
        </label>
        <button
          type="submit"
          disabled={adding || email.trim() === ''}
          className="flex h-11 items-center gap-1.5 rounded-full bg-brand px-5 text-sm font-semibold text-foreground transition-transform duration-150 active:scale-[0.97] disabled:opacity-50"
        >
          <UserPlus className="h-4 w-4" aria-hidden />
          {adding ? 'Adding...' : 'Add to teachers team'}
        </button>
      </form>
      {error ? (
        <p role="alert" className="mt-2 text-[13px] text-destructive">
          {error}
        </p>
      ) : null}

      <div className="mt-5">
        {loadFailed && rows === null ? (
          <div role="alert" className="rounded-2xl bg-destructive/10 px-4 py-4 text-[14px] text-foreground" data-testid="reviewers-load-error">
            <p>The teacher reviewers did not load. This is not the same as nobody being on the team.</p>
            <button type="button" onClick={() => void load()} className="tap-44 mt-1 font-semibold text-brand-blue">
              Try again
            </button>
          </div>
        ) : rows === null ? (
          <div className="h-14 animate-pulse rounded-2xl bg-muted" role="status" aria-label="Loading the teacher reviewers" />
        ) : active.length === 0 ? (
          <p className="rounded-2xl bg-muted px-4 py-8 text-center text-[14px] text-warm-secondary">
            Nobody is on the teachers team yet. Admins can always open the teacher review page.
          </p>
        ) : (
          <ul className="space-y-2">
            {active.map((r) => (
              <li key={r.user_id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-muted px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-semibold text-foreground">{r.name || r.email || 'Unnamed account'}</p>
                  <p className="truncate text-[12px] text-warm-meta">
                    {r.name && r.email ? `${r.email} · ` : ''}
                    {r.granted_at ? `added ${formatDistanceToNow(new Date(r.granted_at), { addSuffix: true })}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label={`Remove ${r.name || r.email || 'this person'}`}
                  onClick={() => void remove(r)}
                  className="tap-44 rounded-full bg-card px-4 text-[13px] font-semibold text-destructive transition-transform duration-150 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {confirmDialog}
    </section>
  );
}
