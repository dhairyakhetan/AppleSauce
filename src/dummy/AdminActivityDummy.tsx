import { useState } from 'react';
import { AdminActivityPage } from '@/pages/admin/activity';
import { createFakeActivityApi } from '@/dummy/activity-fake-api';
import { AdminDebugContext } from '@/lib/admin-debug';
import { setDummyMode } from '@/lib/dummy-mode';

/** Dummy-mode wrapper for /admin/activity?dummy=1 (D75): the real page
 *  against the in-memory fake, no sign-in, nothing sent to Supabase. Test
 *  builds only, reached solely through the PREVIEW_TOOLS-gated lazy import
 *  in admin/activity.tsx. */
export default function AdminActivityDummy() {
  const [api] = useState(createFakeActivityApi);
  const [debugOn, setDebugOn] = useState(false);
  const [key, setKey] = useState(0);

  const banner = (
    <div
      role="region"
      aria-label="Dummy mode controls"
      className="flex w-full flex-wrap items-center gap-2 rounded-2xl bg-fuchsia-950 px-3 py-2 text-[12px] text-fuchsia-100"
    >
      <span className="font-bold uppercase tracking-[0.08em]">Dummy mode, nothing is saved</span>
      <button
        type="button"
        onClick={() => setDebugOn((v) => !v)}
        className="min-h-9 rounded-full bg-fuchsia-800 px-3 font-bold text-fuchsia-50"
      >
        {debugOn ? 'Admin debug chips: on' : 'Admin debug chips: off'}
      </button>
      <button
        type="button"
        onClick={() => {
          api.reset();
          setKey((k) => k + 1);
        }}
        className="min-h-9 rounded-full bg-fuchsia-800 px-3 font-bold text-fuchsia-50"
      >
        Start over
      </button>
      <button
        type="button"
        onClick={() => {
          setDummyMode(false);
          window.location.assign('/admin/activity?dummy=0');
        }}
        className="ml-auto min-h-9 rounded-full bg-fuchsia-800 px-3 font-bold text-fuchsia-50"
      >
        Leave dummy mode
      </button>
    </div>
  );

  return (
    <AdminDebugContext.Provider value={{ on: debugOn, canToggle: true, toggle: () => setDebugOn((v) => !v) }}>
      <AdminActivityPage key={key} api={api} dummy banner={banner} />
    </AdminDebugContext.Provider>
  );
}
