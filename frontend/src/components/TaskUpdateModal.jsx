import React, { useState } from "react";
import { X } from "lucide-react";

const UPDATE_TYPES = [
  { value: "before_photo", label: "Before Photo" },
  { value: "after_photo", label: "After Photo" },
  { value: "progress_note", label: "Progress Note" },
  { value: "complete", label: "Complete Task" },
];

export default function TaskUpdateModal({ task, isOpen, onClose, onSubmit }) {
  const [updateType, setUpdateType] = useState("progress_note");
  const [note, setNote] = useState("");
  const [files, setFiles] = useState([]);
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
      files.forEach((file) => formData.append("photos", file));

      await onSubmit?.(task, formData, { updateType, note, files });
      setNote("");
      setFiles([]);
      onClose?.();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Update Task</h3>
            <p className="text-xs text-slate-500">{task?.task_number || task?.id}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-slate-500 hover:bg-slate-100">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 px-4 py-4">
          <label className="block text-sm">
            <span className="mb-1 block text-slate-700">Update Type</span>
            <select
              value={updateType}
              onChange={(e) => setUpdateType(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              {UPDATE_TYPES.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-slate-700">Notes</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={4}
              placeholder="Add progress context, blockers, or completion notes"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-slate-700">Photos</span>
            <input
              type="file"
              multiple
              accept="image/*"
              onChange={(e) => setFiles(Array.from(e.target.files || []))}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-slate-500">{files.length} file(s) selected</p>
          </label>

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-60"
            >
              {submitting ? "Submitting..." : "Submit Update"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
