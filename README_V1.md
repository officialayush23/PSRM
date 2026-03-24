# PS-CRM Version 1 Readme

This document captures the real current state of the codebase, including:
- how frontend and backend are connected
- what is implemented and working
- what is partially implemented
- what is missing or incorrect against product expectations
- current errors/warnings seen in the workspace
- a prioritized fix roadmap

It is intentionally gap-focused so product, engineering, and ops can align on a Version 1 hardening plan.

---

## 1. Product Intention vs Current Reality

### Intended platform behavior
- Complaints should be converted into infrastructure signals.
- Every complaint should map to an infra node.
- Admin, official, and super admin should monitor infra nodes (not only complaint tickets).
- Department scoping should be strict.
- Low-confidence mappings should be reroutable quickly.
- Agent workflows should automate survey rollout, notifications, and operational follow-up.
- CRM assistant should answer operational questions over full scoped data.

### Current behavior summary
- Complaint ingestion and mapping pipeline exists and writes complaint + infra linkage.
- Dashboards are still largely complaint-centric in UI data surfaces.
- Department filtering exists in backend for complaint queue/KPI.
- Reroute endpoint exists, but low-confidence triage is not operationalized end-to-end.
- Survey/notification flow exists but is only partially automated.
- Chatbot supports several query intents but does not support many expected operational questions.
- Cloud Run and Pub/Sub setup is partially scripted but deployment/runtime integration is incomplete.

---

## 2. Architecture and Data Flow (As Implemented)

## 2.1 Frontend stack
- React + Vite
- Firebase client auth
- Axios API client
- Mapbox via react-map-gl

## 2.2 Backend stack
- FastAPI app with route modules:
  - auth
  - complaints
  - admin
  - survey
  - worker
  - stats
- SQLAlchemy sessions with raw SQL-heavy route/service logic
- Vertex AI Gemini integration in admin CRM services
- Pub/Sub publisher service with local fallback mode
- Notification service for FCM + SMTP

## 2.3 Database
- PostgreSQL + PostGIS + vector extensions
- Main schema and data represented in final.sql
- Includes complaints, infra_nodes, tasks, workflow, surveys, notifications, pubsub_event_log, users, workers, contractors, departments, jurisdictions, etc.

---

## 3. Frontend to Backend Connection (Exact Flow)

## 3.1 Authentication flow
1. User signs in/up using Firebase client SDK (email/password).
2. Frontend gets Firebase ID token.
3. Frontend calls backend auth endpoints with id_token.
4. Backend verifies token with Firebase Admin SDK.
5. Backend resolves DB user by auth_uid (Firebase UID).
6. Frontend stores user payload in localStorage auth_user.
7. Axios interceptor adds Bearer token for all API calls.

Key implication:
- DB users without auth_uid (or without matching Firebase account) cannot log in.

## 3.2 Complaint ingestion flow
1. Citizen submits complaint from frontend form.
2. Backend complaint ingest route resolves infra type (provided, custom, or inferred).
3. Backend service persists via ingestion contract/function path and publishes event.
4. Pub/Sub service either:
   - publishes to topic (if PUBSUB_ENABLED true), or
   - executes local fallback (if disabled/failing).

## 3.3 Dashboard/API consumption flow
- Admin and official dashboards consume:
  - KPI and queue APIs from admin router
  - complaint map pins from complaints all endpoint
  - CRM briefing/chat APIs
- Public map consumes complaints all endpoint.

---

## 4. What Is Working

- Role-aware route guarding exists in frontend.
- Backend has role-scoped query helper for admin/official/super admin views.
- Complaint queue filtering supports status, priority, infra type, and workflow-needed states.
- Reroute API exists for department reassignment.
- Infra node summary and infra node AI summary endpoints exist.
- Worker task lifecycle endpoints exist with photo/progress handling.
- Survey instances and submissions are implemented.
- Notification dispatch exists for FCM and email channels.
- CRM briefing and CRM chat are implemented with scoped SQL context.

---

## 5. Major Gaps and Lackluster Areas

## G1. Infra-node-first requirement is not met in main dashboards
Expected:
- Dashboards should primarily show infra nodes and node health.

