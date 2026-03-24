import React from "react";
import { CheckCircle2, FileWarning, Layers } from "lucide-react";

export default function WorkflowRecommendationPanel({ suggestions = [], onApprove, onCompare }) {
  if (!Array.isArray(suggestions) || suggestions.length === 0) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
        No recommendations available yet.
      </section>
    );
  }

  return (
    <section className="space-y-3">
      {suggestions.map((item, idx) => {
        const score = Number(item.confidence_score ?? item.match_score ?? 0);
        const steps = item.steps_count ?? item.step_count ?? item.total_steps;

        return (
          <article key={item.version_id || item.template_id || idx} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">{item.template_name || "Workflow Template"}</h3>
                <p className="text-xs text-slate-500">Version: {item.version || item.version_number || "-"}</p>
              </div>
              <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-700">
                {(score * 100).toFixed(0)}% match
              </span>
            </div>

            <div className="mb-3 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded bg-slate-50 p-2 text-slate-700">
                <p className="mb-1 text-slate-500">Estimated Duration</p>
                <p className="font-semibold">{item.estimated_duration_days ?? item.estimated_days ?? "-"} days</p>
              </div>
              <div className="rounded bg-slate-50 p-2 text-slate-700">
                <p className="mb-1 text-slate-500">Steps</p>
                <p className="inline-flex items-center gap-1 font-semibold">
                  <Layers size={12} /> {steps ?? "-"}
                </p>
              </div>
            </div>

            {item.risk_note || item.alert_reason ? (
              <div className="mb-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
                <p className="inline-flex items-center gap-1 font-medium">
                  <FileWarning size={12} /> Risk Note
                </p>
                <p className="mt-1">{item.risk_note || item.alert_reason}</p>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700"
                onClick={() => onApprove?.(item)}
              >
                <CheckCircle2 size={14} /> Approve
              </button>
              <button
                type="button"
                className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                onClick={() => onCompare?.(item)}
              >
                Compare
              </button>
            </div>
          </article>
        );
      })}
    </section>
  );
}
