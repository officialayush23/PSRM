import { Navigate, Route, Routes } from "react-router-dom";
import AdminPage from "./pages/AdminPage";
import ComplaintStatusPage from "./pages/ComplaintStatusPage";
import LoginPage from "./pages/LoginPage";
import SignupPage from "./pages/SignupPage";
import SubmitComplaintPage from "./pages/SubmitComplaintPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/submit" element={<SubmitComplaintPage />} />
      <Route path="/complaints/:id" element={<ComplaintStatusPage />} />
      <Route path="/admin" element={<AdminPage />} />
    </Routes>
  );
}
