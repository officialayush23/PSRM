import React, { useMemo, useState } from "react";
import { BadgeCheck, FileClock, Gavel } from "lucide-react";

function canApprove(role, status) {
  if (role === "official") return false;
  if (role === "admin") return status === "submitted" || status === "requested";
  if (role === "super_admin") return status === "admin_approved" || status === "requested" || status === "submitted";
  return false;
}

export default function TenderApprovalCard({ tender, userRole, onApprove, onReject }) {
  const [reason, setReason] = useState("");
  const amount = Number(tender?.estimated_cost ?? 0);

  const flow = useMemo(
    () => [
      { key: "submitted", label: "Submitted" },
      { key: "admin_approved", label: "Admin Approved" },
      { key: "super_admin_approved", label: "Super Admin Approved" },
    ],
    []
  );

  if (!tender) return null;

  const status = tender.status || "submitted";
  const approveEnabled = canApprove(userRole, status);

  const activeIndex =
    status === "super_admin_approved" || status === "approved"
      ? 2
      : status === "admin_approved"
      ? 1
      : 0;

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs text-slate-500">{tender.tender_number || "-"}</p>
          <h3 className="text-sm font-semibold text-slate-900">{tender.title || "Tender"}</h3>
          <p className="mt-1 text-xs text-slate-600">₹ {amount.toLocaleString("en-IN")}</p>
        </div>
        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">{status}</span>
      </div>

      <div className="mb-3 rounded-lg border border-slate-200 p-2">
        <p className="mb-2 text-xs font-medium text-slate-600">Approval Flow</p>
        <div className="grid grid-cols-3 gap-2">
          {flow.map((item, idx) => (
            <div
              key={item.key}
              className={`rounded px-2 py-2 text-center text-[11px] font-medium ${
                idx <= activeIndex ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
              }`}
            >
              {item.label}
            </div>
          ))}
        </div>
      </div>

      <div className="mb-3 space-y-2 text-xs text-slate-700">
        <p className="inline-flex items-center gap-1">
          <FileClock size={12} /> Submitted: {tender.submitted_at || "-"}
        </p>
        <p className="inline-flex items-center gap-1">
          <BadgeCheck size={12} /> Requested by: {tender.requested_by_name || tender.requested_by || "-"}
        </p>
      </div>

      <label className="mb-3 block text-xs">
        <span className="mb-1 block text-slate-600">Reason (required for reject)</span>
        <textarea
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          placeholder="Enter approval/rejection reason"
        />
      </label>

      <div className="flex gap-2">
        <button
          type="button"
          disabled={!approveEnabled}
          onClick={() => onApprove?.(tender, { reason: reason || null })}
          className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Gavel size={14} /> Approve
        </button>
        <button
          type="button"
          disabled={!reason.trim()}
          onClick={() => onReject?.(tender, { reason: reason.trim() })}
          className="flex-1 rounded-lg bg-rose-700 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Reject
        </button>
      </div>
    </article>
  );
}
