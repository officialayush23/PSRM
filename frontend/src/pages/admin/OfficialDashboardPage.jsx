// src/pages/admin/OfficialDashboardPage.jsx
// Official workspace — 8 tabs: Overview | Map | Complaints | Workflow | Tasks | Surveys | Infra Nodes | Tenders
// Uses Mapbox 3D, shadcn/ui, Tailwind. Scoped to official's jurisdiction.

import { useEffect, useRef, useState, useCallback } from "react";
import Map, { Marker, Layer, NavigationControl, Popup } from "react-map-gl";
import AppLayout from "../../components/AppLayout";
import CRMAgentChat from "../../components/CRMAgentChat";
import {
  fetchAdminKPI, fetchDailyBriefing, fetchComplaintQueue, fetchWorkerTasks,
  fetchWorkflowSuggestions, approveWorkflow, assignTask,
  fetchAvailableWorkers, fetchAvailableContractors, fetchInfraNodeSummary,
  rolloutSurvey, fetchOfficials,
} from "../../api/adminApi";
import { fetchAllComplaints } from "../../api/complaintsApi";
import client from "../../api/client";
import { toast } from "sonner";

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;
const PC = { normal:"#6366f1", high:"#f97316", critical:"#ef4444", emergency:"#dc2626", low:"#94a3b8" };
const SC = { received:"#818cf8", workflow_started:"#38bdf8", in_progress:"#fb923c", resolved:"#34d399", closed:"#34d399", rejected:"#f87171", escalated:"#ef4444" };
const DELHI = { longitude:77.209, latitude:28.6139, zoom:11.5, pitch:50, bearing:-15 };

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

// ── Shared atoms ──────────────────────────────────────────────────

function KPICard({ label, value, icon, color, sub, loading }) {
  return (
    <div className="bg-white rounded-2xl p-5 border flex flex-col gap-2 hover:shadow-md transition-shadow"
      style={{ borderColor: color+"25" }}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">{label}</span>
        <span className="material-symbols-outlined text-[20px]" style={{ color }}>{icon}</span>
      </div>
      <p className="text-3xl font-black text-slate-900">{loading ? "…" : (value ?? 0)}</p>
      {sub && <p className="text-[11px] text-slate-400">{sub}</p>}
    </div>
  );
}

function Pill({ label, color, size = "sm" }) {
  const sz = size === "xs" ? "text-[10px] px-1.5 py-0.5" : "text-xs px-2 py-0.5";
  return (
    <span className={`${sz} rounded-full font-semibold capitalize`}
      style={{ background: color+"18", color }}>
      {label?.replace(/_/g, " ")}
    </span>
  );
}

