// src/pages/SurveyPage.jsx
// Citizen survey page — opened via Firebase notification or email link
// Route: /survey/:surveyInstanceId

import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import client from "../api/client";
import { toast } from "sonner";

const INFRA_ICONS = {
  STLIGHT: "💡", ROAD: "🛣️", POTHOLE: "⚠️", DRAIN: "🌊",
  FOOTPATH: "🚶", TREE: "🌳", GARBAGE: "🗑️", WIRE_HAZARD: "⚡",
  WATER_PIPE: "💧", SEWER: "🔧", HOARDING: "📢", ELEC_POLE: "🔌",
};

function StarRating({ value, onChange }) {
  const [hovered, setHovered] = useState(0);
  return (
    <div className="flex gap-2 justify-center">
      {[1, 2, 3, 4, 5].map(star => (
        <button
          key={star}
          type="button"
          onClick={() => onChange(star)}
          onMouseEnter={() => setHovered(star)}
          onMouseLeave={() => setHovered(0)}
          className="text-4xl transition-transform hover:scale-110"
        >
          <span style={{ color: star <= (hovered || value) ? "#f59e0b" : "#d1d5db" }}>
            ★
          </span>
        </button>
      ))}
    </div>
  );
}

const RATING_LABELS = ["", "Very Poor", "Poor", "Average", "Good", "Excellent"];

