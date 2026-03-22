# backend/models.py

import uuid
from sqlalchemy import (
    Column, String, Boolean, Integer, Text, Numeric,
    DateTime, Date, SmallInteger, ForeignKey, ARRAY,
    CheckConstraint, UniqueConstraint
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from geoalchemy2 import Geometry
from pgvector.sqlalchemy import Vector
from db import Base


# ============================================================
# LAYER 1 — REFERENCE / MASTER DATA
# ============================================================

class City(Base):
    __tablename__ = "cities"

    id           = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name         = Column(String(100), nullable=False)
    state        = Column(String(100))
    country_code = Column(String(2), nullable=False, default="IN")
    city_code    = Column(String(10), nullable=False, unique=True)
    timezone     = Column(String(50), nullable=False, default="Asia/Kolkata")
    extra_meta   = Column("metadata", JSONB, nullable=False, default=dict)
    created_at   = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at   = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


class Jurisdiction(Base):
    __tablename__ = "jurisdictions"

    id                = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    city_id           = Column(UUID(as_uuid=True), ForeignKey("cities.id", ondelete="RESTRICT"), nullable=False)
    parent_id         = Column(UUID(as_uuid=True), ForeignKey("jurisdictions.id"))
    name              = Column(String(200), nullable=False)
    code              = Column(String(30), nullable=False)
    jurisdiction_type = Column(String(50), nullable=False)
    boundary          = Column(Geometry("MULTIPOLYGON", srid=4326))
    extra_meta        = Column("metadata", JSONB, nullable=False, default=dict)
    created_at        = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at        = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    __table_args__ = (UniqueConstraint("city_id", "code"),)


class WorkflowConstraint(Base):
    __tablename__ = "workflow_constraints"

    id                       = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    city_id                  = Column(UUID(as_uuid=True), ForeignKey("cities.id"), nullable=False)
    jurisdiction_id          = Column(UUID(as_uuid=True), ForeignKey("jurisdictions.id"))
    name                     = Column(String(300), nullable=False)
    description              = Column(Text)
    constraint_type          = Column(String(30), nullable=False)
    affected_dept_codes      = Column(ARRAY(Text), nullable=False, default=list)
    affected_work_type_codes = Column(ARRAY(Text), nullable=False, default=list)
    is_recurring_annual      = Column(Boolean, nullable=False, default=False)
    start_month              = Column(SmallInteger)
    start_day                = Column(SmallInteger)
    end_month                = Column(SmallInteger)
    end_day                  = Column(SmallInteger)
    active_from              = Column(Date)
    active_until             = Column(Date)
    condition                = Column(JSONB, nullable=False, default=dict)
    block_message            = Column(Text, nullable=False)
    legal_reference          = Column(Text)
    is_active                = Column(Boolean, nullable=False, default=True)
    created_by               = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    updated_by               = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    created_at               = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at               = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


class Department(Base):
    __tablename__ = "departments"

    id               = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    city_id          = Column(UUID(as_uuid=True), ForeignKey("cities.id"), nullable=False)
    jurisdiction_id  = Column(UUID(as_uuid=True), ForeignKey("jurisdictions.id"))
    name             = Column(String(300), nullable=False)
    code             = Column(String(30), nullable=False)
    contact_email    = Column(String(255))
    contact_phone    = Column(String(20))
    head_official_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"))
    extra_meta       = Column("metadata", JSONB, nullable=False, default=dict)
    created_at       = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at       = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    __table_args__ = (UniqueConstraint("city_id", "code"),)


class DepartmentBranch(Base):
    """
    Sub-offices within a department.
    An MCD Engineering branch covers a zone;
    a PWD sub-division covers an arterial road cluster.
    Aligned with final.sql department_branches table.
    """
    __tablename__ = "department_branches"

    id               = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    department_id    = Column(UUID(as_uuid=True), ForeignKey("departments.id"), nullable=False)
    city_id          = Column(UUID(as_uuid=True), ForeignKey("cities.id"), nullable=False)
    jurisdiction_id  = Column(UUID(as_uuid=True), ForeignKey("jurisdictions.id"))
    name             = Column(String(300), nullable=False)
    code             = Column(String(50), nullable=False)
    branch_type      = Column(String(30), nullable=False)   # CHECK constraint below
    address          = Column(Text)
    contact_phone    = Column(String(20))
    contact_email    = Column(String(255))
    head_official_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"))
    is_active        = Column(Boolean, nullable=False, default=True)
    extra_meta       = Column("metadata", JSONB, nullable=False, default=dict)
    created_at       = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at       = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    __table_args__ = (
        CheckConstraint(
            "branch_type IN ('zonal_office','ward_office','sub_division',"
            "'divisional_office','regional_office','helpdesk')",
            name="department_branches_branch_type_check",
        ),
    )


class InfraType(Base):
    __tablename__ = "infra_types"

    id                    = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name                  = Column(String(100), nullable=False)
    code                  = Column(String(30), nullable=False, unique=True)
    default_dept_ids      = Column(ARRAY(UUID(as_uuid=True)), nullable=False, default=list)
    cluster_radius_meters = Column(Integer, nullable=False, default=50)
    repeat_alert_years    = Column(Integer, nullable=False, default=3)
    icon_url              = Column(Text)
    extra_meta            = Column("metadata", JSONB, nullable=False, default=dict)
    created_at            = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


# ============================================================
# LAYER 2 — USERS & ACTORS
# ============================================================

class User(Base):
    __tablename__ = "users"

    id                 = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    city_id            = Column(UUID(as_uuid=True), ForeignKey("cities.id"))
    department_id      = Column(UUID(as_uuid=True), ForeignKey("departments.id"))
    jurisdiction_id    = Column(UUID(as_uuid=True), ForeignKey("jurisdictions.id"))
    email              = Column(String(255), unique=True)
    phone              = Column(String(20), unique=True)
    full_name          = Column(String(300), nullable=False)
    preferred_language = Column(String(10), nullable=False, default="hi")
    role               = Column(String(20), nullable=False)
    is_active          = Column(Boolean, nullable=False, default=True)
    is_verified        = Column(Boolean, nullable=False, default=False)
    auth_uid           = Column(String(255), unique=True)
    auth_provider      = Column(String(30), nullable=False, default="phone_otp")
    fcm_token          = Column(Text)
    twilio_opt_in      = Column(Boolean, nullable=False, default=True)
    email_opt_in       = Column(Boolean, nullable=False, default=True)
    extra_meta         = Column("metadata", JSONB, nullable=False, default=dict)
    created_at         = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at         = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    __table_args__ = (
        CheckConstraint("email IS NOT NULL OR phone IS NOT NULL", name="chk_user_contact"),
    )


class Contractor(Base):
    __tablename__ = "contractors"

    id                   = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id              = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    city_id              = Column(UUID(as_uuid=True), ForeignKey("cities.id"), nullable=False)
    company_name         = Column(String(400), nullable=False)
    registration_number  = Column(String(100), nullable=False)
    registered_dept_ids  = Column(ARRAY(UUID(as_uuid=True)), nullable=False, default=list)
    license_expiry       = Column(Date)
    max_concurrent_tasks = Column(Integer, nullable=False, default=5)
    performance_score    = Column(Numeric(4, 2), nullable=False, default=5.0)
    is_blacklisted       = Column(Boolean, nullable=False, default=False)
    blacklist_reason     = Column(Text)
    blacklisted_at       = Column(DateTime(timezone=True))
    blacklisted_by       = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    extra_meta           = Column("metadata", JSONB, nullable=False, default=dict)
    created_at           = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at           = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


class Worker(Base):
    __tablename__ = "workers"

    id                 = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id            = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    department_id      = Column(UUID(as_uuid=True), ForeignKey("departments.id"))
    contractor_id      = Column(UUID(as_uuid=True), ForeignKey("contractors.id"))
    employee_id        = Column(String(100))
    skills             = Column(ARRAY(Text), nullable=False, default=list)
    is_available       = Column(Boolean, nullable=False, default=True)
    current_task_count = Column(Integer, nullable=False, default=0)
    performance_score  = Column(Numeric(4, 2), nullable=False, default=5.0)
    extra_meta         = Column("metadata", JSONB, nullable=False, default=dict)
    created_at         = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at         = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


# ============================================================
# LAYER 3 — INFRASTRUCTURE
# ============================================================

class InfraNode(Base):
    __tablename__ = "infra_nodes"

    id                        = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    city_id                   = Column(UUID(as_uuid=True), ForeignKey("cities.id"), nullable=False)
    jurisdiction_id           = Column(UUID(as_uuid=True), ForeignKey("jurisdictions.id"))
    infra_type_id             = Column(UUID(as_uuid=True), ForeignKey("infra_types.id"), nullable=False)
    name                      = Column(String(400))
    location                  = Column(Geometry("GEOMETRY", srid=4326), nullable=False)
    location_hash             = Column(String)
    status                    = Column(String(30), nullable=False, default="operational")
    attributes                = Column(JSONB, nullable=False, default=dict)
    last_resolved_at          = Column(DateTime(timezone=True))
    last_resolved_workflow_id = Column(UUID(as_uuid=True))
    total_complaint_count     = Column(Integer, nullable=False, default=0)
    total_resolved_count      = Column(Integer, nullable=False, default=0)
    is_deleted                = Column(Boolean, nullable=False, default=False)
    deleted_at                = Column(DateTime(timezone=True))
    deleted_by                = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    deletion_reason           = Column(Text)
    created_at                = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at                = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


class AssetHealthLog(Base):
    __tablename__ = "asset_health_logs"

    id                       = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    infra_node_id            = Column(UUID(as_uuid=True), ForeignKey("infra_nodes.id", ondelete="CASCADE"), nullable=False)
    health_score             = Column(Numeric(4, 2))
    open_complaint_count     = Column(Integer, nullable=False, default=0)
    resolved_complaint_count = Column(Integer, nullable=False, default=0)
    avg_resolution_days      = Column(Numeric(8, 2))
    last_complaint_at        = Column(DateTime(timezone=True))
    computed_at              = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


# ============================================================
# LAYER 4 — COMPLAINTS
# ============================================================

class Complaint(Base):
    __tablename__ = "complaints"

    id                           = Column(UUID(as_uuid=True), nullable=False, default=uuid.uuid4, primary_key=True)
    complaint_number             = Column(String(30), nullable=False)
    citizen_id                   = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    city_id                      = Column(UUID(as_uuid=True), ForeignKey("cities.id"), nullable=False)
    jurisdiction_id              = Column(UUID(as_uuid=True), ForeignKey("jurisdictions.id"))
    infra_node_id                = Column(UUID(as_uuid=True), ForeignKey("infra_nodes.id"))
    workflow_instance_id         = Column(UUID(as_uuid=True))
    title                        = Column(String(500), nullable=False)
    description                  = Column(Text, nullable=False)
    original_language            = Column(String(10), nullable=False, default="hi")
    translated_description       = Column(Text)
    location                     = Column(Geometry("POINT", srid=4326), nullable=False)
    address_text                 = Column(Text)
    images                       = Column(JSONB, nullable=False, default=list)
    voice_recording_url          = Column(Text)
    voice_transcript             = Column(Text)
    voice_transcript_language    = Column(String(10))
    status                       = Column(String(30), nullable=False, default="received")
    priority                     = Column(String(20), nullable=False, default="normal")
    is_repeat_complaint          = Column(Boolean, nullable=False, default=False)
    repeat_previous_complaint_id = Column(UUID(as_uuid=True))
    repeat_previous_resolved_at  = Column(DateTime(timezone=True))
    repeat_gap_days              = Column(Integer)
    is_emergency                 = Column(Boolean, nullable=False, default=False)
    emergency_bypass_at          = Column(DateTime(timezone=True))
    emergency_bypass_by          = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    emergency_bypass_reason      = Column(Text)
    emergency_audit_trail        = Column(JSONB, nullable=False, default=dict)
    is_cluster_primary           = Column(Boolean, nullable=False, default=False)
    agent_summary                = Column(Text)
    agent_priority_reason        = Column(Text)
    agent_suggested_dept_ids     = Column(ARRAY(UUID(as_uuid=True)), nullable=False, default=list)
    is_recomplaint               = Column(Boolean, nullable=False, default=False)
    parent_complaint_id          = Column(UUID(as_uuid=True))
    resolved_at                  = Column(DateTime(timezone=True))
    rejected_reason              = Column(Text)
    is_deleted                   = Column(Boolean, nullable=False, default=False)
    deleted_at                   = Column(DateTime(timezone=True))
    deleted_by                   = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    deletion_reason              = Column(Text)
    created_at                   = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), primary_key=True)
    updated_at                   = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    __table_args__ = (
        {"postgresql_partition_by": "RANGE (created_at)"},
    )


