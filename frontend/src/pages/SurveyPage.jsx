// src/pages/SurveyPage.jsx
// Citizen survey page — dark glassmorphism theme
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

const RATING_LABELS = ["", "Very Poor", "Poor", "Average", "Good", "Excellent"];
const RATING_COLORS = ["", "#ef4444", "#f87171", "#fb923c", "#34d399", "#10b981"];

function StarRating({ value, onChange }) {
  const [hovered, setHovered] = useState(0);
  const active = hovered || value;
  return (
    <div className="flex gap-2 justify-center">
      {[1,2,3,4,5].map(star => (
        <button key={star} type="button"
          onClick={() => onChange(star)}
          onMouseEnter={() => setHovered(star)}
          onMouseLeave={() => setHovered(0)}
          className="text-4xl transition-all"
          style={{ transform: star <= active ? "scale(1.15)" : "scale(1)" }}>
          <span style={{ color: star <= active ? "#fbbf24" : "rgba(0,0,0,0.12)", filter: star <= active ? "drop-shadow(0 0 6px rgba(251,191,36,0.6))" : "none" }}>
            ★
          </span>
        </button>
      ))}
    </div>
  );
}

function GCard({ children, className = "", style = {} }) {
  return (
    <div className={`rounded-2xl p-5 ${className}`}
      style={{ background: "rgba(255,255,255,0.7)", backdropFilter: "blur(20px)", border: "1px solid rgba(0,0,0,0.08)", ...style }}>
      {children}
    </div>
  );
}

