import { lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { BentoPanel, BentoStack } from '@/components/layout/PageContainer';
import { ApproveQuestions } from '@/components/games/ApproveQuestions';
import { btn } from '@/components/games/helpers';
import { LoadFailed } from '@/components/games/shared';
import { Team } from '@/components/games/Team';
import { TryGames } from '@/components/games/TryGames';
import { WriteQuestions, type Alerts } from '@/components/games/WriteQuestions';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useAuth } from '@/lib/auth-context';
import { isDummyMode } from '@/lib/dummy-mode';
import { realGamesApi, type GamesApi } from '@/lib/games/api';
import { ROLE_NAMES, type GamesRole, type ListChapter, type RoleCheck } from '@/lib/games/rows';
import { PREVIEW_TOOLS } from '@/lib/preview-tools';
import { cn } from '@/lib/utils';

/* /games: the games team's pages. People on the team write questions for the revision games, HoDs approve them, and
   everyone on the team can try the games made from the approved ones. Admins manage who is on the team.

     /games           Write questions   everyone on the team
     /games/approve   Approve questions HoDs and admins
     /games/play      Try the games     everyone on the team
     /games/team      Team              admins

   Only people on the team's list get in (the `games` schema decides, on every call). Everyone else gets a polite
   "not for you" page, and the account menu never shows them the link. A part stays mounted once opened, so the text in
   Write questions survives a trip to another part.

   In a test build with dummy mode on, the same page runs against an in-memory fake with no sign-in
   (src/dummy/GamesDummy.tsx). */

const DummyGames = PREVIEW_TOOLS ? lazy(() => import('@/dummy/GamesDummy')) : null;

export default function Games() {
  if (DummyGames && isDummyMode()) {
    return (
      <Suspense fallback={null}>
        <DummyGames />
      </Suspense>
    );
  }
  return <GamesPage api={realGamesApi} />;
}

type Part = 'write' | 'approve' | 'play' | 'team';
const GAMES_PARTS: { key: Part; path: string; label: string; may: (r: GamesRole) => boolean }[] = [
  { key: 'write', path: '/games', label: 'Write questions', may: () => true },
  { key: 'approve', path: '/games/approve', label: 'Approve questions', may: (r) => r !== 'member' },
  { key: 'play', path: '/games/play', label: 'Try the games', may: () => true },
  { key: 'team', path: '/games/team', label: 'Team', may: (r) => r === 'admin' },
];

/** The part an address is for; null for an address under /games that isn't one. */
function partOf(pathname: string): Part | null {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return GAMES_PARTS.find((x) => x.path === p)?.key ?? null;
}

function Shell({ banner, children }: { banner?: ReactNode; children: ReactNode }) {
  return (
    <BentoStack className="min-h-screen bg-muted">
      <BentoPanel fill="card" edge="top" className="mx-auto w-full max-w-6xl">
        {banner}
        {children}
      </BentoPanel>
    </BentoStack>
  );
}

function NotForYou({ banner, title, children }: { banner?: ReactNode; title: string; children: ReactNode }) {
  return (
    <Shell banner={banner}>
      <div className="mx-auto max-w-lg py-16 text-center">
        <h1 className="text-balance text-xl font-bold text-foreground">{title}</h1>
        <div className="mt-2 text-[14px] text-warm-secondary">{children}</div>
      </div>
    </Shell>
  );
}

