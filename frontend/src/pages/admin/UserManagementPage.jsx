// src/pages/admin/UserManagementPage.jsx
// Super Admin — create and manage officials, workers, admins, contractors.
// Calls POST /admin/users (Firebase + DB), PATCH /admin/users/{id}, GET /admin/users.

import { useEffect, useState, useCallback } from "react";
import AppLayout from "../../components/AppLayout";
import CRMAgentChat from "../../components/CRMAgentChat";
import {
  fetchStaffUsers, createStaffUser, updateStaffUser,
  deactivateStaffUser, fetchDepartments,
} from "../../api/adminApi";
import { toast } from "sonner";

// ── Design atoms ──────────────────────────────────────────────────

const ROLE_META = {
  official:    { label:"Official",    color:"#6366f1", icon:"badge",             desc:"Handles complaints and assigns tasks" },
  admin:       { label:"Admin",       color:"#0ea5e9", icon:"manage_accounts",   desc:"Branch head, oversees officials" },
  super_admin: { label:"Super Admin", color:"#8b5cf6", icon:"shield_person",     desc:"City-wide commissioner" },
  worker:      { label:"Worker",      color:"#10b981", icon:"engineering",       desc:"Field worker, submits task updates" },
  contractor:  { label:"Contractor",  color:"#f97316", icon:"handshake",         desc:"External contractor firm" },
};

function RoleBadge({ role, size = "sm" }) {
  const m = ROLE_META[role];
  if (!m) return null;
  const sz = size === "xs" ? "text-[10px] px-1.5 py-0.5" : "text-xs px-2.5 py-1";
  return (
    <span className={`${sz} rounded-full font-bold capitalize inline-flex items-center gap-1`}
      style={{ background: m.color + "18", color: m.color }}>
      <span className="material-symbols-outlined text-[12px]">{m.icon}</span>
      {m.label}
    </span>
  );
}

function Avatar({ name, color }) {
  const initials = name ? name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0,2) : "?";
  return (
    <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-black flex-shrink-0"
      style={{ background: color || "#6366f1" }}>
      {initials}
    </div>
  );
}

function SkeletonRow() {
  return (
    <tr className="border-b border-slate-50">
      {[1,2,3,4,5].map(i => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 bg-slate-100 rounded animate-pulse" />
        </td>
      ))}
    </tr>
  );
}

// ── Create / Edit User Drawer ─────────────────────────────────────

