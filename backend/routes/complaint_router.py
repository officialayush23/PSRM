from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, UploadFile
from sqlalchemy.orm import Session

from db import get_db
from schemas import ComplaintIngestRequest, ComplaintIngestResponse
from services.complaint_service import ingest_complaint as ingest_complaint_service

router = APIRouter(prefix="/complaints", tags=["Complaints"])

@router.post("/ingest", response_model=ComplaintIngestResponse)
async def ingest_complaint(
    citizen_id: UUID = Form(...),
    city_id: UUID = Form(...),
    city_code: str = Form(...),
    title: str = Form(...),
    description: str = Form(...),
    original_language: str = Form("hi"),
    lat: float = Form(...),
    lng: float = Form(...),
    infra_type_id: UUID = Form(...),
    address_text: Optional[str] = Form(default=None),
    infra_name: Optional[str] = Form(default=None),
    priority: str = Form(default="normal"),
    voice_transcript: Optional[str] = Form(default=None),
    agent_summary: Optional[str] = Form(default=None),
    agent_priority_reason: Optional[str] = Form(default=None),
    embedding_model: str = Form(default="nomic-embed-text-v1.5"),
    agent_suggested_dept_ids: Optional[str] = Form(default=None),
    images: List[UploadFile] = File(default=[]),
    voice_recording: Optional[UploadFile] = File(default=None),
    db: Session = Depends(get_db),
):
    suggested_dept_ids = []
    if agent_suggested_dept_ids:
        suggested_dept_ids = [item.strip() for item in agent_suggested_dept_ids.split(",") if item.strip()]

    request = ComplaintIngestRequest(
        citizen_id=citizen_id,
        city_id=city_id,
        city_code=city_code,
        title=title,
        description=description,
        original_language=original_language,
        lat=lat,
        lng=lng,
        infra_type_id=infra_type_id,
        address_text=address_text,
        infra_name=infra_name,
        priority=priority,
        voice_transcript=voice_transcript,
        agent_summary=agent_summary,
        agent_priority_reason=agent_priority_reason,
        agent_suggested_dept_ids=suggested_dept_ids,
        embedding_model=embedding_model,
        images=images,
        voice_recording=voice_recording,
    )

    return await ingest_complaint_service(db, request)
