// src/api/adminApi.js

import client from "./client";

// ── Dashboard KPIs ────────────────────────────────────────────────

export async function fetchAdminKPI() {
  const { data } = await client.get("/admin/dashboard/kpi");
  return data;
}

// ── CRM Agent ─────────────────────────────────────────────────────

export async function fetchDailyBriefing() {
  const { data } = await client.get("/admin/crm/briefing");
  return data;
}

export async function sendCRMChat(message, history = []) {
  const { data } = await client.post("/admin/crm/chat", null, {
    params: { message },
    // history as JSON body
  });
  // Use JSON body instead
  const res = await client.post("/admin/crm/chat", { message, history });
  return res.data;
}

// ── Complaint queue ───────────────────────────────────────────────

export async function fetchComplaintQueue({
  status, priority, infraTypeCode, limit = 50, offset = 0,
} = {}) {
  const params = { limit, offset };
  if (status)        params.status          = status;
  if (priority)      params.priority        = priority;
  if (infraTypeCode) params.infra_type_code = infraTypeCode;
  const { data } = await client.get("/admin/complaints/queue", { params });
  return data;
}

// ── Workflow suggestions ──────────────────────────────────────────

export async function fetchWorkflowSuggestions(complaintId) {
  const { data } = await client.get(`/admin/complaints/${complaintId}/workflow-suggestions`);
  return data;
}

export async function approveWorkflow(complaintId, templateId, editedSteps = null, editReason = null) {
  const { data } = await client.post(`/admin/complaints/${complaintId}/workflow-approve`, {
    template_id:   templateId,
    edited_steps:  editedSteps,
    edit_reason:   editReason,
  });
  return data;
}

// ── Infra node summary ────────────────────────────────────────────

export async function fetchInfraNodeSummary(nodeId) {
  const { data } = await client.get(`/admin/infra-nodes/${nodeId}/summary`);
  return data;
}

// ── Task assignment ───────────────────────────────────────────────

export async function assignTask(taskId, { workerId, contractorId, officialId, notes } = {}) {
  const { data } = await client.post(`/admin/tasks/${taskId}/assign`, null, {
    params: {
      worker_id:     workerId,
      contractor_id: contractorId,
      official_id:   officialId,
      notes,
    },
  });
  return data;
}

// ── Workers available ─────────────────────────────────────────────

export async function fetchAvailableWorkers({ deptId, skill } = {}) {
  const params = {};
  if (deptId) params.dept_id = deptId;
  if (skill)  params.skill   = skill;
  const { data } = await client.get("/admin/workers/available", { params });
  return data;
}

// ── Reroute complaint ─────────────────────────────────────────────

export async function rerouteComplaint(complaintId, newDeptIds, reason) {
  const { data } = await client.post(`/admin/complaints/${complaintId}/reroute`, {
    new_dept_ids: newDeptIds,
    reason,
  });
  return data;
}

// ── Rollout survey ────────────────────────────────────────────────

export async function rolloutSurvey(complaintId, surveyType, workflowInstanceId = null) {
  const params = { complaint_id: complaintId, survey_type: surveyType };
  if (workflowInstanceId) params.workflow_instance_id = workflowInstanceId;
  const { data } = await client.post("/surveys/rollout", null, { params });
  return data;
}

// ── Worker tasks (admin view) ─────────────────────────────────────

export async function fetchWorkerTasks(status = null) {
  const params = {};
  if (status) params.status = status;
  const { data } = await client.get("/worker/tasks", { params });
  return data;
}