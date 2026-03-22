// src/pages/admin/AdminDashboardPage.jsx
// Admin (branch head) + Super Admin (city/dept head) dashboard
// super_admin sees dept-wide; admin sees their branch
// Tabs: Overview | Map | Complaints | Officials | Workers | Contractors | Performances

import { useEffect, useState } from "react";
import Map, { Marker, Layer, NavigationControl, Popup } from "react-map-gl";
import AppLayout from "../../components/AppLayout";
import CRMAgentChat from "../../components/CRMAgentChat";
import {
  fetchAdminKPI, fetchDailyBriefing, fetchComplaintQueue,
  fetchAvailableWorkers, fetchAvailableContractors, fetchOfficials, fetchDepartments,
  assignTask, fetchAvailableWorkers as fetchWorkers,
} from "../../api/adminApi";
import { fetchAllComplaints } from "../../api/complaintsApi";
import { toast } from "sonner";
import client from "../../api/client";

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;
const PC = { normal:"#6366f1", high:"#f97316", critical:"#ef4444", emergency:"#dc2626", low:"#94a3b8" };
const SC = { received:"#818cf8", workflow_started:"#38bdf8", in_progress:"#fb923c", resolved:"#34d399", closed:"#34d399", rejected:"#f87171" };
const DELHI = { longitude:77.209, latitude:28.6139, zoom:11, pitch:50, bearing:-15 };

const BUILDINGS = {
  id:"3d-buildings", source:"composite", "source-layer":"building",
  filter:["==","extrude","true"], type:"fill-extrusion", minzoom:12,
  paint:{
    "fill-extrusion-color":["interpolate",["linear"],["get","height"],0,"#e2e8f0",40,"#cbd5e1",100,"#94a3b8"],
    "fill-extrusion-height":["get","height"],
    "fill-extrusion-base":["get","min_height"],
    "fill-extrusion-opacity":0.65,
  },
};

function KPICard({ label, value, icon, color, sub, loading }) {
  return (
    <div className="bg-white rounded-2xl p-5 border hover:shadow-md transition-shadow"
      style={{ borderColor: color+"25" }}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">{label}</span>
        <span className="material-symbols-outlined text-[22px]" style={{ color }}>{icon}</span>
      </div>
      <p className="text-3xl font-black text-slate-900">{loading ? "…" : (value ?? 0)}</p>
      {sub && <p className="text-[11px] text-slate-400 mt-1">{sub}</p>}
    </div>
  );
}

function Pill({ label, color, size="sm" }) {
  const sz = size==="xs" ? "text-[10px] px-1.5 py-0.5" : "text-xs px-2.5 py-0.5";
  return (
    <span className={`${sz} rounded-full font-semibold capitalize inline-block`}
      style={{ background:color+"18", color }}>
      {label?.replace(/_/g," ")}
    </span>
  );
}

