// src/App.jsx
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuthState } from "react-firebase-hooks/auth";
import { auth } from "./firebase";

// Public / citizen pages
import AdminPage            from "./pages/AdminPage";
import ComplaintStatusPage  from "./pages/ComplaintStatusPage";
import DashboardPage        from "./pages/DashboardPage";
import LoginPage            from "./pages/LoginPage";
import MyComplaintsPage     from "./pages/MyComplaintsPage";
import NotificationsPage    from "./pages/NotificationsPage";
import ProfilePage          from "./pages/ProfilePage";
import PublicMapPage        from "./pages/PublicMapPage";
import SignupPage           from "./pages/SignupPage";
import SubmitComplaintPage  from "./pages/SubmitComplaintPage";
import SurveyPage           from "./pages/SurveyPage";
import InfraNodeDetailPage  from "./pages/InfraNodeDetailPage";

// Role-specific dashboards
import OfficialDashboardPage from "./pages/admin/OfficialDashboardPage";
import AdminDashboardPage    from "./pages/admin/AdminDashboardPage";
import WorkerDashboardPage   from "./pages/admin/WorkerDashboardPage";   
import UserManagementPage    from "./pages/admin/UserManagementPage";

// ── Auth guard ────────────────────────────────────────────────────

function ProtectedRoute({ children, roles }) {
  const [user, loading] = useAuthState(auth);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-on-surface-variant">
        <span className="material-symbols-outlined animate-spin text-4xl">progress_activity</span>
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  if (roles) {
    const stored = JSON.parse(localStorage.getItem("auth_user") || "{}");
    if (!roles.includes(stored.role)) {
      return <Navigate to="/dashboard" replace />;
    }
  }

  return children;
}

// ── Role-aware dashboard router ───────────────────────────────────

function RoleBasedDashboard() {
  const stored = JSON.parse(localStorage.getItem("auth_user") || "{}");
  const role   = stored.role;

  if (role === "super_admin" || role === "admin") return <AdminDashboardPage />;
  if (role === "official")                        return <OfficialDashboardPage />;
  if (role === "worker" || role === "contractor") return <WorkerDashboardPage />;
  return <DashboardPage />;
}

// ── Routes ────────────────────────────────────────────────────────

export default function App() {
  return (
    <Routes>
      {/* ── Public ── */}
      <Route path="/"       element={<Navigate to="/login" replace />} />
      <Route path="/login"  element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/map"    element={<PublicMapPage />} />

      {/* Survey accessible via notification link; API enforces auth */}
      <Route path="/survey/:surveyInstanceId" element={<SurveyPage />} />

      {/* Infra node detail — accessible to admin roles */}
      <Route
        path="/infra-nodes/:nodeId"
        element={
          <ProtectedRoute roles={["admin", "super_admin", "official"]}>
            <InfraNodeDetailPage />
          </ProtectedRoute>
        }
      />

      {/* ── Role-based dashboard ── */}
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <RoleBasedDashboard />
          </ProtectedRoute>
        }
      />

      {/* ── Citizen routes ── */}
      <Route path="/submit"         element={<ProtectedRoute><SubmitComplaintPage /></ProtectedRoute>} />
      <Route path="/complaints/:id" element={<ProtectedRoute><ComplaintStatusPage /></ProtectedRoute>} />
      <Route path="/my-complaints"  element={<ProtectedRoute><MyComplaintsPage /></ProtectedRoute>} />
      <Route path="/notifications"  element={<ProtectedRoute><NotificationsPage /></ProtectedRoute>} />
      <Route path="/profile"        element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />

      {/* ── Admin / Official routes ── */}
      <Route
        path="/admin"
        element={
          <ProtectedRoute roles={["admin", "super_admin", "official"]}>
            <AdminPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/complaints/:id"
        element={
          <ProtectedRoute roles={["admin", "super_admin", "official"]}>
            <ComplaintStatusPage />
          </ProtectedRoute>
        }
      />

      {/* ── User Management (super_admin + admin) ── */}
      <Route
        path="/admin/users"
        element={
          <ProtectedRoute roles={["super_admin", "admin"]}>
            <UserManagementPage />
          </ProtectedRoute>
        }
      />

      {/* Catch-all */}
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}