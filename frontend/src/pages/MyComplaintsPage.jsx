import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import AppLayout from "../components/AppLayout";
import { fetchMyComplaints, fetchMyStats } from "../api/complaintsApi";
import { toast } from "sonner";

const STATUS_LABEL = {
  received: "Received",
  clustered: "Clustered",
  mapped: "Mapped",
  workflow_started: "Workflow Started",
  in_progress: "In Progress",
  midway_survey_sent: "Survey Sent",
  resolved: "Resolved",
  closed: "Closed",
  rejected: "Rejected",
  escalated: "Escalated",
  emergency: "Emergency",
  constraint_blocked: "Blocked",
};

const STATUS_COLOR = {
  received: "text-purple-600 bg-purple-50",
  clustered: "text-purple-600 bg-purple-50",
  mapped: "text-blue-600 bg-blue-50",
  workflow_started: "text-blue-600 bg-blue-50",
  in_progress: "text-orange-600 bg-orange-50",
  midway_survey_sent: "text-orange-600 bg-orange-50",
  resolved: "text-green-600 bg-green-50",
  closed: "text-green-600 bg-green-50",
  rejected: "text-red-600 bg-red-50",
  escalated: "text-red-600 bg-red-50",
  emergency: "text-red-700 bg-red-100",
  constraint_blocked: "text-amber-700 bg-amber-50",
};

const PRIORITY_COLOR = {
  low: "text-slate-500",
  normal: "text-blue-500",
  high: "text-orange-500",
  critical: "text-red-600",
  emergency: "text-red-800 font-bold",
};

const STATUS_OPTIONS = [
  "All",
  "received", "in_progress", "resolved", "closed", "rejected", "escalated",
];

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
  });
}

export default function MyComplaintsPage() {
  const navigate = useNavigate();

  const [complaints, setComplaints] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [listRes, statsRes] = await Promise.all([
          fetchMyComplaints({ limit: 100 }),
          fetchMyStats(),
        ]);
        setComplaints(listRes.items || []);
        setStats(statsRes);
      } catch (e) {
        toast.error("Failed to load complaints.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Client-side filtering
  const filtered = complaints.filter((c) => {
    const matchStatus = statusFilter === "All" || c.status === statusFilter;
    const q = search.toLowerCase();
    const matchSearch =
      !q ||
      c.title?.toLowerCase().includes(q) ||
      c.complaint_number?.toLowerCase().includes(q) ||
      c.address_text?.toLowerCase().includes(q);
    return matchStatus && matchSearch;
  });

  return (
    <AppLayout>
      <div className="p-6 flex flex-col gap-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-headline font-bold text-on-surface">My Complaints</h1>
          <Link
            to="/submit"
            className="bg-primary text-on-primary px-5 py-2.5 rounded-full text-sm font-semibold hover:bg-primary/90 transition flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            New Report
          </Link>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Total", value: stats?.total_count, icon: "receipt_long" },
            { label: "Active", value: stats?.active_count, icon: "pending" },
            { label: "Resolved", value: stats?.resolved_count, icon: "check_circle" },
            {
              label: "Avg Days",
              value: stats?.avg_resolution_days != null
                ? stats.avg_resolution_days.toFixed(1)
                : null,
              icon: "schedule",
            },
          ].map((s) => (
            <div
              key={s.label}
              className="bg-surface-container-low border border-outline-variant rounded-2xl p-4 flex items-center gap-3"
            >
              <span className="material-symbols-outlined text-primary text-[24px]">{s.icon}</span>
              <div>
                <p className="text-xl font-headline font-bold text-on-surface">
                  {loading ? "…" : (s.value ?? "—")}
                </p>
                <p className="text-xs text-on-surface-variant">{s.label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex items-center gap-2 bg-surface-container border border-outline-variant rounded-xl px-3 py-2 flex-1">
            <span className="material-symbols-outlined text-on-surface-variant text-[20px]">
              search
            </span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by title, number, or address…"
              className="bg-transparent text-sm text-on-surface placeholder:text-on-surface-variant outline-none flex-1"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-surface-container border border-outline-variant rounded-xl px-3 py-2 text-sm text-on-surface outline-none"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s === "All" ? "All Statuses" : STATUS_LABEL[s] || s}
              </option>
            ))}
          </select>
        </div>

        {/* Table */}
        <div className="bg-surface-container-low border border-outline-variant rounded-2xl overflow-hidden">
          {loading ? (
            <div className="flex flex-col gap-2 p-4">
              {[1, 2, 3, 4].map((n) => (
                <div key={n} className="h-14 rounded-xl bg-outline-variant/30 animate-pulse" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 text-on-surface-variant">
              <span className="material-symbols-outlined text-5xl mb-2">inbox</span>
              <p className="text-sm">
                {complaints.length === 0
                  ? "No complaints filed yet."
                  : "No complaints match your filters."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-container border-b border-outline-variant">
                  <tr>
                    {["#", "Title", "Address", "Status", "Priority", "Filed", "Resolved", ""].map(
                      (h) => (
                        <th
                          key={h}
                          className="px-4 py-3 text-left text-xs font-semibold text-on-surface-variant"
                        >
                          {h}
                        </th>
                      )
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant">
                  {filtered.map((c) => (
                    <tr
                      key={c.id}
                      className="hover:bg-surface-container-high transition cursor-pointer"
                      onClick={() => navigate(`/complaints/${c.id}`)}
                    >
                      <td className="px-4 py-3 font-mono text-xs text-on-surface-variant whitespace-nowrap">
                        {c.complaint_number}
                      </td>
                      <td className="px-4 py-3 max-w-[200px]">
                        <p className="truncate font-medium text-on-surface">{c.title}</p>
                        {c.is_repeat_complaint && (
                          <span className="text-xs text-red-600 font-semibold">Repeat complaint</span>
                        )}
                      </td>
                      <td className="px-4 py-3 max-w-[160px]">
                        <p className="truncate text-on-surface-variant">
                          {c.address_text || "—"}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                            STATUS_COLOR[c.status] || "text-gray-600 bg-gray-50"
                          }`}
                        >
                          {STATUS_LABEL[c.status] || c.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`text-xs capitalize ${PRIORITY_COLOR[c.priority] || ""}`}
                        >
                          {c.priority}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-on-surface-variant whitespace-nowrap">
                        {formatDate(c.created_at)}
                      </td>
                      <td className="px-4 py-3 text-xs text-on-surface-variant whitespace-nowrap">
                        {c.resolved_at ? formatDate(c.resolved_at) : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          className="text-primary text-xs hover:underline"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/complaints/${c.id}`);
                          }}
                        >
                          View →
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {!loading && (
          <p className="text-xs text-on-surface-variant text-right">
            Showing {filtered.length} of {complaints.length} complaints
          </p>
        )}
      </div>
    </AppLayout>
  );
}
