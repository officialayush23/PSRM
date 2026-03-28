// src/pages/admin/SuperAdminDashboardPage.jsx
// Super Admin — City-wide Command Center with full staff profiles + infra node detail
import { useEffect, useState, useMemo, useCallback } from "react";
import AppLayout from "../../components/AppLayout";
import CRMAgentChat from "../../components/CRMAgentChat";
import MapboxInfraLayer from "../../components/MapboxInfraLayer";
import {
  fetchAdminKPI, fetchStaffUsers, fetchDepartments, fetchJurisdictions,
  fetchInfraNodes, fetchInfraNodeSummary, fetchInfraNodeAiSummary,
  fetchCriticalAlerts, fetchTenders, approveTender, rejectTender,
  fetchInfraNodeMap, fetchInfraNodeWorkflowSuggestions,
  updateStaffUser, deactivateStaffUser,
  fetchAdminTaskList, fetchAvailableWorkers,
  createStaffUser,
} from "../../api/adminApi";
import { toast } from "sonner";

// ── Shadcn-style design tokens ────────────────────────────────────
const S = {
  card:     "rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm",
  cardSolid:"rounded-2xl border border-slate-800 bg-slate-900",
  badge:    (color) => `inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold`,
  btn:      "inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all active:scale-95",
  btnPrimary:"bg-indigo-500 hover:bg-indigo-400 text-white",
  btnGhost: "bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10",
  btnDanger:"bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/20",
  input:    "w-full px-3 py-2.5 rounded-xl text-sm bg-white/5 border border-white/10 text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500/50 transition-colors",
  label:    "block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5",
  th:       "px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500",
};

const ROLE_META = {
  official:    { color:"#818cf8", bg:"rgba(129,140,248,0.15)", icon:"badge" },
  admin:       { color:"#38bdf8", bg:"rgba(56,189,248,0.15)",  icon:"manage_accounts" },
  super_admin: { color:"#fb923c", bg:"rgba(251,146,60,0.15)",  icon:"shield_person" },
  worker:      { color:"#34d399", bg:"rgba(52,211,153,0.15)",  icon:"engineering" },
  contractor:  { color:"#fbbf24", bg:"rgba(251,191,36,0.15)",  icon:"handshake" },
};

function RoleBadge({ role }) {
  const m = ROLE_META[role] || { color:"#64748b", bg:"rgba(0,0,0,0.1)", icon:"person" };
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold"
      style={{ background: m.bg, color: m.color }}>
      <span className="material-symbols-outlined text-[11px]">{m.icon}</span>
      {role?.replace("_"," ")}
    </span>
  );
}

function Avatar({ name, color, size = 10 }) {
  const initials = name ? name.split(" ").map(n=>n[0]).join("").toUpperCase().slice(0,2) : "?";
  return (
    <div className={`w-${size} h-${size} rounded-full flex items-center justify-center text-white font-black flex-shrink-0`}
      style={{ background: color || "#6366f1", fontSize: size > 10 ? "1rem" : "0.7rem" }}>
      {initials}
    </div>
  );
}

function KpiCard({ label, value, sub, color, icon }) {
  return (
    <div className="rounded-2xl p-5 relative overflow-hidden"
      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
      <div className="absolute top-4 right-4 opacity-10">
        <span className="material-symbols-outlined text-5xl" style={{ color }}>{icon}</span>
      </div>
      <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">{label}</p>
      <p className="text-3xl font-black mt-1" style={{ color }}>{value ?? "—"}</p>
      {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
    </div>
  );
}

const TABS = [
  { key:"overview",   label:"Overview",    icon:"dashboard" },
  { key:"operations", label:"Operations",  icon:"task_alt" },
  { key:"users",      label:"Users",       icon:"manage_accounts" },
  { key:"staff",      label:"Staff",       icon:"group" },
  { key:"map",        label:"Map & Nodes", icon:"map" },
  { key:"tenders",    label:"Tenders",     icon:"gavel" },
  { key:"alerts",     label:"Alerts",      icon:"notification_important" },
];

const TASK_STATUS_STYLE = {
  pending:     { color:"#facc15", bg:"rgba(250,204,21,0.15)" },
  accepted:    { color:"#38bdf8", bg:"rgba(56,189,248,0.15)" },
  in_progress: { color:"#818cf8", bg:"rgba(129,140,248,0.15)" },
  completed:   { color:"#34d399", bg:"rgba(52,211,153,0.15)" },
  cancelled:   { color:"#94a3b8", bg:"rgba(148,163,184,0.15)" },
};
const PRIORITY_STYLE = {
  emergency: { color:"#ef4444", bg:"rgba(239,68,68,0.15)" },
  critical:  { color:"#f97316", bg:"rgba(249,115,22,0.15)" },
  high:      { color:"#fb923c", bg:"rgba(251,146,60,0.12)" },
  normal:    { color:"#94a3b8", bg:"rgba(148,163,184,0.12)" },
  low:       { color:"#64748b", bg:"rgba(100,116,139,0.1)" },
};
function TaskStatusBadge({ status }) {
  const s = TASK_STATUS_STYLE[status] || { color:"#64748b", bg:"rgba(0,0,0,0.1)" };
  return <span className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{ background:s.bg, color:s.color }}>{status?.replace("_"," ")}</span>;
}
function PriorityBadge({ priority }) {
  const s = PRIORITY_STYLE[priority] || { color:"#64748b", bg:"rgba(0,0,0,0.1)" };
  return <span className="text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wide" style={{ background:s.bg, color:s.color }}>{priority}</span>;
}

