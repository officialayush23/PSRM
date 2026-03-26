import { useEffect, useMemo, useState } from "react";
import AppLayout from "../../components/AppLayout";
import CRMAgentChat from "../../components/CRMAgentChat";
import CriticalAlertBadge from "../../components/CriticalAlertBadge";
import MapboxInfraLayer from "../../components/MapboxInfraLayer";
import TenderApprovalCard from "../../components/TenderApprovalCard";
import {
  approveTender,
  fetchAdminKPI,
  fetchAdminTaskList,
  fetchAvailableWorkers,
  fetchCriticalAlerts,
  fetchDepartments,
  fetchInfraNodeMap,
  fetchJurisdictions,
  fetchStaffUsers,
  fetchTenders,
  rejectTender,
  updateStaffUser,
} from "../../api/adminApi";
import { toast } from "sonner";

const TABS = [
  { key: "overview", label: "Overview",         icon: "dashboard" },
  { key: "map",      label: "Map",              icon: "map" },
  { key: "tenders",  label: "Tender Approvals", icon: "gavel" },
  { key: "staff",    label: "Staff",            icon: "group" },
  { key: "alerts",   label: "Critical Alerts",  icon: "notification_important" },
];

const STAFF_ROLE_FILTERS = ["all", "official", "worker", "contractor", "admin", "super_admin"];

const ROLE_STYLE = {
  official:    { bg: "rgba(56,189,248,0.15)",  color: "#38bdf8" },
  worker:      { bg: "rgba(52,211,153,0.15)",  color: "#34d399" },
  contractor:  { bg: "rgba(251,191,36,0.15)",  color: "#fbbf24" },
  admin:       { bg: "rgba(129,140,248,0.15)", color: "#818cf8" },
  super_admin: { bg: "rgba(251,146,60,0.15)",  color: "#fb923c" },
};

function RoleBadge({ role }) {
  const s = ROLE_STYLE[role] || { bg: "rgba(0,0,0,0.06)", color: "#64748b" };
  return (
    <span className="rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ background: s.bg, color: s.color }}>
      {role || "unknown"}
    </span>
  );
}

function toItems(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  return [];
}

function getTaskCountForUser(user, taskCountMap) {
  if (typeof user?.active_task_count === "number") return user.active_task_count;
  if (typeof user?.current_task_count === "number") return user.current_task_count;
  if (typeof user?.task_count === "number") return user.task_count;
  if (taskCountMap.has(user?.id)) return taskCountMap.get(user.id);
  return "-";
}