export default function SurveyPage() {
  const { surveyInstanceId } = useParams();
  const navigate = useNavigate();

  const [survey,      setSurvey]      = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [submitting,  setSubmitting]  = useState(false);
  const [submitted,   setSubmitted]   = useState(false);
  const [error,       setError]       = useState(null);

  // Form state
  const [rating,       setRating]       = useState(0);
  const [feedback,     setFeedback]     = useState("");
  const [isResolved,   setIsResolved]   = useState(null);
  const [wantsFollowup,setWantsFollowup]= useState(null);

  useEffect(() => {
    async function load() {
      try {
        const { data } = await client.get(`/surveys/${surveyInstanceId}`);
        setSurvey(data);
      } catch (err) {
        if (err.response?.status === 400) {
          setError("This survey has already been completed.");
        } else if (err.response?.status === 404) {
          setError("Survey not found. The link may have expired.");
        } else {
          setError("Failed to load survey. Please try again.");
        }
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [surveyInstanceId]);

  const handleSubmit = async () => {
    if (rating === 0) {
      toast.error("Please provide a rating");
      return;
    }
    if (survey.survey_type === "closing" && isResolved === null) {
      toast.error("Please indicate if the issue was resolved");
      return;
    }

    setSubmitting(true);
    try {
      const { data } = await client.post(`/surveys/${surveyInstanceId}/submit`, {
        rating,
        feedback:       feedback.trim() || null,
        is_resolved:    isResolved,
        wants_followup: wantsFollowup,
      });
      setSubmitted(true);
      toast.success(data.message || "Thank you for your feedback!");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Submission failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Loading ───────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-on-surface-variant">Loading survey…</p>
        </div>
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center p-4">
        <div className="bg-surface-container-low rounded-2xl p-8 max-w-sm w-full text-center border border-outline-variant">
          <span className="material-symbols-outlined text-5xl text-on-surface-variant block mb-3">sentiment_dissatisfied</span>
          <p className="font-semibold text-on-surface mb-2">Survey Unavailable</p>
          <p className="text-sm text-on-surface-variant mb-6">{error}</p>
          <button onClick={() => navigate("/")} className="px-6 py-2.5 bg-primary text-on-primary rounded-full text-sm font-semibold">
            Go to Dashboard
          </button>
        </div>
      </div>
    );
  }

  // ── Submitted ────────────────────────────────────────────────
  if (submitted) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center p-4">
        <div className="bg-surface-container-low rounded-3xl p-10 max-w-sm w-full text-center border border-outline-variant shadow-lg">
          <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-5">
            <span className="material-symbols-outlined text-green-600 text-4xl">check_circle</span>
          </div>
          <h2 className="text-xl font-headline font-bold text-on-surface mb-2">
            {rating >= 4 ? "Thank you! 🙏" : "Feedback Received"}
          </h2>
          <p className="text-sm text-on-surface-variant mb-2">
            {rating >= 4
              ? "We're glad the civic issue was addressed to your satisfaction."
              : rating >= 3
              ? "We appreciate your honest feedback and will work to improve."
              : "We've flagged this for investigation. An official will follow up."}
          </p>
          {rating < 3 && (
            <p className="text-xs text-orange-600 bg-orange-50 px-4 py-2 rounded-xl mb-4">
              Your feedback has been escalated to the concerned official.
            </p>
          )}
          <p className="text-xs text-on-surface-variant mb-6">
            Your rating: {"★".repeat(rating)}{"☆".repeat(5 - rating)} {RATING_LABELS[rating]}
          </p>
          <button onClick={() => navigate("/")} className="w-full py-3 bg-primary text-on-primary rounded-xl font-semibold text-sm">
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  const isClosing = survey.survey_type === "closing";
  const infraIcon = INFRA_ICONS[survey.infra_type_code] || "📍";

  // ── Survey form ───────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-surface pb-16">
      {/* Header */}
      <div className="bg-primary text-on-primary px-5 py-5">
        <p className="text-xs font-semibold opacity-70 uppercase tracking-wider mb-1">PS-CRM · Citizen Survey</p>
        <h1 className="text-xl font-headline font-bold">{survey.survey_title}</h1>
        <p className="text-sm opacity-80 mt-1">{survey.survey_description}</p>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 flex flex-col gap-6">

        {/* Complaint summary */}
        <div className="bg-surface-container-low rounded-2xl p-5 border border-outline-variant">
          <div className="flex items-center gap-3 mb-3">
            <span className="text-3xl">{infraIcon}</span>
            <div>
              <p className="text-xs font-semibold text-on-surface-variant">{survey.infra_type_name || "Civic Issue"}</p>
              <p className="text-xs font-mono text-primary">#{survey.complaint_number}</p>
            </div>
          </div>
          <p className="font-semibold text-on-surface text-sm mb-1">{survey.complaint_title}</p>
          {survey.address_text && (
            <p className="text-xs text-on-surface-variant flex items-center gap-1">
              <span className="material-symbols-outlined text-[12px]">location_on</span>
              {survey.address_text}
            </p>
          )}
          <div className="mt-2 px-2 py-1 rounded-lg inline-block text-xs"
            style={{
              background: survey.complaint_status === "resolved" ? "#f0fdf4" : "#eff6ff",
              color:      survey.complaint_status === "resolved" ? "#16a34a" : "#2563eb",
            }}>
            Status: {survey.complaint_status?.replace("_", " ")}
          </div>
        </div>

        {/* Star rating */}
        <div className="bg-surface-container-low rounded-2xl p-6 border border-outline-variant text-center">
          <p className="text-sm font-semibold text-on-surface mb-4">How would you rate the work done?</p>
          <StarRating value={rating} onChange={setRating} />
          {rating > 0 && (
            <p className="mt-3 text-sm font-semibold" style={{
              color: rating <= 2 ? "#ef4444" : rating === 3 ? "#f97316" : "#10b981"
            }}>
              {RATING_LABELS[rating]}
            </p>
          )}
        </div>

        {/* Is resolved? (closing survey) */}
        {isClosing && (
          <div className="bg-surface-container-low rounded-2xl p-5 border border-outline-variant">
            <p className="text-sm font-semibold text-on-surface mb-3">Was the issue actually fixed?</p>
            <div className="grid grid-cols-2 gap-3">
              {[
                { val: true,  label: "✅ Yes, it's fixed",  color: "#10b981" },
                { val: false, label: "❌ No, still there",  color: "#ef4444" },
              ].map(opt => (
                <button key={String(opt.val)} type="button"
                  onClick={() => setIsResolved(opt.val)}
                  className="py-3 rounded-xl border-2 text-sm font-semibold transition"
                  style={{
                    borderColor: isResolved === opt.val ? opt.color : "#e2e8f0",
                    background:  isResolved === opt.val ? opt.color + "15" : "transparent",
                    color:       isResolved === opt.val ? opt.color : "#64748b",
                  }}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Wants follow-up? (only if not resolved) */}
        {isClosing && isResolved === false && (
          <div className="bg-orange-50 rounded-2xl p-5 border border-orange-200">
            <p className="text-sm font-semibold text-orange-800 mb-3">Would you like a follow-up from the department?</p>
            <div className="grid grid-cols-2 gap-3">
              {[
                { val: true,  label: "Yes, please follow up" },
                { val: false, label: "No, it's fine" },
              ].map(opt => (
                <button key={String(opt.val)} type="button"
                  onClick={() => setWantsFollowup(opt.val)}
                  className={`py-2.5 rounded-xl border text-sm font-semibold transition ${
                    wantsFollowup === opt.val
                      ? "border-orange-500 bg-orange-100 text-orange-700"
                      : "border-orange-200 bg-white text-orange-600"
                  }`}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Feedback text */}
        <div className="bg-surface-container-low rounded-2xl p-5 border border-outline-variant">
          <p className="text-sm font-semibold text-on-surface mb-2">Any additional comments? (optional)</p>
          <textarea
            value={feedback}
            onChange={e => setFeedback(e.target.value)}
            placeholder="Tell us about your experience, what could be improved…"
            className="w-full h-28 px-4 py-3 rounded-xl border border-outline-variant bg-surface text-sm resize-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            maxLength={500}
          />
          <p className="text-[10px] text-on-surface-variant mt-1 text-right">{feedback.length}/500</p>
        </div>

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={submitting || rating === 0 || (isClosing && isResolved === null)}
          className="w-full py-4 bg-primary text-on-primary rounded-2xl font-bold text-base shadow-lg shadow-primary/20 hover:bg-primary/90 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? "Submitting…" : "Submit Feedback"}
        </button>

        <p className="text-center text-xs text-on-surface-variant">
          Your feedback helps improve civic services in Delhi 🌿
        </p>
      </div>
    </div>
  );
}