function Tabs({ tabs, active, onChange }) {
  return (
    <div className="flex gap-1 bg-slate-100 rounded-xl p-1 flex-wrap">
      {tabs.map(t => (
        <button key={t.key} onClick={() => onChange(t.key)}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
            active === t.key
              ? "bg-white text-sky-700 shadow-sm"
              : "text-slate-500 hover:text-slate-700"
          }`}>
          <span className="material-symbols-outlined text-[15px]">{t.icon}</span>
          {t.label}
        </button>
      ))}
    </div>
  );
}

function Modal({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={`bg-white rounded-2xl shadow-2xl w-full ${wide ? "max-w-4xl" : "max-w-xl"} max-h-[88vh] overflow-y-auto`}>
        <div className="sticky top-0 bg-white px-6 pt-5 pb-4 border-b flex items-center justify-between z-10">
          <h3 className="font-bold text-slate-900 text-lg">{title}</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center">
            <span className="material-symbols-outlined text-slate-400">close</span>
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

// ── Overview tab ──────────────────────────────────────────────────

function OverviewTab({ kpi, briefing, loading }) {
  const sections = briefing?.sections || [];
  const colors = { alert:"#fef2f2|#ef4444|#b91c1c", warning:"#fffbeb|#f59e0b|#92400e", info:"#eff6ff|#3b82f6|#1d4ed8" };
  return (
    <div className="flex flex-col gap-6">
      {/* AI Briefing */}
      {briefing && (
        <div className="bg-gradient-to-r from-sky-50 to-indigo-50 rounded-2xl p-5 border border-sky-100">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-sky-600 flex items-center justify-center flex-shrink-0">
              <span className="material-symbols-outlined text-white text-[20px]">smart_toy</span>
            </div>
            <div className="flex-1">
              <p className="text-xs font-bold text-sky-600 mb-1 uppercase tracking-wider">AI Morning Briefing</p>
              <p className="text-sm text-slate-700 leading-relaxed">{briefing.greeting}</p>
            </div>
          </div>
          {sections.length > 0 && (
            <div className="mt-4 flex flex-col gap-2">
              {sections.map((s, i) => {
                const [bg, bd, tx] = (colors[s.type] || colors.info).split("|");
                return (
                  <div key={i} className="flex items-center gap-3 px-4 py-3 rounded-xl border text-sm font-medium"
                    style={{ background: bg, borderColor: bd, color: tx }}>
                    <span className="flex-1">{s.title}</span>
                    <span className="text-xs opacity-60">{s.action}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* KPI grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        <KPICard label="Open"         value={kpi?.summary?.open_complaints}     icon="inbox"         color="#6366f1" loading={loading} />
        <KPICard label="Critical"     value={kpi?.summary?.critical_count}      icon="warning"       color="#ef4444" loading={loading} sub="Needs action" />
        <KPICard label="Needs Wflow"  value={kpi?.summary?.needs_workflow}      icon="account_tree"  color="#8b5cf6" loading={loading} />
        <KPICard label="Repeat"       value={kpi?.summary?.repeat_count}        icon="replay"        color="#f97316" loading={loading} />
        <KPICard label="SLA Risk"     value={kpi?.summary?.sla_at_risk}         icon="timer_off"     color="#dc2626" loading={loading} sub=">30d open" />
        <KPICard label="Resolved"     value={kpi?.summary?.resolved_complaints} icon="check_circle"  color="#10b981" loading={loading}
          sub={kpi?.summary?.avg_resolution_days ? `Avg ${kpi.summary.avg_resolution_days}d` : ""} />
      </div>

      {/* Task stats + Infra breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl border p-5">
          <h3 className="font-bold text-slate-700 mb-4 flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px] text-sky-500">construction</span>
            Task Summary
          </h3>
          <div className="grid grid-cols-3 gap-3">
            {[
              { l:"Active", v: kpi?.tasks?.active,    c:"#f97316" },
              { l:"Overdue",v: kpi?.tasks?.overdue,   c:"#ef4444" },
              { l:"Done",   v: kpi?.tasks?.completed, c:"#10b981" },
            ].map(t => (
              <div key={t.l} className="flex flex-col items-center p-4 rounded-xl border" style={{ borderColor: t.c+"25" }}>
                <span className="text-2xl font-black" style={{ color: t.c }}>{loading ? "…" : (t.v ?? 0)}</span>
                <span className="text-xs text-slate-400 mt-1">{t.l}</span>
              </div>
            ))}
          </div>
        </div>

        {kpi?.top_infra_types?.length > 0 && (
          <div className="bg-white rounded-2xl border p-5">
            <h3 className="font-bold text-slate-700 mb-4 flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px] text-sky-500">category</span>
              Top Infra Issues
            </h3>
            <div className="flex flex-col gap-2.5">
              {kpi.top_infra_types.map(it => {
                const pct = Math.round((it.count / kpi.top_infra_types[0].count) * 100);
                return (
                  <div key={it.code} className="flex items-center gap-3">
                    <span className="text-xs text-slate-500 w-28 truncate">{it.infra_type}</span>
                    <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-sky-500 rounded-full" style={{ width:`${pct}%` }} />
                    </div>
                    <span className="text-xs font-bold text-slate-700 w-6 text-right">{it.count}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Map tab ───────────────────────────────────────────────────────

function MapTab({ pins, onComplaintClick }) {
  const [popup, setPopup] = useState(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [filter, setFilter] = useState("all");

  const visible = filter === "all" ? pins
    : pins.filter(p => filter === "critical" ? ["critical","emergency"].includes(p.priority)
      : filter === "repeat" ? p.is_repeat_complaint
      : p.status === filter);

  return (
    <div className="flex flex-col gap-4">
      {/* Filter chips */}
      <div className="flex gap-2 flex-wrap">
        {[
          { k:"all",       l:"All" },
          { k:"received",  l:"Unassigned" },
          { k:"in_progress",l:"In Progress" },
          { k:"critical",  l:"🔴 Critical" },
          { k:"repeat",    l:"↩ Repeat" },
        ].map(f => (
          <button key={f.k} onClick={() => setFilter(f.k)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${
              filter===f.k ? "bg-sky-600 text-white border-sky-600" : "bg-white text-slate-600 border-slate-200 hover:border-sky-300"
            }`}>
            {f.l} {filter===f.k && `(${visible.length})`}
          </button>
        ))}
      </div>

      <div className="rounded-2xl overflow-hidden border shadow-sm" style={{ height: 580 }}>
        <Map initialViewState={DELHI} mapboxAccessToken={MAPBOX_TOKEN}
          mapStyle="mapbox://styles/mapbox/light-v11"
          style={{ width:"100%", height:"100%" }}
          onLoad={() => setMapLoaded(true)} attributionControl={false}>
          <NavigationControl position="bottom-right" showCompass visualizePitch />
          {mapLoaded && <Layer {...BUILDINGS} />}
          {visible.map(pin => (
            <Marker key={pin.id} longitude={pin.lng} latitude={pin.lat} anchor="bottom">
              <div onClick={() => setPopup(pin)}
                style={{
                  width: pin.priority==="emergency"?18:pin.priority==="critical"?15:12,
                  height: pin.priority==="emergency"?18:pin.priority==="critical"?15:12,
                  borderRadius:"50%",
                  background: PC[pin.priority]||"#6366f1",
                  border:"2px solid white",
                  cursor:"pointer",
                  boxShadow:`0 0 0 ${pin.is_repeat_complaint?3:0}px ${PC[pin.priority]||"#6366f1"}60`,
                  animation: ["emergency","critical"].includes(pin.priority)?"pulse 2s infinite":undefined,
                }}
              />
            </Marker>
          ))}
          {popup && (
            <Popup longitude={popup.lng} latitude={popup.lat} anchor="top"
              onClose={() => setPopup(null)} closeButton={false}
              className="rounded-xl shadow-xl">
              <div className="p-3 min-w-[200px]">
                <div className="flex items-center gap-2 mb-2">
                  <Pill label={popup.priority} color={PC[popup.priority]} size="xs" />
                  <Pill label={popup.status} color={SC[popup.status]||"#6366f1"} size="xs" />
                </div>
                <p className="font-semibold text-slate-800 text-sm">{popup.title}</p>
                <p className="text-xs text-slate-500 mt-1">{popup.address_text}</p>
                {popup.is_repeat_complaint && <p className="text-xs text-orange-500 mt-1 font-semibold">↩ Repeat complaint</p>}
                <button onClick={() => onComplaintClick(popup)}
                  className="mt-3 w-full bg-sky-600 text-white py-1.5 rounded-lg text-xs font-bold hover:bg-sky-700">
                  Open Complaint
                </button>
              </div>
            </Popup>
          )}
        </Map>
      </div>
      <p className="text-xs text-slate-400 text-center">{visible.length} complaints shown</p>
    </div>
  );
}

// ── Complaints tab ────────────────────────────────────────────────

