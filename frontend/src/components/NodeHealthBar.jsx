import React from "react";

function scoreToColor(score) {
  if (score == null) return "#475569";
  if (score >= 7) return "#34d399";
  if (score >= 4) return "#fb923c";
  return "#f87171";
}

export default function NodeHealthBar({ score = null }) {
  const clamped = score == null ? 0 : Math.max(0, Math.min(10, Number(score)));
  const widthPct = `${(clamped / 10) * 100}%`;
  const label = score == null ? "Unknown" : `${clamped.toFixed(1)} / 10`;
  const color = scoreToColor(score);

  return (
    <div className="w-full">
      <div className="mb-1 flex items-center justify-between text-xs" style={{ color: "#64748b" }}>
        <span>Health</span>
        <span style={{ color, fontWeight: 700 }}>{label}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full"
        style={{ background: "rgba(0,0,0,0.08)" }}>
        <div className="h-full rounded-full transition-all"
          style={{ width: widthPct, background: color, boxShadow: `0 0 6px ${color}60` }} />
      </div>
    </div>
  );
}
