// src/pages/SubmitComplaintPage.jsx

import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapContainer, Marker, TileLayer, useMapEvents } from "react-leaflet";
import {
  submitComplaint,
  fetchInfraTypes,
  reverseGeocode,
  forwardGeocode,
} from "../api/complaintsApi";
import AppLayout from "../components/AppLayout";
import { toast } from "sonner";
import { Card, CardHeader, CardTitle, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

const markerIcon = new L.Icon({
  iconUrl:   "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize:  [25, 41],
  iconAnchor:[12, 41],
});

// ── Leaflet click-to-pin ──────────────────────────────────────────
function LocationPicker({ lat, lng, setLat, setLng, onPin }) {
  const map = useMapEvents({
    async click(e) {
      setLat(e.latlng.lat);
      setLng(e.latlng.lng);
      if (onPin) onPin(e.latlng.lat, e.latlng.lng);
    },
  });

  useEffect(() => {
    if (lat !== null && lng !== null) {
      map.flyTo([lat, lng], map.getZoom());
    }
  }, [lat, lng, map]);

  return lat !== null && lng !== null ? (
    <Marker position={[lat, lng]} icon={markerIcon} />
  ) : null;
}

// ── Step indicator ────────────────────────────────────────────────
function StepDot({ n, active, done }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
        done   ? "bg-green-500 text-white" :
        active ? "bg-primary text-on-primary ring-4 ring-primary/20" :
                 "bg-surface-container border border-outline-variant text-on-surface-variant"
      }`}>
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

  // Step — 1:photo, 2:location, 3:infra-type, 4:description
  const [step, setStep] = useState(1);

  // Photo
  const [image,          setImage]          = useState(null);
  const [imagePreview,   setImagePreview]   = useState(null);
  const [isCameraActive, setIsCameraActive] = useState(false);

  // Location
  const [lat,             setLat]             = useState(null);
  const [lng,             setLng]             = useState(null);
  const [locationStatus,  setLocationStatus]  = useState("Waiting for GPS…");

  // Address — single field, populated from user input OR reverse geocode
  const [addressText,    setAddressText]    = useState("");
  const [addressLoading, setAddressLoading] = useState(false);

  // Forward geocode search (address → pin)
  const [addressSearch,  setAddressSearch]  = useState("");
  const [searchLoading,  setSearchLoading]  = useState(false);

  // Infra type
  const [infraTypes,        setInfraTypes]        = useState([]);
  const [infraTypesLoading, setInfraTypesLoading] = useState(true);
  const [selectedInfraId,   setSelectedInfraId]   = useState(""); // UUID | "other" | "ai"
  const [customInfraName,   setCustomInfraName]   = useState("");

  // Description
  const [text,         setText]         = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ── Load infra types ─────────────────────────────────────────
  useEffect(() => {
    fetchInfraTypes()
      .then(setInfraTypes)
      .catch(() => toast.error("Could not load issue types — you can still submit."))
      .finally(() => setInfraTypesLoading(false));
  }, []);

  // ── Helpers ──────────────────────────────────────────────────
  const isKnownType = selectedInfraId && selectedInfraId !== "other" && selectedInfraId !== "ai";
  const isOtherType = selectedInfraId === "other";
  const isAiInfer   = selectedInfraId === "ai" || selectedInfraId === "";

  // ── Reverse geocode a location and fill addressText ──────────
  const doReverseGeocode = async (lat, lng) => {
    setAddressLoading(true);
    const addr = await reverseGeocode(lat, lng);
    if (addr) setAddressText(addr);
    setAddressLoading(false);
  };

  // ── GPS ──────────────────────────────────────────────────────
  const requestCurrentLocation = () => {
    if (!navigator.geolocation) {
      setLocationStatus("Geolocation not supported. Pin on map.");
      return;
    }
    setLocationStatus("Fetching location…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setLat(latitude);
        setLng(longitude);
        setLocationStatus("Location fetched via GPS.");
        doReverseGeocode(latitude, longitude);
      },
      () => setLocationStatus("GPS failed or denied. Pin on map."),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  // ── Forward geocode search ────────────────────────────────────
  const handleAddressSearch = async () => {
    if (!addressSearch.trim()) return;
    setSearchLoading(true);
    const result = await forwardGeocode(addressSearch);
    if (result) {
      setLat(result.lat);
      setLng(result.lng);
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

  // ── Camera ───────────────────────────────────────────────────
  const startCamera = async () => {
    setIsCameraActive(true);
    setImage(null);
    setImagePreview(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch {
      toast.error("Camera access denied.");
      setIsCameraActive(false);
    }
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
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
    c.toBlob(blob => {
      if (!blob) return;
      const file = new File([blob], "webcam_photo.jpg", { type: "image/jpeg" });
      setImage(file);
      setImagePreview(URL.createObjectURL(file));
      stopCamera();
    }, "image/jpeg");
  };

  const handleFileUpload = e => {
    const file = e.target.files?.[0];
    if (file) {
      setImage(file);
      setImagePreview(URL.createObjectURL(file));
      stopCamera();
    }
  };

  const clearPhoto = () => {
    setImage(null);
    setImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // ── Validation ───────────────────────────────────────────────
  const canProceedStep1 = !!image;
  const canProceedStep2 = lat !== null && lng !== null;
  const canProceedStep3 = selectedInfraId !== "" &&
    (selectedInfraId !== "other" || customInfraName.trim().length >= 3);
  const canSubmit = canProceedStep1 && canProceedStep2 && canProceedStep3 &&
    text.trim().length >= 5;

  // ── Submit ───────────────────────────────────────────────────
  const handleSubmit = async e => {
    e.preventDefault();
    if (!canSubmit) { toast.error("Please complete all steps."); return; }

    setIsSubmitting(true);
    try {
      const complaint = await submitComplaint({
        text:                text.trim() || "Issue observed at location",
        lat,
        lng,
        image,
        addressText:         addressText.trim() || undefined,
        infraTypeId:         isKnownType ? selectedInfraId : undefined,
        customInfraTypeName: isOtherType ? customInfraName.trim() : undefined,
        // else: AI infers
      });
      toast.success("Complaint submitted!");
      navigate(`/complaints/${complaint.complaint_id}`);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Submission failed. Try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────
  return (
    <AppLayout title="Report Issue">
      <form onSubmit={handleSubmit} className="space-y-6 max-w-[860px] pb-10">

        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-xs text-on-surface-variant font-medium">
          <span>Dashboard</span>
          <span className="material-symbols-outlined text-[14px]">chevron_right</span>
          <span className="text-primary font-bold">Report Issue</span>
        </nav>

        <h3 className="font-headline font-bold text-xl text-on-surface">Report a Civic Issue</h3>

        {/* Step bar */}
        <div className="flex items-center gap-0">
          {["Photo", "Location", "Issue Type", "Description"].map((label, i) => (
            <React.Fragment key={label}>
              <button
                type="button"
                onClick={() => setStep(i + 1)}
                className="flex flex-col items-center gap-1 flex-shrink-0"
              >
                <StepDot
                  n={i + 1}
                  active={step === i + 1}
                  done={
                    (i === 0 && canProceedStep1) ||
                    (i === 1 && canProceedStep2) ||
                    (i === 2 && canProceedStep3)
                  }
                />
                <span className={`text-[10px] font-semibold hidden sm:block ${
                  step === i + 1 ? "text-primary" : "text-on-surface-variant"
                }`}>{label}</span>
              </button>
              {i < 3 && <div className="flex-1 h-px bg-outline-variant mx-1 mb-4" />}
            </React.Fragment>
          ))}
        </div>

        {/* ── STEP 1: Photo ── */}
        {step === 1 && (
          <Card className="animate-in fade-in">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Take or upload a photo</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">Photo helps officials assess severity faster</p>
            </CardHeader>

            <CardContent>
              <div className="relative h-[300px] bg-surface-container-low flex items-center justify-center mb-5 rounded-xl overflow-hidden border border-outline-variant/10">
                {isCameraActive ? (
                  <>
                    <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2 z-10">
                      <Button type="button" onClick={capturePhoto} className="rounded-full shadow-lg">
                        Capture
                      </Button>
                      <Button variant="secondary" type="button" onClick={stopCamera} className="rounded-full">
                        Cancel
                      </Button>
                    </div>
                  </>
                ) : imagePreview ? (
                  <>
                    <img src={imagePreview} alt="Preview" className="w-full h-full object-cover" />
                    <Button variant="secondary" size="sm" type="button" onClick={clearPhoto}
                      className="absolute top-3 right-3 rounded-full text-xs font-bold">
                      ✕ Remove
                    </Button>
                  </>
                ) : (
                  <div className="flex flex-col items-center gap-4">
                    <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center">
                      <span className="material-symbols-outlined text-primary text-4xl">photo_camera</span>
                    </div>
                    <div className="flex gap-3">
                      <Button type="button" onClick={startCamera} className="rounded-full">
                        Use Camera
                      </Button>
                      <Button variant="outline" type="button" onClick={() => fileInputRef.current?.click()} className="rounded-full">
                        Upload File
                      </Button>
                    </div>
                  </div>
                )}
                <input type="file" accept="image/*" ref={fileInputRef} className="hidden" onChange={handleFileUpload} />
              </div>

              <Button
                type="button"
                disabled={!canProceedStep1}
                onClick={() => setStep(2)}
                className="w-full h-12 rounded-xl"
              >
                {canProceedStep1 ? "Next — Set Location →" : "Photo required to continue"}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* ── STEP 2: Location ── */}
        {step === 2 && (
          <Card className="animate-in fade-in">
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-sm font-semibold">Where is the issue?</CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">Allow GPS, tap on map, or search by address</p>
              </div>
              <Button variant="outline" size="sm" type="button" onClick={requestCurrentLocation} className="rounded-full flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px]">my_location</span>
                Use GPS
              </Button>
            </CardHeader>

            <CardContent>
              {/* Address search bar */}
              <div className="flex gap-2 mb-3">
                <Input
                  type="text"
                  value={addressSearch}
                  onChange={e => setAddressSearch(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleAddressSearch()}
                  placeholder="Search address or landmark…"
                  className="flex-1"
                />
                <Button
                  type="button"
                  onClick={handleAddressSearch}
                  disabled={searchLoading || !addressSearch.trim()}
                >
                  {searchLoading ? "…" : "Find"}
                </Button>
              </div>

              {/* Map */}
              <div className="rounded-xl overflow-hidden border border-outline-variant/10 mb-4" style={{ height: 280 }}>
                <MapContainer
                  center={lat !== null ? [lat, lng] : [28.6139, 77.209]}
                  zoom={14}
                  scrollWheelZoom
                  style={{ height: "100%", width: "100%" }}
                >
                  <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                  <LocationPicker
                    lat={lat} lng={lng}
                    setLat={setLat} setLng={setLng}
                    onPin={(lat, lng) => {
                      setLocationStatus("Location pinned on map.");
                      doReverseGeocode(lat, lng);
                    }}
                  />
                </MapContainer>
              </div>

              {/* Address field */}
              <div className="mb-4">
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="material-symbols-outlined text-[14px] text-muted-foreground">location_on</span>
                  <Label className="text-xs font-semibold text-muted-foreground">Address</Label>
                  {addressLoading && (
                    <span className="text-[10px] text-primary animate-pulse">Detecting…</span>
                  )}
                </div>
                <Input
                  type="text"
                  value={addressText}
                  onChange={e => setAddressText(e.target.value)}
                  placeholder="Auto-filled from GPS · Edit if needed"
                />
                <p className="text-[10px] text-muted-foreground mt-1.5">
                  Helps officials and workers find the exact location · Optional but recommended
                </p>
              </div>

              {/* Coords */}
              <div className="mb-6">
                <p className="text-xs text-muted-foreground font-medium">{locationStatus}</p>
                {lat !== null && (
                  <p className="font-mono text-[10px] text-muted-foreground mt-0.5">
                    {lat.toFixed(5)}, {lng.toFixed(5)}
                  </p>
                )}
              </div>

              <div className="flex gap-3">
                <Button variant="outline" type="button" onClick={() => setStep(1)} className="h-12 w-24 rounded-xl">
                  ← Back
                </Button>
                <Button
                  type="button"
                  disabled={!canProceedStep2}
                  onClick={() => setStep(3)}
                  className="flex-1 h-12 rounded-xl"
                >
                  {canProceedStep2 ? "Next — Issue Type →" : "Pin location to continue"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── STEP 3: Infra Type ── */}
        {step === 3 && (
          <Card className="animate-in fade-in">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">What type of issue is it?</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Helps route to the right department. Skip if unsure — AI will classify it.
              </p>
            </CardHeader>
            <CardContent>
              {infraTypesLoading ? (
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mb-4">
                  {Array(8).fill(0).map((_, i) => (
                    <div key={i} className="h-20 rounded-xl bg-outline-variant/20 animate-pulse" />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mb-4">
                  {/* Known types from DB */}
                  {infraTypes.map(it => {
                    const meta     = it.metadata || {};
                    const selected = selectedInfraId === it.id;
                    return (
                      <button
                        key={it.id}
                        type="button"
                        onClick={() => {
                          setSelectedInfraId(selected ? "" : it.id);
                          setCustomInfraName("");
                        }}
                        className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border text-xs font-medium transition-all ${
                          selected
                            ? "border-primary bg-primary/10 text-primary shadow-sm"
                            : "border-outline-variant bg-surface-container text-on-surface-variant hover:bg-surface-container-high"
                        }`}
                      >
                        <span className="text-2xl">{meta.icon || "📍"}</span>
                        <span className="text-center leading-tight text-[11px]">{it.name}</span>
                      </button>
                    );
                  })}

                  {/* Something Else */}
                  <button
                    type="button"
                    onClick={() => setSelectedInfraId("other")}
                    className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border text-xs font-medium transition-all ${
                      isOtherType
                        ? "border-orange-400 bg-orange-50 text-orange-600 shadow-sm"
                        : "border-outline-variant bg-surface-container text-on-surface-variant hover:bg-surface-container-high"
                    }`}
                  >
                    <span className="text-2xl">🔧</span>
                    <span className="text-center leading-tight text-[11px]">Something Else</span>
                  </button>

                  {/* Let AI Decide */}
                  <button
                    type="button"
                    onClick={() => { setSelectedInfraId("ai"); setCustomInfraName(""); }}
                    className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border text-xs font-medium transition-all ${
                      isAiInfer
                        ? "border-violet-400 bg-violet-50 text-violet-600 shadow-sm"
                        : "border-outline-variant bg-surface-container text-on-surface-variant hover:bg-surface-container-high"
                    }`}
                  >
                    <span className="text-2xl">🤖</span>
                    <span className="text-center leading-tight text-[11px]">Let AI Decide</span>
                  </button>
                </div>
              )}

              {/* Custom type input */}
              {isOtherType && (
                <div className="mb-4 animate-in slide-in-from-top-2">
                  <Label className="block text-xs font-semibold text-muted-foreground mb-2">
                    Describe the infrastructure type
                  </Label>
                  <Input
                    type="text"
                    value={customInfraName}
                    onChange={e => setCustomInfraName(e.target.value)}
                    placeholder="E.g. Flyover crack, Bus shelter damage, Park bench broken…"
                    maxLength={100}
                    autoFocus
                  />
                  <p className="text-[10px] text-muted-foreground mt-1.5">
                    A new infrastructure category will be created automatically.
                  </p>
                </div>
              )}

              {isAiInfer && (
                <p className="mb-4 text-[11px] text-violet-600 bg-violet-50 px-3 py-2 rounded-lg">
                  🤖 AI will infer the issue type from your description and photo.
                </p>
              )}

              <div className="flex gap-3">
                <Button variant="outline" type="button" onClick={() => setStep(2)} className="h-12 w-24 rounded-xl">
                  ← Back
                </Button>
                <Button
                  type="button"
                  disabled={!canProceedStep3}
                  onClick={() => setStep(4)}
                  className="flex-1 h-12 rounded-xl"
                >
                  {canProceedStep3
                    ? "Next — Describe Issue →"
                    : isOtherType
                    ? "Describe the type to continue"
                    : "Select a type to continue"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── STEP 4: Description + Submit ── */}
        {step === 4 && (
          <div className="space-y-4 animate-in fade-in">

            {/* Summary card */}
            <Card className="flex items-center gap-4 p-4 bg-muted/30">
              {imagePreview && (
                <img src={imagePreview} alt="" className="w-14 h-14 rounded-lg object-cover flex-shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-muted-foreground">Your complaint so far</p>
                <p className="text-sm font-medium mt-0.5 truncate">
                  {isKnownType
                    ? infraTypes.find(it => it.id === selectedInfraId)?.name
                    : isOtherType
                    ? customInfraName || "Custom type"
                    : "🤖 AI will classify"}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                  {addressText || `${lat?.toFixed(5)}, ${lng?.toFixed(5)}`}
                </p>
              </div>
              <Button variant="ghost" size="sm" type="button" onClick={() => setStep(3)} className="text-primary font-bold">
                Edit
              </Button>
            </Card>

            <Card>
              <CardContent className="pt-5">
                <Label className="block text-[13px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                  Describe the issue
                </Label>
                <textarea
                  className="w-full h-[130px] bg-muted/50 border border-border rounded-xl px-4 py-3 text-sm resize-vertical focus:ring-2 focus:ring-ring focus:outline-none transition-all"
                  value={text}
                  onChange={e => setText(e.target.value)}
                  placeholder="E.g. Pothole on the road near the market, around 40cm wide and very deep. Vehicles swerving to avoid it…"
                  required
                  autoFocus
                />
                <p className="text-[10px] text-muted-foreground mt-2 flex items-center">
                  <span className="material-symbols-outlined text-[12px] mr-1">translate</span>
                  Supports Hindi, English, and 20+ Indian languages
                </p>
              </CardContent>
            </Card>

            <div className="flex gap-3 mt-4">
              <Button variant="outline" type="button" onClick={() => setStep(3)} className="h-12 w-24 rounded-xl">
                ← Back
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting || !canSubmit}
                className="flex-1 h-12 flex items-center justify-center gap-2 rounded-xl font-bold shadow-lg transition-all active:scale-[0.98]"
              >
                <span className="material-symbols-outlined text-lg">send</span>
                {isSubmitting ? "Submitting…" : "Submit Complaint"}
              </Button>
            </div>
          </div>
        )}

      </form>
    </AppLayout>
  );
}