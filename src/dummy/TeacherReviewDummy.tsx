import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { TeacherReviewPage } from '@/pages/TeacherReview';
import { createFakeTeacherReviewApi } from '@/dummy/teacher-review-fake-api';
import { setDummyMode } from '@/lib/dummy-mode';

/* /teacher-review in dummy mode (D75): the real page against made-up
   applications and teachers, with no sign-in. Test builds only, reached solely
   through the PREVIEW_TOOLS-gated lazy import in pages/TeacherReview.tsx. */

export default function TeacherReviewDummy() {
  const [api] = useState(createFakeTeacherReviewApi);
  const qc = useQueryClient();
  const button =
    'min-h-9 rounded-full bg-fuchsia-800 px-3 font-bold text-fuchsia-50 hover:bg-fuchsia-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white';

  const banner = (
    <div
      role="region"
      aria-label="Dummy mode controls"
      className="mb-3 flex w-full flex-wrap items-center gap-2 rounded-2xl bg-fuchsia-950 px-3 py-2 text-[12px] text-fuchsia-100"
    >
      <span className="font-bold uppercase tracking-[0.08em]">Dummy mode, nothing is saved</span>
      <button
        type="button"
        onClick={() => {
          api.reset();
          void qc.invalidateQueries({ queryKey: ['teacher-review', 'dummy'] });
        }}
        className={button}
      >
        Start over
      </button>
      <button
        type="button"
        onClick={() => {
          setDummyMode(false);
          window.location.assign('/teacher-review?dummy=0');
        }}
        className={`ml-auto ${button}`}
      >
        Leave dummy mode
      </button>
    </div>
  );

  return <TeacherReviewPage api={api} dummy banner={banner} />;
}
