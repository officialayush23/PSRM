from pathlib import Path
import logging
import json
from typing import Dict, Optional
from uuid import uuid4

from google.cloud import storage

from config import settings

BASE_DIR = Path(__file__).resolve().parents[1]
UPLOADS_DIR = BASE_DIR / "data" / "uploads"
EMBEDDINGS_DIR = BASE_DIR / "data" / "embeddings"
logger = logging.getLogger(__name__)


def _ensure_uploads_dir() -> None:
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)


def _ensure_embeddings_dir() -> None:
    EMBEDDINGS_DIR.mkdir(parents=True, exist_ok=True)


def _local_save(content: bytes, filename: str) -> str:
    _ensure_uploads_dir()
    suffix = Path(filename or "upload.bin").suffix
    path = UPLOADS_DIR / f"{uuid4()}{suffix}"
    path.write_bytes(content)
    return str(path)


def _gcs_upload(content: bytes, filename: str, content_type: Optional[str]) -> str:
    bucket_name = settings.GCS_BUCKET_NAME
    if not bucket_name:
        raise ValueError("GCS_BUCKET_NAME is not configured")

    suffix = Path(filename or "upload.bin").suffix
    object_name = f"{settings.GCS_UPLOAD_PREFIX}/{uuid4()}{suffix}"

    client = storage.Client(project=settings.GCS_PROJECT_ID)
    bucket = client.bucket(bucket_name)
    blob = bucket.blob(object_name)
    blob.upload_from_string(content, content_type=content_type or "application/octet-stream")

    return f"https://storage.googleapis.com/{bucket_name}/{object_name}"


def _gcs_upload_with_object_name(content: bytes, object_name: str, content_type: Optional[str]) -> str:
    bucket_name = settings.GCS_BUCKET_NAME
    if not bucket_name:
        raise ValueError("GCS_BUCKET_NAME is not configured")

    client = storage.Client(project=settings.GCS_PROJECT_ID)
    bucket = client.bucket(bucket_name)
    blob = bucket.blob(object_name)
    blob.upload_from_string(content, content_type=content_type or "application/octet-stream")

    return f"https://storage.googleapis.com/{bucket_name}/{object_name}"


def save_upload(content: bytes, filename: str, content_type: Optional[str]) -> Dict[str, str]:
    """Save upload locally for immediate processing, and optionally mirror to GCS."""
    local_path = _local_save(content, filename)

    if settings.GCS_ENABLED and settings.GCS_BUCKET_NAME:
        try:
            remote_url = _gcs_upload(content, filename, content_type)
            return {
                "local_path": local_path,
                "url": remote_url,
                "storage": "gcs",
            }
        except Exception as exc:
            if settings.GCS_STRICT_MODE:
                raise
            logger.warning("GCS upload failed, falling back to local storage: %s", exc)

    return {
        "local_path": local_path,
        "url": local_path,
        "storage": "local",
    }


def save_embedding_artifact(complaint_id: str, payload: Dict[str, object]) -> Dict[str, str]:
    """Persist embedding payload to local disk and optionally mirror it to GCS."""
    _ensure_embeddings_dir()
    local_path = EMBEDDINGS_DIR / f"{complaint_id}.json"
    content = json.dumps(payload, ensure_ascii=True).encode("utf-8")
    local_path.write_bytes(content)

    if settings.GCS_ENABLED and settings.GCS_BUCKET_NAME:
        object_name = f"{settings.GCS_EMBEDDINGS_PREFIX}/{complaint_id}.json"
        try:
            remote_url = _gcs_upload_with_object_name(content, object_name, "application/json")
            return {
                "local_path": str(local_path),
                "url": remote_url,
                "storage": "gcs",
            }
        except Exception as exc:
            if settings.GCS_STRICT_MODE:
                raise
            logger.warning("Embedding artifact upload failed, falling back to local storage: %s", exc)

    return {
        "local_path": str(local_path),
        "url": str(local_path),
        "storage": "local",
    }
