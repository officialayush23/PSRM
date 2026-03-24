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
  { key: "overview", label: "Overview" },
  { key: "map", label: "Map" },
  { key: "tenders", label: "Tender Approvals" },
  { key: "staff", label: "Staff" },
  { key: "alerts", label: "Critical Alerts" },
];

const STAFF_ROLE_FILTERS = ["all", "official", "worker", "contractor", "admin", "super_admin"];

function TabButton({ active, onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${
        active ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
      }`}
    >
      {label}
    </button>
  );
}

function KPIBlock({ title, value }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <p className="text-xs text-slate-500">{title}</p>
      <p className="mt-1 text-lg font-semibold text-slate-900">{value ?? 0}</p>
    </div>
  );
}

function RoleBadge({ role }) {
  const color = {
    official: "bg-sky-100 text-sky-700",
    worker: "bg-emerald-100 text-emerald-700",
    contractor: "bg-amber-100 text-amber-700",
    admin: "bg-slate-800 text-white",
    super_admin: "bg-violet-100 text-violet-700",
  }[role] || "bg-slate-100 text-slate-700";
  return <span className={`rounded-full px-2 py-1 text-[11px] font-medium ${color}`}>{role || "unknown"}</span>;
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
  const authUser = useMemo(() => JSON.parse(localStorage.getItem("auth_user") || "{}"), []);
  const adminDeptId = authUser?.department_id || authUser?.dept_id || null;
  const adminDeptName = authUser?.department_name || authUser?.dept_name || "Department";

  const [activeTab, setActiveTab] = useState("overview");

  const [kpi, setKpi] = useState(null);
  const [workers, setWorkers] = useState([]);
  const [mapNodes, setMapNodes] = useState({ type: "FeatureCollection", features: [] });

  const [tenders, setTenders] = useState([]);

  const [staff, setStaff] = useState([]);
  const [staffRoleFilter, setStaffRoleFilter] = useState("all");
  const [departments, setDepartments] = useState([]);
  const [jurisdictions, setJurisdictions] = useState([]);
  const [taskCountMap, setTaskCountMap] = useState(new Map());

  const [editingUser, setEditingUser] = useState(null);
  const [savingUser, setSavingUser] = useState(false);

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
    } catch {
      toast.error("Failed to load overview data");
    }
  }

  async function loadMap() {
    try {
      const mapRes = await fetchInfraNodeMap({ deptId: adminDeptId || undefined });
      setMapNodes(mapRes || { type: "FeatureCollection", features: [] });
    } catch {
      setMapNodes({ type: "FeatureCollection", features: [] });
      toast.error("Failed to load map nodes");
    }
  }

  async function loadTenders() {
    try {
      const res = await fetchTenders({ status: "submitted", deptId: adminDeptId || undefined, limit: 100 });
      setTenders(toItems(res));
    } catch {
      toast.error("Failed to load tenders");
      setTenders([]);
    }
  }

  async function loadStaff() {
    try {
      const [staffRes, deptRes, jurisRes, tasksRes] = await Promise.all([
        fetchStaffUsers(),
        fetchDepartments(),
        fetchJurisdictions(),
        fetchAdminTaskList({ deptId: adminDeptId || undefined, limit: 200 }),
      ]);

      const users = toItems(staffRes);
      const deptScopedUsers = adminDeptId ? users.filter((u) => (u.department_id || u.dept_id) === adminDeptId) : users;
      setStaff(deptScopedUsers);
      setDepartments(toItems(deptRes));
      setJurisdictions(toItems(jurisRes));

      const counts = new Map();
      for (const task of toItems(tasksRes)) {
        const uid = task.assigned_worker_id || task.worker_id || task.assigned_to_user_id || null;
        if (!uid) continue;
        counts.set(uid, (counts.get(uid) || 0) + 1);
      }
      setTaskCountMap(counts);
    } catch {
      toast.error("Failed to load staff data");
      setStaff([]);
    }
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
    } catch {
      toast.error("Failed to load critical alerts");
      setCriticalAlerts([]);
    }
  }

  async function reloadAll() {
    await Promise.all([loadOverview(), loadMap(), loadTenders(), loadStaff(), loadAlerts()]);
  }

  useEffect(() => {
    reloadAll();
  }, []);

  async function handleTenderApprove(tender, payload) {
    try {
      await approveTender(tender.id, payload || {});
      setTenders((prev) => prev.filter((t) => t.id !== tender.id));
      toast.success("Tender approved");
    } catch {
      toast.error("Failed to approve tender");
    }
  }

  async function handleTenderReject(tender, payload) {
    if (!payload?.reason) {
      toast.error("Rejection reason is required");
      return;
    }
    try {
      await rejectTender(tender.id, payload);
      setTenders((prev) => prev.filter((t) => t.id !== tender.id));
      toast.success("Tender rejected");
    } catch {
      toast.error("Failed to reject tender");
    }
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
    } catch {
      toast.error("Failed to update staff user");
    } finally {
      setSavingUser(false);
    }
  }

  return (
    <AppLayout>
      <div className="space-y-4 p-4">
        <section className="flex flex-wrap gap-2">
          {TABS.map((tab) => (
            <TabButton key={tab.key} label={tab.label} active={activeTab === tab.key} onClick={() => setActiveTab(tab.key)} />
          ))}
        </section>

        {activeTab === "overview" ? (
          <section className="space-y-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <KPIBlock title="Total Complaints" value={kpi?.summary?.total_complaints} />
              <KPIBlock title="Open" value={kpi?.summary?.open_complaints} />
              <KPIBlock title="Critical" value={kpi?.summary?.critical_count} />
              <KPIBlock title="Resolved" value={kpi?.summary?.resolved_complaints} />
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <h2 className="mb-3 text-sm font-semibold text-slate-800">Department Performance</h2>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-2 py-2">Department</th>
                        <th className="px-2 py-2">Complaints</th>
                        <th className="px-2 py-2">Resolved</th>
                        <th className="px-2 py-2">Tasks Done</th>
                      </tr>
                    </thead>
                    <tbody>
                      {deptBreakdown.map((d, idx) => (
                        <tr key={d.department_id || d.dept_id || idx} className="border-t border-slate-100">
                          <td className="px-2 py-2">{d.dept_name || d.department_name || d.name || "-"}</td>
                          <td className="px-2 py-2">{d.complaints ?? d.total_complaints ?? 0}</td>
                          <td className="px-2 py-2">{d.resolved ?? d.resolved_count ?? 0}</td>
                          <td className="px-2 py-2">{d.tasks_done ?? d.task_done ?? 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!deptBreakdown.length ? <p className="pt-3 text-xs text-slate-500">No department metrics available.</p> : null}
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <h2 className="mb-3 text-sm font-semibold text-slate-800">Worker Leaderboard</h2>
                <div className="space-y-2">
                  {leaderboard.map((w) => (
                    <div key={w.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-xs">
                      <div>
                        <p className="font-semibold text-slate-800">{w.full_name || w.name || "Unnamed"}</p>
                        <p className="text-slate-500">{w.department_name || adminDeptName}</p>
                      </div>
                      <p className="rounded-full bg-emerald-100 px-2 py-1 font-semibold text-emerald-700">
                        {Number(w.performance_score || 0).toFixed(2)}
                      </p>
                    </div>
                  ))}
                  {!leaderboard.length ? <p className="text-xs text-slate-500">No worker data available.</p> : null}
                </div>
              </div>
            </div>
          </section>
        ) : null}

        {activeTab === "map" ? (
          <section className="space-y-3">
            <div className="rounded-lg border border-slate-200 bg-white p-2 text-xs text-slate-600">
              Department scope: <span className="font-semibold text-slate-800">{adminDeptName}</span>
            </div>
            <MapboxInfraLayer
              nodes={mapNodes}
              onNodeClick={(id) => {
                window.location.href = `/admin/infra-nodes/${id}`;
              }}
            />
          </section>
        ) : null}

        {activeTab === "tenders" ? (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-slate-800">Tender Approvals</h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {tenders.map((t) => (
                <TenderApprovalCard
                  key={t.id}
                  tender={t}
                  userRole="admin"
                  onApprove={handleTenderApprove}
                  onReject={handleTenderReject}
                />
              ))}
            </div>
            {!tenders.length ? (
              <div className="rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-500">No submitted tenders pending approval.</div>
            ) : null}
          </section>
        ) : null}

        {activeTab === "staff" ? (
          <section className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-800">Staff</h2>
              <select
                value={staffRoleFilter}
                onChange={(e) => setStaffRoleFilter(e.target.value)}
                className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
              >
                {STAFF_ROLE_FILTERS.map((r) => (
                  <option key={r} value={r}>
                    {r === "all" ? "All Roles" : r}
                  </option>
                ))}
              </select>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-2 py-2">Name</th>
                    <th className="px-2 py-2">Role</th>
                    <th className="px-2 py-2">Department</th>
                    <th className="px-2 py-2">Jurisdiction</th>
                    <th className="px-2 py-2">Active Tasks</th>
                    <th className="px-2 py-2">Firebase</th>
                    <th className="px-2 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {staffRows.map((s) => (
                    <tr key={s.id} className="border-t border-slate-100">
                      <td className="px-2 py-2">{s.full_name || "-"}</td>
                      <td className="px-2 py-2"><RoleBadge role={s.role} /></td>
                      <td className="px-2 py-2">{s.department_name || s.dept_name || "-"}</td>
                      <td className="px-2 py-2">{s.jurisdiction_name || "-"}</td>
                      <td className="px-2 py-2">{getTaskCountForUser(s, taskCountMap)}</td>
                      <td className="px-2 py-2">
                        <span
                          className={`inline-block h-2.5 w-2.5 rounded-full ${s.auth_uid ? "bg-emerald-500" : "bg-rose-500"}`}
                          title={s.auth_uid ? "Firebase linked" : "Firebase missing"}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <button
                          type="button"
                          onClick={() => setEditingUser({
                            ...s,
                            department_id: s.department_id || s.dept_id || "",
                            jurisdiction_id: s.jurisdiction_id || "",
                          })}
                          className="rounded border border-slate-300 px-2 py-1"
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {activeTab === "alerts" ? (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-slate-800">Critical Alerts</h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {criticalAlerts.map((a, idx) => (
                <CriticalAlertBadge key={a.new_complaint_id || a.node_id || idx} alert={a} onView={() => setActiveTab("map")} />
              ))}
            </div>
            {!criticalAlerts.length ? (
              <div className="rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-500">No critical alerts in this department scope.</div>
            ) : null}
          </section>
        ) : null}
      </div>

      {editingUser ? (
        <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setEditingUser(null)}>
          <aside
            className="absolute right-0 top-0 h-full w-full max-w-md bg-white p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-3 text-sm font-semibold text-slate-800">Edit Staff User</h3>
            <form className="space-y-3" onSubmit={saveStaffEdit}>
              <input
                value={editingUser.full_name || ""}
                onChange={(e) => setEditingUser((prev) => ({ ...prev, full_name: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                placeholder="Full name"
              />
              <select
                value={editingUser.role || "official"}
                onChange={(e) => setEditingUser((prev) => ({ ...prev, role: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
              >
                <option value="official">official</option>
                <option value="admin">admin</option>
                <option value="super_admin">super_admin</option>
                <option value="worker">worker</option>
                <option value="contractor">contractor</option>
              </select>
              <select
                value={editingUser.department_id || ""}
                onChange={(e) => setEditingUser((prev) => ({ ...prev, department_id: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
              >
                <option value="">Select department</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              <select
                value={editingUser.jurisdiction_id || ""}
                onChange={(e) => setEditingUser((prev) => ({ ...prev, jurisdiction_id: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
              >
                <option value="">Select jurisdiction</option>
                {jurisdictions.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.name || j.jurisdiction_name}
                  </option>
                ))}
              </select>
              <input
                value={editingUser.phone || ""}
                onChange={(e) => setEditingUser((prev) => ({ ...prev, phone: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                placeholder="Phone"
              />
              <label className="flex items-center gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={editingUser.is_active !== false}
                  onChange={(e) => setEditingUser((prev) => ({ ...prev, is_active: e.target.checked }))}
                />
                Active
              </label>
              <div className="flex gap-2">
                <button type="submit" disabled={savingUser} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white">
                  {savingUser ? "Saving..." : "Save"}
                </button>
                <button type="button" onClick={() => setEditingUser(null)} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700">
                  Cancel
                </button>
              </div>
            </form>
          </aside>
        </div>
      ) : null}

      <CRMAgentChat />
    </AppLayout>
  );
}
