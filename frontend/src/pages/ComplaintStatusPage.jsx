import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import AppLayout from "../components/AppLayout";
import { fetchComplaintById, fetchComplaintHistory } from "../api/complaintsApi";

const STATUS_STEPS = [
  { key: "received",         label: "Registered" },
  { key: "clustered",        label: "Verified" },
  { key: "workflow_started", label: "Assigned" },
  { key: "in_progress",      label: "In Progress" },
  { key: "resolved",         label: "Resolved" },
  { key: "closed",           label: "Closed" },
];

const STATUS_STYLE = {
  received:            { bg: "rgba(139,92,246,0.15)", color: "#a78bfa" },
  clustered:           { bg: "rgba(139,92,246,0.15)", color: "#a78bfa" },
  mapped:              { bg: "rgba(56,189,248,0.12)",  color: "#38bdf8" },
  workflow_started:    { bg: "rgba(56,189,248,0.12)",  color: "#38bdf8" },
  in_progress:         { bg: "rgba(251,146,60,0.12)",  color: "#fb923c" },
  midway_survey_sent:  { bg: "rgba(251,146,60,0.12)",  color: "#fb923c" },
  resolved:            { bg: "rgba(52,211,153,0.12)",  color: "#34d399" },
  closed:              { bg: "rgba(52,211,153,0.12)",  color: "#34d399" },
  rejected:            { bg: "rgba(248,113,113,0.12)", color: "#f87171" },
  escalated:           { bg: "rgba(248,113,113,0.12)", color: "#f87171" },
  emergency:           { bg: "rgba(248,113,113,0.2)",  color: "#ef4444" },
  constraint_blocked:  { bg: "rgba(251,191,36,0.12)",  color: "#fbbf24" },
};

const PRIORITY_COLOR = {
  low: "#64748b", normal: "#38bdf8", high: "#fb923c", critical: "#f87171", emergency: "#ef4444",
};

function getStepIndex(status) {
  const idx = STATUS_STEPS.findIndex((s) => s.key === status);
  if (idx !== -1) return idx;
  if (status === "mapped" || status === "clustered") return 1;
  if (status === "midway_survey_sent") return 3;
  if (status === "closed") return 5;
  return 0;
}

