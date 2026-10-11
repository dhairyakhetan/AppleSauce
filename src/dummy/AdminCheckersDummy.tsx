import { useState } from 'react';
import { AdminCheckersPage } from '@/pages/admin/checkers';
import { createFakeCheckerAdminApi } from '@/dummy/checker-admin-fake-api';
import { createFakeHodAdminApi, createFakeHodApi } from '@/dummy/hod-fake-api';
import { createFakeTeacherReviewerAdminApi } from '@/dummy/teacher-review-fake-api';
import { setDummyMode } from '@/lib/dummy-mode';

/* /admin/checkers in dummy mode (D75): the real page against the in-memory
   fake, no sign-in and no real admin check. Test builds only, reached
   solely through the PREVIEW_TOOLS-gated lazy import in admin/checkers.tsx. */

export default function AdminCheckersDummy() {
  const [api] = useState(createFakeCheckerAdminApi);
  const [hodApi] = useState(createFakeHodAdminApi);
  const [profileApi] = useState(createFakeHodApi);
  const [reviewerApi] = useState(createFakeTeacherReviewerAdminApi);

  const banner = (
    <div
      role="region"
      aria-label="Dummy mode controls"
      className="mx-1.5 mb-3 flex flex-wrap items-center gap-2 rounded-2xl bg-fuchsia-950 px-3 py-2 text-[12px] text-fuchsia-100"
    >
      <span className="font-bold uppercase tracking-[0.08em]">Dummy mode, nothing is saved</span>
      <span className="text-fuchsia-200">
        Search "tar" or "meena" to find made-up people, or type nobody@example.com to see the "no account" message.
      </span>
      <button
        type="button"
        onClick={() => {
          setDummyMode(false);
          window.location.assign('/admin/checkers?dummy=0');
        }}
        className="ml-auto min-h-10 rounded-full bg-fuchsia-800 px-3 font-bold text-fuchsia-50 hover:bg-fuchsia-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        Leave dummy mode
      </button>
    </div>
  );

  return <AdminCheckersPage api={api} hodApi={hodApi} profileApi={profileApi} reviewerApi={reviewerApi} dummy banner={banner} />;
}
