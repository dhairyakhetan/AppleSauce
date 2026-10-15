import { useCallback, useEffect, useState } from 'react';
import { UserPlus } from 'lucide-react';
import type { GamesApi } from '@/lib/games/api';
import { looksLikeEmail } from '@/lib/email-shape';
import { ROLE_NAMES, type GamesRole, type Person } from '@/lib/games/rows';
import { cn } from '@/lib/utils';
import { btn, chip, offerUndo } from './helpers';
import { Picker, type PickerOption } from './Picker';
import { Empty, Loading } from './shared';

/* The games team: who may open the games pages, and what they may do there. Only emails on this list get in; signing
   in to Shikshaq doesn't add anyone. Admins add someone by email (they needn't have signed in yet), change a role, or
   take someone off; the moderator stays an admin and can't be removed. The database checks all of it. A change shows the
   next time the person opens or refreshes a games page. The page shows only what managing the list needs. */

const ROLE_HINT: Record<GamesRole, string> = {
  member: 'writes questions and sends them for approval',
  hod: 'also approves questions or sends them back',
  admin: 'also manages this list',
};
const ROLES: PickerOption[] = (['member', 'hod', 'admin'] as const).map((r) => ({ value: r, label: ROLE_NAMES[r] }));

export function Team({ api, me }: { api: GamesApi; me: string }) {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<GamesRole>('member');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const load = useCallback(() => api.loadPeople().then((p) => { setPeople(p); setError(''); }, (e: Error) => setError(e.message)), [api]);
  useEffect(() => { void load(); }, [load]);

  /** Runs a change, then shows the list as the database now has it. */
  const change = async (run: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setNote('');
    setError('');
    try {
      await run();
      setNote(done);
      await load();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    const mail = email.trim().toLowerCase();
    if (!looksLikeEmail(mail)) { setError("That doesn't look like an email address."); return; }
    if (await change(() => api.setPersonRole(mail, role), `${mail} is now on the games team as ${ROLE_NAMES[role]}.`)) setEmail('');
  };
  const remove = (p: Person) => {
    void change(() => api.removePerson(p.email), '').then((ok) => {
      if (ok) offerUndo(`${p.name ?? p.email} taken off the games team`, () => { void change(() => api.setPersonRole(p.email, p.role), ''); });
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-prose text-[14px] text-warm-secondary">
        A <b className="text-foreground">member</b> {ROLE_HINT.member}; an <b className="text-foreground">HoD</b> {ROLE_HINT.hod}; an <b className="text-foreground">admin</b> {ROLE_HINT.admin}.
      </p>

      <section aria-labelledby="add-h" className="flex flex-col gap-3 rounded-[24px] bg-muted p-4 sm:p-6">
        <h2 id="add-h" className="text-[15px] font-bold text-foreground">Add someone</h2>
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (email.trim()) void add(); }}>
          <label className="flex min-w-[220px] flex-1 flex-col gap-1">
            <span className="text-[12px] font-semibold text-warm-secondary">Their Google email</span>
            <input type="email" autoComplete="off" placeholder="name@example.com" value={email} onChange={(e) => { setEmail(e.target.value); setError(''); }}
              className="h-11 w-full rounded-full bg-card px-4 text-base text-foreground placeholder:text-warm-label outline-none ring-1 ring-border focus-visible:ring-2 focus-visible:ring-brand sm:text-sm" />
          </label>
          <div className="flex flex-col gap-1">
            <label htmlFor="add-role" className="text-[12px] font-semibold text-warm-secondary">Role</label>
            <Picker id="add-role" label="Role" value={role} options={ROLES} onPick={(r) => setRole(r as GamesRole)} />
          </div>
          <button type="submit" className={btn('brand')} disabled={!email.trim() || busy}><UserPlus aria-hidden /> Add</button>
        </form>
        {note && <p className="rounded-2xl bg-mint px-4 py-3 text-[14px] text-foreground" role="status">{note}</p>}
        {error && <p className="rounded-2xl bg-destructive/10 px-4 py-3 text-[14px] text-foreground" role="alert">{error}</p>}
      </section>

      <section aria-labelledby="team-h" className="flex flex-col gap-3">
        <h2 id="team-h" className="text-[15px] font-bold text-foreground">On the games team</h2>
        {!people ? (error ? null : <Loading label="Loading the team" />) : !people.length ? <Empty>Nobody is on the games team yet.</Empty> : (
          <ul className="flex flex-col gap-2">
            {people.map((p) => {
              const locked = p.email === me.toLowerCase() || p.moderator;
              return (
                <li key={p.email} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-muted px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-semibold text-foreground">{p.name ?? p.email}</p>
                    {p.name && <p className="truncate text-[12px] text-warm-meta">{p.email}</p>}
                  </div>
                  {locked ? (
                    <span className={cn('rounded-full px-3 py-1.5 text-[13px] font-semibold', p.role === 'admin' ? 'bg-brand-subtle text-brand-deep' : 'bg-card text-warm-secondary')}>
                      {ROLE_NAMES[p.role]} ({p.email === me.toLowerCase() ? 'you' : 'moderator'})
                    </span>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <Picker label={`Role for ${p.email}`} value={p.role} options={ROLES} disabled={busy}
                        onPick={(v) => { const r = v as GamesRole; if (r !== p.role) void change(() => api.setPersonRole(p.email, r), `${p.name ?? p.email} is now ${ROLE_NAMES[r]}.`); }} />
                      <button type="button" className={chip('card', 'text-destructive')} disabled={busy} onClick={() => remove(p)}>Remove</button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
