import React from "react";

export default function SurveyAutoTriggerBanner({ surveyCount = 0, onNavigate }) {
  if (!surveyCount) return null;

  return (
    <section className="mb-3 rounded-2xl p-3"
      style={{ background: "rgba(56,189,248,0.08)", border: "1px solid rgba(56,189,248,0.2)" }}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-sky-400 text-[20px]">rate_review</span>
          <div>
            <p className="text-sm font-semibold text-sky-600">Citizen Feedback Pending</p>
            <p className="text-xs text-sky-400/70">
              {surveyCount} survey{surveyCount > 1 ? "s" : ""} waiting for response.
            </p>
          </div>
        </div>
        <button type="button" onClick={onNavigate}
          className="px-3 py-2 rounded-xl text-xs font-bold text-white transition-colors"
          style={{ background: "rgba(56,189,248,0.25)", border: "1px solid rgba(56,189,248,0.3)" }}
          onMouseEnter={e => e.currentTarget.style.background = "rgba(56,189,248,0.35)"}
          onMouseLeave={e => e.currentTarget.style.background = "rgba(56,189,248,0.25)"}>
          Open Surveys
        </button>
      </div>
    </section>
  );
}
