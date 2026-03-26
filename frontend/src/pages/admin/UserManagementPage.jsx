// src/pages/admin/UserManagementPage.jsx
// Super Admin — create and manage officials, workers, admins, contractors.

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
      style={{ background: m.color + "22", color: m.color }}>
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
    <tr style={{ borderBottom: "1px solid rgba(0,0,0,0.05)" }}>
      {[1,2,3,4,5].map(i => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 rounded animate-pulse" style={{ background: "rgba(0,0,0,0.06)" }} />
        </td>
      ))}
    </tr>
  );
}

// ── Field ─────────────────────────────────────────────────────────

function Field({ label, value, onChange, placeholder, type = "text" }) {
  return (
    <div>
      {label && (
        <label className="text-xs font-bold uppercase tracking-wider block mb-1.5"
          style={{ color: "#475569" }}>{label}</label>
      )}
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="ginput w-full px-3 py-2.5 rounded-xl text-sm"
      />
    </div>
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
        if (res.reset_link) toast.info("Password reset link generated — share with user", { duration: 8000 });
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
    <div className="fixed inset-0 z-50 flex items-stretch justify-end"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-lg flex flex-col overflow-y-auto"
        style={{ background: "rgba(255,255,255,0.97)", backdropFilter: "blur(24px)", borderLeft: "1px solid rgba(0,0,0,0.08)", boxShadow: "-20px 0 60px rgba(0,0,0,0.1)" }}>

        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-5"
          style={{ borderBottom: "1px solid rgba(0,0,0,0.08)" }}>
          <div className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: (roleMeta?.color || "#6366f1") + "22" }}>
            <span className="material-symbols-outlined text-[20px]"
              style={{ color: roleMeta?.color || "#6366f1" }}>
              {isEdit ? "edit" : "person_add"}
            </span>
          </div>
          <div className="flex-1">
            <h2 className="font-black text-slate-800 text-lg">{isEdit ? "Edit User" : "Create New User"}</h2>
            <p className="text-xs text-slate-500">{isEdit ? `Editing ${editUser?.full_name}` : "Creates Firebase account + DB record"}</p>
          </div>
          <button onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center transition-colors"
            style={{ background: "rgba(0,0,0,0.05)" }}
            onMouseEnter={e => e.currentTarget.style.background = "rgba(0,0,0,0.1)"}
            onMouseLeave={e => e.currentTarget.style.background = "rgba(0,0,0,0.05)"}>
            <span className="material-symbols-outlined text-slate-400 text-[18px]">close</span>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 p-6 flex flex-col gap-5">
          {/* Role selection */}
          <div>
            <label className="text-xs font-bold uppercase tracking-wider block mb-3"
              style={{ color: "#475569" }}>Role *</label>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(ROLE_META).map(([k, m]) => (
                <button key={k} type="button" onClick={() => set("role", k)}
                  className="p-3 rounded-xl text-left transition-all"
                  style={{
                    background:  form.role === k ? m.color + "15" : "rgba(0,0,0,0.04)",
                    border:      `1px solid ${form.role === k ? m.color + "50" : "rgba(0,0,0,0.08)"}`,
                  }}>
                  <span className="material-symbols-outlined text-[18px] block mb-1" style={{ color: m.color }}>{m.icon}</span>
                  <p className="font-bold text-sm" style={{ color: form.role === k ? "#1e293b" : "#64748b" }}>{m.label}</p>
                  <p className="text-[10px] mt-0.5 leading-tight text-slate-600">{m.desc}</p>
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
              <label className="text-xs font-bold uppercase tracking-wider block mb-2"
                style={{ color: "#475569" }}>
                Department {["official","admin","worker"].includes(form.role) ? "*" : ""}
              </label>
              <select value={form.department_id} onChange={e => set("department_id", e.target.value)}
                className="ginput w-full px-3 py-2.5 rounded-xl text-sm">
                <option value="">Select department…</option>
                {departments.map(d => (
                  <option key={d.id} value={d.id}>{d.name} ({d.code})</option>
                ))}
              </select>
            </div>
          )}

          {/* Language */}
          <div>
            <label className="text-xs font-bold uppercase tracking-wider block mb-2"
              style={{ color: "#475569" }}>Preferred Language</label>
            <div className="flex gap-2">
              {[["hi","हिंदी"], ["en","English"]].map(([v, l]) => (
                <button key={v} type="button" onClick={() => set("preferred_language", v)}
                  className="flex-1 py-2 rounded-xl text-sm font-bold transition-all"
                  style={{
                    background: form.preferred_language === v ? "rgba(56,189,248,0.15)" : "rgba(0,0,0,0.04)",
                    border:     `1px solid ${form.preferred_language === v ? "rgba(56,189,248,0.4)" : "rgba(0,0,0,0.08)"}`,
                    color:      form.preferred_language === v ? "#38bdf8" : "#64748b",
                  }}>{l}</button>
              ))}
            </div>
          </div>

          {/* Temp password */}
          {!isEdit && (
            <div className="rounded-xl p-4"
              style={{ background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.2)" }}>
              <p className="text-xs font-bold text-amber-400 mb-2">Temporary Password</p>
              <Field label="" value={form.temp_password} onChange={v => set("temp_password", v)}
                placeholder="Temporary password" />
              <p className="text-[10px] text-amber-600/80 mt-2">
                Share this with the user. They can change it after first login.
                A password reset link is also auto-generated.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 pt-3" style={{ borderTop: "1px solid rgba(0,0,0,0.06)" }}>
          <button onClick={handleSubmit} disabled={saving}
            className="w-full py-3.5 rounded-xl font-black text-sm text-white disabled:opacity-40 transition-all"
            style={{ background: roleMeta?.color || "#6366f1" }}>
            {saving ? (isEdit ? "Updating…" : "Creating Account…") : (isEdit ? "Save Changes" : "Create User & Firebase Account")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Deactivate confirm ────────────────────────────────────────────

function ConfirmModal({ open, onClose, onConfirm, name, loading }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-sm rounded-2xl p-6"
        style={{ background: "rgba(255,255,255,0.97)", border: "1px solid rgba(0,0,0,0.08)", boxShadow: "0 20px 60px rgba(0,0,0,0.15)" }}>
        <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4"
          style={{ background: "rgba(239,68,68,0.15)" }}>
          <span className="material-symbols-outlined text-red-400 text-[24px]">person_off</span>
        </div>
        <h3 className="font-black text-slate-800 text-center text-lg mb-1">Deactivate User?</h3>
        <p className="text-sm text-slate-600 text-center mb-5">
          This will prevent <strong className="text-slate-800">{name}</strong> from logging in and disable their Firebase account.
        </p>
        <div className="flex gap-3">
          <button onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-sm font-bold text-slate-600 transition-colors"
            style={{ border: "1px solid rgba(0,0,0,0.1)" }}
            onMouseEnter={e => e.currentTarget.style.background = "rgba(0,0,0,0.04)"}
            onMouseLeave={e => e.currentTarget.style.background = ""}>
            Cancel
          </button>
          <button onClick={onConfirm} disabled={loading}
            className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-40"
            style={{ background: "rgba(239,68,68,0.8)" }}>
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
      const [u, d] = await Promise.all([fetchStaffUsers(params), fetchDepartments()]);
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
            <h1 className="text-2xl font-black text-slate-800">User Management</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              {isSuperAdmin ? "Create and manage all staff accounts" : "View staff in your department"}
            </p>
          </div>
          {isSuperAdmin && (
            <button onClick={openCreate} className="gbtn-sky flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold">
              <span className="material-symbols-outlined text-[18px]">person_add</span>
              Create User
            </button>
          )}
        </div>

        {/* Role summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {stats.map(s => (
            <button key={s.v} onClick={() => setRoleFilter(s.v === roleFilter ? "" : s.v)}
              className="rounded-2xl p-4 text-left transition-all"
              style={{
                background:  roleFilter === s.v ? s.color + "18" : "rgba(255,255,255,0.7)",
                border:      `1px solid ${roleFilter === s.v ? s.color + "40" : "rgba(0,0,0,0.08)"}`,
                backdropFilter: "blur(20px)",
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
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-[18px]">search</span>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search by name, email, department…"
              className="ginput w-full pl-10 pr-4 py-2.5 rounded-xl text-sm" />
          </div>
          <div className="flex gap-2 flex-wrap">
            {ROLE_FILTER_OPTIONS.map(o => (
              <button key={o.v} onClick={() => setRoleFilter(o.v)}
                className="px-3 py-2 rounded-xl text-xs font-bold transition-all"
                style={{
                  background: roleFilter === o.v ? "rgba(56,189,248,0.15)" : "rgba(0,0,0,0.04)",
                  border:     `1px solid ${roleFilter === o.v ? "rgba(56,189,248,0.4)" : "rgba(0,0,0,0.08)"}`,
                  color:      roleFilter === o.v ? "#38bdf8" : "#64748b",
                }}>{o.l}</button>
            ))}
          </div>
        </div>

        {/* User table */}
        <div className="rounded-2xl overflow-hidden"
          style={{ background: "rgba(255,255,255,0.7)", border: "1px solid rgba(0,0,0,0.08)" }}>

          {/* Mobile: card list */}
          <div className="block md:hidden">
            {loading ? (
              Array(4).fill(0).map((_,i) => (
                <div key={i} className="p-4" style={{ borderBottom: "1px solid rgba(0,0,0,0.05)" }}>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full animate-pulse" style={{ background: "rgba(0,0,0,0.06)" }} />
                    <div className="flex-1 flex flex-col gap-1.5">
                      <div className="h-3 rounded animate-pulse w-32" style={{ background: "rgba(0,0,0,0.06)" }} />
                      <div className="h-3 rounded animate-pulse w-48" style={{ background: "rgba(0,0,0,0.04)" }} />
                    </div>
                  </div>
                </div>
              ))
            ) : visible.length === 0 ? (
              <div className="text-center py-16 text-slate-600">
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
              <thead>
                <tr style={{ background: "rgba(0,0,0,0.04)", borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
                  {["User","Role","Department","Contact","Status","Actions"].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider"
                      style={{ color: "#475569" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array(6).fill(0).map((_,i) => <SkeletonRow key={i} />)
                ) : visible.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-16" style={{ color: "#475569" }}>
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

        {!loading && (
          <p className="text-xs text-slate-600 text-center">
            {visible.length} of {users.length} staff members shown
          </p>
        )}
      </div>

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
    <tr className="group transition-colors"
      style={{ borderBottom: "1px solid rgba(0,0,0,0.05)" }}
      onMouseEnter={e => e.currentTarget.style.background = "rgba(0,0,0,0.03)"}
      onMouseLeave={e => e.currentTarget.style.background = ""}>
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <Avatar name={user.full_name} color={m?.color} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-bold text-slate-800 text-sm">{user.full_name}</p>
              {!user.has_firebase_auth && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                  style={{ background: "rgba(251,191,36,0.15)", color: "#fbbf24" }}>No Firebase</span>
              )}
            </div>
            <p className="text-xs text-slate-500 truncate max-w-[180px]">{user.email}</p>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <RoleBadge role={user.role} size="xs" />
      </td>
      <td className="px-4 py-3">
        <p className="text-sm text-slate-600">{user.dept_name || "—"}</p>
        <p className="text-[10px] text-slate-500">{user.jurisdiction_name || ""}</p>
      </td>
      <td className="px-4 py-3">
        <p className="text-sm text-slate-500">{user.phone || "—"}</p>
        {user.worker_score && (
          <div className="flex items-center gap-1 mt-0.5">
            <span className="text-amber-400 text-[11px]">★</span>
            <span className="text-[11px] text-slate-500">{user.worker_score.toFixed(1)}</span>
            {user.current_task_count > 0 && (
              <span className="text-[10px] text-sky-400 ml-1">{user.current_task_count} tasks</span>
            )}
          </div>
        )}
      </td>
      <td className="px-4 py-3">
        <span className="text-xs font-bold px-2 py-1 rounded-full"
          style={user.is_active
            ? { background: "rgba(52,211,153,0.15)", color: "#34d399" }
            : { background: "rgba(239,68,68,0.15)",  color: "#f87171" }}>
          {user.is_active ? "Active" : "Inactive"}
        </span>
      </td>
      <td className="px-4 py-3">
        {isSuperAdmin && (
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={onEdit}
              className="p-1.5 rounded-lg transition-colors"
              style={{ color: "#38bdf8" }}
              onMouseEnter={e => e.currentTarget.style.background = "rgba(56,189,248,0.12)"}
              onMouseLeave={e => e.currentTarget.style.background = ""}>
              <span className="material-symbols-outlined text-[18px]">edit</span>
            </button>
            {user.is_active && (
              <button onClick={onDeactivate}
                className="p-1.5 rounded-lg transition-colors"
                style={{ color: "#f87171" }}
                onMouseEnter={e => e.currentTarget.style.background = "rgba(239,68,68,0.12)"}
                onMouseLeave={e => e.currentTarget.style.background = ""}>
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
    <div className="p-4" style={{ borderBottom: "1px solid rgba(0,0,0,0.05)" }}>
      <div className="flex items-start gap-3">
        <Avatar name={user.full_name} color={m?.color} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <p className="font-bold text-slate-800 text-sm">{user.full_name}</p>
            <RoleBadge role={user.role} size="xs" />
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
              style={user.is_active
                ? { background: "rgba(52,211,153,0.15)", color: "#34d399" }
                : { background: "rgba(239,68,68,0.15)",  color: "#f87171" }}>
              {user.is_active ? "Active" : "Inactive"}
            </span>
          </div>
          <p className="text-xs text-slate-500">{user.email}</p>
          <p className="text-xs text-slate-600 mt-0.5">{user.dept_name || "No department"}</p>
          {user.phone && <p className="text-xs text-slate-500">{user.phone}</p>}
        </div>
        {isSuperAdmin && (
          <div className="flex items-center gap-1 flex-shrink-0">
            <button onClick={onEdit}
              className="p-2 rounded-xl transition-colors"
              onMouseEnter={e => e.currentTarget.style.background = "rgba(56,189,248,0.12)"}
              onMouseLeave={e => e.currentTarget.style.background = ""}>
              <span className="material-symbols-outlined text-[18px] text-sky-400">edit</span>
            </button>
            {user.is_active && (
              <button onClick={onDeactivate}
                className="p-2 rounded-xl transition-colors"
                onMouseEnter={e => e.currentTarget.style.background = "rgba(239,68,68,0.12)"}
                onMouseLeave={e => e.currentTarget.style.background = ""}>
                <span className="material-symbols-outlined text-[18px] text-red-400">person_off</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
