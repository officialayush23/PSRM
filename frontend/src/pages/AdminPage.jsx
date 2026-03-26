// src/pages/AdminPage.jsx
// The /admin route is used as a general "command center" entry point.
// For officials it shows the complaint queue.
// For admin/super_admin it redirects to their full dashboard.

import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import AppLayout from "../components/AppLayout";

export default function AdminPage() {
  const navigate = useNavigate();
  const user     = JSON.parse(localStorage.getItem("auth_user") || "{}");
  const role     = user.role;

  useEffect(() => {
    if (role === "admin" || role === "super_admin") {
      navigate("/dashboard", { replace: true });
    }
  }, [role, navigate]);

  if (role === "official") {
    return (
      <AppLayout title="Command Center">
        <div className="p-6 flex flex-col items-center justify-center min-h-[60vh] gap-5">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
            style={{ background: "rgba(56,189,248,0.12)" }}>
            <span className="material-symbols-outlined text-sky-400 text-3xl">admin_panel_settings</span>
          </div>
          <div className="text-center">
            <h2 className="font-black text-xl text-slate-800 mb-1">Official Command Center</h2>
            <p className="text-sm text-slate-500 mb-6 max-w-sm">
              Your full dashboard is at the main Dashboard page with all tabs —
              complaints, workflow, tasks, surveys, infra nodes and tenders.
            </p>
            <button
              onClick={() => navigate("/dashboard")}
              className="gbtn-sky px-6 py-3 rounded-xl font-bold text-sm flex items-center gap-2 mx-auto">
              <span className="material-symbols-outlined text-[18px]">dashboard</span>
              Go to Full Dashboard
            </button>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Admin">
      <div className="p-6 flex items-center justify-center min-h-[60vh]">
        <div className="text-center text-slate-600">
          <span className="material-symbols-outlined text-5xl block mb-2">admin_panel_settings</span>
          <p className="text-sm">Redirecting…</p>
        </div>
      </div>
    </AppLayout>
  );
}
