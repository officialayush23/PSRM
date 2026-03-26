import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import Map, { Marker, NavigationControl } from "react-map-gl";
import {
  fetchInfraNodeAiSummary,
  fetchNodeHistory,
  fetchNodeRepeatIssues,
} from "../api/adminApi";

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

function GCard({ children, className = "", style = {} }) {
  return (
    <div className={`rounded-2xl p-5 ${className}`}
      style={{ background: "rgba(255,255,255,0.7)", backdropFilter: "blur(20px)", border: "1px solid rgba(0,0,0,0.08)", boxShadow: "0 4px 24px rgba(0,0,0,0.06)", ...style }}>
      {children}
    </div>
  );
}

export default function InfraNodeDetailPage() {
  const { nodeId } = useParams();

  const [history,    setHistory]    = useState(null);
  const [repeatRisk, setRepeatRisk] = useState(null);
  const [aiData,     setAiData]     = useState(null);
  const [aiOpen,     setAiOpen]     = useState(false);
  const [loadingAi,  setLoadingAi]  = useState(false);

  useEffect(() => {
    let mounted = true;
    async function load() {
      const [h, r] = await Promise.all([fetchNodeHistory(nodeId), fetchNodeRepeatIssues(nodeId)]);
      if (!mounted) return;
      setHistory(h);
      setRepeatRisk(r);
    }
    load();
    return () => { mounted = false; };
  }, [nodeId]);

  const nodeLocation = useMemo(() => {
    const first = history?.complaints?.find(c => c.lat != null && c.lng != null);
    if (!first) return null;
    return { lat: Number(first.lat), lng: Number(first.lng) };
  }, [history]);

  const activeWorkflow = history?.workflow_instances?.find(w =>
    ["active", "paused", "constraint_blocked"].includes(w.status)
  );

  const loadAi = async () => {
    if (aiData || loadingAi || !nodeId) return;
    setLoadingAi(true);
    try {
      const data = await fetchInfraNodeAiSummary(nodeId);
      setAiData(data);
    } finally {
      setLoadingAi(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl flex flex-col gap-4 p-4">
      {/* Header */}
      <GCard>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: "rgba(56,189,248,0.15)" }}>
            <span className="material-symbols-outlined text-sky-400">lan</span>
          </div>
          <div>
            <h1 className="text-lg font-semibold text-slate-800">Infra Node Detail</h1>
            <p className="text-xs font-mono text-slate-500">ID: {nodeId}</p>
          </div>
        </div>
      </GCard>

      {/* Repeat Risk */}
      {repeatRisk && (
        <GCard style={{ background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.25)" }}>
          <div className="flex items-center gap-2 mb-2">
            <span className="material-symbols-outlined text-amber-400 text-[18px]">warning</span>
            <p className="text-sm font-semibold text-amber-300">Repeat Risk</p>
          </div>
          <p className="text-sm text-amber-200/80">
            {repeatRisk.is_within_warranty
              ? "This node appears within repeat/warranty risk window."
              : "No active repeat warranty risk currently."}
          </p>
          <p className="mt-1 text-xs text-amber-400/60">
            Last resolved: {repeatRisk.last_resolved_at || "—"} · Gap days: {repeatRisk.gap_days ?? "—"}
          </p>
        </GCard>
      )}

      {/* Complaint Timeline */}
      <GCard>
        <h2 className="text-sm font-semibold text-white mb-3">Complaint Timeline</h2>
        <div className="flex flex-col gap-2">
          {(history?.complaints || []).map(c => (
            <div key={c.id} className="rounded-xl p-3"
              style={{ background: "rgba(0,0,0,0.04)", border: "1px solid rgba(0,0,0,0.06)" }}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-slate-700">{c.complaint_number}</p>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase"
                  style={{ background: "rgba(0,0,0,0.06)", color: "#64748b" }}>
                  {c.status}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-400">{c.title}</p>
              <p className="mt-1 text-[11px] text-slate-600">Created: {c.created_at || "—"}</p>
            </div>
          ))}
          {!history?.complaints?.length && (
            <p className="text-sm text-slate-600">No complaints linked yet.</p>
          )}
        </div>
      </GCard>

      {/* Active Workflow */}
      <GCard>
        <h2 className="text-sm font-semibold text-slate-800 mb-2">Active Workflow</h2>
        {activeWorkflow ? (
          <div className="rounded-xl p-3 text-sm"
            style={{ background: "rgba(56,189,248,0.08)", border: "1px solid rgba(56,189,248,0.15)" }}>
            <p className="text-slate-600">ID: <span className="font-mono text-xs text-slate-400">{activeWorkflow.id}</span></p>
            <p className="text-slate-300 mt-1">Status: <span className="text-sky-400 font-medium">{activeWorkflow.status}</span></p>
            <p className="text-slate-500 text-xs mt-1">Created: {activeWorkflow.created_at || "—"}</p>
          </div>
        ) : (
          <p className="text-sm text-slate-600">No active workflow instance.</p>
        )}
      </GCard>

      {/* AI Analysis */}
      <GCard>
        <div className="flex items-center justify-between gap-2 mb-3">
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <span className="material-symbols-outlined text-[16px] text-violet-400">auto_awesome</span>
            AI Analysis
          </h2>
          <button type="button"
            onClick={() => { const next = !aiOpen; setAiOpen(next); if (next) loadAi(); }}
            className="px-3 py-1.5 rounded-xl text-xs font-medium text-white transition-colors"
            style={{ background: aiOpen ? "rgba(139,92,246,0.15)" : "rgba(0,0,0,0.05)", border: "1px solid rgba(139,92,246,0.25)" }}>
            {aiOpen ? "Hide" : "Load AI Analysis"}
          </button>
        </div>
        {aiOpen && (
          loadingAi ? (
            <div className="flex items-center gap-2 text-slate-500 text-sm">
              <span className="material-symbols-outlined animate-spin text-[16px]">progress_activity</span>
              Loading AI analysis…
            </div>
          ) : (
            <pre className="overflow-x-auto rounded-xl p-3 text-xs text-slate-300"
              style={{ background: "rgba(248,250,252,0.8)", border: "1px solid rgba(0,0,0,0.06)" }}>
              {JSON.stringify(aiData || {}, null, 2)}
            </pre>
          )
        )}
      </GCard>

      {/* Map */}
      <GCard>
        <h2 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
          <span className="material-symbols-outlined text-[16px] text-sky-400">map</span>
          Location
        </h2>
        <div className="rounded-xl overflow-hidden" style={{ height: 260, border: "1px solid rgba(0,0,0,0.08)" }}>
          <Map
            initialViewState={{
              longitude: nodeLocation?.lng || 77.209,
              latitude:  nodeLocation?.lat || 28.6139,
              zoom: nodeLocation ? 15 : 11,
              pitch: 40,
            }}
            mapStyle="mapbox://styles/mapbox/streets-v12"
            mapboxAccessToken={MAPBOX_TOKEN}
            style={{ width: "100%", height: "100%" }}>
            <NavigationControl position="top-right" showCompass visualizePitch />
            {nodeLocation && (
              <Marker longitude={nodeLocation.lng} latitude={nodeLocation.lat} anchor="center">
                <div style={{
                  width: 16, height: 16, borderRadius: "50%",
                  background: "#38bdf8", border: "3px solid white",
                  boxShadow: "0 0 12px rgba(56,189,248,0.8)",
                }} />
              </Marker>
            )}
          </Map>
        </div>
      </GCard>
    </div>
  );
}
