import React from "react";

export default function WorkflowRecommendationPanel({ suggestions = [], onApprove, onCompare }) {
  if (!Array.isArray(suggestions) || suggestions.length === 0) {
    return (
      <section className="rounded-2xl p-4 text-sm text-slate-500"
        style={{ background: "rgba(0,0,0,0.04)", border: "1px solid rgba(0,0,0,0.07)" }}>
        No recommendations available yet.
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      {suggestions.map((item, idx) => {
        const score = Number(item.confidence_score ?? item.match_score ?? 0);
        const steps = item.steps_count ?? item.step_count ?? item.total_steps;

        return (
          <article key={item.version_id || item.template_id || idx}
            className="rounded-2xl p-4"
            style={{ background: "rgba(255,255,255,0.7)", backdropFilter: "blur(20px)", border: "1px solid rgba(0,0,0,0.08)" }}>

            <div className="mb-2 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-800">{item.template_name || "Workflow Template"}</h3>
                <p className="text-xs text-slate-500 mt-0.5">Version: {item.version || item.version_number || "-"}</p>
              </div>
              <span className="rounded-full px-2 py-1 text-xs font-bold whitespace-nowrap"
                style={{ background: "rgba(52,211,153,0.15)", color: "#34d399" }}>
                {(score * 100).toFixed(0)}% match
              </span>
            </div>

            <div className="mb-3 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-xl p-2"
                style={{ background: "rgba(0,0,0,0.04)", border: "1px solid rgba(0,0,0,0.06)" }}>
                <p className="text-slate-500 mb-1">Estimated Duration</p>
                <p className="font-semibold text-slate-700">{item.estimated_duration_days ?? item.estimated_days ?? "-"} days</p>
              </div>
              <div className="rounded-xl p-2"
                style={{ background: "rgba(0,0,0,0.04)", border: "1px solid rgba(0,0,0,0.06)" }}>
                <p className="text-slate-500 mb-1">Steps</p>
                <p className="font-semibold text-slate-300 flex items-center gap-1">
                  <span className="material-symbols-outlined text-[12px] text-slate-400">layers</span>
                  {steps ?? "-"}
                </p>
              </div>
            </div>

            {(item.risk_note || item.alert_reason) && (
              <div className="mb-3 rounded-xl p-2.5 text-xs"
                style={{ background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.2)" }}>
                <p className="flex items-center gap-1 font-semibold text-amber-400">
                  <span className="material-symbols-outlined text-[12px]">warning</span>
                  Risk Note
                </p>
                <p className="mt-1 text-amber-200/70">{item.risk_note || item.alert_reason}</p>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => onApprove?.(item)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-white transition-colors"
                style={{ background: "rgba(56,189,248,0.2)", border: "1px solid rgba(56,189,248,0.3)" }}
                onMouseEnter={e => e.currentTarget.style.background = "rgba(56,189,248,0.3)"}
                onMouseLeave={e => e.currentTarget.style.background = "rgba(56,189,248,0.2)"}>
                <span className="material-symbols-outlined text-[14px] text-sky-400">check_circle</span>
                Approve
              </button>
              <button type="button" onClick={() => onCompare?.(item)}
                className="px-3 py-2 rounded-xl text-xs font-bold text-slate-600 transition-colors"
                style={{ border: "1px solid rgba(0,0,0,0.1)" }}
                onMouseEnter={e => e.currentTarget.style.background = "rgba(0,0,0,0.04)"}
                onMouseLeave={e => e.currentTarget.style.background = ""}>
                Compare
              </button>
            </div>
          </article>
        );
      })}
    </section>
  );
}