function UserDrawer({ open, onClose, editUser, departments, onSuccess }) {
  const isEdit = Boolean(editUser);
  const [form, setForm] = useState({
    email:              "",
    full_name:          "",
    role:               "official",
    department_id:      "",
    jurisdiction_id:    "",
    phone:              "",
    preferred_language: "hi",
    temp_password:      "PSCrm@2025",
  });
  const [saving, setSaving] = useState(false);

  // Prefill when editing
  useEffect(() => {
    if (editUser) {
      setForm({
        email:           editUser.email || "",
        full_name:       editUser.full_name || "",
        role:            editUser.role || "official",
        department_id:   editUser.department_id || "",
        jurisdiction_id: editUser.jurisdiction_id || "",
        phone:           editUser.phone || "",
        preferred_language: editUser.preferred_language || "hi",
        temp_password:   "PSCrm@2025",
      });
    } else {
      setForm({ email:"", full_name:"", role:"official", department_id:"", jurisdiction_id:"", phone:"", preferred_language:"hi", temp_password:"PSCrm@2025" });
    }
  }, [editUser, open]);

  if (!open) return null;

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async () => {
    if (!form.full_name.trim()) { toast.error("Full name is required"); return; }
    if (!isEdit && !form.email.trim()) { toast.error("Email is required"); return; }
    if (!form.department_id && ["official","admin","worker"].includes(form.role)) {
      toast.error("Department is required for this role"); return;
    }

    setSaving(true);
    try {
      if (isEdit) {
        await updateStaffUser(editUser.id, {
          full_name:       form.full_name,
          role:            form.role,
          department_id:   form.department_id || null,
          jurisdiction_id: form.jurisdiction_id || null,
          phone:           form.phone || null,
        });
        toast.success("User updated successfully");
      } else {
        const res = await createStaffUser(form);
        toast.success(`User created! Temp password: ${res.temp_password}`);
        if (res.reset_link) {
          toast.info("Password reset link generated — share with user", { duration: 8000 });
        }
      }
      onSuccess();
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.detail || (isEdit ? "Update failed" : "Creation failed"));
    } finally {
      setSaving(false);
    }
  };

  const roleMeta = ROLE_META[form.role];

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/50 backdrop-blur-sm"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-lg bg-white flex flex-col shadow-2xl overflow-y-auto">
        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-5 border-b border-slate-100">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: (roleMeta?.color || "#6366f1") + "18" }}>
            <span className="material-symbols-outlined text-[20px]"
              style={{ color: roleMeta?.color || "#6366f1" }}>
              {isEdit ? "edit" : "person_add"}
            </span>
          </div>
          <div className="flex-1">
            <h2 className="font-black text-slate-900 text-lg">{isEdit ? "Edit User" : "Create New User"}</h2>
            <p className="text-xs text-slate-400">{isEdit ? `Editing ${editUser?.full_name}` : "Creates Firebase account + DB record"}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center">
            <span className="material-symbols-outlined text-slate-400">close</span>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 p-6 flex flex-col gap-5">
          {/* Role selection — always first */}
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-3">Role *</label>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(ROLE_META).filter(([k]) => k !== "citizen").map(([k, m]) => (
                <button key={k} type="button" onClick={() => set("role", k)}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    form.role === k ? "shadow-sm" : "border-slate-100 hover:border-slate-200"
                  }`}
                  style={{
                    borderColor: form.role === k ? m.color : undefined,
                    background:  form.role === k ? m.color + "08" : undefined,
                  }}>
                  <span className="material-symbols-outlined text-[18px] block mb-1" style={{ color: m.color }}>{m.icon}</span>
                  <p className="font-bold text-slate-800 text-xs">{m.label}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5 leading-tight">{m.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Basic info */}
          <div className="grid grid-cols-1 gap-4">
            <Field label="Full Name *" value={form.full_name} onChange={v => set("full_name", v)} placeholder="e.g. Rajesh Kumar" />

            {!isEdit && (
              <Field label="Email *" type="email" value={form.email} onChange={v => set("email", v.toLowerCase())}
                placeholder="e.g. rajesh.kumar@mcd.delhi.gov.in" />
            )}

            <Field label="Phone" type="tel" value={form.phone} onChange={v => set("phone", v)}
              placeholder="+91 98765 43210" />
          </div>

          {/* Department */}
          {["official", "admin", "super_admin", "worker"].includes(form.role) && (
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-2">
                Department {["official","admin","worker"].includes(form.role) ? "*" : ""}
              </label>
              <select value={form.department_id} onChange={e => set("department_id", e.target.value)}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-sky-200 bg-white">
                <option value="">Select department…</option>
                {departments.map(d => (
                  <option key={d.id} value={d.id}>{d.name} ({d.code})</option>
                ))}
              </select>
            </div>
          )}

          {/* Language */}
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-2">Preferred Language</label>
            <div className="flex gap-2">
              {[["hi","हिंदी"], ["en","English"]].map(([v, l]) => (
                <button key={v} type="button" onClick={() => set("preferred_language", v)}
                  className={`flex-1 py-2 rounded-xl text-sm font-bold border transition ${
                    form.preferred_language === v
                      ? "bg-sky-600 text-white border-sky-600"
                      : "bg-white text-slate-600 border-slate-200"
                  }`}>{l}</button>
              ))}
            </div>
          </div>

          {/* Temp password — only for create */}
          {!isEdit && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <p className="text-xs font-bold text-amber-700 mb-2">⚠️ Temporary Password</p>
              <Field label="" value={form.temp_password} onChange={v => set("temp_password", v)}
                placeholder="Temporary password" />
              <p className="text-[10px] text-amber-600 mt-2">
                Share this with the user. They can change it after first login.
                A password reset link is also auto-generated.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 pt-3 border-t border-slate-100">
          <button onClick={handleSubmit} disabled={saving}
            className="w-full py-3.5 rounded-xl font-black text-sm text-white disabled:opacity-40 transition"
            style={{ background: roleMeta?.color || "#6366f1" }}>
            {saving ? (isEdit ? "Updating…" : "Creating Account…") : (isEdit ? "Save Changes" : "Create User & Firebase Account")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = "text" }) {
  return (
    <div>
      {label && <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1.5">{label}</label>}
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-sky-200"
      />
    </div>
  );
}

// ── Deactivate confirm ────────────────────────────────────────────

function ConfirmModal({ open, onClose, onConfirm, name, loading }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl">
        <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
          <span className="material-symbols-outlined text-red-500 text-[24px]">person_off</span>
        </div>
        <h3 className="font-black text-slate-900 text-center text-lg mb-1">Deactivate User?</h3>
        <p className="text-sm text-slate-500 text-center mb-5">
          This will prevent <strong>{name}</strong> from logging in and disable their Firebase account.
        </p>
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 border border-slate-200 rounded-xl text-sm font-bold text-slate-600">
            Cancel
          </button>
          <button onClick={onConfirm} disabled={loading}
            className="flex-1 py-2.5 bg-red-500 text-white rounded-xl text-sm font-bold disabled:opacity-40">
            {loading ? "Deactivating…" : "Deactivate"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────

const ROLE_FILTER_OPTIONS = [
  { v:"",           l:"All Staff" },
  { v:"official",   l:"Officials" },
  { v:"admin",      l:"Admins" },
  { v:"worker",     l:"Workers" },
  { v:"contractor", l:"Contractors" },
];

export default function UserManagementPage() {
  const currentUser = JSON.parse(localStorage.getItem("auth_user") || "{}");
  const isSuperAdmin = currentUser.role === "super_admin";

  const [users,       setUsers]       = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [roleFilter,  setRoleFilter]  = useState("");
  const [search,      setSearch]      = useState("");
  const [drawerOpen,  setDrawerOpen]  = useState(false);
  const [editUser,    setEditUser]    = useState(null);
  const [deactivateTarget, setDeactivateTarget] = useState(null);
  const [deactivating, setDeactivating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (roleFilter) params.role = roleFilter;
      const [u, d] = await Promise.all([
        fetchStaffUsers(params),
        fetchDepartments(),
      ]);
      setUsers(u || []);
      setDepartments(d || []);
    } catch { toast.error("Failed to load users"); }
    finally { setLoading(false); }
  }, [roleFilter]);

  useEffect(() => { load(); }, [load]);

  const visible = users.filter(u => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      u.full_name?.toLowerCase().includes(q) ||
      u.email?.toLowerCase().includes(q) ||
      u.dept_name?.toLowerCase().includes(q) ||
      u.phone?.includes(q)
    );
  });

  const handleDeactivate = async () => {
    if (!deactivateTarget) return;
    setDeactivating(true);
    try {
      await deactivateStaffUser(deactivateTarget.id);
      toast.success(`${deactivateTarget.full_name} deactivated`);
      setDeactivateTarget(null);
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to deactivate");
    } finally {
      setDeactivating(false);
    }
  };

  const openCreate = () => { setEditUser(null); setDrawerOpen(true); };
  const openEdit   = (u)  => { setEditUser(u);  setDrawerOpen(true); };

  // Stats summary
  const stats = ROLE_FILTER_OPTIONS.slice(1).map(o => ({
    ...o,
    count: users.filter(u => u.role === o.v).length,
    color: ROLE_META[o.v]?.color || "#6366f1",
    icon:  ROLE_META[o.v]?.icon  || "person",
  }));

  return (
    <AppLayout title="User Management">
      <div className="p-4 md:p-6 flex flex-col gap-6 min-h-0">

        {/* Header */}
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black text-slate-900">User Management</h1>
            <p className="text-sm text-slate-400 mt-0.5">
              {isSuperAdmin ? "Create and manage all staff accounts" : "View staff in your department"}
            </p>
          </div>
          {isSuperAdmin && (
            <button onClick={openCreate}
              className="flex items-center gap-2 px-5 py-2.5 bg-sky-600 text-white rounded-xl text-sm font-bold hover:bg-sky-700 transition shadow-sm">
              <span className="material-symbols-outlined text-[18px]">person_add</span>
              Create User
            </button>
          )}
        </div>

        {/* Role summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {stats.map(s => (
            <button key={s.v} onClick={() => setRoleFilter(s.v === roleFilter ? "" : s.v)}
              className={`bg-white rounded-2xl p-4 border text-left transition-all hover:shadow-md ${
                roleFilter === s.v ? "ring-2 shadow-sm" : ""
              }`}
              style={{
                borderColor:  s.color + "30",
                ringColor:    s.color,
                outlineColor: roleFilter === s.v ? s.color : "transparent",
                outline:      roleFilter === s.v ? `2px solid ${s.color}` : undefined,
              }}>
              <div className="flex items-center justify-between mb-2">
                <span className="material-symbols-outlined text-[20px]" style={{ color: s.color }}>{s.icon}</span>
                <span className="text-2xl font-black" style={{ color: s.color }}>{s.count}</span>
              </div>
              <p className="text-xs font-bold text-slate-600">{s.l}</p>
            </button>
          ))}
        </div>

        {/* Search + filter bar */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[18px]">search</span>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search by name, email, department…"
              className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-sky-200" />
          </div>
          <div className="flex gap-2 flex-wrap">
            {ROLE_FILTER_OPTIONS.map(o => (
              <button key={o.v} onClick={() => setRoleFilter(o.v)}
                className={`px-3 py-2 rounded-xl text-xs font-bold border transition ${
                  roleFilter === o.v
                    ? "bg-sky-600 text-white border-sky-600"
                    : "bg-white text-slate-500 border-slate-200 hover:border-sky-300"
                }`}>{o.l}</button>
            ))}
          </div>
        </div>

        {/* User table */}
        <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
          {/* Mobile: card list */}
          <div className="block md:hidden">
            {loading ? (
              Array(4).fill(0).map((_,i) => (
                <div key={i} className="p-4 border-b border-slate-50">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-slate-100 animate-pulse" />
                    <div className="flex-1 flex flex-col gap-1.5">
                      <div className="h-3 bg-slate-100 rounded animate-pulse w-32" />
                      <div className="h-3 bg-slate-100 rounded animate-pulse w-48" />
                    </div>
                  </div>
                </div>
              ))
            ) : visible.length === 0 ? (
              <div className="text-center py-16 text-slate-400">
                <span className="material-symbols-outlined text-5xl block mb-2">group_off</span>
                <p className="text-sm">No users found</p>
              </div>
            ) : visible.map(u => (
              <MobileUserCard key={u.id} user={u} isSuperAdmin={isSuperAdmin}
                onEdit={() => openEdit(u)}
                onDeactivate={() => setDeactivateTarget(u)} />
            ))}
          </div>

          {/* Desktop: table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  {["User","Role","Department","Contact","Status","Actions"].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {loading ? (
                  Array(6).fill(0).map((_,i) => <SkeletonRow key={i} />)
                ) : visible.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-16 text-slate-400">
                      <span className="material-symbols-outlined text-5xl block mb-2">group_off</span>
                      No users found
                    </td>
                  </tr>
                ) : visible.map(u => (
                  <UserRow key={u.id} user={u} isSuperAdmin={isSuperAdmin}
                    onEdit={() => openEdit(u)}
                    onDeactivate={() => setDeactivateTarget(u)} />
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Count */}
        {!loading && (
          <p className="text-xs text-slate-400 text-center">
            {visible.length} of {users.length} staff members shown
          </p>
        )}
      </div>

      {/* Drawers & Modals */}
      <UserDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        editUser={editUser}
        departments={departments}
        onSuccess={load}
      />

      <ConfirmModal
        open={Boolean(deactivateTarget)}
        onClose={() => setDeactivateTarget(null)}
        onConfirm={handleDeactivate}
        name={deactivateTarget?.full_name}
        loading={deactivating}
      />

      <CRMAgentChat />
    </AppLayout>
  );
}

// ── Desktop row ───────────────────────────────────────────────────

function UserRow({ user, isSuperAdmin, onEdit, onDeactivate }) {
  const m = ROLE_META[user.role];
  return (
    <tr className="hover:bg-slate-50 transition-colors group">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <Avatar name={user.full_name} color={m?.color} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-bold text-slate-800 text-sm">{user.full_name}</p>
              {!user.has_firebase_auth && (
                <span className="text-[10px] text-amber-500 font-bold bg-amber-50 px-1.5 py-0.5 rounded">No Firebase</span>
              )}
            </div>
            <p className="text-xs text-slate-400 truncate max-w-[180px]">{user.email}</p>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <RoleBadge role={user.role} size="xs" />
      </td>
      <td className="px-4 py-3">
        <p className="text-sm text-slate-700">{user.dept_name || "—"}</p>
        <p className="text-[10px] text-slate-400">{user.jurisdiction_name || ""}</p>
      </td>
      <td className="px-4 py-3">
        <p className="text-sm text-slate-600">{user.phone || "—"}</p>
        {user.worker_score && (
          <div className="flex items-center gap-1 mt-0.5">
            <span className="text-amber-400 text-[11px]">★</span>
            <span className="text-[11px] text-slate-500">{user.worker_score.toFixed(1)}</span>
            {user.current_task_count > 0 && (
              <span className="text-[10px] text-sky-500 ml-1">{user.current_task_count} tasks</span>
            )}
          </div>
        )}
      </td>
      <td className="px-4 py-3">
        <span className={`text-xs font-bold px-2 py-1 rounded-full ${
          user.is_active
            ? "bg-green-50 text-green-600"
            : "bg-red-50 text-red-500"
        }`}>
          {user.is_active ? "Active" : "Inactive"}
        </span>
      </td>
      <td className="px-4 py-3">
        {isSuperAdmin && (
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={onEdit}
              className="p-1.5 hover:bg-sky-50 rounded-lg text-sky-600 transition">
              <span className="material-symbols-outlined text-[18px]">edit</span>
            </button>
            {user.is_active && (
              <button onClick={onDeactivate}
                className="p-1.5 hover:bg-red-50 rounded-lg text-red-500 transition">
                <span className="material-symbols-outlined text-[18px]">person_off</span>
              </button>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}

// ── Mobile card ───────────────────────────────────────────────────

function MobileUserCard({ user, isSuperAdmin, onEdit, onDeactivate }) {
  const m = ROLE_META[user.role];
  return (
    <div className="p-4 border-b border-slate-50 last:border-0">
      <div className="flex items-start gap-3">
        <Avatar name={user.full_name} color={m?.color} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <p className="font-bold text-slate-800 text-sm">{user.full_name}</p>
            <RoleBadge role={user.role} size="xs" />
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
              user.is_active ? "bg-green-50 text-green-600" : "bg-red-50 text-red-500"
            }`}>{user.is_active ? "Active" : "Inactive"}</span>
          </div>
          <p className="text-xs text-slate-400">{user.email}</p>
          <p className="text-xs text-slate-500 mt-0.5">{user.dept_name || "No department"}</p>
          {user.phone && <p className="text-xs text-slate-400">{user.phone}</p>}
        </div>
        {isSuperAdmin && (
          <div className="flex items-center gap-1 flex-shrink-0">
            <button onClick={onEdit} className="p-2 hover:bg-sky-50 rounded-xl text-sky-600">
              <span className="material-symbols-outlined text-[18px]">edit</span>
            </button>
            {user.is_active && (
              <button onClick={onDeactivate} className="p-2 hover:bg-red-50 rounded-xl text-red-500">
                <span className="material-symbols-outlined text-[18px]">person_off</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}