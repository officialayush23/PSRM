// src/pages/admin/OfficialDashboardPage.jsx — full glassmorphism revamp
import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import Map, { Layer, Source, NavigationControl, Popup } from "react-map-gl";
import AppLayout from "../../components/AppLayout";
import CRMAgentChat from "../../components/CRMAgentChat";
import MapboxInfraLayer from "../../components/MapboxInfraLayer";
import {
  fetchAdminKPI, fetchDailyBriefing, fetchComplaintQueue, fetchWorkerTasks,
  fetchWorkflowSuggestions, approveWorkflow, assignTask,
  fetchAvailableWorkers, fetchAvailableContractors, fetchInfraNodeSummary,
  fetchInfraNodeAiSummary, fetchAdminTaskList, fetchInfraNodeMap,
  rolloutSurvey, fetchOfficials, fetchDepartments,
  fetchInfraNodeWorkflowSuggestions, approveInfraNodeWorkflow,
  fetchInfraNodeTasks, assignWorkflowWorkers,
} from "../../api/adminApi";
import client from "../../api/client";
import { toast } from "sonner";

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;
const PC = { normal:"#6366f1", high:"#f97316", critical:"#ef4444", emergency:"#dc2626", low:"#94a3b8" };
const SC = { received:"#818cf8", workflow_started:"#38bdf8", in_progress:"#fb923c", resolved:"#34d399", closed:"#34d399", rejected:"#f87171", escalated:"#ef4444" };
const DELHI = { longitude:77.209, latitude:28.6139, zoom:11.5, pitch:50, bearing:-15 };

// ── Shared atoms ──────────────────────────────────────────────────

function GCard({ children, className = "", style = {} }) {
  return (
    <div className={`gcard p-5 ${className}`} style={style}>{children}</div>
  );
}

function Pill({ label, color, size = "sm" }) {
  const sz = size === "xs" ? "text-[10px] px-1.5 py-0.5" : "text-xs px-2 py-0.5";
  return (
    <span className={`${sz} rounded-full font-semibold capitalize`}
      style={{ background: `${color}18`, color, border: `1px solid ${color}30` }}>
      {label?.replace(/_/g, " ")}
    </span>
  );
}