class ComplaintStatusHistory(Base):
    __tablename__ = "complaint_status_history"

    id           = Column(UUID(as_uuid=True), nullable=False, default=uuid.uuid4, primary_key=True)
    complaint_id = Column(UUID(as_uuid=True), nullable=False)
    old_status   = Column(String(30))
    new_status   = Column(String(30), nullable=False)
    changed_by   = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    reason       = Column(Text)
    extra_meta   = Column("metadata", JSONB, nullable=False, default=dict)
    created_at   = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), primary_key=True)

    __table_args__ = (
        {"postgresql_partition_by": "RANGE (created_at)"},
    )


class ComplaintCluster(Base):
    __tablename__ = "complaint_clusters"

    id                   = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    infra_node_id        = Column(UUID(as_uuid=True), ForeignKey("infra_nodes.id"), nullable=False)
    primary_complaint_id = Column(UUID(as_uuid=True), nullable=False)
    complaint_count      = Column(Integer, nullable=False, default=1)
    cluster_summary      = Column(Text)
    created_at           = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at           = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


class ComplaintClusterMember(Base):
    __tablename__ = "complaint_cluster_members"

    cluster_id   = Column(UUID(as_uuid=True), ForeignKey("complaint_clusters.id", ondelete="CASCADE"), nullable=False, primary_key=True)
    complaint_id = Column(UUID(as_uuid=True), nullable=False, primary_key=True)
    joined_at    = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


