import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { signup } from "../api/authApi";
import PageShell from "../components/PageShell";

export default function SignupPage() {
  const navigate = useNavigate();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [cityCode, setCityCode] = useState("DEL");
  const [error, setError] = useState("");

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");

    try {
      const data = await signup({
        full_name: fullName,
        email,
        password,
        city_code: cityCode,
        preferred_language: "hi",
      });

      localStorage.setItem("token", data.access_token);
      localStorage.setItem("auth_user", JSON.stringify(data));
      console.log("[AUTH] Signup token:", data.access_token);
      navigate("/submit");
    } catch (err) {
      setError(err.response?.data?.detail || "Signup failed");
    }
  };

  return (
    <PageShell title="PSRM Sign Up">
      <form onSubmit={handleSubmit} className="wireframe-form">
        <label>
          Full Name
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        </label>

        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>

        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
        </label>

        <label>
          City Code
          <input value={cityCode} onChange={(e) => setCityCode(e.target.value.toUpperCase())} required />
        </label>

        {error && <p className="error-text">{error}</p>}

        <button className="submit-btn-large" type="submit">
          Create Account
        </button>

        <p className="auth-helper">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </form>
    </PageShell>
  );
}
