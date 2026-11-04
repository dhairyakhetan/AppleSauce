import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CheckerPage } from '@/pages/Checker';
import { createFakeCheckerApi, type DummySimulation } from '@/dummy/checker-fake-api';
import { setDummyMode } from '@/lib/dummy-mode';
import { AdminDebugContext } from '@/lib/admin-debug';
import { cn } from '@/lib/utils';

/* The checker in dummy mode (D75): the real CheckerPage against the
   in-memory fake, with no sign-in and nothing sent to Supabase. Test builds
   only; reached solely through the PREVIEW_TOOLS-gated lazy import in
   Checker.tsx. The strip on top says so, and lets the preview force the
   states a real checker hits (lease ran out, offline, slow, empty queue). */

const SIMULATIONS: { value: DummySimulation; label: string }[] = [
  { value: 'none', label: 'Normal' },
  { value: 'lease', label: 'Next save: lease ran out' },
  { value: 'stale', label: 'Next save: someone else changed it' },
  { value: 'offline', label: 'Offline' },
  { value: 'slow', label: 'Slow network' },
  { value: 'blank', label: 'Serve a blank question (old server)' },
  { value: 'nopages', label: 'Paper has no page pictures' },
];

export default function CheckerDummy() {
  const [api] = useState(createFakeCheckerApi);
  const [sim, setSim] = useState<DummySimulation>('none');
  // Previews the admin debug chips without an admin sign-in.
  const [debugOn, setDebugOn] = useState(false);
  const qc = useQueryClient();

  const refetchAll = () =>
    qc.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey.includes('dummy') });

  const choose = (value: DummySimulation) => {
    api.simulate = value;
    setSim(value);
    refetchAll();
  };

  const banner = (
    <div
      role="region"
      aria-label="Dummy mode controls"
      // One row that scrolls sideways, so the verify screen (one viewport, no page scroll) keeps its height.
      className="mb-2 flex w-full shrink-0 flex-nowrap items-center gap-2 overflow-x-auto whitespace-nowrap rounded-[18px] bg-fuchsia-950 px-3 py-1.5 text-[12px] text-fuchsia-100"
    >
      <span className="shrink-0 font-bold uppercase tracking-[0.08em]">Dummy mode, nothing is saved</span>
      <label className="flex shrink-0 items-center gap-1">
        Simulate
        <select
          value={sim}
          onChange={(e) => choose(e.target.value as DummySimulation)}
          className="min-h-8 rounded-lg bg-fuchsia-900 px-2 text-fuchsia-50"
        >
          {SIMULATIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <DummyButton
        onClick={() => {
          api.emptyQueue();
          refetchAll();
        }}
      >
        Empty the queue
      </DummyButton>
      <DummyButton
        onClick={() => {
          api.arrive();
        }}
      >
        A new question arrives
      </DummyButton>
      <DummyButton
        onClick={() => {
          api.reset();
          setSim('none');
          refetchAll();
        }}
      >
        Start over
      </DummyButton>
      <DummyButton onClick={() => setDebugOn((v) => !v)}>
        {debugOn ? 'Debug ids: on' : 'Debug ids: off'}
      </DummyButton>
      <DummyButton
        className="ml-auto"
        onClick={() => {
          setDummyMode(false);
          window.location.assign('/checker?dummy=0');
        }}
      >
        Leave dummy mode
      </DummyButton>
    </div>
  );

  return (
    <AdminDebugContext.Provider value={{ on: debugOn, canToggle: true, toggle: () => setDebugOn((v) => !v) }}>
      <CheckerPage api={api} dummy banner={banner} />
    </AdminDebugContext.Provider>
  );
}

function DummyButton({
  onClick,
  className,
  children,
}: {
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'min-h-8 shrink-0 rounded-full bg-fuchsia-800 px-3 font-bold text-fuchsia-50 hover:bg-fuchsia-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white',
        className,
      )}
    >
      {children}
    </button>
  );
}
