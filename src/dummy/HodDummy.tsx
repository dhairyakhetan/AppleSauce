import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { HodPage } from '@/pages/Hod';
import { createFakeHodApi } from '@/dummy/hod-fake-api';
import { createFakeTeacherReviewerAdminApi } from '@/dummy/teacher-review-fake-api';
import { setDummyMode } from '@/lib/dummy-mode';

/* /hod in dummy mode (D75): the real HodPage against made-up checkers, papers
   and questions, with no sign-in. Test builds only, reached solely through the
   PREVIEW_TOOLS-gated lazy import in pages/Hod.tsx. */

export default function HodDummy() {
  const [api] = useState(createFakeHodApi);
  const [reviewerApi] = useState(createFakeTeacherReviewerAdminApi);
  const [admin, setAdmin] = useState(true);
  const qc = useQueryClient();

  const banner = (
    <div
      role="region"
      aria-label="Dummy mode controls"
      className="mb-3 flex w-full flex-wrap items-center gap-2 rounded-2xl bg-fuchsia-950 px-3 py-2 text-[12px] text-fuchsia-100"
    >
      <span className="font-bold uppercase tracking-[0.08em]">Dummy mode, nothing is saved</span>
      <button
        type="button"
        onClick={() => setAdmin((v) => !v)}
        className="min-h-9 rounded-full bg-fuchsia-800 px-3 font-bold text-fuchsia-50 hover:bg-fuchsia-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        {admin ? 'Viewing as admin (can switch trust)' : 'Viewing as HOD (status only)'}
      </button>
      <button
        type="button"
        onClick={() => {
          api.reset();
          void qc.invalidateQueries({ queryKey: ['hod', 'dummy'] });
        }}
        className="min-h-9 rounded-full bg-fuchsia-800 px-3 font-bold text-fuchsia-50 hover:bg-fuchsia-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        Start over
      </button>
      <button
        type="button"
        onClick={() => {
          setDummyMode(false);
          window.location.assign('/hod?dummy=0');
        }}
        className="ml-auto min-h-9 rounded-full bg-fuchsia-800 px-3 font-bold text-fuchsia-50 hover:bg-fuchsia-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        Leave dummy mode
      </button>
    </div>
  );

  return <HodPage api={api} dummy banner={banner} dummyRoles={{ isAdmin: admin, isChecker: true }} reviewerApi={reviewerApi} />;
}
