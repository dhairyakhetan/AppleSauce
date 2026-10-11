import { useState } from 'react';
import { AdminAuditPage } from '@/pages/admin/audit';
import { createFakeAuditApi } from '@/dummy/audit-fake-api';
import { DummyBanner } from '@/dummy/DummyBanner';

/* /admin/audit in dummy mode (D75): made-up admins and actions. Test builds
   only, reached solely through the PREVIEW_TOOLS-gated lazy import in
   admin/audit.tsx. ?audit=empty or ?audit=error reaches the other two states.
   No preview role is added: admin is never a preview role. */

export default function AdminAuditDummy() {
  const [api] = useState(() => {
    const m = new URLSearchParams(window.location.search).get('audit');
    return createFakeAuditApi(m === 'empty' || m === 'error' ? m : 'full');
  });
  return <AdminAuditPage api={api} dummy banner={<DummyBanner leaveTo="/admin/audit?dummy=0" />} />;
}
