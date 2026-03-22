import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { signup } from "../api/authApi";
import { toast } from "sonner";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Button } from "../components/ui/button";

export default function SignupPage() {
  const navigate = useNavigate();
  const [fullName, setFullName]   = useState("");
  const [email, setEmail]         = useState("");
  const [password, setPassword]   = useState("");
  const [cityCode, setCityCode]   = useState("DEL");
  const [loading, setLoading]     = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);

    try {
      const data = await signup({
        full_name:          fullName,
        email,
        password,
        city_code:          cityCode,
        preferred_language: "hi",
      });

      // data.user_id, data.role etc. — no access_token needed anymore,
      // client.js gets a fresh Firebase token on every request automatically
      localStorage.setItem("auth_user", JSON.stringify(data));
      navigate("/submit");
    } catch (err) {
      // Firebase-specific error codes
      if (err.code === "auth/email-already-in-use") {
        toast.error("This email is already registered. Please sign in.");
      } else if (err.code === "auth/weak-password") {
        toast.error("Password must be at least 6 characters.");
      } else if (err.code === "auth/invalid-email") {
        toast.error("Please enter a valid email address.");
      } else {
        // Backend errors (409 duplicate, 400 bad city, etc.)
        toast.error(err.response?.data?.detail || err.message || "Signup failed.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex flex-col md:flex-row bg-surface font-body text-on-surface">
      {/* LEFT COLUMN: SIGNUP FORM */}
      <section className="w-full md:w-[55%] bg-surface-container-lowest flex flex-col p-8 md:p-16">
        {/* Brand Anchor */}
        <div className="flex items-center gap-1.5 mb-16">
          <span className="font-headline font-extrabold text-[20px] text-on-background tracking-tight">
            PS-CRM
          </span>
          <div className="w-1.5 h-1.5 rounded-full bg-primary-container" />
        </div>

        {/* Signup Content */}
        <div className="max-w-[400px] w-full mx-auto my-auto">
          <header className="mb-10">
            <h1 className="font-headline font-bold text-[32px] text-on-background leading-tight mb-3">
              Create account
            </h1>
            <p className="text-[16px] text-on-surface-variant font-normal">
              Join Delhi's civic grievance network
            </p>
          </header>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="fullName">Full Name</Label>
              <Input
                id="fullName"
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                placeholder="Rahul Kumar"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email Address</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="rahul.kumar@example.com"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="cityCode">City Code</Label>
              <Input
                id="cityCode"
                value={cityCode}
                onChange={(e) => setCityCode(e.target.value.toUpperCase())}
                required
                placeholder="DEL"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="signupPassword">Password</Label>
              <Input
                id="signupPassword"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                placeholder="Min 8 characters"
              />
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 group mt-4 h-12"
            >
              <span>{loading ? "Creating..." : "Create Account"}</span>
              {!loading && (
                <span className="material-symbols-outlined text-sm group-hover:translate-x-1 transition-transform">
                  arrow_forward
                </span>
              )}
            </Button>
          </form>

          <p className="text-center text-sm text-on-surface-variant mt-6">
            Already have an account?{" "}
            <Link to="/login" className="text-primary font-semibold hover:underline">
              Sign in
            </Link>
          </p>

          <footer className="mt-16 flex items-center gap-2 text-[12px] text-outline/60 font-medium">
            <span className="material-symbols-outlined text-[14px]">verified_user</span>
            <span>Secured by Bhashini · Delhi Municipal Services</span>
          </footer>
        </div>
      </section>

      {/* RIGHT COLUMN: VISUAL CONTEXT (45%) */}
      <section className="hidden md:flex md:w-[45%] bg-[#f0f9ff] relative overflow-hidden flex-col items-center justify-center p-12 bg-delhi-pattern">
        <div className="relative z-10 w-full max-w-md flex flex-col items-center text-center">
          <div className="w-full aspect-video mb-12 flex items-end justify-center">
            <div className="w-full h-full flex items-center justify-center opacity-40">
              <span className="material-symbols-outlined text-primary text-[120px]">
                location_city
              </span>
            </div>
          </div>
          <div className="mb-12">
            <h2 className="font-headline font-bold text-[28px] text-on-background mb-2">PS-CRM</h2>
            <p className="text-[14px] text-primary font-medium tracking-wide">
              Smart Civic Intelligence for Delhi
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 w-full">
            <div className="flex items-center justify-between p-5 bg-surface-container-lowest rounded-xl shadow-[0_10px_30px_rgba(0,102,138,0.04)] border border-white/50 backdrop-blur-sm">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-tertiary-container/10 flex items-center justify-center">
                  <span className="material-symbols-outlined text-tertiary">check_circle</span>
                </div>
                <span className="text-[14px] font-semibold text-on-surface">Resolved Cases</span>
              </div>
              <span className="font-mono text-lg font-bold text-tertiary">12,400+</span>
            </div>
            <div className="flex items-center justify-between p-5 bg-surface-container-lowest rounded-xl shadow-[0_10px_30px_rgba(0,102,138,0.04)] border border-white/50 backdrop-blur-sm">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-secondary-container/10 flex items-center justify-center">
                  <span className="material-symbols-outlined text-secondary">speed</span>
                </div>
                <span className="text-[14px] font-semibold text-on-surface">Average SLA</span>
              </div>
              <span className="font-mono text-lg font-bold text-secondary">41-Day</span>
            </div>
          </div>
        </div>
        <div className="absolute top-[-10%] right-[-10%] w-64 h-64 bg-primary-container/10 rounded-full blur-[100px]" />
        <div className="absolute bottom-[-5%] left-[-5%] w-80 h-80 bg-secondary-container/5 rounded-full blur-[120px]" />
      </section>
    </main>
  );
}