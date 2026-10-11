import { useState } from 'react';
import { AdminPapersPage } from '@/pages/admin/papers';
import { createFakePapersApi } from '@/dummy/papers-fake-api';
import { DummyBanner } from '@/dummy/DummyBanner';

/* /admin/papers in dummy mode (D75): the real page against made-up student
   uploads and papers. Test builds only, reached solely through the
   PREVIEW_TOOLS-gated lazy import in admin/papers.tsx. */

export default function AdminPapersDummy() {
  const [api] = useState(createFakePapersApi);
  return <AdminPapersPage api={api} dummy banner={<DummyBanner leaveTo="/admin/papers?dummy=0" />} />;
}
