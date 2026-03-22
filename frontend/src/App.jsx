import { Navigate, Route, Routes } from "react-router-dom";
import { useAuthState } from "react-firebase-hooks/auth";
import { auth } from "./firebase";

import AdminPage           from "./pages/AdminPage";
import ComplaintStatusPage from "./pages/ComplaintStatusPage";
import DashboardPage       from "./pages/DashboardPage";
import LoginPage           from "./pages/LoginPage";
import MyComplaintsPage    from "./pages/MyComplaintsPage";
import NotificationsPage   from "./pages/NotificationsPage";
import ProfilePage         from "./pages/ProfilePage";
import PublicMapPage       from "./pages/PublicMapPage";
import SignupPage          from "./pages/SignupPage";
import SubmitComplaintPage from "./pages/SubmitComplaintPage";

function ProtectedRoute({ children }) {
  const [user, loading] = useAuthState(auth);
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center text-on-surface-variant">
      <span className="material-symbols-outlined animate-spin text-4xl">progress_activity</span>
    </div>
  );
  return user ? children : <Navigate to="/login" replace />;
}

function RoleRouter() {
  const user = JSON.parse(localStorage.getItem("auth_user") || "{}");
  const role = user.role;
 
  if (role === "super_admin" || role === "admin") {
    return <AdminDashboardPage />;
  }
  if (role === "official") {
    return <OfficialDashboardPage />;
  }
  if (role === "worker" || role === "contractor") {
    return <WorkerDashboardPage />;
  }
  // citizen default
  return <DashboardPage />;
}


export default function App() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/"     element={<Navigate to="/login" replace />} />
      <Route path="/login"  element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/map"    element={<PublicMapPage />} />

      {/* Protected */}
      <Route path="/dashboard"      element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
      <Route path="/submit"         element={<ProtectedRoute><SubmitComplaintPage /></ProtectedRoute>} />
      <Route path="/complaints/:id" element={<ProtectedRoute><ComplaintStatusPage /></ProtectedRoute>} />
      <Route path="/my-complaints"  element={<ProtectedRoute><MyComplaintsPage /></ProtectedRoute>} />
      <Route path="/notifications"  element={<ProtectedRoute><NotificationsPage /></ProtectedRoute>} />
      <Route path="/profile"        element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
      <Route path="/admin"          element={<ProtectedRoute><AdminPage /></ProtectedRoute>} />
    </Routes>
  );
}