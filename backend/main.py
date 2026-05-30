from __future__ import annotations

import json
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

BASE_DIR = Path(__file__).resolve().parent
CAPTURE_DIR = BASE_DIR / "captured_images"
CAPTURE_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="AR Storytelling Capture Backend", version="0.1.0")

# Dev-friendly CORS. For production, replace allow_origins=["*"] with your deployed frontend URL.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/captured_images", StaticFiles(directory=str(CAPTURE_DIR)), name="captured_images")


def _safe_capture_id(value: str | None) -> str:
    if not value:
        value = datetime.now(timezone.utc).strftime("capture_%Y%m%dT%H%M%S%fZ")

    safe = re.sub(r"[^a-zA-Z0-9_-]", "_", value)
    return safe[:90] or datetime.now(timezone.utc).strftime("capture_%Y%m%dT%H%M%S%fZ")


def _parse_metadata(metadata_raw: str | None) -> dict[str, Any]:
    if not metadata_raw:
        return {}

    try:
        parsed = json.loads(metadata_raw)
        if not isinstance(parsed, dict):
            raise ValueError("metadata must be a JSON object")
        return parsed
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid metadata JSON: {exc}") from exc


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "captureFolder": str(CAPTURE_DIR),
    }


@app.post("/api/captures/page")
async def save_page_capture(
    image: UploadFile = File(...),
    metadata: str = Form(default="{}"),
) -> dict[str, Any]:
    if image.content_type not in {"image/jpeg", "image/jpg", "image/png", "image/webp"}:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported image type: {image.content_type}. Use JPEG, PNG, or WEBP.",
        )

    parsed_metadata = _parse_metadata(metadata)
    capture_id = _safe_capture_id(str(parsed_metadata.get("id") or ""))

    extension_by_type = {
        "image/jpeg": ".jpg",
        "image/jpg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
    }
    extension = extension_by_type.get(image.content_type, ".jpg")
    filename = f"{capture_id}{extension}"
    file_path = CAPTURE_DIR / filename

    counter = 1
    while file_path.exists():
        filename = f"{capture_id}_{counter}{extension}"
        file_path = CAPTURE_DIR / filename
        counter += 1

    try:
        with file_path.open("wb") as output_file:
            shutil.copyfileobj(image.file, output_file)
    finally:
        await image.close()

    metadata_filename = f"{file_path.stem}.json"
    metadata_path = CAPTURE_DIR / metadata_filename
    stored_metadata = {
        "captureId": file_path.stem,
        "filename": filename,
        "storedPath": f"backend/captured_images/{filename}",
        "publicUrl": f"/captured_images/{filename}",
        "contentType": image.content_type,
        "uploadedAtUtc": datetime.now(timezone.utc).isoformat(),
        "clientMetadata": parsed_metadata,
    }
    metadata_path.write_text(json.dumps(stored_metadata, indent=2), encoding="utf-8")

    return {
        **stored_metadata,
        "metadataFilename": metadata_filename,
        "metadataStoredPath": f"backend/captured_images/{metadata_filename}",
    }
