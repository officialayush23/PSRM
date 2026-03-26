import React, { useState } from "react";

const UPDATE_TYPES = [
  { value: "before_photo",   label: "Before Photo" },
  { value: "after_photo",    label: "After Photo" },
  { value: "progress_note",  label: "Progress Note" },
  { value: "complete",       label: "Complete Task" },
];

export default function TaskUpdateModal({ task, isOpen, onClose, onSubmit }) {
  const [updateType, setUpdateType] = useState("progress_note");
  const [note,       setNote]       = useState("");
  const [files,      setFiles]      = useState([]);
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!task) return;
    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append("update_type", updateType);
      if (note) formData.append("notes", note);
      files.forEach(file => formData.append("photos", file));
      await onSubmit?.(task, formData, { updateType, note, files });
      setNote("");
      setFiles([]);
      onClose?.();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}>
      <div className="w-full max-w-lg rounded-2xl"
        style={{ background: "rgba(255,255,255,0.97)", backdropFilter: "blur(24px)", border: "1px solid rgba(0,0,0,0.08)", boxShadow: "0 20px 60px rgba(0,0,0,0.15)" }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: "1px solid rgba(0,0,0,0.08)" }}>
          <div>
            <h3 className="text-base font-bold text-slate-800">Update Task</h3>
            <p className="text-xs text-slate-500 mt-0.5">{task?.task_number || task?.id}</p>
          </div>
          <button type="button" onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center transition-colors"
            style={{ background: "rgba(0,0,0,0.05)" }}
            onMouseEnter={e => e.currentTarget.style.background = "rgba(0,0,0,0.1)"}
            onMouseLeave={e => e.currentTarget.style.background = "rgba(0,0,0,0.05)"}>
            <span className="material-symbols-outlined text-slate-400 text-[18px]">close</span>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4 flex flex-col gap-4">
          <div>
            <label className="text-xs font-bold uppercase tracking-wider block mb-2"
              style={{ color: "#475569" }}>Update Type</label>
            <select value={updateType} onChange={e => setUpdateType(e.target.value)}
              className="ginput w-full px-3 py-2.5 rounded-xl text-sm">
              {UPDATE_TYPES.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-bold uppercase tracking-wider block mb-2"
              style={{ color: "#475569" }}>Notes</label>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={4}
              placeholder="Add progress context, blockers, or completion notes"
              className="ginput w-full px-3 py-2.5 rounded-xl text-sm resize-none"
            />
          </div>

          <div>
            <label className="text-xs font-bold uppercase tracking-wider block mb-2"
              style={{ color: "#475569" }}>Photos</label>
            <input
              type="file"
              multiple
              accept="image/*"
              onChange={e => setFiles(Array.from(e.target.files || []))}
              className="ginput w-full px-3 py-2.5 rounded-xl text-sm"
            />
            <p className="mt-1 text-xs text-slate-600">{files.length} file(s) selected</p>
          </div>

          <div className="flex justify-end gap-2 pt-2"
            style={{ borderTop: "1px solid rgba(0,0,0,0.06)" }}>
            <button type="button" onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm font-bold text-slate-600 transition-colors"
              style={{ border: "1px solid rgba(0,0,0,0.1)" }}
              onMouseEnter={e => e.currentTarget.style.background = "rgba(0,0,0,0.04)"}
              onMouseLeave={e => e.currentTarget.style.background = ""}>
              Cancel
            </button>
            <button type="submit" disabled={submitting}
              className="gbtn-sky px-4 py-2 rounded-xl text-sm font-bold disabled:opacity-40">
              {submitting ? "Submitting…" : "Submit Update"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
