// src/pages/PublicMapPage.jsx
// Public facing map — no auth required for viewing.
// Uses Mapbox 3D (react-map-gl) + real /complaints/all API data.
// Stats are also real from the same endpoint.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Map, { Marker, Popup, Layer, NavigationControl } from "react-map-gl";
import { fetchAllComplaints } from "../api/complaintsApi";

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;
const DELHI = { longitude: 77.209, latitude: 28.6139, zoom: 10.5, pitch: 45, bearing: -10 };

const BUILDINGS_LAYER = {
  id: "3d-buildings", source: "composite", "source-layer": "building",
  filter: ["==", "extrude", "true"], type: "fill-extrusion", minzoom: 12,
  paint: {
    "fill-extrusion-color": ["interpolate",["linear"],["get","height"],0,"#e2e8f0",40,"#cbd5e1",100,"#94a3b8"],
    "fill-extrusion-height": ["get","height"],
    "fill-extrusion-base":   ["get","min_height"],
    "fill-extrusion-opacity": 0.6,
  },
};

const PRIORITY_DOT = {
  emergency: "#dc2626",
  critical:  "#ef4444",
  high:      "#f97316",
  normal:    "#6366f1",
  low:       "#94a3b8",
};

const STATUS_COLOR = {
  received:         "#818cf8",
  workflow_started: "#38bdf8",
  in_progress:      "#fb923c",
  resolved:         "#34d399",
  closed:           "#34d399",
  rejected:         "#f87171",
};

const FILTER_OPTS = [
  { k:"all",       l:"All",         color:"#6366f1" },
  { k:"active",    l:"Active",      color:"#f97316" },
  { k:"critical",  l:"🔴 Critical", color:"#ef4444" },
  { k:"resolved",  l:"Resolved",    color:"#34d399" },
];

function StatCard({ label, value, icon, color, bg }) {
  return (
    <div className="p-3 rounded-xl border border-slate-100">
      <div className={`w-7 h-7 rounded-lg flex items-center justify-center mb-2`} style={{ background: bg }}>
        <span className="material-symbols-outlined text-sm" style={{ color }}>{icon}</span>
      </div>
      <p className="text-lg font-bold font-mono text-slate-900">{value}</p>
      <p className="text-[9px] text-slate-400 font-semibold uppercase tracking-wider mt-0.5">{label}</p>
    </div>
  );
}

