import React from "react";
import { Route } from "lucide-react";

export default function LowConfidenceTag() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-medium text-rose-700">
      <Route size={12} />
      Low Confidence
    </span>
  );
}
