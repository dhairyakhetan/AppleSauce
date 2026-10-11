import { useState } from 'react';
import { AdminApprovalsPage } from '@/pages/admin/approvals';
import { createFakeApprovalsApi } from '@/dummy/admin-approvals-fake-api';
import { DummyBanner } from '@/dummy/DummyBanner';

/* /admin/approvals in dummy mode (D75): the real page against made-up
   applications. Test builds only, reached solely through the PREVIEW_TOOLS-gated
   lazy import in admin/approvals.tsx. */

export default function AdminApprovalsDummy() {
  const [api] = useState(createFakeApprovalsApi);
  return <AdminApprovalsPage api={api} dummy banner={<DummyBanner leaveTo="/admin/approvals?dummy=0" />} />;
}
