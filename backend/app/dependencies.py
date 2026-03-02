"""
Shared dependencies (e.g. admin key check for sensitive endpoints).
"""
import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import HTTPException, Request

_env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(_env_path)


def require_admin_key(request: Request) -> None:
    """
    Require valid X-Admin-Key header for import/admin endpoints.
    - If ADMIN_KEY is not set in env: allow only when APP_ENV=local; otherwise 403.
    - If ADMIN_KEY is set: require X-Admin-Key header to match; otherwise 403.
    """
    admin_key = (os.getenv("ADMIN_KEY") or "").strip()
    app_env = (os.getenv("APP_ENV") or "").lower()
    provided = (request.headers.get("X-Admin-Key") or "").strip()

    if not admin_key:
        if app_env == "local":
            return
        raise HTTPException(status_code=403, detail="Admin key required or invalid")
    if provided != admin_key:
        raise HTTPException(status_code=403, detail="Admin key required or invalid")
