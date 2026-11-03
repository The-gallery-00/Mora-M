"""Short-lived, operation-scoped credentials issued only by the Spring gateway."""
import hashlib
import os

import jwt
from fastapi import HTTPException, Request


def is_auth_configured() -> bool:
    return len(os.getenv("OCR_SHARED_SECRET", "")) >= 32


def require_ocr_access(request: Request) -> None:
    secret = os.getenv("OCR_SHARED_SECRET", "")
    if not is_auth_configured():
        raise HTTPException(status_code=503, detail="OCR authentication is not configured")
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authentication required")
    key = hashlib.sha256(("mora-ocr-service:" + secret).encode("utf-8")).digest()
    try:
        claims = jwt.decode(
            header[7:], key, algorithms=["HS256"], audience="mora-ocr",
            issuer="mora-spring", options={"require": ["exp", "iat", "aud", "iss"]},
        )
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid service credential") from None

    path = request.url.path
    if path == "/api/scan" and request.method == "POST":
        operation = "scan"
    elif path == "/api/commit" and request.method == "POST":
        operation = "commit"
    elif "image_name" in request.path_params and request.method in {"GET", "DELETE"}:
        operation = "read" if request.method == "GET" else "delete"
        if claims.get("image_name") != request.path_params["image_name"]:
            raise HTTPException(status_code=403, detail="Service credential scope mismatch")
    else:
        raise HTTPException(status_code=403, detail="Service credential scope mismatch")
    if claims.get("operation") != operation:
        raise HTTPException(status_code=403, detail="Service credential scope mismatch")