export function GamesPage({ api, dummy = false, banner, me }: {
  api: GamesApi;
  dummy?: boolean;
  banner?: ReactNode;
  /** Dummy mode has no sign-in, so who "you" are is given here. */
  me?: { name: string; email: string };
}) {
  const { user, profile, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const part = partOf(pathname);
  const name = dummy ? me?.name ?? '' : profile?.full_name || String(user?.user_metadata?.full_name ?? user?.user_metadata?.name ?? '') || user?.email || '';
  const email = dummy ? me?.email ?? '' : user?.email ?? '';

  const [role, setRole] = useState<{ role?: RoleCheck; error?: string }>({});
  const [attempt, setAttempt] = useState(0);
  // by the account's id, not the user object: a refreshed sign-in is a new object, and asking again would blank the page
  const uid = user?.id ?? null;
  useEffect(() => {
    if (!dummy) {
      if (authLoading) return;
      if (!uid) {
        navigate('/auth?redirect=' + encodeURIComponent(pathname));
        return;
      }
    }
    let cancelled = false;
    api.myRole().then((r) => { if (!cancelled) setRole({ role: r }); }, (e: Error) => { if (!cancelled) setRole({ error: e.message }); });
    return () => { cancelled = true; };
    // the role is asked once per visit (and on "Try again"), not on every move between parts
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, authLoading, api, dummy, attempt]);
  /** On the team (their role), not on it (null), or signed in with a password, which doesn't prove the email. */
  const reauth = role.role === 'reauth';
  const r: GamesRole | null | undefined = role.role === 'reauth' ? null : role.role;

  // the fixed list of chapters and topics, for Write questions
  const [catalog, setCatalog] = useState<{ list?: ListChapter[]; error?: string }>({});
  const [catalogTry, setCatalogTry] = useState(0);
  useEffect(() => {
    if (!r) return;
    let current = true;
    setCatalog((c) => (c.error ? {} : c));
    api.loadCatalog().then((list) => { if (current) setCatalog({ list }); }, (e: Error) => { if (current) setCatalog({ error: e.message }); });
    return () => { current = false; };
  }, [api, r, catalogTry]);

  // the number waiting, on the Approve link (HoDs and admins)
  const [waiting, setWaiting] = useState(0);
  const recount = useCallback(() => { if (r && r !== 'member') api.waitingCount().then(setWaiting, () => {}); }, [api, r]);
  useEffect(recount, [recount]);

  // questions sent back to this person: loaded with the role, and again after each send
  const [alerts, setAlerts] = useState<Alerts>({});
  const [alertsTry, setAlertsTry] = useState(0);
  useEffect(() => {
    if (!r) { setAlerts({}); return; }
    let current = true;
    setAlerts((a) => ({ list: a.list }));
    api.mySentBack().then((list) => { if (current) setAlerts({ list }); }, (e: Error) => { if (current) setAlerts((a) => ({ list: a.list, error: e.message })); });
    return () => { current = false; };
  }, [api, r, alertsTry]);
  const seen = useCallback((ids: string[]) => {
    setAlerts((a) => ({ ...a, list: a.list?.map((x) => (ids.includes(x.id) ? { ...x, seen: true } : x)) }));
    api.markSentBackSeen(ids).catch(() => {});
  }, [api]);
  const sent = useCallback(() => { recount(); setAlertsTry((n) => n + 1); }, [recount]);
  const unseen = alerts.list?.filter((a) => !a.seen).length ?? 0;

  // a part stays mounted once opened
  const [opened, setOpened] = useState<Set<Part>>(new Set());
  const here = part && r && GAMES_PARTS.find((x) => x.key === part)!.may(r) ? part : null;
  useEffect(() => { if (here) setOpened((o) => (o.has(here) ? o : new Set(o).add(here))); }, [here]);

  const label = GAMES_PARTS.find((x) => x.key === part)?.label ?? 'Games team';
  usePageMeta(`${label} | Games team | Shikshaq`, 'The games team writes, checks and approves questions for the revision games.');

  if (!part) return <Navigate to="/games" replace />;

  if (role.error) {
    return (
      <Shell banner={banner}>
        <div className="mx-auto max-w-lg py-16">
          <LoadFailed what="Your access to the games team" error={role.error} onRetry={() => { setRole({}); setAttempt((n) => n + 1); }} />
        </div>
      </Shell>
    );
  }
  if ((!dummy && authLoading) || r === undefined) {
    return (
      <Shell banner={banner}>
        <div className="h-40 animate-pulse rounded-2xl bg-muted" role="status" aria-label="Loading the games team" />
      </Shell>
    );
  }
  if (reauth) {
    return (
      <NotForYou banner={banner} title="Sign in with Google to open the games team">
        <p>
          You signed in with a password. The games team's pages need a Google sign-in (or an email sign-in link), because
          that is what proves the email is yours. Only people on the team's list get in.
        </p>
        {dummy ? <p className="mt-3">In dummy mode, switch who you are in the bar above.</p> : (
          <button type="button" className={btn('dark', 'mt-5')}
            onClick={async () => { await signOut(); navigate('/auth?redirect=' + encodeURIComponent(pathname)); }}>
            Sign out, then sign in with Google
          </button>
        )}
      </NotForYou>
    );
  }
  if (r === null) {
    return (
      <NotForYou banner={banner} title="This page is for the games team">
        <p>Only people on the games team's list can open it. If you should have it, ask a games admin to add your Google email{email ? <> (you are signed in as <b className="text-foreground">{email}</b>)</> : null}, then sign in with Google.</p>
        <Link to="/" className={btn('quiet', 'mt-5')}>Back to the site</Link>
      </NotForYou>
    );
  }
  if (!here) {
    return (
      <NotForYou banner={banner} title={part === 'team' ? 'This part is for games admins' : 'This part is for HoDs and admins'}>
        <p>You are on the games team as {ROLE_NAMES[r]}, which can't open {label}. If you should have it, ask a games admin.</p>
        <Link to="/games" className={btn('quiet', 'mt-5')}>Go to Write questions</Link>
      </NotForYou>
    );
  }

  const parts: Record<Part, () => ReactNode> = {
    write: () => <WriteQuestions api={api} teacher={name} canApprove={r !== 'member'} alerts={alerts} onSeen={seen} onRetryAlerts={() => setAlertsTry((n) => n + 1)} onSent={sent} catalog={catalog} onRetryCatalog={() => setCatalogTry((n) => n + 1)} />,
    approve: () => <ApproveQuestions api={api} onWaiting={setWaiting} />,
    play: () => <TryGames api={api} />,
    team: () => <Team api={api} me={email} />,
  };

  return (
    <Shell banner={banner}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[12px] font-bold uppercase tracking-[0.08em] text-warm-secondary">Games team · {ROLE_NAMES[r]}</p>
          <h1 className="text-lg font-bold text-foreground">{label}</h1>
        </div>
        <nav aria-label="Games team" className="flex max-w-full flex-wrap items-center gap-1 rounded-[20px] bg-muted p-1 sm:rounded-full">
          {GAMES_PARTS.filter((x) => x.may(r)).map((x) => {
            const count = x.key === 'approve' ? waiting : x.key === 'write' ? unseen : 0;
            return (
              <Link key={x.key} to={x.path} aria-current={x.key === here ? 'page' : undefined}
                className={cn('flex h-10 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-bold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
                  x.key === here ? 'bg-card text-foreground' : 'text-warm-secondary hover:text-foreground')}>
                {x.label}
                {count > 0 && (
                  <span className="inline-flex h-[19px] min-w-[19px] items-center justify-center rounded-full bg-brand px-[5px] text-[11px] font-bold tabular-nums text-foreground"
                    aria-label={x.key === 'approve' ? `${count} waiting` : `${count} sent back to you`}>{count}</span>
                )}
              </Link>
            );
          })}
        </nav>
      </div>

      {[...opened].map((k) => (
        <div key={k} hidden={k !== here}>{parts[k]()}</div>
      ))}
    </Shell>
  );
}
