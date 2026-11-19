import { useState } from 'react';
import { AdminTeachersPage } from '@/pages/admin/teachers';
import { createFakeTeachersApi } from '@/dummy/admin-teachers-fake-api';
import { DummyBanner } from '@/dummy/DummyBanner';

/* /admin/teachers in dummy mode (D75): the real page against made-up
   teachers. Test builds only, reached solely through the PREVIEW_TOOLS-gated
   lazy import in admin/teachers.tsx. */

export default function AdminTeachersDummy() {
  const [api] = useState(createFakeTeachersApi);
  return <AdminTeachersPage api={api} dummy banner={<DummyBanner leaveTo="/admin/teachers?dummy=0" />} />;
}