export default function PublicMapPage() {
  const [pins,       setPins]       = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [mapLoaded,  setMapLoaded]  = useState(false);
  const [popup,      setPopup]      = useState(null);
  const [filter,     setFilter]     = useState("all");
  const [lastUpdate, setLastUpdate] = useState(null);

  useEffect(() => {
    fetchAllComplaints({}).then(data => {
      setPins(data || []);
      setLastUpdate(new Date());
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  // Derived stats
  const total     = pins.length;
  const active    = pins.filter(p => !["resolved","closed","rejected"].includes(p.status)).length;
  const critical  = pins.filter(p => ["critical","emergency"].includes(p.priority)).length;
  const resolved  = pins.filter(p => ["resolved","closed"].includes(p.status)).length;

  // Infra type breakdown
  const infraCounts = {};
  pins.forEach(p => {
    const k = p.infra_type_name || "General";
    infraCounts[k] = (infraCounts[k] || 0) + 1;
  });
  const topInfra = Object.entries(infraCounts)
    .sort((a,b) => b[1]-a[1])
    .slice(0,6);
  const maxCount = topInfra[0]?.[1] || 1;

  const visible = pins.filter(p => {
    if (filter === "all")      return true;
    if (filter === "active")   return !["resolved","closed","rejected"].includes(p.status);
    if (filter === "critical") return ["critical","emergency"].includes(p.priority);
    if (filter === "resolved") return ["resolved","closed"].includes(p.status);
    return true;
  });

  return (
    <div className="min-h-screen bg-white flex flex-col font-sans">
      {/* Top Nav */}
      <header className="flex items-center justify-between px-5 h-[56px] bg-white border-b border-slate-100 sticky top-0 z-50 shadow-sm">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-sky-600 flex items-center justify-center">
            <span className="material-symbols-outlined text-white text-[16px]">location_city</span>
          </div>
          <span className="font-black text-[17px] text-slate-900 tracking-tight">PS-CRM</span>
          <span className="hidden sm:block text-xs text-slate-400 ml-1 font-medium">Delhi Public Dashboard</span>
        </div>
        <div className="flex items-center gap-3">
          {!loading && lastUpdate && (
            <span className="hidden sm:flex items-center gap-1.5 text-[11px] text-slate-400 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              Updated {Math.floor((Date.now() - lastUpdate) / 60000) < 1 ? "just now" : `${Math.floor((Date.now() - lastUpdate) / 60000)}m ago`}
            </span>
          )}
          <Link to="/login"
            className="px-4 py-2 bg-sky-600 text-white rounded-lg text-sm font-bold hover:bg-sky-700 transition">
            Login to Report
          </Link>
        </div>
      </header>

      {/* Main layout */}
      <main className="flex-1 flex flex-col lg:flex-row">
        {/* ── Left Stats Panel ── */}
        <aside className="w-full lg:w-[340px] bg-white border-r border-slate-100 flex flex-col overflow-y-auto">
          <div className="p-5 border-b border-slate-50">
            <h2 className="font-black text-lg text-slate-900 mb-0.5">Delhi Live Civic Map</h2>
            <p className="text-xs text-slate-400">
              {loading ? "Loading live data…" : `${total} complaints across Delhi NCT`}
            </p>
          </div>

          {/* Stats grid */}
          <div className="p-4 grid grid-cols-2 gap-3 border-b border-slate-50">
            <StatCard label="Total Active"   value={loading?"…":active}   icon="pending_actions" color="#6366f1" bg="#6366f115" />
            <StatCard label="Resolved (all)" value={loading?"…":resolved} icon="check_circle"    color="#10b981" bg="#10b98115" />
            <StatCard label="Critical"       value={loading?"…":critical} icon="error"           color="#ef4444" bg="#ef444415" />
            <StatCard label="Total Filed"    value={loading?"…":total}    icon="receipt_long"    color="#0ea5e9" bg="#0ea5e915" />
          </div>

          {/* Infra breakdown */}
          {topInfra.length > 0 && (
            <div className="p-4 border-b border-slate-50">
              <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3">Category Breakdown</h3>
              <div className="space-y-2.5">
                {topInfra.map(([name, count]) => (
                  <div key={name}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="font-medium text-slate-600 truncate max-w-[180px]">{name}</span>
                      <span className="font-bold text-slate-800 ml-2">{count}</span>
                    </div>
                    <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-sky-500 rounded-full transition-all"
                        style={{ width: `${(count / maxCount) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Filter chips */}
          <div className="p-4 border-b border-slate-50">
            <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3">Filter Map</h3>
            <div className="flex flex-wrap gap-2">
              {FILTER_OPTS.map(f => (
                <button key={f.k} onClick={() => setFilter(f.k)}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold border transition ${
                    filter === f.k ? "text-white border-transparent" : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
                  }`}
                  style={{ background: filter === f.k ? f.color : undefined }}>
                  {f.l} {filter === f.k ? `(${visible.length})` : ""}
                </button>
              ))}
            </div>
          </div>

          {/* Legend */}
          <div className="p-4">
            <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3">Map Legend</h3>
            <div className="space-y-1.5 text-xs">
              {[
                { c:"#dc2626", l:"Emergency" },
                { c:"#ef4444", l:"Critical" },
                { c:"#f97316", l:"High Priority" },
                { c:"#6366f1", l:"Normal" },
                { c:"#34d399", l:"Resolved" },
              ].map(s => (
                <div key={s.l} className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: s.c }} />
                  <span className="text-slate-600">{s.l}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 p-3 bg-sky-50 rounded-xl border border-sky-100">
              <p className="text-xs text-sky-700 font-semibold mb-1">File a complaint</p>
              <p className="text-[11px] text-sky-600">Login to report a civic issue and track its resolution in real-time.</p>
              <Link to="/signup" className="mt-2 block text-xs font-bold text-sky-600 hover:text-sky-800">
                Create account →
              </Link>
            </div>
          </div>
        </aside>

        {/* ── Map ── */}
        <div className="flex-1 relative" style={{ minHeight: 500 }}>
          {MAPBOX_TOKEN ? (
            <Map
              initialViewState={DELHI}
              mapboxAccessToken={MAPBOX_TOKEN}
              mapStyle="mapbox://styles/mapbox/light-v11"
              style={{ width:"100%", height:"100%" }}
              onLoad={() => setMapLoaded(true)}
              attributionControl={false}
            >
              <NavigationControl position="bottom-right" showCompass visualizePitch />
              {mapLoaded && <Layer {...BUILDINGS_LAYER} />}

              {visible.map(pin => {
                const color = PRIORITY_DOT[pin.priority] || "#6366f1";
                const size  = ["emergency","critical"].includes(pin.priority) ? 14
                            : pin.priority === "high" ? 11 : 9;
                return (
                  <Marker key={pin.id} longitude={pin.lng} latitude={pin.lat} anchor="center">
                    <div
                      onClick={() => setPopup(pin)}
                      style={{
                        width:      size, height: size,
                        borderRadius:"50%",
                        background: color,
                        border:     "1.5px solid white",
                        cursor:     "pointer",
                        boxShadow:  `0 0 0 ${["emergency","critical"].includes(pin.priority)?3:0}px ${color}40`,
                      }}
                    />
                  </Marker>
                );
              })}

              {popup && (
                <Popup
                  longitude={popup.lng} latitude={popup.lat}
                  anchor="top" onClose={() => setPopup(null)}
                  closeButton={false}
                  className="rounded-xl shadow-xl"
                >
                  <div className="p-3 min-w-[200px]">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full capitalize"
                        style={{ background: (PRIORITY_DOT[popup.priority]||"#6366f1")+"18", color: PRIORITY_DOT[popup.priority]||"#6366f1" }}>
                        {popup.priority}
                      </span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full capitalize"
                        style={{ background: (STATUS_COLOR[popup.status]||"#6366f1")+"18", color: STATUS_COLOR[popup.status]||"#6366f1" }}>
                        {popup.status?.replace(/_/g," ")}
                      </span>
                    </div>
                    <p className="font-semibold text-slate-800 text-sm leading-tight">{popup.title}</p>
                    {popup.infra_type_name && (
                      <p className="text-[11px] text-sky-600 mt-1 font-medium">{popup.infra_type_name}</p>
                    )}
                    {popup.address_text && (
                      <p className="text-[11px] text-slate-400 mt-1 truncate max-w-[180px]">{popup.address_text}</p>
                    )}
                    {popup.is_repeat_complaint && (
                      <p className="text-[11px] text-orange-500 font-bold mt-1">↩ Repeat complaint</p>
                    )}
                    <Link to="/login"
                      className="mt-3 block text-center text-xs font-bold text-sky-600 hover:text-sky-800">
                      Login to track →
                    </Link>
                  </div>
                </Popup>
              )}
            </Map>
          ) : (
            /* Fallback if no Mapbox token */
            <div className="w-full h-full flex items-center justify-center bg-slate-50">
              <div className="text-center text-slate-400">
                <span className="material-symbols-outlined text-5xl block mb-2">map</span>
                <p className="text-sm font-medium">Map unavailable</p>
                <p className="text-xs mt-1">VITE_MAPBOX_TOKEN not configured</p>
              </div>
            </div>
          )}

          {/* Loading overlay */}
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/60 backdrop-blur-sm z-10">
              <div className="flex items-center gap-2 bg-white px-4 py-2.5 rounded-full shadow-lg border text-sm font-semibold text-slate-600">
                <span className="material-symbols-outlined animate-spin text-[18px] text-sky-500">progress_activity</span>
                Loading live data…
              </div>
            </div>
          )}

          {/* Pin count badge */}
          {!loading && (
            <div className="absolute bottom-4 left-4 bg-white/90 backdrop-blur-sm px-3 py-2 rounded-xl shadow-lg border border-slate-100 text-xs font-bold text-slate-600 z-10">
              {visible.length} of {total} complaints shown
            </div>
          )}
        </div>
      </main>
    </div>
  );
}