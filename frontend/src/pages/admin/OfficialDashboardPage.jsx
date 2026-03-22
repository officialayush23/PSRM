// src/pages/admin/OfficialDashboardPage.jsx
// Official's workspace: complaint queue + workflow assignment + task management

import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import AppLayout from "../../components/AppLayout";
import CRMAgentChat from "../../components/CRMAgentChat";
import { fetchAdminKPI, fetchDailyBriefing, fetchComplaintQueue, fetchWorkerTasks } from "../../api/adminApi";
import { toast } from "sonner";

const PRIORITY_COLOR = {
  normal: "#6366f1", high: "#f97316", critical: "#ef4444", emergency: "#dc2626",
};

const STATUS_COLOR = {
  received: "#818cf8", workflow_started: "#38bdf8", in_progress: "#fb923c",
  resolved: "#34d399", rejected: "#f87171", escalated: "#ef4444",
};

function StatPill({ label, value, color, loading }) {
  return (
    <div className="flex flex-col items-center gap-1 p-4 rounded-2xl border bg-surface-container-low"
      style={{ borderColor: color + "30" }}>
      <span className="text-2xl font-headline font-bold" style={{ color }}>
        {loading ? "…" : value ?? 0}
      </span>
      <span className="text-xs text-on-surface-variant">{label}</span>
    </div>
  );
}