Current:
- Map and queue paths are complaint-first in most screens.
- API fetch path for map uses complaints/all, returning complaint points.
- Infra node details exist but are secondary/manual drill-down.

Impact:
- System still behaves like ticket tracking rather than infrastructure telemetry.

## G2. Hover detail requirement is not met
Expected:
- Rich hover interactions for quick insight.

Current:
- Map details are mostly click-popup based.
- No robust hover-preview layer for admin/official map workflows.

Impact:
- Slower triage and weaker map UX for operations users.

## G3. 3D map parity is inconsistent
Expected:
- Consistent 3D Mapbox behavior across citizen and admin/official sides.

Current:
- 3D building layer support exists in code, but user experience parity is inconsistent.
- If token/env is not configured, map falls back/unavailable.
- Different map styles and interaction patterns across pages.

Impact:
- Perceived feature mismatch between portals.

## G4. CRM chatbot does not cover required operational questions
Expected examples:
- latest complaint
- earliest complaint
- most critical complaint
- recently assigned tasks and statuses

Current:
- Keyword-based SQL intents exist, but above question classes are not reliably implemented.
- Query planner is narrow and misses many natural-language variants.

Impact:
- Assistant cannot serve as full command center AI for officials/admins.

## G5. Cloud Run + Pub/Sub integration is incomplete
Expected:
- Production deployable backend with Dockerfile and Pub/Sub push handlers.