function Tabs({ tabs, active, onChange }) {
  return (
    <div className="flex gap-1 bg-slate-100 rounded-xl p-1 flex-wrap">
      {tabs.map(t => (
        <button key={t.key} onClick={() => onChange(t.key)}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
            active===t.key ? "bg-white text-sky-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
          }`}>
          <span className="material-symbols-outlined text-[15px]">{t.icon}</span>
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ── Performance score bar ─────────────────────────────────────────

function ScoreBar({ score, max=10 }) {
  const pct = (score / max) * 100;
  const color = pct >= 70 ? "#10b981" : pct >= 45 ? "#f97316" : "#ef4444";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width:`${pct}%`, background:color }} />
      </div>
      <span className="text-xs font-bold" style={{ color }}>{score?.toFixed(1)}</span>
    </div>
  );
}

// ── Overview tab ──────────────────────────────────────────────────

function OverviewTab({ kpi, briefing, loading, isSuperAdmin }) {
  const sections = briefing?.sections || [];
  const colors = { alert:"#fef2f2|#ef4444|#b91c1c", warning:"#fffbeb|#f59e0b|#92400e", info:"#eff6ff|#3b82f6|#1d4ed8" };

  return (
    <div className="flex flex-col gap-6">
      {briefing && (
        <div className="bg-gradient-to-r from-slate-900 to-slate-700 rounded-2xl p-6 text-white">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0">
              <span className="material-symbols-outlined text-white text-[20px]">smart_toy</span>
            </div>
            <div className="flex-1">
              <p className="text-xs font-bold text-white/60 uppercase tracking-wider mb-1">AI Morning Briefing</p>
              <p className="text-sm text-white/90 leading-relaxed">{briefing.greeting}</p>
            </div>
          </div>
          {sections.length > 0 && (
            <div className="mt-5 flex flex-col gap-2">
              {sections.map((s, i) => {
                const [bg, bd, tx] = (colors[s.type]||colors.info).split("|");
                return (
                  <div key={i} className="flex items-center gap-3 px-4 py-3 rounded-xl border text-sm font-medium"
                    style={{ background:bg, borderColor:bd, color:tx }}>
                    <span className="flex-1">{s.title}</span>
                    <span className="text-xs opacity-60">{s.action}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-4">
        <KPICard label="Total"         value={kpi?.summary?.total_complaints}     icon="assessment"    color="#6366f1" loading={loading} />
        <KPICard label="Open"          value={kpi?.summary?.open_complaints}      icon="inbox"         color="#3b82f6" loading={loading} />
        <KPICard label="Critical"      value={kpi?.summary?.critical_count}       icon="warning"       color="#ef4444" loading={loading} sub="Immediate action" />
        <KPICard label="Repeat"        value={kpi?.summary?.repeat_count}         icon="replay"        color="#f97316" loading={loading} />
        <KPICard label="SLA Risk"      value={kpi?.summary?.sla_at_risk}          icon="timer_off"     color="#dc2626" loading={loading} sub=">30d open" />
        <KPICard label="Avg Res. Days" value={kpi?.summary?.avg_resolution_days}  icon="schedule"      color="#10b981" loading={loading} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KPICard label="Tasks Active"    value={kpi?.tasks?.active}    icon="construction"  color="#f97316" loading={loading} />
        <KPICard label="Tasks Overdue"   value={kpi?.tasks?.overdue}   icon="alarm_off"     color="#ef4444" loading={loading} />
        <KPICard label="Tasks Completed" value={kpi?.tasks?.completed} icon="task_alt"      color="#10b981" loading={loading} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {kpi?.top_infra_types?.length > 0 && (
          <div className="bg-white rounded-2xl border p-5">
            <h3 className="font-bold text-slate-700 mb-4 flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px] text-sky-500">category</span>
              Top Infrastructure Issues
            </h3>
            <div className="flex flex-col gap-3">
              {kpi.top_infra_types.map(it => {
                const pct = Math.round((it.count / kpi.top_infra_types[0].count) * 100);
                return (
                  <div key={it.code} className="flex items-center gap-3">
                    <span className="text-sm text-slate-600 w-32 truncate">{it.infra_type}</span>
                    <div className="flex-1 h-2.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-sky-500 rounded-full" style={{ width:`${pct}%` }} />
                    </div>
                    <span className="text-sm font-bold text-slate-700 w-8 text-right">{it.count}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {kpi?.status_breakdown?.length > 0 && (
          <div className="bg-white rounded-2xl border p-5">
            <h3 className="font-bold text-slate-700 mb-4 flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px] text-sky-500">donut_small</span>
              Status Breakdown
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {kpi.status_breakdown.map(s => (
                <div key={s.status} className="flex items-center gap-2 p-3 rounded-xl bg-slate-50 border border-slate-100">
                  <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background:SC[s.status]||"#6366f1" }} />
                  <span className="text-xs text-slate-600 capitalize flex-1">{s.status.replace(/_/g," ")}</span>
                  <span className="text-sm font-black text-slate-800">{s.count}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {briefing?.oldest_open?.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-5">
          <h3 className="font-bold text-red-700 mb-3 flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px]">priority_high</span>
            Oldest Open Complaints — Immediate Attention Needed
          </h3>
          <div className="flex flex-col gap-2">
            {briefing.oldest_open.map((c, i) => (
              <div key={i} className="flex items-center gap-3 p-3 bg-white rounded-xl border border-red-100">
                <span className="w-7 h-7 rounded-full bg-red-100 text-red-600 text-xs font-black flex items-center justify-center">{c.age_days}d</span>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-800 text-sm truncate">{c.title}</p>
                  <p className="text-xs text-slate-500 truncate">{c.address_text}</p>
                </div>
                <Pill label={c.priority} color={PC[c.priority]} size="xs" />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Map tab ───────────────────────────────────────────────────────

function MapTab({ pins }) {
  const [mapLoaded, setMapLoaded] = useState(false);
  const [popup, setPopup] = useState(null);
  const [filter, setFilter] = useState("all");

  const visible = filter==="all" ? pins
    : pins.filter(p => filter==="critical" ? ["critical","emergency"].includes(p.priority)
      : filter==="repeat" ? p.is_repeat_complaint : p.status===filter);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2 flex-wrap">
        {[{k:"all",l:"All"},{k:"received",l:"Unassigned"},{k:"in_progress",l:"In Progress"},{k:"critical",l:"🔴 Critical"},{k:"repeat",l:"↩ Repeat"}].map(f => (
          <button key={f.k} onClick={() => setFilter(f.k)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${
              filter===f.k ? "bg-sky-600 text-white border-sky-600" : "bg-white text-slate-600 border-slate-200 hover:border-sky-300"
            }`}>{f.l}</button>
        ))}
      </div>
      <div className="rounded-2xl overflow-hidden border shadow-sm" style={{ height:560 }}>
        <Map initialViewState={DELHI} mapboxAccessToken={MAPBOX_TOKEN}
          mapStyle="mapbox://styles/mapbox/dark-v11"
          style={{ width:"100%", height:"100%" }}
          onLoad={() => setMapLoaded(true)} attributionControl={false}>
          <NavigationControl position="bottom-right" showCompass visualizePitch />
          {mapLoaded && <Layer {...{...BUILDINGS, paint:{...BUILDINGS.paint, "fill-extrusion-color":["interpolate",["linear"],["get","height"],0,"#1e293b",40,"#334155",100,"#475569"]}}} />}
          {visible.map(pin => (
            <Marker key={pin.id} longitude={pin.lng} latitude={pin.lat} anchor="bottom">
              <div onClick={() => setPopup(pin)} style={{
                width:["emergency","critical"].includes(pin.priority)?16:12,
                height:["emergency","critical"].includes(pin.priority)?16:12,
                borderRadius:"50%", background:PC[pin.priority]||"#6366f1",
                border:"2px solid rgba(255,255,255,0.4)", cursor:"pointer",
                boxShadow:`0 0 8px ${PC[pin.priority]||"#6366f1"}80`,
              }} />
            </Marker>
          ))}
          {popup && (
            <Popup longitude={popup.lng} latitude={popup.lat} anchor="top"
              onClose={() => setPopup(null)} closeButton={false}>
              <div className="p-3 min-w-[180px]">
                <div className="flex gap-2 mb-2 flex-wrap">
                  <Pill label={popup.priority} color={PC[popup.priority]} size="xs" />
                  <Pill label={popup.status} color={SC[popup.status]||"#6366f1"} size="xs" />
                </div>
                <p className="font-semibold text-slate-800 text-sm">{popup.title}</p>
                <p className="text-xs text-slate-500 mt-1">{popup.address_text}</p>
                {popup.is_repeat_complaint && <p className="text-xs text-orange-500 mt-1 font-semibold">↩ Repeat</p>}
              </div>
            </Popup>
          )}
        </Map>
      </div>
      <p className="text-xs text-center text-slate-400">{visible.length} of {pins.length} complaints shown</p>
    </div>
  );
}

