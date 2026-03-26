// src/components/MapboxInfraLayer.jsx
// Infra node map with:
// - Always-visible icons (infra type emoji) sized by complaint count
// - Circle stroke color = node status
// - Circle fill = severity shade  
// - Hover popup: open complaints + AI requirements brief
// - Click: navigate to node detail

import React, { useMemo, useState, useCallback, useRef } from "react";
import Map, { Layer, NavigationControl, Popup, Source } from "react-map-gl";

const DELHI = { longitude: 77.209, latitude: 28.6139, zoom: 11, pitch: 40, bearing: -10 };
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

// ── Infra type → emoji ────────────────────────────────────────────
const INFRA_EMOJI = {
  STLIGHT:    "💡",
  ROAD:       "🛣",
  POTHOLE:    "⚠",
  DRAIN:      "🌊",
  FOOTPATH:   "🚶",
  TREE:       "🌳",
  GARBAGE:    "🗑",
  WIRE_HAZARD:"⚡",
  WATER_PIPE: "💧",
  SEWER:      "🔧",
  ELEC_POLE:  "🔌",
};

// ── Mapbox GL layer definitions ───────────────────────────────────

// Glow halo behind circle
const glowLayer = {
  id: "infra-node-glow",
  type: "circle",
  source: "infra-nodes",
  paint: {
    "circle-radius": [
      "interpolate", ["linear"],
      ["coalesce", ["get", "open_complaint_count"], 0],
      0, 18, 5, 22, 15, 27, 40, 32, 100, 38,
    ],
    "circle-color": [
      "match", ["get", "cluster_severity"],
      "critical", "#ef4444",
      "high",     "#f97316",
      "medium",   "#eab308",
      "#22c55e",
    ],
    "circle-opacity": 0.10,
    "circle-blur": 0.5,
  },
};

// Main circle — fill = severity, stroke = status
const circleLayer = {
  id: "infra-node-circles",
  type: "circle",
  source: "infra-nodes",
  paint: {
    // Sized by open complaint count — always min 13px (visible at any zoom)
    "circle-radius": [
      "interpolate", ["linear"],
      ["coalesce", ["get", "open_complaint_count"], 0],
      0, 13, 3, 16, 8, 19, 20, 23, 60, 27,
    ],
    // Fill = severity shade
    "circle-color": [
      "match", ["get", "cluster_severity"],
      "critical", "rgba(239,68,68,0.82)",
      "high",     "rgba(249,115,22,0.82)",
      "medium",   "rgba(234,179,8,0.82)",
      "low",      "rgba(34,197,94,0.82)",
      "rgba(100,116,139,0.75)",
    ],
    // Stroke = node status
    "circle-stroke-width": 3,
    "circle-stroke-color": [
      "match", ["get", "status"],
      "damaged",      "#ef4444",
      "under_repair", "#f59e0b",
      "inactive",     "#64748b",
      "#22c55e",
    ],
    "circle-opacity": 0.9,
  },
};

// Emoji icon on top of the circle
const iconLayer = {
  id: "infra-node-icons",
  type: "symbol",
  source: "infra-nodes",
  layout: {
    "text-field": [
      "match", ["get", "infra_type_code"],
      "STLIGHT",    "💡",
      "ROAD",       "🛣",
      "POTHOLE",    "⚠",
      "DRAIN",      "🌊",
      "FOOTPATH",   "🚶",
      "TREE",       "🌳",
      "GARBAGE",    "🗑",
      "WIRE_HAZARD","⚡",
      "WATER_PIPE", "💧",
      "SEWER",      "🔧",
      "ELEC_POLE",  "🔌",
      "📍",
    ],
    "text-size": [
      "interpolate", ["linear"],
      ["coalesce", ["get", "open_complaint_count"], 0],
      0, 12, 20, 15, 60, 17,
    ],
    "text-allow-overlap":     true,
    "text-ignore-placement":  true,
  },
};

