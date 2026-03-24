import React, { useEffect, useMemo, useState } from "react";
import { Clock3, MapPin, Wrench } from "lucide-react";

import client from "../api/client";
import { fetchWorkerTasks } from "../api/adminApi";
import SurveyAutoTriggerBanner from "../components/SurveyAutoTriggerBanner";

const TABS = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "in_progress", label: "In Progress" },
  { key: "completed", label: "Completed" },
];

function readUser() {
  try {
    return JSON.parse(localStorage.getItem("auth_user") || "{}");
  } catch {
    return {};
  }
}

export default function WorkerPortalPage() {
  const user = useMemo(() => readUser(), []);

  const [tab, setTab] = useState("all");
  const [tasks, setTasks] = useState([]);
  const [pendingSurveyCount, setPendingSurveyCount] = useState(0);
  const [loading, setLoading] = useState(true);

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

        const taskItems = Array.isArray(taskData?.items)
          ? taskData.items
          : Array.isArray(taskData)
          ? taskData
          : [];

        const surveys = Array.isArray(surveyRes?.data) ? surveyRes.data : [];
        const pending = surveys.filter((s) => s.status === "pending").length;

        setTasks(taskItems);
        setPendingSurveyCount(pending);
      } finally {
        if (mounted) setLoading(false);
      }
    }

    loadData();
    return () => {
      mounted = false;
    };
  }, [tab]);

  return (
    <div className="mx-auto max-w-md p-3 pb-20">
      <header className="mb-3 rounded-xl bg-slate-900 p-4 text-white shadow">
        <p className="text-xs uppercase tracking-wide text-slate-300">Worker Portal</p>
        <h1 className="text-lg font-semibold">{user?.full_name || "Worker"}</h1>
        <p className="mt-1 text-xs text-slate-300">{tasks.length} task(s) in current filter</p>
      </header>

      <SurveyAutoTriggerBanner
        surveyCount={pendingSurveyCount}
        onNavigate={() => {
          window.location.href = "/notifications";
        }}
      />

      <section className="mb-3 rounded-xl border border-slate-200 bg-white p-2">
        <div className="grid grid-cols-4 gap-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`rounded-md px-2 py-2 text-xs font-medium ${
                tab === t.key ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        {loading ? <p className="text-sm text-slate-500">Loading tasks...</p> : null}

        {!loading && tasks.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">No tasks in this status.</p>
        ) : null}

        {tasks.map((task) => (
          <article key={task.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="mb-2 flex items-start justify-between gap-2">
              <div>
                <p className="text-xs text-slate-500">{task.task_number || task.id}</p>
                <h3 className="text-sm font-semibold text-slate-900">{task.title}</h3>
              </div>
              <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">{task.status}</span>
            </div>

            <p className="mb-2 text-xs text-slate-600">{task.description || "No task description provided."}</p>

            <div className="mb-2 space-y-1 text-xs text-slate-600">
              <p className="inline-flex items-center gap-1">
                <Wrench size={12} /> Complaint: {task.complaint_number || "-"} · {task.complaint_title || "-"}
              </p>
              <p className="inline-flex items-center gap-1">
                <MapPin size={12} /> {task.address_text || "No address"}
              </p>
              <p className="inline-flex items-center gap-1">
                <Clock3 size={12} /> Due: {task.due_at || "-"}
              </p>
            </div>

            {task.status === "completed" ? (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div>
                  <p className="mb-1 text-[11px] font-medium text-slate-500">Before</p>
                  <div className="rounded-lg border border-slate-200 p-1">
                    {(task.before_photos || []).slice(0, 1).map((p, idx) => (
                      <img key={idx} src={p.url || p} alt="before" className="h-20 w-full rounded object-cover" />
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-1 text-[11px] font-medium text-slate-500">After</p>
                  <div className="rounded-lg border border-slate-200 p-1">
                    {(task.after_photos || []).slice(0, 1).map((p, idx) => (
                      <img key={idx} src={p.url || p} alt="after" className="h-20 w-full rounded object-cover" />
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
          </article>
        ))}
      </section>
    </div>
  );
}