class ComplaintEmbedding(Base):
    __tablename__ = "complaint_embeddings"

    complaint_id    = Column(UUID(as_uuid=True), primary_key=True)
    text_embedding  = Column(Vector(768), nullable=False)
    image_embedding = Column(Vector(768))
    model_version   = Column(String(100), nullable=False, default="nomic-embed-text-v1.5")
    embedded_at     = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


# ============================================================
# LAYER 5 — WORKFLOW ENGINE
# ============================================================

class WorkflowTemplate(Base):
    """
    Named base template. Aligned with final.sql workflow_templates table.
    Includes AI-learning columns: situation_summary, situation_keywords,
    times_used, avg_completion_days, last_used_at, source_complaint_ids.
    """
    __tablename__ = "workflow_templates"

    id                   = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    city_id              = Column(UUID(as_uuid=True), ForeignKey("cities.id"), nullable=False)
    name                 = Column(String(300), nullable=False)
    description          = Column(Text)
    created_by           = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    created_at           = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    # AI-learning / recommendation columns (from final.sql)
    situation_summary    = Column(Text)
    situation_keywords   = Column(ARRAY(Text), nullable=False, default=list)
    situation_infra_codes= Column(ARRAY(Text), nullable=False, default=list)
    times_used           = Column(Integer, nullable=False, default=0)
    avg_completion_days  = Column(Numeric(5, 1))
    last_used_at         = Column(DateTime(timezone=True))
    source_complaint_ids = Column(ARRAY(UUID(as_uuid=True)), nullable=False, default=list)


