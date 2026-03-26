import React from "react";

export default function CriticalAlertBadge({ alert, onView }) {
  if (!alert) return null;

  return (
    <article className="rounded-2xl p-4"
      style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)" }}>

      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-red-400 text-[18px]">warning</span>
          <p className="text-sm font-semibold text-red-300">Warranty/Repeat Alert</p>
        </div>
        {(alert.liability_contractor_flag || alert.liable_contractor_flag) && (
          <span className="rounded-full px-2 py-1 text-[10px] font-bold"
            style={{ background: "rgba(251,191,36,0.15)", color: "#fbbf24" }}>
            Contractor Liable
          </span>
        )}
      </div>

      <p className="text-sm font-semibold text-slate-800">{alert.infra_type_name || "Infrastructure Node"}</p>
      <p className="text-xs text-slate-500 mt-0.5">Complaint: {alert.complaint_number || "-"}</p>

      <div className="mt-2 flex flex-wrap gap-2 text-xs">
        <span className="flex items-center gap-1 px-2 py-1 rounded-lg"
          style={{ background: "rgba(0,0,0,0.05)", color: "#64748b" }}>
          <span className="material-symbols-outlined text-[12px]">schedule</span>
          {alert.days_since_resolution ?? "-"} days since last resolution
        </span>
        <span className="flex items-center gap-1 px-2 py-1 rounded-lg"
          style={{ background: "rgba(0,0,0,0.05)", color: "#64748b" }}>
          <span className="material-symbols-outlined text-[12px]">construction</span>
          {alert.liable_contractor || "No contractor mapped"}
        </span>
      </div>

      <button type="button" onClick={() => onView?.(alert)}
        className="mt-3 w-full rounded-xl py-2.5 text-sm font-bold text-white transition-all"
        style={{ background: "rgba(239,68,68,0.3)", border: "1px solid rgba(239,68,68,0.4)" }}
        onMouseEnter={e => e.currentTarget.style.background = "rgba(239,68,68,0.4)"}
        onMouseLeave={e => e.currentTarget.style.background = "rgba(239,68,68,0.3)"}>
        View Alert Details
      </button>
    </article>
  );
}
