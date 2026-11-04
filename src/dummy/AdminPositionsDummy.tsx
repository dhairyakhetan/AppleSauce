import { useState } from 'react';
import { AdminPositionsPage } from '@/pages/admin/positions';
import { createFakePositionsApi } from '@/dummy/positions-fake-api';
import { setDummyMode } from '@/lib/dummy-mode';

/* The Positions section in dummy mode: the real page against an in-memory fake,
   no sign-in and no real admin check. Test builds only, reached solely through
   the PREVIEW_TOOLS-gated lazy import in admin/positions.tsx. */

export default function AdminPositionsDummy() {
  const [api] = useState(createFakePositionsApi);

  const banner = (
    <div
      role="region"
      aria-label="Dummy mode controls"
      className="mx-1.5 mb-3 flex flex-wrap items-center gap-2 rounded-2xl bg-fuchsia-950 px-3 py-2 text-[12px] text-fuchsia-100"
    >
      <span className="font-bold uppercase tracking-[0.08em]">Dummy mode, nothing is saved</span>
      <span className="text-fuchsia-200">
        Add any new email to see a pending grant, or meena.roy@example.com to see one apply at once. You are admin@example.com and owner@example.com is the owner.
      </span>
      <button
        type="button"
        onClick={() => {
          setDummyMode(false);
          window.location.assign('/admin?tab=people&section=positions&dummy=0');
        }}
        className="ml-auto min-h-10 rounded-full bg-fuchsia-800 px-3 font-bold text-fuchsia-50 hover:bg-fuchsia-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        Leave dummy mode
      </button>
    </div>
  );

  return <AdminPositionsPage api={api} dummy banner={banner} />;
}
