import { AdminTeamPage } from '@/pages/admin/team';
import { dummyTeamDashboardApi } from '@/dummy/team-dashboard-fake-api';
import { DummyBanner } from '@/dummy/DummyBanner';

/** Dummy-mode wrapper for /admin/team?dummy=1 (D75). No sign-in, no real
 *  admin check, the in-memory fake API above. */
export default function AdminTeamDummy() {
  return (
    <AdminTeamPage
      api={dummyTeamDashboardApi}
      dummy
      banner={
        <DummyBanner leaveTo="/admin/team?dummy=0">
          Look up the question id &quot;fail&quot; or &quot;empty&quot; to see those states.
        </DummyBanner>
      }
    />
  );
}
