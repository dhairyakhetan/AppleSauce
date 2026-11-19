import { useState } from 'react';
import { AdminPaperApprovalPage } from '@/pages/admin/paper-approval';
import { sharedFakeApprovalApi, FIXTURE_NOW } from '@/dummy/approval-fake-api';
import { DummyBanner } from '@/dummy/DummyBanner';

/* One paper's approval review in dummy mode (D75). Made-up paper, made-up
   people; edits, restores and approvals change an in-memory copy only. Test
   builds only, reached solely through the PREVIEW_TOOLS-gated lazy import in
   admin/paper-approval.tsx. */

export default function AdminPaperApprovalDummy({ auditPaperId }: { auditPaperId: string }) {
  const [api] = useState(sharedFakeApprovalApi);
  return (
    <AdminPaperApprovalPage
      auditPaperId={auditPaperId}
      api={api}
      dummy
      now={FIXTURE_NOW}
      banner={<DummyBanner leaveTo="/admin/paper-approvals?dummy=0" />}
    />
  );
}
