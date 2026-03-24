import React from "react";
import { AlertTriangle, MapPin, Repeat } from "lucide-react";
import NodeHealthBar from "./NodeHealthBar";
import LowConfidenceTag from "./LowConfidenceTag";

export default function InfraNodeCard({ node, onSelect }) {
  if (!node) return null;

  const statusTone = {
    operational: "bg-emerald-100 text-emerald-700",
    under_repair: "bg-amber-100 text-amber-700",
    inactive: "bg-gray-200 text-gray-700",
  };

  const statusLabel = (node.status || "unknown").replaceAll("_", " ");

  return (
    <article className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">{node.infra_type_name || "Infra Node"}</h3>
          <p className="text-xs text-gray-500">ID: {node.id}</p>
        </div>
        <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusTone[node.status] || "bg-slate-100 text-slate-700"}`}>
          {statusLabel}
        </span>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2 text-xs text-gray-600">
        <div className="rounded-lg bg-gray-50 p-2">
          <p className="text-gray-500">Total Complaints</p>
          <p className="text-sm font-semibold text-gray-900">{node.total_complaint_count ?? 0}</p>
        </div>
        <div className="rounded-lg bg-gray-50 p-2">
          <p className="text-gray-500">Open Complaints</p>
          <p className="text-sm font-semibold text-gray-900">{node.open_complaint_count ?? 0}</p>
        </div>
      </div>

      <div className="mb-3">
        <NodeHealthBar score={node.health_score} />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        {node.is_repeat_risk ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 font-medium text-amber-700">
            <Repeat size={12} />
            Repeat Risk
          </span>
        ) : null}

        {node.mapping_confidence != null && Number(node.mapping_confidence) < 0.65 ? <LowConfidenceTag /> : null}

        {node.open_complaint_count > 5 ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-1 font-medium text-rose-700">
            <AlertTriangle size={12} />
            Critical Load
          </span>
        ) : null}
      </div>

      <div className="mb-3 flex items-center gap-1 text-xs text-gray-500">
        <MapPin size={12} />
        <span>
          {node.jurisdiction_name || "Unknown jurisdiction"}
          {node.lat != null && node.lng != null ? ` · ${Number(node.lat).toFixed(5)}, ${Number(node.lng).toFixed(5)}` : ""}
        </span>
      </div>

      <button
        type="button"
        onClick={() => onSelect?.(node)}
        className="w-full rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
      >
        Open Node
      </button>
    </article>
  );
}