function formatDateTime(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function ComplaintStatusPage() {
  const { id }    = useParams();
  const navigate  = useNavigate();
  const [complaint, setComplaint] = useState(null);
  const [history, setHistory]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [comp, hist] = await Promise.all([
          fetchComplaintById(id),
          fetchComplaintHistory(id).catch(() => []),
        ]);
        setComplaint(comp);
        setHistory(hist || []);
      } catch (e) {
        setError(e.response?.data?.detail || "Complaint not found.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64 text-slate-400">
          <span className="material-symbols-outlined animate-spin text-4xl mr-3">progress_activity</span>
          Loading complaint…
        </div>
      </AppLayout>
    );
  }

  if (error || !complaint) {
    return (
      <AppLayout>
        <div className="flex flex-col items-center justify-center h-64 gap-4">
          <span className="material-symbols-outlined text-5xl text-red-400">error</span>
          <p className="text-slate-400">{error || "Complaint not found"}</p>
          <button onClick={() => navigate(-1)} className="text-sky-400 hover:text-sky-300 text-sm transition-colors">
            ← Go back
          </button>
        </div>
      </AppLayout>
    );
  }

  const activeStep  = getStepIndex(complaint.status);
  const isResolved  = ["resolved", "closed"].includes(complaint.status);
  const hasMapPoint = complaint.lat != null && complaint.lng != null;

  const timestampByStatus = {};
  for (const h of history) {
    if (h.new_status && !timestampByStatus[h.new_status]) {
      timestampByStatus[h.new_status] = h.created_at;
    }
  }
  if (!timestampByStatus["received"]) {
    timestampByStatus["received"] = complaint.created_at;
  }

  const imageUrl =
    Array.isArray(complaint.images) && complaint.images.length > 0
      ? complaint.images[0]?.url || null
      : null;

  const SLA_DAYS = 41;
  let slaPercent = 0;
  let slaLabel   = "";
  if (isResolved && complaint.resolved_at) {
    slaPercent = 100;
    slaLabel   = "Resolved";
  } else {
    const elapsed  = Math.floor((Date.now() - new Date(complaint.created_at).getTime()) / (1000 * 60 * 60 * 24));
    slaPercent     = Math.min(100, Math.round((elapsed / SLA_DAYS) * 100));
    const remaining = SLA_DAYS - elapsed;
    slaLabel       = remaining > 0 ? `${remaining} days left` : "Overdue";
  }
  const circumference = 2 * Math.PI * 24;
  const slaOffset     = circumference * (1 - slaPercent / 100);
  const slaColor      = isResolved ? "#34d399" : slaPercent > 80 ? "#f87171" : "#38bdf8";

  const statusStyle = STATUS_STYLE[complaint.status] || { bg: "rgba(0,0,0,0.06)", color: "#64748b" };

  return (
    <AppLayout>
      <div className="p-6 max-w-5xl mx-auto flex flex-col gap-6 lg:flex-row">
        {/* ── LEFT ── */}
        <div className="flex flex-col gap-5 flex-1 min-w-0">
          {/* Back + header */}
          <div>
            <button
              onClick={() => navigate(-1)}
              className="flex items-center gap-1 text-slate-500 text-sm hover:text-sky-400 mb-3 transition-colors"
            >
              <span className="material-symbols-outlined text-[16px]">arrow_back</span>
              Back
            </button>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold text-slate-800">{complaint.complaint_number}</h1>
              <span className="text-xs font-bold px-3 py-1 rounded-full capitalize"
                style={{ background: statusStyle.bg, color: statusStyle.color }}>
                {complaint.status.replace(/_/g, " ")}
              </span>
              {complaint.is_repeat_complaint && (
                <span className="text-xs font-bold px-3 py-1 rounded-full"
                  style={{ background: "rgba(248,113,113,0.15)", color: "#f87171" }}>
                  Repeat Complaint
                </span>
              )}
            </div>
            <p className="text-lg font-semibold text-slate-800 mt-1">{complaint.title}</p>
            {complaint.address_text && (
              <p className="text-sm text-slate-400 mt-0.5 flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px]">location_on</span>
                {complaint.address_text}
              </p>
            )}
            <p className="text-xs text-slate-600 mt-1">
              Filed {formatDateTime(complaint.created_at)}
              {complaint.resolved_at && ` · Resolved ${formatDateTime(complaint.resolved_at)}`}
            </p>
          </div>

          {/* Image */}
          {imageUrl ? (
            <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(0,0,0,0.08)" }}>
              <img src={imageUrl} alt="Complaint photo" className="w-full h-64 object-cover" />
            </div>
          ) : (
            <div className="rounded-2xl h-40 flex items-center justify-center text-slate-400"
              style={{ background: "rgba(0,0,0,0.04)", border: "1px solid rgba(0,0,0,0.06)" }}>
              <span className="material-symbols-outlined text-4xl">image_not_supported</span>
            </div>
          )}

          {/* Description */}
          <div className="gcard p-5">
            <h2 className="font-semibold text-slate-800 mb-3 flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px] text-sky-400">description</span>
              Complaint Details
            </h2>
            <p className="text-sm text-slate-600 leading-relaxed">{complaint.description}</p>
            {complaint.priority && (
              <div className="mt-3 flex items-center gap-2 text-xs">
                <span className="text-slate-500">Priority:</span>
                <span className="font-semibold capitalize"
                  style={{ color: PRIORITY_COLOR[complaint.priority] || "#94a3b8" }}>
                  {complaint.priority}
                </span>
              </div>
            )}
          </div>

          {/* Infra node */}
          {complaint.infra_node_id && (
            <div className="gcard p-5">
              <h2 className="font-semibold text-slate-800 mb-2 flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px] text-indigo-400">lan</span>
                Linked Infrastructure Node
              </h2>
              <p className="text-sm text-slate-600 font-mono">Node: {complaint.infra_node_id}</p>
              <p className="text-xs text-slate-500 mt-1">
                Workflow: {complaint.workflow_instance_id || "Not started"}
              </p>
            </div>
          )}

          {/* AI Summary */}
          {complaint.agent_summary && (
            <div className="rounded-2xl p-5"
              style={{ background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.2)" }}>
              <h2 className="font-semibold mb-2 flex items-center gap-2"
                style={{ color: "#a78bfa" }}>
                <span className="material-symbols-outlined text-[18px]">auto_awesome</span>
                AI Summary
              </h2>
              <p className="text-sm text-slate-600 leading-relaxed">{complaint.agent_summary}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 flex-wrap">
            {hasMapPoint && (
              <a
                href={`https://www.google.com/maps?q=${complaint.lat},${complaint.lng}`}
                target="_blank"
                rel="noreferrer"
                className="gbtn-ghost px-5 py-2.5 rounded-full text-sm font-semibold"
              >
                View on Map
              </a>
            )}
            <Link to="/submit"
              className="gbtn-sky px-5 py-2.5 rounded-full text-sm font-semibold text-white">
              Report Another Issue
            </Link>
            <Link to="/my-complaints"
              className="gbtn-ghost px-5 py-2.5 rounded-full text-sm font-semibold">
              My Complaints
            </Link>
          </div>
        </div>

        {/* ── RIGHT ── */}
        <div className="flex flex-col gap-5 lg:w-80">
          {/* SLA Ring */}
          <div className="gcard p-5">
            <h2 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px] text-sky-400">timer</span>
              Delhi Mitra SLA ({SLA_DAYS} days)
            </h2>
            <div className="flex items-center gap-5">
              <div className="relative w-16 h-16 shrink-0">
                <svg className="-rotate-90" width="64" height="64" viewBox="0 0 64 64">
                  <circle cx="32" cy="32" r="24" fill="none" stroke="rgba(0,0,0,0.08)" strokeWidth="6" />
                  <circle
                    cx="32" cy="32" r="24" fill="none"
                    stroke={slaColor}
                    strokeWidth="6" strokeLinecap="round"
                    strokeDasharray={circumference} strokeDashoffset={slaOffset}
                    style={{ filter: `drop-shadow(0 0 6px ${slaColor}60)` }}
                  />
                </svg>
                <span className="absolute inset-0 flex items-center justify-center text-sm font-bold" style={{ color: slaColor }}>
                  {slaPercent}%
                </span>
              </div>
              <div>
                <p className="text-sm font-medium text-slate-800">{slaLabel}</p>
                <p className="text-xs text-slate-500 mt-1">
                  {isResolved ? "Complaint resolved" : `Filed ${formatDateTime(complaint.created_at)}`}
                </p>
              </div>
            </div>
          </div>

          {/* Timeline */}
          <div className="gcard p-5">
            <h2 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px] text-sky-400">timeline</span>
              Activity Timeline
            </h2>
            <div className="flex flex-col gap-1">
              {STATUS_STEPS.map((step, idx) => {
                const done    = idx <= activeStep;
                const current = idx === activeStep;
                const ts      = timestampByStatus[step.key];
                const dotColor = done ? (current ? "#38bdf8" : "#34d399") : "rgba(0,0,0,0.1)";
                return (
                  <div key={step.key} className="flex items-start gap-3">
                    <div className="flex flex-col items-center">
                      <div className="w-7 h-7 shrink-0 rounded-full flex items-center justify-center"
                        style={{ background: dotColor, boxShadow: done ? `0 0 8px ${dotColor}60` : "none" }}>
                        <span className="material-symbols-outlined text-[14px] text-white">
                          {done && !current ? "check" : current ? "radio_button_checked" : "radio_button_unchecked"}
                        </span>
                      </div>
                      {idx < STATUS_STEPS.length - 1 && (
                        <div className="w-0.5 h-8 mt-1"
                          style={{ background: done ? "rgba(56,189,248,0.3)" : "rgba(0,0,0,0.08)" }} />
                      )}
                    </div>
                    <div className="pb-4">
                      <p className={`text-sm font-medium ${done ? "text-slate-800" : "text-slate-400"}`}>
                        {step.label}
                      </p>
                      {done && ts ? (
                        <p className="text-xs text-slate-500">{formatDateTime(ts)}</p>
                      ) : done && !ts ? (
                        <p className="text-xs text-slate-600">Completed</p>
                      ) : (
                        <p className="text-xs text-slate-700">Pending</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
