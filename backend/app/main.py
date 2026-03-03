import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import admin, ai, audit, hospitals, import_max_limits, max_limits

app = FastAPI()
app.include_router(import_max_limits.router)
app.include_router(max_limits.router)
app.include_router(audit.router)
app.include_router(admin.router)
app.include_router(hospitals.router)
app.include_router(ai.router)


def _get_allowed_origins() -> list[str]:
    origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:1111,http://127.0.0.1:1111")
    return [origin.strip() for origin in origins.split(",") if origin.strip()]


def _get_allowed_origin_regex() -> str | None:
    regex = os.getenv("ALLOWED_ORIGIN_REGEX", "").strip()
    return regex or None

app.add_middleware(
    CORSMiddleware,
    allow_origins=_get_allowed_origins(),
    allow_origin_regex=_get_allowed_origin_regex(),
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=False,
    expose_headers=["X-Total-Count"],
)


@app.get("/health")
def health():
    return {"status": "ok"}
