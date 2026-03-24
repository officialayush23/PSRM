import React, { useEffect, useMemo, useState } from "react";
import { MapPin, TriangleAlert } from "lucide-react";
import { useParams } from "react-router-dom";
import Map, { Marker, NavigationControl } from "react-map-gl";

import {
  fetchInfraNodeAiSummary,
  fetchNodeHistory,
  fetchNodeRepeatIssues,
} from "../api/adminApi";

export default function InfraNodeDetailPage() {
  const { nodeId } = useParams();

  const [history, setHistory] = useState(null);
  const [repeatRisk, setRepeatRisk] = useState(null);
  const [aiData, setAiData] = useState(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [loadingAi, setLoadingAi] = useState(false);

  useEffect(() => {
    let mounted = true;
    async function load() {
      const [h, r] = await Promise.all([fetchNodeHistory(nodeId), fetchNodeRepeatIssues(nodeId)]);
      if (!mounted) return;
      setHistory(h);
      setRepeatRisk(r);
    }
    load();
    return () => {
      mounted = false;
    };
  }, [nodeId]);

  const nodeLocation = useMemo(() => {
    const first = history?.complaints?.find((c) => c.lat != null && c.lng != null);
    if (!first) return null;
    return { lat: Number(first.lat), lng: Number(first.lng) };
  }, [history]);

  const activeWorkflow = history?.workflow_instances?.find((w) => ["active", "paused", "constraint_blocked"].includes(w.status));

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
    <div className="mx-auto max-w-6xl space-y-4 p-4">
      <header className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h1 className="text-lg font-semibold text-slate-900">Infra Node Detail</h1>
        <p className="text-xs text-slate-500">Node ID: {nodeId}</p>
      </header>

      {repeatRisk ? (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="mb-1 inline-flex items-center gap-2 text-amber-800">
            <TriangleAlert size={16} />
            <p className="text-sm font-semibold">Repeat Risk</p>
          </div>
          <p className="text-sm text-amber-900">
            {repeatRisk.is_within_warranty
              ? "This node appears within repeat/warranty risk window."
              : "No active repeat warranty risk currently."}
          </p>
          <p className="mt-1 text-xs text-amber-700">
            Last resolved: {repeatRisk.last_resolved_at || "-"} · Gap days: {repeatRisk.gap_days ?? "-"}
          </p>
        </section>
      ) : null}

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Complaint Timeline</h2>
        <div className="space-y-2">
          {(history?.complaints || []).map((c) => (
            <div key={c.id} className="rounded-lg border border-slate-200 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-slate-900">{c.complaint_number}</p>
                <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-700">{c.status}</span>
              </div>
              <p className="mt-1 text-xs text-slate-600">{c.title}</p>
              <p className="mt-1 text-[11px] text-slate-500">Created: {c.created_at || "-"}</p>
            </div>
          ))}
          {!history?.complaints?.length ? <p className="text-sm text-slate-500">No complaints linked yet.</p> : null}
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold text-slate-900">Active Workflow</h2>
        {activeWorkflow ? (
          <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
            <p>ID: {activeWorkflow.id}</p>
            <p>Status: {activeWorkflow.status}</p>
            <p>Created: {activeWorkflow.created_at || "-"}</p>
          </div>
        ) : (
          <p className="text-sm text-slate-500">No active workflow instance.</p>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900">AI Analysis</h2>
          <button
            type="button"
            onClick={() => {
              const next = !aiOpen;
              setAiOpen(next);
              if (next) loadAi();
            }}
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700"
          >
            {aiOpen ? "Hide" : "Load AI Analysis"}
          </button>
        </div>
        {aiOpen ? (
          loadingAi ? (
            <p className="text-sm text-slate-500">Loading AI analysis...</p>
          ) : (
            <pre className="overflow-x-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
              {JSON.stringify(aiData || {}, null, 2)}
            </pre>
          )
        ) : null}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-2 inline-flex items-center gap-1 text-sm font-semibold text-slate-900">
          <MapPin size={14} /> Map
        </h2>
        <div className="h-64 overflow-hidden rounded-lg border border-slate-200">
          <Map
            initialViewState={{
              longitude: nodeLocation?.lng || 77.209,
              latitude: nodeLocation?.lat || 28.6139,
              zoom: nodeLocation ? 15 : 11,
            }}
            mapStyle="mapbox://styles/mapbox/streets-v12"
            mapboxAccessToken={import.meta.env.VITE_MAPBOX_TOKEN}
          >
            <NavigationControl position="top-right" />
            {nodeLocation ? (
              <Marker longitude={nodeLocation.lng} latitude={nodeLocation.lat} color="#0f172a" />
            ) : null}
          </Map>
        </div>
      </section>
    </div>
  );
}
