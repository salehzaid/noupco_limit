"""
Admin endpoints (e.g. DB backup). Only enabled when APP_ENV=local.
"""
import io
import os
import subprocess
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse, StreamingResponse

from app.dependencies import require_admin_key

# Ensure .env is loaded so APP_ENV and DATABASE_URL are available (backend/.env)
_env_path = Path(__file__).resolve().parent.parent.parent / ".env"
load_dotenv(_env_path)

router = APIRouter(prefix="/api/admin", tags=["admin"])


def _parse_db_url(url: str) -> dict | None:
    """Parse postgresql://user:password@host:port/dbname into components. Password may contain : or @."""
    if not url or not url.startswith("postgresql"):
        return None
    try:
        # Split from the right: .../dbname?options -> dbname
        rest = url.replace("postgresql://", "", 1).strip()
        if "/" not in rest:
            return None
        netloc_part, _, path = rest.rpartition("/")
        dbname = (path or "").split("?")[0].strip() or None
        if not dbname:
            return None
        # netloc_part is user:password@host:port (last @ separates user:pass from host:port)
        if "@" not in netloc_part:
            return None
        user_pass, _, host_port = netloc_part.rpartition("@")
        colon = user_pass.find(":")
        user = user_pass[:colon] if colon != -1 else user_pass
        password = user_pass[colon + 1 :] if colon != -1 else ""
        port = "5432"
        if ":" in host_port:
            host, port = host_port.rsplit(":", 1)
        else:
            host = host_port
        return {"host": host, "port": port, "user": user, "password": password, "dbname": dbname}
    except Exception:
        return None


@router.get("/db-backup")
def db_backup(_: None = Depends(require_admin_key)):
    """
    Generate a PostgreSQL dump and return it as a downloadable .sql file.
    Allowed only when APP_ENV=local (returns 403 otherwise).
    """
    if os.getenv("APP_ENV", "").lower() != "local":
        return JSONResponse(
            status_code=403,
            content={"detail": "DB backup is only allowed when APP_ENV=local"},
        )

    url = os.getenv("DATABASE_URL")
    parsed = _parse_db_url(url) if url else None
    if not parsed:
        return JSONResponse(
            status_code=500,
            content={"detail": "DATABASE_URL is missing or not a valid PostgreSQL URL"},
        )

    filename = f"nupco_limit_backup_{datetime.now().strftime('%Y%m%d_%H%M')}.sql"
    env = {**os.environ, "PGPASSWORD": parsed["password"]}

    try:
        result = subprocess.run(
            [
                "pg_dump",
                "-h", parsed["host"],
                "-p", parsed["port"],
                "-U", parsed["user"],
                "-d", parsed["dbname"],
                "--no-owner",
                "--no-acl",
                "-f", "-",
            ],
            env=env,
            capture_output=True,
            check=True,
            timeout=300,
        )
    except FileNotFoundError:
        return JSONResponse(
            status_code=503,
            content={
                "detail": "pg_dump not found. Install PostgreSQL client tools (e.g. on macOS: brew install postgresql, or use Postgres.app).",
            },
        )
    except subprocess.CalledProcessError as e:
        err = (e.stderr or b"").decode("utf-8", errors="replace").strip() or str(e)
        return JSONResponse(
            status_code=500,
            content={"detail": f"pg_dump failed: {err}"},
        )
    except subprocess.TimeoutExpired:
        return JSONResponse(status_code=504, content={"detail": "pg_dump timed out"})

    return StreamingResponse(
        io.BytesIO(result.stdout),
        media_type="application/sql",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