function Tabs({ tabs, active, onChange }) {
  return (
    <div className="flex gap-1 p-1 rounded-xl flex-wrap" style={{ background: "rgba(0,0,0,0.04)", border: "1px solid rgba(0,0,0,0.07)" }}>
      {tabs.map(t => (
        <button key={t.key} onClick={() => onChange(t.key)}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
            active === t.key
              ? "text-sky-600"
              : "text-slate-500 hover:text-slate-700"
          }`}
          style={active === t.key ? { background: "rgba(56,189,248,0.12)", border: "1px solid rgba(56,189,248,0.25)" } : {}}
        >
          <span className="material-symbols-outlined text-[15px]">{t.icon}</span>
          {t.label}
        </button>
      ))}
    </div>
  );
}

function Modal({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-md p-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={`rounded-2xl w-full ${wide ? "max-w-4xl" : "max-w-xl"} max-h-[88vh] overflow-y-auto`}
        style={{ background: "rgba(255,255,255,0.97)", border: "1px solid rgba(0,0,0,0.08)", backdropFilter: "blur(24px)", boxShadow: "0 20px 60px rgba(0,0,0,0.15)" }}>
        <div className="sticky top-0 px-6 pt-5 pb-4 border-b border-black/8 flex items-center justify-between z-10"
          style={{ background: "rgba(255,255,255,0.98)" }}>
          <h3 className="font-bold text-slate-800 text-lg">{title}</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-xl hover:bg-black/6 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors">
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

function KPICard({ label, value, icon, color, sub, loading }) {
  return (
    <div className="rounded-2xl p-4 flex flex-col gap-2 transition-all hover:-translate-y-0.5"
      style={{ background: `${color}0a`, border: `1px solid ${color}22`, backdropFilter: "blur(16px)" }}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: `${color}99` }}>{label}</span>
        <span className="material-symbols-outlined text-[18px]" style={{ color }}>{icon}</span>
      </div>
      <p className="text-3xl font-black text-slate-800">{loading ? "…" : (value ?? 0)}</p>
      {sub && <p className="text-[11px]" style={{ color: `${color}80` }}>{sub}</p>}
    </div>
  );
}

// ── Overview tab ──────────────────────────────────────────────────

function OverviewTab({ kpi, briefing, loading }) {
  const sections = briefing?.sections || [];
  const sectionStyle = {
    alert:   { bg:"rgba(239,68,68,0.08)",   border:"rgba(239,68,68,0.25)",   text:"#dc2626" },
    warning: { bg:"rgba(245,158,11,0.08)",  border:"rgba(245,158,11,0.25)",  text:"#d97706" },
    info:    { bg:"rgba(56,189,248,0.08)",  border:"rgba(56,189,248,0.25)",  text:"#0284c7" },
  };

  return (
    <div className="flex flex-col gap-6">
      {/* AI Briefing */}
      {briefing && (
        <div className="rounded-2xl p-5" style={{ background: "linear-gradient(135deg,rgba(56,189,248,0.08),rgba(129,140,248,0.06))", border: "1px solid rgba(56,189,248,0.15)" }}>
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: "linear-gradient(135deg,rgba(56,189,248,0.3),rgba(56,189,248,0.15))", border: "1px solid rgba(56,189,248,0.3)" }}>
              <span className="material-symbols-outlined text-sky-400 text-[20px]">smart_toy</span>
            </div>
            <div className="flex-1">
              <p className="text-[10px] font-bold text-sky-400 mb-1 uppercase tracking-wider">AI Morning Briefing</p>
              <p className="text-sm text-slate-600 leading-relaxed">{briefing.greeting}</p>
            </div>
          </div>
          {sections.length > 0 && (
            <div className="mt-4 flex flex-col gap-2">
              {sections.map((s, i) => {
                const st = sectionStyle[s.type] || sectionStyle.info;
                return (
                  <div key={i} className="flex items-center gap-3 px-4 py-3 rounded-xl border text-sm font-medium"
                    style={{ background: st.bg, borderColor: st.border, color: st.text }}>
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
        <KPICard label="Open"        value={kpi?.summary?.open_complaints}     icon="inbox"         color="#6366f1" loading={loading} />
        <KPICard label="Critical"    value={kpi?.summary?.critical_count}      icon="warning"       color="#ef4444" loading={loading} sub="Needs action" />
        <KPICard label="Needs Wflow" value={kpi?.summary?.needs_workflow}      icon="account_tree"  color="#8b5cf6" loading={loading} />
        <KPICard label="Repeat"      value={kpi?.summary?.repeat_count}        icon="replay"        color="#f97316" loading={loading} />
        <KPICard label="SLA Risk"    value={kpi?.summary?.sla_at_risk}         icon="timer_off"     color="#dc2626" loading={loading} sub=">30d open" />
        <KPICard label="Resolved"    value={kpi?.summary?.resolved_complaints} icon="check_circle"  color="#10b981" loading={loading}
          sub={kpi?.summary?.avg_resolution_days ? `Avg ${kpi.summary.avg_resolution_days}d` : ""} />
      </div>

      {/* Task stats + Infra breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <GCard>
          <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2 text-sm">
            <span className="material-symbols-outlined text-[18px] text-sky-500">construction</span>
            Task Summary
          </h3>
          <div className="grid grid-cols-3 gap-3">
            {[
              { l:"Active",  v: kpi?.tasks?.active,    c:"#f97316" },
              { l:"Overdue", v: kpi?.tasks?.overdue,   c:"#ef4444" },
              { l:"Done",    v: kpi?.tasks?.completed, c:"#10b981" },
            ].map(t => (
              <div key={t.l} className="flex flex-col items-center p-4 rounded-xl"
                style={{ background: `${t.c}0a`, border: `1px solid ${t.c}22` }}>
                <span className="text-2xl font-black" style={{ color: t.c }}>{loading ? "…" : (t.v ?? 0)}</span>
                <span className="text-xs text-slate-500 mt-1">{t.l}</span>
              </div>
            ))}
          </div>
        </GCard>

        {kpi?.top_infra_types?.length > 0 && (
          <GCard>
            <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2 text-sm">
              <span className="material-symbols-outlined text-[18px] text-indigo-500">category</span>
              Top Infra Issues
            </h3>
            <div className="flex flex-col gap-2.5">
              {kpi.top_infra_types.map(it => {
                const pct = Math.round((it.count / kpi.top_infra_types[0].count) * 100);
                return (
                  <div key={it.code} className="flex items-center gap-3">
                    <span className="text-xs text-slate-500 w-28 truncate">{it.infra_type}</span>
                    <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(0,0,0,0.07)" }}>
                      <div className="h-full rounded-full bg-sky-500" style={{ width:`${pct}%` }} />
                    </div>
                    <span className="text-xs font-bold text-slate-700 w-6 text-right">{it.count}</span>
                  </div>
                );
              })}
            </div>
          </GCard>
        )}
      </div>
    </div>
  );
}

// ── Map tab ───────────────────────────────────────────────────────

function MapTab({ onNodeClick }) {
  const [infraNodes, setInfraNodes] = useState({ type:"FeatureCollection", features:[] });
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("");
  const INFRA_TYPES = ["POTHOLE","ROAD","DRAIN","STLIGHT","WATER_PIPE","SEWER","GARBAGE","TREE","ELEC_POLE","WIRE_HAZARD"];

  useEffect(() => {
    setLoading(true);
    fetchInfraNodeMap({ status: statusFilter !== "all" ? statusFilter : undefined, infraTypeCode: typeFilter || undefined })
      .then(d => setInfraNodes(d || { type:"FeatureCollection", features:[] }))
      .catch(() => toast.error("Failed to load infra map"))
      .finally(() => setLoading(false));
  }, [statusFilter, typeFilter]);

  const nodeCount = infraNodes?.features?.length || 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="flex gap-1.5 flex-wrap">
          {[
            { k:"all", l:"All", c:"#6366f1" }, { k:"operational", l:"Operational", c:"#10b981" },
            { k:"under_repair", l:"Repair", c:"#f59e0b" }, { k:"damaged", l:"Damaged", c:"#ef4444" },
          ].map(f => (
            <button key={f.k} onClick={() => setStatusFilter(f.k)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${statusFilter===f.k ? "" : "gbtn-ghost"}`}
              style={statusFilter===f.k ? { background:`${f.c}20`, border:`1px solid ${f.c}40`, color:f.c } : {}}>
              {f.l}
            </button>
          ))}
        </div>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
          className="ml-auto px-3 py-1.5 rounded-xl text-xs font-semibold ginput">
          <option value="">All Types</option>
          {INFRA_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <span className="text-xs text-slate-500">{loading ? "Loading…" : `${nodeCount} nodes`}</span>
      </div>

      {/* Info banner */}
      <div className="rounded-xl px-4 py-2.5 flex items-center gap-2 text-xs text-sky-400"
        style={{ background:"rgba(56,189,248,0.06)", border:"1px solid rgba(56,189,248,0.15)" }}>
        <span className="material-symbols-outlined text-[16px]">info</span>
        Map shows <strong className="mx-1">infrastructure nodes</strong> — each clusters all complaints at that location. Hover for AI summary.
      </div>

      {/* Map */}
      <div className="rounded-2xl overflow-hidden" style={{ height:580, border:"1px solid rgba(0,0,0,0.08)" }}>
        {loading ? (
          <div className="w-full h-full flex items-center justify-center" style={{ background:"rgba(0,0,0,0.04)" }}>
            <span className="material-symbols-outlined text-4xl animate-spin text-sky-400">progress_activity</span>
          </div>
        ) : (
          <MapboxInfraLayer nodes={infraNodes} onNodeClick={onNodeClick} />
        )}
      </div>
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
    fetchComplaintQueue({ limit:100, ...filter })
      .then(d => { setComplaints(d.items || []); setLoading(false); })
      .catch(() => setLoading(false));
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
          className="flex-1 px-4 py-2.5 rounded-xl text-sm ginput" />
        <select value={filter.priority} onChange={e => setFilter(p => ({...p, priority:e.target.value}))}
          className="px-3 py-2.5 rounded-xl text-sm ginput">
          <option value="">All Priority</option>
          {["emergency","critical","high","normal","low"].map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={filter.status} onChange={e => setFilter(p => ({...p, status:e.target.value}))}
          className="px-3 py-2.5 rounded-xl text-sm ginput">
          <option value="">All Status</option>
          {["received","workflow_started","in_progress","resolved","rejected"].map(s =>
            <option key={s} value={s}>{s.replace(/_/g," ")}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="flex flex-col gap-2">
          {Array(6).fill(0).map((_,i) => <div key={i} className="h-20 rounded-xl animate-pulse" style={{ background:"rgba(0,0,0,0.05)" }} />)}
        </div>
      ) : shown.length === 0 ? (
        <div className="text-center py-16 text-slate-500">
          <span className="material-symbols-outlined text-5xl block mb-2">search_off</span>
          No complaints found
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {shown.map(c => (
            <div key={c.id} className="rounded-xl p-4 transition-all"
              style={{ background:"rgba(255,255,255,0.7)", border:"1px solid rgba(0,0,0,0.07)" }}
              onMouseEnter={e => e.currentTarget.style.background="rgba(255,255,255,0.9)"}
              onMouseLeave={e => e.currentTarget.style.background="rgba(255,255,255,0.7)"}>
              <div className="flex items-start gap-3">
                <div className="w-1 self-stretch rounded-full shrink-0" style={{ background: PC[c.priority]||"#6366f1" }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-[10px] font-mono text-slate-500">#{c.complaint_number}</span>
                    <Pill label={c.priority} color={PC[c.priority]} size="xs" />
                    <Pill label={c.status} color={SC[c.status]||"#6366f1"} size="xs" />
                    {c.is_repeat_complaint && <span className="text-[10px] text-orange-400 font-bold">↩ Repeat ({c.repeat_gap_days}d)</span>}
                    {c.mapping_confidence && <span className="text-[10px] text-slate-500">{Math.round(c.mapping_confidence*100)}% conf</span>}
                  </div>
                  <p className="font-semibold text-slate-800 text-sm truncate">{c.title}</p>
                  <p className="text-xs text-slate-500 truncate">{c.address_text}</p>
                  {c.agent_summary && <p className="text-xs text-slate-600 mt-1 line-clamp-1 italic">{c.agent_summary}</p>}
                </div>
                <div className="flex flex-col gap-1.5 shrink-0">
                  {!c.workflow_instance_id && (
                    <button onClick={() => onWorkflow(c)}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold gbtn-sky flex items-center gap-1">
                      <span className="material-symbols-outlined text-[13px]">account_tree</span>
                      Workflow
                    </button>
                  )}
                  {c.infra_node_id && (
                    <button onClick={() => onViewInfra(c.infra_node_id)}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold gbtn-ghost flex items-center gap-1">
                      <span className="material-symbols-outlined text-[13px]">hub</span>
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

// ── Worker assignment panel ───────────────────────────────────────

function WorkerAssignPanel({ workflowInstanceId, totalSteps, steps, onDone }) {
  const [mode, setMode] = useState("all"); // "all" | "step"
  const [workers, setWorkers] = useState([]);
  const [contractors, setContractors] = useState([]);
  const [selectedWorker, setSelectedWorker] = useState("");
  const [selectedContractor, setSelectedContractor] = useState("");
  const [stepMap, setStepMap] = useState({}); // {step_number: {worker_id|contractor_id}}
  const [assigning, setAssigning] = useState(false);

  useEffect(() => {
    Promise.all([fetchAvailableWorkers(), fetchAvailableContractors()])
      .then(([w, c]) => { setWorkers(w||[]); setContractors(c||[]); });
  }, []);

  const submit = async () => {
    setAssigning(true);
    try {
      if (mode === "all") {
        if (!selectedWorker && !selectedContractor) { toast.error("Select a worker or contractor"); setAssigning(false); return; }
        await assignWorkflowWorkers(workflowInstanceId, {
          worker_id:     selectedWorker || null,
          contractor_id: selectedContractor || null,
        });
        toast.success(`All ${totalSteps} steps assigned!`);
      } else {
        const step_assignments = Object.entries(stepMap).map(([sn, a]) => ({
          step_number:   parseInt(sn),
          worker_id:     a.worker_id || null,
          contractor_id: a.contractor_id || null,
        })).filter(s => s.worker_id || s.contractor_id);
        if (step_assignments.length === 0) { toast.error("Assign at least one step"); setAssigning(false); return; }
        await assignWorkflowWorkers(workflowInstanceId, { step_assignments });
        toast.success(`${step_assignments.length} step(s) assigned!`);
      }
      onDone();
    } catch (e) { toast.error(e.response?.data?.detail || "Assignment failed"); }
    finally { setAssigning(false); }
  };

  const updateStep = (stepNum, field, val) =>
    setStepMap(m => ({ ...m, [stepNum]: { ...(m[stepNum]||{}), [field]: val } }));

  return (
    <GCard>
      <div className="flex items-center gap-2 mb-4">
        <span className="material-symbols-outlined text-violet-500 text-[20px]">group</span>
        <h4 className="font-bold text-slate-800 text-sm">Assign Workers to Workflow</h4>
      </div>

      {/* Mode toggle */}
      <div className="flex gap-2 mb-4 p-1 rounded-xl" style={{ background:"rgba(0,0,0,0.04)", border:"1px solid rgba(0,0,0,0.07)" }}>
        {[{k:"all",l:"All Steps → One Worker"},{k:"step",l:"Per Step"}].map(m => (
          <button key={m.k} onClick={() => setMode(m.k)}
            className="flex-1 py-2 rounded-lg text-xs font-semibold transition-all"
            style={mode===m.k ? { background:"rgba(56,189,248,0.15)", color:"#38bdf8", border:"1px solid rgba(56,189,248,0.3)" } : { color:"#64748b" }}>
            {m.l}
          </button>
        ))}
      </div>

      {mode === "all" ? (
        <div className="flex flex-col gap-3">
          {/* Available workers */}
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Worker</label>
            <select value={selectedWorker} onChange={e => { setSelectedWorker(e.target.value); setSelectedContractor(""); }}
              className="w-full px-3 py-2.5 rounded-xl text-sm ginput">
              <option value="">Select worker…</option>
              {workers.map(w => (
                <option key={w.id} value={w.id}>
                  {w.full_name} — {w.department_name} · ⭐{w.performance_score} · {w.current_task_count} active tasks
                </option>
              ))}
            </select>
          </div>
          <div className="text-center text-xs text-slate-400">— or —</div>
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Contractor</label>
            <select value={selectedContractor} onChange={e => { setSelectedContractor(e.target.value); setSelectedWorker(""); }}
              className="w-full px-3 py-2.5 rounded-xl text-sm ginput">
              <option value="">Select contractor…</option>
              {contractors.map(c => <option key={c.id} value={c.id}>{c.company_name} · ⭐{c.performance_score}</option>)}
            </select>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2 max-h-60 overflow-y-auto">
          {(steps||[]).map(s => (
            <div key={s.step_number} className="rounded-xl p-3" style={{ background:"rgba(0,0,0,0.03)", border:"1px solid rgba(0,0,0,0.06)" }}>
              <div className="flex items-center gap-2 mb-2">
                <span className="w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center"
                  style={{ background:"rgba(56,189,248,0.15)", color:"#0284c7" }}>{s.step_number}</span>
                <span className="text-xs font-semibold text-slate-700">{s.step_name}</span>
                <span className="text-[10px] text-slate-400 ml-auto">{s.dept_name}</span>
              </div>
              <select value={stepMap[s.step_number]?.worker_id || ""}
                onChange={e => updateStep(s.step_number, "worker_id", e.target.value)}
                className="w-full px-2 py-1.5 rounded-lg text-xs ginput">
                <option value="">Assign worker…</option>
                {workers.map(w => <option key={w.id} value={w.id}>{w.full_name} ({w.current_task_count} tasks)</option>)}
              </select>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2 mt-4">
        <button onClick={submit} disabled={assigning}
          className="flex-1 gbtn-sky py-2.5 text-sm font-bold disabled:opacity-40">
          {assigning ? "Assigning…" : "Confirm Assignment"}
        </button>
        <button onClick={onDone} className="px-4 py-2.5 rounded-xl text-sm gbtn-ghost">Skip</button>
      </div>
    </GCard>
  );
}

// ── Workflow tab ──────────────────────────────────────────────────

function WorkflowTab({ onAssign }) {
  const [complaints, setComplaints]   = useState([]);
  const [selected, setSelected]       = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [loadingSugg, setLoadingSugg] = useState(false);
  const [expandedSugg, setExpandedSugg] = useState(null);
  const [editMode, setEditMode]       = useState(false);
  const [editedSteps, setEditedSteps] = useState([]);
  const [editReason, setEditReason]   = useState("");
  const [approving, setApproving]     = useState(false);
  const [approvedWf, setApprovedWf]   = useState(null); // { instanceId, totalSteps, steps }

  useEffect(() => {
    fetchComplaintQueue({ limit:100 }).then(d => {
      setComplaints((d.items||[]).filter(c => !c.workflow_instance_id));
    });
  }, []);

  const loadSuggestions = async (complaint) => {
    setSelected(complaint); setSuggestions([]); setExpandedSugg(null); setEditMode(false); setApprovedWf(null); setLoadingSugg(true);
    try {
      // Use infra-node-level suggestions (uses stored AI requirements)
      if (complaint.infra_node_id) {
        const d = await fetchInfraNodeWorkflowSuggestions(complaint.infra_node_id);
        setSuggestions(d.suggestions || []);
      } else {
        const d = await fetchWorkflowSuggestions(complaint.id);
        setSuggestions(Array.isArray(d) ? d : (d.suggestions || []));
      }
    } catch { toast.error("Failed to load suggestions"); }
    finally { setLoadingSugg(false); }
  };

  const startEdit = (sugg) => { setExpandedSugg(sugg); setEditedSteps(sugg.steps.map(s=>({...s}))); setEditMode(true); };

  const approve = async (sugg, isEdited) => {
    if (!selected) return;
    setApproving(true);
    try {
      let result;
      if (selected.infra_node_id) {
        // Infra-node-level: links ALL open complaints for this node
        result = await approveInfraNodeWorkflow(selected.infra_node_id, {
          templateId:  sugg.template_id,
          versionId:   sugg.version_id,
          editedSteps: isEdited ? editedSteps : null,
          editReason:  isEdited ? editReason  : null,
        });
        toast.success(`Workflow started! ${result.complaints_linked ?? ""} complaint(s) linked.`);
      } else {
        await approveWorkflow(selected.id, sugg.template_id, sugg.version_id, isEdited ? editedSteps : null, isEdited ? editReason : null);
        toast.success("Workflow started!");
      }
      setComplaints(cs => cs.filter(c => c.id !== selected.id));
      // Show worker assignment panel
      setApprovedWf({
        instanceId: result?.workflow_instance_id,
        totalSteps: result?.total_steps || sugg.steps?.length || 0,
        steps: sugg.steps || [],
      });
      setSuggestions([]);
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
    finally { setApproving(false); }
  };

  const doneAssigning = () => { setApprovedWf(null); setSelected(null); };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      {/* Left: complaints needing workflow */}
      <div className="lg:col-span-2 flex flex-col gap-3">
        <div className="flex items-center gap-2 mb-1">
          <h3 className="font-semibold text-slate-800 text-sm">Needs Workflow</h3>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full gpill-red">{complaints.length}</span>
        </div>
        <div className="flex flex-col gap-2 max-h-150 overflow-y-auto">
          {complaints.length === 0 ? (
            <div className="text-center py-8 text-slate-500 text-sm">All complaints have workflows assigned</div>
          ) : complaints.map(c => (
            <button key={c.id} onClick={() => loadSuggestions(c)}
              className="text-left p-4 rounded-xl transition-all"
              style={{
                background: selected?.id===c.id ? "rgba(56,189,248,0.1)" : "rgba(255,255,255,0.7)",
                border: selected?.id===c.id ? "1px solid rgba(56,189,248,0.3)" : "1px solid rgba(0,0,0,0.07)",
              }}>
              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                <Pill label={c.priority} color={PC[c.priority]} size="xs" />
                {c.is_repeat_complaint && <span className="text-[10px] text-orange-500 font-bold">↩ Repeat</span>}
                {c.infra_node_id && <span className="text-[10px] text-violet-400 font-bold">Node-level</span>}
              </div>
              <p className="font-semibold text-slate-800 text-sm">{c.title}</p>
              <p className="text-xs text-slate-500 mt-0.5 truncate">{c.address_text}</p>
              {c.infra_type_code && <p className="text-[10px] text-sky-500 mt-1 font-mono">{c.infra_type_code}</p>}
            </button>
          ))}
        </div>
      </div>

      {/* Right: suggestions or worker assignment */}
      <div className="lg:col-span-3 flex flex-col gap-4">
        {approvedWf ? (
          <WorkerAssignPanel
            workflowInstanceId={approvedWf.instanceId}
            totalSteps={approvedWf.totalSteps}
            steps={approvedWf.steps}
            onDone={doneAssigning}
          />
        ) : !selected ? (
          <div className="flex flex-col items-center justify-center h-64 text-slate-500">
            <span className="material-symbols-outlined text-5xl mb-2">account_tree</span>
            <p className="text-sm">Select a complaint to view workflow suggestions</p>
          </div>
        ) : loadingSugg ? (
          <div className="flex flex-col items-center justify-center h-64 text-slate-400">
            <span className="material-symbols-outlined text-4xl animate-spin mb-2">progress_activity</span>
            <p className="text-sm">AI matching workflows…</p>
          </div>
        ) : (
          <>
            <div className="rounded-xl p-4" style={{ background:"rgba(56,189,248,0.08)", border:"1px solid rgba(56,189,248,0.2)" }}>
              <p className="font-bold text-sky-600 text-sm">{selected.title}</p>
              <p className="text-xs text-sky-500/80 mt-1">{selected.agent_summary}</p>
              {selected.infra_node_id && (
                <p className="text-[10px] text-violet-400 mt-1.5">
                  ✦ Approving will link all open complaints for this infra node to one workflow
                </p>
              )}
            </div>

            {editMode && expandedSugg ? (
              <GCard>
                <div className="flex items-center justify-between mb-4">
                  <h4 className="font-bold text-slate-800 text-sm">Edit Workflow Steps</h4>
                  <button onClick={() => setEditMode(false)} className="text-xs text-slate-400 hover:text-slate-600">Cancel</button>
                </div>
                <div className="flex flex-col gap-3 mb-4">
                  {editedSteps.map((step, idx) => (
                    <div key={idx} className="rounded-xl p-4" style={{ background:"rgba(0,0,0,0.04)", border:"1px solid rgba(0,0,0,0.07)" }}>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center text-sky-600"
                          style={{ background:"rgba(56,189,248,0.15)", border:"1px solid rgba(56,189,248,0.25)" }}>{step.step_number}</span>
                        <input value={step.step_name}
                          onChange={e => { const ns=[...editedSteps]; ns[idx]={...ns[idx],step_name:e.target.value}; setEditedSteps(ns); }}
                          className="flex-1 px-2 py-1 text-sm rounded-lg ginput" />
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div><label className="text-slate-500 mb-1 block">Department</label><p className="text-slate-600 font-medium">{step.dept_name||step.department_name}</p></div>
                        <div>
                          <label className="text-slate-500 mb-1 block">Duration (hrs)</label>
                          <input type="number" value={step.expected_duration_hours||24}
                            onChange={e => { const ns=[...editedSteps]; ns[idx]={...ns[idx],expected_duration_hours:+e.target.value}; setEditedSteps(ns); }}
                            className="w-full px-2 py-1 rounded-lg text-xs ginput" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <textarea value={editReason} onChange={e => setEditReason(e.target.value)}
                  placeholder="Reason for editing this workflow…"
                  className="w-full px-3 py-2.5 rounded-xl text-sm resize-none h-20 mb-3 ginput" />
                <button onClick={() => approve(expandedSugg, true)} disabled={!editReason||approving}
                  className="w-full gbtn-sky py-2.5 text-sm font-bold disabled:opacity-40">
                  {approving ? "Saving…" : "Save & Start Workflow"}
                </button>
              </GCard>
            ) : (
              <div className="flex flex-col gap-3">
                {suggestions.length === 0 && (
                  <div className="text-center py-8 text-slate-500 text-sm">No workflow templates found for this infra type.</div>
                )}
                {suggestions.map((sugg, i) => (
                  <div key={i} className="rounded-2xl overflow-hidden transition-all"
                    style={{ background:"rgba(255,255,255,0.7)", border:"1px solid rgba(0,0,0,0.07)" }}>
                    <div className="p-5">
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center text-sky-600"
                              style={{ background:"rgba(56,189,248,0.15)" }}>{i+1}</span>
                            <span className="text-[11px] text-slate-500">{Math.round((sugg.match_score||0)*100)}% match · {sugg.avg_completion_days?.toFixed(1)}d avg · {sugg.times_used}× used</span>
                          </div>
                          <h4 className="font-bold text-slate-800 text-sm">{sugg.name}</h4>
                          <p className="text-xs text-slate-500 mt-1">{sugg.match_reason}</p>
                        </div>
                        <div className="flex flex-col gap-1.5 shrink-0">
                          <button onClick={() => approve(sugg, false)} disabled={approving}
                            className="px-3 py-1.5 rounded-lg text-xs font-bold gbtn-sky flex items-center gap-1">
                            <span className="material-symbols-outlined text-[13px]">check</span>
                            Approve
                          </button>
                          <button onClick={() => startEdit(sugg)}
                            className="px-3 py-1.5 rounded-lg text-xs font-semibold gbtn-ghost flex items-center gap-1">
                            <span className="material-symbols-outlined text-[13px]">edit</span>
                            Edit
                          </button>
                        </div>
                      </div>
                      <div className="flex flex-col gap-1 mt-3">
                        {sugg.steps?.map((s, si) => (
                          <div key={si} className="flex items-center gap-2 text-xs py-1.5 border-t border-black/5">
                            <span className="w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center text-slate-500 shrink-0"
                              style={{ background:"rgba(0,0,0,0.06)" }}>{s.step_number}</span>
                            <span className="text-slate-600 font-medium flex-1">{s.step_name}</span>
                            <span className="text-slate-500 text-[10px]">{s.dept_name||s.department_name}</span>
                            <span className="text-slate-500 text-[10px]">{s.expected_duration_hours}h</span>
                            {s.requires_tender && <span className="text-[10px] font-semibold gpill-orange px-1.5 py-0.5 rounded-full">Tender</span>}
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
// Flow: infra nodes with tasks → click node → see tasks per step → assign workers

const INFRA_EMOJI = { STLIGHT:"💡",ROAD:"🛣",POTHOLE:"⚠️",DRAIN:"🌊",FOOTPATH:"🚶",TREE:"🌳",GARBAGE:"🗑️",WIRE_HAZARD:"⚡",WATER_PIPE:"💧",SEWER:"🔧",ELEC_POLE:"🔌" };

const TASK_STATUS_C = { pending:"#8b5cf6", accepted:"#38bdf8", in_progress:"#f97316", completed:"#34d399", cancelled:"#64748b" };

function TasksTab({ onTenderRequest }) {
  const [allTasks, setAllTasks]       = useState([]);
  const [loading, setLoading]         = useState(true);
  const [selectedNodeId, setSelNode]  = useState(null);
  const [workers, setWorkers]         = useState([]);
  const [contractors, setContractors] = useState([]);
  const [assignModal, setAssignModal] = useState(null); // task object
  const [assignData, setAssignData]   = useState({ workerId:"", contractorId:"", notes:"" });
  const [assigning, setAssigning]     = useState(false);
  const [wfAssignModal, setWfModal]   = useState(null); // {instanceId, steps, totalSteps}

  const reload = () => {
    setLoading(true);
    fetchAdminTaskList({ limit:300 })
      .then(d => setAllTasks(d.items||[]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    reload();
    fetchAvailableWorkers().then(w => setWorkers(w||[]));
    fetchAvailableContractors().then(c => setContractors(c||[]));
  }, []);

  // Group tasks by infra_node_id
  const nodeGroups = useMemo(() => {
    const groups = {};
    allTasks.forEach(t => {
      const key = t.infra_node_id || "__no_node__";
      if (!groups[key]) groups[key] = {
        nodeId: t.infra_node_id || null,
        typeName: t.infra_type_name || "Unknown",
        typeCode: t.infra_type_code || "",
        address: t.address_text || "",
        tasks: [], open: 0, total: 0,
        workflowInstanceId: t.workflow_instance_id || null,
      };
      groups[key].tasks.push(t);
      groups[key].total++;
      if (!["completed","cancelled"].includes(t.status)) groups[key].open++;
    });
    return Object.values(groups).sort((a,b) => b.open - a.open);
  }, [allTasks]);

  const selectedGroup = nodeGroups.find(g => g.nodeId === selectedNodeId);

  const openAssign = (task) => {
    setAssignModal(task);
    setAssignData({ workerId:"", contractorId:"", notes:"" });
  };

  const doAssign = async () => {
    if (!assignData.workerId && !assignData.contractorId) { toast.error("Select a worker or contractor"); return; }
    setAssigning(true);
    try {
      await assignTask(assignModal.id, {
        workerId:     assignData.workerId     || undefined,
        contractorId: assignData.contractorId || undefined,
        notes:        assignData.notes        || undefined,
      });
      toast.success("Assigned!"); setAssignModal(null); reload();
    } catch (e) { toast.error(e.response?.data?.detail||"Failed"); }
    finally { setAssigning(false); }
  };

  const doAssignAll = async () => {
    if (!wfAssignModal) return;
    // Already handled by WorkerAssignPanel
    setWfModal(null);
    reload();
  };

  // Group tasks by workflow step for display
  const stepGroups = useMemo(() => {
    if (!selectedGroup) return [];
    const steps = {};
    selectedGroup.tasks.forEach(t => {
      const key = t.step_number ?? "other";
      if (!steps[key]) steps[key] = {
        stepNumber: t.step_number,
        stepName: t.step_name || "Task",
        workflowInstanceId: t.workflow_instance_id,
        templateName: t.template_name,
        tasks: [],
      };
      steps[key].tasks.push(t);
    });
    return Object.values(steps).sort((a,b) => (a.stepNumber||99)-(b.stepNumber||99));
  }, [selectedGroup]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
      {/* Left: Infra nodes */}
      <div className="lg:col-span-1">
        <div className="flex items-center justify-between mb-3">
          <p className="font-semibold text-slate-800 text-sm">Infra Nodes</p>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full gpill-sky">{nodeGroups.length}</span>
        </div>
        {loading ? (
          <div className="flex items-center gap-2 text-slate-400 text-sm">
            <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
            Loading…
          </div>
        ) : (
          <div className="flex flex-col gap-2 max-h-150 overflow-y-auto">
            {nodeGroups.map(g => (
              <button key={g.nodeId||"none"} onClick={() => setSelNode(g.nodeId)}
                className="text-left p-3 rounded-xl transition-all"
                style={{
                  background: selectedNodeId===g.nodeId ? "rgba(56,189,248,0.1)" : "rgba(255,255,255,0.7)",
                  border: selectedNodeId===g.nodeId ? "1px solid rgba(56,189,248,0.3)" : "1px solid rgba(0,0,0,0.07)",
                }}>
                <div className="flex items-center gap-2">
                  <span className="text-base">{INFRA_EMOJI[g.typeCode]||"📍"}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-slate-700 truncate">{g.typeName}</p>
                    <p className="text-[10px] text-slate-400 truncate">{g.address}</p>
                  </div>
                  <div className="flex flex-col items-end shrink-0">
                    <span className="text-[11px] font-bold text-red-400">{g.open}</span>
                    <span className="text-[9px] text-slate-400">{g.total} total</span>
                  </div>
                </div>
              </button>
            ))}
            {nodeGroups.length === 0 && <p className="text-sm text-slate-500 py-8 text-center">No tasks yet</p>}
          </div>
        )}
      </div>

      {/* Right: Tasks for selected node */}
      <div className="lg:col-span-3">
        {!selectedNodeId ? (
          <div className="flex flex-col items-center justify-center h-64 text-slate-500">
            <span className="material-symbols-outlined text-5xl mb-2">construction</span>
            <p className="text-sm">Select an infra node to see its tasks</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {/* Node header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-2xl">{INFRA_EMOJI[selectedGroup?.typeCode]||"📍"}</span>
                <div>
                  <p className="font-bold text-slate-800 text-sm">{selectedGroup?.typeName}</p>
                  <p className="text-xs text-slate-500">{selectedGroup?.address}</p>
                </div>
              </div>
              {/* Assign All to Workflow button */}
              {selectedGroup?.workflowInstanceId && (
                <button
                  onClick={() => setWfModal({ instanceId: selectedGroup.workflowInstanceId, steps: stepGroups.map(s => ({ step_number: s.stepNumber, step_name: s.stepName, dept_name: s.tasks[0]?.dept_name })), totalSteps: stepGroups.length })}
                  className="px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1"
                  style={{ background:"rgba(139,92,246,0.12)", color:"#7c3aed", border:"1px solid rgba(139,92,246,0.25)" }}>
                  <span className="material-symbols-outlined text-[14px]">group</span>
                  Assign All Steps
                </button>
              )}
            </div>

            {/* Steps with tasks */}
            {stepGroups.map(sg => (
              <div key={sg.stepNumber} className="rounded-2xl overflow-hidden"
                style={{ background:"rgba(255,255,255,0.7)", border:"1px solid rgba(0,0,0,0.07)" }}>
                {/* Step header */}
                <div className="px-4 py-3 flex items-center gap-3"
                  style={{ background:"rgba(0,0,0,0.03)", borderBottom:"1px solid rgba(0,0,0,0.06)" }}>
                  <span className="w-6 h-6 rounded-full text-[11px] font-bold flex items-center justify-center shrink-0"
                    style={{ background:"rgba(56,189,248,0.15)", color:"#0284c7" }}>{sg.stepNumber??"-"}</span>
                  <p className="font-semibold text-slate-700 text-sm flex-1">{sg.stepName}</p>
                  {sg.templateName && <span className="text-[10px] text-slate-400">{sg.templateName}</span>}
                </div>

                {/* Tasks in step */}
                {sg.tasks.map(t => (
                  <div key={t.id} className="px-4 py-3 flex items-center gap-3"
                    style={{ borderBottom:"1px solid rgba(0,0,0,0.04)" }}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-[10px] font-mono text-slate-400">#{t.task_number}</span>
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full capitalize"
                          style={{ background:`${TASK_STATUS_C[t.status]||"#6366f1"}18`, color:TASK_STATUS_C[t.status]||"#6366f1" }}>
                          {(t.status||"").replace(/_/g," ")}
                        </span>
                        {t.due_at && new Date(t.due_at)<new Date() && t.status!=="completed" && (
                          <span className="text-[10px] font-bold text-red-400">⚠ Overdue</span>
                        )}
                      </div>
                      <p className="text-xs font-medium text-slate-700">{t.title}</p>
                      {t.worker_name ? (
                        <p className="text-[10px] text-slate-400 mt-0.5">
                          👷 {t.worker_name}
                          {t.before_photos?.length > 0 && ` · ${t.before_photos.length} before`}
                          {t.after_photos?.length > 0 && ` · ${t.after_photos.length} after`}
                        </p>
                      ) : t.contractor_name ? (
                        <p className="text-[10px] text-slate-400 mt-0.5">🏢 {t.contractor_name}</p>
                      ) : (
                        <p className="text-[10px] text-amber-400 font-semibold mt-0.5">⚡ Unassigned</p>
                      )}
                    </div>

                    {/* Photos count + actions */}
                    <div className="flex items-center gap-2 shrink-0">
                      {((t.before_photos?.length||0) + (t.after_photos?.length||0)) > 0 && (
                        <span className="text-[10px] text-emerald-500 font-semibold">
                          📷 {(t.before_photos?.length||0)+(t.after_photos?.length||0)}
                        </span>
                      )}
                      {t.status !== "completed" && (
                        <button onClick={() => openAssign(t)}
                          className="px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-all"
                          style={{ background:"rgba(56,189,248,0.12)", color:"#0284c7", border:"1px solid rgba(56,189,248,0.25)" }}>
                          {t.worker_name || t.contractor_name ? "Reassign" : "Assign"}
                        </button>
                      )}
                      {t.status === "pending" && onTenderRequest && (
                        <button onClick={() => onTenderRequest(t)}
                          className="px-2.5 py-1.5 rounded-lg text-[10px] font-semibold"
                          style={{ background:"rgba(251,146,60,0.12)", color:"#f97316" }}>
                          Tender
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Assign single task modal */}
      {assignModal && (
        <Modal title={`Assign: ${assignModal.task_number}`} onClose={() => setAssignModal(null)}>
          <div className="flex flex-col gap-4">
            <p className="text-sm font-semibold text-slate-700">{assignModal.title}</p>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Worker</label>
              <select value={assignData.workerId} onChange={e => setAssignData(d=>({...d,workerId:e.target.value,contractorId:""}))}
                className="w-full px-3 py-2.5 rounded-xl text-sm ginput">
                <option value="">Select worker…</option>
                {workers.map(w => (
                  <option key={w.id} value={w.id}>
                    {w.full_name} — {w.department_name} · ⭐{w.performance_score} · {w.current_task_count} tasks
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">— or Contractor —</label>
              <select value={assignData.contractorId} onChange={e => setAssignData(d=>({...d,contractorId:e.target.value,workerId:""}))}
                className="w-full px-3 py-2.5 rounded-xl text-sm ginput">
                <option value="">Select contractor…</option>
                {contractors.map(c => <option key={c.id} value={c.id}>{c.company_name} · ⭐{c.performance_score}</option>)}
              </select>
            </div>
            <input value={assignData.notes} onChange={e => setAssignData(d=>({...d,notes:e.target.value}))}
              placeholder="Notes (optional)…" className="w-full px-3 py-2.5 rounded-xl text-sm ginput" />
            <button onClick={doAssign} disabled={assigning}
              className="w-full gbtn-sky py-2.5 font-bold text-sm disabled:opacity-40">
              {assigning ? "Assigning…" : "Confirm Assignment"}
            </button>
          </div>
        </Modal>
      )}

      {/* Assign all steps modal */}
      {wfAssignModal && (
        <Modal title="Assign All Workflow Steps" onClose={() => setWfModal(null)} wide>
          <WorkerAssignPanel
            workflowInstanceId={wfAssignModal.instanceId}
            totalSteps={wfAssignModal.totalSteps}
            steps={wfAssignModal.steps}
            onDone={() => { setWfModal(null); reload(); }}
          />
        </Modal>
      )}
    </div>
  );
}


// ── Surveys tab ───────────────────────────────────────────────────

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
      toast.success("Survey dispatched to citizen"); setComplaintId("");
    } catch (e) { toast.error(e.response?.data?.detail||"Failed"); }
    finally { setSending(false); }
  };

  return (
    <div className="flex flex-col gap-4 max-w-md">
      <select value={complaintId} onChange={e => setComplaintId(e.target.value)}
        className="px-3 py-2.5 rounded-xl text-sm ginput">
        <option value="">Select complaint…</option>
        {complaints.map(c => <option key={c.id} value={c.id}>#{c.complaint_number} — {c.title}</option>)}
      </select>
      <div className="flex gap-2">
        {["midway","closing","worker_feedback"].map(t => (
          <button key={t} onClick={() => setSurveyType(t)}
            className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all ${surveyType===t ? "" : "gbtn-ghost"}`}
            style={surveyType===t ? { background:"rgba(56,189,248,0.15)", border:"1px solid rgba(56,189,248,0.3)", color:"#38bdf8" } : {}}>
            {t.replace("_"," ")}
          </button>
        ))}
      </div>
      <button onClick={send} disabled={sending||!complaintId}
        className="gbtn-sky py-2.5 font-bold text-sm disabled:opacity-40">
        {sending ? "Sending…" : "Send Survey"}
      </button>
    </div>
  );
}

function SurveysTab() {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDailyBriefing().then(d => { setAlerts(d.survey_alerts || []); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <GCard>
        <h3 className="font-bold text-slate-800 mb-3 flex items-center gap-2 text-sm">
          <span className="material-symbols-outlined text-[18px] text-amber-500">warning</span>
          Quality Alerts — Poor Survey Responses
        </h3>
        {loading ? <div className="h-20 rounded-xl animate-pulse" style={{ background:"rgba(0,0,0,0.05)" }} /> :
         alerts.length === 0 ? <p className="text-sm text-slate-400">No alerts — all surveys look good!</p> :
         <div className="flex flex-col gap-2">
           {alerts.map((a, i) => (
             <div key={i} className="rounded-xl p-4" style={{ background:"rgba(245,158,11,0.06)", border:"1px solid rgba(245,158,11,0.2)" }}>
               <div className="flex items-center justify-between">
                 <div>
                   <p className="font-semibold text-slate-800 text-sm">{a.title}</p>
                   <p className="text-xs text-slate-400">#{a.complaint_number} · {a.survey_type}</p>
                   <div className="flex items-center gap-1 mt-1">
                     {[1,2,3,4,5].map(s => (
                       <span key={s} className={`text-xs ${s<=Math.round(a.avg_rating)?"text-amber-400":"text-slate-600"}`}>★</span>
                     ))}
                     <span className="text-xs text-slate-500 ml-1">({+a.avg_rating?.toFixed(1)}) · {a.response_count} responses</span>
                   </div>
                 </div>
                 <span className="text-2xl">⚠️</span>
               </div>
             </div>
           ))}
         </div>}
      </GCard>

      <GCard>
        <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2 text-sm">
          <span className="material-symbols-outlined text-[18px] text-sky-500">rate_review</span>
          Send Survey Manually
        </h3>
        <SurveyRolloutForm />
      </GCard>
    </div>
  );
}

// ── AI Infra Summary ──────────────────────────────────────────────

function AiInfraSummary({ nodeId }) {
  const [aiData, setAiData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);
  const prevNode = useState(null);

  if (prevNode[0] !== nodeId) {
    prevNode[0] = nodeId;
    if (loaded) { setLoaded(false); setAiData(null); setError(null); }
  }

  const load = async () => {
    setLoading(true); setError(null);
    try { const d = await fetchInfraNodeAiSummary(nodeId); setAiData(d); setLoaded(true); }
    catch { setError("AI analysis failed. Try again."); }
    finally { setLoading(false); }
  };

  const SEV = { low:"#34d399", medium:"#fb923c", high:"#ef4444", critical:"#dc2626" };

  if (!loaded && !loading) return (
    <div className="rounded-2xl p-5" style={{ background:"linear-gradient(135deg,rgba(139,92,246,0.08),rgba(56,189,248,0.06))", border:"1px solid rgba(139,92,246,0.2)" }}>
      <div className="flex items-center gap-3 mb-3">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background:"rgba(139,92,246,0.2)", border:"1px solid rgba(139,92,246,0.3)" }}>
          <span className="material-symbols-outlined text-violet-400 text-[20px]">psychology</span>
        </div>
        <div>
          <p className="font-bold text-slate-800 text-sm">AI Deep Analysis</p>
          <p className="text-xs text-slate-400">Themes, frequency, incidents, recommendations</p>
        </div>
      </div>
      <button onClick={load}
        className="w-full py-2.5 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 gbtn-sky"
        style={{ background:"linear-gradient(135deg,#7c3aed,#6d28d9)", boxShadow:"0 4px 14px rgba(124,58,237,0.35)" }}>
        <span className="material-symbols-outlined text-[16px]">auto_awesome</span>
        Generate AI Analysis
      </button>
    </div>
  );

  if (loading) return (
    <div className="rounded-2xl p-5 flex items-center gap-3" style={{ background:"rgba(139,92,246,0.08)", border:"1px solid rgba(139,92,246,0.2)" }}>
      <span className="material-symbols-outlined text-violet-400 animate-spin text-[24px]">progress_activity</span>
      <p className="text-sm text-violet-600">Gemini analysing complaint patterns…</p>
    </div>
  );

  if (error) return (
    <div className="rounded-xl p-4 flex items-center gap-3" style={{ background:"rgba(239,68,68,0.08)", border:"1px solid rgba(239,68,68,0.2)" }}>
      <span className="material-symbols-outlined text-red-400 text-[20px]">error</span>
      <p className="text-sm text-red-400">{error}</p>
      <button onClick={load} className="ml-auto text-xs font-bold text-red-500 hover:text-red-600">Retry</button>
    </div>
  );

  if (!aiData) return null;

  const sevColor = SEV[aiData.estimated_severity] || "#6366f1";
  return (
    <div className="rounded-2xl overflow-hidden" style={{ border:"1px solid rgba(139,92,246,0.25)" }}>
      <div className="px-5 py-4 flex items-center justify-between"
        style={{ background:"linear-gradient(135deg,rgba(124,58,237,0.6),rgba(56,189,248,0.4))" }}>
        <div className="flex items-center gap-2.5">
          <span className="material-symbols-outlined text-white text-[20px]">psychology</span>
          <p className="font-bold text-white text-sm">AI Infrastructure Analysis</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] px-2.5 py-1 rounded-full font-bold capitalize text-white"
            style={{ background:`${sevColor}40`, border:`1px solid ${sevColor}60` }}>
            {aiData.estimated_severity?.toUpperCase()}
          </span>
          <button onClick={() => { setLoaded(false); setAiData(null); }}
            className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/30">
            <span className="material-symbols-outlined text-white text-[14px]">refresh</span>
          </button>
        </div>
      </div>
      <div className="p-5 flex flex-col gap-4" style={{ background:"rgba(250,252,255,0.8)" }}>
        <div className="rounded-xl p-4" style={{ background:`${sevColor}08`, border:`1px solid ${sevColor}25` }}>
          <div className="flex items-center gap-2 mb-2">
            <span className="material-symbols-outlined text-[18px]" style={{ color:sevColor }}>bolt</span>
            <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color:sevColor }}>Recommended Action</p>
          </div>
          <p className="text-sm font-semibold text-slate-800">{aiData.recommended_action}</p>
        </div>

        <div>
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Major Themes</p>
          <div className="flex flex-wrap gap-2">
            {(aiData.major_themes || []).map((t, i) => (
              <span key={i} className="text-xs px-3 py-1.5 rounded-full gpill-sky font-medium">{t}</span>
            ))}
          </div>
        </div>

        <div className="rounded-xl p-4" style={{ background:"rgba(0,0,0,0.04)", border:"1px solid rgba(0,0,0,0.07)" }}>
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Frequency Analysis</p>
          <p className="text-sm text-slate-600 leading-relaxed">{aiData.frequency_analysis}</p>
        </div>

        {aiData.incident_timeline?.length > 0 && (
          <div>
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2.5">Incident Timeline</p>
            <div className="flex flex-col gap-2">
              {aiData.incident_timeline.map((item, i) => {
                const c = { high:"#ef4444", medium:"#f97316", low:"#34d399" }[item.severity] || "#6366f1";
                return (
                  <div key={i} className="flex items-start gap-3 p-3 rounded-xl" style={{ background:"rgba(0,0,0,0.03)", border:"1px solid rgba(0,0,0,0.06)" }}>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 mt-0.5 capitalize"
                      style={{ background:`${c}18`, color:c, border:`1px solid ${c}30` }}>{item.period}</span>
                    <p className="text-xs text-slate-500 flex-1">{item.description}</p>
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

// ── Infra Nodes tab ───────────────────────────────────────────────

const SEV_COLOR_MAP = { critical:"#ef4444", high:"#f87171", medium:"#fb923c", low:"#34d399" };
const SEV_BG_MAP    = { critical:"rgba(239,68,68,0.08)", high:"rgba(248,113,113,0.08)", medium:"rgba(251,146,60,0.08)", low:"rgba(52,211,153,0.08)" };

function NodePhotoGrid({ photos }) {
  const [lb, setLb] = useState(null);
  if (!photos?.length) return <p className="text-xs text-slate-500 py-3 text-center">No photos yet</p>;
  return (
    <>
      <div className="grid grid-cols-4 gap-1.5">
        {photos.slice(0,8).map((p,i) => (
          <button key={i} type="button" onClick={() => setLb(p)}
            className="rounded-lg overflow-hidden aspect-square"
            style={{ border:"1px solid rgba(0,0,0,0.08)" }}>
            <img src={p.url} alt={p.complaint_number} className="w-full h-full object-cover hover:scale-105 transition-transform" />
          </button>
        ))}
      </div>
      {photos.length > 8 && <p className="text-[10px] text-slate-500 mt-1">+{photos.length-8} more</p>}
      {lb && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur flex items-center justify-center p-4"
          onClick={() => setLb(null)}>
          <div className="max-w-lg w-full">
            <img src={lb.url} alt="" className="w-full rounded-2xl max-h-[70vh] object-contain" />
            <p className="text-white/70 text-xs mt-2 text-center">{lb.complaint_number}</p>
          </div>
        </div>
      )}
    </>
  );
}

function NodeRequirements({ requirements }) {
  if (!requirements) return <p className="text-xs text-slate-500">No summary yet</p>;
  const sevColor = SEV_COLOR_MAP[requirements.overall_severity] || "#94a3b8";
  return (
    <div className="flex flex-col gap-2">
      {requirements.brief && (
        <p className="text-xs text-slate-600 leading-relaxed p-3 rounded-xl"
          style={{ background: SEV_BG_MAP[requirements.overall_severity] || "rgba(0,0,0,0.04)", border:`1px solid ${sevColor}25` }}>
          {requirements.brief}
        </p>
      )}
      <div className="flex flex-col gap-1">
        {(requirements.requirements || []).slice(0,4).map((r,i) => {
          const rc = SEV_COLOR_MAP[r.severity] || "#94a3b8";
          return (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background:rc }} />
              <span className="flex-1 text-slate-600 truncate">{r.issue}</span>
              {r.count > 1 && <span className="text-[10px] font-semibold text-slate-400">×{r.count}</span>}
              <span className="text-[10px] font-semibold capitalize" style={{ color:rc }}>{r.severity}</span>
            </div>
          );
        })}
      </div>
      {(requirements.themes || []).length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {requirements.themes.slice(0,3).map((t,i) => (
            <span key={i} className="text-[10px] px-2 py-0.5 rounded-full"
              style={{ background:"rgba(56,189,248,0.1)", color:"#0284c7" }}>{t}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function NodeWorkflowPanel({ nodeId, activeWorkflow }) {
  const [suggestions, setSuggestions]  = useState(null);
  const [loading, setLoading]          = useState(false);
  const [approving, setApproving]      = useState(false);
  const [editMode, setEditMode]        = useState(false);
  const [editIdx, setEditIdx]          = useState(null);
  const [editedSteps, setEditedSteps]  = useState([]);
  const [editReason, setEditReason]    = useState("");

  const load = async () => {
    setLoading(true);
    try { setSuggestions(await fetchInfraNodeWorkflowSuggestions(nodeId)); }
    catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
    finally { setLoading(false); }
  };

  const approve = async (sugg, isEdited) => {
    setApproving(true);
    try {
      const r = await approveInfraNodeWorkflow(nodeId, {
        templateId: sugg.template_id, versionId: sugg.version_id,
        editedSteps: isEdited ? editedSteps : null, editReason: isEdited ? editReason : null,
      });
      toast.success(`Workflow started! ${r.complaints_linked} complaint${r.complaints_linked!==1?"s":""} linked.`);
      setSuggestions(null);
    } catch (e) { toast.error(e.response?.data?.detail||"Failed"); }
    finally { setApproving(false); }
  };

  if (activeWorkflow) {
    const pct = Math.round((activeWorkflow.current_step_number/activeWorkflow.total_steps)*100);
    return (
      <div className="rounded-xl p-3" style={{ background:"rgba(52,211,153,0.06)", border:"1px solid rgba(52,211,153,0.2)" }}>
        <div className="flex items-center gap-2 mb-1">
          <span className="material-symbols-outlined text-emerald-400 text-[16px]">account_tree</span>
          <span className="text-xs font-bold text-emerald-600">Active: {activeWorkflow.template_name}</span>
        </div>
        <div className="flex items-center gap-2 mt-2">
          <div className="flex-1 h-1 rounded-full bg-black/8 overflow-hidden">
            <div className="h-full bg-emerald-500 rounded-full" style={{ width:`${pct}%` }} />
          </div>
          <span className="text-[10px] text-emerald-500 font-semibold">{activeWorkflow.current_step_number}/{activeWorkflow.total_steps}</span>
        </div>
      </div>
    );
  }

  if (!suggestions && !loading) return (
    <button onClick={load}
      className="w-full py-2.5 rounded-xl text-xs font-bold text-white flex items-center justify-center gap-1.5"
      style={{ background:"linear-gradient(135deg,#7c3aed,#6d28d9)" }}>
      <span className="material-symbols-outlined text-[15px]">auto_awesome</span>
      AI Workflow Suggestions
    </button>
  );

  if (loading) return (
    <div className="flex items-center gap-2 py-3 text-violet-600 text-xs justify-center">
      <span className="material-symbols-outlined animate-spin text-[16px]">progress_activity</span>
      Matching workflows…
    </div>
  );

  if (editMode && editIdx !== null) return (
    <div className="rounded-xl p-3 bg-white border border-black/8">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-bold text-slate-800">Edit Steps</p>
        <button onClick={() => setEditMode(false)} className="text-[10px] text-slate-400">Cancel</button>
      </div>
      {editedSteps.map((step, idx) => (
        <div key={idx} className="flex items-center gap-1.5 mb-1.5">
          <span className="text-[10px] font-bold text-slate-500 w-4">{step.step_number}</span>
          <input value={step.step_name}
            onChange={e => { const ns=[...editedSteps]; ns[idx]={...ns[idx],step_name:e.target.value}; setEditedSteps(ns); }}
            className="flex-1 px-2 py-1 text-xs rounded-lg ginput" />
        </div>
      ))}
      <textarea value={editReason} onChange={e => setEditReason(e.target.value)}
        placeholder="Reason for editing…" rows={2}
        className="w-full px-2 py-1.5 rounded-lg text-xs resize-none ginput mt-2 mb-2" />
      <button onClick={() => approve(suggestions.suggestions[editIdx], true)}
        disabled={!editReason || approving}
        className="w-full py-2 rounded-lg text-xs font-bold text-white gbtn-sky disabled:opacity-40">
        {approving ? "Starting…" : "Save & Start"}
      </button>
    </div>
  );

  return (
    <div className="flex flex-col gap-2">
      {suggestions.open_complaint_count != null && (
        <p className="text-[11px] text-slate-500">Covers <span className="font-semibold text-slate-700">{suggestions.open_complaint_count}</span> open complaints</p>
      )}
      {(suggestions.suggestions || []).map((sugg, i) => (
        <div key={i} className="rounded-xl p-3" style={{ background:"rgba(255,255,255,0.9)", border:"1px solid rgba(0,0,0,0.08)" }}>
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-slate-800 truncate">{sugg.name}</p>
              <p className="text-[10px] text-slate-500 mt-0.5">{Math.round((sugg.match_score||0)*100)}% match · {sugg.times_used}× used</p>
            </div>
            <div className="flex gap-1 shrink-0">
              <button onClick={() => approve(sugg, false)} disabled={approving}
                className="px-2 py-1 rounded-lg text-[10px] font-bold text-white gbtn-sky">
                {approving ? "…" : "Approve"}
              </button>
              <button onClick={() => { setEditIdx(i); setEditedSteps(sugg.steps.map(s=>({...s}))); setEditMode(true); }}
                className="px-2 py-1 rounded-lg text-[10px] font-semibold gbtn-ghost">
                Edit
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function InfraNodesTab() {
  const [selected, setSelected] = useState(null);
  const [summary, setSummary]   = useState(null);
  const [loading, setLoading]   = useState(false);
  const [nodes, setNodes]       = useState([]);
  const navigate = useNavigate();

  const loadNode = async (nodeId) => {
    setSelected(nodeId); setSummary(null); setLoading(true);
    try { setSummary(await fetchInfraNodeSummary(nodeId)); }
    catch { toast.error("Failed to load node"); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    fetchComplaintQueue({ limit:100 }).then(d => {
      const seen = new Set();
      const unique = [];
      (d.items||[]).forEach(c => {
        if (c.infra_node_id && !seen.has(c.infra_node_id)) {
          seen.add(c.infra_node_id);
          unique.push({ id:c.infra_node_id, name:c.infra_type_name, code:c.infra_type_code, address:c.address_text });
        }
      });
      setNodes(unique);
    });
  }, []);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Left: node list */}
      <div>
        <p className="font-semibold text-slate-800 text-sm mb-3">Infra Nodes in Jurisdiction</p>
        <div className="flex flex-col gap-2 max-h-150 overflow-y-auto">
          {nodes.map(n => (
            <button key={n.id} onClick={() => loadNode(n.id)}
              className="text-left p-3 rounded-xl transition-all"
              style={{
                background: selected===n.id ? "rgba(56,189,248,0.1)" : "rgba(255,255,255,0.7)",
                border: selected===n.id ? "1px solid rgba(56,189,248,0.3)" : "1px solid rgba(0,0,0,0.07)",
              }}>
              <p className="font-semibold text-slate-700 text-xs">{n.code}</p>
              <p className="text-[10px] text-slate-500 mt-0.5 truncate">{n.address}</p>
            </button>
          ))}
          {nodes.length===0 && <p className="text-sm text-slate-500 text-center py-8">No infra nodes found</p>}
        </div>
      </div>

      {/* Right: node detail */}
      <div className="lg:col-span-2">
        {!selected ? (
          <div className="flex flex-col items-center justify-center h-64 text-slate-500">
            <span className="material-symbols-outlined text-5xl mb-2">hub</span>
            <p className="text-sm">Select an infra node</p>
          </div>
        ) : loading ? (
          <div className="flex flex-col items-center justify-center h-64 text-slate-400">
            <span className="material-symbols-outlined text-4xl animate-spin mb-2">progress_activity</span>
            <p className="text-sm">Loading…</p>
          </div>
        ) : summary && (
          <div className="flex flex-col gap-5">
            {/* Node header */}
            <div className="rounded-2xl p-5" style={{ background:"rgba(56,189,248,0.06)", border:"1px solid rgba(56,189,248,0.15)" }}>
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-bold text-slate-800 text-sm">{summary.node.infra_type_name}</h3>
                <div className="flex items-center gap-2">
                  <Pill label={summary.node.status} color="#34d399" />
                  <button onClick={() => navigate(`/infra-nodes/${selected}`)}
                    className="text-[10px] text-sky-500 hover:text-sky-600 font-semibold flex items-center gap-1">
                    Full page
                    <span className="material-symbols-outlined text-[12px]">open_in_new</span>
                  </button>
                </div>
              </div>
              <p className="text-xs text-sky-400/70 mb-3">{summary.node.jurisdiction_name}</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { l:"Total",    v:summary.node.total_complaint_count, c:"#6366f1" },
                  { l:"Resolved", v:summary.node.total_resolved_count,  c:"#34d399" },
                  { l:"Alert",    v:`${summary.node.repeat_alert_years}yr`, c:"#f97316" },
                  { l:"Radius",   v:`${summary.node.cluster_radius_meters}m`, c:"#8b5cf6" },
                ].map(s => (
                  <div key={s.l} className="rounded-xl p-3 text-center"
                    style={{ background:`${s.c}0a`, border:`1px solid ${s.c}22` }}>
                    <p className="text-lg font-black" style={{color:s.c}}>{s.v}</p>
                    <p className="text-[10px] text-slate-500">{s.l}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Requirements */}
            <GCard>
              <h4 className="font-bold text-slate-800 text-xs uppercase tracking-wider mb-3 flex items-center gap-2">
                <span className="material-symbols-outlined text-[15px] text-sky-500">checklist</span>
                Citizen Requirements
              </h4>
              <NodeRequirements requirements={summary.requirements} />
            </GCard>

            {/* Photos */}
            {summary.photos?.length > 0 && (
              <GCard>
                <h4 className="font-bold text-slate-800 text-xs uppercase tracking-wider mb-3 flex items-center gap-2">
                  <span className="material-symbols-outlined text-[15px] text-sky-500">photo_library</span>
                  Photos ({summary.photos.length})
                </h4>
                <NodePhotoGrid photos={summary.photos} />
              </GCard>
            )}

            {/* Workflow */}
            <GCard>
              <h4 className="font-bold text-slate-800 text-xs uppercase tracking-wider mb-3 flex items-center gap-2">
                <span className="material-symbols-outlined text-[15px] text-violet-500">account_tree</span>
                Workflow
              </h4>
              <NodeWorkflowPanel nodeId={selected} activeWorkflow={summary.active_workflow} />
            </GCard>

            {/* Deep AI analysis */}
            <AiInfraSummary nodeId={selected} />

            {/* Complaint history */}
            <GCard>
              <h4 className="font-bold text-slate-800 text-xs uppercase tracking-wider mb-3">
                Complaint History ({summary.complaints.length})
              </h4>
              <div className="flex flex-col gap-2 max-h-64 overflow-y-auto">
                {summary.complaints.map(c => (
                  <div key={c.id} className="rounded-xl p-3 flex items-center gap-3"
                    style={{ background:"rgba(255,255,255,0.7)", border:"1px solid rgba(0,0,0,0.07)" }}>
                    <div className="w-1.5 h-6 rounded-full shrink-0" style={{background:SC[c.status]||"#6366f1"}} />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-slate-800 text-xs truncate">{c.title}</p>
                      <p className="text-[10px] text-slate-500">{new Date(c.created_at).toLocaleDateString("en-IN")}</p>
                    </div>
                    <Pill label={c.status} color={SC[c.status]||"#6366f1"} size="xs" />
                    {c.is_repeat_complaint && <span className="text-[10px] text-orange-400 font-bold">↩</span>}
                  </div>
                ))}
              </div>
            </GCard>
          </div>
        )}
      </div>
    </div>
  );
}

function TendersTab({ prefillTask, onClear }) {
  const [form, setForm] = useState({
    complaint_id: prefillTask?.complaint_id || "",
    title: prefillTask ? `Tender for: ${prefillTask.title}` : "",
    description: "", scope_of_work: "", estimated_cost: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [complaints, setComplaints] = useState([]);

  useEffect(() => {
    fetchComplaintQueue({ status:"in_progress", limit:30 }).then(d => setComplaints(d.items||[]));
    if (prefillTask) {
      setForm(f => ({...f, complaint_id: prefillTask.complaint_id||"", title:`Tender for: ${prefillTask.title}`, workflow_step_instance_id:prefillTask.workflow_step_instance_id}));
    }
  }, [prefillTask]);

  const submit = async () => {
    if (!form.complaint_id || !form.title || !form.estimated_cost) { toast.error("Fill all required fields"); return; }
    setSubmitting(true);
    try {
      await client.post("/admin/tenders/request", { ...form, estimated_cost:+form.estimated_cost });
      toast.success("Tender request created!");
      if (onClear) onClear();
      setForm({ complaint_id:"", title:"", description:"", scope_of_work:"", estimated_cost:"" });
    } catch (e) { toast.error(e.response?.data?.detail||"Failed"); }
    finally { setSubmitting(false); }
  };

  const field = (label, el) => (
    <div>
      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">{label}</label>
      {el}
    </div>
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      <GCard>
        <h3 className="font-bold text-slate-800 text-sm mb-4">Request New Tender</h3>
        <div className="flex flex-col gap-4">
          {field("Related Complaint *",
            <select value={form.complaint_id} onChange={e => setForm(f => ({...f,complaint_id:e.target.value}))}
              className="w-full px-3 py-2.5 rounded-xl text-sm ginput">
              <option value="">Select complaint…</option>
              {complaints.map(c => <option key={c.id} value={c.id}>#{c.complaint_number} — {c.title}</option>)}
            </select>
          )}
          {field("Tender Title *",
            <input value={form.title} onChange={e => setForm(f => ({...f,title:e.target.value}))}
              placeholder="e.g. Pothole repair — Rohini Sector 7"
              className="w-full px-3 py-2.5 rounded-xl text-sm ginput" />
          )}
          {field("Description",
            <textarea value={form.description} onChange={e => setForm(f => ({...f,description:e.target.value}))}
              rows={3} className="w-full px-3 py-2.5 rounded-xl text-sm resize-none ginput"
              placeholder="Description of the work required…" />
          )}
          {field("Scope of Work",
            <textarea value={form.scope_of_work} onChange={e => setForm(f => ({...f,scope_of_work:e.target.value}))}
              rows={3} className="w-full px-3 py-2.5 rounded-xl text-sm resize-none ginput"
              placeholder="Materials, expected deliverables…" />
          )}
          {field("Estimated Cost (₹) *",
            <input type="number" value={form.estimated_cost} onChange={e => setForm(f => ({...f,estimated_cost:e.target.value}))}
              placeholder="e.g. 150000"
              className="w-full px-3 py-2.5 rounded-xl text-sm ginput" />
          )}
          <button onClick={submit} disabled={submitting}
            className="gbtn-sky py-3 font-bold text-sm disabled:opacity-40">
            {submitting ? "Creating…" : "Create Tender Request"}
          </button>
        </div>
      </GCard>

      <GCard>
        <h3 className="font-bold text-slate-800 text-sm mb-4">How Tender Flow Works</h3>
        <div className="flex flex-col gap-0">
          {[
            {s:1,t:"Official creates request",d:"Linked to a complaint or workflow step",i:"edit_note"},
            {s:2,t:"Admin reviews & approves",d:"Cost and scope reviewed by branch head",i:"gavel"},
            {s:3,t:"Sent to contractors",d:"Registered contractors can view and apply",i:"send"},
            {s:4,t:"Contractor awarded",d:"Admin selects contractor and awards",i:"verified"},
            {s:5,t:"Work begins",d:"Contractor assigned to relevant tasks",i:"construction"},
          ].map(s => (
            <div key={s.s} className="flex items-start gap-3 py-3.5 border-b border-black/6 last:border-0">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
                style={{ background:"rgba(56,189,248,0.1)", border:"1px solid rgba(56,189,248,0.2)" }}>
                <span className="material-symbols-outlined text-sky-500 text-[16px]">{s.i}</span>
              </div>
              <div>
                <p className="font-semibold text-slate-800 text-sm">{s.s}. {s.t}</p>
                <p className="text-xs text-slate-500">{s.d}</p>
              </div>
            </div>
          ))}
        </div>
      </GCard>
    </div>
  );
}

// ── Reroute Tab ───────────────────────────────────────────────────

function RerouteTab() {
  const [complaints, setComplaints] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [newDepts, setNewDepts] = useState([]);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(new Set());

  useEffect(() => {
    Promise.all([fetchComplaintQueue({ limit:100 }), fetchDepartments()])
      .then(([q, d]) => { setComplaints(q.items||[]); setDepartments(d||[]); })
      .catch(() => toast.error("Failed to load data"))
      .finally(() => setLoading(false));
  }, []);

  const submit = async () => {
    if (!selected || newDepts.length === 0) { toast.error("Select at least one department"); return; }
    if (!reason.trim()) { toast.error("Reason is required"); return; }
    setSubmitting(true);
    try {
      await client.post(`/admin/complaints/${selected.id}/reroute`, { new_dept_ids:newDepts, reason });
      toast.success("Complaint rerouted!"); setDone(prev => new Set([...prev, selected.id]));
      setSelected(null); setNewDepts([]); setReason("");
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
    finally { setSubmitting(false); }
  };

  const toggleDept = (id) => setNewDepts(prev => prev.includes(id) ? prev.filter(d => d !== id) : [...prev, id]);
  const visible = complaints.filter(c => !done.has(c.id));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      <div className="lg:col-span-2 flex flex-col gap-3">
        <div className="flex items-center gap-2 mb-1">
          <h3 className="font-semibold text-slate-800 text-sm">Complaints</h3>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full gpill-sky">{visible.length}</span>
        </div>
        {loading ? Array(4).fill(0).map((_,i) => <div key={i} className="h-16 rounded-xl animate-pulse" style={{ background:"rgba(0,0,0,0.05)" }} />) :
         visible.length === 0 ? (
           <div className="text-center py-12 text-slate-500">
             <span className="material-symbols-outlined text-4xl block mb-1">alt_route</span>
             <p className="text-sm">No complaints to reroute</p>
           </div>
         ) : (
           <div className="flex flex-col gap-2 max-h-150 overflow-y-auto">
             {visible.map(c => (
               <button key={c.id} onClick={() => { setSelected(c); setNewDepts([]); setReason(""); }}
                 className="text-left p-3 rounded-xl transition-all"
                 style={{
                   background: selected?.id===c.id ? "rgba(56,189,248,0.1)" : "rgba(255,255,255,0.7)",
                   border: selected?.id===c.id ? "1px solid rgba(56,189,248,0.3)" : "1px solid rgba(0,0,0,0.07)",
                 }}>
                 <div className="flex items-center gap-2 mb-1 flex-wrap">
                   <Pill label={c.priority} color={PC[c.priority]} size="xs" />
                   <Pill label={c.status} color={SC[c.status]||"#6366f1"} size="xs" />
                 </div>
                 <p className="font-semibold text-slate-800 text-xs truncate">{c.title}</p>
                 <p className="text-[10px] text-slate-500 mt-0.5 truncate">{c.address_text}</p>
               </button>
             ))}
           </div>
         )}
      </div>

      <div className="lg:col-span-3">
        {!selected ? (
          <div className="flex flex-col items-center justify-center h-64 text-slate-500">
            <span className="material-symbols-outlined text-5xl mb-2">alt_route</span>
            <p className="text-sm">Select a complaint to reroute it</p>
          </div>
        ) : (
          <GCard>
            <div className="rounded-xl p-4 mb-4" style={{ background:"rgba(56,189,248,0.06)", border:"1px solid rgba(56,189,248,0.15)" }}>
              <div className="flex items-center gap-2 mb-1">
                <Pill label={selected.priority} color={PC[selected.priority]} size="xs" />
                <span className="text-[10px] font-mono text-slate-500">#{selected.complaint_number}</span>
              </div>
              <p className="font-bold text-sky-600 text-sm">{selected.title}</p>
              <p className="text-xs text-sky-500/70 mt-1">{selected.agent_summary}</p>
            </div>

            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-3">Assign to Department(s) *</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
              {departments.map(d => (
                <button key={d.id} type="button" onClick={() => toggleDept(d.id)}
                  className="p-3 rounded-xl text-left transition-all"
                  style={{
                    background: newDepts.includes(d.id) ? "rgba(56,189,248,0.1)" : "rgba(255,255,255,0.7)",
                    border: newDepts.includes(d.id) ? "1px solid rgba(56,189,248,0.3)" : "1px solid rgba(0,0,0,0.07)",
                  }}>
                  <p className="font-bold text-slate-700 text-xs">{d.name}</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">{d.code}</p>
                </button>
              ))}
            </div>

            <textarea value={reason} onChange={e => setReason(e.target.value)}
              placeholder="Reason for rerouting…" rows={3}
              className="w-full px-3 py-2.5 rounded-xl text-sm resize-none mb-4 ginput" />

            <button onClick={submit} disabled={submitting || newDepts.length===0}
              className="w-full gbtn-sky py-2.5 font-bold text-sm disabled:opacity-40">
              {submitting ? "Rerouting…" : "Reroute Complaint"}
            </button>
          </GCard>
        )}
      </div>
    </div>
  );
}

// ── Main OfficialDashboardPage ────────────────────────────────────

const TABS = [
  { key:"overview",   label:"Overview",    icon:"dashboard" },
  { key:"map",        label:"Map",         icon:"map" },
  { key:"complaints", label:"Complaints",  icon:"inbox" },
  { key:"workflow",   label:"Workflow",    icon:"account_tree" },
  { key:"tasks",      label:"Tasks",       icon:"construction" },
  { key:"surveys",    label:"Surveys",     icon:"rate_review" },
  { key:"infra",      label:"Infra Nodes", icon:"hub" },
  { key:"tenders",    label:"Tenders",     icon:"gavel" },
  { key:"reroute",    label:"Reroute",     icon:"alt_route" },
];

export default function OfficialDashboardPage() {
  const [tab,        setTab]        = useState("overview");
  const [kpi,        setKpi]        = useState(null);
  const [briefing,   setBriefing]   = useState(null);
  const [kpiLoading, setKpiLoading] = useState(true);
  const [tenderTask, setTenderTask] = useState(null);

  useEffect(() => {
    Promise.all([fetchAdminKPI(), fetchDailyBriefing()])
      .then(([k, b]) => { setKpi(k); setBriefing(b); })
      .catch(err => console.warn("KPI/briefing load failed:", err))
      .finally(() => setKpiLoading(false));
  }, []);

  const handleWorkflow    = () => setTab("workflow");
  const handleViewInfra   = () => setTab("infra");
  const handleTenderRequest = (task) => { setTenderTask(task); setTab("tenders"); };

  return (
    <AppLayout title="Command Center">
      <div className="p-5 lg:p-7 flex flex-col gap-5">
        {/* Page header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-800">Command Center</h1>
            <p className="text-xs text-slate-500 mt-0.5">Official Dashboard · Real-time civic operations</p>
          </div>
        </div>

        {/* Tabs */}
        <Tabs tabs={TABS} active={tab} onChange={setTab} />

        {/* Main content */}
        <div className="flex-1 min-w-0">
          {tab === "overview"   && <OverviewTab kpi={kpi} briefing={briefing} loading={kpiLoading} />}
          {tab === "map"        && <MapTab onNodeClick={() => handleViewInfra()} />}
          {tab === "complaints" && <ComplaintsTab onWorkflow={handleWorkflow} onViewInfra={handleViewInfra} />}
          {tab === "workflow"   && <WorkflowTab />}
          {tab === "tasks"      && <TasksTab onTenderRequest={handleTenderRequest} />}
          {tab === "surveys"    && <SurveysTab />}
          {tab === "infra"      && <InfraNodesTab />}
          {tab === "tenders"    && <TendersTab prefillTask={tenderTask} onClear={() => setTenderTask(null)} />}
          {tab === "reroute"    && <RerouteTab />}
        </div>
      </div>

      {/* Floating AI assistant — standalone button, no inline panel */}
      <CRMAgentChat />
    </AppLayout>
  );
}