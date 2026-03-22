// src/pages/admin/AdminDashboardPage.jsx
// Unified dashboard for admin + super_admin
// Same UI — scope differs (dept vs city-wide)
// super_admin also sees official performance metrics

import { useEffect, useState, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import Map, { Marker, Source, Layer, NavigationControl } from "react-map-gl";
import AppLayout from "../../components/AppLayout";
import CRMAgentChat from "../../components/CRMAgentChat";
import { fetchAdminKPI, fetchDailyBriefing, fetchComplaintQueue } from "../../api/adminApi";
import { fetchAllComplaints } from "../../api/complaintsApi";
import { toast } from "sonner";

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

const STATUS_COLOR = {
  received: "#818cf8", workflow_started: "#38bdf8",
  in_progress: "#fb923c", resolved: "#34d399",
  closed: "#34d399", rejected: "#f87171",
  escalated: "#ef4444", emergency: "#dc2626",
};

const PRIORITY_COLOR = {
  normal: "#6366f1", high: "#f97316",
  critical: "#ef4444", emergency: "#dc2626",
};

function KPICard({ label, value, icon, color, sub, loading }) {
  return (
    <div className="bg-surface-container-low rounded-2xl p-5 border border-outline-variant flex flex-col gap-2"
      style={{ borderColor: color + "30" }}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">{label}</span>
        <span className="material-symbols-outlined text-[22px]" style={{ color }}>{icon}</span>
      </div>
      <p className="text-3xl font-headline font-bold text-on-surface">
        {loading ? "…" : value ?? 0}
      </p>
      {sub && <p className="text-xs text-on-surface-variant">{sub}</p>}
    </div>
  );
}

function AlertBanner({ section }) {
  const colors = {
    alert:   { bg: "#fef2f2", border: "#ef4444", text: "#b91c1c" },
    warning: { bg: "#fffbeb", border: "#f59e0b", text: "#92400e" },
    info:    { bg: "#eff6ff", border: "#3b82f6", text: "#1d4ed8" },
  };
  const c = colors[section.type] || colors.info;
  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-xl border text-sm font-medium"
      style={{ background: c.bg, borderColor: c.border, color: c.text }}>
      <span className="flex-1">{section.title}</span>
      <span className="text-xs opacity-70">{section.action}</span>
    </div>
  );
}