// ── Staff profile drawer ──────────────────────────────────────────
function StaffProfileDrawer({ user, departments, jurisdictions, onClose, onSave, onDeactivate }) {
  const [form, setForm] = useState({
    full_name: user.full_name || "",
    role: user.role || "official",
    department_id: user.department_id ? String(user.department_id) : "",
    jurisdiction_id: user.jurisdiction_id ? String(user.jurisdiction_id) : "",
    phone: user.phone || "",
    is_active: user.is_active !== false,
  });
  const [saving, setSaving] = useState(false);
  const m = ROLE_META[user.role] || ROLE_META.official;

  const save = async () => {
    setSaving(true);
    try {
      await updateStaffUser(user.id, form);
      toast.success("User updated");
      onSave();
      onClose();
    } catch { toast.error("Update failed"); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end"
      style={{ background:"rgba(0,0,8,0.7)", backdropFilter:"blur(8px)" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <aside className="w-full max-w-lg flex flex-col overflow-y-auto"
        style={{ background:"#0f172a", borderLeft:"1px solid rgba(255,255,255,0.07)" }}>

        {/* Profile header */}
        <div className="p-8 pb-6" style={{ background:"linear-gradient(135deg, rgba(99,102,241,0.15) 0%, rgba(0,0,0,0) 60%)" }}>
          <div className="flex items-start justify-between mb-6">
            <div className="flex items-center gap-4">
              <Avatar name={user.full_name} color={m.color} size={16} />
              <div>
                <h2 className="text-xl font-black text-white">{user.full_name}</h2>
                <p className="text-slate-400 text-sm">{user.email}</p>
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  <RoleBadge role={user.role} />
                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${user.is_active ? "text-emerald-400 bg-emerald-400/10" : "text-red-400 bg-red-400/10"}`}>
                    {user.is_active ? "Active" : "Inactive"}
                  </span>
                  {!user.has_firebase_auth && (
                    <span className="text-xs px-2 py-0.5 rounded-full font-semibold text-amber-400 bg-amber-400/10">No Firebase</span>
                  )}
                </div>
              </div>
            </div>
            <button onClick={onClose} className="p-2 rounded-xl hover:bg-white/5 text-slate-400">
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label:"Department", value: user.dept_name || "—" },
              { label:"Jurisdiction", value: user.jurisdiction_name || "All" },
              { label:"Tasks", value: user.current_task_count ?? "—" },
            ].map(s => (
              <div key={s.label} className="rounded-xl p-3" style={{ background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.06)" }}>
                <p className="text-[10px] text-slate-500 uppercase tracking-wider">{s.label}</p>
                <p className="text-sm font-bold text-slate-200 mt-0.5 truncate">{s.value}</p>
              </div>
            ))}
          </div>
          {user.worker_score && (
            <div className="mt-3 rounded-xl p-3 flex items-center gap-2" style={{ background:"rgba(251,191,36,0.08)", border:"1px solid rgba(251,191,36,0.15)" }}>
              <span className="material-symbols-outlined text-amber-400 text-[18px]">star</span>
              <p className="text-sm text-amber-300 font-semibold">Performance: {Number(user.worker_score).toFixed(2)}</p>
            </div>
          )}
        </div>

        {/* Edit form */}
        <div className="flex-1 p-8 pt-4 flex flex-col gap-5">
          <h3 className="text-sm font-bold text-slate-300 flex items-center gap-2">
            <span className="material-symbols-outlined text-[16px]">edit</span>
            Edit Profile
          </h3>

          <div>
            <label className={S.label}>Full Name</label>
            <input value={form.full_name} onChange={e => setForm(f=>({...f,full_name:e.target.value}))} className={S.input} />
          </div>

          <div>
            <label className={S.label}>Role</label>
            <select value={form.role} onChange={e => setForm(f=>({...f,role:e.target.value}))} className={S.input}>
              {["official","admin","super_admin","worker","contractor"].map(r => (
                <option key={r} value={r}>{r.replace("_"," ")}</option>
              ))}
            </select>
          </div>

          <div>
            <label className={S.label}>Department</label>
            <select value={form.department_id} onChange={e => setForm(f=>({...f,department_id:e.target.value}))} className={S.input}>
              <option value="">— None —</option>
              {departments.map(d => <option key={d.id} value={d.id}>{d.name} ({d.code})</option>)}
            </select>
          </div>

          {jurisdictions.length > 0 && (
            <div>
              <label className={S.label}>Jurisdiction</label>
              <select value={form.jurisdiction_id} onChange={e => setForm(f=>({...f,jurisdiction_id:e.target.value}))} className={S.input}>
                <option value="">All jurisdictions</option>
                {jurisdictions.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
              </select>
            </div>
          )}

          <div>
            <label className={S.label}>Phone</label>
            <input value={form.phone} onChange={e => setForm(f=>({...f,phone:e.target.value}))} className={S.input} placeholder="+91 98765 43210" />
          </div>

          <label className="flex items-center gap-3 cursor-pointer">
            <div className={`w-10 h-5 rounded-full transition-colors relative ${form.is_active ? "bg-emerald-500" : "bg-slate-700"}`}
              onClick={() => setForm(f=>({...f,is_active:!f.is_active}))}>
              <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${form.is_active ? "left-5" : "left-0.5"}`} />
            </div>
            <span className="text-sm text-slate-300">Account Active</span>
          </label>
        </div>

        {/* Footer */}
        <div className="p-6 flex gap-3" style={{ borderTop:"1px solid rgba(255,255,255,0.06)" }}>
          <button onClick={save} disabled={saving}
            className={`flex-1 py-3 rounded-xl font-bold text-sm text-white transition-all disabled:opacity-40 ${S.btnPrimary}`}>
            {saving ? "Saving…" : "Save Changes"}
          </button>
          {user.is_active && (
            <button onClick={() => { onDeactivate(user); onClose(); }}
              className={`${S.btn} ${S.btnDanger}`}>
              <span className="material-symbols-outlined text-[16px]">person_off</span>
            </button>
          )}
        </div>
      </aside>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────
export default function SuperAdminDashboardPage() {
  const [activeTab, setActiveTab] = useState("overview");
  const [kpi, setKpi] = useState(null);
  const [staff, setStaff] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [jurisdictions, setJurisdictions] = useState([]);
  const [workers, setWorkers] = useState([]);
  const [mapNodes, setMapNodes] = useState({ type:"FeatureCollection", features:[] });
  const [tenders, setTenders] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [staffFilter, setStaffFilter] = useState("");
  const [staffSearch, setStaffSearch] = useState("");
  const [editingUser, setEditingUser] = useState(null);
  const [deactivating, setDeactivating] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [nodeDetail, setNodeDetail] = useState(null);
  const [nodeLoading, setNodeLoading] = useState(false);
  // ── Operations tab state ──────────────────────────────────────
  const [opTasks, setOpTasks] = useState([]);
  const [opLoading, setOpLoading] = useState(false);
  const [opStatusFilter, setOpStatusFilter] = useState("");
  const [opLoaded, setOpLoaded] = useState(false);
  // ── Users tab state ───────────────────────────────────────────
  const [createUserOpen, setCreateUserOpen] = useState(false);
  const [usersSearch, setUsersSearch] = useState("");
  const [usersRoleFilter, setUsersRoleFilter] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    // ── Per-call safe wrapper with full debug logging ────────────
    const safeCall = (p, name) =>
      p.catch(e => {
        console.error(`[Dashboard] ${name} FAILED`, {
          status:  e?.response?.status,
          url:     e?.config?.url,
          data:    e?.response?.data,
          message: e?.message,
        });
        return null;
      });

    const [kpiRes, staffRes, deptRes, mapRes, tendersRes, alertsRes, workersRes] =
      await Promise.all([
        safeCall(fetchAdminKPI(),                                "KPI"),
        safeCall(fetchStaffUsers(),                              "StaffUsers"),
        safeCall(fetchDepartments(),                             "Departments"),
        safeCall(fetchInfraNodeMap(),                            "InfraNodeMap"),
        safeCall(fetchTenders({ status:"submitted", limit:50 }), "Tenders"),
        safeCall(fetchCriticalAlerts({ limit:50 }),              "CriticalAlerts"),
        safeCall(fetchAvailableWorkers(),                        "AvailableWorkers"),
      ]);

    if (kpiRes  !== null) setKpi(kpiRes);
    setStaff(Array.isArray(staffRes) ? staffRes : staffRes?.items || []);
    setDepartments(Array.isArray(deptRes) ? deptRes : deptRes?.items || []);
    setMapNodes(mapRes || { type:"FeatureCollection", features:[] });
    setTenders(Array.isArray(tendersRes) ? tendersRes : tendersRes?.items || []);
    setAlerts(Array.isArray(alertsRes?.items) ? alertsRes.items : []);
    setWorkers(Array.isArray(workersRes) ? workersRes : []);

    try {
      const j = await fetchJurisdictions();
      setJurisdictions(Array.isArray(j) ? j : []);
    } catch(e) {
      console.error("[Dashboard] fetchJurisdictions FAILED", {
        status: e?.response?.status, message: e?.message,
      });
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Operations: lazy-load tasks when tab is active ────────────
  const loadTasks = useCallback(async () => {
    setOpLoading(true);
    try {
      const res = await fetchAdminTaskList({ status: opStatusFilter || undefined, limit:100 });
      console.log("[Operations] response:", res);
      setOpTasks(Array.isArray(res?.items) ? res.items : Array.isArray(res) ? res : []);
      setOpLoaded(true);
    } catch(e) {
      console.error("[Operations] fetchAdminTaskList FAILED", {
        status:  e?.response?.status,
        url:     e?.config?.url,
        data:    e?.response?.data,
        message: e?.message,
      });
      toast.error("Failed to load operations data");
    } finally {
      setOpLoading(false);
    }
  }, [opStatusFilter]);

  useEffect(() => {
    if (activeTab === "operations") loadTasks();
  }, [activeTab, loadTasks]);

  // Load infra node detail when selected
  useEffect(() => {
    if (!selectedNode) { setNodeDetail(null); return; }
    setNodeLoading(true);
    fetchInfraNodeSummary(selectedNode).then(d => { setNodeDetail(d); setNodeLoading(false); })
      .catch(() => setNodeLoading(false));
  }, [selectedNode]);

  const filteredStaff = useMemo(() => {
    let s = staff;
    if (staffFilter) s = s.filter(u => u.role === staffFilter);
    if (staffSearch) {
      const q = staffSearch.toLowerCase();
      s = s.filter(u =>
        u.full_name?.toLowerCase().includes(q) ||
        u.email?.toLowerCase().includes(q) ||
        u.dept_name?.toLowerCase().includes(q)
      );
    }
    return s;
  }, [staff, staffFilter, staffSearch]);

  const filteredUsersTab = useMemo(() => {
    let s = staff;
    if (usersRoleFilter) s = s.filter(u => u.role === usersRoleFilter);
    if (usersSearch) {
      const q = usersSearch.toLowerCase();
      s = s.filter(u =>
        u.full_name?.toLowerCase().includes(q) ||
        u.email?.toLowerCase().includes(q) ||
        u.dept_name?.toLowerCase().includes(q)
      );
    }
    return s;
  }, [staff, usersRoleFilter, usersSearch]);

  const summary = kpi?.summary || {};
  const tasks = kpi?.tasks || {};
  const deptBreakdown = kpi?.dept_breakdown || [];
  const leaderboard = useMemo(() => [...workers].sort((a,b)=>(b.performance_score||0)-(a.performance_score||0)).slice(0,5), [workers]);

  const handleDeactivate = async (user) => {
    try {
      await deactivateStaffUser(user.id);
      toast.success(`${user.full_name} deactivated`);
      load();
    } catch { toast.error("Deactivation failed"); }
  };

  const handleTenderApprove = async (t) => {
    try { await approveTender(t.id, {}); setTenders(prev => prev.filter(x=>x.id!==t.id)); toast.success("Tender approved"); }
    catch { toast.error("Failed"); }
  };

  const handleTenderReject = async (t, reason) => {
    if (!reason) { toast.error("Reason required"); return; }
    try { await rejectTender(t.id, { reason }); setTenders(prev => prev.filter(x=>x.id!==t.id)); toast.success("Tender rejected"); }
    catch { toast.error("Failed"); }
  };

  return (
    <AppLayout>
      <div className="min-h-screen p-4 md:p-6 flex flex-col gap-5"
        style={{ background:"#020817", color:"#e2e8f0" }}>

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-black text-white">Command Center</h1>
            <p className="text-slate-400 text-sm">City-wide infrastructure oversight</p>
          </div>
          <div className="flex items-center gap-2">
            {alerts.length > 0 && (
              <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold text-red-400"
                style={{ background:"rgba(239,68,68,0.1)", border:"1px solid rgba(239,68,68,0.2)" }}>
                <span className="material-symbols-outlined text-[14px]">warning</span>
                {alerts.length} alerts
              </span>
            )}
            <button
              title="Test SMTP email configuration"
              onClick={async () => {
                try {
                  const { data } = await import("../../api/client").then(m =>
                    m.default.post("/admin/debug/email-test")
                  );
                  console.log("[EmailTest] result:", data);
                  if (data.status === "sent") toast.success(`Test email sent to ${data.to}`);
                  else if (data.status === "skipped") toast.warning(`SMTP not configured: ${data.reason}`);
                  else toast.error(`Email test failed: ${data.error || data.status} — check console`);
                } catch(e) {
                  console.error("[EmailTest] error:", e?.response?.data, e?.message);
                  toast.error("Email test request failed — check console");
                }
              }}
              className="p-2 rounded-xl text-slate-500 hover:text-slate-300 transition-colors"
              style={{ background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.06)" }}>
              <span className="material-symbols-outlined text-[18px]">mail</span>
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex flex-wrap gap-2">
          {TABS.map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all"
              style={{
                background: activeTab===tab.key ? "rgba(99,102,241,0.2)" : "rgba(255,255,255,0.04)",
                color:      activeTab===tab.key ? "#818cf8" : "#64748b",
                border:     `1px solid ${activeTab===tab.key ? "rgba(99,102,241,0.3)" : "rgba(255,255,255,0.06)"}`,
              }}>
              <span className="material-symbols-outlined text-[14px]">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── OVERVIEW ── */}
        {activeTab === "overview" && (
          <div className="flex flex-col gap-5">
            {/* KPI grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <KpiCard label="Total Complaints" value={summary.total_complaints}  color="#818cf8" icon="report" />
              <KpiCard label="Open"             value={summary.open_complaints}   color="#fb923c" icon="pending" />
              <KpiCard label="Critical"         value={summary.critical_count}    color="#f87171" icon="warning" />
              <KpiCard label="Resolved"         value={summary.resolved_complaints} color="#34d399" icon="check_circle" />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <KpiCard label="Tasks Pending"  value={tasks.pending}  color="#38bdf8" icon="assignment" />
              <KpiCard label="Tasks Active"   value={tasks.active}   color="#a78bfa" icon="play_circle" />
              <KpiCard label="Tasks Overdue"  value={tasks.overdue}  color="#f97316" icon="timer_off" />
              <KpiCard label="Needs Workflow" value={summary.needs_workflow} color="#facc15" icon="account_tree" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Dept breakdown */}
              <div className="rounded-2xl p-5" style={{ background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.06)" }}>
                <h3 className="text-sm font-bold text-slate-300 mb-4">Department Performance</h3>
                <div className="flex flex-col gap-2">
                  {deptBreakdown.slice(0,8).map((d, i) => (
                    <div key={i} className="flex items-center justify-between py-2.5 px-3 rounded-xl"
                      style={{ background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.05)" }}>
                      <p className="text-sm text-slate-300 font-medium truncate max-w-[160px]">{d.dept_name || "—"}</p>
                      <div className="flex items-center gap-4 text-xs">
                        <span className="text-slate-400">{d.complaints ?? 0} complaints</span>
                        <span className="text-emerald-400">{d.tasks_done ?? 0} done</span>
                        {d.overdue > 0 && <span className="text-red-400">{d.overdue} overdue</span>}
                      </div>
                    </div>
                  ))}
                  {deptBreakdown.length === 0 && <p className="text-xs text-slate-500">No data</p>}
                </div>
              </div>

              {/* Worker leaderboard */}
              <div className="rounded-2xl p-5" style={{ background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.06)" }}>
                <h3 className="text-sm font-bold text-slate-300 mb-4">Top Workers</h3>
                <div className="flex flex-col gap-2">
                  {leaderboard.map((w, i) => (
                    <div key={w.id} className="flex items-center gap-3 py-2.5 px-3 rounded-xl"
                      style={{ background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.05)" }}>
                      <span className="text-xs font-black text-slate-500 w-4">#{i+1}</span>
                      <Avatar name={w.full_name} color={ROLE_META.worker.color} size={8} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-200 truncate">{w.full_name}</p>
                        <p className="text-xs text-slate-500">{w.department_name || "—"}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-amber-400 text-xs">★</span>
                        <span className="text-xs font-bold text-slate-300">{Number(w.performance_score||0).toFixed(2)}</span>
                      </div>
                    </div>
                  ))}
                  {leaderboard.length === 0 && <p className="text-xs text-slate-500">No worker data</p>}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── OPERATIONS ── */}
        {activeTab === "operations" && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex gap-2 flex-wrap">
                {["","pending","accepted","in_progress","completed","cancelled"].map(s => (
                  <button key={s} onClick={() => setOpStatusFilter(s)}
                    className="px-3 py-2 rounded-xl text-xs font-bold transition-all"
                    style={{
                      background: opStatusFilter===s ? "rgba(99,102,241,0.2)" : "rgba(255,255,255,0.04)",
                      color:      opStatusFilter===s ? "#818cf8" : "#64748b",
                      border:     `1px solid ${opStatusFilter===s ? "rgba(99,102,241,0.3)" : "rgba(255,255,255,0.06)"}`,
                    }}>
                    {s || "All"}
                  </button>
                ))}
              </div>
              <button onClick={loadTasks} disabled={opLoading}
                className={`${S.btn} ${S.btnGhost}`}>
                <span className="material-symbols-outlined text-[16px]">refresh</span>
                Refresh
              </button>
            </div>

            <div className="rounded-2xl overflow-hidden" style={{ border:"1px solid rgba(255,255,255,0.07)" }}>
              <table className="w-full">
                <thead>
                  <tr style={{ background:"rgba(255,255,255,0.03)", borderBottom:"1px solid rgba(255,255,255,0.06)" }}>
                    <th className={S.th}>Task #</th>
                    <th className={S.th}>Title / Complaint</th>
                    <th className={S.th}>Status</th>
                    <th className={S.th}>Priority</th>
                    <th className={S.th}>Department</th>
                    <th className={S.th}>Assigned To</th>
                    <th className={S.th}>Due</th>
                  </tr>
                </thead>
                <tbody>
                  {opLoading ? (
                    Array(6).fill(0).map((_,i) => (
                      <tr key={i} style={{ borderBottom:"1px solid rgba(255,255,255,0.04)" }}>
                        {Array(7).fill(0).map((_,j) => (
                          <td key={j} className="px-4 py-3">
                            <div className="h-4 rounded animate-pulse" style={{ background:"rgba(255,255,255,0.06)" }} />
                          </td>
                        ))}
                      </tr>
                    ))
                  ) : opTasks.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center py-16 text-slate-500">
                        <span className="material-symbols-outlined text-4xl block mb-2 opacity-40">task_alt</span>
                        {opLoaded ? "No tasks found" : "Select a filter to load tasks"}
                      </td>
                    </tr>
                  ) : opTasks.map(t => (
                    <tr key={t.id} style={{ borderBottom:"1px solid rgba(255,255,255,0.04)" }}
                      className="hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-3">
                        <span className="text-xs font-mono text-indigo-400">{t.task_number || "—"}</span>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-sm font-semibold text-slate-200 truncate max-w-[200px]">{t.title}</p>
                        {t.complaint_number && <p className="text-[11px] text-slate-500">#{t.complaint_number}</p>}
                        {t.address_text && <p className="text-[11px] text-slate-600 truncate max-w-[200px]">{t.address_text}</p>}
                      </td>
                      <td className="px-4 py-3"><TaskStatusBadge status={t.status} /></td>
                      <td className="px-4 py-3"><PriorityBadge priority={t.priority} /></td>
                      <td className="px-4 py-3 text-xs text-slate-400">{t.dept_name || "—"}</td>
                      <td className="px-4 py-3 text-xs text-slate-400">
                        {t.worker_name || t.contractor_name || (
                          <span className="text-slate-600 italic">Unassigned</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {t.due_at ? new Date(t.due_at).toLocaleDateString("en-IN") : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!opLoading && opLoaded && (
              <p className="text-xs text-slate-600 text-center">{opTasks.length} task{opTasks.length !== 1 ? "s" : ""}</p>
            )}
          </div>
        )}

        {/* ── STAFF ── */}
        {activeTab === "staff" && (
          <div className="flex flex-col gap-4">
            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-3">
              <input value={staffSearch} onChange={e=>setStaffSearch(e.target.value)}
                placeholder="Search name, email, department…"
                className={`${S.input} flex-1`} />
              <div className="flex gap-2 flex-wrap">
                {["","official","admin","worker","contractor","super_admin"].map(r => (
                  <button key={r} onClick={() => setStaffFilter(r)}
                    className="px-3 py-2 rounded-xl text-xs font-bold transition-all"
                    style={{
                      background: staffFilter===r ? "rgba(99,102,241,0.2)" : "rgba(255,255,255,0.04)",
                      color:      staffFilter===r ? "#818cf8" : "#64748b",
                      border:     `1px solid ${staffFilter===r ? "rgba(99,102,241,0.3)" : "rgba(255,255,255,0.06)"}`,
                    }}>
                    {r || "All"}
                  </button>
                ))}
              </div>
            </div>

            {/* Staff grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {loading ? (
                Array(6).fill(0).map((_,i) => (
                  <div key={i} className="rounded-2xl p-4 h-28 animate-pulse"
                    style={{ background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.06)" }} />
                ))
              ) : filteredStaff.map(u => {
                const m = ROLE_META[u.role] || ROLE_META.official;
                return (
                  <button key={u.id} onClick={() => setEditingUser(u)}
                    className="rounded-2xl p-4 text-left transition-all hover:scale-[1.01] active:scale-[0.99]"
                    style={{ background:"rgba(255,255,255,0.03)", border:`1px solid rgba(255,255,255,0.07)` }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = m.color + "40"}
                    onMouseLeave={e => e.currentTarget.style.borderColor = "rgba(255,255,255,0.07)"}>
                    <div className="flex items-start gap-3">
                      <Avatar name={u.full_name} color={m.color} size={10} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <p className="text-sm font-bold text-white truncate">{u.full_name}</p>
                          {!u.has_firebase_auth && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded font-bold text-amber-400 bg-amber-400/10">No Auth</span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 truncate">{u.email}</p>
                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          <RoleBadge role={u.role} />
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${u.is_active ? "text-emerald-400 bg-emerald-400/10" : "text-red-400 bg-red-400/10"}`}>
                            {u.is_active ? "Active" : "Inactive"}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 mt-1.5 truncate">{u.dept_name || "No department"}{u.jurisdiction_name ? ` · ${u.jurisdiction_name}` : ""}</p>
                      </div>
                    </div>
                    {u.worker_score && (
                      <div className="mt-3 flex items-center gap-1.5 text-xs text-amber-400">
                        <span className="material-symbols-outlined text-[14px]">star</span>
                        <span className="font-semibold">{Number(u.worker_score).toFixed(2)}</span>
                        {u.current_task_count > 0 && <span className="text-slate-500">· {u.current_task_count} tasks</span>}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
            {!loading && filteredStaff.length === 0 && (
              <div className="text-center py-16 text-slate-500">
                <span className="material-symbols-outlined text-5xl block mb-2">group_off</span>
                <p>No staff found</p>
              </div>
            )}
            <p className="text-xs text-slate-600 text-center">{filteredStaff.length} of {staff.length} staff</p>
          </div>
        )}

        {/* ── USERS ── */}
        {activeTab === "users" && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
              <div className="flex flex-col sm:flex-row gap-3 flex-1">
                <input value={usersSearch} onChange={e => setUsersSearch(e.target.value)}
                  placeholder="Search name, email, department…"
                  className={`${S.input} flex-1`} />
                <div className="flex gap-2 flex-wrap">
                  {["","official","admin","worker","contractor","super_admin"].map(r => (
                    <button key={r} onClick={() => setUsersRoleFilter(r)}
                      className="px-3 py-2 rounded-xl text-xs font-bold transition-all"
                      style={{
                        background: usersRoleFilter===r ? "rgba(99,102,241,0.2)" : "rgba(255,255,255,0.04)",
                        color:      usersRoleFilter===r ? "#818cf8" : "#64748b",
                        border:     `1px solid ${usersRoleFilter===r ? "rgba(99,102,241,0.3)" : "rgba(255,255,255,0.06)"}`,
                      }}>
                      {r || "All"}
                    </button>
                  ))}
                </div>
              </div>
              <button onClick={() => setCreateUserOpen(true)}
                className={`${S.btn} ${S.btnPrimary} flex-shrink-0`}>
                <span className="material-symbols-outlined text-[16px]">person_add</span>
                Create User
              </button>
            </div>

            <div className="rounded-2xl overflow-hidden" style={{ border:"1px solid rgba(255,255,255,0.07)" }}>
              <table className="w-full">
                <thead>
                  <tr style={{ background:"rgba(255,255,255,0.03)", borderBottom:"1px solid rgba(255,255,255,0.06)" }}>
                    <th className={S.th}>User</th>
                    <th className={S.th}>Role</th>
                    <th className={S.th}>Department</th>
                    <th className={S.th}>Status</th>
                    <th className={S.th}>Auth</th>
                    <th className={S.th}></th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    Array(5).fill(0).map((_,i) => (
                      <tr key={i} style={{ borderBottom:"1px solid rgba(255,255,255,0.04)" }}>
                        {Array(6).fill(0).map((_,j) => (
                          <td key={j} className="px-4 py-3">
                            <div className="h-4 rounded animate-pulse" style={{ background:"rgba(255,255,255,0.06)" }} />
                          </td>
                        ))}
                      </tr>
                    ))
                  ) : filteredUsersTab.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center py-16 text-slate-500">
                        <span className="material-symbols-outlined text-4xl block mb-2 opacity-40">manage_accounts</span>
                        No users found
                      </td>
                    </tr>
                  ) : filteredUsersTab.map(u => {
                    const m = ROLE_META[u.role] || ROLE_META.official;
                    return (
                      <tr key={u.id} style={{ borderBottom:"1px solid rgba(255,255,255,0.04)" }}
                        className="hover:bg-white/[0.02] transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <Avatar name={u.full_name} color={m.color} size={8} />
                            <div>
                              <p className="text-sm font-semibold text-slate-200">{u.full_name}</p>
                              <p className="text-[11px] text-slate-500">{u.email}</p>
                              {u.phone && <p className="text-[11px] text-slate-600">{u.phone}</p>}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3"><RoleBadge role={u.role} /></td>
                        <td className="px-4 py-3 text-xs text-slate-400">
                          {u.dept_name || "—"}
                          {u.jurisdiction_name && <span className="block text-[10px] text-slate-600">{u.jurisdiction_name}</span>}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${u.is_active ? "text-emerald-400 bg-emerald-400/10" : "text-red-400 bg-red-400/10"}`}>
                            {u.is_active ? "Active" : "Inactive"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${u.has_firebase_auth ? "text-sky-400 bg-sky-400/10" : "text-amber-400 bg-amber-400/10"}`}>
                            {u.has_firebase_auth ? "Firebase ✓" : "No Auth"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <button onClick={() => setEditingUser(u)}
                            className="text-xs font-semibold text-indigo-400 hover:text-indigo-300 transition-colors">
                            Edit
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-slate-600 text-center">{filteredUsersTab.length} of {staff.length} users</p>
          </div>
        )}

        {/* ── MAP & NODES ── */}
        {activeTab === "map" && (
          <div className="flex flex-col gap-4">
            <div className="rounded-2xl overflow-hidden" style={{ height: 500 }}>
              <MapboxInfraLayer
                nodes={mapNodes}
                onNodeClick={(id) => setSelectedNode(id === selectedNode ? null : id)}
              />
            </div>

            {/* Node detail panel */}
            {selectedNode && (
              <div className="rounded-2xl p-5" style={{ background:"rgba(99,102,241,0.05)", border:"1px solid rgba(99,102,241,0.2)" }}>
                {nodeLoading ? (
                  <div className="h-20 animate-pulse rounded-xl" style={{ background:"rgba(255,255,255,0.04)" }} />
                ) : nodeDetail ? (
                  <div>
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <h3 className="font-bold text-white">{nodeDetail.node?.infra_type_name}</h3>
                        <p className="text-sm text-slate-400">{nodeDetail.node?.jurisdiction_name}</p>
                      </div>
                      <button onClick={() => setSelectedNode(null)} className="text-slate-400 hover:text-white">
                        <span className="material-symbols-outlined">close</span>
                      </button>
                    </div>
                    <div className="grid grid-cols-3 gap-3 mb-4">
                      {[
                        { label:"Total Complaints", value: nodeDetail.node?.total_complaint_count, color:"#818cf8" },
                        { label:"Resolved", value: nodeDetail.node?.total_resolved_count, color:"#34d399" },
                        { label:"Severity", value: nodeDetail.node?.cluster_severity || "—", color:"#fb923c" },
                      ].map(s => (
                        <div key={s.label} className="rounded-xl p-3" style={{ background:"rgba(255,255,255,0.04)" }}>
                          <p className="text-[10px] text-slate-500 uppercase tracking-wider">{s.label}</p>
                          <p className="text-lg font-black mt-0.5" style={{ color:s.color }}>{s.value}</p>
                        </div>
                      ))}
                    </div>
                    {nodeDetail.complaints?.slice(0,5).map(c => (
                      <div key={c.id} className="flex items-center justify-between py-2 px-3 rounded-xl mb-1"
                        style={{ background:"rgba(255,255,255,0.03)" }}>
                        <div>
                          <p className="text-xs font-semibold text-slate-300">#{c.complaint_number}</p>
                          <p className="text-[11px] text-slate-500 truncate max-w-[200px]">{c.title}</p>
                        </div>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${c.status==="resolved"?"text-emerald-400 bg-emerald-400/10":"text-amber-400 bg-amber-400/10"}`}>
                          {c.status}
                        </span>
                      </div>
                    ))}
                    <a href={`/admin/infra-nodes/${selectedNode}`}
                      className="mt-3 flex items-center gap-2 text-xs font-semibold text-indigo-400 hover:text-indigo-300">
                      <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                      View full infra node detail
                    </a>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        )}

        {/* ── TENDERS ── */}
        {activeTab === "tenders" && (
          <div className="flex flex-col gap-4">
            <h2 className="text-sm font-bold text-slate-300">Pending Tender Approvals ({tenders.length})</h2>
            {tenders.length === 0 ? (
              <div className="text-center py-12 text-slate-500">No tenders pending</div>
            ) : tenders.map(t => (
              <TenderCard key={t.id} tender={t} onApprove={() => handleTenderApprove(t)} onReject={(reason) => handleTenderReject(t, reason)} />
            ))}
          </div>
        )}

        {/* ── ALERTS ── */}
        {activeTab === "alerts" && (
          <div className="flex flex-col gap-3">
            <h2 className="text-sm font-bold text-slate-300">Critical Alerts — Repeat Issues ({alerts.length})</h2>
            {alerts.length === 0 ? (
              <div className="text-center py-12 text-slate-500">No critical alerts</div>
            ) : alerts.map((a, i) => (
              <div key={a.new_complaint_id || i} className="rounded-2xl p-4"
                style={{ background:"rgba(239,68,68,0.05)", border:"1px solid rgba(239,68,68,0.15)" }}>
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="material-symbols-outlined text-red-400 text-[18px]">warning</span>
                      <p className="font-bold text-slate-200 text-sm">{a.infra_type_name}</p>
                      <span className="text-xs text-slate-500">·</span>
                      <p className="text-xs text-slate-400">{a.jurisdiction_name}</p>
                    </div>
                    <p className="text-xs text-slate-500">#{a.complaint_number} · {a.days_since_resolution}d since last resolution</p>
                    {a.liable_contractor_flag && (
                      <p className="text-xs text-amber-400 mt-1">⚠ Liable contractor: {a.liable_contractor}</p>
                    )}
                  </div>
                  <span className="text-[10px] px-2 py-1 rounded-full font-bold text-red-400 bg-red-400/10">{a.priority}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Staff profile drawer */}
      {editingUser && (
        <StaffProfileDrawer
          user={editingUser}
          departments={departments}
          jurisdictions={jurisdictions}
          onClose={() => setEditingUser(null)}
          onSave={load}
          onDeactivate={handleDeactivate}
        />
      )}

      {createUserOpen && (
        <CreateUserDrawer
          departments={departments}
          jurisdictions={jurisdictions}
          onClose={() => setCreateUserOpen(false)}
          onSuccess={() => { setCreateUserOpen(false); load(); }}
        />
      )}

      <CRMAgentChat />
    </AppLayout>
  );
}

// ── Create User Drawer (dark theme) ───────────────────────────────
function CreateUserDrawer({ departments, jurisdictions, onClose, onSuccess }) {
  const [form, setForm] = useState({
    email: "", full_name: "", role: "official",
    department_id: "", jurisdiction_id: "",
    phone: "", preferred_language: "hi", temp_password: "PSCrm@2025",
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const roleMeta = ROLE_META[form.role] || ROLE_META.official;

  const handleSubmit = async () => {
    if (!form.full_name.trim()) { toast.error("Full name is required"); return; }
    if (!form.email.trim())     { toast.error("Email is required"); return; }
    if (!form.department_id && ["official","admin","worker"].includes(form.role)) {
      toast.error("Department is required for this role"); return;
    }
    setSaving(true);
    try {
      const res = await createStaffUser(form);
      console.log("[CreateUser] success:", res);
      toast.success(`User created! Temp password: ${res.temp_password}`);
      if (res.reset_link) toast.info("Password reset link generated — share with user", { duration:8000 });
      onSuccess();
    } catch(e) {
      console.error("[CreateUser] FAILED", {
        status:  e?.response?.status,
        data:    e?.response?.data,
        message: e?.message,
      });
      toast.error(e?.response?.data?.detail || "User creation failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end"
      style={{ background:"rgba(0,0,8,0.7)", backdropFilter:"blur(8px)" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <aside className="w-full max-w-lg flex flex-col overflow-y-auto"
        style={{ background:"#0f172a", borderLeft:"1px solid rgba(255,255,255,0.07)" }}>

        <div className="flex items-center gap-3 px-6 py-5"
          style={{ borderBottom:"1px solid rgba(255,255,255,0.06)" }}>
          <div className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: roleMeta.color + "22" }}>
            <span className="material-symbols-outlined text-[20px]" style={{ color: roleMeta.color }}>person_add</span>
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-black text-white">Create New User</h2>
            <p className="text-xs text-slate-400">Creates Firebase account + DB record</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-white/5 text-slate-400">
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        <div className="flex-1 p-6 flex flex-col gap-5">
          <div>
            <label className={S.label}>Role *</label>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(ROLE_META).map(([k, m]) => (
                <button key={k} type="button" onClick={() => set("role", k)}
                  className="p-3 rounded-xl text-left transition-all"
                  style={{
                    background: form.role===k ? m.color+"22" : "rgba(255,255,255,0.03)",
                    border: `1px solid ${form.role===k ? m.color+"55" : "rgba(255,255,255,0.08)"}`,
                  }}>
                  <span className="material-symbols-outlined text-[16px] block mb-1" style={{ color:m.color }}>{m.icon}</span>
                  <p className="font-bold text-xs" style={{ color: form.role===k ? "#e2e8f0" : "#64748b" }}>{k.replace("_"," ")}</p>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className={S.label}>Full Name *</label>
            <input value={form.full_name} onChange={e => set("full_name", e.target.value)}
              className={S.input} placeholder="e.g. Rajesh Kumar" />
          </div>
          <div>
            <label className={S.label}>Email *</label>
            <input type="email" value={form.email}
              onChange={e => set("email", e.target.value.toLowerCase())}
              className={S.input} placeholder="e.g. rajesh@mcd.delhi.gov.in" />
          </div>
          <div>
            <label className={S.label}>Phone</label>
            <input type="tel" value={form.phone} onChange={e => set("phone", e.target.value)}
              className={S.input} placeholder="+91 98765 43210" />
          </div>

          {["official","admin","super_admin","worker"].includes(form.role) && (
            <div>
              <label className={S.label}>Department{["official","admin","worker"].includes(form.role) ? " *" : ""}</label>
              <select value={form.department_id} onChange={e => set("department_id", e.target.value)} className={S.input}>
                <option value="">Select department…</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name} ({d.code})</option>)}
              </select>
            </div>
          )}

          {jurisdictions.length > 0 && form.role === "official" && (
            <div>
              <label className={S.label}>Jurisdiction</label>
              <select value={form.jurisdiction_id} onChange={e => set("jurisdiction_id", e.target.value)} className={S.input}>
                <option value="">All jurisdictions</option>
                {jurisdictions.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
              </select>
            </div>
          )}

          <div>
            <label className={S.label}>Preferred Language</label>
            <div className="flex gap-2">
              {[["hi","हिंदी"], ["en","English"]].map(([v,l]) => (
                <button key={v} type="button" onClick={() => set("preferred_language", v)}
                  className="flex-1 py-2 rounded-xl text-sm font-bold transition-all"
                  style={{
                    background: form.preferred_language===v ? "rgba(99,102,241,0.2)" : "rgba(255,255,255,0.04)",
                    border: `1px solid ${form.preferred_language===v ? "rgba(99,102,241,0.4)" : "rgba(255,255,255,0.08)"}`,
                    color: form.preferred_language===v ? "#818cf8" : "#64748b",
                  }}>{l}</button>
              ))}
            </div>
          </div>

          <div className="rounded-xl p-4"
            style={{ background:"rgba(251,191,36,0.08)", border:"1px solid rgba(251,191,36,0.2)" }}>
            <p className="text-xs font-bold text-amber-400 mb-2">Temporary Password</p>
            <input value={form.temp_password} onChange={e => set("temp_password", e.target.value)} className={S.input} />
            <p className="text-[10px] text-amber-500/80 mt-2">
              Share with the user. A password reset link is also auto-generated.
            </p>
          </div>
        </div>

        <div className="p-6" style={{ borderTop:"1px solid rgba(255,255,255,0.06)" }}>
          <button onClick={handleSubmit} disabled={saving}
            className="w-full py-3 rounded-xl font-bold text-sm text-white transition-all disabled:opacity-40"
            style={{ background: roleMeta.color }}>
            {saving ? "Creating Account…" : "Create User & Firebase Account"}
          </button>
        </div>
      </aside>
    </div>
  );
}

// ── Tender card ───────────────────────────────────────────────────
function TenderCard({ tender, onApprove, onReject }) {
  const [rejectReason, setRejectReason] = useState("");
  const [showReject, setShowReject] = useState(false);

  return (
    <div className="rounded-2xl p-5" style={{ background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.07)" }}>
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="font-bold text-slate-200">{tender.title}</p>
          <p className="text-xs text-slate-500 mt-0.5">#{tender.tender_number} · {tender.dept_name || "—"} · {tender.submitter_name || "—"}</p>
        </div>
        <span className="text-xs px-2.5 py-1 rounded-full font-semibold text-amber-400 bg-amber-400/10">{tender.status}</span>
      </div>
      {tender.estimated_cost && (
        <p className="text-sm text-slate-300 mb-3">Estimated: ₹{Number(tender.estimated_cost).toLocaleString("en-IN")}</p>
      )}
      {!showReject ? (
        <div className="flex gap-2">
          <button onClick={onApprove}
            className="flex-1 py-2 rounded-xl text-sm font-semibold text-emerald-400 transition-all"
            style={{ background:"rgba(52,211,153,0.1)", border:"1px solid rgba(52,211,153,0.2)" }}>
            Approve
          </button>
          <button onClick={() => setShowReject(true)}
            className="flex-1 py-2 rounded-xl text-sm font-semibold text-red-400 transition-all"
            style={{ background:"rgba(239,68,68,0.1)", border:"1px solid rgba(239,68,68,0.2)" }}>
            Reject
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <input value={rejectReason} onChange={e => setRejectReason(e.target.value)}
            className={S.input} placeholder="Reason for rejection…" />
          <div className="flex gap-2">
            <button onClick={() => onReject(rejectReason)}
              className="flex-1 py-2 rounded-xl text-sm font-semibold text-red-400"
              style={{ background:"rgba(239,68,68,0.1)", border:"1px solid rgba(239,68,68,0.2)" }}>
              Confirm Reject
            </button>
            <button onClick={() => setShowReject(false)}
              className="flex-1 py-2 rounded-xl text-sm text-slate-400 hover:text-slate-300"
              style={{ background:"rgba(255,255,255,0.04)" }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}