export default function SurveyPage() {
  const { surveyInstanceId } = useParams();
  const navigate = useNavigate();

  const [survey,     setSurvey]     = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted,  setSubmitted]  = useState(false);
  const [error,      setError]      = useState(null);

  const [rating,        setRating]        = useState(0);
  const [feedback,      setFeedback]      = useState("");
  const [isResolved,    setIsResolved]    = useState(null);
  const [wantsFollowup, setWantsFollowup] = useState(null);

  useEffect(() => {
    async function load() {
      try {
        const { data } = await client.get(`/surveys/${surveyInstanceId}`);
        setSurvey(data);
      } catch (err) {
        if (err.response?.status === 400) setError("This survey has already been completed.");
        else if (err.response?.status === 404) setError("Survey not found. The link may have expired.");
        else setError("Failed to load survey. Please try again.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [surveyInstanceId]);

  const handleSubmit = async () => {
    if (rating === 0) { toast.error("Please provide a rating"); return; }
    if (survey.survey_type === "completion" && isResolved === null) {
      toast.error("Please indicate if the issue was resolved"); return;
    }
    setSubmitting(true);
    try {
      const { data } = await client.post(`/surveys/${surveyInstanceId}/submit`, {
        rating, feedback: feedback.trim() || null,
        is_resolved: isResolved, wants_followup: wantsFollowup,
      });
      setSubmitted(true);
      toast.success(data.message || "Thank you for your feedback!");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Submission failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const glassPage = { minHeight: "100vh", background: "linear-gradient(135deg,#eef2ff,#f8faff,#f0f4ff)", backgroundAttachment: "fixed" };

  // ── Loading ───────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={glassPage} className="flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <span className="material-symbols-outlined animate-spin text-sky-400 text-4xl">progress_activity</span>
          <p className="text-sm text-slate-400">Loading survey…</p>
        </div>
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────────────
  if (error) {
    return (
      <div style={glassPage} className="flex items-center justify-center p-4">
        <GCard className="max-w-sm w-full text-center">
          <span className="material-symbols-outlined text-5xl text-slate-600 block mb-3">sentiment_dissatisfied</span>
          <p className="font-semibold text-slate-800 mb-2">Survey Unavailable</p>
          <p className="text-sm text-slate-400 mb-6">{error}</p>
          <button onClick={() => navigate("/")}
            className="w-full py-3 rounded-xl text-sm font-bold text-white gbtn-sky">
            Go to Dashboard
          </button>
        </GCard>
      </div>
    );
  }

  // ── Submitted ─────────────────────────────────────────────────
  if (submitted) {
    return (
      <div style={glassPage} className="flex items-center justify-center p-4">
        <GCard className="max-w-sm w-full text-center">
          <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-5"
            style={{ background: "rgba(52,211,153,0.15)", boxShadow: "0 0 32px rgba(52,211,153,0.2)" }}>
            <span className="material-symbols-outlined text-emerald-400 text-4xl">check_circle</span>
          </div>
          <h2 className="text-xl font-bold text-slate-800 mb-2">
            {rating >= 4 ? "Thank you! 🙏" : "Feedback Received"}
          </h2>
          <p className="text-sm text-slate-400 mb-2">
            {rating >= 4
              ? "We're glad the civic issue was addressed to your satisfaction."
              : rating >= 3
              ? "We appreciate your honest feedback and will work to improve."
              : "We've flagged this for investigation. An official will follow up."}
          </p>
          {rating < 3 && (
            <p className="text-xs px-4 py-2 rounded-xl mb-4"
              style={{ background: "rgba(251,146,60,0.12)", color: "#fb923c", border: "1px solid rgba(251,146,60,0.2)" }}>
              Your feedback has been escalated to the concerned official.
            </p>
          )}
          <p className="text-xs text-slate-500 mb-6">
            Your rating: {"★".repeat(rating)}{"☆".repeat(5 - rating)} {RATING_LABELS[rating]}
          </p>
          <button onClick={() => navigate("/")}
            className="w-full py-3 rounded-xl text-sm font-bold text-white gbtn-sky">
            Back to Dashboard
          </button>
        </GCard>
      </div>
    );
  }

  const isClosing = survey.survey_type === "completion";
  const infraIcon = INFRA_ICONS[survey.infra_type_code] || "📍";

  // ── Survey form ───────────────────────────────────────────────
  return (
    <div style={glassPage} className="pb-16">
      {/* Header */}
      <div className="px-5 py-6" style={{ background: "rgba(56,189,248,0.08)", borderBottom: "1px solid rgba(56,189,248,0.15)" }}>
        <div className="max-w-lg mx-auto">
          <p className="text-xs font-semibold text-sky-400/70 uppercase tracking-wider mb-1">PS-CRM · Citizen Survey</p>
          <h1 className="text-xl font-bold text-slate-800">{survey.survey_title}</h1>
          <p className="text-sm text-slate-400 mt-1">{survey.survey_description}</p>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 flex flex-col gap-5">
        {/* Complaint summary */}
        <GCard>
          <div className="flex items-center gap-3 mb-3">
            <span className="text-3xl">{infraIcon}</span>
            <div>
              <p className="text-xs font-semibold text-slate-500">{survey.infra_type_name || "Civic Issue"}</p>
              <p className="text-xs font-mono text-sky-400">#{survey.complaint_number}</p>
            </div>
          </div>
          <p className="font-semibold text-slate-800 text-sm mb-1">{survey.complaint_title}</p>
          {survey.address_text && (
            <p className="text-xs text-slate-500 flex items-center gap-1">
              <span className="material-symbols-outlined text-[12px]">location_on</span>
              {survey.address_text}
            </p>
          )}
          <div className="mt-2">
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase"
              style={{
                background: survey.complaint_status === "resolved" ? "rgba(52,211,153,0.15)" : "rgba(56,189,248,0.12)",
                color: survey.complaint_status === "resolved" ? "#34d399" : "#38bdf8",
              }}>
              {survey.complaint_status?.replace(/_/g, " ")}
            </span>
          </div>
        </GCard>

        {/* Star rating */}
        <GCard className="text-center">
          <p className="text-sm font-semibold text-slate-800 mb-4">How would you rate the work done?</p>
          <StarRating value={rating} onChange={setRating} />
          {rating > 0 && (
            <p className="mt-3 text-sm font-bold" style={{ color: RATING_COLORS[rating] }}>
              {RATING_LABELS[rating]}
            </p>
          )}
        </GCard>

        {/* Is resolved? */}
        {isClosing && (
          <GCard>
            <p className="text-sm font-semibold text-slate-800 mb-3">Was the issue actually fixed?</p>
            <div className="grid grid-cols-2 gap-3">
              {[
                { val: true,  label: "Yes, it's fixed",  color: "#34d399", bg: "rgba(52,211,153,0.15)" },
                { val: false, label: "No, still there",  color: "#f87171", bg: "rgba(248,113,113,0.15)" },
              ].map(opt => (
                <button key={String(opt.val)} type="button" onClick={() => setIsResolved(opt.val)}
                  className="py-5 rounded-xl text-sm font-semibold transition-all"
                  style={{
                    background: isResolved === opt.val ? opt.bg : "rgba(0,0,0,0.04)",
                    border: `1px solid ${isResolved === opt.val ? `${opt.color}40` : "rgba(0,0,0,0.08)"}`,
                    color: isResolved === opt.val ? opt.color : "#64748b",
                  }}>
                  {opt.label}
                </button>
              ))}
            </div>
          </GCard>
        )}

        {/* Wants follow-up? */}
        {isClosing && isResolved === false && (
          <GCard style={{ background: "rgba(251,146,60,0.08)", border: "1px solid rgba(251,146,60,0.2)" }}>
            <p className="text-sm font-semibold text-amber-300 mb-3">Would you like a follow-up from the department?</p>
            <div className="grid grid-cols-2 gap-3">
              {[
                { val: true,  label: "Yes, please follow up" },
                { val: false, label: "No, it's fine" },
              ].map(opt => (
                <button key={String(opt.val)} type="button" onClick={() => setWantsFollowup(opt.val)}
                  className="py-4 rounded-xl text-sm font-semibold transition-all"
                  style={{
                    background: wantsFollowup === opt.val ? "rgba(251,146,60,0.2)" : "rgba(0,0,0,0.04)",
                    border: `1px solid ${wantsFollowup === opt.val ? "rgba(251,146,60,0.4)" : "rgba(0,0,0,0.08)"}`,
                    color: wantsFollowup === opt.val ? "#fb923c" : "#64748b",
                  }}>
                  {opt.label}
                </button>
              ))}
            </div>
          </GCard>
        )}

        {/* Feedback text */}
        <GCard>
          <p className="text-sm font-semibold text-slate-800 mb-2">Any additional comments? (optional)</p>
          <textarea
            value={feedback}
            onChange={e => setFeedback(e.target.value)}
            placeholder="Tell us about your experience, what could be improved…"
            className="w-full px-4 py-3 rounded-xl text-sm resize-none ginput"
            style={{ minHeight: 110 }}
            maxLength={500} />
          <p className="text-[10px] text-slate-600 mt-1 text-right">{feedback.length}/500</p>
        </GCard>

        {/* Submit */}
        <button onClick={handleSubmit}
          disabled={submitting || rating === 0 || (isClosing && isResolved === null)}
          className="w-full py-5 rounded-2xl font-bold text-base text-white gbtn-sky disabled:opacity-40 transition-all hover:-translate-y-0.5 active:translate-y-0">
          {submitting ? "Submitting…" : "Submit Feedback"}
        </button>

        <p className="text-center text-xs text-slate-700">
          Your feedback helps improve civic services in Delhi 🌿
        </p>
      </div>
    </div>
  );
}
