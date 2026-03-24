import React from "react";
import { AlertOctagon, Clock3, Hammer } from "lucide-react";

export default function CriticalAlertBadge({ alert, onView }) {
  if (!alert) return null;

  return (
    <article className="rounded-xl border border-rose-200 bg-rose-50 p-3">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <AlertOctagon className="text-rose-600" size={16} />
          <p className="text-sm font-semibold text-rose-800">Warranty/Repeat Alert</p>
        </div>
        {alert.liability_contractor_flag || alert.liable_contractor_flag ? (
          <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-700">
            Contractor Liable
          </span>
        ) : null}
      </div>

      <p className="text-sm font-medium text-gray-900">{alert.infra_type_name || "Infrastructure Node"}</p>
      <p className="text-xs text-gray-600">Complaint: {alert.complaint_number || "-"}</p>

      <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-700">
        <span className="inline-flex items-center gap-1 rounded bg-white px-2 py-1">
          <Clock3 size={12} />
          {alert.days_since_resolution ?? "-"} days since last resolution
        </span>
        <span className="inline-flex items-center gap-1 rounded bg-white px-2 py-1">
          <Hammer size={12} />
          {alert.liable_contractor || "No contractor mapped"}
        </span>
      </div>

      <button
        type="button"
        onClick={() => onView?.(alert)}
        className="mt-3 w-full rounded-lg bg-rose-700 px-3 py-2 text-sm font-medium text-white transition hover:bg-rose-600"
      >
        View Alert Details
      </button>
    </article>
  );
}
