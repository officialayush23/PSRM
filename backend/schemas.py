from typing import List, Optional
from uuid import UUID

from fastapi import UploadFile
from pydantic import BaseModel, ConfigDict, Field

class ComplaintCreate(BaseModel):
    text: str
    lat: float
    lng: float
    photo_url: Optional[str] = None


class ComplaintIngestRequest(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)

    citizen_id: UUID
    city_id: UUID
    city_code: str
    title: str
    description: str
    original_language: str
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    infra_type_id: UUID

    address_text: Optional[str] = None
    infra_name: Optional[str] = None
    priority: Optional[str] = "normal"
    voice_transcript: Optional[str] = None
    agent_summary: Optional[str] = None
    agent_priority_reason: Optional[str] = None
    agent_suggested_dept_ids: Optional[List[str]] = None
    embedding_model: Optional[str] = "nomic-embed-text-v1.5"

    images: List[UploadFile] = Field(default_factory=list)
    voice_recording: Optional[UploadFile] = None


class ComplaintIngestResponse(BaseModel):
    complaint_id: UUID
    complaint_number: str
    infra_node_id: UUID
    workflow_instance_id: Optional[UUID]
    is_repeat_complaint: bool
    is_new_infra_node: bool
    repeat_gap_days: Optional[int]
    jurisdiction_id: Optional[UUID]

class ComplaintResponse(BaseModel):
    id: int
    status: str
    message: str


class SignUpRequest(BaseModel):
    full_name: str
    email: str
    password: str
    city_code: Optional[str] = None
    preferred_language: Optional[str] = "hi"


class SignInRequest(BaseModel):
    email: str
    password: str


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user_id: UUID
    role: str
    email: str
    full_name: str


class TokenData(BaseModel):
    user_id: UUID
    role: str
    
class SurveySubmit(BaseModel):

    complaint_id: int
    rating: int
    comment: str
    

class AssistantQuery(BaseModel):
    query: str