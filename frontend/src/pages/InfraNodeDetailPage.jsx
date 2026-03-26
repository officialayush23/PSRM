// src/pages/InfraNodeDetailPage.jsx
// Full infra node detail page — requirements, photos, workflow approval, map

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Map, { Marker, NavigationControl } from "react-map-gl";
import {
  fetchInfraNodeSummary,
  fetchInfraNodeWorkflowSuggestions,
  approveInfraNodeWorkflow,
  rebuildNodeSummary,
} from "../api/adminApi";
import { toast } from "sonner";

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

const SEV_COLOR  = { critical:"#ef4444", high:"#f87171", medium:"#fb923c", low:"#34d399" };
const SEV_BG     = { critical:"rgba(239,68,68,0.1)", high:"rgba(248,113,113,0.1)", medium:"rgba(251,146,60,0.1)", low:"rgba(52,211,153,0.1)" };
const STATUS_COL = { received:"#818cf8", workflow_started:"#38bdf8", in_progress:"#fb923c", resolved:"#34d399", closed:"#34d399", rejected:"#f87171" };

function GCard({ children, className = "", style = {} }) {
  return (
    <div className={`rounded-2xl p-5 ${className}`}
      style={{ background:"rgba(255,255,255,0.8)", backdropFilter:"blur(20px)", border:"1px solid rgba(0,0,0,0.08)", boxShadow:"0 4px 24px rgba(0,0,0,0.06)", ...style }}>
      {children}
    </div>
  );
}

function SectionTitle({ icon, label }) {
  return (
    <h2 className="font-bold text-slate-800 text-sm flex items-center gap-2 mb-4">
      <span className="material-symbols-outlined text-[18px] text-sky-500">{icon}</span>
      {label}
    </h2>
  );
}

// ── Requirements panel ────────────────────────────────────────────