function ComplaintRow({ complaint, onClick }) {
  const color = PRIORITY_COLOR[complaint.priority] || "#6366f1";
  return (
    <div onClick={onClick} className="flex items-center gap-3 p-3 rounded-xl hover:bg-surface-container transition cursor-pointer border border-transparent hover:border-outline-variant/20">
      <div className="w-2 h-8 rounded-full flex-shrink-0" style={{ background: color }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-xs font-mono text-on-surface-variant">#{complaint.complaint_number}</span>
          <span className="text-xs px-1.5 py-0.5 rounded-full capitalize font-semibold"
            style={{ background: color + "20", color }}>
            {complaint.priority}
          </span>
          {complaint.is_repeat_complaint && (
            <span className="text-xs text-red-500 font-semibold">↩ Repeat</span>
          )}
        </div>
        <p className="text-sm font-medium text-on-surface truncate">{complaint.title}</p>
        <p className="text-xs text-on-surface-variant truncate">
          {complaint.address_text || complaint.jurisdiction_name}
        </p>
      </div>
      <div className="text-right flex-shrink-0">
        <p className="text-xs font-semibold capitalize px-2 py-0.5 rounded-full"
          style={{ background: (STATUS_COLOR[complaint.status] || "#6366f1") + "20", color: STATUS_COLOR[complaint.status] || "#6366f1" }}>
          {complaint.status?.replace("_", " ")}
        </p>
        {complaint.mapping_confidence && (
          <p className="text-[10px] text-on-surface-variant mt-0.5">
            {Math.round(complaint.mapping_confidence * 100)}% conf
          </p>
        )}
      </div>
    </div>
  );
}

export default function AdminDashboardPage() {
  const navigate = useNavigate();
  const user     = JSON.parse(localStorage.getItem("auth_user") || "{}");
  const isSuperAdmin = user.role === "super_admin";

  const [kpi,         setKpi]         = useState(null);
  const [briefing,    setBriefing]    = useState(null);
  const [complaints,  setComplaints]  = useState([]);
  const [mapPins,     setMapPins]     = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [mapLoaded,   setMapLoaded]   = useState(false);
  const [activeFilter,setActiveFilter]= useState("all");

  const DELHI_VIEW = { longitude: 77.209, latitude: 28.6139, zoom: 11, pitch: 45, bearing: -15 };

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [kpiData, briefingData, queueData, pinsData] = await Promise.all([
          fetchAdminKPI(),
          fetchDailyBriefing(),
          fetchComplaintQueue({ limit: 20 }),
          fetchAllComplaints({ }),
        ]);
        setKpi(kpiData);
        setBriefing(briefingData);
        setComplaints(queueData.items || []);
        setMapPins(pinsData || []);
      } catch {
        toast.error("Failed to load dashboard");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const filteredComplaints = useMemo(() => {
    if (activeFilter === "all") return complaints;
    if (activeFilter === "critical") return complaints.filter(c => ["critical","emergency"].includes(c.priority));
    if (activeFilter === "repeat")   return complaints.filter(c => c.is_repeat_complaint);
    if (activeFilter === "stale")    return complaints.filter(c =>
      c.status === "received" &&
      new Date(c.created_at) < new Date(Date.now() - 3 * 86400000)
    );
    return complaints;
  }, [complaints, activeFilter]);

  const BUILDINGS_LAYER = {
    id: "3d-buildings", source: "composite", "source-layer": "building",
    filter: ["==", "extrude", "true"], type: "fill-extrusion", minzoom: 12,
    paint: {
      "fill-extrusion-color": ["interpolate", ["linear"], ["get", "height"],
        0, "#dde3ea", 40, "#c5cdd8", 100, "#9aaabb"],
      "fill-extrusion-height":  ["get", "height"],
      "fill-extrusion-base":    ["get", "min_height"],
      "fill-extrusion-opacity": 0.7,
    },
  };

  return (
    <AppLayout>
      <div className="flex flex-col gap-6 p-6 min-h-0">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-headline font-bold text-on-surface">
              {isSuperAdmin ? "Commissioner Dashboard" : "Department Dashboard"}
            </h1>
            <p className="text-sm text-on-surface-variant mt-0.5">
              {user.full_name} · {isSuperAdmin ? "City-wide view" : "Department view"}
            </p>
          </div>
          <Link to="/admin/complaints"
            className="bg-primary text-on-primary px-5 py-2.5 rounded-full text-sm font-semibold hover:bg-primary/90 transition flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px]">queue</span>
            Complaint Queue
          </Link>
        </div>

        {/* AI Briefing */}
        {briefing && (
          <div className="bg-gradient-to-r from-primary/10 to-primary/5 rounded-2xl p-5 border border-primary/20">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                <span className="material-symbols-outlined text-white text-[20px]">smart_toy</span>
              </div>
              <div className="flex-1">
                <p className="text-xs font-semibold text-primary mb-1">AI Morning Briefing</p>
                <p className="text-sm text-on-surface leading-relaxed">{briefing.greeting}</p>
              </div>
            </div>
            {briefing.sections?.length > 0 && (
              <div className="mt-4 flex flex-col gap-2">
                {briefing.sections.map((s, i) => <AlertBanner key={i} section={s} />)}
              </div>
            )}
          </div>
        )}

        {/* KPI grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          <KPICard label="Open"         value={kpi?.summary?.open_complaints}    icon="inbox"          color="#6366f1" loading={loading} />
          <KPICard label="Critical"     value={kpi?.summary?.critical_count}     icon="warning"        color="#ef4444" loading={loading}
            sub={kpi?.summary?.critical_count > 0 ? "Needs immediate action" : "All clear"} />
          <KPICard label="Repeat"       value={kpi?.summary?.repeat_count}       icon="replay"         color="#f97316" loading={loading} />
          <KPICard label="SLA Risk"     value={kpi?.summary?.sla_at_risk}        icon="timer_off"      color="#dc2626" loading={loading}
            sub=">30 days open" />
          <KPICard label="Resolved"     value={kpi?.summary?.resolved_complaints} icon="check_circle"  color="#10b981" loading={loading}
            sub={kpi?.summary?.avg_resolution_days ? `Avg ${kpi.summary.avg_resolution_days}d` : ""} />
        </div>

        {/* Two column layout */}
        <div className="flex flex-col lg:flex-row gap-6">

          {/* Left: Map */}
          <div className="lg:w-[55%] flex flex-col gap-4">
            <div className="bg-surface-container-low rounded-2xl border border-outline-variant overflow-hidden" style={{ height: 420 }}>
              <Map
                initialViewState={DELHI_VIEW}
                mapboxAccessToken={MAPBOX_TOKEN}
                mapStyle="mapbox://styles/mapbox/streets-v12"
                style={{ width: "100%", height: "100%" }}
                onLoad={() => setMapLoaded(true)}
                attributionControl={false}
              >
                <NavigationControl position="bottom-right" showCompass visualizePitch />
                {mapLoaded && <Layer {...BUILDINGS_LAYER} />}
                {mapPins.map(pin => (
                  <Marker key={pin.id} longitude={pin.lng} latitude={pin.lat} anchor="bottom">
                    <div
                      onClick={() => navigate(`/admin/complaints/${pin.id}`)}
                      style={{
                        width:        12, height: 12, borderRadius: "50%",
                        background:   STATUS_COLOR[pin.status] || "#6366f1",
                        border:       "1.5px solid white",
                        cursor:       "pointer",
                        boxShadow:    `0 0 6px ${STATUS_COLOR[pin.status] || "#6366f1"}80`,
                      }}
                    />
                  </Marker>
                ))}
              </Map>
            </div>

            {/* Infra breakdown */}
            {kpi?.top_infra_types?.length > 0 && (
              <div className="bg-surface-container-low rounded-2xl p-5 border border-outline-variant">
                <h3 className="font-headline font-semibold text-on-surface mb-3 flex items-center gap-2">
                  <span className="material-symbols-outlined text-[18px] text-primary">category</span>
                  Top Infrastructure Issues
                </h3>
                <div className="flex flex-col gap-2">
                  {kpi.top_infra_types.map(it => {
                    const max = kpi.top_infra_types[0].count;
                    const pct = Math.round((it.count / max) * 100);
                    return (
                      <div key={it.code} className="flex items-center gap-3">
                        <span className="text-sm text-on-surface-variant w-28 truncate">{it.infra_type}</span>
                        <div className="flex-1 h-2 bg-outline-variant/30 rounded-full overflow-hidden">
                          <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-sm font-bold text-on-surface w-8 text-right">{it.count}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Right: Complaint queue */}
          <div className="lg:w-[45%] flex flex-col gap-4">
            <div className="bg-surface-container-low rounded-2xl p-5 border border-outline-variant flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <h3 className="font-headline font-semibold text-on-surface flex items-center gap-2">
                  <span className="material-symbols-outlined text-[18px] text-primary">queue</span>
                  Complaint Queue
                </h3>
                <Link to="/admin/complaints" className="text-primary text-xs hover:underline">View all →</Link>
              </div>

              {/* Filter chips */}
              <div className="flex gap-2 flex-wrap">
                {[
                  { key: "all",      label: "All" },
                  { key: "critical", label: "🔴 Critical" },
                  { key: "repeat",   label: "↩ Repeat" },
                  { key: "stale",    label: "⏰ Stale" },
                ].map(f => (
                  <button key={f.key} onClick={() => setActiveFilter(f.key)}
                    className={`px-3 py-1 rounded-full text-xs font-semibold transition ${
                      activeFilter === f.key
                        ? "bg-primary text-on-primary"
                        : "bg-surface-container border border-outline-variant text-on-surface-variant hover:bg-surface-container-high"
                    }`}>
                    {f.label}
                  </button>
                ))}
              </div>

              {/* Complaint list */}
              <div className="flex flex-col gap-1 max-h-96 overflow-y-auto">
                {loading ? (
                  Array(5).fill(0).map((_, i) => (
                    <div key={i} className="h-14 rounded-xl bg-outline-variant/20 animate-pulse" />
                  ))
                ) : filteredComplaints.length === 0 ? (
                  <p className="text-sm text-on-surface-variant text-center py-8">No complaints in this filter</p>
                ) : filteredComplaints.map(c => (
                  <ComplaintRow
                    key={c.id}
                    complaint={c}
                    onClick={() => navigate(`/admin/complaints/${c.id}`)}
                  />
                ))}
              </div>
            </div>

            {/* Status breakdown */}
            {kpi?.status_breakdown?.length > 0 && (
              <div className="bg-surface-container-low rounded-2xl p-5 border border-outline-variant">
                <h3 className="font-headline font-semibold text-on-surface mb-3 flex items-center gap-2">
                  <span className="material-symbols-outlined text-[18px] text-primary">donut_small</span>
                  Status Breakdown
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  {kpi.status_breakdown.map(s => (
                    <div key={s.status} className="flex items-center gap-2 py-1.5 px-3 rounded-xl bg-surface-container">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ background: STATUS_COLOR[s.status] || "#6366f1" }} />
                      <span className="text-xs text-on-surface-variant capitalize flex-1">
                        {s.status.replace("_", " ")}
                      </span>
                      <span className="text-xs font-bold text-on-surface">{s.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Super admin: oldest open complaints */}
            {isSuperAdmin && briefing?.oldest_open?.length > 0 && (
              <div className="bg-red-50 rounded-2xl p-5 border border-red-200">
                <h3 className="font-headline font-semibold text-red-700 mb-3 flex items-center gap-2">
                  <span className="material-symbols-outlined text-[18px]">priority_high</span>
                  Oldest Open Complaints
                </h3>
                {briefing.oldest_open.map((c, i) => (
                  <div key={i} className="flex items-center gap-2 py-1.5 border-b border-red-100 last:border-0">
                    <span className="text-xs font-mono text-red-400">#{c.complaint_number}</span>
                    <span className="text-sm text-red-800 truncate flex-1">{c.title}</span>
                    <span className="text-xs font-bold text-red-600">{c.age_days}d</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* CRM Chat */}
      <CRMAgentChat />
    </AppLayout>
  );
}