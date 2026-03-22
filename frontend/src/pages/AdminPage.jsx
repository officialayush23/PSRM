// src/pages/AdminPage.jsx
// The /admin route is used as a general "command center" entry point.
// For officials it shows the complaint queue.
// For admin/super_admin it redirects to their full dashboard.
// This replaces the old "under development" placeholder.

import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import AppLayout from "../components/AppLayout";

export default function AdminPage() {
  const navigate  = useNavigate();
  const user      = JSON.parse(localStorage.getItem("auth_user") || "{}");
  const role      = user.role;

  // Admins and super_admins are better served by their full dashboard
  // Officials land here from SideNav — their dashboard IS /dashboard
  useEffect(() => {
    if (role === "admin" || role === "super_admin") {
      navigate("/dashboard", { replace: true });
    }
  }, [role, navigate]);

  // Officials see a brief redirect to their dashboard
  if (role === "official") {
    return (
      <AppLayout title="Command Center">
        <div className="p-6 flex flex-col items-center justify-center min-h-[60vh] gap-5">
          <div className="w-16 h-16 rounded-2xl bg-sky-50 flex items-center justify-center">
            <span className="material-symbols-outlined text-sky-600 text-3xl">admin_panel_settings</span>
          </div>
          <div className="text-center">
            <h2 className="font-black text-xl text-slate-900 mb-1">Official Command Center</h2>
            <p className="text-sm text-slate-500 mb-6">
              Your full dashboard is at the main Dashboard page with all tabs —
              complaints, workflow, tasks, surveys, infra nodes and tenders.
            </p>
            <button
              onClick={() => navigate("/dashboard")}
              className="bg-sky-600 text-white px-6 py-3 rounded-xl font-bold text-sm hover:bg-sky-700 transition flex items-center gap-2 mx-auto"
            >
              <span className="material-symbols-outlined text-[18px]">dashboard</span>
              Go to Full Dashboard
            </button>
          </div>
        </div>
      </AppLayout>
    );
  }

  // Fallback for any other role that reaches /admin (shouldn't happen — ProtectedRoute guards it)
  return (
    <AppLayout title="Admin">
      <div className="p-6 flex items-center justify-center min-h-[60vh]">
        <div className="text-center text-slate-400">
          <span className="material-symbols-outlined text-5xl block mb-2">admin_panel_settings</span>
          <p className="text-sm">Redirecting…</p>
        </div>
      </div>
    </AppLayout>
  );
}