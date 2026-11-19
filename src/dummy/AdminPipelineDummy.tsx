import { useState } from 'react';
import { AdminPipelinePage } from '@/pages/admin/pipeline';
import { createFakePipelineApi } from '@/dummy/pipeline-fake-api';
import { createFakePaperRegistryApi } from '@/dummy/paper-registry-fake-api';
import { createFakePipelineRouteApi } from '@/dummy/pipeline-route-fake-api';
import { setDummyMode } from '@/lib/dummy-mode';

/* /admin/pipeline in dummy mode (D75): the real page against made-up
   numbers, no sign-in and no real admin check. Test builds only, reached
   solely through the PREVIEW_TOOLS-gated lazy import in admin/pipeline.tsx. */

export default function AdminPipelineDummy() {
  // ?stats=error reaches the stats panels' error state.
  const [api] = useState(() => createFakePipelineApi(new URLSearchParams(window.location.search).get('stats') === 'error' ? 'error' : 'full'));
  // ?registry=empty or ?registry=error reaches the other two panel states.
  const [registryApi] = useState(() => {
    const m = new URLSearchParams(window.location.search).get('registry');
    return createFakePaperRegistryApi(m === 'empty' || m === 'error' ? m : 'full');
  });

  // ?route=error, flaky (every third read fails), empty, unsynced (picture and PDF numbers not sent) or stale (last sync four days ago) reach the route's other states.
  const [routeApi] = useState(() => {
    const m = new URLSearchParams(window.location.search).get('route');
    return createFakePipelineRouteApi(
      m === 'error' || m === 'flaky' || m === 'empty' || m === 'unsynced' || m === 'stale' ? m : 'full',
    );
  });

  const banner = (
    <div
      role="region"
      aria-label="Dummy mode controls"
      className="mx-1.5 mb-3 flex flex-wrap items-center gap-2 rounded-2xl bg-fuchsia-950 px-3 py-2 text-[12px] text-fuchsia-100"
    >
      <span className="font-bold uppercase tracking-[0.08em]">Dummy mode, nothing is saved</span>
      <button
        type="button"
        onClick={() => {
          setDummyMode(false);
          window.location.assign('/admin/pipeline?dummy=0');
        }}
        className="ml-auto min-h-9 rounded-full bg-fuchsia-800 px-3 font-bold text-fuchsia-50 hover:bg-fuchsia-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        Leave dummy mode
      </button>
    </div>
  );

  return <AdminPipelinePage api={api} registryApi={registryApi} routeApi={routeApi} dummy banner={banner} />;
}
