/* ------------------------------------------------------------------ */
/* Unknown /admin/* path — stays inside the console shell              */
/* ------------------------------------------------------------------ */
import { useLocation } from "react-router-dom";
import { AdminLayout, type AdminIdentity } from "../AdminLayout";
import { LinkBtn, Nothing, Panel } from "../components";

export function AdminNotFound({ identity }: { identity: AdminIdentity }) {
  const { pathname } = useLocation();
  return (
    <AdminLayout identity={identity} title="Not found" description={`No admin page is mounted at ${pathname}.`}>
      <Panel>
        <Nothing
          title="That admin page doesn't exist"
          description="Use the navigation on the left, or go back to the dashboard."
        />
        <div className="mt-3 flex justify-center">
          <LinkBtn to="/admin" variant="primary">
            Back to the dashboard
          </LinkBtn>
        </div>
      </Panel>
    </AdminLayout>
  );
}
