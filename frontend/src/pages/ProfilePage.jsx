import { useEffect, useState } from "react";
import AppLayout from "../components/AppLayout";
import { getMe, updateMe } from "../api/authApi";
import { fetchMyStats } from "../api/complaintsApi";

const LANGUAGE_OPTIONS = [
  { code: "en", label: "English" },
  { code: "hi", label: "Hindi (हिन्दी)" },
  { code: "pa", label: "Punjabi (ਪੰਜਾਬੀ)" },
  { code: "ur", label: "Urdu (اردو)" },
  { code: "ta", label: "Tamil (தமிழ்)" },
  { code: "te", label: "Telugu (తెలుగు)" },
  { code: "mr", label: "Marathi (मराठी)" },
  { code: "bn", label: "Bengali (বাংলা)" },
];

const ROLE_LABEL = {
  citizen:     "Citizen",
  admin:       "Admin",
  super_admin: "Super Admin",
  official:    "Official",
  worker:      "Worker",
  contractor:  "Contractor",
};

const ROLE_COLOR = {
  citizen:     { bg: "rgba(56,189,248,0.15)",  color: "#38bdf8" },
  admin:       { bg: "rgba(129,140,248,0.15)", color: "#818cf8" },
  super_admin: { bg: "rgba(251,146,60,0.15)",  color: "#fb923c" },
  official:    { bg: "rgba(99,102,241,0.15)",  color: "#818cf8" },
  worker:      { bg: "rgba(52,211,153,0.15)",  color: "#34d399" },
  contractor:  { bg: "rgba(251,191,36,0.15)",  color: "#fbbf24" },
};

