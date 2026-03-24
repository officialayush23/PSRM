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
  const { data } = await client.post("/admin/crm/chat", { message, history });
  return data;
}

// ── Complaint queue ───────────────────────────────────────────────

export async function fetchComplaintQueue({ status, priority, infraTypeCode, limit = 50, offset = 0 } = {}) {
  const params = { limit, offset };
  if (status)        params.status          = status;
  if (priority)      params.priority        = priority;
  if (infraTypeCode) params.infra_type_code = infraTypeCode;
  const { data } = await client.get("/admin/complaints/queue", { params });
  return data;
}

export async function fetchComplaintAdmin(complaintId) {
  const { data } = await client.get(`/admin/complaints/${complaintId}`);
  return data;
}

// ── Workflow suggestions ──────────────────────────────────────────

export async function fetchWorkflowSuggestions(complaintId) {
  const { data } = await client.get(`/admin/complaints/${complaintId}/workflow-suggestions`);
  return data;
}

export async function approveWorkflow(complaintId, templateId, versionId, editedSteps = null, editReason = null) {
  const { data } = await client.post(`/admin/complaints/${complaintId}/workflow-approve`, {
    template_id:  templateId,
    version_id:   versionId,
    edited_steps: editedSteps,
    edit_reason:  editReason,
  });
  return data;
}

// ── Infra node summary ────────────────────────────────────────────

export async function fetchInfraNodeSummary(nodeId) {
  const { data } = await client.get(`/admin/infra-nodes/${nodeId}/summary`);
  return data;
}

// ── Task assignment ───────────────────────────────────────────────

export async function assignTask(taskId, { workerId, contractorId, officialId, notes, overrideReasonCode } = {}) {
  const { data } = await client.post(`/admin/tasks/${taskId}/assign`, {
    worker_id:            workerId     || null,
    contractor_id:        contractorId || null,
    official_id:          officialId   || null,
    notes:                notes        || null,
    override_reason_code: overrideReasonCode || null,
  });
  return data;
}

// ── Workers / Contractors available ──────────────────────────────

export async function fetchAvailableWorkers({ deptId, skill } = {}) {
  const params = {};
  if (deptId) params.dept_id = deptId;
  if (skill)  params.skill   = skill;
  const { data } = await client.get("/admin/workers/available", { params });
  return data;
}

