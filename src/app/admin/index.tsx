/* ------------------------------------------------------------------ */
/* Admin console — route tree                                          */
/*                                                                     */
/* Mounted once at /admin/* in src/App.tsx. The gate runs before any   */
/* page renders, and the server re-checks authorization on every API   */
/* call behind these pages, so a direct URL, a refresh or a bookmark   */
/* all end up at the same server-side decision.                        */
/* ------------------------------------------------------------------ */
import { Route, Routes } from "react-router-dom";
import { AdminGate } from "./AdminLayout";
import { AdminDashboard } from "./pages/Dashboard";
import { AdminUsers } from "./pages/Users";
import { AdminUserDetail } from "./pages/UserDetail";
import { AdminWorkspaces } from "./pages/Workspaces";
import { AdminWorkspaceDetail } from "./pages/WorkspaceDetail";
import { AdminBilling } from "./pages/Billing";
import { AdminPlans } from "./pages/Plans";
import { AdminSearches } from "./pages/Searches";
import { AdminLeads } from "./pages/Leads";
import { AdminUsage } from "./pages/Usage";
import { AdminAi } from "./pages/Ai";
import { AdminWebhooks } from "./pages/Webhooks";
import { AdminAuditLogs } from "./pages/AuditLogs";
import { AdminSystem } from "./pages/System";
import { AdminSettings } from "./pages/Settings";
import { AdminNotFound } from "./pages/NotFound";

export function AdminRoutes() {
  return (
    <AdminGate>
      {(identity) => (
        <Routes>
          <Route index element={<AdminDashboard identity={identity} />} />
          <Route path="users" element={<AdminUsers identity={identity} />} />
          <Route path="users/:id" element={<AdminUserDetail identity={identity} />} />
          <Route path="workspaces" element={<AdminWorkspaces identity={identity} />} />
          <Route path="workspaces/:id" element={<AdminWorkspaceDetail identity={identity} />} />
          <Route path="billing" element={<AdminBilling identity={identity} />} />
          <Route path="plans" element={<AdminPlans identity={identity} />} />
          <Route path="searches" element={<AdminSearches identity={identity} />} />
          <Route path="leads" element={<AdminLeads identity={identity} />} />
          <Route path="usage" element={<AdminUsage identity={identity} />} />
          <Route path="ai" element={<AdminAi identity={identity} />} />
          <Route path="webhooks" element={<AdminWebhooks identity={identity} />} />
          <Route path="audit-logs" element={<AdminAuditLogs identity={identity} />} />
          <Route path="system" element={<AdminSystem identity={identity} />} />
          <Route path="settings" element={<AdminSettings identity={identity} />} />
          <Route path="*" element={<AdminNotFound identity={identity} />} />
        </Routes>
      )}
    </AdminGate>
  );
}

export default AdminRoutes;
