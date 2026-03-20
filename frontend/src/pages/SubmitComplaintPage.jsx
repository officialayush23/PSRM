import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapContainer, Marker, TileLayer, useMapEvents } from "react-leaflet";
import { submitComplaint } from "../api/complaintsApi";
import AppLayout from "../components/AppLayout";
import { toast } from "sonner";

const markerIcon = new L.Icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

function LocationPicker({ lat, lng, setLat, setLng }) {
  const map = useMapEvents({
    click(e) {
      setLat(e.latlng.lat);
      setLng(e.latlng.lng);
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

export default function SubmitComplaintPage() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const videoRef = useRef(null);

  const [text, setText] = useState("");
  const [lat, setLat] = useState(null);
  const [lng, setLng] = useState(null);
  const [locationStatus, setLocationStatus] = useState("Waiting for GPS permission...");

  const [image, setImage] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [isCameraActive, setIsCameraActive] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);

  const requestCurrentLocation = () => {
    if (!navigator.geolocation) {
      setLocationStatus("Geolocation not supported. Pin on map.");
      return;
    }

    setLocationStatus("Fetching current location...");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLat(position.coords.latitude);
        setLng(position.coords.longitude);
        setLocationStatus("Location fetched via GPS.");
      },
      () => {
        setLocationStatus("GPS failed or denied. Pin on map.");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  useEffect(() => {
    requestCurrentLocation();
    return () => stopCamera();
  }, []);

  useEffect(() => {
    if (lat !== null && lng !== null && locationStatus.includes("Pin")) {
      setLocationStatus("Location pinned on map.");
    }
  }, [lat, lng, locationStatus]);

  const startCamera = async () => {
    setIsCameraActive(true);
    setImage(null);
    setImagePreview(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch (err) {
      console.error(err);
      toast.error("Webcam access denied or unavailable.");
      setIsCameraActive(false);
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      videoRef.current.srcObject.getTracks().forEach((t) => t.stop());
    }
    setIsCameraActive(false);
  };

  const capturePhoto = () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], "webcam_photo.jpg", { type: "image/jpeg" });
      setImage(file);
      setImagePreview(URL.createObjectURL(file));
      stopCamera();
    }, "image/jpeg");
  };

  const handleFileUpload = (e) => {
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

  const openImageSourcePicker = () => {
    toast("Choose photo source", {
      action: {
        label: "Use Webcam",
        onClick: () => startCamera(),
      },
      cancel: {
        label: "Upload File",
        onClick: () => fileInputRef.current?.click(),
      },
    });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!image) {
      toast.error("Please take a photo or upload an image.");
      return;
    }
    if (lat === null || lng === null) {
      toast.error("Location is required. Allow GPS or pin on map.");
      return;
    }
    setIsSubmitting(true);
    try {
      const complaint = await submitComplaint({ text: text || "Issue observed at location", lat, lng, image });
      navigate(`/complaints/${complaint.complaint_id}`);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Complaint submission failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AppLayout title="Report Issue">
      <form onSubmit={handleSubmit} className="space-y-6 max-w-[900px]">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-xs text-on-surface-variant font-medium">
          <span>Dashboard</span>
          <span className="material-symbols-outlined text-[14px]">chevron_right</span>
          <span className="text-primary font-bold">Report Issue</span>
        </nav>

        <h3 className="font-headline font-bold text-xl text-on-surface">
          Report a New Civic Issue
        </h3>

        {/* Two-panel grid: Photo + Map */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Photo Panel */}
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 overflow-hidden shadow-sm">
            <div className="relative h-[280px] bg-surface-container-low flex items-center justify-center">
              {isCameraActive ? (
                <>
                  <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                  <div className="absolute top-3 left-1/2 -translate-x-1/2 flex gap-2 z-10">
                    <button type="button" onClick={capturePhoto} className="px-4 py-2 bg-primary text-on-primary rounded-lg text-sm font-bold shadow-lg">
                      Capture
                    </button>
                    <button type="button" onClick={stopCamera} className="px-4 py-2 bg-outline text-white rounded-lg text-sm font-bold shadow-lg">
                      Cancel
                    </button>
                  </div>
                </>
              ) : imagePreview ? (
                <>
                  <img src={imagePreview} alt="Preview" className="w-full h-full object-cover" />
                  <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10">
                    <button type="button" onClick={clearPhoto} className="px-4 py-2 bg-primary text-on-primary rounded-lg text-sm font-bold shadow-lg">
                      Retake / Clear
                    </button>
                  </div>
                </>
              ) : (
                <div
                  className="flex flex-col items-center gap-3 cursor-pointer group"
                  onClick={openImageSourcePicker}
                >
                  <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                    <span className="material-symbols-outlined text-primary text-3xl">photo_camera</span>
                  </div>
                  <span className="text-sm font-medium text-on-surface-variant">Tap to upload or take photo</span>
                </div>
              )}
              <input type="file" accept="image/*" ref={fileInputRef} className="hidden" onChange={handleFileUpload} />
            </div>
            <div className="px-4 py-3 border-t border-outline-variant/10">
              <p className="text-xs font-medium text-on-surface-variant text-center">
                {image ? `✓ Photo attached: ${image.name}` : "Photo required — shows issue to officials"}
              </p>
            </div>
          </div>

          {/* Location Panel */}
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 overflow-hidden shadow-sm">
            <div className="relative h-[280px]" style={{ zIndex: 1 }}>
              <MapContainer
                center={lat !== null && lng !== null ? [lat, lng] : [28.6139, 77.209]}
                zoom={14}
                scrollWheelZoom={true}
                style={{ height: "100%", width: "100%" }}
              >
                <TileLayer
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  attribution='&copy; <a href="https://osm.org/copyright">OSM</a>'
                />
                <LocationPicker lat={lat} lng={lng} setLat={setLat} setLng={setLng} />
              </MapContainer>
            </div>
            <div className="px-4 py-3 border-t border-outline-variant/10 flex items-center justify-between">
              <div className="text-xs text-on-surface-variant">
                <p className="font-medium">{locationStatus}</p>
                {lat !== null && lng !== null && (
                  <p className="font-mono text-[10px] mt-0.5">{lat.toFixed(6)}, {lng.toFixed(6)}</p>
                )}
              </div>
              <button type="button" onClick={requestCurrentLocation} className="px-3 py-1.5 bg-primary/10 text-primary text-xs font-bold rounded-lg hover:bg-primary/20 transition-colors">
                <span className="material-symbols-outlined text-sm mr-1">my_location</span>
                GPS
              </button>
            </div>
          </div>
        </div>

        {/* Description */}
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 p-5 shadow-sm">
          <label className="block text-[13px] font-semibold text-on-surface-variant uppercase tracking-wider mb-3">
            Describe the issue
          </label>
          <textarea
            className="w-full h-[120px] bg-surface-container-low border border-outline-variant/20 rounded-lg px-4 py-3 text-sm font-body resize-vertical focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="E.g. Broken streetlight near the main market, dark at night..."
            required
          />
          <p className="text-[10px] text-on-surface-variant mt-2">
            <span className="material-symbols-outlined text-[12px] mr-1">translate</span>
            Supports Hindi, English, and 20+ Indian languages via Bhashini
          </p>
        </div>

        {/* Submit Button */}
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full flex items-center justify-center gap-2 bg-primary text-on-primary py-3.5 rounded-lg font-bold text-sm shadow-lg shadow-primary/20 hover:bg-primary-container hover:text-on-primary-container transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <span className="material-symbols-outlined text-lg">send</span>
          {isSubmitting ? "Submitting..." : "Submit Complaint"}
        </button>
      </form>
    </AppLayout>
  );
}
