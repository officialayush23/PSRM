import React, { useEffect, useMemo, useState } from "react";
import client from "../api/client";
import { fetchWorkerTasks } from "../api/adminApi";
import SurveyAutoTriggerBanner from "../components/SurveyAutoTriggerBanner";

const TABS = [
  { key: "all",         label: "All" },
  { key: "pending",     label: "Pending" },
  { key: "in_progress", label: "In Progress" },
  { key: "completed",   label: "Completed" },
];

const STATUS_STYLE = {
  pending:     { bg: "rgba(251,146,60,0.15)",  color: "#fb923c" },
  in_progress: { bg: "rgba(56,189,248,0.15)",  color: "#38bdf8" },
  completed:   { bg: "rgba(52,211,153,0.15)",  color: "#34d399" },
};

function readUser() {
  try { return JSON.parse(localStorage.getItem("auth_user") || "{}"); }
  catch { return {}; }
}

export default function WorkerPortalPage() {
  const user = useMemo(() => readUser(), []);

  const [tab,                setTab]                = useState("all");
  const [tasks,              setTasks]              = useState([]);
  const [pendingSurveyCount, setPendingSurveyCount] = useState(0);
  const [loading,            setLoading]            = useState(true);

  useEffect(() => {
    let mounted = true;
    async function loadData() {
      setLoading(true);
      try {
        const [taskData, surveyRes] = await Promise.all([
          fetchWorkerTasks(tab === "all" ? null : tab),
          client.get("/surveys/user/my"),
        ]);
        if (!mounted) return;
        const taskItems = Array.isArray(taskData?.items) ? taskData.items
          : Array.isArray(taskData) ? taskData : [];
        const surveys = Array.isArray(surveyRes?.data) ? surveyRes.data : [];
        setTasks(taskItems);
        setPendingSurveyCount(surveys.filter(s => s.status === "pending").length);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    loadData();
    return () => { mounted = false; };
  }, [tab]);

  return (
    <div className="mx-auto max-w-md p-3 pb-20"
      style={{ minHeight: "100vh", background: "linear-gradient(135deg,#eef2ff,#f8faff,#f0f4ff)" }}>

      {/* Header */}
      <header className="mb-3 rounded-2xl p-4"
        style={{ background: "rgba(255,255,255,0.7)", backdropFilter: "blur(20px)", border: "1px solid rgba(0,0,0,0.08)" }}>
        <p className="text-xs uppercase tracking-wide text-slate-500 font-semibold">Worker Portal</p>
        <h1 className="text-lg font-bold text-slate-800 mt-0.5">{user?.full_name || "Worker"}</h1>
        <p className="mt-1 text-xs text-slate-500">{tasks.length} task(s) in current filter</p>
      </header>

      <SurveyAutoTriggerBanner
        surveyCount={pendingSurveyCount}
        onNavigate={() => { window.location.href = "/notifications"; }}
      />

      {/* Tab bar */}
      <div className="mb-3 rounded-xl p-1"
        style={{ background: "rgba(0,0,0,0.04)", border: "1px solid rgba(0,0,0,0.06)" }}>
        <div className="grid grid-cols-4 gap-1">
          {TABS.map(t => (
            <button key={t.key} type="button" onClick={() => setTab(t.key)}
              className="rounded-lg px-2 py-2 text-xs font-semibold transition-all"
              style={{
                background: tab === t.key ? "rgba(56,189,248,0.2)" : "transparent",
                color:      tab === t.key ? "#38bdf8" : "#64748b",
              }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tasks */}
      <div className="flex flex-col gap-3">
        {loading ? (
          Array(3).fill(0).map((_,i) => (
            <div key={i} className="rounded-2xl p-4 animate-pulse"
              style={{ background: "rgba(255,255,255,0.7)", border: "1px solid rgba(0,0,0,0.06)" }}>
              <div className="h-3 w-32 rounded mb-2" style={{ background: "rgba(0,0,0,0.06)" }} />
              <div className="h-4 w-48 rounded" style={{ background: "rgba(0,0,0,0.06)" }} />
            </div>
          ))
        ) : tasks.length === 0 ? (
          <div className="rounded-2xl p-6 text-center"
            style={{ background: "rgba(0,0,0,0.04)", border: "1px solid rgba(0,0,0,0.06)" }}>
            <span className="material-symbols-outlined text-4xl text-slate-600 block mb-2">task_alt</span>
            <p className="text-sm text-slate-500">No tasks in this status.</p>
          </div>
        ) : tasks.map(task => {
          const st = STATUS_STYLE[task.status] || { bg: "rgba(0,0,0,0.06)", color: "#64748b" };
          return (
            <article key={task.id} className="rounded-2xl p-4"
              style={{ background: "rgba(255,255,255,0.7)", backdropFilter: "blur(20px)", border: "1px solid rgba(0,0,0,0.08)" }}>
              <div className="mb-2 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-mono text-slate-500">{task.task_number || task.id}</p>
                  <h3 className="text-sm font-semibold text-slate-800 mt-0.5">{task.title}</h3>
                </div>
                <span className="rounded-full px-2 py-1 text-xs font-bold capitalize whitespace-nowrap shrink-0"
                  style={{ background: st.bg, color: st.color }}>
                  {task.status?.replace(/_/g," ")}
                </span>
              </div>

              <p className="mb-3 text-xs text-slate-400 leading-relaxed">
                {task.description || "No task description provided."}
              </p>

              <div className="flex flex-col gap-1.5 text-xs text-slate-500">
                <span className="flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[13px] text-sky-400">construction</span>
                  Complaint: {task.complaint_number || "-"} · {task.complaint_title || "-"}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[13px] text-sky-400">location_on</span>
                  {task.address_text || "No address"}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[13px] text-amber-400">schedule</span>
                  Due: {task.due_at || "-"}
                </span>
              </div>

              {task.status === "completed" && (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {[["before", task.before_photos], ["after", task.after_photos]].map(([label, photos]) => (
                    <div key={label}>
                      <p className="mb-1 text-[11px] font-semibold capitalize"
                        style={{ color: label === "before" ? "#94a3b8" : "#34d399" }}>{label}</p>
                      <div className="rounded-xl overflow-hidden"
                        style={{ border: "1px solid rgba(0,0,0,0.08)" }}>
                        {(photos || []).slice(0,1).map((p, idx) => (
                          <img key={idx} src={p.url || p} alt={label}
                            className="h-20 w-full object-cover" />
                        ))}
                        {!(photos || []).length && (
                          <div className="h-20 flex items-center justify-center"
                            style={{ background: "rgba(0,0,0,0.04)" }}>
                            <span className="text-xs text-slate-600">No photo</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
