import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { login } from "../api/authApi";
import { toast } from "sonner";

export default function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading]   = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const data = await login(email, password);
      localStorage.setItem("auth_user", JSON.stringify(data));
      navigate("/dashboard");
    } catch (err) {
      if (
        err.code === "auth/invalid-credential" ||
        err.code === "auth/user-not-found"     ||
        err.code === "auth/wrong-password"
      ) {
        toast.error("Invalid email or password.");
      } else if (err.code === "auth/too-many-requests") {
        toast.error("Too many failed attempts. Try again later.");
      } else if (err.response?.status === 403) {
        toast.error("Your account has been deactivated.");
      } else {
        toast.error(err.response?.data?.detail || err.message || "Login failed.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex flex-col md:flex-row bg-surface font-body text-on-surface">
      {/* LEFT: Form */}
      <section className="w-full md:w-[55%] bg-surface-container-lowest flex flex-col p-8 md:p-16">
        <div className="flex items-center gap-1.5 mb-16">
          <span className="font-headline font-extrabold text-[20px] text-on-background tracking-tight">
            PS-CRM
          </span>
          <div className="w-1.5 h-1.5 rounded-full bg-primary-container" />
        </div>

        <div className="max-w-[400px] w-full mx-auto my-auto">
          <header className="mb-10">
            <h1 className="font-headline font-bold text-[32px] text-on-background leading-tight mb-3">
              Welcome back
            </h1>
            <p className="text-[16px] text-on-surface-variant">
              Sign in to track your civic grievances
            </p>
          </header>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <label className="block text-[13px] font-semibold text-on-surface-variant uppercase tracking-wider">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full h-12 bg-transparent border-0 border-b border-outline-variant/30 focus:ring-0 focus:border-primary transition-all duration-300 px-4 text-[16px] placeholder:text-outline/50"
                placeholder="you@example.com"
              />
            </div>

            <div className="space-y-2">
              <label className="block text-[13px] font-semibold text-on-surface-variant uppercase tracking-wider">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full h-12 bg-transparent border-0 border-b border-outline-variant/30 focus:ring-0 focus:border-primary transition-all duration-300 px-4 text-[16px] placeholder:text-outline/50"
                placeholder="Your password"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full h-12 bg-primary-container hover:bg-primary transition-all duration-200 rounded-lg flex items-center justify-center gap-2 text-on-primary-container hover:text-on-primary font-bold group disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span>{loading ? "Signing in..." : "Sign In"}</span>
              {!loading && (
                <span className="material-symbols-outlined text-sm group-hover:translate-x-1 transition-transform">
                  arrow_forward
                </span>
              )}
            </button>
          </form>

          <p className="text-center text-sm text-on-surface-variant mt-6">
            New here?{" "}
            <Link to="/signup" className="text-primary font-semibold hover:underline">
              Create account
            </Link>
          </p>

          <footer className="mt-16 flex items-center gap-2 text-[12px] text-outline/60 font-medium">
            <span className="material-symbols-outlined text-[14px]">verified_user</span>
            <span>Secured by Firebase · Delhi Municipal Services</span>
          </footer>
        </div>
      </section>

      {/* RIGHT: Visual */}
      <section className="hidden md:flex md:w-[45%] bg-[#f0f9ff] relative overflow-hidden flex-col items-center justify-center p-12">
        <div className="relative z-10 w-full max-w-md flex flex-col items-center text-center">
          <div className="w-full flex items-center justify-center opacity-40 mb-12">
            <span className="material-symbols-outlined text-primary text-[120px]">
              location_city
            </span>
          </div>
          <h2 className="font-headline font-bold text-[28px] text-on-background mb-2">PS-CRM</h2>
          <p className="text-[14px] text-primary font-medium tracking-wide mb-10">
            Smart Civic Intelligence for Delhi
          </p>
          <div className="grid grid-cols-1 gap-4 w-full">
            {[
              { label: "Resolved Cases", value: "12,400+", icon: "check_circle", color: "text-tertiary" },
              { label: "Average SLA",    value: "41-Day",  icon: "speed",         color: "text-secondary" },
            ].map((s) => (
              <div key={s.label} className="flex items-center justify-between p-5 bg-surface-container-lowest rounded-xl border border-white/50 shadow-sm">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <span className={`material-symbols-outlined ${s.color}`}>{s.icon}</span>
                  </div>
                  <span className="text-[14px] font-semibold text-on-surface">{s.label}</span>
                </div>
                <span className={`font-mono text-lg font-bold ${s.color}`}>{s.value}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="absolute top-[-10%] right-[-10%] w-64 h-64 bg-primary-container/10 rounded-full blur-[100px]" />
        <div className="absolute bottom-[-5%] left-[-5%] w-80 h-80 bg-secondary-container/5 rounded-full blur-[120px]" />
      </section>
    </main>
  );
}