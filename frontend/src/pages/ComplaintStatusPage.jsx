import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import AppLayout from "../components/AppLayout";
import { fetchComplaintById, fetchComplaintHistory } from "../api/complaintsApi";

const STATUS_STEPS = [
  { key: "received",         label: "Registered" },
  { key: "clustered",        label: "Verified" },
  { key: "workflow_started", label: "Assigned" },
  { key: "in_progress",      label: "In Progress" },
  { key: "resolved",         label: "Resolved" },
  { key: "closed",           label: "Closed" },
];

const STATUS_BADGE = {
  received:          "bg-purple-100 text-purple-700",
  clustered:         "bg-purple-100 text-purple-700",
  mapped:            "bg-blue-100 text-blue-700",
  workflow_started:  "bg-blue-100 text-blue-700",
  in_progress:       "bg-orange-100 text-orange-700",
  midway_survey_sent:"bg-orange-100 text-orange-700",
  resolved:          "bg-green-100 text-green-700",
  closed:            "bg-green-100 text-green-700",
  rejected:          "bg-red-100 text-red-700",
  escalated:         "bg-red-100 text-red-700",
  emergency:         "bg-red-200 text-red-800",
  constraint_blocked:"bg-amber-100 text-amber-700",
};

function getStepIndex(status) {
  const idx = STATUS_STEPS.findIndex((s) => s.key === status);
  // Map some aliased statuses
  if (idx !== -1) return idx;
  if (status === "mapped" || status === "clustered") return 1;
  if (status === "midway_survey_sent") return 3;
  if (status === "closed") return 5;
  return 0;
}

