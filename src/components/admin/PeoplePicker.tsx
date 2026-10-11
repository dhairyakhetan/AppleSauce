import { useEffect, useState } from 'react';
import { Search, UserPlus } from 'lucide-react';
import { InfoTip } from '@/components/admin/AdminHelp';
import { adminPillClass } from '@/components/admin/AdminPillButton';
import { looksLikeEmail } from '@/lib/email-shape';
import type { UserSearchRow } from '@/lib/checker-api';
import type { TipKey } from '@/lib/admin-hints';
import { cn } from '@/lib/utils';

/* The one "find a person and give them a role" control. Verifiers, HODs and
   teacher reviewers all use it, so the three flows read and behave the same:
   type two letters of a name or email, pick the person, press the button.

   The parent owns what pressing the button does. `onAdd` receives the email
   and throws an Error whose message is already in plain words; the picker
   shows it. On success the box clears. */

export const PEOPLE_NO_ACCOUNT =
  'No Shikshaq account has that email yet. They may not have signed up, or they used a different email.';

export interface PeoplePickerProps {
  /** Visible label above the box, e.g. "Find a person to add". */
  label: string;
  /** Accessible name of the box, e.g. "Search by name or email to add a verifier". */
  ariaLabel: string;
  searchUsers: (query: string) => Promise<UserSearchRow[]>;
  onAdd: (email: string) => Promise<void>;
  /** Button text for a found person ("Add", "Make HOD"). */
  actionLabel: (u: UserSearchRow) => string;
  /** True when this person already holds the role. */
  isAlready: (u: UserSearchRow) => boolean;
  /** "Already a verifier". */
  alreadyLabel: string;
  /** Names the results list for screen readers. */
  resultsLabel: string;
  tip?: TipKey;
  tipLabel?: string;
  className?: string;
}

export function PeoplePicker({
  label,
  ariaLabel,
  searchUsers,
  onAdd,
  actionLabel,
  isAlready,
  alreadyLabel,
  resultsLabel,
  tip,
  tipLabel,
  className,
}: PeoplePickerProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserSearchRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      searchUsers(q)
        .then((r) => {
          if (!cancelled) setResults(r);
        })
        .catch(() => {
          if (!cancelled) setError('The search did not work. Try again.');
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, searchUsers]);

  async function add(email: string, key: string) {
    const trimmed = email.trim();
    if (!looksLikeEmail(trimmed)) {
      setError('That person has no email on file. Ask them to update their profile.');
      return;
    }
    setError(null);
    setAdding(key);
    try {
      await onAdd(trimmed);
      setQuery('');
      setResults([]);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'Could not add that person. Check the email and try again.');
    } finally {
      setAdding(null);
    }
  }

  const q = query.trim();
  return (
    <div className={cn('mb-4 px-[18px]', className)}>
      <label className="flex max-w-md flex-col gap-1">
        <span className="flex items-center gap-1 text-[12px] font-semibold text-warm-secondary">
          {label}
          {tip ? <InfoTip tip={tip} label={tipLabel} /> : null}
        </span>
        <span className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-warm-label" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setError(null);
            }}
            placeholder="Search by name or email"
            aria-label={ariaLabel}
            className="h-11 w-full max-w-full rounded-full bg-muted pl-10 pr-4 text-sm text-foreground outline-none transition-shadow duration-150 placeholder:text-warm-label focus-visible:ring-2 focus-visible:ring-brand"
          />
        </span>
      </label>
      {q.length >= 2 ? (
        <ul className="mt-2 max-w-md space-y-1.5" aria-label={resultsLabel}>
          {searching ? (
            <li className="text-[13px] text-warm-meta">Searching...</li>
          ) : results.length === 0 ? (
            <li className="rounded-xl bg-muted px-3 py-2.5 text-[13px] text-warm-secondary">
              No account matches that.{' '}
              {looksLikeEmail(q) ? (
                <button
                  type="button"
                  onClick={() => void add(q, 'typed')}
                  disabled={adding !== null}
                  className="inline-flex min-h-10 items-center font-bold text-brand-blue disabled:opacity-60"
                >
                  {adding === 'typed' ? 'Adding...' : `Try adding ${q} anyway`}
                </button>
              ) : (
                'Only people who have signed up on Shikshaq can be added.'
              )}
            </li>
          ) : (
            results.map((u) => (
              <li key={u.user_id} className="flex items-center justify-between gap-3 rounded-xl bg-muted px-3 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-[14px] font-semibold text-foreground">{u.full_name || 'Unnamed account'}</span>
                  <span className="block truncate text-[12px] text-warm-meta">{u.email ?? 'No email on file'}</span>
                </span>
                {isAlready(u) ? (
                  <span className="shrink-0 text-[12px] font-semibold text-warm-secondary">{alreadyLabel}</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => void add(u.email ?? '', u.user_id)}
                    disabled={adding !== null}
                    className={cn(adminPillClass('primary', 'sm'), 'shrink-0 bg-brand text-foreground disabled:opacity-50')}
                  >
                    <UserPlus className="h-4 w-4" aria-hidden />
                    {adding === u.user_id ? 'Adding...' : actionLabel(u)}
                  </button>
                )}
              </li>
            ))
          )}
        </ul>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-[13px] text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
