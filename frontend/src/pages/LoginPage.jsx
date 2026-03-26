import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { login } from "../api/authApi";
import { toast } from "sonner";

export default function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail]     = useState("");
  const [pass,  setPass]      = useState("");
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const data = await login(email, pass);
      localStorage.setItem("auth_user", JSON.stringify(data));
      navigate("/dashboard");
    } catch (err) {
      if (err.code === "auth/invalid-credential" || err.code === "auth/user-not-found" || err.code === "auth/wrong-password") {
        toast.error("Invalid email or password.");
      } else if (err.code === "auth/too-many-requests") {
        toast.error("Too many attempts. Try again later.");
      } else if (err.response?.status === 403) {
        toast.error("Account deactivated.");
      } else {
        toast.error(err.response?.data?.detail || err.message || "Login failed.");
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
          <h2 className="text-xl font-bold text-slate-800 mb-1">Welcome back</h2>
          <p className="text-slate-400 text-sm mb-6">Sign in to your account</p>

          <form onSubmit={handleSubmit} className="space-y-4">
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

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Password</label>
              <div className="relative">
                <input
                  type={showPass ? "text" : "password"}
                  value={pass}
                  onChange={(e) => setPass(e.target.value)}
                  required
                  placeholder="••••••••"
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
                  Signing in…
                </span>
              ) : "Sign In"}
            </button>
          </form>

          <p className="text-center text-sm text-slate-500 mt-5">
            No account?{" "}
            <Link to="/signup" className="text-sky-400 hover:text-sky-300 font-medium transition-colors">
              Create one
            </Link>
          </p>
        </div>

        <p className="text-center text-xs text-slate-700 mt-6">
          © 2025 NDMC · Delhi Municipal CRM
        </p>
      </div>
    </main>
  );
}