class WorkflowTemplateVersion(Base):
    __tablename__ = "workflow_template_versions"

    id                  = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    template_id         = Column(UUID(as_uuid=True), ForeignKey("workflow_templates.id"), nullable=False)
    city_id             = Column(UUID(as_uuid=True), ForeignKey("cities.id"), nullable=False)
    jurisdiction_id     = Column(UUID(as_uuid=True), ForeignKey("jurisdictions.id"))
    infra_type_id       = Column(UUID(as_uuid=True), ForeignKey("infra_types.id"))
    version             = Column(Integer, nullable=False)
    is_active           = Column(Boolean, nullable=False, default=True)
    is_latest_version   = Column(Boolean, nullable=False, default=True)
    previous_version_id = Column(UUID(as_uuid=True), ForeignKey("workflow_template_versions.id"))
    notes               = Column(Text)
    created_by          = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    created_at          = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    __table_args__ = (UniqueConstraint("template_id", "version"),)


class WorkflowTemplateStep(Base):
    """
    Steps tied to a specific version.
    Columns: version_id, step_number, department_id, step_name,
             description, expected_duration_hours, is_optional,
             requires_tender, work_type_codes.
    NOTE: There is no responsible_role, requires_photo, requires_approval —
          those are from an older schema. Use department_id for routing.
    """
    __tablename__ = "workflow_template_steps"

    id                      = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    version_id              = Column(UUID(as_uuid=True), ForeignKey("workflow_template_versions.id", ondelete="CASCADE"), nullable=False)
    step_number             = Column(Integer, nullable=False)
    department_id           = Column(UUID(as_uuid=True), ForeignKey("departments.id"), nullable=False)
    step_name               = Column(String(300), nullable=False)
    description             = Column(Text)
    expected_duration_hours = Column(Integer)
    is_optional             = Column(Boolean, nullable=False, default=False)
    requires_tender         = Column(Boolean, nullable=False, default=False)
    work_type_codes         = Column(ARRAY(Text), nullable=False, default=list)
    extra_meta              = Column("metadata", JSONB, nullable=False, default=dict)
    created_at              = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    __table_args__ = (UniqueConstraint("version_id", "step_number"),)


class WorkflowStepDependency(Base):
    __tablename__ = "workflow_step_dependencies"

    step_id            = Column(UUID(as_uuid=True), ForeignKey("workflow_template_steps.id", ondelete="CASCADE"), nullable=False, primary_key=True)
    depends_on_step_id = Column(UUID(as_uuid=True), ForeignKey("workflow_template_steps.id", ondelete="CASCADE"), nullable=False, primary_key=True)

    __table_args__ = (
        CheckConstraint("step_id != depends_on_step_id", name="chk_no_self_dependency"),
    )


class WorkflowInstance(Base):
    __tablename__ = "workflow_instances"

    id                  = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    infra_node_id       = Column(UUID(as_uuid=True), ForeignKey("infra_nodes.id"), nullable=False)
    template_id         = Column(UUID(as_uuid=True), ForeignKey("workflow_templates.id"), nullable=False)
    version_id          = Column(UUID(as_uuid=True), ForeignKey("workflow_template_versions.id"), nullable=False)
    jurisdiction_id     = Column(UUID(as_uuid=True), ForeignKey("jurisdictions.id"))
    status              = Column(String(30), nullable=False, default="active")
    mode                = Column(String(20), nullable=False, default="normal")
    current_step_number = Column(Integer, nullable=False, default=1)
    total_steps         = Column(Integer, nullable=False)
    started_at          = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    completed_at        = Column(DateTime(timezone=True))
    blocked_reason      = Column(Text)
    blocked_until       = Column(Date)
    is_emergency        = Column(Boolean, nullable=False, default=False)
    emergency_bypass_log= Column(JSONB, nullable=False, default=dict)
    created_by          = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    created_at          = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at          = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


