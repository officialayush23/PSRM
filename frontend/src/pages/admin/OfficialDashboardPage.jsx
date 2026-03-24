import { useEffect, useMemo, useState } from "react";
import AppLayout from "../../components/AppLayout";
import CRMAgentChat from "../../components/CRMAgentChat";
import CriticalAlertBadge from "../../components/CriticalAlertBadge";
import MapboxInfraLayer from "../../components/MapboxInfraLayer";
import TaskUpdateModal from "../../components/TaskUpdateModal";
import WorkflowRecommendationPanel from "../../components/WorkflowRecommendationPanel";
import {
  approveWorkflow,
  assignTask,
  fetchAdminKPI,
  fetchAdminTaskList,
  fetchAvailableContractors,
  fetchAvailableWorkers,
  fetchComplaintQueue,
  fetchCriticalAlerts,
  fetchDailyBriefing,
  fetchDepartments,
  fetchInfraNodeMap,
  fetchLowConfidenceQueue,
  fetchWorkflowSuggestions,
  rerouteComplaint,
} from "../../api/adminApi";
import { toast } from "sonner";

const TABS = [
  { key: "map", label: "Map" },
  { key: "queue", label: "Complaint Queue" },
  { key: "low_confidence", label: "Low Confidence" },
  { key: "workflow", label: "Workflow" },
  { key: "tasks", label: "Tasks" },
  { key: "crm", label: "CRM" },
];

function StatCard({ title, value, tone = "slate" }) {
  const toneMap = {
    slate: "bg-slate-100 text-slate-700",
    red: "bg-rose-100 text-rose-700",
    amber: "bg-amber-100 text-amber-700",
    blue: "bg-sky-100 text-sky-700",
    green: "bg-emerald-100 text-emerald-700",
  };
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <p className="text-xs text-slate-500">{title}</p>
      <p className={`mt-1 inline-block rounded-full px-2 py-1 text-sm font-semibold ${toneMap[tone] || toneMap.slate}`}>
        {value ?? 0}
      </p>
    </div>
  );
}

