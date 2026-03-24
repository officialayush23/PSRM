import React from "react";
import { MessageSquareHeart } from "lucide-react";

export default function SurveyAutoTriggerBanner({ surveyCount = 0, onNavigate }) {
  if (!surveyCount) return null;

  return (
    <section className="mb-3 rounded-xl border border-sky-200 bg-sky-50 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <MessageSquareHeart className="text-sky-700" size={18} />
          <div>
            <p className="text-sm font-semibold text-sky-900">Citizen Feedback Pending</p>
            <p className="text-xs text-sky-700">
              {surveyCount} survey{surveyCount > 1 ? "s" : ""} waiting for response.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onNavigate}
          className="rounded-lg bg-sky-700 px-3 py-2 text-xs font-semibold text-white hover:bg-sky-600"
        >
          Open Surveys
        </button>
      </div>
    </section>
  );
}