export default function AdminDashboardPage() {
  const authUser     = useMemo(() => JSON.parse(localStorage.getItem("auth_user") || "{}"), []);
  const adminDeptId  = authUser?.department_id || authUser?.dept_id || null;
  const adminDeptName = authUser?.department_name || authUser?.dept_name || "Department";

  const [activeTab, setActiveTab] = useState("overview");
  const [kpi, setKpi]             = useState(null);
  const [workers, setWorkers]     = useState([]);
  const [mapNodes, setMapNodes]   = useState({ type: "FeatureCollection", features: [] });
  const [tenders, setTenders]     = useState([]);
  const [staff, setStaff]         = useState([]);
  const [staffRoleFilter, setStaffRoleFilter] = useState("all");
  const [departments, setDepartments]   = useState([]);
  const [jurisdictions, setJurisdictions] = useState([]);
  const [taskCountMap, setTaskCountMap] = useState(new Map());
  const [editingUser, setEditingUser]   = useState(null);
  const [savingUser, setSavingUser]     = useState(false);
  const [criticalAlerts, setCriticalAlerts] = useState([]);

  const leaderboard = useMemo(
    () => [...workers].sort((a, b) => (b?.performance_score || 0) - (a?.performance_score || 0)).slice(0, 5),
    [workers]
  );
  const deptBreakdown = useMemo(() => toItems(kpi?.dept_breakdown), [kpi]);
  const staffRows = useMemo(() => {
    if (staffRoleFilter === "all") return staff;
    return staff.filter((s) => s.role === staffRoleFilter);
  }, [staff, staffRoleFilter]);

  async function loadOverview() {
    try {
      const [kpiRes, workersRes] = await Promise.all([
        fetchAdminKPI(),
        fetchAvailableWorkers({ deptId: adminDeptId || undefined }),
      ]);
      setKpi(kpiRes || null);
      setWorkers(toItems(workersRes));
    } catch { toast.error("Failed to load overview data"); }
  }

  async function loadMap() {
    try {
      const mapRes = await fetchInfraNodeMap({ deptId: adminDeptId || undefined });
      setMapNodes(mapRes || { type: "FeatureCollection", features: [] });
    } catch { setMapNodes({ type: "FeatureCollection", features: [] }); }
  }

  async function loadTenders() {
    try {
      const res = await fetchTenders({ status: "submitted", deptId: adminDeptId || undefined, limit: 100 });
      setTenders(toItems(res));
    } catch { toast.error("Failed to load tenders"); setTenders([]); }
  }

  async function loadStaff() {
    try {
      const [staffRes, deptRes, jurisRes, tasksRes] = await Promise.all([
        fetchStaffUsers(), fetchDepartments(), fetchJurisdictions(),
        fetchAdminTaskList({ deptId: adminDeptId || undefined, limit: 200 }),
      ]);
      const users = toItems(staffRes);
      const scoped = adminDeptId ? users.filter((u) => (u.department_id || u.dept_id) === adminDeptId) : users;
      setStaff(scoped);
      setDepartments(toItems(deptRes));
      setJurisdictions(toItems(jurisRes));
      const counts = new Map();
      for (const task of toItems(tasksRes)) {
        const uid = task.assigned_worker_id || task.worker_id || task.assigned_to_user_id || null;
        if (!uid) continue;
        counts.set(uid, (counts.get(uid) || 0) + 1);
      }
      setTaskCountMap(counts);
    } catch { toast.error("Failed to load staff data"); setStaff([]); }
  }

  async function loadAlerts() {
    try {
      const alertRes = await fetchCriticalAlerts({ limit: 100 });
      const all = toItems(alertRes);
      const scoped = all.filter((a) => {
        if (!adminDeptId) return true;
        const did = a.department_id || a.dept_id;
        if (!did) return true;
        return did === adminDeptId;
      });
      setCriticalAlerts(scoped);
    } catch { toast.error("Failed to load critical alerts"); setCriticalAlerts([]); }
  }

  useEffect(() => {
    Promise.all([loadOverview(), loadMap(), loadTenders(), loadStaff(), loadAlerts()]);
  }, []);

  async function handleTenderApprove(tender, payload) {
    try {
      await approveTender(tender.id, payload || {});
      setTenders((prev) => prev.filter((t) => t.id !== tender.id));
      toast.success("Tender approved");
    } catch { toast.error("Failed to approve tender"); }
  }

  async function handleTenderReject(tender, payload) {
    if (!payload?.reason) { toast.error("Rejection reason is required"); return; }
    try {
      await rejectTender(tender.id, payload);
      setTenders((prev) => prev.filter((t) => t.id !== tender.id));
      toast.success("Tender rejected");
    } catch { toast.error("Failed to reject tender"); }
  }

  async function saveStaffEdit(e) {
    e.preventDefault();
    if (!editingUser?.id) return;
    setSavingUser(true);
    try {
      await updateStaffUser(editingUser.id, {
        full_name: editingUser.full_name,
        role: editingUser.role,
        department_id: editingUser.department_id || null,
        jurisdiction_id: editingUser.jurisdiction_id || null,
        phone: editingUser.phone || null,
        is_active: editingUser.is_active !== false,
      });
      toast.success("Staff user updated");
      setEditingUser(null);
      await loadStaff();
    } catch { toast.error("Failed to update staff user"); }
    finally { setSavingUser(false); }
  }

  const tableHead = "px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider";
  const tableRow  = "transition-colors";

  return (
    <AppLayout>
      <div className="p-4 md:p-6 flex flex-col gap-6">
        {/* Tab bar */}
        <div className="flex flex-wrap gap-2">
          {TABS.map(tab => (
            <button key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold transition-all"
              style={{
                background: activeTab === tab.key ? "rgba(56,189,248,0.15)" : "rgba(0,0,0,0.04)",
                color: activeTab === tab.key ? "#38bdf8" : "#64748b",
                border: `1px solid ${activeTab === tab.key ? "rgba(56,189,248,0.3)" : "rgba(0,0,0,0.06)"}`,
              }}>
              <span className="material-symbols-outlined text-[14px]">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── Overview ── */}
        {activeTab === "overview" && (
          <div className="flex flex-col gap-5">
            {/* KPIs */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { t: "Total Complaints", v: kpi?.summary?.total_complaints,    c: "#38bdf8" },
                { t: "Open",             v: kpi?.summary?.open_complaints,     c: "#fb923c" },
                { t: "Critical",         v: kpi?.summary?.critical_count,      c: "#f87171" },
                { t: "Resolved",         v: kpi?.summary?.resolved_complaints, c: "#34d399" },
              ].map(k => (
                <div key={k.t} className="gcard p-4">
                  <p className="text-xs text-slate-500 mb-1">{k.t}</p>
                  <p className="text-2xl font-bold" style={{ color: k.c }}>{k.v ?? 0}</p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {/* Dept performance */}
              <div className="gcard p-4">
                <h2 className="text-sm font-semibold text-slate-800 mb-3">Department Performance</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead style={{ borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
                      <tr>
                        <th className={tableHead}>Department</th>
                        <th className={tableHead}>Complaints</th>
                        <th className={tableHead}>Resolved</th>
                        <th className={tableHead}>Tasks Done</th>
                      </tr>
                    </thead>
                    <tbody>
                      {deptBreakdown.map((d, idx) => (
                        <tr key={d.department_id || d.dept_id || idx} className={tableRow}
                          style={{ borderBottom: "1px solid rgba(0,0,0,0.05)" }}
                          onMouseEnter={e => e.currentTarget.style.background = "rgba(0,0,0,0.03)"}
                          onMouseLeave={e => e.currentTarget.style.background = ""}>
                          <td className="px-4 py-2.5 text-slate-800">{d.dept_name || d.department_name || d.name || "-"}</td>
                          <td className="px-4 py-2.5 text-slate-400">{d.complaints ?? d.total_complaints ?? 0}</td>
                          <td className="px-4 py-2.5 text-emerald-400">{d.resolved ?? d.resolved_count ?? 0}</td>
                          <td className="px-4 py-2.5 text-sky-400">{d.tasks_done ?? d.task_done ?? 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!deptBreakdown.length && <p className="pt-3 text-xs text-slate-600">No department metrics available.</p>}
                </div>
              </div>

              {/* Worker leaderboard */}
              <div className="gcard p-4">
                <h2 className="text-sm font-semibold text-slate-800 mb-3">Worker Leaderboard</h2>
                <div className="flex flex-col gap-2">
                  {leaderboard.map((w, i) => (
                    <div key={w.id} className="flex items-center justify-between rounded-xl px-3 py-2.5"
                      style={{ background: "rgba(0,0,0,0.04)", border: "1px solid rgba(0,0,0,0.06)" }}>
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-bold text-slate-600">#{i + 1}</span>
                        <div>
                          <p className="text-sm font-semibold text-slate-800">{w.full_name || w.name || "Unnamed"}</p>
                          <p className="text-xs text-slate-500">{w.department_name || adminDeptName}</p>
                        </div>
                      </div>
                      <span className="text-xs font-bold px-2.5 py-1 rounded-full"
                        style={{ background: "rgba(52,211,153,0.15)", color: "#34d399" }}>
                        {Number(w.performance_score || 0).toFixed(2)}
                      </span>
                    </div>
                  ))}
                  {!leaderboard.length && <p className="text-xs text-slate-600">No worker data available.</p>}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Map ── */}
        {activeTab === "map" && (
          <div className="flex flex-col gap-3">
            <div className="rounded-xl px-4 py-2.5 text-xs text-slate-500"
              style={{ background: "rgba(0,0,0,0.04)", border: "1px solid rgba(0,0,0,0.06)" }}>
              Department scope: <span className="font-semibold text-slate-800">{adminDeptName}</span>
            </div>
            <div style={{ height: 520 }}>
              <MapboxInfraLayer
                nodes={mapNodes}
                onNodeClick={(id) => { window.location.href = `/admin/infra-nodes/${id}`; }}
              />
            </div>
          </div>
        )}

        {/* ── Tenders ── */}
        {activeTab === "tenders" && (
          <div className="flex flex-col gap-4">
            <h2 className="text-sm font-semibold text-slate-800">Tender Approvals</h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {tenders.map(t => (
                <TenderApprovalCard key={t.id} tender={t} userRole="admin"
                  onApprove={handleTenderApprove} onReject={handleTenderReject} />
              ))}
            </div>
            {!tenders.length && (
              <div className="gcard p-4 text-xs text-slate-500">No submitted tenders pending approval.</div>
            )}
          </div>
        )}

        {/* ── Staff ── */}
        {activeTab === "staff" && (
          <div className="gcard overflow-hidden">
            <div className="flex items-center justify-between gap-2 p-4" style={{ borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
              <h2 className="text-sm font-semibold text-slate-800">Staff</h2>
              <select
                value={staffRoleFilter}
                onChange={(e) => setStaffRoleFilter(e.target.value)}
                className="ginput px-3 py-1.5 text-xs rounded-xl">
                {STAFF_ROLE_FILTERS.map(r => (
                  <option key={r} value={r}>{r === "all" ? "All Roles" : r}</option>
                ))}
              </select>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead style={{ background: "rgba(0,0,0,0.03)", borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
                  <tr>
                    <th className={tableHead}>Name</th>
                    <th className={tableHead}>Role</th>
                    <th className={tableHead}>Department</th>
                    <th className={tableHead}>Jurisdiction</th>
                    <th className={tableHead}>Tasks</th>
                    <th className={tableHead}>Firebase</th>
                    <th className={tableHead}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {staffRows.map(s => (
                    <tr key={s.id} className={tableRow}
                      style={{ borderBottom: "1px solid rgba(0,0,0,0.05)" }}
                      onMouseEnter={e => e.currentTarget.style.background = "rgba(0,0,0,0.02)"}
                      onMouseLeave={e => e.currentTarget.style.background = ""}>
                      <td className="px-4 py-3 text-slate-800 font-medium">{s.full_name || "-"}</td>
                      <td className="px-4 py-3"><RoleBadge role={s.role} /></td>
                      <td className="px-4 py-3 text-slate-400">{s.department_name || s.dept_name || "-"}</td>
                      <td className="px-4 py-3 text-slate-400">{s.jurisdiction_name || "-"}</td>
                      <td className="px-4 py-3 text-slate-400">{getTaskCountForUser(s, taskCountMap)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-block h-2.5 w-2.5 rounded-full ${s.auth_uid ? "bg-emerald-500" : "bg-red-500"}`}
                          title={s.auth_uid ? "Firebase linked" : "Firebase missing"} />
                      </td>
                      <td className="px-4 py-3">
                        <button type="button"
                          onClick={() => setEditingUser({ ...s, department_id: s.department_id || s.dept_id || "", jurisdiction_id: s.jurisdiction_id || "" })}
                          className="text-sky-400 hover:text-sky-300 text-xs transition-colors">
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Alerts ── */}
        {activeTab === "alerts" && (
          <div className="flex flex-col gap-4">
            <h2 className="text-sm font-semibold text-slate-800">Critical Alerts</h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {criticalAlerts.map((a, idx) => (
                <CriticalAlertBadge key={a.new_complaint_id || a.node_id || idx} alert={a}
                  onView={() => setActiveTab("map")} />
              ))}
            </div>
            {!criticalAlerts.length && (
              <div className="gcard p-4 text-xs text-slate-500">No critical alerts in this department scope.</div>
            )}
          </div>
        )}
      </div>

      {/* Edit staff drawer */}
      {editingUser && (
        <div className="fixed inset-0 z-40" style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
          onClick={() => setEditingUser(null)}>
          <aside
            className="absolute right-0 top-0 h-full w-full max-w-md p-6 overflow-y-auto"
            style={{ background: "rgba(255,255,255,0.97)", backdropFilter: "blur(24px)", borderLeft: "1px solid rgba(0,0,0,0.08)", boxShadow: "-20px 0 60px rgba(0,0,0,0.1)" }}
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-sm font-semibold text-slate-800">Edit Staff User</h3>
              <button onClick={() => setEditingUser(null)}
                className="w-8 h-8 rounded-full hover:bg-black/5 flex items-center justify-center">
                <span className="material-symbols-outlined text-slate-400 text-[18px]">close</span>
              </button>
            </div>
            <form className="space-y-4" onSubmit={saveStaffEdit}>
              <input value={editingUser.full_name || ""}
                onChange={(e) => setEditingUser(prev => ({ ...prev, full_name: e.target.value }))}
                className="w-full px-3 py-2 rounded-xl text-sm ginput" placeholder="Full name" />
              <select value={editingUser.role || "official"}
                onChange={(e) => setEditingUser(prev => ({ ...prev, role: e.target.value }))}
                className="w-full px-3 py-2 rounded-xl text-sm ginput">
                {["official","admin","super_admin","worker","contractor"].map(r => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
              <select value={editingUser.department_id || ""}
                onChange={(e) => setEditingUser(prev => ({ ...prev, department_id: e.target.value }))}
                className="w-full px-3 py-2 rounded-xl text-sm ginput">
                <option value="">Select department</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <select value={editingUser.jurisdiction_id || ""}
                onChange={(e) => setEditingUser(prev => ({ ...prev, jurisdiction_id: e.target.value }))}
                className="w-full px-3 py-2 rounded-xl text-sm ginput">
                <option value="">Select jurisdiction</option>
                {jurisdictions.map(j => <option key={j.id} value={j.id}>{j.name || j.jurisdiction_name}</option>)}
              </select>
              <input value={editingUser.phone || ""}
                onChange={(e) => setEditingUser(prev => ({ ...prev, phone: e.target.value }))}
                className="w-full px-3 py-2 rounded-xl text-sm ginput" placeholder="Phone" />
              <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                <input type="checkbox"
                  checked={editingUser.is_active !== false}
                  onChange={(e) => setEditingUser(prev => ({ ...prev, is_active: e.target.checked }))}
                  className="rounded" />
                Active
              </label>
              <div className="flex gap-2 pt-2">
                <button type="submit" disabled={savingUser}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white gbtn-sky disabled:opacity-50">
                  {savingUser ? "Saving…" : "Save"}
                </button>
                <button type="button" onClick={() => setEditingUser(null)}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold gbtn-ghost">
                  Cancel
                </button>
              </div>
            </form>
          </aside>
        </div>
      )}

      <CRMAgentChat />
    </AppLayout>
  );
}