class WorkflowStepInstance(Base):
    __tablename__ = "workflow_step_instances"

    id                      = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workflow_instance_id    = Column(UUID(as_uuid=True), ForeignKey("workflow_instances.id", ondelete="CASCADE"), nullable=False)
    template_step_id        = Column(UUID(as_uuid=True), ForeignKey("workflow_template_steps.id"), nullable=False)
    step_number             = Column(Integer, nullable=False)
    department_id           = Column(UUID(as_uuid=True), ForeignKey("departments.id"), nullable=False)
    step_name               = Column(String(300), nullable=False)
    status                  = Column(String(30), nullable=False, default="pending")
    assigned_official_id    = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    unlocked_at             = Column(DateTime(timezone=True))
    started_at              = Column(DateTime(timezone=True))
    expected_completion_at  = Column(DateTime(timezone=True))
    completed_at            = Column(DateTime(timezone=True))
    constraint_block_id     = Column(UUID(as_uuid=True), ForeignKey("workflow_constraints.id"))
    legally_blocked_at      = Column(DateTime(timezone=True))
    legally_blocked_until   = Column(Date)
    agent_summary           = Column(Text)
    agent_priority          = Column(String(20))
    created_at              = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at              = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    __table_args__ = (UniqueConstraint("workflow_instance_id", "step_number"),)


class WorkflowComplaints(Base):
    __tablename__ = "workflow_complaints"

    workflow_instance_id     = Column(UUID(as_uuid=True), ForeignKey("workflow_instances.id", ondelete="CASCADE"), nullable=False, primary_key=True)
    complaint_id             = Column(UUID(as_uuid=True), nullable=False, primary_key=True)
    attached_at              = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    attached_by_agent_log_id = Column(UUID(as_uuid=True), ForeignKey("agent_logs.id"))


class WorkflowStatusHistory(Base):
    __tablename__ = "workflow_status_history"

    id                   = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workflow_instance_id = Column(UUID(as_uuid=True), ForeignKey("workflow_instances.id", ondelete="CASCADE"), nullable=False)
    old_status           = Column(String(30))
    new_status           = Column(String(30), nullable=False)
    changed_by           = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    change_source        = Column(String(30), nullable=False, default="system")
    reason               = Column(Text)
    state_snapshot       = Column(JSONB, nullable=False, default=dict)
    created_at           = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


# ============================================================
# LAYER 6 — TASKS
# ============================================================

class Task(Base):
    __tablename__ = "tasks"

    id                        = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    task_number               = Column(String(30), nullable=False, unique=True)
    workflow_step_instance_id = Column(UUID(as_uuid=True), ForeignKey("workflow_step_instances.id"))
    complaint_id              = Column(UUID(as_uuid=True))
    department_id             = Column(UUID(as_uuid=True), ForeignKey("departments.id"), nullable=False)
    jurisdiction_id           = Column(UUID(as_uuid=True), ForeignKey("jurisdictions.id"))
    assigned_official_id      = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    assigned_worker_id        = Column(UUID(as_uuid=True), ForeignKey("workers.id"))
    assigned_contractor_id    = Column(UUID(as_uuid=True), ForeignKey("contractors.id"))
    title                     = Column(String(500), nullable=False)
    description               = Column(Text)
    status                    = Column(String(30), nullable=False, default="pending")
    priority                  = Column(String(20), nullable=False, default="normal")
    override_reason_code      = Column(String(30))
    override_notes            = Column(Text)
    override_by               = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    override_at               = Column(DateTime(timezone=True))
    previous_assignee         = Column(JSONB)
    due_at                    = Column(DateTime(timezone=True))
    started_at                = Column(DateTime(timezone=True))
    completed_at              = Column(DateTime(timezone=True))
    before_photos             = Column(JSONB, nullable=False, default=list)
    after_photos              = Column(JSONB, nullable=False, default=list)
    progress_photos           = Column(JSONB, nullable=False, default=list)
    completion_notes          = Column(Text)
    completion_location       = Column(Geometry("POINT", srid=4326))
    agent_summary             = Column(Text)
    is_deleted                = Column(Boolean, nullable=False, default=False)
    deleted_at                = Column(DateTime(timezone=True))
    deleted_by                = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    deletion_reason           = Column(Text)
    created_at                = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at                = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


