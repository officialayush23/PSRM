import React, { useMemo, useState } from "react";

function canApprove(role, status) {
  if (role === "official") return false;
  if (role === "admin") return status === "submitted" || status === "requested";
  if (role === "super_admin") return status === "admin_approved" || status === "requested" || status === "submitted";
  return false;
}

export default function TenderApprovalCard({ tender, userRole, onApprove, onReject }) {
  const [reason, setReason] = useState("");
  const amount = Number(tender?.estimated_cost ?? 0);

  const flow = useMemo(() => [
    { key: "submitted",            label: "Submitted" },
    { key: "admin_approved",       label: "Admin Approved" },
    { key: "super_admin_approved", label: "Super Admin Approved" },
  ], []);

  if (!tender) return null;

  const status = tender.status || "submitted";
  const approveEnabled = canApprove(userRole, status);

  const activeIndex =
    status === "super_admin_approved" || status === "approved" ? 2
    : status === "admin_approved" ? 1 : 0;

  return (
    <article className="rounded-2xl p-4"
      style={{ background: "rgba(255,255,255,0.7)", backdropFilter: "blur(20px)", border: "1px solid rgba(0,0,0,0.08)" }}>

      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs text-slate-500">{tender.tender_number || "-"}</p>
          <h3 className="text-sm font-semibold text-slate-800 mt-0.5">{tender.title || "Tender"}</h3>
          <p className="mt-1 text-xs text-sky-400 font-semibold">₹ {amount.toLocaleString("en-IN")}</p>
        </div>
        <span className="rounded-full px-2 py-1 text-xs font-bold capitalize whitespace-nowrap"
          style={{ background: "rgba(0,0,0,0.06)", color: "#64748b" }}>{status}</span>
      </div>

      {/* Approval flow */}
      <div className="mb-3 rounded-xl p-3"
        style={{ background: "rgba(0,0,0,0.04)", border: "1px solid rgba(0,0,0,0.06)" }}>
        <p className="mb-2 text-xs font-semibold text-slate-500">Approval Flow</p>
        <div className="grid grid-cols-3 gap-2">
          {flow.map((item, idx) => (
            <div key={item.key}
              className="rounded-lg px-2 py-2 text-center text-[10px] font-bold"
              style={idx <= activeIndex
                ? { background: "rgba(52,211,153,0.15)", color: "#34d399" }
                : { background: "rgba(0,0,0,0.05)", color: "#475569" }}>
              {item.label}
            </div>
          ))}
        </div>
      </div>

      <div className="mb-3 flex flex-col gap-1.5 text-xs text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[13px] text-slate-500">schedule</span>
          Submitted: {tender.submitted_at || "-"}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[13px] text-slate-500">verified_user</span>
          Requested by: {tender.requested_by_name || tender.requested_by || "-"}
        </span>
      </div>

      <div className="mb-3">
        <label className="text-xs font-semibold text-slate-500 block mb-1">
          Reason (required for reject)
        </label>
        <textarea
          rows={2}
          value={reason}
          onChange={e => setReason(e.target.value)}
          className="ginput w-full px-3 py-2 rounded-xl text-sm resize-none"
          placeholder="Enter approval/rejection reason"
        />
      </div>

      <div className="flex gap-2">
        <button type="button"
          disabled={!approveEnabled}
          onClick={() => onApprove?.(tender, { reason: reason || null })}
          className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-bold text-white disabled:opacity-40 transition-colors"
          style={{ background: "rgba(52,211,153,0.25)", border: "1px solid rgba(52,211,153,0.3)" }}>
          <span className="material-symbols-outlined text-[14px] text-emerald-400">gavel</span>
          Approve
        </button>
        <button type="button"
          disabled={!reason.trim()}
          onClick={() => onReject?.(tender, { reason: reason.trim() })}
          className="flex-1 rounded-xl py-2.5 text-xs font-bold text-white disabled:opacity-40 transition-colors"
          style={{ background: "rgba(239,68,68,0.25)", border: "1px solid rgba(239,68,68,0.3)", color: "#f87171" }}>
          Reject
        </button>
      </div>
    </article>
  );
}