export default function OfficialDashboardPage() {
  const navigate  = useNavigate();
  const user      = JSON.parse(localStorage.getItem("auth_user") || "{}");

  const [loading,     setLoading]     = useState(true);
  const [kpi,         setKpi]         = useState(null);
  const [briefing,    setBriefing]    = useState(null);
  const [complaints,  setComplaints]  = useState([]);
  const [tasks,       setTasks]       = useState([]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [kpiData, briefingData, queueData, taskData] = await Promise.all([
          fetchAdminKPI(),
          fetchDailyBriefing(),
          fetchComplaintQueue({ limit: 15 }),
          fetchWorkerTasks("assigned"),
        ]);
        setKpi(kpiData);
        setBriefing(briefingData);
        setComplaints(queueData.items || []);
        setTasks(taskData.items || []);
      } catch {
        toast.error("Failed to load dashboard");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const needsWorkflow = complaints.filter(c => !c.workflow_instance_id && c.status === "received");
  const inProgress    = complaints.filter(c => c.status === "in_progress" || c.status === "workflow_started");
  const critical      = complaints.filter(c => ["critical", "emergency"].includes(c.priority));

  return (
    <AppLayout>
      <div className="flex flex-col gap-6 p-6">

        {/* Header */}
        <div>
          <h1 className="text-2xl font-headline font-bold text-on-surface">
            Good Morning, {user.full_name?.split(" ")[0]} 🙏
          </h1>
          <p className="text-sm text-on-surface-variant mt-0.5">
            Official Dashboard · {new Date().toLocaleDateString("en-IN", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
          </p>
        </div>

        {/* AI Briefing */}
        {briefing?.greeting && (
          <div className="bg-gradient-to-br from-primary/8 to-transparent rounded-2xl p-5 border border-primary/15">
            <div className="flex gap-3">
              <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center flex-shrink-0">
                <span className="material-symbols-outlined text-white text-[18px]">smart_toy</span>
              </div>
              <div>
                <p className="text-[11px] font-bold text-primary uppercase tracking-wider mb-1">Agent Briefing</p>
                <p className="text-sm text-on-surface leading-relaxed">{briefing.greeting}</p>
              </div>
            </div>
          </div>
        )}

        {/* Quick stats */}
        <div className="grid grid-cols-4 gap-3">
          <StatPill label="Open Complaints" value={kpi?.summary?.open_complaints}  color="#6366f1" loading={loading} />
          <StatPill label="Needs Workflow"  value={needsWorkflow.length}           color="#f97316" loading={loading} />
          <StatPill label="Critical"        value={kpi?.summary?.critical_count}   color="#ef4444" loading={loading} />
          <StatPill label="Tasks Assigned"  value={tasks.length}                   color="#10b981" loading={loading} />
        </div>

        <div className="flex flex-col lg:flex-row gap-6">

          {/* Left: Needs workflow */}
          <div className="lg:w-[50%] flex flex-col gap-4">

            {/* Critical alerts */}
            {critical.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
                <p className="text-sm font-bold text-red-700 mb-2 flex items-center gap-1">
                  <span className="material-symbols-outlined text-[16px]">emergency</span>
                  {critical.length} Critical/Emergency Complaint{critical.length !== 1 ? "s" : ""} — Act Now
                </p>
                {critical.slice(0, 3).map(c => (
                  <div key={c.id} onClick={() => navigate(`/admin/complaints/${c.id}`)}
                    className="flex items-center gap-2 py-1.5 border-b border-red-100 last:border-0 cursor-pointer hover:text-red-700">
                    <span className="text-xs font-mono text-red-400">#{c.complaint_number}</span>
                    <span className="text-sm text-red-800 flex-1 truncate">{c.title}</span>
                    <span className="text-xs px-2 py-0.5 bg-red-100 text-red-700 rounded-full font-bold capitalize">{c.priority}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Needs workflow assignment */}
            <div className="bg-surface-container-low rounded-2xl p-5 border border-orange-200">
              <h3 className="font-headline font-semibold text-on-surface mb-3 flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px] text-orange-500">assignment_late</span>
                Needs Workflow Assignment ({needsWorkflow.length})
              </h3>
              <div className="flex flex-col gap-2 max-h-64 overflow-y-auto">
                {loading ? (
                  Array(4).fill(0).map((_, i) => <div key={i} className="h-12 rounded-xl bg-outline-variant/20 animate-pulse" />)
                ) : needsWorkflow.length === 0 ? (
                  <p className="text-sm text-green-600 text-center py-4">✓ All complaints have workflows assigned</p>
                ) : needsWorkflow.map(c => (
                  <div key={c.id} onClick={() => navigate(`/admin/complaints/${c.id}`)}
                    className="flex items-center gap-3 p-3 rounded-xl bg-orange-50 border border-orange-100 cursor-pointer hover:bg-orange-100 transition">
                    <span className="text-xs font-mono text-orange-400 w-24 flex-shrink-0">#{c.complaint_number}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-on-surface truncate">{c.title}</p>
                      <p className="text-xs text-on-surface-variant truncate">{c.address_text}</p>
                    </div>
                    <span className="text-orange-600 text-xs font-bold flex-shrink-0">Assign →</span>
                  </div>
                ))}
              </div>
            </div>

            {/* In progress */}
            <div className="bg-surface-container-low rounded-2xl p-5 border border-outline-variant">
              <h3 className="font-headline font-semibold text-on-surface mb-3 flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px] text-primary">pending</span>
                In Progress ({inProgress.length})
              </h3>
              <div className="flex flex-col gap-2 max-h-48 overflow-y-auto">
                {inProgress.map(c => (
                  <div key={c.id} onClick={() => navigate(`/admin/complaints/${c.id}`)}
                    className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-surface-container transition cursor-pointer">
                    <div className="w-2 h-2 rounded-full bg-orange-400 flex-shrink-0" />
                    <span className="text-xs font-mono text-on-surface-variant">#{c.complaint_number}</span>
                    <span className="text-sm text-on-surface truncate flex-1">{c.title}</span>
                    <span className="text-xs text-on-surface-variant">{c.infra_type_code}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right: Tasks + survey alerts */}
          <div className="lg:w-[50%] flex flex-col gap-4">

            {/* Assigned tasks */}
            <div className="bg-surface-container-low rounded-2xl p-5 border border-outline-variant">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-headline font-semibold text-on-surface flex items-center gap-2">
                  <span className="material-symbols-outlined text-[18px] text-primary">task</span>
                  Active Tasks ({tasks.length})
                </h3>
                <Link to="/admin/tasks" className="text-primary text-xs hover:underline">View all →</Link>
              </div>
              <div className="flex flex-col gap-2 max-h-56 overflow-y-auto">
                {loading ? (
                  Array(3).fill(0).map((_, i) => <div key={i} className="h-12 rounded-xl bg-outline-variant/20 animate-pulse" />)
                ) : tasks.length === 0 ? (
                  <p className="text-sm text-on-surface-variant text-center py-4">No active tasks</p>
                ) : tasks.map(t => (
                  <div key={t.id}
                    className="flex items-center gap-3 p-3 rounded-xl bg-surface-container hover:bg-surface-container-high transition">
                    <div className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ background: PRIORITY_COLOR[t.priority] || "#6366f1" }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-on-surface truncate">{t.title}</p>
                      <p className="text-xs text-on-surface-variant">{t.worker_name || t.contractor_company || "Unassigned"}</p>
                    </div>
                    <span className="text-xs capitalize px-2 py-0.5 rounded-full"
                      style={{ background: (STATUS_COLOR[t.status] || "#6366f1") + "20", color: STATUS_COLOR[t.status] || "#6366f1" }}>
                      {t.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Survey alerts */}
            {briefing?.survey_alerts?.length > 0 && (
              <div className="bg-amber-50 rounded-2xl p-5 border border-amber-200">
                <h3 className="font-headline font-semibold text-amber-800 mb-3 flex items-center gap-2">
                  <span className="material-symbols-outlined text-[18px]">rate_review</span>
                  Poor Survey Responses
                </h3>
                {briefing.survey_alerts.map((alert, i) => (
                  <div key={i} className="flex items-center gap-2 py-2 border-b border-amber-100 last:border-0">
                    <span className="text-xs font-mono text-amber-500">#{alert.complaint_number}</span>
                    <span className="text-sm text-amber-900 truncate flex-1">{alert.title}</span>
                    <span className="text-xs font-bold text-amber-700">
                      ⭐ {Number(alert.avg_rating).toFixed(1)}
                    </span>
                  </div>
                ))}
                <p className="text-xs text-amber-600 mt-2">These tasks need investigation</p>
              </div>
            )}

            {/* Proactive suggestions from agent */}
            {briefing?.stale_tasks?.length > 0 && (
              <div className="bg-surface-container-low rounded-2xl p-5 border border-outline-variant">
                <h3 className="font-headline font-semibold text-on-surface mb-3 flex items-center gap-2">
                  <span className="material-symbols-outlined text-[18px] text-primary">lightbulb</span>
                  Agent Suggestions
                </h3>
                <div className="flex flex-col gap-2">
                  {briefing.stale_tasks.slice(0, 3).map((t, i) => (
                    <div key={i} className="flex items-start gap-2 p-3 rounded-xl bg-primary/5 border border-primary/15">
                      <span className="material-symbols-outlined text-primary text-[16px] mt-0.5">arrow_right</span>
                      <p className="text-xs text-on-surface">
                        Task <span className="font-semibold">"{t.title}"</span> assigned to{" "}
                        <span className="font-semibold">{t.worker_name || t.contractor_company || "unknown"}</span>{" "}
                        has been unstarted for {Math.floor((Date.now() - new Date(t.created_at)) / 86400000)}d — follow up
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <CRMAgentChat />
    </AppLayout>
  );
}