export default function ProfilePage() {
  const [form, setForm] = useState({
    full_name: "", email: "", phone: "", role: "citizen",
    preferred_language: "hi", email_opt_in: true, twilio_opt_in: true,
  });
  const [stats, setStats]           = useState(null);
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);
  const [saveError, setSaveError]   = useState("");

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [user, statsRes] = await Promise.all([getMe(), fetchMyStats()]);
        setForm({
          full_name: user.full_name || "",
          email: user.email || "",
          phone: user.phone || "",
          role: user.role || "citizen",
          preferred_language: user.preferred_language || "hi",
          email_opt_in: user.email_opt_in ?? true,
          twilio_opt_in: user.twilio_opt_in ?? true,
        });
        setStats(statsRes);
        const stored = JSON.parse(localStorage.getItem("auth_user") || "{}");
        localStorage.setItem("auth_user", JSON.stringify({ ...stored, ...user }));
      } catch {
        const stored = JSON.parse(localStorage.getItem("auth_user") || "{}");
        setForm(f => ({
          ...f,
          full_name: stored.full_name || "",
          email: stored.email || "",
          phone: stored.phone || "",
          role: stored.role || "citizen",
          preferred_language: stored.preferred_language || "hi",
          email_opt_in: stored.email_opt_in ?? true,
          twilio_opt_in: stored.twilio_opt_in ?? true,
        }));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setSaveStatus(null);
    setSaveError("");
    try {
      const updated = await updateMe({
        full_name: form.full_name,
        phone: form.phone || null,
        preferred_language: form.preferred_language,
        email_opt_in: form.email_opt_in,
        twilio_opt_in: form.twilio_opt_in,
      });
      const stored = JSON.parse(localStorage.getItem("auth_user") || "{}");
      localStorage.setItem("auth_user", JSON.stringify({ ...stored, ...updated }));
      setSaveStatus("success");
      setTimeout(() => setSaveStatus(null), 3000);
    } catch (e) {
      setSaveStatus("error");
      setSaveError(e.response?.data?.detail || "Failed to save changes");
    } finally {
      setSaving(false);
    }
  }

  const initials = form.full_name
    ? form.full_name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()
    : "?";

  const roleStyle = ROLE_COLOR[form.role] || { bg: "rgba(0,0,0,0.06)", color: "#64748b" };

  return (
    <AppLayout>
      <div className="p-6 max-w-3xl mx-auto flex flex-col gap-6">
        {/* Avatar Card */}
        <div className="gcard p-6 flex items-center gap-5"
          style={{ background: "linear-gradient(135deg, rgba(56,189,248,0.08), rgba(129,140,248,0.05))" }}>
          <div className="w-20 h-20 rounded-2xl flex items-center justify-center text-2xl font-bold text-white shrink-0"
            style={{ background: "linear-gradient(135deg,#38bdf8,#818cf8)", boxShadow: "0 0 24px rgba(56,189,248,0.3)" }}>
            {loading ? "…" : initials}
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">{loading ? "Loading…" : form.full_name || "—"}</h1>
            <p className="text-sm text-slate-400">{form.email}</p>
            <span className="mt-2 inline-block text-xs font-semibold px-2.5 py-0.5 rounded-full capitalize"
              style={{ background: roleStyle.bg, color: roleStyle.color }}>
              {ROLE_LABEL[form.role] || form.role}
            </span>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[
            { label: "Total Complaints", value: stats?.total_count,    icon: "receipt_long", color: "#38bdf8" },
            { label: "Active",           value: stats?.active_count,   icon: "pending",       color: "#fb923c" },
            { label: "Resolved",         value: stats?.resolved_count, icon: "check_circle",  color: "#34d399" },
          ].map((s) => (
            <div key={s.label} className="gcard p-4 flex items-center gap-3">
              <span className="material-symbols-outlined text-[22px]" style={{ color: s.color }}>{s.icon}</span>
              <div>
                <p className="text-xl font-bold text-slate-800">{loading ? "…" : (s.value ?? "—")}</p>
                <p className="text-xs text-slate-500">{s.label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Edit Form */}
        <form onSubmit={handleSave} className="gcard p-6 flex flex-col gap-5">
          <h2 className="font-semibold text-slate-800 flex items-center gap-2">
            <span className="material-symbols-outlined text-[20px] text-sky-400">edit</span>
            Personal Information
          </h2>

          <div className="grid sm:grid-cols-2 gap-4">
            {[
              { label: "Full Name", key: "full_name", type: "text", placeholder: "Your full name", disabled: false },
              { label: "Email",     key: "email",     type: "email", placeholder: "",               disabled: true },
              { label: "Phone",     key: "phone",     type: "tel",   placeholder: "+91 xxxxxxxxxx", disabled: false },
            ].map(f => (
              <div key={f.key} className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{f.label}</label>
                <input
                  type={f.type}
                  value={form[f.key]}
                  onChange={e => !f.disabled && setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                  disabled={f.disabled}
                  placeholder={f.placeholder}
                  className="ginput px-3 py-2.5 rounded-xl text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                />
              </div>
            ))}

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Preferred Language</label>
              <select
                value={form.preferred_language}
                onChange={e => setForm(prev => ({ ...prev, preferred_language: e.target.value }))}
                className="ginput px-3 py-2.5 rounded-xl text-sm">
                {LANGUAGE_OPTIONS.map(l => (
                  <option key={l.code} value={l.code}>{l.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Notification prefs */}
          <div className="pt-4" style={{ borderTop: "1px solid rgba(0,0,0,0.06)" }}>
            <h3 className="font-semibold text-sm text-slate-800 mb-4">Notification Preferences</h3>
            <div className="flex flex-col gap-4">
              {[
                { key: "email_opt_in",   label: "Email Notifications",            icon: "email" },
                { key: "twilio_opt_in",  label: "WhatsApp / SMS Notifications",   icon: "chat" },
              ].map(pref => (
                <div key={pref.key} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[18px] text-slate-500">{pref.icon}</span>
                    <span className="text-sm text-slate-600">{pref.label}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, [pref.key]: !f[pref.key] }))}
                    className="w-11 h-6 rounded-full relative transition-colors"
                    style={{ background: form[pref.key] ? "#38bdf8" : "rgba(0,0,0,0.12)" }}>
                    <span
                      className="block w-4 h-4 rounded-full bg-white absolute top-1 transition-all"
                      style={{ left: form[pref.key] ? 24 : 4 }} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Save feedback */}
          {saveStatus === "success" && (
            <div className="rounded-xl p-3 text-sm flex items-center gap-2"
              style={{ background: "rgba(52,211,153,0.12)", border: "1px solid rgba(52,211,153,0.25)", color: "#34d399" }}>
              <span className="material-symbols-outlined text-[18px]">check_circle</span>
              Profile saved successfully!
            </div>
          )}
          {saveStatus === "error" && (
            <div className="rounded-xl p-3 text-sm flex items-center gap-2"
              style={{ background: "rgba(248,113,113,0.12)", border: "1px solid rgba(248,113,113,0.25)", color: "#f87171" }}>
              <span className="material-symbols-outlined text-[18px]">error</span>
              {saveError}
            </div>
          )}

          <button
            type="submit"
            disabled={saving || loading}
            className="self-start gbtn-sky px-6 py-2.5 rounded-full text-sm font-semibold text-white disabled:opacity-50 flex items-center gap-2">
            {saving ? (
              <>
                <span className="material-symbols-outlined animate-spin text-[16px]">progress_activity</span>
                Saving…
              </>
            ) : "Save Changes"}
          </button>
        </form>
      </div>
    </AppLayout>
  );
}