Current:
- Setup script exists for topics/subscriptions.
- No Dockerfile in repository.
- No backend routes mounted for /pubsub/* webhook callbacks.

Impact:
- Event-driven architecture is only partially realized; production setup is blocked.

## G6. Survey sendouts are not fully agent-automated
Expected:
- Agent-driven automatic survey rollout on workflow milestones.

Current:
- Manual rollout endpoint exists.
- Fallback in pubsub service can create survey instances.
- No clear always-on orchestration path from workflow state transitions to survey rollout.

Impact:
- Citizen feedback loop is inconsistent and operation-dependent.

## G7. Notification channel coverage is partial
Expected:
- Multi-channel notifications (including SMS/WhatsApp where applicable).

Current:
- Implemented: FCM + SMTP email.
- Twilio fields exist, but Twilio send path is not implemented in notification dispatcher.

Impact:
- Limited last-mile communication for non-app users.

## G8. Seeded staff login problem (critical)
Expected:
- Demo officials/admins/workers should be immediately usable for login.

Current:
- Many seeded staff entries in final.sql have auth_uid as NULL.
- Auth pipeline requires Firebase UID mapping.
- ps_crm_seed_v2.sql primarily seeds citizen/dev users, not full staff credentials.

Impact:
- Demo staff data is operationally unusable without Firebase account provisioning and UID linking.

## G9. User management UI lacks complete jurisdiction assignment UX
Expected:
- Admin/super admin can assign role, department, and jurisdiction cleanly.

Current:
- Backend supports jurisdiction_id in create/update.
- Frontend user form state includes jurisdiction_id but does not expose a robust jurisdiction selector flow.

Impact:
- Staff scoping can be incomplete even though backend supports it.

## G10. Department-only infra visibility is only partially achieved
Expected:
- Departments should see only their department infra nodes.

Current:
- Complaint scoping uses agent_suggested_dept_ids.
- Infra-node-native scoping surface is not dominant in UI/API consumption.

Impact:
- Cross-department noise can remain in complaint-centric workflows.

## G11. Low-confidence mapping reroute is not operationalized end-to-end
Expected:
- Low-confidence infra mappings should be actively surfaced and rerouted.

Current:
- mapping confidence is derived from agent logs in some paths, but admin queue currently queries a non-existent complaints column.
- Reroute endpoint exists.
- No dedicated low-confidence queue and auto-escalation policy loop.

Impact:
- Misrouting correction is manual and reactive.

## G12. Current errors/warnings in workspace
Observed from diagnostics:
- Frontend: multiple Tailwind modernization/class simplification warnings (non-blocking).
- Backend: unresolved imports for vertexai, fastapi, sqlalchemy, firebase_admin in current environment (likely interpreter/environment configuration issue rather than code syntax issue).

Impact:
- Dev environment inconsistency increases onboarding/debug friction.

---

## 6. Why Seeded Official/Admin Login Fails

Root cause chain:
1. Login flow depends on Firebase Auth.
2. Backend resolves user by Firebase UID (auth_uid).
3. Seeded staff users in database dump often have auth_uid NULL.
4. Therefore Firebase-authenticated identity cannot map to those seeded rows.

Consequence:
- You cannot log in as seeded official/admin/worker until each account has a real Firebase user and matching auth_uid.

---

## 7. Required Fixes for Version 1

## P0 (must fix before demo/production)
1. Add deployable backend containerization:
   - Create Dockerfile for backend service.
   - Add clear build/deploy instructions for Cloud Run.
2. Implement Pub/Sub push handlers:
   - Add /pubsub/complaint-received
   - Add /pubsub/workflow-events
   - Add /pubsub/notifications
   - Add /pubsub/surveys
3. Resolve seeded staff authentication:
   - Provision Firebase users for seeded staff.
   - Backfill users.auth_uid.
   - Provide one-time bootstrap script.
4. Build infra-node-first operational screens:
   - Dedicated infra-node map/list for admin/official/super admin.
   - Node-level filters: department, jurisdiction, severity, repeat risk.

## P1 (high-value operational improvements)
1. Add low-confidence mapping queue:
   - Explicit queue in admin/official dashboard.
   - One-click reroute workflow with audit reason.
2. Add hover interactions on maps:
   - Preview card on hover, full panel on click.
3. Improve CRM agent intent coverage:
   - Add direct intents for latest, earliest, most critical complaints.
   - Add recent task assignment + status queries.
   - Add date-range and ranking queries.
4. Complete user management:
   - Add jurisdiction selector in frontend.
   - Validate role-department-jurisdiction combinations.

## P2 (quality and scale hardening)
1. Automate survey rollout from workflow transitions.
2. Add SMS/WhatsApp channel support where policy allows.
3. Normalize map style/behavior parity across citizen/admin surfaces.
4. Clean up lint/style warnings and environment setup docs.

---

## 8. Department-Scoped Visibility and Reroute Model (Target State)

To satisfy your requirement that departments only see their own infra nodes and can reroute low-confidence cases:

1. Primary object should be infra_node, not complaint.
2. Scope query by node-level assigned department set (or derived owning department model), not only complaint suggestion arrays.
3. Maintain low-confidence threshold.
4. Route low-confidence nodes into department review queue.
5. Allow reroute with reason + actor logging.
6. Reflect reroute immediately in all department dashboards.

---

## 9. Suggested Immediate Execution Order

1. Authentication bootstrap for seeded staff (Firebase UID backfill).
2. Dockerfile + Cloud Run deployment path.
3. Pub/Sub webhook routes and event handlers.
4. Infra-node-first dashboard tab and APIs.
5. Low-confidence reroute queue.
6. CRM query expansion for command-center questions.
7. Survey automation triggers.

---

## 10. Notes for final.sql and seed usage

- final.sql contains rich operational dataset, including staff roles, workers, contractors, workflows, and more.
- ps_crm_seed_v2.sql is more limited for auth-operational demo users and does not provide a full Firebase-ready staff setup.
- If final.sql is used as base demo data, a post-restore auth_uid sync step is required.

---

## 11. Conclusion

The codebase already contains strong foundational pieces: ingestion, role-scoped admin APIs, workflow/task modules, AI services, survey/notification plumbing, and geospatial schema support.

However, Version 1 product expectations are not yet fully met because core operational UX and deployment readiness are incomplete:
- infra-node-first governance view is not dominant
- event-driven Cloud Run/PubSub runtime path is unfinished
- seeded staff auth is broken for real usage
- chatbot does not yet answer key command-center questions reliably

This readme should be treated as the execution baseline for the next implementation sprint.

---

## 12. Compliance Check Against 1.0ps.txt (Feature-by-Feature)

Status legend:
- Implemented: working in code path today
- Partial: some components exist, but not complete end-to-end
- Not implemented: requirement is documentation-only or missing runtime path

| Requirement from 1.0ps.txt | Current Status | Evidence in Codebase | Gap Summary |
|---|---|---|---|
| Complaint ingestion to infra signal | Partial | /complaints/ingest + fn_ingest_complaint + infra_node linkage | Ingestion works, but dashboard UX is still complaint-first |
| Infrastructure-centric governance | Partial | infra_nodes APIs exist (/admin/infra-nodes/*) | Main dashboards and map fetch remain complaint-centric |
| Multi-department routing | Partial | agent_suggested_dept_ids + /admin/complaints/{id}/reroute | No dedicated low-confidence triage queue and policy workflow |
| Predictive analytics and proactive alerts | Partial | KPI, repeat metrics, agent logs, CRM summaries | No explicit predictive-alert engine surfaced as first-class feature |
| Real-time transparency dashboard | Partial | citizen/admin dashboards and map screens exist | Worker progress and contractor accountability visibility still uneven |
| Multilingual intake with Bhashini | Partial | translation exists in complaint_service (Gemini-based) | Bhashini integration as claimed in 1.0ps is not implemented |
| WhatsApp complaint intake channel | Not implemented | Mentioned in docs/context, not in active API routes | No inbound WhatsApp webhook intake path |
| Call center intake channel | Not implemented | Mentioned in docs/context only | No call-center intake pipeline endpoints |
| LangGraph multi-agent orchestration | Partial | langgraph deps present in requirements, agent services exist | No explicit LangGraph graph runtime pipeline in active route flow |
| Pub/Sub event-driven processing | Partial | pubsub_service with publish + fallback, setup script exists | Missing explicit /pubsub/* HTTP handlers for push subscriptions |
| Cloud Tasks scheduling layer | Partial | schema and SQL references exist | No clear active Cloud Tasks runtime execution path in backend routes |
| Survey automation at milestones | Partial | surveys rollout endpoint + fallback survey creation | Not clearly auto-triggered from all workflow milestone transitions |
| Notification stack (FCM + email + WhatsApp/SMS) | Partial | FCM + SMTP implemented | Twilio WhatsApp/SMS path not implemented |
| Contractor intelligence and assignment | Partial | worker/contractor/task APIs and assignment exist | End-to-end performance analytics and automated contractor governance are limited |
| Public + admin map parity | Partial | 3D layers in map pages | UX parity not consistent; hover-first interactions missing |
| Cloud Run dockerized deployment | Not implemented | pubsub/cloudrun setup shell exists | Dockerfile absent, deployment path incomplete |

Conclusion for 1.0ps alignment:
- Not everything in 1.0ps.txt is happening yet.
- The platform has a strong core implementation, but several claims in 1.0ps are currently roadmap-level rather than runtime-complete.

---

## 13. API Catalog: What Each API Does and Where It Connects

## 13.1 Base wiring
- Backend base app: FastAPI in backend/main.py
- Router prefixes:
  - /auth
  - /complaints
  - /stats
  - /admin
  - /surveys
  - /worker
- Frontend API client: axios with Firebase token interceptor in frontend/src/api/client.js

## 13.2 Auth APIs

| Method | Path | Purpose | Frontend Connector |
|---|---|---|---|
| POST | /auth/signup | Verify Firebase token and create citizen profile in DB | signup() in frontend/src/api/authApi.js, called by SignupPage |
| POST | /auth/login | Verify Firebase token and resolve/provision user in DB | login() in frontend/src/api/authApi.js, called by LoginPage |
| GET | /auth/me | Fetch current user profile | getMe() in frontend/src/api/authApi.js, used in ProfilePage |
| PATCH | /auth/me | Update current user profile and preferences | updateMe() in frontend/src/api/authApi.js, used in ProfilePage |

## 13.3 Complaint APIs

| Method | Path | Purpose | Frontend Connector |
|---|---|---|---|
| GET | /complaints/infra-types | List infra types for complaint form | fetchInfraTypes() used by SubmitComplaintPage |
| GET | /complaints/map-pins | Citizen's own complaint pins | fetchMapPins() |
| GET | /complaints/nearby | Nearby complaints around lat/lng | fetchNearbyComplaints() |
| GET | /complaints/all | Citywide complaint map feed | fetchAllComplaints() used by PublicMapPage, AdminDashboardPage, OfficialDashboardPage |
| GET | /complaints | Paginated complaints of current citizen | fetchMyComplaints() used by MyComplaintsPage, NotificationsPage |
| GET | /complaints/{complaint_id}/history | Status history timeline | fetchComplaintHistory() used by ComplaintStatusPage |
| GET | /complaints/{complaint_id} | Complaint detail (role-aware service) | fetchComplaintById() used by ComplaintStatusPage |
| POST | /complaints/ingest | Main complaint ingestion with media and mapping | submitComplaint() used by SubmitComplaintPage |
| GET | /complaints/upload-url | Signed upload URL for media | direct/auxiliary upload flows |
| PATCH | /complaints/{complaint_id}/images | Append uploaded image metadata | direct/auxiliary upload flows |

## 13.4 Stats APIs

| Method | Path | Purpose | Frontend Connector |
|---|---|---|---|
| GET | /stats/me | Citizen complaint stats summary | fetchMyStats() used by MyComplaintsPage and ProfilePage |

## 13.5 Admin/Official APIs

| Method | Path | Purpose | Frontend Connector |
|---|---|---|---|
| GET | /admin/dashboard/kpi | KPI cards and aggregate metrics | fetchAdminKPI() used by AdminDashboardPage and OfficialDashboardPage |
| GET | /admin/crm/briefing | AI daily briefing | fetchDailyBriefing() in admin dashboards |
| POST | /admin/crm/chat | AI chat with scoped operational data | sendCRMChat() in CRMAgentChat |
| GET | /admin/complaints/queue | Dept/city-scoped complaint triage queue | fetchComplaintQueue() in admin/official dashboards |
| GET | /admin/complaints/{complaint_id} | Detailed complaint record for operations | fetchComplaintAdmin() |
| GET | /admin/complaints/{complaint_id}/workflow-suggestions | AI workflow suggestions | fetchWorkflowSuggestions() |
| POST | /admin/complaints/{complaint_id}/workflow-approve | Approve and instantiate workflow | approveWorkflow() |
| POST | /admin/complaints/{complaint_id}/reroute | Reassign complaint department routing | rerouteComplaint() |
| GET | /admin/infra-nodes/{node_id}/summary | Non-AI infra node operational summary | fetchInfraNodeSummary() |
| GET | /admin/infra-nodes/{node_id}/ai-summary | Deep AI node analysis | fetchInfraNodeAiSummary() |
| POST | /admin/tasks/{task_id}/assign | Assign worker/contractor/official to task | assignTask() |
| GET | /admin/workers/available | Worker availability list | fetchAvailableWorkers() |
| GET | /admin/contractors/available | Contractor availability list | fetchAvailableContractors() |
| GET | /admin/departments | Department list | fetchDepartments() |
| GET | /admin/officials | Official list | fetchOfficials() |
| GET | /admin/tasks | Admin task list with filters | fetchAdminTaskList() |
| POST | /admin/users | Create staff user + Firebase account | createStaffUser() in UserManagementPage |
| PATCH | /admin/users/{user_id} | Update role/department/jurisdiction/active state | updateStaffUser() in UserManagementPage |
| GET | /admin/users | List staff users with role/dept filters | fetchStaffUsers() in UserManagementPage |
| POST | /admin/users/{user_id}/deactivate | Deactivate staff user (DB + Firebase) | deactivateStaffUser() in UserManagementPage |

## 13.6 Survey APIs

| Method | Path | Purpose | Frontend Connector |
|---|---|---|---|
| GET | /surveys/user/my | Pending surveys for logged-in user | direct client.get in NotificationsPage |
| GET | /surveys/{survey_instance_id} | Survey detail payload for rendering | direct client.get in SurveyPage |
| POST | /surveys/{survey_instance_id}/submit | Submit rating/feedback and optional resolution validation | direct client.post in SurveyPage |
| POST | /surveys/rollout | Manual/admin-triggered survey dispatch | rolloutSurvey() in adminApi |

## 13.7 Worker APIs

| Method | Path | Purpose | Frontend Connector |
|---|---|---|---|
| GET | /worker/tasks | Worker/contractor/admin task listing | fetchWorkerTasks() in OfficialDashboardPage |
| GET | /worker/tasks/{task_id} | Task detail | worker-facing flows |
| POST | /worker/tasks/{task_id}/update | Upload progress, notes, completion evidence | worker-facing flows |

## 13.8 Expected-but-missing integration APIs

These are represented in architecture docs but not currently exposed as HTTP routes:
- /pubsub/complaint-received
- /pubsub/workflow-events
- /pubsub/notifications
- /pubsub/surveys

Implication:
- Pub/Sub push-subscription architecture in docs is not fully wired in backend routes.

---

## 14. Error Register (Documented)

## E1. Production runtime failure: admin complaint queue 500

Observed error:
- GET /admin/complaints/queue?limit=100&offset=0 returns 500
- psycopg2.errors.UndefinedColumn: column c.mapping_confidence does not exist
- SQLAlchemy ProgrammingError reference: https://sqlalche.me/e/20/f405

Where it fails:
- Query in backend/routes/admin_router.py inside get_complaint_queue()
- SELECT includes c.mapping_confidence from complaints c

Schema fact:
- complaints table in final.sql has no mapping_confidence column

Root cause:
- Code expects denormalized mapping_confidence on complaints, but schema stores mapping confidence in agent_logs/domain events pattern.

Impact:
- Admin/official complaint queue is unavailable (core operations blocked).

Recommended fixes:
1. Preferred: remove c.mapping_confidence from queue/detail selects and compute latest confidence via agent_logs join/subquery.
2. Alternative: add a migration that introduces complaints.mapping_confidence and keep it synchronized during mapping updates.
3. Add schema-compatibility startup checks to fail fast when query columns are absent.

## E2. Backend unresolved import diagnostics in editor

Observed:
- unresolved imports for fastapi, sqlalchemy, vertexai, firebase_admin in multiple backend files.

Likely cause:
- editor interpreter/environment mismatch rather than source syntax.

Impact:
- noisy diagnostics and reduced developer productivity.

Fix direction:
- point VS Code Python interpreter to backend/psrm environment and ensure backend/requirements.txt dependencies are installed there.

## E3. Frontend utility/lint modernization warnings

Observed:
- multiple Tailwind class simplification warnings (e.g., flex-shrink-0 -> shrink-0, arbitrary values to scale tokens).

Impact:
- non-blocking, but increases code noise.

Fix direction:
- run a style cleanup pass after functional blockers are fixed.

## E4. jsconfig deprecation warning

Observed:
- frontend/jsconfig.json reports baseUrl deprecation warning for future TypeScript behavior.

Impact:
- not blocking now, but should be updated to avoid future breakage.

Fix direction:
- update config strategy per TS migration guidance.

---

## 15. Additional Non-Obvious Gaps Beyond Initial Request

1. Security hardening gap:
   - CORS currently allows all origins, headers, and methods in backend main app.
   - acceptable for local dev, risky for production.

2. Environment consistency gap:
   - runtime behavior and editor diagnostics indicate inconsistent environment setup.

3. Operational observability gap:
   - logs exist, but no explicit documented alerting/SLO dashboard pipeline.

4. Data-contract drift risk:
   - SQL and route queries can diverge (example: mapping_confidence), indicating missing migration contract checks.

---

## 16. Final Answer to "Is Everything Happening in 1.0ps.txt?"

No. Core foundations are implemented, but multiple 1.0ps commitments are only partially implemented or not runtime-wired yet.

Most complete today:
- complaint ingestion
- role-aware auth and dashboards
- task assignment and survey submission basics
- FCM/email notification plumbing

Most incomplete against 1.0ps claims:
- infra-node-first operational UX dominance
- Pub/Sub push endpoint layer
- WhatsApp/call-center intake
- Bhashini-specific integration
- fully automated LangGraph-orchestrated milestone workflows
- predictive analytics engine with proactive alert surfacing
- Dockerized Cloud Run deployment readiness