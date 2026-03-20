import { useEffect, useState, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { MapContainer, TileLayer, Marker, Popup, ZoomControl } from "react-leaflet";
import L from "leaflet";
import AppLayout from "../components/AppLayout";
import { fetchMyComplaints, fetchNearbyComplaints, fetchMyStats } from "../api/complaintsApi";
import { toast } from "sonner";

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl:       "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl:     "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const STATUS_COLOR = {
  received:          "#6750A4",
  clustered:         "#6750A4",
  mapped:            "#6750A4",
  workflow_started:  "#2196F3",
  in_progress:       "#FF9800",
  midway_survey_sent:"#FF9800",
  resolved:          "#4CAF50",
  closed:            "#4CAF50",
  rejected:          "#F44336",
  escalated:         "#F44336",
  emergency:         "#B00020",
  constraint_blocked:"#795548",
};

const STATUS_LABEL = {
  received: "Received", clustered: "Clustered", mapped: "Mapped",
  workflow_started: "Assigned", in_progress: "In Progress",
  midway_survey_sent: "Survey Sent", resolved: "Resolved",
  closed: "Closed", rejected: "Rejected", escalated: "Escalated",
  emergency: "Emergency", constraint_blocked: "Blocked",
};

function makeIcon(color) {
  return L.divIcon({
    className: "",
    html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

function timeAgo(iso) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const DELHI_CENTER = [28.6139, 77.209];

export default function DashboardPage() {
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem("auth_user") || "{}");

  const [complaints, setComplaints]   = useState([]);
  const [nearbyPins, setNearbyPins]   = useState([]);
  const [stats, setStats]             = useState(null);
  const [userLocation, setUserLocation] = useState(null); // [lat, lng]
  const [locationStatus, setLocationStatus] = useState("locating");
  const [loading, setLoading]         = useState(true);

  // Step 1: get user's GPS location
  useEffect(() => {
    if (!navigator.geolocation) {
      setUserLocation(DELHI_CENTER);
      setLocationStatus("unavailable");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLocation([pos.coords.latitude, pos.coords.longitude]);
        setLocationStatus("found");
      },
      () => {
        setUserLocation(DELHI_CENTER); // fallback to Delhi centre
        setLocationStatus("denied");
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }, []);

  // Step 2: once we have location, load everything
  useEffect(() => {
    if (!userLocation) return;

    async function load() {
      setLoading(true);
      try {
        const [complaintsRes, nearbyRes, statsRes] = await Promise.all([
          fetchMyComplaints({ limit: 5 }),
          fetchNearbyComplaints(userLocation[0], userLocation[1], 4000),
          fetchMyStats(),
        ]);
        setComplaints(complaintsRes.items || []);
        setNearbyPins(nearbyRes || []);
        setStats(statsRes);
      } catch (e) {
        toast.error("Failed to load dashboard data.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [userLocation]);

  const totalAll      = stats?.total_count      ?? 1;
  const totalResolved = stats?.resolved_count   ?? 0;
  const slaPercent    = totalAll > 0 ? Math.round((totalResolved / totalAll) * 100) : 0;
  const circumference = 2 * Math.PI * 24;
  const slaOffset     = circumference * (1 - slaPercent / 100);

  const activeComplaints = complaints.filter(
    (c) => !["resolved", "closed", "rejected"].includes(c.status)
  );

  return (
    <AppLayout>
      <div className="flex flex-col gap-6 p-6 lg:flex-row min-h-0">

        {/* ── LEFT COLUMN ── */}
        <div className="flex flex-col gap-5 lg:w-[58%]">

          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-headline font-bold text-on-surface">
                Namaskar, {user.full_name?.split(" ")[0] || "Citizen"} 🙏
              </h1>
              <p className="text-sm text-on-surface-variant mt-0.5">
                {loading
                  ? "Loading your grievances…"
                  : `${stats?.total_count ?? 0} total · ${stats?.active_count ?? 0} active · ${stats?.resolved_count ?? 0} resolved`}
              </p>
            </div>
            <Link
              to="/submit"
              className="bg-primary text-on-primary px-5 py-2.5 rounded-full text-sm font-semibold hover:bg-primary/90 transition flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-[18px]">add</span>
              New Report
            </Link>
          </div>

          {/* MAP — 4km radius of real complaints */}
          <div className="relative rounded-2xl overflow-hidden border border-outline-variant">
            {/* Status bar */}
            <div className="absolute top-3 left-3 z-[500] bg-surface/90 backdrop-blur-sm px-3 py-1.5 rounded-full flex items-center gap-2 text-xs font-medium shadow-sm">
              <span className={`w-2 h-2 rounded-full ${locationStatus === "found" ? "bg-green-500 animate-pulse" : "bg-amber-400"}`} />
              {locationStatus === "locating" && "Getting your location…"}
              {locationStatus === "found"    && `${nearbyPins.length} complaints within 4 km`}
              {locationStatus === "denied"   && `${nearbyPins.length} complaints near Delhi centre`}
              {locationStatus === "unavailable" && "Geolocation unavailable"}
            </div>

            <MapContainer
              center={userLocation || DELHI_CENTER}
              zoom={13}
              scrollWheelZoom={false}
              style={{ height: "300px", width: "100%" }}
              zoomControl={false}
            >
              <TileLayer
                attribution='&copy; <a href="https://osm.org/copyright">OSM</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <ZoomControl position="bottomright" />

              {/* User's own location marker */}
              {userLocation && locationStatus === "found" && (
                <Marker
                  position={userLocation}
                  icon={L.divIcon({
                    className: "",
                    html: `<div style="width:16px;height:16px;border-radius:50%;background:#2196F3;border:3px solid white;box-shadow:0 0 0 3px rgba(33,150,243,0.3)"></div>`,
                    iconSize: [16, 16],
                    iconAnchor: [8, 8],
                  })}
                >
                  <Popup><p className="text-sm font-semibold">You are here</p></Popup>
                </Marker>
              )}

              {/* Nearby complaints from real DB */}
              {nearbyPins.map((pin) => (
                <Marker
                  key={pin.id}
                  position={[pin.lat, pin.lng]}
                  icon={makeIcon(STATUS_COLOR[pin.status] || "#6750A4")}
                >
                  <Popup>
                    <div className="text-sm">
                      <p className="font-bold">{pin.title}</p>
                      <p className="text-xs capitalize text-gray-500">
                        {STATUS_LABEL[pin.status] || pin.status}
                        {pin.distance_meters && ` · ${(pin.distance_meters / 1000).toFixed(1)} km away`}
                      </p>
                      <button
                        className="text-blue-600 underline text-xs mt-1"
                        onClick={() => navigate(`/complaints/${pin.id}`)}
                      >
                        View details →
                      </button>
                    </div>
                  </Popup>
                </Marker>
              ))}
            </MapContainer>

            {/* Legend */}
            <div className="absolute bottom-3 left-3 z-[500] bg-surface/90 backdrop-blur-sm px-3 py-1.5 rounded-xl text-xs shadow-sm flex gap-3">
              {["in_progress", "resolved", "rejected"].map((s) => (
                <span key={s} className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ background: STATUS_COLOR[s] }} />
                  {STATUS_LABEL[s]} ({nearbyPins.filter((p) => p.status === s).length})
                </span>
              ))}
            </div>
          </div>

          {/* Recent complaints list */}
          <div className="bg-surface-container-low rounded-2xl p-5 border border-outline-variant">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-headline font-semibold text-on-surface flex items-center gap-2">
                <span className="material-symbols-outlined text-[20px] text-primary">receipt_long</span>
                My Recent Complaints
              </h2>
              <Link to="/my-complaints" className="text-primary text-sm hover:underline">View all →</Link>
            </div>

            {loading ? (
              <div className="flex flex-col gap-3">
                {[1, 2, 3].map((n) => (
                  <div key={n} className="h-16 rounded-xl bg-outline-variant/30 animate-pulse" />
                ))}
              </div>
            ) : complaints.length === 0 ? (
              <div className="text-center py-8 text-on-surface-variant">
                <span className="material-symbols-outlined text-5xl mb-2">inbox</span>
                <p className="text-sm">No complaints filed yet.</p>
                <Link to="/submit" className="text-primary text-sm mt-1 inline-block hover:underline">
                  File your first one →
                </Link>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {complaints.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-start gap-3 p-3 rounded-xl bg-surface-container hover:bg-surface-container-high transition cursor-pointer"
                    onClick={() => navigate(`/complaints/${c.id}`)}
                  >
                    <div className="flex flex-col gap-1 flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-on-surface-variant font-mono">#{c.complaint_number}</span>
                        <span
                          className="text-xs font-semibold px-2 py-0.5 rounded-full capitalize"
                          style={{
                            background: (STATUS_COLOR[c.status] || "#666") + "22",
                            color: STATUS_COLOR[c.status] || "#666",
                          }}
                        >
                          {STATUS_LABEL[c.status] || c.status}
                        </span>
                        {c.is_repeat_complaint && (
                          <span className="text-xs text-error font-semibold">Repeat</span>
                        )}
                      </div>
                      <p className="text-sm font-medium text-on-surface truncate">{c.title}</p>
                      {c.address_text && (
                        <p className="text-xs text-on-surface-variant truncate">{c.address_text}</p>
                      )}
                    </div>
                    <div className="text-right text-xs text-on-surface-variant whitespace-nowrap">
                      {timeAgo(c.created_at)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── RIGHT COLUMN ── */}
        <div className="flex flex-col gap-5 lg:w-[42%]">
          {/* Stats */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Total",    value: stats?.total_count,    icon: "receipt_long" },
              { label: "Active",   value: stats?.active_count,   icon: "pending" },
              { label: "Resolved", value: stats?.resolved_count, icon: "check_circle" },
            ].map((s) => (
              <div key={s.label} className="bg-surface-container-low rounded-2xl p-4 border border-outline-variant flex flex-col items-center gap-1">
                <span className="material-symbols-outlined text-primary text-[24px]">{s.icon}</span>
                <span className="text-2xl font-headline font-bold text-on-surface">
                  {loading ? "…" : (s.value ?? 0)}
                </span>
                <span className="text-xs text-on-surface-variant">{s.label}</span>
              </div>
            ))}
          </div>

          {/* Resolution rate */}
          <div className="bg-surface-container-low rounded-2xl p-5 border border-outline-variant">
            <h2 className="font-headline font-semibold text-on-surface mb-4 flex items-center gap-2">
              <span className="material-symbols-outlined text-[20px] text-primary">timer</span>
              Resolution Rate
            </h2>
            <div className="flex items-center gap-6">
              <div className="relative w-16 h-16">
                <svg className="rotate-[-90deg]" width="64" height="64" viewBox="0 0 64 64">
                  <circle cx="32" cy="32" r="24" fill="none" stroke="#e8def8" strokeWidth="6" />
                  <circle cx="32" cy="32" r="24" fill="none" stroke="#6750A4" strokeWidth="6"
                    strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={slaOffset} />
                </svg>
                <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-on-surface">
                  {loading ? "…" : `${slaPercent}%`}
                </span>
              </div>
              <div>
                <p className="text-sm font-medium text-on-surface">
                  {loading ? "Loading…" : `${totalResolved} of ${totalAll} resolved`}
                </p>
                {stats?.avg_resolution_days != null && (
                  <p className="text-xs text-on-surface-variant mt-1">
                    Avg. {stats.avg_resolution_days} days to resolve
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Quick actions */}
          <div className="bg-surface-container-low rounded-2xl p-5 border border-outline-variant">
            <h2 className="font-headline font-semibold text-on-surface mb-4 flex items-center gap-2">
              <span className="material-symbols-outlined text-[20px] text-primary">bolt</span>
              Quick Actions
            </h2>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "Report Issue",    icon: "add_circle",    to: "/submit",         primary: true },
                { label: "My Complaints",   icon: "list_alt",      to: "/my-complaints" },
                { label: "Call 1031",       icon: "phone",         onClick: () => window.open("tel:1031") },
                { label: "Notifications",   icon: "notifications", to: "/notifications" },
              ].map((action) => {
                const cls = `flex flex-col items-center gap-1.5 p-3 rounded-xl border transition text-sm font-medium ${
                  action.primary
                    ? "bg-primary text-on-primary border-primary hover:bg-primary/90"
                    : "bg-surface-container border-outline-variant text-on-surface hover:bg-surface-container-high"
                }`;
                if (action.to) return (
                  <Link key={action.label} to={action.to} className={cls}>
                    <span className="material-symbols-outlined text-[22px]">{action.icon}</span>
                    {action.label}
                  </Link>
                );
                return (
                  <button key={action.label} className={cls} onClick={action.onClick}>
                    <span className="material-symbols-outlined text-[22px]">{action.icon}</span>
                    {action.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Active complaints summary */}
          {!loading && activeComplaints.length > 0 && (
            <div className="bg-surface-container-low rounded-2xl p-5 border border-outline-variant">
              <h2 className="font-headline font-semibold text-on-surface mb-3 flex items-center gap-2">
                <span className="material-symbols-outlined text-[20px] text-orange-500">pending</span>
                Active ({activeComplaints.length})
              </h2>
              {activeComplaints.map((c) => (
                <Link key={c.id} to={`/complaints/${c.id}`}
                  className="flex items-center gap-3 py-2 border-b border-outline-variant last:border-0 hover:text-primary transition"
                >
                  <span className="text-xs font-mono text-on-surface-variant">#{c.complaint_number}</span>
                  <span className="text-sm text-on-surface truncate flex-1">{c.title}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}