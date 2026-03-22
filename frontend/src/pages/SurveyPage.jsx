// src/pages/SurveyPage.jsx
// Citizen survey page — opened via Firebase notification or email link
// Route: /survey/:surveyInstanceId

import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import client from "../api/client";
import { toast } from "sonner";
import { Card, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Textarea } from "../components/ui/textarea";

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
    if (survey.survey_type === "completion" && isResolved === null) {
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
        <Card className="max-w-sm w-full text-center border border-outline-variant shadow-sm text-foreground">
          <CardContent className="pt-8">
            <span className="material-symbols-outlined text-5xl text-muted-foreground block mb-3">sentiment_dissatisfied</span>
            <p className="font-semibold text-foreground mb-2">Survey Unavailable</p>
            <p className="text-sm text-muted-foreground mb-6">{error}</p>
            <Button onClick={() => navigate("/")} className="w-full h-10 rounded-full font-semibold">
              Go to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Submitted ────────────────────────────────────────────────
  if (submitted) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center p-4">
        <Card className="max-w-sm w-full text-center border border-outline-variant shadow-lg text-foreground">
          <CardContent className="pt-10">
            <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-5">
              <span className="material-symbols-outlined text-green-600 text-4xl">check_circle</span>
            </div>
            <h2 className="text-xl font-headline font-bold text-foreground mb-2">
              {rating >= 4 ? "Thank you! 🙏" : "Feedback Received"}
            </h2>
            <p className="text-sm text-muted-foreground mb-2">
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
            <p className="text-xs text-muted-foreground mb-6">
              Your rating: {"★".repeat(rating)}{"☆".repeat(5 - rating)} {RATING_LABELS[rating]}
            </p>
            <Button onClick={() => navigate("/")} className="w-full py-3 h-11 rounded-xl font-semibold">
              Back to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isClosing = survey.survey_type === "completion";
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
        <Card className="border border-outline-variant shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center gap-3 mb-3">
              <span className="text-3xl">{infraIcon}</span>
              <div>
                <p className="text-xs font-semibold text-muted-foreground">{survey.infra_type_name || "Civic Issue"}</p>
                <p className="text-xs font-mono text-primary">#{survey.complaint_number}</p>
              </div>
            </div>
            <p className="font-semibold text-foreground text-sm mb-1">{survey.complaint_title}</p>
            {survey.address_text && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <span className="material-symbols-outlined text-[12px]">location_on</span>
                {survey.address_text}
              </p>
            )}
            <div className="mt-2">
              <Badge variant={survey.complaint_status === "resolved" ? "default" : "secondary"}>
                Status: {survey.complaint_status?.replace("_", " ")}
              </Badge>
            </div>
          </CardContent>
        </Card>

        {/* Star rating */}
        <Card className="border-outline-variant text-center shadow-sm">
          <CardContent className="p-6">
            <p className="text-sm font-semibold text-foreground mb-4">How would you rate the work done?</p>
            <StarRating value={rating} onChange={setRating} />
            {rating > 0 && (
              <p className="mt-3 text-sm font-semibold" style={{
                color: rating <= 2 ? "#ef4444" : rating === 3 ? "#f97316" : "#10b981"
              }}>
                {RATING_LABELS[rating]}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Is resolved? (closing survey) */}
        {isClosing && (
          <Card className="border-outline-variant shadow-sm">
            <CardContent className="p-5">
              <p className="text-sm font-semibold text-foreground mb-3">Was the issue actually fixed?</p>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { val: true,  label: "✅ Yes, it's fixed",  color: "#10b981", bg: "rgba(16, 185, 129, 0.1)" },
                  { val: false, label: "❌ No, still there",  color: "#ef4444", bg: "rgba(239, 68, 68, 0.1)" },
                ].map(opt => (
                  <Button
                    key={String(opt.val)}
                    type="button"
                    variant="outline"
                    onClick={() => setIsResolved(opt.val)}
                    className="py-6 h-auto whitespace-normal rounded-xl border-2 text-sm font-semibold transition-all hover:bg-muted"
                    style={isResolved === opt.val ? {
                      borderColor: opt.color,
                      backgroundColor: opt.bg,
                      color: opt.color,
                    } : {}}
                  >
                    {opt.label}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Wants follow-up? (only if not resolved) */}
        {isClosing && isResolved === false && (
          <Card className="border-orange-200 bg-orange-50 shadow-sm">
            <CardContent className="p-5">
              <p className="text-sm font-semibold text-orange-800 mb-3">Would you like a follow-up from the department?</p>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { val: true,  label: "Yes, please follow up" },
                  { val: false, label: "No, it's fine" },
                ].map(opt => (
                  <Button
                    key={String(opt.val)}
                    type="button"
                    onClick={() => setWantsFollowup(opt.val)}
                    variant="outline"
                    className={`py-5 h-auto whitespace-normal rounded-xl border text-sm font-semibold transition-all ${
                      wantsFollowup === opt.val
                        ? "border-orange-500 bg-orange-100 text-orange-700 hover:bg-orange-100 hover:text-orange-700"
                        : "border-orange-200 bg-white text-orange-600 hover:bg-orange-50"
                    }`}
                  >
                    {opt.label}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Feedback text */}
        <Card className="border-outline-variant shadow-sm">
          <CardContent className="p-5">
            <p className="text-sm font-semibold text-foreground mb-2">Any additional comments? (optional)</p>
            <Textarea
              value={feedback}
              onChange={e => setFeedback(e.target.value)}
              placeholder="Tell us about your experience, what could be improved…"
              className="resize-none min-h-[110px]"
              maxLength={500}
            />
            <p className="text-[10px] text-muted-foreground mt-1 text-right">{feedback.length}/500</p>
          </CardContent>
        </Card>

        {/* Submit */}
        <Button
          onClick={handleSubmit}
          disabled={submitting || rating === 0 || (isClosing && isResolved === null)}
          className="w-full py-6 rounded-2xl font-bold text-base shadow-lg shadow-primary/20 transition-all hover:-translate-y-0.5 active:translate-y-0 disabled:transform-none disabled:opacity-50"
        >
          {submitting ? "Submitting…" : "Submit Feedback"}
        </Button>

        <p className="text-center text-xs text-muted-foreground">
          Your feedback helps improve civic services in Delhi 🌿
        </p>
      </div>
    </div>
  );
}