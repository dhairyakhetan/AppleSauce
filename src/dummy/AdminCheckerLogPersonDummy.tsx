import { useState } from 'react';
import { AdminCheckerLogPersonPage } from '@/pages/admin/checker-log-person';
import { sharedFakeCheckerLogApi } from '@/dummy/checker-log-fake-api';
import { FIXTURE_NOW } from '@/dummy/approval-fake-api';
import { DummyBanner } from '@/dummy/DummyBanner';

/* One checker's day-by-day log in dummy mode (D75). Made-up people and
   actions. Test builds only, reached solely through the PREVIEW_TOOLS-gated
   lazy import in admin/checker-log-person.tsx. */

export default function AdminCheckerLogPersonDummy({ actorKey }: { actorKey: string }) {
  const [api] = useState(sharedFakeCheckerLogApi);
  return (
    <AdminCheckerLogPersonPage
      actorKey={actorKey}
      api={api}
      dummy
      now={FIXTURE_NOW}
      banner={<DummyBanner leaveTo="/admin/checker-log?dummy=0" />}
    />
  );
}