function RequirementsPanel({ requirements, severity }) {
  if (!requirements) return (
    <p className="text-sm text-slate-500 text-center py-6">
      No requirements summary yet — will generate after first complaint.
    </p>
  );

  const sevColor = SEV_COLOR[requirements.overall_severity] || "#94a3b8";

  return (
    <div className="flex flex-col gap-4">
      {/* Brief */}
      {requirements.brief && (
        <div className="rounded-xl p-4"
          style={{ background: SEV_BG[requirements.overall_severity] || "rgba(0,0,0,0.04)", border:`1px solid ${sevColor}30` }}>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: sevColor }}>
              {requirements.overall_severity?.toUpperCase()} severity
            </span>
          </div>
          <p className="text-sm text-slate-700 leading-relaxed">{requirements.brief}</p>
        </div>
      )}

      {/* Requirement list */}
      {(requirements.requirements || []).length > 0 && (
        <div className="flex flex-col gap-2">
          {requirements.requirements.map((r, i) => {
            const rc = SEV_COLOR[r.severity] || "#94a3b8";
            return (
              <div key={i} className="flex items-start gap-3 p-3 rounded-xl"
                style={{ background:"rgba(0,0,0,0.03)", border:"1px solid rgba(0,0,0,0.06)" }}>
                <span className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0"
                  style={{ background: rc, boxShadow:`0 0 6px ${rc}80` }} />
                <p className="flex-1 text-sm text-slate-700">{r.issue}</p>
                <div className="flex items-center gap-2 shrink-0">
                  {r.count > 1 && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                      style={{ background:"rgba(0,0,0,0.06)", color:"#64748b" }}>
                      {r.count}×
                    </span>
                  )}
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize"
                    style={{ background:`${rc}18`, color:rc, border:`1px solid ${rc}30` }}>
                    {r.severity}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Themes */}
      {(requirements.themes || []).length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {requirements.themes.map((t, i) => (
            <span key={i} className="text-[10px] px-2.5 py-1 rounded-full"
              style={{ background:"rgba(56,189,248,0.1)", color:"#0284c7", border:"1px solid rgba(56,189,248,0.2)" }}>
              {t}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Photos grid ───────────────────────────────────────────────────

function PhotosGrid({ photos }) {
  const [lightbox, setLightbox] = useState(null);

  if (!photos?.length) return (
    <p className="text-sm text-slate-500 text-center py-6">No photos uploaded yet.</p>
  );

  return (
    <>
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {photos.map((p, i) => (
          <button key={i} type="button" onClick={() => setLightbox(p)}
            className="rounded-xl overflow-hidden aspect-square relative group"
            style={{ border:"1px solid rgba(0,0,0,0.08)" }}>
            <img src={p.url} alt={p.complaint_number || "photo"}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-end">
              <span className="text-[9px] text-white font-bold px-1.5 py-1 bg-black/40 w-full truncate opacity-0 group-hover:opacity-100 transition-opacity">
                {p.complaint_number}
              </span>
            </div>
          </button>
        ))}
      </div>
      <p className="text-[11px] text-slate-500 mt-2">{photos.length} photo{photos.length !== 1 ? "s" : ""} from {new Set(photos.map(p => p.complaint_id)).size} complaint{new Set(photos.map(p => p.complaint_id)).size !== 1 ? "s" : ""}</p>

      {/* Lightbox */}
      {lightbox && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}>
          <div className="max-w-2xl w-full" onClick={e => e.stopPropagation()}>
            <img src={lightbox.url} alt="" className="w-full rounded-2xl max-h-[75vh] object-contain" />
            <div className="mt-3 flex items-center justify-between">
              <p className="text-white text-sm">{lightbox.complaint_number} · {lightbox.uploaded_at?.slice(0,10)}</p>
              <button onClick={() => setLightbox(null)}
                className="text-white/70 hover:text-white text-sm">Close ✕</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Workflow section ──────────────────────────────────────────────

function WorkflowSection({ nodeId, activeWorkflow }) {
  const [suggestions, setSuggestions]   = useState(null);
  const [loadingSugg, setLoadingSugg]   = useState(false);
  const [editMode, setEditMode]         = useState(false);
  const [editedSteps, setEditedSteps]   = useState([]);
  const [editReason, setEditReason]     = useState("");
  const [approving, setApproving]       = useState(false);
  const [expandedIdx, setExpandedIdx]   = useState(null);

  const load = async () => {
    setLoadingSugg(true);
    try {
      const d = await fetchInfraNodeWorkflowSuggestions(nodeId);
      setSuggestions(d);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to load suggestions");
    } finally {
      setLoadingSugg(false);
    }
  };

  const approve = async (sugg, isEdited) => {
    setApproving(true);
    try {
      const result = await approveInfraNodeWorkflow(nodeId, {
        templateId:  sugg.template_id,
        versionId:   sugg.version_id,
        editedSteps: isEdited ? editedSteps : null,
        editReason:  isEdited ? editReason  : null,
      });
      toast.success(`Workflow started! Linked ${result.complaints_linked} complaint${result.complaints_linked !== 1 ? "s" : ""}.`);
      setSuggestions(null);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to start workflow");
    } finally {
      setApproving(false);
    }
  };

  // Active workflow — just show status
  if (activeWorkflow) {
    const pct = Math.round((activeWorkflow.current_step_number / activeWorkflow.total_steps) * 100);
    return (
      <div className="rounded-xl p-4"
        style={{ background:"rgba(52,211,153,0.06)", border:"1px solid rgba(52,211,153,0.2)" }}>
        <div className="flex items-center gap-2 mb-2">
          <span className="material-symbols-outlined text-emerald-400 text-[18px]">account_tree</span>
          <span className="font-bold text-emerald-600 text-sm">Active Workflow</span>
        </div>
        <p className="font-semibold text-slate-700 text-sm">{activeWorkflow.template_name}</p>
        <div className="flex items-center gap-3 mt-3">
          <div className="flex-1 h-1.5 rounded-full overflow-hidden bg-black/8">
            <div className="h-full bg-emerald-500 rounded-full"
              style={{ width:`${pct}%`, boxShadow:"0 0 6px rgba(52,211,153,0.4)" }} />
          </div>
          <span className="text-xs text-emerald-500 font-semibold shrink-0">
            Step {activeWorkflow.current_step_number} / {activeWorkflow.total_steps}
          </span>
        </div>
      </div>
    );
  }

  // No workflow yet
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl p-4"
        style={{ background:"rgba(139,92,246,0.06)", border:"1px solid rgba(139,92,246,0.2)" }}>
        <p className="text-sm text-slate-600">
          No active workflow. Get AI-suggested workflows for this node — one workflow will cover
          <span className="font-semibold text-violet-600"> all open complaints</span> automatically.
        </p>
      </div>

      {!suggestions && !loadingSugg && (
        <button onClick={load}
          className="w-full py-3 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2"
          style={{ background:"linear-gradient(135deg,#7c3aed,#6d28d9)", boxShadow:"0 4px 14px rgba(124,58,237,0.3)" }}>
          <span className="material-symbols-outlined text-[18px]">auto_awesome</span>
          Get AI Workflow Suggestions
        </button>
      )}

      {loadingSugg && (
        <div className="flex items-center gap-3 py-4 justify-center text-violet-600 text-sm">
          <span className="material-symbols-outlined animate-spin text-[20px]">progress_activity</span>
          Matching workflows…
        </div>
      )}

      {suggestions && (
        <div className="flex flex-col gap-3">
          {suggestions.open_complaint_count != null && (
            <p className="text-xs text-slate-500">
              Will link <span className="font-semibold text-slate-700">{suggestions.open_complaint_count}</span> open complaint{suggestions.open_complaint_count !== 1 ? "s" : ""} to one workflow.
            </p>
          )}

          {editMode && expandedIdx !== null ? (
            <div className="rounded-xl p-4 bg-white border border-black/8">
              <div className="flex items-center justify-between mb-3">
                <p className="font-bold text-slate-800 text-sm">Edit Steps</p>
                <button onClick={() => setEditMode(false)} className="text-xs text-slate-400 hover:text-slate-600">Cancel</button>
              </div>
              {editedSteps.map((step, idx) => (
                <div key={idx} className="rounded-xl p-3 mb-2 bg-black/3 border border-black/6">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center"
                      style={{ background:"rgba(56,189,248,0.15)", color:"#0284c7" }}>{step.step_number}</span>
                    <input value={step.step_name}
                      onChange={e => { const ns=[...editedSteps]; ns[idx]={...ns[idx],step_name:e.target.value}; setEditedSteps(ns); }}
                      className="flex-1 px-2 py-1 text-sm rounded-lg ginput" />
                  </div>
                </div>
              ))}
              <textarea value={editReason} onChange={e => setEditReason(e.target.value)}
                placeholder="Reason for editing…" rows={2}
                className="w-full px-3 py-2 rounded-xl text-sm resize-none ginput mt-2 mb-3" />
              <button
                onClick={() => approve(suggestions.suggestions[expandedIdx], true)}
                disabled={!editReason || approving}
                className="w-full py-2.5 rounded-xl text-sm font-bold text-white gbtn-sky disabled:opacity-40">
                {approving ? "Starting…" : "Save & Start Workflow"}
              </button>
            </div>
          ) : (
            (suggestions.suggestions || []).map((sugg, i) => (
              <div key={i} className="rounded-xl overflow-hidden"
                style={{ background:"rgba(255,255,255,0.9)", border:"1px solid rgba(0,0,0,0.08)" }}>
                <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center"
                          style={{ background:"rgba(56,189,248,0.15)", color:"#0284c7" }}>{i+1}</span>
                        <span className="text-[11px] text-slate-500">
                          {Math.round((sugg.match_score || 0) * 100)}% match · {sugg.avg_completion_days?.toFixed(1)}d avg · {sugg.times_used}× used
                        </span>
                      </div>
                      <p className="font-bold text-slate-800 text-sm">{sugg.name}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{sugg.match_reason}</p>
                    </div>
                    <div className="flex flex-col gap-1.5 shrink-0">
                      <button onClick={() => approve(sugg, false)} disabled={approving}
                        className="px-3 py-1.5 rounded-lg text-xs font-bold gbtn-sky flex items-center gap-1">
                        <span className="material-symbols-outlined text-[13px]">check</span>
                        Approve
                      </button>
                      <button onClick={() => { setExpandedIdx(i); setEditedSteps(sugg.steps.map(s => ({...s}))); setEditMode(true); }}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold gbtn-ghost flex items-center gap-1">
                        <span className="material-symbols-outlined text-[13px]">edit</span>
                        Edit
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-col gap-0.5 mt-3">
                    {sugg.steps?.map((s, si) => (
                      <div key={si} className="flex items-center gap-2 text-xs py-1.5 border-t border-black/5">
                        <span className="w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center shrink-0"
                          style={{ background:"rgba(0,0,0,0.06)", color:"#64748b" }}>{s.step_number}</span>
                        <span className="text-slate-600 font-medium flex-1">{s.step_name}</span>
                        <span className="text-slate-500 text-[10px]">{s.dept_name}</span>
                        <span className="text-slate-500 text-[10px]">{s.expected_duration_hours}h</span>
                        {s.requires_tender && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                            style={{ background:"rgba(251,146,60,0.15)", color:"#fb923c" }}>Tender</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────

export default function InfraNodeDetailPage() {
  const { nodeId } = useParams();
  const navigate   = useNavigate();

  const [summary,   setSummary]   = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [rebuilding, setRebuilding] = useState(false);

  const user = JSON.parse(localStorage.getItem("auth_user") || "{}");
  const isAdmin = ["admin","super_admin"].includes(user.role);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    fetchInfraNodeSummary(nodeId)
      .then(d => { if (mounted) setSummary(d); })
      .catch(() => toast.error("Failed to load node"))
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [nodeId]);

  const node     = summary?.node;
  const reqs     = summary?.requirements;
  const photos   = summary?.photos || [];
  const complaints = summary?.complaints || [];

  const handleRebuild = async () => {
    if (!isAdmin) return;
    setRebuilding(true);
    try {
      await rebuildNodeSummary(nodeId);
      toast.success("Summary rebuilt! Reloading…");
      const d = await fetchInfraNodeSummary(nodeId);
      setSummary(d);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Rebuild failed");
    } finally {
      setRebuilding(false);
    }
  };

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center"
      style={{ background:"linear-gradient(135deg,#eef2ff,#f8faff,#f0f4ff)" }}>
      <span className="material-symbols-outlined animate-spin text-sky-400 text-4xl">progress_activity</span>
    </div>
  );

  if (!node) return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4"
      style={{ background:"linear-gradient(135deg,#eef2ff,#f8faff,#f0f4ff)" }}>
      <span className="material-symbols-outlined text-5xl text-slate-400">error</span>
      <p className="text-slate-500">Node not found</p>
      <button onClick={() => navigate(-1)} className="text-sky-400 hover:text-sky-500 text-sm">← Go back</button>
    </div>
  );

  const sevColor = SEV_COLOR[node.cluster_severity] || "#94a3b8";

  return (
    <div className="min-h-screen pb-12" style={{ background:"linear-gradient(135deg,#eef2ff,#f8faff,#f0f4ff)" }}>
      {/* Top bar */}
      <div className="sticky top-0 z-10 px-4 py-3 flex items-center gap-3"
        style={{ background:"rgba(255,255,255,0.9)", backdropFilter:"blur(20px)", borderBottom:"1px solid rgba(0,0,0,0.07)" }}>
        <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-slate-500 hover:text-sky-500 text-sm transition-colors">
          <span className="material-symbols-outlined text-[18px]">arrow_back</span>
          Back
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="font-bold text-slate-800 text-sm truncate">{node.infra_type_name}</h1>
          <p className="text-[10px] text-slate-500 font-mono">{nodeId}</p>
        </div>
        <div className="flex items-center gap-2">
          {node.cluster_severity && (
            <span className="text-[10px] font-bold px-2 py-1 rounded-full capitalize"
              style={{ background:`${sevColor}18`, color:sevColor, border:`1px solid ${sevColor}30` }}>
              {node.cluster_severity}
            </span>
          )}
          {isAdmin && (
            <button onClick={handleRebuild} disabled={rebuilding}
              title="Rebuild AI summary from complaints"
              className="w-8 h-8 rounded-xl flex items-center justify-center transition-colors disabled:opacity-40"
              style={{ background:"rgba(0,0,0,0.05)", border:"1px solid rgba(0,0,0,0.08)" }}>
              <span className={`material-symbols-outlined text-slate-500 text-[16px] ${rebuilding ? "animate-spin" : ""}`}>
                refresh
              </span>
            </button>
          )}
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-5 grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* ── Stats ── */}
        <GCard className="lg:col-span-2">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { l:"Total",    v:node.total_complaint_count, c:"#6366f1" },
              { l:"Resolved", v:node.total_resolved_count,  c:"#34d399" },
              { l:"Status",   v:node.status?.replace(/_/g," "), c:"#38bdf8" },
              { l:"Jurisdiction", v:node.jurisdiction_name||"—", c:"#8b5cf6" },
            ].map(s => (
              <div key={s.l} className="rounded-xl p-3 text-center"
                style={{ background:`${s.c}0a`, border:`1px solid ${s.c}22` }}>
                <p className="text-base font-black capitalize" style={{ color:s.c }}>{s.v ?? 0}</p>
                <p className="text-[10px] text-slate-500 mt-0.5">{s.l}</p>
              </div>
            ))}
          </div>
        </GCard>

        {/* ── Requirements ── */}
        <GCard>
          <SectionTitle icon="checklist" label="Citizen Requirements" />
          <RequirementsPanel requirements={reqs} severity={node.cluster_severity} />
          {node.cluster_summary_at && (
            <p className="text-[10px] text-slate-400 mt-3">
              Last updated {new Date(node.cluster_summary_at).toLocaleString("en-IN")}
            </p>
          )}
        </GCard>

        {/* ── Workflow ── */}
        <GCard>
          <SectionTitle icon="account_tree" label="Workflow" />
          <WorkflowSection nodeId={nodeId} activeWorkflow={summary?.active_workflow} />
        </GCard>

        {/* ── Photos ── */}
        <GCard className="lg:col-span-2">
          <SectionTitle icon="photo_library" label={`Photos (${photos.length})`} />
          <PhotosGrid photos={photos} />
        </GCard>

        {/* ── Complaint history ── */}
        <GCard className="lg:col-span-2">
          <SectionTitle icon="history" label={`Complaint History (${complaints.length})`} />
          <div className="flex flex-col gap-2 max-h-72 overflow-y-auto">
            {complaints.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-6">No complaints yet.</p>
            ) : complaints.map(c => (
              <div key={c.id} className="flex items-center gap-3 p-3 rounded-xl"
                style={{ background:"rgba(0,0,0,0.03)", border:"1px solid rgba(0,0,0,0.06)" }}>
                <div className="w-1.5 h-6 rounded-full shrink-0"
                  style={{ background: STATUS_COL[c.status] || "#6366f1" }} />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-800 text-xs truncate">{c.title}</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    {c.complaint_number} · {c.created_at ? new Date(c.created_at).toLocaleDateString("en-IN") : "—"}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {c.has_photos && <span className="material-symbols-outlined text-[14px] text-slate-400">photo_camera</span>}
                  {c.is_repeat_complaint && <span className="text-[10px] text-orange-400 font-bold">↩</span>}
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full capitalize"
                    style={{ background: `${STATUS_COL[c.status] || "#6366f1"}18`, color: STATUS_COL[c.status] || "#6366f1" }}>
                    {c.status?.replace(/_/g," ")}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </GCard>

        {/* ── Map ── */}
        {node.lat != null && node.lng != null && (
          <GCard className="lg:col-span-2">
            <SectionTitle icon="map" label="Location" />
            <div className="rounded-xl overflow-hidden" style={{ height:260, border:"1px solid rgba(0,0,0,0.08)" }}>
              <Map
                initialViewState={{ longitude:node.lng, latitude:node.lat, zoom:15, pitch:40 }}
                mapStyle="mapbox://styles/mapbox/streets-v12"
                mapboxAccessToken={MAPBOX_TOKEN}
                style={{ width:"100%", height:"100%" }}>
                <NavigationControl position="top-right" />
                <Marker longitude={node.lng} latitude={node.lat} anchor="center">
                  <div style={{ width:16, height:16, borderRadius:"50%", background:"#38bdf8", border:"3px solid white", boxShadow:"0 0 12px rgba(56,189,248,0.8)" }} />
                </Marker>
              </Map>
            </div>
            <p className="text-[11px] text-slate-400 mt-2">
              {node.lat.toFixed(5)}, {node.lng.toFixed(5)}
            </p>
          </GCard>
        )}

      </div>
    </div>
  );
}