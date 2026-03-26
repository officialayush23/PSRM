// src/pages/SubmitComplaintPage.jsx

import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Map, { Marker, NavigationControl } from "react-map-gl";
import {
  submitComplaint,
  fetchInfraTypes,
  reverseGeocode,
  forwardGeocode,
} from "../api/complaintsApi";
import AppLayout from "../components/AppLayout";
import { toast } from "sonner";

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

// ── Step indicator ────────────────────────────────────────────────
function StepDot({ n, active, done }) {
  const bg    = done ? "#34d399" : active ? "#38bdf8" : "rgba(0,0,0,0.1)";
  const color = done || active ? "#fff" : "#475569";
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all"
        style={{ background: bg, color, boxShadow: active ? "0 0 12px rgba(56,189,248,0.5)" : done ? "0 0 8px rgba(52,211,153,0.4)" : "none" }}>
        {done ? <span className="material-symbols-outlined text-[14px]">check</span> : n}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────
export default function SubmitComplaintPage() {
  const navigate     = useNavigate();
  const fileInputRef = useRef(null);
  const videoRef     = useRef(null);

  const [step, setStep] = useState(1);

  const [image,          setImage]          = useState(null);
  const [imagePreview,   setImagePreview]   = useState(null);
  const [isCameraActive, setIsCameraActive] = useState(false);

  const [lat,            setLat]            = useState(null);
  const [lng,            setLng]            = useState(null);
  const [locationStatus, setLocationStatus] = useState("Waiting for GPS…");

  const [addressText,    setAddressText]    = useState("");
  const [addressLoading, setAddressLoading] = useState(false);

  const [addressSearch,  setAddressSearch]  = useState("");
  const [searchLoading,  setSearchLoading]  = useState(false);

  const [infraTypes,        setInfraTypes]        = useState([]);
  const [infraTypesLoading, setInfraTypesLoading] = useState(true);
  const [selectedInfraId,   setSelectedInfraId]   = useState("");
  const [customInfraName,   setCustomInfraName]   = useState("");

  const [text,         setText]         = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetchInfraTypes()
      .then(setInfraTypes)
      .catch(() => toast.error("Could not load issue types — you can still submit."))
      .finally(() => setInfraTypesLoading(false));
  }, []);

  const isKnownType = selectedInfraId && selectedInfraId !== "other" && selectedInfraId !== "ai";
  const isOtherType = selectedInfraId === "other";
  const isAiInfer   = selectedInfraId === "ai" || selectedInfraId === "";

  const doReverseGeocode = async (lat, lng) => {
    setAddressLoading(true);
    const addr = await reverseGeocode(lat, lng);
    if (addr) setAddressText(addr);
    setAddressLoading(false);
  };

  const requestCurrentLocation = () => {
    if (!navigator.geolocation) { setLocationStatus("Geolocation not supported. Pin on map."); return; }
    setLocationStatus("Fetching location…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setLat(latitude); setLng(longitude);
        setLocationStatus("Location fetched via GPS.");
        doReverseGeocode(latitude, longitude);
      },
      () => setLocationStatus("GPS failed or denied. Pin on map."),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  const handleAddressSearch = async () => {
    if (!addressSearch.trim()) return;
    setSearchLoading(true);
    const result = await forwardGeocode(addressSearch);
    if (result) {
      setLat(result.lat); setLng(result.lng);
      setAddressText(result.formatted);
      setLocationStatus("Location set from address search.");
    } else {
      toast.error("Address not found. Try a more specific location.");
    }
    setSearchLoading(false);
  };

  useEffect(() => {
    requestCurrentLocation();
    return () => stopCamera();
  }, []);

  const startCamera = async () => {
    setIsCameraActive(true);
    setImage(null); setImagePreview(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch { toast.error("Camera access denied."); setIsCameraActive(false); }
  };

  const stopCamera = () => {
    if (videoRef.current?.srcObject)
      videoRef.current.srcObject.getTracks().forEach(t => t.stop());
    setIsCameraActive(false);
  };

  const capturePhoto = () => {
    if (!videoRef.current) return;
    const v = videoRef.current;
    const c = document.createElement("canvas");
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
    c.toBlob(blob => {
      if (!blob) return;
      const file = new File([blob], "webcam_photo.jpg", { type: "image/jpeg" });
      setImage(file); setImagePreview(URL.createObjectURL(file));
      stopCamera();
    }, "image/jpeg");
  };

  const handleFileUpload = e => {
    const file = e.target.files?.[0];
    if (file) { setImage(file); setImagePreview(URL.createObjectURL(file)); stopCamera(); }
  };

  const clearPhoto = () => {
    setImage(null); setImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const canProceedStep1 = !!image;
  const canProceedStep2 = lat !== null && lng !== null;
  const canProceedStep3 = selectedInfraId !== "" &&
    (selectedInfraId !== "other" || customInfraName.trim().length >= 3);
  const canSubmit = canProceedStep1 && canProceedStep2 && canProceedStep3 && text.trim().length >= 5;

  const handleSubmit = async e => {
    e.preventDefault();
    if (!canSubmit) { toast.error("Please complete all steps."); return; }
    setIsSubmitting(true);
    try {
      const complaint = await submitComplaint({
        text: text.trim() || "Issue observed at location",
        lat, lng,
        image,
        addressText: addressText.trim() || undefined,
        infraTypeId: isKnownType ? selectedInfraId : undefined,
        customInfraTypeName: isOtherType ? customInfraName.trim() : undefined,
      });
      toast.success("Complaint submitted!");
      navigate(`/complaints/${complaint.complaint_id}`);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Submission failed. Try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const STEP_LABELS = ["Photo", "Location", "Issue Type", "Description"];

  return (
    <AppLayout title="Report Issue">
      <form onSubmit={handleSubmit} className="max-w-3xl pb-10 p-6 flex flex-col gap-6">

        <div>
          <nav className="flex items-center gap-2 text-xs text-slate-500 font-medium mb-4">
            <span>Dashboard</span>
            <span className="material-symbols-outlined text-[14px]">chevron_right</span>
            <span className="text-sky-400 font-bold">Report Issue</span>
          </nav>
          <h3 className="font-bold text-xl text-white">Report a Civic Issue</h3>
        </div>

        {/* Step bar */}
        <div className="flex items-center gap-0">
          {STEP_LABELS.map((label, i) => (
            <React.Fragment key={label}>
              <button type="button" onClick={() => setStep(i + 1)}
                className="flex flex-col items-center gap-1 shrink-0">
                <StepDot n={i + 1} active={step === i + 1}
                  done={(i===0 && canProceedStep1)||(i===1 && canProceedStep2)||(i===2 && canProceedStep3)} />
                <span className={`text-[10px] font-semibold hidden sm:block ${step===i+1 ? "text-sky-400" : "text-slate-600"}`}>
                  {label}
                </span>
              </button>
              {i < 3 && <div className="flex-1 h-px mx-1 mb-4" style={{ background: "rgba(0,0,0,0.1)" }} />}
            </React.Fragment>
          ))}
        </div>

        {/* ── STEP 1: Photo ── */}
        {step === 1 && (
          <div className="gcard p-6 flex flex-col gap-5">
            <div>
              <h4 className="text-sm font-semibold text-slate-800">Take or upload a photo</h4>
              <p className="text-xs text-slate-500 mt-0.5">Photo helps officials assess severity faster</p>
            </div>

            <div className="relative h-72 rounded-2xl overflow-hidden flex items-center justify-center"
              style={{ background: "rgba(0,0,0,0.04)", border: "1px solid rgba(0,0,0,0.06)" }}>
              {isCameraActive ? (
                <>
                  <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                  <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2 z-10">
                    <button type="button" onClick={capturePhoto}
                      className="px-5 py-2 rounded-full text-sm font-bold text-white gbtn-sky">Capture</button>
                    <button type="button" onClick={stopCamera}
                      className="px-5 py-2 rounded-full text-sm font-bold gbtn-ghost text-white">Cancel</button>
                  </div>
                </>
              ) : imagePreview ? (
                <>
                  <img src={imagePreview} alt="Preview" className="w-full h-full object-cover" />
                  <button type="button" onClick={clearPhoto}
                    className="absolute top-3 right-3 px-3 py-1 rounded-full text-xs font-bold text-white gbtn-ghost">
                    ✕ Remove
                  </button>
                </>
              ) : (
                <div className="flex flex-col items-center gap-4">
                  <div className="w-20 h-20 rounded-full flex items-center justify-center"
                    style={{ background: "rgba(56,189,248,0.1)" }}>
                    <span className="material-symbols-outlined text-sky-400 text-4xl">photo_camera</span>
                  </div>
                  <div className="flex gap-3">
                    <button type="button" onClick={startCamera}
                      className="px-5 py-2 rounded-full text-sm font-bold text-white gbtn-sky">Use Camera</button>
                    <button type="button" onClick={() => fileInputRef.current?.click()}
                      className="px-5 py-2 rounded-full text-sm font-bold text-white gbtn-ghost">Upload File</button>
                  </div>
                </div>
              )}
              <input type="file" accept="image/*" ref={fileInputRef} className="hidden" onChange={handleFileUpload} />
            </div>

            <button type="button" disabled={!canProceedStep1} onClick={() => setStep(2)}
              className="w-full h-12 rounded-xl text-sm font-bold text-white gbtn-sky disabled:opacity-40">
              {canProceedStep1 ? "Next — Set Location →" : "Photo required to continue"}
            </button>
          </div>
        )}

        {/* ── STEP 2: Location ── */}
        {step === 2 && (
          <div className="gcard p-6 flex flex-col gap-4">
            <div className="flex items-start justify-between">
              <div>
                <h4 className="text-sm font-semibold text-slate-800">Where is the issue?</h4>
                <p className="text-xs text-slate-500 mt-0.5">Allow GPS, tap on map, or search by address</p>
              </div>
              <button type="button" onClick={requestCurrentLocation}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-sky-400 transition-colors"
                style={{ background: "rgba(56,189,248,0.1)", border: "1px solid rgba(56,189,248,0.2)" }}>
                <span className="material-symbols-outlined text-[14px]">my_location</span>
                Use GPS
              </button>
            </div>

            {/* Address search */}
            <div className="flex gap-2">
              <input type="text" value={addressSearch}
                onChange={e => setAddressSearch(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleAddressSearch()}
                placeholder="Search address or landmark…"
                className="flex-1 px-4 py-2.5 rounded-xl text-sm ginput" />
              <button type="button" onClick={handleAddressSearch}
                disabled={searchLoading || !addressSearch.trim()}
                className="px-4 py-2.5 rounded-xl text-sm font-bold text-white gbtn-sky disabled:opacity-40">
                {searchLoading ? "…" : "Find"}
              </button>
            </div>

            {/* Map */}
            <div className="rounded-xl overflow-hidden" style={{ height: 280, border: "1px solid rgba(0,0,0,0.08)" }}>
              <Map
                key={`${lat ?? 28.6139}-${lng ?? 77.209}`}
                initialViewState={{ longitude: lng ?? 77.209, latitude: lat ?? 28.6139, zoom: 14, pitch: 45 }}
                mapboxAccessToken={MAPBOX_TOKEN}
                mapStyle="mapbox://styles/mapbox/streets-v12"
                style={{ width: "100%", height: "100%" }}
                onClick={e => {
                  const { lng: clickLng, lat: clickLat } = e.lngLat;
                  setLat(clickLat); setLng(clickLng);
                  setLocationStatus("Location pinned on map.");
                  doReverseGeocode(clickLat, clickLng);
                }}
                cursor="crosshair"
                attributionControl={false}>
                <NavigationControl position="bottom-right" showCompass visualizePitch />
                {lat !== null && (
                  <Marker longitude={lng} latitude={lat} anchor="center">
                    <div style={{
                      width: 18, height: 18, borderRadius: "50%",
                      background: "#38bdf8", border: "3px solid white",
                      boxShadow: "0 2px 12px rgba(56,189,248,0.6)",
                    }} />
                  </Marker>
                )}
              </Map>
            </div>

            {/* Address field */}
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <span className="material-symbols-outlined text-[14px] text-slate-500">location_on</span>
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Address</label>
                {addressLoading && <span className="text-[10px] text-sky-400 animate-pulse">Detecting…</span>}
              </div>
              <input type="text" value={addressText}
                onChange={e => setAddressText(e.target.value)}
                placeholder="Auto-filled from GPS · Edit if needed"
                className="w-full px-4 py-2.5 rounded-xl text-sm ginput" />
              <p className="text-[10px] text-slate-600 mt-1.5">
                Helps officials and workers find the exact location · Optional but recommended
              </p>
            </div>

            <div>
              <p className="text-xs text-slate-500 font-medium">{locationStatus}</p>
              {lat !== null && (
                <p className="font-mono text-[10px] text-slate-600 mt-0.5">{lat.toFixed(5)}, {lng.toFixed(5)}</p>
              )}
            </div>

            <div className="flex gap-3">
              <button type="button" onClick={() => setStep(1)}
                className="h-12 w-24 rounded-xl text-sm font-bold text-white gbtn-ghost">← Back</button>
              <button type="button" disabled={!canProceedStep2} onClick={() => setStep(3)}
                className="flex-1 h-12 rounded-xl text-sm font-bold text-white gbtn-sky disabled:opacity-40">
                {canProceedStep2 ? "Next — Issue Type →" : "Pin location to continue"}
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 3: Infra Type ── */}
        {step === 3 && (
          <div className="gcard p-6 flex flex-col gap-4">
            <div>
              <h4 className="text-sm font-semibold text-slate-800">What type of issue is it?</h4>
              <p className="text-xs text-slate-500 mt-0.5">Helps route to the right department. Skip if unsure — AI will classify it.</p>
            </div>

            {infraTypesLoading ? (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {Array(8).fill(0).map((_, i) => (
                  <div key={i} className="h-20 rounded-xl animate-pulse"
                    style={{ background: "rgba(0,0,0,0.06)" }} />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {infraTypes.map(it => {
                  const meta     = it.metadata || {};
                  const selected = selectedInfraId === it.id;
                  return (
                    <button key={it.id} type="button"
                      onClick={() => { setSelectedInfraId(selected ? "" : it.id); setCustomInfraName(""); }}
                      className="flex flex-col items-center gap-1.5 p-3 rounded-xl text-xs font-medium transition-all"
                      style={{
                        background: selected ? "rgba(56,189,248,0.12)" : "rgba(255,255,255,0.7)",
                        border: `1px solid ${selected ? "rgba(56,189,248,0.35)" : "rgba(0,0,0,0.07)"}`,
                        color: selected ? "#38bdf8" : "#64748b",
                      }}>
                      <span className="text-2xl">{meta.icon || "📍"}</span>
                      <span className="text-center leading-tight text-[11px]">{it.name}</span>
                    </button>
                  );
                })}

                <button type="button" onClick={() => setSelectedInfraId("other")}
                  className="flex flex-col items-center gap-1.5 p-3 rounded-xl text-xs font-medium transition-all"
                  style={{
                    background: isOtherType ? "rgba(251,146,60,0.12)" : "rgba(255,255,255,0.7)",
                    border: `1px solid ${isOtherType ? "rgba(251,146,60,0.35)" : "rgba(0,0,0,0.07)"}`,
                    color: isOtherType ? "#fb923c" : "#64748b",
                  }}>
                  <span className="text-2xl">🔧</span>
                  <span className="text-center leading-tight text-[11px]">Something Else</span>
                </button>

                <button type="button" onClick={() => { setSelectedInfraId("ai"); setCustomInfraName(""); }}
                  className="flex flex-col items-center gap-1.5 p-3 rounded-xl text-xs font-medium transition-all"
                  style={{
                    background: isAiInfer ? "rgba(139,92,246,0.12)" : "rgba(255,255,255,0.7)",
                    border: `1px solid ${isAiInfer ? "rgba(139,92,246,0.35)" : "rgba(0,0,0,0.07)"}`,
                    color: isAiInfer ? "#a78bfa" : "#64748b",
                  }}>
                  <span className="text-2xl">🤖</span>
                  <span className="text-center leading-tight text-[11px]">Let AI Decide</span>
                </button>
              </div>
            )}

            {isOtherType && (
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                  Describe the infrastructure type
                </label>
                <input type="text" value={customInfraName}
                  onChange={e => setCustomInfraName(e.target.value)}
                  placeholder="E.g. Flyover crack, Bus shelter damage…"
                  maxLength={100} autoFocus
                  className="w-full px-4 py-2.5 rounded-xl text-sm ginput" />
                <p className="text-[10px] text-slate-600 mt-1.5">A new infrastructure category will be created automatically.</p>
              </div>
            )}

            {isAiInfer && (
              <p className="text-[11px] px-3 py-2 rounded-xl"
                style={{ background: "rgba(139,92,246,0.1)", color: "#a78bfa", border: "1px solid rgba(139,92,246,0.2)" }}>
                🤖 AI will infer the issue type from your description and photo.
              </p>
            )}

            <div className="flex gap-3">
              <button type="button" onClick={() => setStep(2)}
                className="h-12 w-24 rounded-xl text-sm font-bold text-white gbtn-ghost">← Back</button>
              <button type="button" disabled={!canProceedStep3} onClick={() => setStep(4)}
                className="flex-1 h-12 rounded-xl text-sm font-bold text-white gbtn-sky disabled:opacity-40">
                {canProceedStep3
                  ? "Next — Describe Issue →"
                  : isOtherType ? "Describe the type to continue" : "Select a type to continue"}
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 4: Description + Submit ── */}
        {step === 4 && (
          <div className="flex flex-col gap-4">
            {/* Summary card */}
            <div className="gcard p-4 flex items-center gap-4">
              {imagePreview && (
                <img src={imagePreview} alt="" className="w-14 h-14 rounded-xl object-cover shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-slate-500">Your complaint so far</p>
                <p className="text-sm font-medium text-white mt-0.5 truncate">
                  {isKnownType
                    ? infraTypes.find(it => it.id === selectedInfraId)?.name
                    : isOtherType ? customInfraName || "Custom type" : "🤖 AI will classify"}
                </p>
                <p className="text-[10px] text-slate-500 mt-0.5 truncate">
                  {addressText || (lat && `${lat.toFixed(5)}, ${lng.toFixed(5)}`)}
                </p>
              </div>
              <button type="button" onClick={() => setStep(3)}
                className="text-sky-400 text-xs font-bold hover:text-sky-300 transition-colors">Edit</button>
            </div>

            <div className="gcard p-6">
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                Describe the issue
              </label>
              <textarea
                className="w-full h-32 px-4 py-3 rounded-xl text-sm resize-vertical ginput"
                value={text}
                onChange={e => setText(e.target.value)}
                placeholder="E.g. Pothole on the road near the market, around 40cm wide and very deep. Vehicles swerving to avoid it…"
                required autoFocus />
              <p className="text-[10px] text-slate-600 mt-2 flex items-center gap-1">
                <span className="material-symbols-outlined text-[12px]">translate</span>
                Supports Hindi, English, and 20+ Indian languages
              </p>
            </div>

            <div className="flex gap-3">
              <button type="button" onClick={() => setStep(3)}
                className="h-12 w-24 rounded-xl text-sm font-bold text-white gbtn-ghost">← Back</button>
              <button type="submit" disabled={isSubmitting || !canSubmit}
                className="flex-1 h-12 flex items-center justify-center gap-2 rounded-xl text-sm font-bold text-white gbtn-sky disabled:opacity-40 transition-all active:scale-[0.98]">
                <span className="material-symbols-outlined text-lg">send</span>
                {isSubmitting ? "Submitting…" : "Submit Complaint"}
              </button>
            </div>
          </div>
        )}
      </form>
    </AppLayout>
  );
}