// Open complaint count badge (shown if > 0)
const countLayer = {
  id: "infra-node-counts",
  type: "symbol",
  source: "infra-nodes",
  filter: [">", ["coalesce", ["get", "open_complaint_count"], 0], 0],
  layout: {
    "text-field":             ["to-string", ["coalesce", ["get", "open_complaint_count"], 0]],
    "text-size":              10,
    "text-offset":            [0, 1.6],
    "text-allow-overlap":     true,
    "text-ignore-placement":  true,
    "text-font":              ["DIN Offc Pro Bold", "Arial Unicode MS Bold"],
  },
  paint: {
    "text-color":       "#0f172a",
    "text-halo-color":  "#ffffff",
    "text-halo-width":  2,
  },
};

// Repeat-risk orange ring
const repeatRingLayer = {
  id: "infra-node-repeat",
  type: "circle",
  source: "infra-nodes",
  filter: ["==", ["get", "is_repeat_risk"], true],
  paint: {
    "circle-radius": [
      "interpolate", ["linear"],
      ["coalesce", ["get", "open_complaint_count"], 0],
      0, 17, 5, 21, 20, 26, 60, 30,
    ],
    "circle-color":        "transparent",
    "circle-stroke-width": 2,
    "circle-stroke-color": "#f97316",
    "circle-opacity":      0,
  },
};

// 3D buildings
const building3dLayer = {
  id: "3d-buildings",
  source: "composite",
  "source-layer": "building",
  filter: ["==", "extrude", "true"],
  type: "fill-extrusion",
  minzoom: 13,
  paint: {
    "fill-extrusion-color":   "#d1d9e6",
    "fill-extrusion-height":  ["get", "height"],
    "fill-extrusion-base":    ["get", "min_height"],
    "fill-extrusion-opacity": 0.5,
  },
};

// ── Hover popup ───────────────────────────────────────────────────

