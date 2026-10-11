import { useState } from 'react';
import { AdminLibraryPage } from '@/pages/admin/library';
import { createFakeLibraryApi } from '@/dummy/library-fake-api';
import { DummyBanner } from '@/dummy/DummyBanner';

/* /admin/library in dummy mode (D75): the real page against made-up papers.
   Test builds only, reached solely through the PREVIEW_TOOLS-gated lazy
   import in admin/library.tsx. */

export default function AdminLibraryDummy() {
  const [api] = useState(createFakeLibraryApi);
  return <AdminLibraryPage api={api} dummy banner={<DummyBanner leaveTo="/admin/library?dummy=0" />} />;
}
