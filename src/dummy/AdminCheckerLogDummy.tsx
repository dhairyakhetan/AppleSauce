import { useState } from 'react';
import { AdminCheckerLogPage } from '@/pages/admin/checker-log';
import { sharedFakeCheckerLogApi } from '@/dummy/checker-log-fake-api';
import { DummyBanner } from '@/dummy/DummyBanner';

/* /admin/checker-log in dummy mode (D75): made-up people and actions. Test
   builds only, reached solely through the PREVIEW_TOOLS-gated lazy import in
   admin/checker-log.tsx. */

export default function AdminCheckerLogDummy() {
  const [api] = useState(sharedFakeCheckerLogApi);
  return <AdminCheckerLogPage api={api} dummy banner={<DummyBanner leaveTo="/admin/checker-log?dummy=0" />} />;
}
