"""FrameUp background-removal service.

Small FastAPI wrapper around rembg (u2net model), run locally so FrameUp's
"Remove background" action never depends on a paid third-party API.

Architecture: FrameUp frontend -> this service -> rembg/u2net -> transparent
PNG -> back to the FrameUp editor.

The rembg session is created once at startup and reused for every request
(rembg reloading the ONNX model per-request would make each call several
seconds slower for no reason).
"""

import io
import os

from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from PIL import Image
from rembg import new_session, remove

load_dotenv()

MODEL_NAME = "u2net"
MAX_UPLOAD_BYTES = int(os.environ.get("MAX_UPLOAD_BYTES", str(10 * 1024 * 1024)))
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get(
        "ALLOWED_ORIGINS",
        "http://localhost:5500,http://127.0.0.1:5500,http://localhost:8080,http://127.0.0.1:8080",
    ).split(",")
    if origin.strip()
]
ALLOWED_CONTENT_TYPES = {"image/png", "image/jpeg", "image/jpg", "image/webp"}

app = FastAPI(title="FrameUp Background Removal Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

# Created once at startup, reused for every /api/remove-background call.
_session = None


@app.on_event("startup")
def load_model():
    global _session
    _session = new_session(MODEL_NAME)


@app.get("/health")
def health():
    return {"status": "ok", "model": MODEL_NAME, "model_loaded": _session is not None}


@app.post("/api/remove-background")
async def remove_background(file: UploadFile = File(...)):
    if file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported image type: {file.content_type or 'unknown'}. "
            "Upload a PNG, JPEG, or WEBP image.",
        )

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty upload.")
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Image is too large. Limit is {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.",
        )

    try:
        # Confirms it's actually a decodable image before handing it to rembg.
        Image.open(io.BytesIO(raw)).verify()
    except Exception:
        raise HTTPException(status_code=400, detail="File is not a valid image.")

    if _session is None:
        raise HTTPException(status_code=503, detail="Background removal model is not ready yet.")

    try:
        output_bytes = remove(raw, session=_session)
    except Exception as error:  # noqa: BLE001 - surface as a clean 502, don't crash the app
        raise HTTPException(status_code=502, detail=f"Background removal failed: {error}")

    # Nothing above ever touches disk - raw bytes in, processed bytes out, both
    # held in memory only for the life of this request.
    return Response(content=output_bytes, media_type="image/png")
