import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { signup } from "../api/authApi";
import { toast } from "sonner";

export default function SignupPage() {
  const navigate = useNavigate();
  const [fullName, setFullName] = useState("");
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [cityCode, setCityCode] = useState("DEL");
  const [loading, setLoading]   = useState(false);
  const [showPass, setShowPass] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const data = await signup({
        full_name: fullName,
        email,
        password,
        city_code: cityCode,
        preferred_language: "hi",
      });
      localStorage.setItem("auth_user", JSON.stringify(data));
      navigate("/submit");
    } catch (err) {
      if (err.code === "auth/email-already-in-use") {
        toast.error("This email is already registered. Please sign in.");
      } else if (err.code === "auth/weak-password") {
        toast.error("Password must be at least 6 characters.");
      } else if (err.code === "auth/invalid-email") {
        toast.error("Please enter a valid email address.");
      } else {
        toast.error(err.response?.data?.detail || err.message || "Signup failed.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      {/* Ambient glows */}
      <div className="absolute top-1/4 left-1/3 w-96 h-96 rounded-full pointer-events-none"
        style={{ background: "radial-gradient(circle, rgba(56,189,248,0.08) 0%, transparent 70%)" }} />
      <div className="absolute bottom-1/4 right-1/3 w-80 h-80 rounded-full pointer-events-none"
        style={{ background: "radial-gradient(circle, rgba(129,140,248,0.08) 0%, transparent 70%)" }} />

      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4"
            style={{ background: "linear-gradient(135deg,rgba(56,189,248,0.2),rgba(129,140,248,0.15))", border: "1px solid rgba(56,189,248,0.25)" }}>
            <span className="material-symbols-outlined text-[28px] text-sky-400">location_city</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-800">PS-CRM Delhi</h1>
          <p className="text-slate-400 text-sm mt-1">Public Service Command Center</p>
        </div>

        {/* Card */}
        <div className="gcard p-8">
          <h2 className="text-xl font-bold text-slate-800 mb-1">Create account</h2>
          <p className="text-slate-400 text-sm mb-6">Join Delhi's civic grievance network</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Full Name */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Full Name</label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                placeholder="Rahul Kumar"
                className="w-full px-4 py-2.5 rounded-xl text-sm ginput"
              />
            </div>

            {/* Email */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="you@ndmc.gov.in"
                className="w-full px-4 py-2.5 rounded-xl text-sm ginput"
              />
            </div>

            {/* City Code */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">City Code</label>
              <input
                value={cityCode}
                onChange={(e) => setCityCode(e.target.value.toUpperCase())}
                required
                placeholder="DEL"
                className="w-full px-4 py-2.5 rounded-xl text-sm ginput"
              />
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Password</label>
              <div className="relative">
                <input
                  type={showPass ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  placeholder="Min 8 characters"
                  className="w-full px-4 py-2.5 pr-12 rounded-xl text-sm ginput"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-700 transition-colors"
                >
                  <span className="material-symbols-outlined text-[18px]">
                    {showPass ? "visibility_off" : "visibility"}
                  </span>
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-xl text-sm font-semibold text-white gbtn-sky disabled:opacity-50 disabled:cursor-not-allowed mt-2"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>
                  Creating account…
                </span>
              ) : "Create Account"}
            </button>
          </form>

          <p className="text-center text-sm text-slate-500 mt-5">
            Already have an account?{" "}
            <Link to="/login" className="text-sky-400 hover:text-sky-300 font-medium transition-colors">
              Sign in
            </Link>
          </p>
        </div>

        {/* Stats strip */}
        <div className="grid grid-cols-2 gap-3 mt-4">
          {[
            { icon: "check_circle", label: "Resolved Cases", value: "12,400+" },
            { icon: "speed",        label: "Avg SLA",         value: "41 Days" },
          ].map(s => (
            <div key={s.label} className="rounded-2xl p-4 flex items-center gap-3"
              style={{ background: "rgba(255,255,255,0.7)", border: "1px solid rgba(0,0,0,0.08)" }}>
              <span className="material-symbols-outlined text-sky-400 text-[20px]">{s.icon}</span>
              <div>
                <p className="text-sm font-bold text-slate-800">{s.value}</p>
                <p className="text-[11px] text-slate-500">{s.label}</p>
              </div>
            </div>
          ))}
        </div>

        <p className="text-center text-xs text-slate-700 mt-6">
          © 2025 NDMC · Delhi Municipal CRM
        </p>
      </div>
    </main>
  );
}
