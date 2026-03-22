// src/pages/worker/WorkerDashboardPage.jsx
// Unified for worker + contractor

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MapContainer, Marker, TileLayer } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import AppLayout from "../../components/AppLayout";
import client from "../../api/client";
import { toast } from "sonner";

const markerIcon = new L.Icon({
  iconUrl:   "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize:  [25, 41], iconAnchor: [12, 41],
});

const PRIORITY_COLOR = {
  normal: "#6366f1", high: "#f97316", critical: "#ef4444", emergency: "#dc2626",
};

const STATUS_LABEL = {
  assigned:   "Assigned",
  in_progress:"In Progress",
  completed:  "Completed",
  cancelled:  "Cancelled",
};

// ── Task update modal ──────────────────────────────────────────────
function TaskUpdateModal({ task, onClose, onSuccess }) {
  const [updateType,   setUpdateType]   = useState("before_photo");
  const [notes,        setNotes]        = useState("");
  const [photos,       setPhotos]       = useState([]);
  const [previews,     setPreviews]     = useState([]);
  const [lat,          setLat]          = useState(null);
  const [lng,          setLng]          = useState(null);
  const [locStatus,    setLocStatus]    = useState("Getting location…");
  const [submitting,   setSubmitting]   = useState(false);
  const fileRef = useRef(null);
  const videoRef = useRef(null);
  const [cameraActive, setCameraActive] = useState(false);

  useEffect(() => {
    navigator.geolocation?.getCurrentPosition(
      p => { setLat(p.coords.latitude); setLng(p.coords.longitude); setLocStatus("Location obtained"); },
      () => setLocStatus("Could not get GPS — please enable location"),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }, []);

  const startCamera = async () => {
    setCameraActive(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch { toast.error("Camera denied"); setCameraActive(false); }
  };

  const stopCamera = () => {
    videoRef.current?.srcObject?.getTracks().forEach(t => t.stop());
    setCameraActive(false);
  };

  const capturePhoto = () => {
    const v = videoRef.current;
    const c = document.createElement("canvas");
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
    c.toBlob(blob => {
      const file = new File([blob], `photo_${Date.now()}.jpg`, { type: "image/jpeg" });
      addPhoto(file);
      stopCamera();
    }, "image/jpeg");
  };

  const addPhoto = (file) => {
    setPhotos(prev => [...prev, file]);
    setPreviews(prev => [...prev, URL.createObjectURL(file)]);
  };

  const removePhoto = (i) => {
    setPhotos(prev => prev.filter((_, j) => j !== i));
    setPreviews(prev => prev.filter((_, j) => j !== i));
  };

  const submit = async () => {
    if (updateType === "complete" && photos.length === 0) {
      toast.error("After photo is required to mark task as complete");
      return;
    }
    if (updateType === "before_photo" && photos.length === 0) {
      toast.error("Please add at least one before photo");
      return;
    }

    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("update_type", updateType);
      if (notes) fd.append("notes", notes);
      if (lat)   fd.append("lat", String(lat));
      if (lng)   fd.append("lng", String(lng));
      photos.forEach(p => fd.append("photos", p));

      await client.post(`/worker/tasks/${task.id}/update`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      toast.success(updateType === "complete" ? "Task marked as complete!" : "Update submitted!");
      onSuccess();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Submission failed");
    } finally {
      setSubmitting(false);
    }
  };

  const UPDATE_TYPES = [
    { key: "before_photo",  label: "📷 Before Photo",  desc: "Photos before starting work" },
    { key: "after_photo",   label: "✅ After Photo",   desc: "Photos after completing work" },
    { key: "progress_note", label: "📝 Progress Note", desc: "Text update mid-work" },
    { key: "complete",      label: "🏁 Mark Complete", desc: "Requires after photo" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-surface rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-surface px-5 pt-5 pb-3 border-b border-outline-variant/20 flex items-center justify-between">
          <div>
            <p className="font-semibold text-on-surface">{task.title}</p>
            <p className="text-xs text-on-surface-variant">#{task.complaint_number}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-surface-container flex items-center justify-center">
            <span className="material-symbols-outlined text-on-surface-variant">close</span>
          </button>
        </div>

        <div className="p-5 flex flex-col gap-5">
          {/* Update type */}
          <div>
            <p className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-2">Update Type</p>
            <div className="grid grid-cols-2 gap-2">
              {UPDATE_TYPES.map(t => (
                <button key={t.key} type="button"
                  onClick={() => setUpdateType(t.key)}
                  className={`p-3 rounded-xl border text-left transition ${
                    updateType === t.key
                      ? "border-primary bg-primary/10"
                      : "border-outline-variant bg-surface-container hover:bg-surface-container-high"
                  }`}>
                  <p className="text-sm font-semibold text-on-surface">{t.label}</p>
                  <p className="text-[10px] text-on-surface-variant mt-0.5">{t.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Photos */}
          <div>
            <p className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-2">
              {updateType === "before_photo" ? "Before Photos" : updateType === "after_photo" || updateType === "complete" ? "After Photos" : "Photos (optional)"}
            </p>

            {/* Camera */}
            {cameraActive ? (
              <div className="relative rounded-xl overflow-hidden bg-black mb-2" style={{ height: 220 }}>
                <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-2">
                  <button onClick={capturePhoto} className="px-4 py-2 bg-primary text-on-primary rounded-full text-sm font-bold">Capture</button>
                  <button onClick={stopCamera}   className="px-4 py-2 bg-white/80 text-gray-800 rounded-full text-sm font-bold">Cancel</button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2 mb-2">
                <button onClick={startCamera} className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-outline-variant text-sm font-medium text-on-surface hover:bg-surface-container">
                  <span className="material-symbols-outlined text-[16px]">photo_camera</span> Camera
                </button>
                <button onClick={() => fileRef.current?.click()} className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-outline-variant text-sm font-medium text-on-surface hover:bg-surface-container">
                  <span className="material-symbols-outlined text-[16px]">upload</span> Upload
                </button>
                <input type="file" accept="image/*" multiple ref={fileRef} className="hidden"
                  onChange={e => Array.from(e.target.files).forEach(addPhoto)} />
              </div>
            )}

            {previews.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {previews.map((src, i) => (
                  <div key={i} className="relative aspect-square rounded-xl overflow-hidden">
                    <img src={src} alt="" className="w-full h-full object-cover" />
                    <button onClick={() => removePhoto(i)}
                      className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white text-[10px] flex items-center justify-center">
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Notes */}
          {(updateType === "progress_note" || updateType === "complete") && (
            <div>
              <p className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-2">
                {updateType === "complete" ? "Completion Notes" : "Progress Notes"}
              </p>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder={updateType === "complete"
                  ? "Describe what was done, materials used, any issues…"
                  : "Describe current progress…"}
                className="w-full h-24 px-3 py-2 rounded-xl border border-outline-variant bg-surface-container-low text-sm resize-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
            </div>
          )}

          {/* Location */}
          <div className="flex items-center gap-2 text-xs text-on-surface-variant">
            <span className="material-symbols-outlined text-[14px]">location_on</span>
            <span>{locStatus}</span>
            {lat && <span className="font-mono">{lat.toFixed(4)}, {lng.toFixed(4)}</span>}
          </div>

          {/* Submit */}
          <button
            onClick={submit}
            disabled={submitting}
            className="w-full py-3.5 bg-primary text-on-primary rounded-xl font-bold text-sm disabled:opacity-40"
          >
            {submitting ? "Submitting…" : updateType === "complete" ? "✅ Mark Task Complete" : "Submit Update"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Task card ─────────────────────────────────────────────────────
function TaskCard({ task, onUpdate }) {
  const color = PRIORITY_COLOR[task.priority] || "#6366f1";
  const beforeCount = task.before_photos?.length || 0;
  const afterCount  = task.after_photos?.length  || 0;

  return (
    <div className="bg-surface-container-low rounded-2xl border border-outline-variant overflow-hidden">
      {/* Colored top strip */}
      <div className="h-1.5" style={{ background: color }} />

      <div className="p-5">
        <div className="flex items-start gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-xs font-mono text-on-surface-variant">#{task.complaint_number}</span>
              <span className="text-xs px-2 py-0.5 rounded-full font-semibold capitalize"
                style={{ background: color + "20", color }}>
                {task.priority}
              </span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-surface-container text-on-surface-variant capitalize border border-outline-variant/30">
                {STATUS_LABEL[task.status] || task.status}
              </span>
            </div>
            <p className="font-semibold text-on-surface text-sm">{task.title}</p>
            {task.description && (
              <p className="text-xs text-on-surface-variant mt-0.5 line-clamp-2">{task.description}</p>
            )}
          </div>
        </div>

        {/* Location */}
        {task.address_text && (
          <div className="flex items-start gap-1.5 mb-3 text-xs text-on-surface-variant">
            <span className="material-symbols-outlined text-[14px] mt-0.5 flex-shrink-0">location_on</span>
            <span className="line-clamp-2">{task.address_text}</span>
          </div>
        )}

        {/* Mini map if location */}
        {task.lat && task.lng && (
          <div className="rounded-xl overflow-hidden mb-3 border border-outline-variant/20" style={{ height: 140 }}>
            <MapContainer center={[task.lat, task.lng]} zoom={15} scrollWheelZoom={false}
              style={{ height: "100%", width: "100%" }} zoomControl={false} attributionControl={false}>
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              <Marker position={[task.lat, task.lng]} icon={markerIcon} />
            </MapContainer>
          </div>
        )}

        {/* Photo summary */}
        <div className="flex items-center gap-3 mb-4 text-xs text-on-surface-variant">
          <span className={`flex items-center gap-1 ${beforeCount > 0 ? "text-green-600" : ""}`}>
            <span className="material-symbols-outlined text-[14px]">photo</span>
            {beforeCount} before
          </span>
          <span className={`flex items-center gap-1 ${afterCount > 0 ? "text-green-600" : ""}`}>
            <span className="material-symbols-outlined text-[14px]">done_all</span>
            {afterCount} after
          </span>
          {task.due_date && (
            <span className="ml-auto text-orange-500 font-medium">
              Due {new Date(task.due_date).toLocaleDateString("en-IN")}
            </span>
          )}
        </div>

        {/* Infra badge */}
        {task.infra_type_name && (
          <div className="mb-4 px-2 py-1 bg-surface-container rounded-lg inline-block">
            <span className="text-[11px] text-on-surface-variant">{task.infra_type_name}</span>
          </div>
        )}

        {/* Action */}
        {task.status !== "completed" && (
          <button
            onClick={() => onUpdate(task)}
            className="w-full py-2.5 bg-primary text-on-primary rounded-xl text-sm font-semibold hover:bg-primary/90 transition flex items-center justify-center gap-2"
          >
            <span className="material-symbols-outlined text-[18px]">edit</span>
            Update Task
          </button>
        )}
        {task.status === "completed" && (
          <div className="w-full py-2.5 bg-green-100 text-green-700 rounded-xl text-sm font-semibold text-center">
            ✓ Completed
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────
export default function WorkerDashboardPage() {
  const user = JSON.parse(localStorage.getItem("auth_user") || "{}");
  const [tasks,       setTasks]       = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [activeFilter,setActiveFilter]= useState("active");
  const [updateTask,  setUpdateTask]  = useState(null);

  const loadTasks = async (status = null) => {
    setLoading(true);
    try {
      const params = status ? { status } : {};
      const { data } = await client.get("/worker/tasks", { params });
      setTasks(data.items || []);
    } catch {
      toast.error("Failed to load tasks");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadTasks(); }, []);

  const filters = [
    { key: "active",    label: "Active",    statusParam: "assigned" },
    { key: "progress",  label: "In Progress", statusParam: "in_progress" },
    { key: "completed", label: "Completed", statusParam: "completed" },
    { key: "all",       label: "All",       statusParam: null },
  ];

  const handleFilter = (f) => {
    setActiveFilter(f.key);
    loadTasks(f.statusParam);
  };

  const activeTasks    = tasks.filter(t => t.status === "assigned");
  const progressTasks  = tasks.filter(t => t.status === "in_progress");
  const completedTasks = tasks.filter(t => t.status === "completed");

  return (
    <AppLayout>
      <div className="flex flex-col gap-6 p-6">

        {/* Header */}
        <div>
          <h1 className="text-2xl font-headline font-bold text-on-surface">
            Namaskar, {user.full_name?.split(" ")[0]} 🙏
          </h1>
          <p className="text-sm text-on-surface-variant capitalize">{user.role} · My Tasks</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Assigned",    count: activeTasks.length,   color: "#6366f1" },
            { label: "In Progress", count: progressTasks.length, color: "#f97316" },
            { label: "Completed",   count: completedTasks.length,color: "#10b981" },
          ].map(s => (
            <div key={s.label} className="bg-surface-container-low rounded-2xl p-4 border border-outline-variant flex flex-col items-center gap-1"
              style={{ borderColor: s.color + "30" }}>
              <span className="text-2xl font-headline font-bold" style={{ color: s.color }}>{s.count}</span>
              <span className="text-xs text-on-surface-variant">{s.label}</span>
            </div>
          ))}
        </div>

        {/* Filter tabs */}
        <div className="flex gap-2">
          {filters.map(f => (
            <button key={f.key} onClick={() => handleFilter(f)}
              className={`px-4 py-1.5 rounded-full text-sm font-semibold transition ${
                activeFilter === f.key
                  ? "bg-primary text-on-primary"
                  : "bg-surface-container border border-outline-variant text-on-surface-variant hover:bg-surface-container-high"
              }`}>
              {f.label}
            </button>
          ))}
        </div>

        {/* Task grid */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Array(4).fill(0).map((_, i) => <div key={i} className="h-64 rounded-2xl bg-outline-variant/20 animate-pulse" />)}
          </div>
        ) : tasks.length === 0 ? (
          <div className="text-center py-16 text-on-surface-variant">
            <span className="material-symbols-outlined text-5xl mb-2 block">task</span>
            <p className="text-sm">No tasks in this category</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {tasks.map(t => (
              <TaskCard key={t.id} task={t} onUpdate={setUpdateTask} />
            ))}
          </div>
        )}
      </div>

      {/* Update modal */}
      {updateTask && (
        <TaskUpdateModal
          task={updateTask}
          onClose={() => setUpdateTask(null)}
          onSuccess={() => loadTasks()}
        />
      )}
    </AppLayout>
  );
}