function TabButton({ active, onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${
        active ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
      }`}
    >
      {label}
    </button>
  );
}

export default function OfficialDashboardPage() {
  const [activeTab, setActiveTab] = useState("map");

  const [kpi, setKpi] = useState(null);
  const [briefing, setBriefing] = useState(null);

  const [mapNodes, setMapNodes] = useState({ type: "FeatureCollection", features: [] });
  const [criticalAlerts, setCriticalAlerts] = useState([]);

  const [queue, setQueue] = useState([]);
  const [lowConfidence, setLowConfidence] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [selectedComplaintForReroute, setSelectedComplaintForReroute] = useState(null);
  const [rerouteDeptIds, setRerouteDeptIds] = useState([]);
  const [rerouteReason, setRerouteReason] = useState("");

  const [workflowPool, setWorkflowPool] = useState([]);
  const [selectedWorkflowComplaint, setSelectedWorkflowComplaint] = useState(null);
  const [workflowSuggestions, setWorkflowSuggestions] = useState([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);

  const [tasks, setTasks] = useState([]);
  const [selectedTask, setSelectedTask] = useState(null);
  const [workerOptions, setWorkerOptions] = useState([]);
  const [contractorOptions, setContractorOptions] = useState([]);
  const [workerId, setWorkerId] = useState("");
  const [contractorId, setContractorId] = useState("");

  const [taskUpdateOpen, setTaskUpdateOpen] = useState(false);

  const summary = useMemo(() => kpi?.summary || {}, [kpi]);

  async function loadCore() {
    try {
      const [kpiRes, briefingRes, mapRes, queueRes, lowRes, deptRes, taskRes, alertRes] = await Promise.all([
        fetchAdminKPI(),
        fetchDailyBriefing(),
        fetchInfraNodeMap(),
        fetchComplaintQueue({ limit: 100 }),
        fetchLowConfidenceQueue({ limit: 100 }),
        fetchDepartments(),
        fetchAdminTaskList({ limit: 100 }),
        fetchCriticalAlerts({ limit: 25 }),
      ]);

      setKpi(kpiRes);
      setBriefing(briefingRes);
      setMapNodes(mapRes || { type: "FeatureCollection", features: [] });
      setQueue(queueRes?.items || []);
      setLowConfidence(lowRes?.items || []);
      setDepartments(deptRes || []);
      setTasks(taskRes?.items || []);
      setCriticalAlerts(alertRes?.items || []);
      setWorkflowPool((queueRes?.items || []).filter((c) => !c.workflow_instance_id && c.status === "received"));
    } catch (err) {
      toast.error("Failed to load official dashboard data");
    }
  }

  useEffect(() => {
    loadCore();
  }, []);

  async function loadSuggestions(complaint) {
    setSelectedWorkflowComplaint(complaint);
    setLoadingSuggestions(true);
    try {
      const res = await fetchWorkflowSuggestions(complaint.id);
      setWorkflowSuggestions(res?.suggestions || []);
    } catch {
      toast.error("Could not load workflow suggestions");
      setWorkflowSuggestions([]);
    } finally {
      setLoadingSuggestions(false);
    }
  }

  async function approveSuggestedWorkflow(suggestion) {
    if (!selectedWorkflowComplaint) return;
    try {
      await approveWorkflow(selectedWorkflowComplaint.id, suggestion.template_id, suggestion.version_id);
      toast.success("Workflow approved");
      await loadCore();
      setWorkflowSuggestions([]);
      setSelectedWorkflowComplaint(null);
    } catch {
      toast.error("Failed to approve workflow");
    }
  }

  async function doReroute() {
    if (!selectedComplaintForReroute) return;
    if (!rerouteDeptIds.length || !rerouteReason.trim()) {
      toast.error("Select department(s) and provide reason");
      return;
    }
    try {
      await rerouteComplaint(selectedComplaintForReroute.id, rerouteDeptIds, rerouteReason.trim());
      toast.success("Complaint rerouted");
      setSelectedComplaintForReroute(null);
      setRerouteDeptIds([]);
      setRerouteReason("");
      await loadCore();
    } catch {
      toast.error("Reroute failed");
    }
  }

  async function openAssign(task) {
    setSelectedTask(task);
    setWorkerId("");
    setContractorId("");
    try {
      const [w, c] = await Promise.all([
        fetchAvailableWorkers({ deptId: task.department_id }),
        fetchAvailableContractors({ deptId: task.department_id }),
      ]);
      setWorkerOptions(w || []);
      setContractorOptions(c || []);
    } catch {
      setWorkerOptions([]);
      setContractorOptions([]);
    }
  }

  async function submitAssign() {
    if (!selectedTask) return;
    if (!workerId && !contractorId) {
      toast.error("Select a worker or contractor");
      return;
    }
    try {
      await assignTask(selectedTask.id, {
        workerId: workerId || undefined,
        contractorId: contractorId || undefined,
      });
      toast.success("Task assigned");
      setSelectedTask(null);
      await loadCore();
    } catch {
      toast.error("Task assignment failed");
    }
  }

  async function submitTaskUpdate(_, formData) {
    if (!selectedTask) return;
    await (await import("../../api/client")).default.post(`/worker/tasks/${selectedTask.id}/update`, formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    toast.success("Task updated");
    await loadCore();
  }

  return (
    <AppLayout>
      <div className="space-y-4 p-4">
        <section className="sticky top-2 z-10 rounded-xl border border-slate-200 bg-white/95 p-3 backdrop-blur">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
            <StatCard title="Open" value={summary.open_complaints} tone="blue" />
            <StatCard title="Critical" value={summary.critical_count} tone="red" />
            <StatCard title="Needs Workflow" value={summary.needs_workflow} tone="amber" />
            <StatCard title="Repeat" value={summary.repeat_count} tone="amber" />
            <StatCard title="SLA Risk" value={summary.sla_at_risk} tone="red" />
            <StatCard title="Resolved" value={summary.resolved_complaints} tone="green" />
          </div>
        </section>

        <section className="flex flex-wrap gap-2">
          {TABS.map((tab) => (
            <TabButton key={tab.key} label={tab.label} active={activeTab === tab.key} onClick={() => setActiveTab(tab.key)} />
          ))}
        </section>

        {activeTab === "map" ? (
          <section className="space-y-3">
            {criticalAlerts.slice(0, 3).map((a) => (
              <CriticalAlertBadge key={a.new_complaint_id || a.node_id} alert={a} onView={() => setActiveTab("queue")} />
            ))}
            <MapboxInfraLayer
              nodes={mapNodes}
              onNodeClick={(id) => {
                window.location.href = `/admin/infra-nodes/${id}`;
              }}
            />
          </section>
        ) : null}

        {activeTab === "queue" ? (
          <section className="rounded-xl border border-slate-200 bg-white p-3">
            <h2 className="mb-3 text-sm font-semibold text-slate-800">Complaint Queue</h2>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-2 py-2">Number</th>
                    <th className="px-2 py-2">Title</th>
                    <th className="px-2 py-2">Status</th>
                    <th className="px-2 py-2">Priority</th>
                    <th className="px-2 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {queue.map((c) => (
                    <tr key={c.id} className="border-t border-slate-100">
                      <td className="px-2 py-2 font-mono">{c.complaint_number}</td>
                      <td className="px-2 py-2">{c.title}</td>
                      <td className="px-2 py-2">{c.status}</td>
                      <td className="px-2 py-2">{c.priority}</td>
                      <td className="px-2 py-2">
                        {!c.workflow_instance_id ? (
                          <button className="rounded bg-slate-900 px-2 py-1 text-white" onClick={() => loadSuggestions(c)}>
                            Suggest Workflow
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {activeTab === "low_confidence" ? (
          <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <h2 className="mb-3 text-sm font-semibold text-slate-800">Low Confidence Queue</h2>
              <div className="space-y-2">
                {lowConfidence.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelectedComplaintForReroute(c)}
                    className={`w-full rounded-lg border p-3 text-left text-xs ${
                      selectedComplaintForReroute?.id === c.id ? "border-slate-900 bg-slate-50" : "border-slate-200"
                    }`}
                  >
                    <p className="font-semibold text-slate-800">{c.complaint_number}</p>
                    <p className="text-slate-600">{c.title}</p>
                  </button>
                ))}
                {!lowConfidence.length ? <p className="text-xs text-slate-500">No low-confidence complaints.</p> : null}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <h2 className="mb-3 text-sm font-semibold text-slate-800">Reroute</h2>
              {!selectedComplaintForReroute ? (
                <p className="text-xs text-slate-500">Select a complaint from left panel.</p>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-slate-600">{selectedComplaintForReroute.complaint_number}  {selectedComplaintForReroute.title}</p>
                  <div className="grid grid-cols-2 gap-2">
                    {departments.map((d) => {
                      const active = rerouteDeptIds.includes(d.id);
                      return (
                        <button
                          key={d.id}
                          type="button"
                          onClick={() => {
                            setRerouteDeptIds((prev) =>
                              prev.includes(d.id) ? prev.filter((x) => x !== d.id) : [...prev, d.id]
                            );
                          }}
                          className={`rounded-lg border px-2 py-2 text-xs ${active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200"}`}
                        >
                          {d.name}
                        </button>
                      );
                    })}
                  </div>
                  <textarea
                    rows={3}
                    value={rerouteReason}
                    onChange={(e) => setRerouteReason(e.target.value)}
                    placeholder="Reason for reroute"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                  />
                  <button type="button" onClick={doReroute} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white">
                    Submit Reroute
                  </button>
                </div>
              )}
            </div>
          </section>
        ) : null}

        {activeTab === "workflow" ? (
          <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <h2 className="mb-3 text-sm font-semibold text-slate-800">Needs Workflow</h2>
              <div className="space-y-2">
                {workflowPool.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => loadSuggestions(c)}
                    className={`w-full rounded-lg border p-3 text-left text-xs ${
                      selectedWorkflowComplaint?.id === c.id ? "border-slate-900 bg-slate-50" : "border-slate-200"
                    }`}
                  >
                    <p className="font-semibold text-slate-800">{c.complaint_number}</p>
                    <p className="text-slate-600">{c.title}</p>
                  </button>
                ))}
                {!workflowPool.length ? <p className="text-xs text-slate-500">No complaints waiting for workflow.</p> : null}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <h2 className="mb-3 text-sm font-semibold text-slate-800">Recommendations</h2>
              {loadingSuggestions ? <p className="text-xs text-slate-500">Loading suggestions...</p> : null}
              {!loadingSuggestions ? (
                <WorkflowRecommendationPanel suggestions={workflowSuggestions} onApprove={approveSuggestedWorkflow} onCompare={() => {}} />
              ) : null}
            </div>
          </section>
        ) : null}

        {activeTab === "tasks" ? (
          <section className="rounded-xl border border-slate-200 bg-white p-3">
            <h2 className="mb-3 text-sm font-semibold text-slate-800">Task Assignment</h2>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-2 py-2">Task</th>
                    <th className="px-2 py-2">Status</th>
                    <th className="px-2 py-2">Priority</th>
                    <th className="px-2 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((t) => (
                    <tr key={t.id} className="border-t border-slate-100">
                      <td className="px-2 py-2">
                        <p className="font-semibold">{t.task_number}</p>
                        <p className="text-slate-600">{t.title}</p>
                      </td>
                      <td className="px-2 py-2">{t.status}</td>
                      <td className="px-2 py-2">{t.priority}</td>
                      <td className="px-2 py-2 space-x-1">
                        <button type="button" onClick={() => openAssign(t)} className="rounded bg-slate-900 px-2 py-1 text-white">
                          Assign
                        </button>
                        <button type="button" onClick={() => { setSelectedTask(t); setTaskUpdateOpen(true); }} className="rounded border border-slate-300 px-2 py-1">
                          Update
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {selectedTask ? (
              <div className="mt-4 rounded-xl border border-slate-200 p-3">
                <p className="mb-2 text-xs font-semibold text-slate-700">Assign for {selectedTask.task_number}</p>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  <select value={workerId} onChange={(e) => { setWorkerId(e.target.value); if (e.target.value) setContractorId(""); }} className="rounded-lg border border-slate-300 px-3 py-2 text-xs">
                    <option value="">Select worker</option>
                    {workerOptions.map((w) => (
                      <option key={w.id} value={w.id}>{w.full_name || w.id}</option>
                    ))}
                  </select>
                  <select value={contractorId} onChange={(e) => { setContractorId(e.target.value); if (e.target.value) setWorkerId(""); }} className="rounded-lg border border-slate-300 px-3 py-2 text-xs">
                    <option value="">Select contractor</option>
                    {contractorOptions.map((c) => (
                      <option key={c.id} value={c.id}>{c.company_name || c.id}</option>
                    ))}
                  </select>
                </div>
                <div className="mt-2 flex gap-2">
                  <button type="button" onClick={submitAssign} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white">Submit Assignment</button>
                  <button type="button" onClick={() => setSelectedTask(null)} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700">Cancel</button>
                </div>
              </div>
            ) : null}
          </section>
        ) : null}

        {activeTab === "crm" ? (
          <section className="space-y-3">
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <p className="text-xs font-semibold text-slate-700">Daily Briefing</p>
              <p className="mt-1 text-sm text-slate-600">{briefing?.greeting || "No briefing available."}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <CRMAgentChat />
            </div>
          </section>
        ) : null}
      </div>

      {taskUpdateOpen && selectedTask ? (
        <TaskUpdateModal
          task={selectedTask}
          isOpen={taskUpdateOpen}
          onClose={() => setTaskUpdateOpen(false)}
          onSubmit={submitTaskUpdate}
        />
      ) : null}
    </AppLayout>
  );
}