function ComplaintsTab({ onWorkflow, onViewInfra }) {
  const [complaints, setComplaints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ status:"", priority:"" });
  const [search, setSearch] = useState("");

  useEffect(() => {
    setLoading(true);
    fetchComplaintQueue({ limit:100, ...filter }).then(d => {
      setComplaints(d.items || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [filter]);

  const shown = complaints.filter(c =>
    !search || c.title?.toLowerCase().includes(search.toLowerCase())
      || c.complaint_number?.includes(search)
      || c.address_text?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col md:flex-row gap-3">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by title, number, address…"
          className="flex-1 px-4 py-2.5 rounded-xl border text-sm focus:outline-none focus:ring-2 focus:ring-sky-300" />
        <select value={filter.priority} onChange={e => setFilter(p => ({...p, priority:e.target.value}))}
          className="px-3 py-2.5 rounded-xl border text-sm focus:outline-none">
          <option value="">All Priority</option>
          {["emergency","critical","high","normal","low"].map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={filter.status} onChange={e => setFilter(p => ({...p, status:e.target.value}))}
          className="px-3 py-2.5 rounded-xl border text-sm focus:outline-none">
          <option value="">All Status</option>
          {["received","workflow_started","in_progress","resolved","rejected"].map(s => <option key={s} value={s}>{s.replace(/_/g," ")}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="flex flex-col gap-2">{Array(6).fill(0).map((_,i) => <div key={i} className="h-20 rounded-xl bg-slate-100 animate-pulse" />)}</div>
      ) : shown.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <span className="material-symbols-outlined text-5xl block mb-2">search_off</span>
          No complaints found
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {shown.map(c => (
            <div key={c.id} className="bg-white rounded-xl border p-4 hover:shadow-sm transition-shadow">
              <div className="flex items-start gap-3">
                <div className="w-1 self-stretch rounded-full flex-shrink-0" style={{ background: PC[c.priority]||"#6366f1" }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-xs font-mono text-slate-400">#{c.complaint_number}</span>
                    <Pill label={c.priority} color={PC[c.priority]} size="xs" />
                    <Pill label={c.status} color={SC[c.status]||"#6366f1"} size="xs" />
                    {c.is_repeat_complaint && <span className="text-xs text-orange-500 font-bold">↩ Repeat ({c.repeat_gap_days}d)</span>}
                    {c.mapping_confidence && <span className="text-[10px] text-slate-400">{Math.round(c.mapping_confidence*100)}% conf</span>}
                  </div>
                  <p className="font-semibold text-slate-800 text-sm truncate">{c.title}</p>
                  <p className="text-xs text-slate-500 truncate">{c.address_text}</p>
                  {c.agent_summary && <p className="text-xs text-slate-400 mt-1 line-clamp-1 italic">{c.agent_summary}</p>}
                </div>
                <div className="flex flex-col gap-1.5 flex-shrink-0">
                  {!c.workflow_instance_id && (
                    <button onClick={() => onWorkflow(c)}
                      className="px-3 py-1.5 bg-sky-600 text-white rounded-lg text-xs font-bold hover:bg-sky-700 flex items-center gap-1">
                      <span className="material-symbols-outlined text-[14px]">account_tree</span>
                      Workflow
                    </button>
                  )}
                  {c.infra_node_id && (
                    <button onClick={() => onViewInfra(c.infra_node_id)}
                      className="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-xs font-semibold hover:bg-slate-200 flex items-center gap-1">
                      <span className="material-symbols-outlined text-[14px]">hub</span>
                      Node
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Workflow tab ──────────────────────────────────────────────────

function WorkflowTab({ onAssign }) {
  const [complaints, setComplaints] = useState([]);
  const [selected, setSelected] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [loadingSugg, setLoadingSugg] = useState(false);
  const [expandedSugg, setExpandedSugg] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [editedSteps, setEditedSteps] = useState([]);
  const [editReason, setEditReason] = useState("");
  const [approving, setApproving] = useState(false);

  useEffect(() => {
    fetchComplaintQueue({ status:"received", limit:50 }).then(d => {
      setComplaints((d.items||[]).filter(c => !c.workflow_instance_id));
    });
  }, []);

  const loadSuggestions = async (complaint) => {
    setSelected(complaint);
    setSuggestions([]);
    setExpandedSugg(null);
    setEditMode(false);
    setLoadingSugg(true);
    try {
      const d = await fetchWorkflowSuggestions(complaint.id);
      setSuggestions(d.suggestions || []);
    } catch { toast.error("Failed to load suggestions"); }
    finally { setLoadingSugg(false); }
  };

  const startEdit = (sugg) => {
    setExpandedSugg(sugg);
    setEditedSteps(sugg.steps.map(s => ({...s})));
    setEditMode(true);
  };

  const approve = async (sugg, isEdited) => {
    if (!selected) return;
    setApproving(true);
    try {
      await approveWorkflow(selected.id, sugg.template_id, sugg.version_id,
        isEdited ? editedSteps : null,
        isEdited ? editReason : null
      );
      toast.success("Workflow started!");
      setSelected(null);
      setSuggestions([]);
      setComplaints(cs => cs.filter(c => c.id !== selected.id));
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
    finally { setApproving(false); }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      {/* Left: Complaints needing workflow */}
      <div className="lg:col-span-2 flex flex-col gap-3">
        <div className="flex items-center gap-2 mb-1">
          <h3 className="font-bold text-slate-700">Needs Workflow</h3>
          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-600">{complaints.length}</span>
        </div>
        <div className="flex flex-col gap-2 max-h-[600px] overflow-y-auto">
          {complaints.length === 0 && (
            <div className="text-center py-8 text-slate-400 text-sm">All complaints have workflows assigned</div>
          )}
          {complaints.map(c => (
            <button key={c.id} onClick={() => loadSuggestions(c)}
              className={`text-left p-4 rounded-xl border transition-all ${
                selected?.id===c.id ? "border-sky-500 bg-sky-50 shadow-sm" : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm"
              }`}>
              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                <Pill label={c.priority} color={PC[c.priority]} size="xs" />
                {c.is_repeat_complaint && <span className="text-[10px] text-orange-500 font-bold">↩ Repeat</span>}
              </div>
              <p className="font-semibold text-slate-800 text-sm">{c.title}</p>
              <p className="text-xs text-slate-500 mt-0.5 truncate">{c.address_text}</p>
              {c.infra_type_code && <p className="text-[10px] text-sky-500 mt-1 font-mono">{c.infra_type_code}</p>}
            </button>
          ))}
        </div>
      </div>

      {/* Right: Suggestions panel */}
      <div className="lg:col-span-3 flex flex-col gap-4">
        {!selected ? (
          <div className="flex flex-col items-center justify-center h-64 text-slate-400">
            <span className="material-symbols-outlined text-5xl mb-2">account_tree</span>
            <p className="text-sm">Select a complaint to view workflow suggestions</p>
          </div>
        ) : loadingSugg ? (
          <div className="flex flex-col items-center justify-center h-64 text-slate-400">
            <span className="material-symbols-outlined text-4xl animate-spin mb-2">progress_activity</span>
            <p className="text-sm">AI generating suggestions…</p>
          </div>
        ) : (
          <>
            <div className="bg-sky-50 rounded-xl border border-sky-100 p-4">
              <p className="font-bold text-sky-800">{selected.title}</p>
              <p className="text-xs text-sky-600 mt-1">{selected.agent_summary}</p>
            </div>

            {editMode && expandedSugg ? (
              /* Edit mode */
              <div className="bg-white border rounded-2xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="font-bold text-slate-700">Edit Steps</h4>
                  <button onClick={() => setEditMode(false)} className="text-xs text-slate-500 hover:text-slate-700">Cancel</button>
                </div>
                <div className="flex flex-col gap-3 mb-4">
                  {editedSteps.map((step, idx) => (
                    <div key={idx} className="bg-slate-50 rounded-xl p-4 border">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="w-6 h-6 rounded-full bg-sky-100 text-sky-700 text-xs font-bold flex items-center justify-center">{step.step_number}</span>
                        <input value={step.step_name} onChange={e => {
                          const ns = [...editedSteps]; ns[idx]={...ns[idx],step_name:e.target.value}; setEditedSteps(ns);
                        }} className="flex-1 px-2 py-1 text-sm border rounded-lg focus:outline-none focus:ring-1 focus:ring-sky-300" />
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <label className="text-slate-400 mb-1 block">Dept</label>
                          <p className="text-slate-600 font-medium">{step.department_name}</p>
                        </div>
                        <div>
                          <label className="text-slate-400 mb-1 block">Duration (hrs)</label>
                          <input type="number" value={step.expected_duration_hours||24}
                            onChange={e => { const ns=[...editedSteps]; ns[idx]={...ns[idx],expected_duration_hours:+e.target.value}; setEditedSteps(ns); }}
                            className="w-full px-2 py-1 border rounded-lg text-xs focus:outline-none" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <textarea value={editReason} onChange={e => setEditReason(e.target.value)}
                  placeholder="Reason for editing this workflow…"
                  className="w-full px-3 py-2 border rounded-xl text-sm resize-none h-20 mb-3 focus:outline-none focus:ring-2 focus:ring-sky-200" />
                <div className="flex gap-2">
                  <button onClick={() => approve(expandedSugg, true)} disabled={!editReason||approving}
                    className="flex-1 bg-sky-600 text-white py-2.5 rounded-xl text-sm font-bold disabled:opacity-40">
                    {approving ? "Saving…" : "Save & Start Workflow"}
                  </button>
                </div>
              </div>
            ) : (
              /* Suggestions list */
              <div className="flex flex-col gap-3">
                {suggestions.map((sugg, i) => (
                  <div key={i} className="bg-white border rounded-2xl overflow-hidden hover:shadow-md transition-shadow">
                    <div className="p-5">
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="w-6 h-6 rounded-full bg-sky-100 text-sky-700 text-xs font-bold flex items-center justify-center">{i+1}</span>
                            <span className="text-[11px] text-slate-400">{Math.round((sugg.match_score||0)*100)}% match</span>
                            <span className="text-[11px] text-slate-400">·</span>
                            <span className="text-[11px] text-slate-400">{sugg.avg_completion_days?.toFixed(1)}d avg</span>
                            <span className="text-[11px] text-slate-400">·</span>
                            <span className="text-[11px] text-slate-400">used {sugg.times_used}x</span>
                          </div>
                          <h4 className="font-bold text-slate-800">{sugg.name}</h4>
                          <p className="text-xs text-slate-500 mt-1">{sugg.match_reason}</p>
                        </div>
                        <div className="flex flex-col gap-1.5 flex-shrink-0">
                          <button onClick={() => approve(sugg, false)} disabled={approving}
                            className="px-3 py-1.5 bg-sky-600 text-white rounded-lg text-xs font-bold hover:bg-sky-700 flex items-center gap-1">
                            <span className="material-symbols-outlined text-[14px]">check</span>
                            Approve
                          </button>
                          <button onClick={() => startEdit(sugg)}
                            className="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-xs font-semibold hover:bg-slate-200 flex items-center gap-1">
                            <span className="material-symbols-outlined text-[14px]">edit</span>
                            Edit
                          </button>
                        </div>
                      </div>
                      {/* Steps preview */}
                      <div className="flex flex-col gap-1 mt-3">
                        {sugg.steps?.map((s, si) => (
                          <div key={si} className="flex items-center gap-2 text-xs py-1 border-t border-slate-50">
                            <span className="w-5 h-5 rounded-full bg-slate-100 text-slate-500 font-bold flex items-center justify-center flex-shrink-0">{s.step_number}</span>
                            <span className="text-slate-700 font-medium flex-1">{s.step_name}</span>
                            <span className="text-slate-400 text-[10px]">{s.department_name}</span>
                            <span className="text-slate-400 text-[10px]">{s.expected_duration_hours}h</span>
                            {s.requires_tender && <span className="text-orange-500 text-[10px] font-semibold">Tender</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Tasks tab ─────────────────────────────────────────────────────

function TasksTab({ onTenderRequest }) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState(null);
  const [selected, setSelected] = useState(null);
  const [workers, setWorkers] = useState([]);
  const [contractors, setContractors] = useState([]);
  const [assignData, setAssignData] = useState({ workerId:"", contractorId:"", overrideCode:"", notes:"" });
  const [assigning, setAssigning] = useState(false);

  const load = (status) => {
    setLoading(true);
    fetchWorkerTasks(status).then(d => { setTasks(d.items||[]); setLoading(false); }).catch(() => setLoading(false));
  };

  useEffect(() => { load(null); }, []);

  const openTask = async (task) => {
    setSelected(task);
    const [w, c] = await Promise.all([
      fetchAvailableWorkers({ deptId: task.department_id }),
      fetchAvailableContractors({ deptId: task.department_id }),
    ]).catch(() => [[],[]]);
    setWorkers(w||[]);
    setContractors(c||[]);
    setAssignData({ workerId:"", contractorId:"", overrideCode:"", notes:"" });
  };

  const doAssign = async () => {
    if (!assignData.workerId && !assignData.contractorId) { toast.error("Select a worker or contractor"); return; }
    setAssigning(true);
    try {
      await assignTask(selected.id, {
        workerId: assignData.workerId || undefined,
        contractorId: assignData.contractorId || undefined,
        overrideReasonCode: assignData.overrideCode || undefined,
        notes: assignData.notes || undefined,
      });
      toast.success("Task assigned!");
      setSelected(null);
      load(filter);
    } catch (e) { toast.error(e.response?.data?.detail||"Failed"); }
    finally { setAssigning(false); }
  };

  const filterOpts = [
    {k:null,l:"All"}, {k:"pending",l:"Pending"}, {k:"accepted",l:"Accepted"},
    {k:"in_progress",l:"In Progress"}, {k:"completed",l:"Completed"},
  ];

  const photoCount = (t, type) => (t[`${type}_photos`]||[]).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2 flex-wrap">
        {filterOpts.map(f => (
          <button key={String(f.k)} onClick={() => { setFilter(f.k); load(f.k); }}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${
              filter===f.k ? "bg-sky-600 text-white border-sky-600" : "bg-white text-slate-600 border-slate-200 hover:border-sky-300"
            }`}>{f.l}</button>
        ))}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {Array(4).fill(0).map((_,i) => <div key={i} className="h-40 rounded-xl bg-slate-100 animate-pulse" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {tasks.map(t => (
            <div key={t.id} className="bg-white rounded-2xl border hover:shadow-md transition-shadow overflow-hidden cursor-pointer"
              onClick={() => openTask(t)}>
              <div className="h-1.5" style={{ background: PC[t.priority]||"#6366f1" }} />
              <div className="p-4">
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <span className="text-xs font-mono text-slate-400">#{t.task_number}</span>
                  <Pill label={t.priority} color={PC[t.priority]} size="xs" />
                  <Pill label={t.status} color={t.status==="completed"?"#10b981":t.status==="in_progress"?"#f97316":"#6366f1"} size="xs" />
                </div>
                <p className="font-semibold text-slate-800 text-sm mb-1">{t.title}</p>
                <p className="text-xs text-slate-500 truncate">{t.address_text}</p>
                <div className="flex items-center gap-3 mt-3 text-xs text-slate-400">
                  <span className={photoCount(t,"before")>0?"text-green-500 font-semibold":""}>
                    📷 {photoCount(t,"before")} before
                  </span>
                  <span className={photoCount(t,"after")>0?"text-green-500 font-semibold":""}>
                    ✅ {photoCount(t,"after")} after
                  </span>
                  {t.due_at && (
                    <span className={new Date(t.due_at)<new Date()?"text-red-500 font-semibold":"ml-auto"}>
                      {new Date(t.due_at)<new Date()?"⚠️ Overdue":"Due"} {new Date(t.due_at).toLocaleDateString("en-IN")}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
          {tasks.length === 0 && (
            <div className="col-span-3 text-center py-16 text-slate-400">
              <span className="material-symbols-outlined text-5xl block mb-2">task_alt</span>
              No tasks found
            </div>
          )}
        </div>
      )}

      {/* Task detail modal */}
      {selected && (
        <Modal title={`Task: ${selected.task_number}`} onClose={() => setSelected(null)} wide>
          <div className="flex flex-col gap-5">
            {/* Header */}
            <div className="flex items-center gap-3 p-4 bg-slate-50 rounded-xl">
              <div className="flex-1">
                <p className="font-bold text-slate-800">{selected.title}</p>
                <p className="text-sm text-slate-500 mt-1">{selected.description}</p>
                <div className="flex items-center gap-2 mt-2">
                  <Pill label={selected.priority} color={PC[selected.priority]} />
                  <Pill label={selected.status} color={selected.status==="completed"?"#10b981":"#6366f1"} />
                </div>
              </div>
              {selected.status==="pending" && (
                <button onClick={() => onTenderRequest(selected)}
                  className="px-3 py-2 border border-amber-400 text-amber-600 rounded-xl text-xs font-bold hover:bg-amber-50 flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px]">receipt_long</span>
                  Tender
                </button>
              )}
            </div>

            {/* Photos */}
            {(photoCount(selected,"before") > 0 || photoCount(selected,"after") > 0) && (
              <div>
                <p className="font-semibold text-slate-600 text-sm mb-3">Work Photos</p>
                <div className="grid grid-cols-2 gap-4">
                  {["before","after"].map(type => (
                    <div key={type}>
                      <p className="text-xs text-slate-400 uppercase font-semibold mb-2">{type} ({photoCount(selected,type)})</p>
                      <div className="grid grid-cols-3 gap-1.5">
                        {(selected[`${type}_photos`]||[]).slice(0,6).map((p,i) => (
                          <img key={i} src={p.url} alt="" className="aspect-square rounded-lg object-cover w-full" />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Assignment */}
            {selected.status !== "completed" && (
              <div className="border-t pt-4">
                <p className="font-semibold text-slate-700 mb-3">Assign Worker / Contractor</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-3">
                  <div>
                    <label className="text-xs text-slate-500 font-semibold mb-1.5 block">Worker</label>
                    <select value={assignData.workerId}
                      onChange={e => setAssignData(d => ({...d, workerId:e.target.value, contractorId:""}))}
                      className="w-full px-3 py-2 border rounded-xl text-sm focus:outline-none">
                      <option value="">Select worker…</option>
                      {workers.map(w => (
                        <option key={w.id} value={w.id}>{w.full_name} — {w.department_name} (⭐{w.performance_score})</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 font-semibold mb-1.5 block">Contractor</label>
                    <select value={assignData.contractorId}
                      onChange={e => setAssignData(d => ({...d, contractorId:e.target.value, workerId:""}))}
                      className="w-full px-3 py-2 border rounded-xl text-sm focus:outline-none">
                      <option value="">Select contractor…</option>
                      {contractors.map(c => (
                        <option key={c.id} value={c.id}>{c.company_name} (⭐{c.performance_score})</option>
                      ))}
                    </select>
                  </div>
                </div>
                <input value={assignData.notes} onChange={e => setAssignData(d => ({...d,notes:e.target.value}))}
                  placeholder="Notes (optional)…"
                  className="w-full px-3 py-2 border rounded-xl text-sm mb-3 focus:outline-none" />
                <button onClick={doAssign} disabled={assigning}
                  className="w-full bg-sky-600 text-white py-2.5 rounded-xl font-bold text-sm disabled:opacity-40">
                  {assigning ? "Assigning…" : "Assign"}
                </button>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Surveys tab ───────────────────────────────────────────────────

function SurveysTab() {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [rolling, setRolling] = useState(null);

  useEffect(() => {
    // Load survey alerts from briefing (they contain avg_rating < 3)
    fetchDailyBriefing().then(d => {
      setAlerts(d.survey_alerts || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const doRollout = async (complaintId, type) => {
    setRolling(complaintId + type);
    try {
      await rolloutSurvey(complaintId, type);
      toast.success(`${type} survey sent to citizen`);
    } catch (e) { toast.error(e.response?.data?.detail||"Failed"); }
    finally { setRolling(null); }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
        <h3 className="font-bold text-amber-800 mb-3 flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px]">warning</span>
          Quality Alerts — Poor Survey Responses
        </h3>
        {loading ? <div className="h-20 bg-amber-100 animate-pulse rounded-xl" /> :
         alerts.length === 0 ? <p className="text-sm text-amber-600">No poor quality alerts. All surveys look good!</p> :
         <div className="flex flex-col gap-2">
           {alerts.map((a, i) => (
             <div key={i} className="bg-white rounded-xl p-4 border border-amber-100">
               <div className="flex items-center justify-between">
                 <div>
                   <p className="font-semibold text-slate-800 text-sm">{a.title}</p>
                   <p className="text-xs text-slate-500">#{a.complaint_number} · {a.survey_type}</p>
                   <div className="flex items-center gap-1 mt-1">
                     {[1,2,3,4,5].map(s => (
                       <span key={s} className={`text-xs ${s<=Math.round(a.avg_rating)?"text-amber-400":"text-slate-200"}`}>★</span>
                     ))}
                     <span className="text-xs text-slate-500 ml-1">({+a.avg_rating?.toFixed(1)}) · {a.response_count} responses</span>
                   </div>
                 </div>
                 <span className="text-2xl">⚠️</span>
               </div>
             </div>
           ))}
         </div>
        }
      </div>

      {/* Manual survey rollout */}
      <div className="bg-white border rounded-2xl p-5">
        <h3 className="font-bold text-slate-700 mb-4 flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px] text-sky-500">rate_review</span>
          Send Survey Manually
        </h3>
        <SurveyRolloutForm />
      </div>
    </div>
  );
}

function SurveyRolloutForm() {
  const [complaints, setComplaints] = useState([]);
  const [complaintId, setComplaintId] = useState("");
  const [surveyType, setSurveyType] = useState("midway");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    fetchComplaintQueue({ status:"in_progress", limit:30 }).then(d => setComplaints(d.items||[]));
  }, []);

  const send = async () => {
    if (!complaintId) { toast.error("Select a complaint"); return; }
    setSending(true);
    try {
      await rolloutSurvey(complaintId, surveyType);
      toast.success("Survey dispatched to citizen");
      setComplaintId("");
    } catch (e) { toast.error(e.response?.data?.detail||"Failed"); }
    finally { setSending(false); }
  };

  return (
    <div className="flex flex-col gap-4 max-w-md">
      <select value={complaintId} onChange={e => setComplaintId(e.target.value)}
        className="px-3 py-2.5 border rounded-xl text-sm focus:outline-none">
        <option value="">Select complaint…</option>
        {complaints.map(c => <option key={c.id} value={c.id}>#{c.complaint_number} — {c.title}</option>)}
      </select>
      <div className="flex gap-2">
        {["midway","closing","worker_feedback"].map(t => (
          <button key={t} onClick={() => setSurveyType(t)}
            className={`flex-1 py-2 rounded-xl text-xs font-bold border transition ${
              surveyType===t ? "bg-sky-600 text-white border-sky-600" : "bg-white text-slate-600 border-slate-200"
            }`}>{t.replace("_"," ")}</button>
        ))}
      </div>
      <button onClick={send} disabled={sending||!complaintId}
        className="bg-sky-600 text-white py-2.5 rounded-xl font-bold text-sm disabled:opacity-40">
        {sending ? "Sending…" : "Send Survey"}
      </button>
    </div>
  );
}

// ── Infra Nodes tab ───────────────────────────────────────────────

function InfraNodesTab() {
  const [selected, setSelected] = useState(null);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [complaints, setComplaints] = useState([]);

  const loadNode = async (nodeId) => {
    setSelected(nodeId);
    setSummary(null);
    setLoading(true);
    try {
      const d = await fetchInfraNodeSummary(nodeId);
      setSummary(d);
    } catch { toast.error("Failed to load node"); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    fetchComplaintQueue({ limit:100 }).then(d => {
      const uniqueNodes = [];
      const seen = new Set();
      (d.items||[]).forEach(c => {
        if (c.infra_node_id && !seen.has(c.infra_node_id)) {
          seen.add(c.infra_node_id);
          uniqueNodes.push({ id:c.infra_node_id, name:c.infra_type_name, code:c.infra_type_code, address:c.address_text });
        }
      });
      setComplaints(uniqueNodes);
    });
  }, []);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-1">
        <h3 className="font-bold text-slate-700 mb-3">Infra Nodes in Jurisdiction</h3>
        <div className="flex flex-col gap-2 max-h-[600px] overflow-y-auto">
          {complaints.map(n => (
            <button key={n.id} onClick={() => loadNode(n.id)}
              className={`text-left p-3 rounded-xl border transition ${
                selected===n.id ? "border-sky-500 bg-sky-50" : "border-slate-200 bg-white hover:border-slate-300"
              }`}>
              <p className="font-semibold text-slate-700 text-sm">{n.code}</p>
              <p className="text-xs text-slate-500 mt-0.5 truncate">{n.address}</p>
            </button>
          ))}
          {complaints.length===0 && <p className="text-sm text-slate-400 text-center py-8">No infra nodes found</p>}
        </div>
      </div>

      <div className="lg:col-span-2">
        {!selected ? (
          <div className="flex flex-col items-center justify-center h-64 text-slate-400">
            <span className="material-symbols-outlined text-5xl mb-2">hub</span>
            <p className="text-sm">Select an infra node to view summary</p>
          </div>
        ) : loading ? (
          <div className="flex flex-col items-center justify-center h-64 text-slate-400">
            <span className="material-symbols-outlined text-4xl animate-spin mb-2">progress_activity</span>
            <p className="text-sm">Loading node summary…</p>
          </div>
        ) : summary && (
          <div className="flex flex-col gap-5">
            {/* Node header */}
            <div className="bg-sky-50 border border-sky-100 rounded-2xl p-5">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-bold text-sky-900">{summary.node.infra_type_name}</h3>
                <Pill label={summary.node.status} color="#10b981" />
              </div>
              <p className="text-xs text-sky-600 mb-3">{summary.node.jurisdiction_name}</p>
              <div className="grid grid-cols-4 gap-3">
                {[
                  { l:"Total Complaints", v:summary.node.total_complaint_count, c:"#6366f1" },
                  { l:"Resolved",         v:summary.node.total_resolved_count,  c:"#10b981" },
                  { l:"Repeat Alert",     v:`${summary.node.repeat_alert_years}yr`, c:"#f97316" },
                  { l:"Radius",           v:`${summary.node.cluster_radius_meters}m`, c:"#8b5cf6" },
                ].map(s => (
                  <div key={s.l} className="bg-white rounded-xl p-3 text-center border">
                    <p className="text-lg font-black" style={{color:s.c}}>{s.v}</p>
                    <p className="text-[10px] text-slate-400">{s.l}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Active workflow */}
            {summary.active_workflow && (
              <div className="bg-green-50 border border-green-100 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-1">
                  <span className="material-symbols-outlined text-green-600 text-[18px]">account_tree</span>
                  <span className="font-bold text-green-700 text-sm">Active Workflow</span>
                </div>
                <p className="font-semibold text-green-800">{summary.active_workflow.template_name}</p>
                <div className="flex items-center gap-3 mt-2">
                  <div className="flex-1 h-2 bg-green-100 rounded-full overflow-hidden">
                    <div className="h-full bg-green-500 rounded-full"
                      style={{width:`${(summary.active_workflow.current_step_number/summary.active_workflow.total_steps)*100}%`}} />
                  </div>
                  <span className="text-xs text-green-600 font-semibold">
                    Step {summary.active_workflow.current_step_number} / {summary.active_workflow.total_steps}
                  </span>
                </div>
              </div>
            )}

            {/* AI cluster summary */}
            {summary.cluster_summary && (
              <div className="bg-slate-50 rounded-xl p-4 border">
                <p className="text-xs font-bold text-slate-500 uppercase mb-1.5">AI Cluster Summary</p>
                <p className="text-sm text-slate-700">{summary.cluster_summary}</p>
              </div>
            )}

            {/* Complaint history */}
            <div>
              <h4 className="font-bold text-slate-700 mb-3">Complaint History ({summary.complaints.length})</h4>
              <div className="flex flex-col gap-2 max-h-64 overflow-y-auto">
                {summary.complaints.map(c => (
                  <div key={c.id} className="bg-white border rounded-xl p-3 flex items-center gap-3">
                    <div className="w-2 h-6 rounded-full flex-shrink-0" style={{background:SC[c.status]||"#6366f1"}} />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-slate-700 text-xs truncate">{c.title}</p>
                      <p className="text-[10px] text-slate-400">{new Date(c.created_at).toLocaleDateString("en-IN")}</p>
                    </div>
                    <Pill label={c.status} color={SC[c.status]||"#6366f1"} size="xs" />
                    {c.is_repeat_complaint && <span className="text-[10px] text-orange-500 font-bold">↩</span>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tenders tab ───────────────────────────────────────────────────

function TendersTab({ prefillTask, onClear }) {
  const [form, setForm] = useState({
    complaint_id: prefillTask?.complaint_id || "",
    title: prefillTask ? `Tender for: ${prefillTask.title}` : "",
    description: "",
    scope_of_work: "",
    estimated_cost: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [complaints, setComplaints] = useState([]);

  useEffect(() => {
    fetchComplaintQueue({ status:"in_progress", limit:30 }).then(d => setComplaints(d.items||[]));
    if (prefillTask) {
      setForm(f => ({
        ...f,
        complaint_id: prefillTask.complaint_id || "",
        title: `Tender for: ${prefillTask.title}`,
        workflow_step_instance_id: prefillTask.workflow_step_instance_id,
      }));
    }
  }, [prefillTask]);

  const submit = async () => {
    if (!form.complaint_id || !form.title || !form.estimated_cost) {
      toast.error("Fill in all required fields"); return;
    }
    setSubmitting(true);
    try {
      await client.post("/admin/tenders/request", {
        ...form,
        estimated_cost: +form.estimated_cost,
      });
      toast.success("Tender request created!");
      if (onClear) onClear();
      setForm({ complaint_id:"", title:"", description:"", scope_of_work:"", estimated_cost:"" });
    } catch (e) { toast.error(e.response?.data?.detail||"Failed"); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      <div>
        <h3 className="font-bold text-slate-700 mb-4">Request New Tender</h3>
        <div className="bg-white border rounded-2xl p-5 flex flex-col gap-4">
          <div>
            <label className="text-xs font-semibold text-slate-500 mb-1.5 block">Related Complaint *</label>
            <select value={form.complaint_id} onChange={e => setForm(f => ({...f,complaint_id:e.target.value}))}
              className="w-full px-3 py-2.5 border rounded-xl text-sm focus:outline-none">
              <option value="">Select complaint…</option>
              {complaints.map(c => <option key={c.id} value={c.id}>#{c.complaint_number} — {c.title}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500 mb-1.5 block">Tender Title *</label>
            <input value={form.title} onChange={e => setForm(f => ({...f,title:e.target.value}))}
              placeholder="e.g. Pothole repair — Rohini Sector 7"
              className="w-full px-3 py-2.5 border rounded-xl text-sm focus:outline-none" />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500 mb-1.5 block">Description</label>
            <textarea value={form.description} onChange={e => setForm(f => ({...f,description:e.target.value}))}
              rows={3} className="w-full px-3 py-2.5 border rounded-xl text-sm resize-none focus:outline-none"
              placeholder="Description of the work required…" />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500 mb-1.5 block">Scope of Work</label>
            <textarea value={form.scope_of_work} onChange={e => setForm(f => ({...f,scope_of_work:e.target.value}))}
              rows={3} className="w-full px-3 py-2.5 border rounded-xl text-sm resize-none focus:outline-none"
              placeholder="Detailed scope, materials, expected deliverables…" />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500 mb-1.5 block">Estimated Cost (₹) *</label>
            <input type="number" value={form.estimated_cost} onChange={e => setForm(f => ({...f,estimated_cost:e.target.value}))}
              placeholder="e.g. 150000"
              className="w-full px-3 py-2.5 border rounded-xl text-sm focus:outline-none" />
          </div>
          <button onClick={submit} disabled={submitting}
            className="bg-sky-600 text-white py-3 rounded-xl font-bold text-sm disabled:opacity-40">
            {submitting ? "Creating…" : "Create Tender Request"}
          </button>
        </div>
      </div>

      <div>
        <h3 className="font-bold text-slate-700 mb-4">How Tender Flow Works</h3>
        <div className="bg-slate-50 rounded-2xl border p-5">
          {[
            { step:1, title:"Official creates tender request", desc:"Linked to a specific complaint or workflow step", icon:"edit_note" },
            { step:2, title:"Admin reviews & approves", desc:"Cost and scope reviewed by branch head", icon:"gavel" },
            { step:3, title:"Tender sent to contractors", desc:"Registered contractors can view and apply", icon:"send" },
            { step:4, title:"Contractor awarded", desc:"Admin selects contractor and awards tender", icon:"verified" },
            { step:5, title:"Work begins", desc:"Contractor assigned to relevant tasks", icon:"construction" },
          ].map(s => (
            <div key={s.step} className="flex items-start gap-3 py-3 border-b border-slate-100 last:border-0">
              <div className="w-8 h-8 rounded-full bg-sky-100 flex items-center justify-center flex-shrink-0">
                <span className="material-symbols-outlined text-sky-600 text-[16px]">{s.icon}</span>
              </div>
              <div>
                <p className="font-semibold text-slate-700 text-sm">{s.step}. {s.title}</p>
                <p className="text-xs text-slate-400">{s.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────

const TABS = [
  { key:"overview",    label:"Overview",    icon:"dashboard" },
  { key:"map",         label:"Map",         icon:"map" },
  { key:"complaints",  label:"Complaints",  icon:"inbox" },
  { key:"workflow",    label:"Workflow",    icon:"account_tree" },
  { key:"tasks",       label:"Tasks",       icon:"construction" },
  { key:"surveys",     label:"Surveys",     icon:"rate_review" },
  { key:"infra",       label:"Infra Nodes", icon:"hub" },
  { key:"tenders",     label:"Tenders",     icon:"receipt_long" },
];

export default function OfficialDashboardPage() {
  const user     = JSON.parse(localStorage.getItem("auth_user") || "{}");
  const [tab, setTab]         = useState("overview");
  const [kpi, setKpi]         = useState(null);
  const [briefing, setBriefing]= useState(null);
  const [mapPins, setMapPins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tenderTask, setTenderTask] = useState(null);

  useEffect(() => {
    Promise.all([
      fetchAdminKPI(),
      fetchDailyBriefing(),
      fetchAllComplaints({}).catch(() => []),
    ]).then(([k, b, pins]) => {
      setKpi(k); setBriefing(b);
      setMapPins((pins||[]).filter(p => p.lat && p.lng));
    }).catch(() => toast.error("Failed to load dashboard"))
    .finally(() => setLoading(false));
  }, []);

  const handleTenderRequest = (task) => { setTenderTask(task); setTab("tenders"); };
  const handleComplaintClick = (pin) => { setTab("complaints"); };
  const handleViewInfra = (nodeId) => { setTab("infra"); };

  return (
    <AppLayout title="Official Dashboard">
      <div className="p-6 flex flex-col gap-6 min-h-0">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-black text-slate-900">
              Namaskar, {user.full_name?.split(" ")[0]} 🙏
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">Official · {user.jurisdiction_name || "Jurisdiction Dashboard"}</p>
          </div>
          <div className="flex items-center gap-3">
            {kpi?.summary?.needs_workflow > 0 && (
              <button onClick={() => setTab("workflow")}
                className="flex items-center gap-1.5 px-4 py-2 bg-red-500 text-white rounded-full text-sm font-bold animate-pulse">
                <span className="material-symbols-outlined text-[16px]">warning</span>
                {kpi.summary.needs_workflow} need workflow
              </button>
            )}
          </div>
        </div>

        <Tabs tabs={TABS} active={tab} onChange={setTab} />

        {tab === "overview"   && <OverviewTab kpi={kpi} briefing={briefing} loading={loading} />}
        {tab === "map"        && <MapTab pins={mapPins} onComplaintClick={handleComplaintClick} />}
        {tab === "complaints" && <ComplaintsTab onWorkflow={() => setTab("workflow")} onViewInfra={handleViewInfra} />}
        {tab === "workflow"   && <WorkflowTab onAssign={() => setTab("tasks")} />}
        {tab === "tasks"      && <TasksTab onTenderRequest={handleTenderRequest} />}
        {tab === "surveys"    && <SurveysTab />}
        {tab === "infra"      && <InfraNodesTab />}
        {tab === "tenders"    && <TendersTab prefillTask={tenderTask} onClear={() => setTenderTask(null)} />}
      </div>

      <CRMAgentChat />
    </AppLayout>
  );
}