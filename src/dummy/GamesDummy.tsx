import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { GamesPage } from '@/pages/Games';
import { createFakeGamesApi, DUMMY_ME } from '@/dummy/games-fake-api';
import { setDummyMode } from '@/lib/dummy-mode';
import type { RoleCheck } from '@/lib/games/rows';
import { cn } from '@/lib/utils';

/* /games in dummy mode (D75): the real games pages against made-up questions and a made-up team, with no sign-in.
   Switch which role "you" have to see what each person gets, including someone who isn't on the team. Test builds
   only, reached solely through the PREVIEW_TOOLS-gated lazy import in pages/Games.tsx. */

const ROLES: { role: RoleCheck; label: string }[] = [
  { role: 'admin', label: 'Admin' },
  { role: 'hod', label: 'HoD' },
  { role: 'member', label: 'Member' },
  { role: null, label: 'Not on the team' },
  { role: 'reauth', label: 'Signed in with a password' },
];
const PILL = 'min-h-9 rounded-full px-3 font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white';

export default function GamesDummy() {
  const [api] = useState(createFakeGamesApi);
  const [role, setRole] = useState<RoleCheck>(() => api.role());
  /** Bumped to start the page afresh (a new role, or "Start over"). */
  const [round, setRound] = useState(0);
  const { pathname } = useLocation();

  const become = (r: RoleCheck) => {
    api.setRole(r);
    setRole(r);
    setRound((n) => n + 1);
  };

  const banner = (
    <div role="region" aria-label="Dummy mode controls"
      className="mb-4 flex w-full flex-wrap items-center gap-2 rounded-2xl bg-fuchsia-950 px-3 py-2 text-[12px] text-fuchsia-100">
      <span className="font-bold uppercase tracking-[0.08em]">Dummy mode, nothing is saved</span>
      <span className="text-fuchsia-200">Viewing as</span>
      {ROLES.map((x) => (
        <button key={x.label} type="button" aria-pressed={role === x.role} onClick={() => become(x.role)}
          className={cn(PILL, role === x.role ? 'bg-white text-fuchsia-950' : 'bg-fuchsia-800 text-fuchsia-50 hover:bg-fuchsia-700')}>
          {x.label}
        </button>
      ))}
      <button type="button" onClick={() => { api.reset(); api.setRole(role); setRound((n) => n + 1); }}
        className={cn(PILL, 'bg-fuchsia-800 text-fuchsia-50 hover:bg-fuchsia-700')}>
        Start over
      </button>
      <button type="button" onClick={() => { setDummyMode(false); window.location.assign(`${pathname}?dummy=0`); }}
        className={cn(PILL, 'ml-auto bg-fuchsia-800 text-fuchsia-50 hover:bg-fuchsia-700')}>
        Leave dummy mode
      </button>
    </div>
  );

  return <GamesPage key={round} api={api} dummy banner={banner} me={DUMMY_ME} />;
}
