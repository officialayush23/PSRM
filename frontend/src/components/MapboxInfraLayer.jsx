import React, { useMemo, useState } from "react";
import Map, { Layer, NavigationControl, Popup, Source } from "react-map-gl";
import InfraNodeCard from "./InfraNodeCard";

const nodeCircleLayer = {
  id: "infra-node-circles",
  type: "circle",
  source: "infra-nodes",
  paint: {
    "circle-radius": ["interpolate", ["linear"], ["coalesce", ["get", "open_complaint_count"], 0], 0, 6, 20, 14],
    "circle-color": [
      "case",
      ["==", ["get", "status"], "under_repair"],
      "#f59e0b",
      ["==", ["get", "status"], "inactive"],
      "#64748b",
      "#059669",
    ],
    "circle-stroke-color": "#ffffff",
    "circle-stroke-width": 1.5,
    "circle-opacity": 0.9,
  },
};

const building3dLayer = {
  id: "3d-buildings",
  source: "composite",
  "source-layer": "building",
  filter: ["==", "extrude", "true"],
  type: "fill-extrusion",
  minzoom: 15,
  paint: {
    "fill-extrusion-color": "#dbeafe",
    "fill-extrusion-height": ["get", "height"],
    "fill-extrusion-base": ["get", "min_height"],
    "fill-extrusion-opacity": 0.35,
  },
};

export default function MapboxInfraLayer({ nodes, onNodeClick }) {
  const [hoverInfo, setHoverInfo] = useState(null);

  const featureCollection = useMemo(() => {
    if (!nodes) {
      return { type: "FeatureCollection", features: [] };
    }
    if (nodes.type === "FeatureCollection" && Array.isArray(nodes.features)) {
      return nodes;
    }
    if (Array.isArray(nodes)) {
      return {
        type: "FeatureCollection",
        features: nodes
          .filter((n) => n?.lng != null && n?.lat != null)
          .map((n) => ({
            type: "Feature",
            geometry: { type: "Point", coordinates: [Number(n.lng), Number(n.lat)] },
            properties: { ...n },
          })),
      };
    }
    return { type: "FeatureCollection", features: [] };
  }, [nodes]);

  return (
    <div className="h-full min-h-90 w-full overflow-hidden rounded-xl border border-slate-200">
      <Map
        initialViewState={{ longitude: 77.209, latitude: 28.6139, zoom: 11, pitch: 35 }}
        mapStyle="mapbox://styles/mapbox/streets-v12"
        mapboxAccessToken={import.meta.env.VITE_MAPBOX_TOKEN}
        interactiveLayerIds={["infra-node-circles"]}
        onMouseMove={(e) => {
          const feature = e.features?.[0];
          if (!feature) {
            setHoverInfo(null);
            return;
          }
          setHoverInfo({
            x: e.point.x,
            y: e.point.y,
            lngLat: e.lngLat,
            feature,
          });
        }}
        onMouseLeave={() => setHoverInfo(null)}
        onClick={(e) => {
          const feature = e.features?.[0];
          if (!feature) return;
          const id = feature.properties?.id;
          if (id) onNodeClick?.(id);
        }}
      >
        <NavigationControl position="top-right" />

        <Source id="infra-nodes" type="geojson" data={featureCollection}>
          <Layer {...nodeCircleLayer} />
        </Source>

        <Layer {...building3dLayer} />

        {hoverInfo ? (
          <Popup
            longitude={hoverInfo.lngLat.lng}
            latitude={hoverInfo.lngLat.lat}
            closeButton={false}
            closeOnClick={false}
            anchor="top"
            className="max-w-70"
          >
            <InfraNodeCard node={hoverInfo.feature.properties || {}} />
          </Popup>
        ) : null}
      </Map>
    </div>
  );
}