function NodePopup({ props }) {
  if (!props) return null;

  // Parse requirements JSON
  let reqs = null;
  try { reqs = JSON.parse(props.cluster_ai_summary); } catch {}

  const sevColor = {
    critical: "#ef4444", high: "#f97316", medium: "#eab308", low: "#22c55e",
  }[props.cluster_severity] || "#64748b";

  const statusColor = {
    damaged: "#ef4444", under_repair: "#f59e0b", inactive: "#64748b",
  }[props.status] || "#22c55e";

  const themes = (() => {
    try { return Array.isArray(props.cluster_major_themes) ? props.cluster_major_themes : JSON.parse(props.cluster_major_themes || "[]"); }
    catch { return []; }
  })();

  const emoji = INFRA_EMOJI[props.infra_type_code] || "📍";

  return (
    <div style={{
      minWidth: 230, maxWidth: 290,
      background: "rgba(255,255,255,0.98)",
      backdropFilter: "blur(20px)",
      border: "1px solid rgba(0,0,0,0.08)",
      borderRadius: 14,
      padding: "12px 14px",
      boxShadow: "0 8px 32px rgba(0,0,0,0.14)",
      color: "#1e293b",
    }}>
      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
        <span style={{ fontSize:22 }}>{emoji}</span>
        <div style={{ flex:1, minWidth:0 }}>
          <p style={{ fontWeight:700, fontSize:13, margin:0, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
            {props.infra_type_name || "Infra Node"}
          </p>
          <div style={{ display:"flex", alignItems:"center", gap:6, marginTop:2 }}>
            <span style={{ width:7, height:7, borderRadius:"50%", background:statusColor, boxShadow:`0 0 5px ${statusColor}` }} />
            <span style={{ fontSize:10, color:"#64748b", textTransform:"capitalize" }}>
              {(props.status||"").replace(/_/g," ")}
            </span>
            {props.cluster_severity && (
              <span style={{ fontSize:10, fontWeight:700, color:sevColor, marginLeft:"auto" }}>
                {props.cluster_severity.toUpperCase()}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Complaint count — prominent */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:10 }}>
        {[
          { label:"Open",  value: props.open_complaint_count||0,  color:"#f87171" },
          { label:"Total", value: props.total_complaint_count||0, color:"#94a3b8" },
        ].map(s => (
          <div key={s.label} style={{ background:"rgba(0,0,0,0.04)", borderRadius:8, padding:"6px 8px", textAlign:"center" }}>
            <p style={{ fontSize:16, fontWeight:800, color:s.color, margin:0 }}>{s.value}</p>
            <p style={{ fontSize:10, color:"#64748b", margin:0 }}>{s.label} complaints</p>
          </div>
        ))}
      </div>

      {/* AI Requirements brief */}
      {reqs?.brief ? (
        <div style={{ background:`${sevColor}12`, border:`1px solid ${sevColor}30`, borderRadius:8, padding:"6px 8px", marginBottom:8 }}>
          <p style={{ fontSize:10, fontWeight:700, color:sevColor, textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:3 }}>
            Requirements
          </p>
          <p style={{ fontSize:11, color:"#475569", lineHeight:1.4, margin:0,
            display:"-webkit-box", WebkitLineClamp:3, WebkitBoxOrient:"vertical", overflow:"hidden" }}>
            {reqs.brief}
          </p>
          {(reqs.requirements||[]).length > 0 && (
            <p style={{ fontSize:10, color:sevColor, marginTop:4, margin:0 }}>
              {reqs.requirements.length} requirement{reqs.requirements.length!==1?"s":""}
            </p>
          )}
        </div>
      ) : props.cluster_ai_summary && typeof props.cluster_ai_summary === "string" && !props.cluster_ai_summary.startsWith("{") && (
        <div style={{ background:`${sevColor}12`, borderRadius:8, padding:"6px 8px", marginBottom:8 }}>
          <p style={{ fontSize:11, color:"#475569", lineHeight:1.4, margin:0,
            display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical", overflow:"hidden" }}>
            {props.cluster_ai_summary}
          </p>
        </div>
      )}

      {/* Themes */}
      {themes.length > 0 && (
        <div style={{ display:"flex", flexWrap:"wrap", gap:4, marginBottom:6 }}>
          {themes.slice(0,3).map((t,i) => (
            <span key={i} style={{ fontSize:10, padding:"2px 8px", borderRadius:999,
              background:"rgba(0,0,0,0.05)", color:"#475569", border:"1px solid rgba(0,0,0,0.08)" }}>
              {t}
            </span>
          ))}
        </div>
      )}

      {props.is_repeat_risk && (
        <p style={{ fontSize:10, fontWeight:700, color:"#f97316", marginBottom:4 }}>↩ Warranty / Repeat Risk</p>
      )}

      <p style={{ fontSize:10, color:"#94a3b8", margin:0 }}>Click to open full details</p>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────

export default function MapboxInfraLayer({ nodes, onNodeClick }) {
  const mapRef    = useRef(null);
  const [hoverInfo, setHoverInfo] = useState(null);

  const featureCollection = useMemo(() => {
    if (!nodes) return { type:"FeatureCollection", features:[] };
    if (nodes.type === "FeatureCollection" && Array.isArray(nodes.features)) return nodes;
    if (Array.isArray(nodes)) {
      return {
        type: "FeatureCollection",
        features: nodes
          .filter(n => n?.lng != null && n?.lat != null)
          .map(n => ({
            type: "Feature",
            geometry: { type:"Point", coordinates:[Number(n.lng), Number(n.lat)] },
            properties: { ...n },
          })),
      };
    }
    return { type:"FeatureCollection", features:[] };
  }, [nodes]);

  const onMouseMove = useCallback((e) => {
    const f = e.features?.[0];
    if (!f) { setHoverInfo(null); return; }
    const props = { ...f.properties };
    // Parse array fields that come serialised as strings
    ["cluster_major_themes"].forEach(k => {
      if (typeof props[k] === "string") {
        try { props[k] = JSON.parse(props[k]); } catch { props[k] = []; }
      }
    });
    setHoverInfo({ lngLat: e.lngLat, props });
  }, []);

  const onMouseLeave = useCallback(() => {
    if (mapRef.current) mapRef.current.getCanvas().style.cursor = "";
    setHoverInfo(null);
  }, []);

  const onMouseEnter = useCallback(() => {
    if (mapRef.current) mapRef.current.getCanvas().style.cursor = "pointer";
  }, []);

  const onClick = useCallback((e) => {
    const id = e.features?.[0]?.properties?.id;
    if (id) onNodeClick?.(id);
  }, [onNodeClick]);

  return (
    <div className="w-full h-full overflow-hidden rounded-xl relative" style={{ border:"1px solid rgba(0,0,0,0.08)", minHeight:480 }}>
      <Map
        ref={mapRef}
        initialViewState={DELHI}
        mapStyle="mapbox://styles/mapbox/streets-v12"
        mapboxAccessToken={MAPBOX_TOKEN}
        interactiveLayerIds={["infra-node-circles", "infra-node-icons"]}
        onMouseMove={onMouseMove}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onClick={onClick}
        style={{ width:"100%", height:"100%" }}
      >
        <NavigationControl position="top-right" showCompass visualizePitch />
        <Layer {...building3dLayer} />

        <Source id="infra-nodes" type="geojson" data={featureCollection}>
          <Layer {...glowLayer} />
          <Layer {...repeatRingLayer} />
          <Layer {...circleLayer} />
          <Layer {...iconLayer} />
          <Layer {...countLayer} />
        </Source>

        {hoverInfo && (
          <Popup
            longitude={hoverInfo.lngLat.lng}
            latitude={hoverInfo.lngLat.lat}
            closeButton={false}
            closeOnClick={false}
            anchor="top"
            maxWidth="300px"
            style={{ background:"transparent", padding:0 }}
          >
            <NodePopup props={hoverInfo.props} />
          </Popup>
        )}
      </Map>

      {/* Legend */}
      <div className="absolute bottom-3 left-3 z-10 rounded-xl px-3 py-2.5 text-xs"
        style={{ background:"rgba(255,255,255,0.94)", backdropFilter:"blur(12px)", border:"1px solid rgba(0,0,0,0.08)", boxShadow:"0 4px 16px rgba(0,0,0,0.08)" }}>
        <p className="font-bold text-slate-500 uppercase tracking-wider mb-2 text-[10px]">Status (border)</p>
        {[
          { c:"#22c55e", l:"Operational" },
          { c:"#f59e0b", l:"Under Repair" },
          { c:"#ef4444", l:"Damaged" },
          { c:"#64748b", l:"Inactive" },
        ].map(s => (
          <div key={s.l} className="flex items-center gap-1.5 mb-0.5">
            <span className="w-3 h-3 rounded-full border-2 border-white shrink-0" style={{ background:s.c, boxShadow:`0 0 4px ${s.c}90` }} />
            <span className="text-slate-500">{s.l}</span>
          </div>
        ))}
        <div className="mt-1.5 pt-1.5" style={{ borderTop:"1px solid rgba(0,0,0,0.06)" }}>
          <p className="font-bold text-slate-500 uppercase tracking-wider mb-1 text-[10px]">Fill = severity</p>
          {[
            { c:"rgba(239,68,68,0.82)",  l:"Critical" },
            { c:"rgba(249,115,22,0.82)", l:"High" },
            { c:"rgba(234,179,8,0.82)",  l:"Medium" },
            { c:"rgba(34,197,94,0.82)",  l:"Low" },
          ].map(s => (
            <div key={s.l} className="flex items-center gap-1.5 mb-0.5">
              <span className="w-3 h-3 rounded-full shrink-0" style={{ background:s.c }} />
              <span className="text-slate-500">{s.l}</span>
            </div>
          ))}
        </div>
        <p className="text-slate-400 mt-1.5 text-[10px]">Number badge = open complaints · size = load</p>
      </div>
    </div>
  );
}