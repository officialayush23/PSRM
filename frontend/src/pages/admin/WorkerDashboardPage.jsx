// src/pages/WorkerDashboardPage.jsx
// Worker + Contractor dashboard
// Features: task cards, photo upload (camera + gallery), GPS, progress notes,
//           mark complete, survey submission (midway/closing), before/after photos

import { useEffect, useRef, useState } from "react";
import Map, { Marker, NavigationControl } from "react-map-gl";
import AppLayout from "../../components/AppLayout";
import client from "../../api/client";
import { toast } from "sonner";

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;
const PC = { normal:"#6366f1", high:"#f97316", critical:"#ef4444", emergency:"#dc2626", low:"#94a3b8" };

function Pill({ label, color, size="sm" }) {
  const sz = size==="xs" ? "text-[10px] px-1.5 py-0.5" : "text-xs px-2.5 py-0.5";
  return (
    <span className={`${sz} rounded-full font-semibold capitalize`}
      style={{ background:color+"18", color }}>
      {label?.replace(/_/g," ")}
    </span>
  );
}

// ── Photo capture component ───────────────────────────────────────

function PhotoCapture({ label, photos, onAdd, onRemove }) {
  const fileRef = useRef(null);
  const videoRef = useRef(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [stream, setStream] = useState(null);

  const startCamera = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:"environment" } });
      setStream(s);
      setCameraOpen(true);
      setTimeout(() => { if (videoRef.current) videoRef.current.srcObject = s; }, 100);
    } catch { toast.error("Camera access denied"); }
  };

  const stopCamera = () => {
    stream?.getTracks().forEach(t => t.stop());
    setStream(null);
    setCameraOpen(false);
  };

  const capture = () => {
    const v = videoRef.current;
    if (!v) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext("2d").drawImage(v, 0, 0);
    c.toBlob(blob => {
      const f = new File([blob], `photo_${Date.now()}.jpg`, { type:"image/jpeg" });
      onAdd(f, URL.createObjectURL(f));
      stopCamera();
    }, "image/jpeg", 0.85);
  };

  const handleFile = (e) => {
    Array.from(e.target.files).forEach(f => onAdd(f, URL.createObjectURL(f)));
    e.target.value = "";
  };

  return (
    <div>
      <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">{label}</p>

      {cameraOpen ? (
        <div className="relative rounded-2xl overflow-hidden bg-black mb-3" style={{ height:240 }}>
          <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
          <div className="absolute inset-x-0 bottom-4 flex justify-center gap-3">
            <button onClick={capture}
              className="w-14 h-14 rounded-full bg-white border-4 border-slate-300 hover:scale-105 active:scale-95 transition-transform" />
            <button onClick={stopCamera}
              className="px-4 py-2 bg-black/60 text-white rounded-full text-sm font-semibold">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2 mb-3">
          <button onClick={startCamera}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-900 text-white rounded-xl text-xs font-bold hover:bg-slate-800">
            <span className="material-symbols-outlined text-[16px]">photo_camera</span> Camera
          </button>
          <button onClick={() => fileRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 text-slate-600 rounded-xl text-xs font-bold hover:bg-slate-50">
            <span className="material-symbols-outlined text-[16px]">upload</span> Gallery
          </button>
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFile} />
        </div>
      )}

      {photos.length > 0 && (
        <div className="grid grid-cols-4 gap-2">
          {photos.map((p, i) => (
            <div key={i} className="relative aspect-square rounded-xl overflow-hidden border border-slate-100">
              <img src={p.preview} alt="" className="w-full h-full object-cover" />
              <button onClick={() => onRemove(i)}
                className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white text-[10px] flex items-center justify-center">
                ✕
              </button>
              <div className="absolute bottom-1 left-1 w-4 h-4 rounded-full bg-green-400 flex items-center justify-center">
                <span className="material-symbols-outlined text-white text-[11px]">check</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Task update drawer ────────────────────────────────────────────

function TaskUpdateDrawer({ task, onClose, onSuccess }) {
  const [mode, setMode]         = useState("update"); // "update" | "survey"
  const [updateType, setType]   = useState("before_photo");
  const [beforePhotos, setBefore] = useState([]);
  const [afterPhotos,  setAfter]  = useState([]);
  const [progressPhotos, setProgress] = useState([]);
  const [notes, setNotes]       = useState("");
  const [lat, setLat]           = useState(null);
  const [lng, setLng]           = useState(null);
  const [gpsStatus, setGpsStatus] = useState("Getting GPS…");
  const [submitting, setSubmitting] = useState(false);
  // Survey state
  const [surveyInstanceId, setSurveyInstanceId] = useState(null);
  const [surveyLoading, setSurveyLoading] = useState(false);
  const [rating, setRating]     = useState(0);
  const [feedback, setFeedback] = useState("");
  const [isResolved, setIsResolved] = useState(null);
  const [submittingSurvey, setSubmittingSurvey] = useState(false);

  useEffect(() => {
    navigator.geolocation?.getCurrentPosition(
      p => { setLat(p.coords.latitude); setLng(p.coords.longitude); setGpsStatus("GPS: ✓"); },
      () => setGpsStatus("GPS: unavailable"),
      { enableHighAccuracy:true, timeout:8000 }
    );
    // Check for pending survey
    if (task.complaint_id) {
      client.get(`/worker/tasks/${task.id}/pending-survey`).then(d => {
        if (d.data?.survey_instance_id) setSurveyInstanceId(d.data.survey_instance_id);
      }).catch(() => {});
    }
  }, [task]);

  const addPhoto = (list, setter) => (f, preview) => setter(prev => [...prev, {file:f, preview}]);
  const removePhoto = (list, setter) => (i) => setter(prev => prev.filter((_,j) => j!==i));

  const getCurrentPhotos = () => {
    if (updateType==="before_photo") return beforePhotos;
    if (updateType==="after_photo" || updateType==="complete") return afterPhotos;
    return progressPhotos;
  };
  const getCurrentSetter = () => {
    if (updateType==="before_photo") return (f,p) => setBefore(prev=>[...prev,{file:f,preview:p}]);
    if (updateType==="after_photo" || updateType==="complete") return (f,p) => setAfter(prev=>[...prev,{file:f,preview:p}]);
    return (f,p) => setProgress(prev=>[...prev,{file:f,preview:p}]);
  };
  const getCurrentRemover = () => {
    if (updateType==="before_photo") return (i) => setBefore(prev=>prev.filter((_,j)=>j!==i));
    if (updateType==="after_photo" || updateType==="complete") return (i) => setAfter(prev=>prev.filter((_,j)=>j!==i));
    return (i) => setProgress(prev=>prev.filter((_,j)=>j!==i));
  };

  const submit = async () => {
    const photos = getCurrentPhotos();
    if (updateType==="complete" && afterPhotos.length===0) { toast.error("After photo required to complete"); return; }
    if (updateType==="before_photo" && photos.length===0) { toast.error("Add at least one before photo"); return; }

    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("update_type", updateType);
      if (notes) fd.append("notes", notes);
      if (lat) fd.append("lat", String(lat));
      if (lng) fd.append("lng", String(lng));

      const allPhotos = updateType==="complete" ? afterPhotos : photos;
      allPhotos.forEach(p => fd.append("photos", p.file));

      await client.post(`/worker/tasks/${task.id}/update`, fd, { headers:{ "Content-Type":"multipart/form-data" } });
      toast.success(updateType==="complete" ? "🎉 Task marked complete!" : "Update submitted!");
      onSuccess();
      if (updateType !== "complete") {
        // Reset photos for the current step
        if (updateType==="before_photo") setBefore([]);
        else if (updateType==="after_photo") setAfter([]);
        else setProgress([]);
        setNotes("");
      } else {
        onClose();
      }
    } catch (e) { toast.error(e.response?.data?.detail||"Submission failed"); }
    finally { setSubmitting(false); }
  };

  const submitSurvey = async () => {
    if (!rating) { toast.error("Please give a star rating"); return; }
    setSubmittingSurvey(true);
    try {
      await client.post(`/surveys/${surveyInstanceId}/submit`, {
        rating, feedback, is_resolved: isResolved, wants_followup: false,
      });
      toast.success("Survey submitted! Thank you.");
      setSurveyInstanceId(null);
      onSuccess();
    } catch (e) { toast.error(e.response?.data?.detail||"Failed to submit survey"); }
    finally { setSubmittingSurvey(false); }
  };

  const UPDATE_OPTIONS = [
    { k:"before_photo",  l:"Before Work",  icon:"photo_camera", desc:"Document site before starting", color:"#6366f1" },
    { k:"progress_note", l:"Progress",     icon:"edit_note",    desc:"Mid-work update with notes",    color:"#f97316" },
    { k:"after_photo",   l:"After Work",   icon:"done_all",     desc:"Document completed work",       color:"#10b981" },
    { k:"complete",      l:"Mark Complete",icon:"task_alt",     desc:"Finish task — after photo req", color:"#10b981" },
  ];

  const mapLocation = task.lat ? { longitude:task.lng, latitude:task.lat, zoom:15 } : null;

  return (
    <div className="fixed inset-0 z-50 flex items-stretch bg-black/60 backdrop-blur-sm">
      <div className="ml-auto w-full max-w-2xl bg-white flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-slate-100">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">#{task.task_number}</p>
              <h2 className="font-black text-slate-900 text-lg leading-tight">{task.title}</h2>
              {task.address_text && (
                <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                  <span className="material-symbols-outlined text-[13px]">location_on</span>
                  {task.address_text}
                </p>
              )}
            </div>
            <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center">
              <span className="material-symbols-outlined text-slate-400">close</span>
            </button>
          </div>

          {/* Mode toggle */}
          <div className="flex gap-2 mt-4">
            <button onClick={() => setMode("update")}
              className={`flex-1 py-2 rounded-xl text-sm font-bold transition ${mode==="update"?"bg-slate-900 text-white":"bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>
              📷 Update Task
            </button>
            {surveyInstanceId && (
              <button onClick={() => setMode("survey")}
                className={`flex-1 py-2 rounded-xl text-sm font-bold transition ${mode==="survey"?"bg-amber-500 text-white":"bg-amber-50 text-amber-600 border border-amber-200"}`}>
                📋 Survey Pending
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {mode === "survey" && surveyInstanceId ? (
            /* Survey mode */
            <div className="flex flex-col gap-6">
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
                <p className="font-bold text-amber-800 text-sm">📋 Survey from the citizen</p>
                <p className="text-xs text-amber-600 mt-1">Please answer honestly — your responses improve our services.</p>
              </div>
              <div>
                <p className="font-semibold text-slate-700 mb-3">How would you rate the overall experience?</p>
                <div className="flex gap-3">
                  {[1,2,3,4,5].map(s => (
                    <button key={s} onClick={() => setRating(s)}
                      className={`w-12 h-12 rounded-xl text-2xl transition-all ${s<=rating?"scale-110 shadow-md":""}`}
                      style={{ background: s<=rating ? "#fbbf24" : "#f3f4f6" }}>
                      ★
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="font-semibold text-slate-700 mb-2">Was the issue resolved?</p>
                <div className="flex gap-3">
                  {[{v:true,l:"✅ Yes"},{v:false,l:"❌ No"}].map(o => (
                    <button key={String(o.v)} onClick={() => setIsResolved(o.v)}
                      className={`flex-1 py-2.5 rounded-xl text-sm font-bold border transition ${
                        isResolved===o.v ? "bg-sky-600 text-white border-sky-600" : "bg-white text-slate-600 border-slate-200"
                      }`}>{o.l}</button>
                  ))}
                </div>
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-2">Comments (optional)</label>
                <textarea value={feedback} onChange={e => setFeedback(e.target.value)}
                  rows={4} placeholder="Any feedback or comments…"
                  className="w-full px-4 py-3 border rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-sky-200" />
              </div>
              <button onClick={submitSurvey} disabled={!rating||submittingSurvey||isResolved===null}
                className="w-full py-3.5 bg-amber-500 text-white rounded-xl font-black text-sm disabled:opacity-40">
                {submittingSurvey ? "Submitting…" : "Submit Survey"}
              </button>
            </div>
          ) : (
            /* Update mode */
            <div className="flex flex-col gap-6">
              {/* Update type selector */}
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">What are you updating?</p>
                <div className="grid grid-cols-2 gap-2">
                  {UPDATE_OPTIONS.map(o => (
                    <button key={o.k} onClick={() => setType(o.k)}
                      className={`p-3.5 rounded-2xl border text-left transition-all ${
                        updateType===o.k ? "shadow-md" : "border-slate-100 hover:border-slate-200"
                      }`}
                      style={{ borderColor: updateType===o.k ? o.color : undefined, background: updateType===o.k ? o.color+"10" : undefined }}>
                      <span className="material-symbols-outlined text-[20px] block mb-1" style={{ color:o.color }}>{o.icon}</span>
                      <p className="font-bold text-slate-800 text-sm">{o.l}</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">{o.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Photo summary chips */}
              {(beforePhotos.length > 0 || afterPhotos.length > 0) && (
                <div className="flex gap-3 text-xs font-semibold">
                  {beforePhotos.length > 0 && <span className="flex items-center gap-1 text-purple-600 bg-purple-50 px-3 py-1.5 rounded-full">📷 {beforePhotos.length} before</span>}
                  {afterPhotos.length > 0 && <span className="flex items-center gap-1 text-green-600 bg-green-50 px-3 py-1.5 rounded-full">✅ {afterPhotos.length} after</span>}
                </div>
              )}

              {/* Photo capture for current type */}
              <PhotoCapture
                label={UPDATE_OPTIONS.find(o=>o.k===updateType)?.l||"Photos"}
                photos={getCurrentPhotos()}
                onAdd={getCurrentSetter()}
                onRemove={getCurrentRemover()}
              />

              {/* Notes */}
              {(updateType==="progress_note" || updateType==="complete") && (
                <div>
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-2">
                    {updateType==="complete" ? "Completion Notes" : "Progress Notes"}
                  </label>
                  <textarea value={notes} onChange={e => setNotes(e.target.value)}
                    rows={4} className="w-full px-4 py-3 border rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-sky-200"
                    placeholder={updateType==="complete"
                      ? "Describe what was done, materials used, any issues encountered…"
                      : "Describe current progress, any blockers…"} />
                </div>
              )}

              {/* Map + GPS */}
              {mapLocation && updateType !== "progress_note" && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Site Location</p>
                    <span className={`text-xs font-semibold ${lat?"text-green-600":"text-slate-400"}`}>{gpsStatus}</span>
                  </div>
                  <div className="rounded-xl overflow-hidden border" style={{ height:150 }}>
                    <Map initialViewState={mapLocation} mapboxAccessToken={MAPBOX_TOKEN}
                      mapStyle="mapbox://styles/mapbox/streets-v12"
                      style={{ width:"100%", height:"100%" }} interactive={false} attributionControl={false}>
                      <Marker longitude={task.lng} latitude={task.lat}>
                        <div className="w-4 h-4 rounded-full bg-red-500 border-2 border-white shadow-md" />
                      </Marker>
                      {lat && (
                        <Marker longitude={lng} latitude={lat}>
                          <div className="w-4 h-4 rounded-full bg-blue-500 border-2 border-white shadow-md" />
                        </Marker>
                      )}
                    </Map>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">🔴 Task site · 🔵 Your GPS location</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {mode === "update" && (
          <div className="px-6 pb-6 pt-4 border-t border-slate-100">
            <button onClick={submit} disabled={submitting}
              className={`w-full py-4 rounded-2xl font-black text-sm disabled:opacity-40 transition-all ${
                updateType==="complete"
                  ? "bg-green-500 hover:bg-green-600 text-white"
                  : "bg-slate-900 hover:bg-slate-800 text-white"
              }`}>
              {submitting ? "Submitting…" :
               updateType==="complete" ? "🏁 Mark Task Complete" :
               updateType==="before_photo" ? "📷 Submit Before Photos" :
               updateType==="after_photo" ? "✅ Submit After Photos" : "Submit Progress Update"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Task card ─────────────────────────────────────────────────────

function TaskCard({ task, onOpen }) {
  const color = PC[task.priority] || "#6366f1";
  const before = task.before_photos?.length || 0;
  const after  = task.after_photos?.length  || 0;
  const isOverdue = task.due_at && new Date(task.due_at) < new Date() && task.status !== "completed";

  return (
    <div className={`bg-white rounded-2xl border overflow-hidden transition-all hover:shadow-lg cursor-pointer ${
      isOverdue ? "border-red-300 shadow-red-50" : "border-slate-100"
    }`} onClick={() => onOpen(task)}>
      <div className="h-1.5" style={{ background: color }} />
      <div className="p-5">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="text-xs font-mono text-slate-400">#{task.task_number}</span>
              <Pill label={task.priority} color={color} size="xs" />
              <Pill label={task.status}
                color={task.status==="completed"?"#10b981":task.status==="in_progress"?"#f97316":color}
                size="xs" />
              {isOverdue && <span className="text-[10px] text-red-500 font-bold">⚠️ Overdue</span>}
            </div>
            <p className="font-black text-slate-900 text-sm leading-tight">{task.title}</p>
            {task.description && <p className="text-xs text-slate-500 mt-1 line-clamp-2">{task.description}</p>}
          </div>
        </div>

        {task.address_text && (
          <div className="flex items-center gap-1.5 mt-3 text-xs text-slate-400">
            <span className="material-symbols-outlined text-[13px]">location_on</span>
            <span className="truncate">{task.address_text}</span>
          </div>
        )}

        {/* Photo progress indicators */}
        <div className="flex items-center gap-4 mt-3 pt-3 border-t border-slate-50">
          <div className={`flex items-center gap-1.5 text-xs ${before>0?"text-green-600 font-semibold":"text-slate-400"}`}>
            <span className="material-symbols-outlined text-[14px]">photo_camera</span>
            {before} before
          </div>
          <div className={`flex items-center gap-1.5 text-xs ${after>0?"text-green-600 font-semibold":"text-slate-400"}`}>
            <span className="material-symbols-outlined text-[14px]">done_all</span>
            {after} after
          </div>
          {task.due_at && (
            <span className={`ml-auto text-xs font-semibold ${isOverdue?"text-red-500":"text-slate-400"}`}>
              {isOverdue ? "⚠️ " : ""}Due {new Date(task.due_at).toLocaleDateString("en-IN")}
            </span>
          )}
        </div>

        {/* Action button */}
        {task.status !== "completed" ? (
          <div className="mt-4 bg-slate-900 text-white rounded-xl py-2.5 text-sm font-bold text-center">
            Update Task
          </div>
        ) : (
          <div className="mt-4 bg-green-50 border border-green-100 text-green-700 rounded-xl py-2.5 text-sm font-bold text-center">
            ✓ Completed
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────

export default function WorkerDashboardPage() {
  const user = JSON.parse(localStorage.getItem("auth_user") || "{}");
  const [tasks, setTasks]           = useState([]);
  const [loading, setLoading]       = useState(true);
  const [activeFilter, setFilter]   = useState(null);
  const [drawerTask, setDrawerTask] = useState(null);

  const loadTasks = (status = null) => {
    setLoading(true);
    const params = status ? { status } : {};
    client.get("/worker/tasks", { params }).then(d => {
      setTasks(d.data.items || []);
      setLoading(false);
    }).catch(() => { toast.error("Failed to load tasks"); setLoading(false); });
  };

  useEffect(() => { loadTasks(); }, []);

  const counts = {
    all:       tasks.length,
    pending:   tasks.filter(t=>t.status==="pending").length,
    in_progress: tasks.filter(t=>t.status==="in_progress").length,
    completed: tasks.filter(t=>t.status==="completed").length,
    overdue:   tasks.filter(t=>t.due_at && new Date(t.due_at)<new Date() && t.status!=="completed").length,
  };

  const FILTERS = [
    { k:null,        l:"All",         color:"#6366f1" },
    { k:"pending",   l:"Assigned",    color:"#3b82f6" },
    { k:"in_progress",l:"In Progress",color:"#f97316" },
    { k:"completed", l:"Completed",   color:"#10b981" },
  ];

  return (
    <AppLayout title="My Tasks">
      <div className="p-4 md:p-6 flex flex-col gap-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black text-slate-900">
              Namaskar, {user.full_name?.split(" ")[0]} 🙏
            </h1>
            <p className="text-sm text-slate-500 mt-0.5 capitalize">{user.role}</p>
          </div>
          {counts.overdue > 0 && (
            <div className="flex items-center gap-2 px-4 py-2 bg-red-50 border border-red-200 rounded-full">
              <span className="material-symbols-outlined text-red-500 text-[18px]">alarm_off</span>
              <span className="text-sm font-bold text-red-600">{counts.overdue} overdue</span>
            </div>
          )}
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { l:"Assigned",    v:counts.pending,     c:"#6366f1" },
            { l:"In Progress", v:counts.in_progress, c:"#f97316" },
            { l:"Completed",   v:counts.completed,   c:"#10b981" },
            { l:"Overdue",     v:counts.overdue,     c:"#ef4444" },
          ].map(s => (
            <div key={s.l} className="bg-white rounded-2xl p-4 border flex flex-col items-center gap-1 hover:shadow-md transition-shadow"
              style={{ borderColor:s.c+"25" }}>
              <span className="text-2xl font-black" style={{ color:s.c }}>{s.v}</span>
              <span className="text-xs text-slate-400">{s.l}</span>
            </div>
          ))}
        </div>

        {/* Filter tabs */}
        <div className="flex gap-2 flex-wrap">
          {FILTERS.map(f => (
            <button key={String(f.k)} onClick={() => { setFilter(f.k); loadTasks(f.k); }}
              className={`px-4 py-2 rounded-xl text-xs font-bold border transition-all ${
                activeFilter===f.k
                  ? "text-white border-transparent shadow-sm"
                  : "bg-white text-slate-500 border-slate-200 hover:border-slate-300"
              }`}
              style={{ background: activeFilter===f.k ? f.color : undefined }}>
              {f.l} {activeFilter===f.k && `(${tasks.length})`}
            </button>
          ))}
        </div>

        {/* Task grid */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Array(4).fill(0).map((_,i) => <div key={i} className="h-64 rounded-2xl bg-slate-100 animate-pulse" />)}
          </div>
        ) : tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400">
            <span className="material-symbols-outlined text-6xl mb-3">task_alt</span>
            <p className="font-bold text-lg">No tasks here</p>
            <p className="text-sm">New tasks will appear when assigned by your official</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {tasks.map(t => (
              <TaskCard key={t.id} task={t} onOpen={setDrawerTask} />
            ))}
          </div>
        )}
      </div>

      {/* Task update drawer */}
      {drawerTask && (
        <TaskUpdateDrawer
          task={drawerTask}
          onClose={() => setDrawerTask(null)}
          onSuccess={() => { loadTasks(activeFilter); }}
        />
      )}
    </AppLayout>
  );
}