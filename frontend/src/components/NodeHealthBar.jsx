import React from "react";

function scoreToColor(score) {
  if (score == null) return "bg-gray-300";
  if (score >= 7) return "bg-emerald-500";
  if (score >= 4) return "bg-amber-500";
  return "bg-rose-500";
}

export default function NodeHealthBar({ score = null }) {
  const clamped = score == null ? 0 : Math.max(0, Math.min(10, Number(score)));
  const widthPct = `${(clamped / 10) * 100}%`;
  const label = score == null ? "Unknown" : `${clamped.toFixed(1)} / 10`;

  return (
    <div className="w-full">
      <div className="mb-1 flex items-center justify-between text-xs text-gray-600">
        <span>Health</span>
        <span>{label}</span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-gray-200">
        <div className={`h-full rounded-full transition-all ${scoreToColor(score)}`} style={{ width: widthPct }} />
      </div>
    </div>
  );
}