function formatDateTime(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function ComplaintStatusPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [complaint, setComplaint] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [comp, hist] = await Promise.all([
          fetchComplaintById(id),
          fetchComplaintHistory(id).catch(() => []), // history may be empty
        ]);
        setComplaint(comp);
        setHistory(hist || []);
      } catch (e) {
        setError(e.response?.data?.detail || "Complaint not found.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64 text-on-surface-variant">
          <span className="material-symbols-outlined animate-spin text-4xl mr-3">progress_activity</span>
          Loading complaint…
        </div>
      </AppLayout>
    );
  }

  if (error || !complaint) {
    return (
      <AppLayout>
        <div className="flex flex-col items-center justify-center h-64 gap-4">
          <span className="material-symbols-outlined text-5xl text-error">error</span>
          <p className="text-on-surface-variant">{error || "Complaint not found"}</p>
          <button onClick={() => navigate(-1)} className="text-primary hover:underline text-sm">
            ← Go back
          </button>
        </div>
      </AppLayout>
    );
  }

  const activeStep = getStepIndex(complaint.status);
  const isResolved = ["resolved", "closed"].includes(complaint.status);
  const hasMapPoint = complaint.lat != null && complaint.lng != null;

  // Build a timestamp map from history: { new_status -> created_at }
  const timestampByStatus = {};
  for (const h of history) {
    if (h.new_status && !timestampByStatus[h.new_status]) {
      timestampByStatus[h.new_status] = h.created_at;
    }
  }
  // Always have the initial "received" timestamp from complaint.created_at
  if (!timestampByStatus["received"]) {
    timestampByStatus["received"] = complaint.created_at;
  }

  // Image: images is JSONB array of {url, storage, mime_type}
  const imageUrl =
    Array.isArray(complaint.images) && complaint.images.length > 0
      ? complaint.images[0]?.url || null
      : null;

  // SLA: resolved = 100%, else days-based against 41-day Delhi Mitra SLA
  const SLA_DAYS = 41;
  let slaPercent = 0;
  let slaLabel = "";
  if (isResolved && complaint.resolved_at) {
    slaPercent = 100;
    slaLabel = "Resolved";
  } else {
    const elapsed = Math.floor(
      (Date.now() - new Date(complaint.created_at).getTime()) / (1000 * 60 * 60 * 24)
    );
    slaPercent = Math.min(100, Math.round((elapsed / SLA_DAYS) * 100));
    const remaining = SLA_DAYS - elapsed;
    slaLabel = remaining > 0 ? `${remaining} days left` : "Overdue";
  }
  const circumference = 2 * Math.PI * 24;
  const slaOffset = circumference * (1 - slaPercent / 100);

  return (
    <AppLayout>
      <div className="p-6 max-w-5xl mx-auto flex flex-col gap-6 lg:flex-row">
        {/* ── LEFT ── */}
        <div className="flex flex-col gap-5 flex-1 min-w-0">
          {/* Back + header */}
          <div>
            <button
              onClick={() => navigate(-1)}
              className="flex items-center gap-1 text-on-surface-variant text-sm hover:text-primary mb-3 transition"
            >
              <span className="material-symbols-outlined text-[16px]">arrow_back</span>
              Back
            </button>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-headline font-bold text-on-surface">
                {complaint.complaint_number}
              </h1>
              <span
                className={`text-xs font-bold px-3 py-1 rounded-full capitalize ${
                  STATUS_BADGE[complaint.status] || "bg-gray-100 text-gray-700"
                }`}
              >
                {complaint.status.replace(/_/g, " ")}
              </span>
              {complaint.is_repeat_complaint && (
                <span className="text-xs font-bold px-3 py-1 rounded-full bg-red-100 text-red-700">
                  Repeat Complaint
                </span>
              )}
            </div>
            <p className="text-lg font-semibold text-on-surface mt-1">{complaint.title}</p>
            {complaint.address_text && (
              <p className="text-sm text-on-surface-variant mt-0.5">
                📍 {complaint.address_text}
              </p>
            )}
            <p className="text-xs text-on-surface-variant mt-1">
              Filed {formatDateTime(complaint.created_at)}
              {complaint.resolved_at && ` · Resolved ${formatDateTime(complaint.resolved_at)}`}
            </p>
          </div>

          {/* Image */}
          {imageUrl ? (
            <div className="rounded-2xl overflow-hidden border border-outline-variant max-h-64">
              <img
                src={imageUrl}
                alt="Complaint photo"
                className="w-full h-64 object-cover"
              />
            </div>
          ) : (
            <div className="rounded-2xl border border-outline-variant bg-surface-container h-40 flex items-center justify-center text-on-surface-variant">
              <span className="material-symbols-outlined text-4xl">image_not_supported</span>
            </div>
          )}

          {/* Description */}
          <div className="bg-surface-container-low border border-outline-variant rounded-2xl p-5">
            <h2 className="font-headline font-semibold text-on-surface mb-2 flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px] text-primary">description</span>
              Complaint Details
            </h2>
            <p className="text-sm text-on-surface leading-relaxed">{complaint.description}</p>
            {complaint.priority && (
              <div className="mt-3 flex items-center gap-2 text-xs">
                <span className="text-on-surface-variant">Priority:</span>
                <span
                  className={`font-semibold capitalize ${
                    { low: "text-slate-500", normal: "text-blue-600", high: "text-orange-600", critical: "text-red-600", emergency: "text-red-800" }[complaint.priority] || ""
                  }`}
                >
                  {complaint.priority}
                </span>
              </div>
            )}
          </div>

          {/* Infra node linkage */}
          {complaint.infra_node_id && (
            <div className="bg-surface-container-low border border-outline-variant rounded-2xl p-5">
              <h2 className="font-headline font-semibold text-on-surface mb-2 flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px] text-primary">lan</span>
                Linked Infrastructure Node
              </h2>
              <p className="text-sm text-on-surface">Node ID: {complaint.infra_node_id}</p>
              <p className="text-xs text-on-surface-variant mt-1">
                Workflow: {complaint.workflow_instance_id || "Not started"}
              </p>
            </div>
          )}

          {/* AI Summary */}
          {complaint.agent_summary && (
            <div className="bg-primary/5 border border-primary/20 rounded-2xl p-5">
              <h2 className="font-headline font-semibold text-primary mb-2 flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px]">auto_awesome</span>
                AI Summary
              </h2>
              <p className="text-sm text-on-surface leading-relaxed">{complaint.agent_summary}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 flex-wrap">
            {hasMapPoint && (
              <a
                href={`https://www.google.com/maps?q=${complaint.lat},${complaint.lng}`}
                target="_blank"
                rel="noreferrer"
                className="border border-outline-variant text-on-surface px-5 py-2.5 rounded-full text-sm font-semibold hover:bg-surface-container transition"
              >
                View on Map
              </a>
            )}
            <Link
              to="/submit"
              className="bg-primary text-on-primary px-5 py-2.5 rounded-full text-sm font-semibold hover:bg-primary/90 transition"
            >
              Report Another Issue
            </Link>
            <Link
              to="/my-complaints"
              className="border border-outline-variant text-on-surface px-5 py-2.5 rounded-full text-sm font-semibold hover:bg-surface-container transition"
            >
              My Complaints
            </Link>
          </div>
        </div>

        {/* ── RIGHT ── */}
        <div className="flex flex-col gap-5 lg:w-80">
          {/* SLA Ring */}
          <div className="bg-surface-container-low border border-outline-variant rounded-2xl p-5">
            <h2 className="font-headline font-semibold text-on-surface mb-4 flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px] text-primary">timer</span>
              Delhi Mitra SLA ({SLA_DAYS} days)
            </h2>
            <div className="flex items-center gap-5">
              <div className="relative w-16 h-16">
                <svg className="-rotate-90" width="64" height="64" viewBox="0 0 64 64">
                  <circle cx="32" cy="32" r="24" fill="none" stroke="#e8def8" strokeWidth="6" />
                  <circle
                    cx="32" cy="32" r="24" fill="none"
                    stroke={isResolved ? "#4CAF50" : slaPercent > 80 ? "#F44336" : "#6750A4"}
                    strokeWidth="6" strokeLinecap="round"
                    strokeDasharray={circumference} strokeDashoffset={slaOffset}
                  />
                </svg>
                <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-on-surface">
                  {slaPercent}%
                </span>
              </div>
              <div>
                <p className="text-sm font-medium text-on-surface">{slaLabel}</p>
                <p className="text-xs text-on-surface-variant mt-1">
                  {isResolved ? "Complaint resolved" : `Filed ${formatDateTime(complaint.created_at)}`}
                </p>
              </div>
            </div>
          </div>

          {/* Timeline */}
          <div className="bg-surface-container-low border border-outline-variant rounded-2xl p-5">
            <h2 className="font-headline font-semibold text-on-surface mb-4 flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px] text-primary">timeline</span>
              Activity Timeline
            </h2>
            <div className="flex flex-col gap-1">
              {STATUS_STEPS.map((step, idx) => {
                const done = idx <= activeStep;
                const current = idx === activeStep;
                const ts = timestampByStatus[step.key];
                return (
                  <div key={step.key} className="flex items-start gap-3">
                    <div className="flex flex-col items-center">
                      <div
                        className={`w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-[14px] ${
                          done
                            ? current
                              ? "bg-primary text-on-primary"
                              : "bg-green-500 text-white"
                            : "bg-outline-variant text-on-surface-variant"
                        }`}
                      >
                        <span className="material-symbols-outlined text-[14px]">
                          {done && !current ? "check" : current ? "radio_button_checked" : "radio_button_unchecked"}
                        </span>
                      </div>
                      {idx < STATUS_STEPS.length - 1 && (
                        <div
                          className={`w-0.5 h-8 mt-1 ${done ? "bg-primary/40" : "bg-outline-variant"}`}
                        />
                      )}
                    </div>
                    <div className="pb-4">
                      <p
                        className={`text-sm font-medium ${
                          done ? "text-on-surface" : "text-on-surface-variant"
                        }`}
                      >
                        {step.label}
                      </p>
                      {done && ts ? (
                        <p className="text-xs text-on-surface-variant">
                          {formatDateTime(ts)}
                        </p>
                      ) : done && !ts ? (
                        <p className="text-xs text-on-surface-variant">Completed</p>
                      ) : (
                        <p className="text-xs text-on-surface-variant">Pending</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