class TaskStatusHistory(Base):
    __tablename__ = "task_status_history"

    id         = Column(UUID(as_uuid=True), nullable=False, default=uuid.uuid4, primary_key=True)
    task_id    = Column(UUID(as_uuid=True), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False)
    old_status = Column(String(30))
    new_status = Column(String(30), nullable=False)
    changed_by = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    reason     = Column(Text)
    extra_meta = Column("metadata", JSONB, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    __table_args__ = (
        {"postgresql_partition_by": "RANGE (created_at)"},
    )


class TaskSLA(Base):
    __tablename__ = "task_sla"

    task_id         = Column(UUID(as_uuid=True), ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True)
    sla_hours       = Column(Integer, nullable=False)
    started_at      = Column(DateTime(timezone=True))
    due_at          = Column(DateTime(timezone=True), nullable=False)
    is_breached     = Column(Boolean, nullable=False, default=False)
    breached_at     = Column(DateTime(timezone=True))
    warning_sent_at = Column(DateTime(timezone=True))
    escalation_log  = Column(JSONB, nullable=False, default=list)
    created_at      = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at      = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


# ============================================================
# LAYER 7 — EMERGENCY POSTHOC TASKS
# ============================================================

class EmergencyPosthocTask(Base):
    __tablename__ = "emergency_posthoc_tasks"

    id                        = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workflow_instance_id      = Column(UUID(as_uuid=True), ForeignKey("workflow_instances.id", ondelete="CASCADE"), nullable=False)
    complaint_id              = Column(UUID(as_uuid=True), nullable=False)
    original_template_step_id = Column(UUID(as_uuid=True), ForeignKey("workflow_template_steps.id"), nullable=False)
    step_number               = Column(Integer, nullable=False)
    step_name                 = Column(String(300), nullable=False)
    department_id             = Column(UUID(as_uuid=True), ForeignKey("departments.id"), nullable=False)
    assigned_official_id      = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    documentation_type        = Column(String(50), nullable=False)
    instructions              = Column(Text, nullable=False)
    is_mandatory              = Column(Boolean, nullable=False, default=True)
    status                    = Column(String(30), nullable=False, default="pending")
    waived_by                 = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    waived_reason             = Column(Text)
    uploaded_documents        = Column(JSONB, nullable=False, default=list)
    completion_notes          = Column(Text)
    due_within_hours          = Column(Integer, nullable=False, default=48)
    emergency_bypass_at       = Column(DateTime(timezone=True), nullable=False)
    due_at                    = Column(DateTime(timezone=True), nullable=False)
    completed_at              = Column(DateTime(timezone=True))
    created_at                = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at                = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


# ============================================================
# LAYER 8 — TENDERS
# ============================================================

class Tender(Base):
    __tablename__ = "tenders"

    id                        = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tender_number             = Column(String(30), nullable=False, unique=True)
    department_id             = Column(UUID(as_uuid=True), ForeignKey("departments.id"), nullable=False)
    workflow_step_instance_id = Column(UUID(as_uuid=True), ForeignKey("workflow_step_instances.id"))
    complaint_id              = Column(UUID(as_uuid=True))
    requested_by              = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    title                     = Column(String(500), nullable=False)
    description               = Column(Text)
    scope_of_work             = Column(Text)
    estimated_cost            = Column(Numeric(15, 2))
    final_cost                = Column(Numeric(15, 2))
    status                    = Column(String(30), nullable=False, default="draft")
    approved_by               = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    rejected_by               = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    awarded_to_contractor_id  = Column(UUID(as_uuid=True), ForeignKey("contractors.id"))
    documents                 = Column(JSONB, nullable=False, default=list)
    approval_notes            = Column(Text)
    rejection_reason          = Column(Text)
    submitted_at              = Column(DateTime(timezone=True))
    approved_at               = Column(DateTime(timezone=True))
    awarded_at                = Column(DateTime(timezone=True))
    due_date                  = Column(Date)
    created_at                = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at                = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


# ============================================================
# LAYER 9 — SURVEYS
# ============================================================

class SurveyTemplate(Base):
    __tablename__ = "survey_templates"

    id                  = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name                = Column(String(300), nullable=False)
    survey_type         = Column(String(30), nullable=False)
    trigger_at_step_pct = Column(SmallInteger, default=50)
    questions           = Column(JSONB, nullable=False)
    is_active           = Column(Boolean, nullable=False, default=True)
    created_by          = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    created_at          = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


class SurveyInstance(Base):
    """
    Aligned with final.sql:
      template_id(NN), target_user_id(NN), target_role(NN),
      triggered_by, channel, status, expires_at
    Note: city_id does NOT exist on this table in final.sql.
    """
    __tablename__ = "survey_instances"

    id                   = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    template_id          = Column(UUID(as_uuid=True), ForeignKey("survey_templates.id"), nullable=False)
    workflow_instance_id = Column(UUID(as_uuid=True), ForeignKey("workflow_instances.id"))
    complaint_id         = Column(UUID(as_uuid=True))
    survey_type          = Column(String(30), nullable=False)
    target_user_id       = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    target_role          = Column(String(30), nullable=False)
    status               = Column(String(20), nullable=False, default="pending")
    triggered_by         = Column(String(20), nullable=False, default="agent")
    channel              = Column(String(20), nullable=False, default="whatsapp")
    related_location     = Column(Geometry("POINT", srid=4326))
    triggered_at         = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    sent_at              = Column(DateTime(timezone=True))
    opened_at            = Column(DateTime(timezone=True))
    completed_at         = Column(DateTime(timezone=True))
    expires_at           = Column(DateTime(timezone=True))
    created_at           = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


class SurveyResponse(Base):
    """
    Aligned with final.sql:
      answers(JSONB NN), overall_rating(numeric 1-5), feedback_text
    No respondent_role, rating, is_resolved, wants_followup, response_data columns.
    Those are encoded inside answers JSONB.
    """
    __tablename__ = "survey_responses"

    id                 = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    survey_instance_id = Column(UUID(as_uuid=True), ForeignKey("survey_instances.id"), nullable=False)
    respondent_id      = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    answers            = Column(JSONB, nullable=False)
    overall_rating     = Column(Numeric(3, 1))
    feedback_text      = Column(Text)
    submitted_at       = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


# ============================================================
# LAYER 10 — NOTIFICATIONS
# ============================================================

class NotificationTemplate(Base):
    __tablename__ = "notification_templates"

    id               = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name             = Column(String(300), nullable=False)
    event_type       = Column(String(100), nullable=False)
    channel          = Column(String(30), nullable=False)
    language         = Column(String(10), nullable=False, default="hi")
    subject_template = Column(Text)
    body_template    = Column(Text, nullable=False)
    is_active        = Column(Boolean, nullable=False, default=True)
    created_at       = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    __table_args__ = (UniqueConstraint("event_type", "channel", "language"),)


class NotificationLog(Base):
    """
    Aligned with final.sql notification_logs:
      recipient_user_id(NN), recipient_contact(NN), channel(NN),
      event_type(NN), complaint_id, task_id, survey_instance_id,
      payload(JSONB), status
    """
    __tablename__ = "notification_logs"

    id                  = Column(UUID(as_uuid=True), nullable=False, default=uuid.uuid4, primary_key=True)
    template_id         = Column(UUID(as_uuid=True), ForeignKey("notification_templates.id"))
    recipient_user_id   = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    recipient_contact   = Column(String(255), nullable=False)
    channel             = Column(String(30), nullable=False)
    event_type          = Column(String(100), nullable=False)
    complaint_id        = Column(UUID(as_uuid=True))
    task_id             = Column(UUID(as_uuid=True), ForeignKey("tasks.id"))
    survey_instance_id  = Column(UUID(as_uuid=True), ForeignKey("survey_instances.id"))
    payload             = Column(JSONB, nullable=False, default=dict)
    status              = Column(String(20), nullable=False, default="pending")
    external_message_id = Column(String(255))
    error_message       = Column(Text)
    sent_at             = Column(DateTime(timezone=True))
    delivered_at        = Column(DateTime(timezone=True))
    created_at          = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    __table_args__ = (
        {"postgresql_partition_by": "RANGE (created_at)"},
    )


class AreaNotificationSubscription(Base):
    __tablename__ = "area_notification_subscriptions"

    id                 = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id            = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    location           = Column(Geometry("POINT", srid=4326), nullable=False)
    radius_meters      = Column(Integer, nullable=False, default=5000)
    preferred_channels = Column(ARRAY(Text), nullable=False, default=list)
    is_active          = Column(Boolean, nullable=False, default=True)
    created_at         = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at         = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


# ============================================================
# LAYER 11 — GCP INTEGRATION
# ============================================================

class PubSubEventLog(Base):
    __tablename__ = "pubsub_event_log"

    id                   = Column(UUID(as_uuid=True), nullable=False, default=uuid.uuid4, primary_key=True)
    event_type           = Column(String(100), nullable=False)
    pubsub_topic         = Column(String(300))
    pubsub_message_id    = Column(String(200))
    published_at         = Column(DateTime(timezone=True))
    ack_at               = Column(DateTime(timezone=True))
    payload              = Column(JSONB, nullable=False, default=dict)
    city_id              = Column(UUID(as_uuid=True), ForeignKey("cities.id"))
    complaint_id         = Column(UUID(as_uuid=True))
    workflow_instance_id = Column(UUID(as_uuid=True), ForeignKey("workflow_instances.id"))
    task_id              = Column(UUID(as_uuid=True), ForeignKey("tasks.id"))
    user_id              = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    processed_by         = Column(String(200))
    processing_status    = Column(String(20), nullable=False, default="published")
    retry_count          = Column(SmallInteger, nullable=False, default=0)
    error_message        = Column(Text)
    processed_at         = Column(DateTime(timezone=True))
    created_at           = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    __table_args__ = (
        {"postgresql_partition_by": "RANGE (created_at)"},
    )


class CloudTaskSchedule(Base):
    __tablename__ = "cloud_task_schedule"

    id                     = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    cloud_task_name        = Column(String(500), nullable=False, unique=True)
    queue_name             = Column(String(200), nullable=False)
    task_type              = Column(String(100), nullable=False)
    complaint_id           = Column(UUID(as_uuid=True))
    workflow_instance_id   = Column(UUID(as_uuid=True), ForeignKey("workflow_instances.id"))
    task_id                = Column(UUID(as_uuid=True), ForeignKey("tasks.id"))
    survey_instance_id     = Column(UUID(as_uuid=True), ForeignKey("survey_instances.id"))
    target_user_id         = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    payload                = Column(JSONB, nullable=False, default=dict)
    scheduled_for          = Column(DateTime(timezone=True), nullable=False)
    schedule_delay_seconds = Column(Integer, nullable=False, default=0)
    status                 = Column(String(20), nullable=False, default="scheduled")
    retry_count            = Column(SmallInteger, nullable=False, default=0)
    error_message          = Column(Text)
    executed_at            = Column(DateTime(timezone=True))
    created_at             = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


# ============================================================
# LAYER 12 — AGENT LOGS
# ============================================================

class AgentLog(Base):
    __tablename__ = "agent_logs"

    id                   = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    agent_type           = Column(String(60), nullable=False)
    complaint_id         = Column(UUID(as_uuid=True))
    workflow_instance_id = Column(UUID(as_uuid=True), ForeignKey("workflow_instances.id"))
    task_id              = Column(UUID(as_uuid=True), ForeignKey("tasks.id"))
    input_data           = Column(JSONB, nullable=False, default=dict)
    output_data          = Column(JSONB, nullable=False, default=dict)
    action_taken         = Column(String(300))
    confidence_score     = Column(Numeric(5, 4))
    human_overridden     = Column(Boolean, nullable=False, default=False)
    override_by          = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    override_reason      = Column(Text)
    latency_ms           = Column(Integer)
    model_used           = Column(String(100))
    tokens_used          = Column(Integer)
    created_at           = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


# ============================================================
# LAYER 13 — PUBLIC ANNOUNCEMENTS
# ============================================================

class PublicAnnouncement(Base):
    __tablename__ = "public_announcements"

    id                   = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    city_id              = Column(UUID(as_uuid=True), ForeignKey("cities.id"), nullable=False)
    jurisdiction_id      = Column(UUID(as_uuid=True), ForeignKey("jurisdictions.id"))
    infra_node_id        = Column(UUID(as_uuid=True), ForeignKey("infra_nodes.id"))
    workflow_instance_id = Column(UUID(as_uuid=True), ForeignKey("workflow_instances.id"))
    title                = Column(String(500), nullable=False)
    content              = Column(Text, nullable=False)
    work_type            = Column(String(100))
    affected_area        = Column(Geometry("POLYGON", srid=4326))
    status               = Column(String(30), nullable=False)
    expected_start_date  = Column(Date)
    expected_end_date    = Column(Date)
    actual_end_date      = Column(Date)
    is_published         = Column(Boolean, nullable=False, default=False)
    published_at         = Column(DateTime(timezone=True))
    expires_at           = Column(DateTime(timezone=True))
    created_by           = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    created_at           = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at           = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


# ============================================================
# LAYER 14 — KPI SNAPSHOTS
# ============================================================

class OfficialPerformanceSnapshot(Base):
    __tablename__ = "official_performance_snapshots"

    id                        = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    official_id               = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    department_id             = Column(UUID(as_uuid=True), ForeignKey("departments.id"))
    snapshot_date             = Column(Date, nullable=False)
    tasks_assigned            = Column(Integer, nullable=False, default=0)
    tasks_completed           = Column(Integer, nullable=False, default=0)
    tasks_overdue             = Column(Integer, nullable=False, default=0)
    avg_resolution_hours      = Column(Numeric(8, 2))
    avg_survey_rating         = Column(Numeric(4, 2))
    override_count            = Column(Integer, nullable=False, default=0)
    override_reason_breakdown = Column(JSONB, nullable=False, default=dict)
    complaints_handled        = Column(Integer, nullable=False, default=0)
    emergency_bypasses        = Column(Integer, nullable=False, default=0)
    posthoc_tasks_pending     = Column(Integer, nullable=False, default=0)
    created_at                = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    __table_args__ = (UniqueConstraint("official_id", "snapshot_date"),)


class ContractorPerformanceSnapshot(Base):
    __tablename__ = "contractor_performance_snapshots"

    id                   = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    contractor_id        = Column(UUID(as_uuid=True), ForeignKey("contractors.id"), nullable=False)
    snapshot_date        = Column(Date, nullable=False)
    tasks_completed      = Column(Integer, nullable=False, default=0)
    tasks_overdue        = Column(Integer, nullable=False, default=0)
    avg_completion_hours = Column(Numeric(8, 2))
    avg_survey_rating    = Column(Numeric(4, 2))
    tenders_won          = Column(Integer, nullable=False, default=0)
    tenders_applied      = Column(Integer, nullable=False, default=0)
    created_at           = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    __table_args__ = (UniqueConstraint("contractor_id", "snapshot_date"),)


# ============================================================
# LAYER 15 — DOMAIN EVENTS
# ============================================================

class DomainEvent(Base):
    __tablename__ = "domain_events"

    id                   = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_type           = Column(String(100), nullable=False)
    entity_type          = Column(String(60), nullable=False)
    entity_id            = Column(UUID(as_uuid=True), nullable=False)
    actor_id             = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    actor_type           = Column(String(30))
    payload              = Column(JSONB, nullable=False, default=dict)
    complaint_id         = Column(UUID(as_uuid=True))
    workflow_instance_id = Column(UUID(as_uuid=True), ForeignKey("workflow_instances.id"))
    city_id              = Column(UUID(as_uuid=True), ForeignKey("cities.id"))
    created_at           = Column(DateTime(timezone=True), nullable=False, server_default=func.now())