export async function fetchAvailableContractors({ deptId } = {}) {
  const params = {};
  if (deptId) params.dept_id = deptId;
  const { data } = await client.get("/admin/contractors/available", { params });
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

// ── Department list ───────────────────────────────────────────────

export async function fetchDepartments() {
  const { data } = await client.get("/admin/departments");
  return data;
}

// ── Officials list ────────────────────────────────────────────────

export async function fetchOfficials({ deptId } = {}) {
  const params = {};
  if (deptId) params.dept_id = deptId;
  const { data } = await client.get("/admin/officials", { params });
  return data;
}

// ── User Management (super_admin) ─────────────────────────────────

/**
 * List all staff users (officials, admins, workers, contractors).
 * @param {Object} params - Optional filters: role, dept_id
 */
export async function fetchStaffUsers({ role, deptId } = {}) {
  const params = {};
  if (role)   params.role    = role;
  if (deptId) params.dept_id = deptId;
  const { data } = await client.get("/admin/users", { params });
  return data;
}

/**
 * Create a new staff user.
 * Backend calls Firebase Admin SDK to create the auth account,
 * then inserts into users table with the Firebase UID as auth_uid.
 * Also auto-creates workers/contractors row for those roles.
 *
 * @param {Object} user
 * @param {string} user.email
 * @param {string} user.full_name
 * @param {string} user.role - official | admin | super_admin | worker | contractor
 * @param {string} [user.department_id]
 * @param {string} [user.jurisdiction_id]
 * @param {string} [user.phone]
 * @param {string} [user.preferred_language] - hi | en
 * @param {string} [user.temp_password] - defaults to PSCrm@2025
 * @returns {{ user_id, firebase_uid, email, role, temp_password, reset_link }}
 */
export async function createStaffUser(user) {
  const { data } = await client.post("/admin/users", user);
  return data;
}

/**
 * Update an existing staff user's role, department, or status.
 * @param {string} userId
 * @param {Object} updates - { full_name, role, department_id, jurisdiction_id, phone, is_active }
 */
export async function updateStaffUser(userId, updates) {
  const { data } = await client.patch(`/admin/users/${userId}`, updates);
  return data;
}

/**
 * Deactivate a staff user in both DB and Firebase.
 * @param {string} userId
 */
export async function deactivateStaffUser(userId) {
  const { data } = await client.post(`/admin/users/${userId}/deactivate`);
  return data;
}

// ── Infra node AI summary (on-demand) ────────────────────────────

/**
 * Deep AI analysis of an infra node — call only when user clicks.
 * Returns: { major_themes, frequency_analysis, criticality_assessment,
 *            incident_timeline, recommended_action, estimated_severity }
 */
export async function fetchInfraNodeAiSummary(nodeId) {
  const { data } = await client.get(`/admin/infra-nodes/${nodeId}/ai-summary`);
  return data;
}

// ── Admin task list (dept-scoped) ─────────────────────────────────

export async function fetchAdminTaskList({ status, deptId, limit = 50, offset = 0 } = {}) {
  const params = { limit, offset };
  if (status)  params.status  = status;
  if (deptId)  params.dept_id = deptId;
  const { data } = await client.get("/admin/tasks", { params });
  return data;
}

// ── Infra nodes / maps / alerts ──────────────────────────────────

export async function fetchInfraNodes({ deptId, status, infraTypeCode, hasRepeat, limit = 50, offset = 0 } = {}) {
  const params = { limit, offset };
  if (deptId)        params.dept_id = deptId;
  if (status)        params.status = status;
  if (infraTypeCode) params.infra_type_code = infraTypeCode;
  if (typeof hasRepeat === "boolean") params.has_repeat = hasRepeat;
  const { data } = await client.get("/admin/infra-nodes", { params });
  return data;
}

export async function fetchInfraNodeMap({ deptId, jurisdictionId, status, infraTypeCode, hasRepeat } = {}) {
  const params = {};
  if (deptId)         params.dept_id = deptId;
  if (jurisdictionId) params.jurisdiction_id = jurisdictionId;
  if (status)         params.status = status;
  if (infraTypeCode)  params.infra_type_code = infraTypeCode;
  if (typeof hasRepeat === "boolean") params.has_repeat = hasRepeat;
  const { data } = await client.get("/infra/nodes/map", { params });
  return data;
}

export async function fetchCriticalAlerts({ limit = 50, offset = 0 } = {}) {
  const { data } = await client.get("/admin/critical-alerts", { params: { limit, offset } });
  return data;
}

// ── Tender workflow ───────────────────────────────────────────────

export async function fetchTenders({ status, deptId, limit = 50, offset = 0 } = {}) {
  const params = { limit, offset };
  if (status) params.status = status;
  if (deptId) params.dept_id = deptId;
  const { data } = await client.get("/admin/tenders", { params });
  return data;
}

export async function createTender(body) {
  const { data } = await client.post("/admin/tenders", body);
  return data;
}

export async function approveTender(tenderId, body = {}) {
  const { data } = await client.post(`/admin/tenders/${tenderId}/approve`, body);
  return data;
}

export async function rejectTender(tenderId, body) {
  const { data } = await client.post(`/admin/tenders/${tenderId}/reject`, body);
  return data;
}

// ── Low-confidence routing / jurisdictions ───────────────────────

export async function fetchLowConfidenceQueue({ limit = 50, offset = 0 } = {}) {
  const { data } = await client.get("/admin/complaints/low-confidence", { params: { limit, offset } });
  return data;
}

export async function fetchJurisdictions() {
  const { data } = await client.get("/admin/jurisdictions");
  return data;
}

// ── Infra node drilldowns ────────────────────────────────────────

export async function fetchNodeHistory(nodeId) {
  const { data } = await client.get(`/infra/nodes/${nodeId}/history`);
  return data;
}

export async function fetchNodeRepeatIssues(nodeId) {
  const { data } = await client.get(`/infra/nodes/${nodeId}/repeat-issues`);
  return data;
}

// ── Workflow learning save ───────────────────────────────────────

export async function saveWorkflowLearning(workflowInstanceId, { edit_reason, edited_steps } = {}) {
  const { data } = await client.post(`/admin/workflows/${workflowInstanceId}/save-learning`, {
    edit_reason,
    edited_steps,
  });
  return data;
}