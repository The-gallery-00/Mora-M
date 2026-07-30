"""Upload storage helpers for local development and Cloud Run.

When GCS_BUCKET_NAME is set, original images are persisted to Google Cloud
Storage and served back through this OCR service. Without it, the service keeps
the current local /uploads behavior for LAN development.
"""
import mimetypes
import os
import shutil
from io import BytesIO
from pathlib import Path

from fastapi import HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse

try:
    from google.cloud import storage as gcs_storage
except ImportError:  # pragma: no cover - only valid when GCS is not configured
    gcs_storage = None


GCS_BUCKET_NAME = os.getenv("GCS_BUCKET_NAME", "").strip()
GCS_UPLOAD_PREFIX = os.getenv("GCS_UPLOAD_PREFIX", "uploads").strip().strip("/")

DEFAULT_LOCAL_DIR = (
    Path("/tmp/mora-uploads")
    if GCS_BUCKET_NAME
    else Path(__file__).resolve().parent.parent / "uploads"
)
UPLOAD_DIR = Path(os.getenv("MORA_UPLOAD_DIR", str(DEFAULT_LOCAL_DIR)))
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


def is_gcs_enabled() -> bool:
    return bool(GCS_BUCKET_NAME)


def _safe_image_name(image_name: str) -> str:
    if Path(image_name).name != image_name or image_name in {"", ".", ".."}:
        raise HTTPException(status_code=404, detail="Image not found")
    return image_name


def _object_name(image_name: str) -> str:
    safe_name = _safe_image_name(image_name)
    if not GCS_UPLOAD_PREFIX:
        return safe_name
    return f"{GCS_UPLOAD_PREFIX}/{safe_name}"


def _bucket():
    if not gcs_storage:
        raise RuntimeError("google-cloud-storage is required when GCS_BUCKET_NAME is set")
    return gcs_storage.Client().bucket(GCS_BUCKET_NAME)


def save_upload_file(file: UploadFile, image_name: str) -> Path:
    """Save the upload to a local path so the OCR pipeline can read it."""
    local_path = UPLOAD_DIR / _safe_image_name(image_name)
    with open(local_path, "wb") as output:
        shutil.copyfileobj(file.file, output)
    return local_path


def persist_image(local_path: Path, image_name: str, content_type: str | None) -> str:
    """Persist the original image and return the stable app-facing URL path."""
    if is_gcs_enabled():
        blob = _bucket().blob(_object_name(image_name))
        blob.upload_from_filename(
            str(local_path),
            content_type=content_type or mimetypes.guess_type(image_name)[0],
        )
    return f"/uploads/{image_name}"


def get_upload_response(image_name: str):
    """Return an uploaded image from GCS in production or disk in local dev."""
    safe_name = _safe_image_name(image_name)
    media_type = mimetypes.guess_type(safe_name)[0] or "application/octet-stream"

    if is_gcs_enabled():
        blob = _bucket().blob(_object_name(safe_name))
        if not blob.exists():
            raise HTTPException(status_code=404, detail="Image not found")
        data = blob.download_as_bytes()
        return StreamingResponse(
            BytesIO(data),
            media_type=blob.content_type or media_type,
        )

    local_path = UPLOAD_DIR / safe_name
    if not local_path.exists():
        raise HTTPException(status_code=404, detail="Image not found")
    return FileResponse(local_path, media_type=media_type)