// ── Officials Performance tab ─────────────────────────────────────

function OfficialsTab() {
  const [officials, setOfficials] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchOfficials().then(d => { setOfficials(d||[]); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="h-40 bg-slate-100 animate-pulse rounded-2xl" />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-slate-700">Officials ({officials.length})</h3>
      </div>
      <div className="bg-white border rounded-2xl overflow-hidden">
        <table className="w-full">
          <thead className="bg-slate-50 border-b">
            <tr>
              {["Name","Role","Department","Jurisdiction","Email"].map(h => (
                <th key={h} className="text-xs font-bold text-slate-500 uppercase px-4 py-3 text-left">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {officials.map(o => (
              <tr key={o.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-sky-100 flex items-center justify-center text-sky-700 font-bold text-xs flex-shrink-0">
                      {o.full_name?.charAt(0)}
                    </div>
                    <p className="font-semibold text-slate-800 text-sm">{o.full_name}</p>
                  </div>
                </td>
                <td className="px-4 py-3"><Pill label={o.role} color="#6366f1" size="xs" /></td>
                <td className="px-4 py-3 text-sm text-slate-600">{o.department_name}</td>
                <td className="px-4 py-3 text-sm text-slate-500">{o.jurisdiction_name||"—"}</td>
                <td className="px-4 py-3 text-xs text-slate-400">{o.email}</td>
              </tr>
            ))}
            {officials.length===0 && (
              <tr><td colSpan={5} className="text-center py-12 text-slate-400 text-sm">No officials found</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Workers tab ───────────────────────────────────────────────────

function WorkersTab() {
  const [workers, setWorkers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dept, setDept] = useState("");
  const [skill, setSkill] = useState("");
  const [departments, setDepartments] = useState([]);

  useEffect(() => {
    fetchDepartments().then(d => setDepartments(d||[]));
    fetchAvailableWorkers().then(d => { setWorkers(d||[]); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const filter = () => {
    setLoading(true);
    fetchAvailableWorkers({ deptId:dept||undefined, skill:skill||undefined })
      .then(d => { setWorkers(d||[]); setLoading(false); })
      .catch(() => setLoading(false));
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-3 flex-wrap">
        <select value={dept} onChange={e => setDept(e.target.value)}
          className="px-3 py-2 border rounded-xl text-sm focus:outline-none">
          <option value="">All Departments</option>
          {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <input value={skill} onChange={e => setSkill(e.target.value)}
          placeholder="Filter by skill…"
          className="px-3 py-2 border rounded-xl text-sm focus:outline-none w-48" />
        <button onClick={filter} className="px-4 py-2 bg-sky-600 text-white rounded-xl text-sm font-semibold">
          Filter
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading ? Array(6).fill(0).map((_,i) => <div key={i} className="h-40 rounded-2xl bg-slate-100 animate-pulse" />) :
          workers.map(w => (
            <div key={w.id} className="bg-white border rounded-2xl p-4 hover:shadow-md transition-shadow">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-sky-100 flex items-center justify-center text-sky-700 font-bold">
                  {w.full_name?.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-slate-800 text-sm">{w.full_name}</p>
                  <p className="text-xs text-slate-500">{w.department_name}</p>
                </div>
                <div className={`w-2.5 h-2.5 rounded-full ${w.is_available ? "bg-green-400":"bg-slate-300"}`} title={w.is_available?"Available":"Busy"} />
              </div>
              <ScoreBar score={w.performance_score} />
              <div className="flex items-center justify-between mt-2 text-xs text-slate-500">
                <span>{w.current_task_count} active tasks</span>
                {w.contractor_company && <span className="text-sky-500">{w.contractor_company}</span>}
              </div>
              {w.skills?.length > 0 && (
                <div className="flex gap-1 flex-wrap mt-2">
                  {w.skills.slice(0,4).map(s => (
                    <span key={s} className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{s}</span>
                  ))}
                </div>
              )}
            </div>
          ))
        }
        {!loading && workers.length===0 && (
          <div className="col-span-3 text-center py-16 text-slate-400">
            <span className="material-symbols-outlined text-5xl block mb-2">engineering</span>
            No workers found
          </div>
        )}
      </div>
    </div>
  );
}

// ── Contractors tab ───────────────────────────────────────────────

function ContractorsTab() {
  const [contractors, setContractors] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAvailableContractors().then(d => { setContractors(d||[]); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {loading ? Array(4).fill(0).map((_,i) => <div key={i} className="h-52 rounded-2xl bg-slate-100 animate-pulse" />) :
          contractors.map(c => (
            <div key={c.id} className="bg-white border rounded-2xl p-5 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="font-bold text-slate-800">{c.company_name}</p>
                  <p className="text-xs text-slate-500 font-mono">{c.registration_number}</p>
                </div>
                <div className="text-right">
                  <ScoreBar score={c.performance_score} />
                  <p className="text-xs text-slate-400 mt-1">{c.active_tasks}/{c.max_concurrent_tasks} tasks</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm border-t pt-3">
                <div>
                  <p className="text-xs text-slate-400">Contact</p>
                  <p className="font-medium text-slate-700">{c.contact_name}</p>
                  <p className="text-xs text-slate-500">{c.phone}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400">License Expiry</p>
                  <p className={`font-medium text-sm ${c.license_expiry && new Date(c.license_expiry)<new Date(Date.now()+30*86400000)?"text-red-500":"text-slate-700"}`}>
                    {c.license_expiry ? new Date(c.license_expiry).toLocaleDateString("en-IN") : "No expiry"}
                  </p>
                </div>
              </div>
              {c.registered_dept_ids?.length > 0 && (
                <p className="text-xs text-sky-500 mt-2 font-medium">{c.registered_dept_ids.length} registered departments</p>
              )}
            </div>
          ))
        }
        {!loading && contractors.length===0 && (
          <div className="col-span-2 text-center py-16 text-slate-400">
            <span className="material-symbols-outlined text-5xl block mb-2">handshake</span>
            No available contractors
          </div>
        )}
      </div>
    </div>
  );
}

// ── Complaints tab (admin) ────────────────────────────────────────

function ComplaintsTab() {
  const [complaints, setComplaints] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchComplaintQueue({ limit:100 }).then(d => {
      setComplaints(d.items||[]);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  return (
    <div className="flex flex-col gap-3">
      {loading ? (
        Array(5).fill(0).map((_,i) => <div key={i} className="h-20 rounded-xl bg-slate-100 animate-pulse" />)
      ) : complaints.map(c => (
        <div key={c.id} className="bg-white border rounded-xl p-4 hover:shadow-sm transition-shadow">
          <div className="flex items-center gap-3">
            <div className="w-1 self-stretch rounded-full flex-shrink-0" style={{ background:PC[c.priority]||"#6366f1" }} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className="text-xs font-mono text-slate-400">#{c.complaint_number}</span>
                <Pill label={c.priority} color={PC[c.priority]} size="xs" />
                <Pill label={c.status} color={SC[c.status]||"#6366f1"} size="xs" />
                {c.is_repeat_complaint && <span className="text-xs text-orange-500 font-bold">↩ Repeat</span>}
              </div>
              <p className="font-semibold text-slate-800 text-sm truncate">{c.title}</p>
              <p className="text-xs text-slate-500">{c.address_text} · {c.jurisdiction_name}</p>
            </div>
            <div className="text-xs text-slate-400">
              {new Date(c.created_at).toLocaleDateString("en-IN")}
            </div>
          </div>
        </div>
      ))}
      {!loading && complaints.length===0 && (
        <div className="text-center py-16 text-slate-400">
          <span className="material-symbols-outlined text-5xl block mb-2">inbox</span>
          No complaints found
        </div>
      )}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────

const TABS_ADMIN = [
  { key:"overview",     label:"Overview",     icon:"dashboard" },
  { key:"map",          label:"Map",          icon:"map" },
  { key:"complaints",   label:"Complaints",   icon:"inbox" },
  { key:"officials",    label:"Officials",    icon:"badge" },
  { key:"workers",      label:"Workers",      icon:"engineering" },
  { key:"contractors",  label:"Contractors",  icon:"handshake" },
];

export default function AdminDashboardPage() {
  const user         = JSON.parse(localStorage.getItem("auth_user") || "{}");
  const isSuperAdmin = user.role === "super_admin";
  const [tab, setTab]         = useState("overview");
  const [kpi, setKpi]         = useState(null);
  const [briefing, setBriefing]= useState(null);
  const [mapPins, setMapPins] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetchAdminKPI(),
      fetchDailyBriefing(),
      fetchAllComplaints({}).catch(() => []),
    ]).then(([k, b, pins]) => {
      setKpi(k); setBriefing(b);
      setMapPins((pins||[]).filter(p => p.lat && p.lng));
    }).finally(() => setLoading(false));
  }, []);

  return (
    <AppLayout title={isSuperAdmin ? "Commissioner Dashboard" : "Department Dashboard"}>
      <div className="p-6 flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-black text-slate-900">
              {isSuperAdmin ? "Commissioner Dashboard" : "Department Dashboard"}
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">
              {user.full_name} · {isSuperAdmin ? "City-wide" : "Department"} view
            </p>
          </div>
          <div className="flex items-center gap-3">
            {kpi?.summary?.critical_count > 0 && (
              <div className="flex items-center gap-1.5 px-4 py-2 bg-red-50 border border-red-200 text-red-600 rounded-full text-sm font-bold">
                <span className="material-symbols-outlined text-[16px]">warning</span>
                {kpi.summary.critical_count} critical
              </div>
            )}
          </div>
        </div>

        <Tabs tabs={TABS_ADMIN} active={tab} onChange={setTab} />

        {tab === "overview"    && <OverviewTab kpi={kpi} briefing={briefing} loading={loading} isSuperAdmin={isSuperAdmin} />}
        {tab === "map"         && <MapTab pins={mapPins} />}
        {tab === "complaints"  && <ComplaintsTab />}
        {tab === "officials"   && <OfficialsTab />}
        {tab === "workers"     && <WorkersTab />}
        {tab === "contractors" && <ContractorsTab />}
      </div>

      <CRMAgentChat />
    </AppLayout>
  );
}