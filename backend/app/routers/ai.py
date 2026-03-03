"""
AI report generation + settings management.
Supports Anthropic (Claude), OpenAI (GPT), and Google (Gemini).
Settings are stored in backend/ai_config.json.
"""
import json
import os
from pathlib import Path
from typing import Generator

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import require_admin_key
from app.models import Department, DepartmentMaxLimit, FacilityMaxLimit, Item

router = APIRouter(prefix="/api/ai", tags=["ai"])

# ─── Provider / Model catalogue ───────────────────────────────────────────────

PROVIDER_MODELS: dict[str, list[str]] = {
    "anthropic": ["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5"],
    "openai":    ["gpt-4o", "gpt-4o-mini", "o3-mini"],
    "gemini":    ["gemini-2.0-flash", "gemini-1.5-pro"],
}

PROVIDER_LABELS: dict[str, str] = {
    "anthropic": "Anthropic — Claude",
    "openai":    "OpenAI — ChatGPT",
    "gemini":    "Google — Gemini",
}

# ─── Config file helpers ──────────────────────────────────────────────────────

_CONFIG_PATH = Path(__file__).resolve().parent.parent.parent / "ai_config.json"


def _load_config() -> dict:
    """Load AI config from JSON, falling back to ANTHROPIC_API_KEY env var."""
    if _CONFIG_PATH.exists():
        try:
            return json.loads(_CONFIG_PATH.read_text())
        except Exception:
            pass
    return {
        "provider": "anthropic",
        "model": "claude-opus-4-6",
        "api_keys": {
            "anthropic": os.environ.get("ANTHROPIC_API_KEY", ""),
            "openai": "",
            "gemini": "",
        },
    }


def _save_config(config: dict) -> None:
    _CONFIG_PATH.write_text(json.dumps(config, indent=2, ensure_ascii=False))


def _mask_key(key: str) -> str:
    if not key or len(key) < 12:
        return ""
    return key[:10] + "•••" + key[-4:]


# ─── Settings endpoints ───────────────────────────────────────────────────────

class AiSettingsSaveBody(BaseModel):
    provider: str
    model: str
    api_keys: dict[str, str]  # empty string = keep existing key


@router.get("/settings")
def get_ai_settings():
    config = _load_config()
    keys = config.get("api_keys", {})
    return {
        "provider": config.get("provider", "anthropic"),
        "model": config.get("model", "claude-opus-4-6"),
        "masked_keys": {p: _mask_key(keys.get(p, "")) for p in PROVIDER_MODELS},
        "has_key":     {p: bool(keys.get(p, ""))       for p in PROVIDER_MODELS},
        "provider_models": PROVIDER_MODELS,
        "provider_labels": PROVIDER_LABELS,
    }


@router.post("/settings")
def save_ai_settings(
    body: AiSettingsSaveBody,
    _: None = Depends(require_admin_key),
):
    if body.provider not in PROVIDER_MODELS:
        raise HTTPException(400, f"Unknown provider: {body.provider}")
    if body.model not in PROVIDER_MODELS[body.provider]:
        raise HTTPException(400, f"Model '{body.model}' not valid for {body.provider}")

    config = _load_config()
    config["provider"] = body.provider
    config["model"] = body.model

    existing_keys = config.get("api_keys", {})
    for provider in PROVIDER_MODELS:
        new_val = body.api_keys.get(provider, "").strip()
        if new_val:
            existing_keys[provider] = new_val
    config["api_keys"] = existing_keys

    _save_config(config)
    return {"ok": True}


# ─── Department context builder ───────────────────────────────────────────────

def _build_department_context(
    db: Session, department_id: int, effective_year: int
) -> tuple[str | None, str | None]:
    dept_name = db.execute(
        select(Department.name).where(Department.id == department_id)
    ).scalar_one_or_none()
    if not dept_name:
        return None, None

    dml, i, fml = DepartmentMaxLimit, Item, FacilityMaxLimit

    total_items = db.execute(
        select(func.count()).select_from(dml)
        .where(dml.department_id == department_id)
        .where(dml.effective_year == effective_year)
    ).scalar() or 0

    total_qty = db.execute(
        select(func.sum(dml.max_quantity))
        .where(dml.department_id == department_id)
        .where(dml.effective_year == effective_year)
    ).scalar() or 0

    zero_count = db.execute(
        select(func.count()).select_from(dml)
        .where(dml.department_id == department_id)
        .where(dml.effective_year == effective_year)
        .where(dml.max_quantity == 0)
    ).scalar() or 0

    by_category = db.execute(
        select(i.category_ar, func.count(), func.sum(dml.max_quantity))
        .select_from(dml).join(i, dml.item_id == i.id)
        .where(dml.department_id == department_id)
        .where(dml.effective_year == effective_year)
        .where(i.category_ar.isnot(None))
        .group_by(i.category_ar)
        .order_by(func.sum(dml.max_quantity).desc())
        .limit(10)
    ).all()

    by_clinical = db.execute(
        select(i.clinical_use, func.count(), func.sum(dml.max_quantity))
        .select_from(dml).join(i, dml.item_id == i.id)
        .where(dml.department_id == department_id)
        .where(dml.effective_year == effective_year)
        .where(i.clinical_use.isnot(None))
        .group_by(i.clinical_use)
        .order_by(func.sum(dml.max_quantity).desc())
        .limit(8)
    ).all()

    top_items = db.execute(
        select(
            i.generic_item_number, i.generic_description,
            dml.max_quantity,
            func.coalesce(fml.total_max_quantity, 0).label("facility_total"),
            i.category_ar, i.clinical_use,
        )
        .select_from(dml).join(i, dml.item_id == i.id)
        .outerjoin(fml, dml.item_id == fml.item_id)
        .where(dml.department_id == department_id)
        .where(dml.effective_year == effective_year)
        .where(dml.max_quantity > 0)
        .order_by(dml.max_quantity.desc())
        .limit(15)
    ).all()

    zero_pct = zero_count * 100 // total_items if total_items else 0
    lines = [
        f"Department: {dept_name}",
        f"Year: {effective_year}",
        f"Total items with limits: {total_items}",
        f"Total department max quantity: {total_qty:,}",
        f"Items with zero quantity: {zero_count} ({zero_pct}%)",
        "",
        "Category breakdown (top 10 by total qty):",
    ]
    for cat, cnt, qty in by_category:
        lines.append(f"  - {cat}: {cnt} items, qty {qty:,}")

    lines += ["", "Clinical use breakdown (top 8):"]
    for cu, cnt, qty in by_clinical:
        lines.append(f"  - {cu}: {cnt} items, qty {qty:,}")

    lines += ["", "Top 15 items by department max qty:"]
    for r in top_items:
        desc = r.generic_description or "(no description)"
        share = f"{r.max_quantity * 100 // r.facility_total}%" if r.facility_total else "100%"
        lines.append(
            f"  - [{r.generic_item_number}] {desc}: "
            f"dept={r.max_quantity:,}, facility={r.facility_total:,} ({share})"
            + (f" | {r.category_ar}" if r.category_ar else "")
        )

    return dept_name, "\n".join(lines)


# ─── Provider streaming helpers ───────────────────────────────────────────────

def _stream_anthropic(prompt: str, model: str, api_key: str) -> Generator[str, None, None]:
    import anthropic
    client = anthropic.Anthropic(api_key=api_key)
    with client.messages.stream(
        model=model,
        max_tokens=2048,
        thinking={"type": "adaptive"},
        messages=[{"role": "user", "content": prompt}],
    ) as stream:
        for text in stream.text_stream:
            yield f"data: {json.dumps({'text': text})}\n\n"


def _stream_openai(prompt: str, model: str, api_key: str) -> Generator[str, None, None]:
    from openai import OpenAI
    client = OpenAI(api_key=api_key)
    stream = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": prompt}],
        stream=True,
    )
    for chunk in stream:
        delta = chunk.choices[0].delta.content
        if delta:
            yield f"data: {json.dumps({'text': delta})}\n\n"


def _stream_gemini(prompt: str, model: str, api_key: str) -> Generator[str, None, None]:
    import google.generativeai as genai
    genai.configure(api_key=api_key)
    model_obj = genai.GenerativeModel(model)
    response = model_obj.generate_content(prompt, stream=True)
    for chunk in response:
        if chunk.text:
            yield f"data: {json.dumps({'text': chunk.text})}\n\n"


# ─── Report endpoint ──────────────────────────────────────────────────────────

@router.get("/department-report")
def stream_department_report(
    department_id: int = Query(...),
    effective_year: int = Query(2025),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    """Stream an AI-generated analytical report for a department (SSE)."""
    dept_name, context = _build_department_context(db, department_id, effective_year)
    if not dept_name:
        raise HTTPException(404, "Department not found")

    config = _load_config()
    provider = config.get("provider", "anthropic")
    model = config.get("model", "claude-opus-4-6")
    api_key = config.get("api_keys", {}).get(provider, "").strip()

    # Fallback to env var for Anthropic
    if not api_key and provider == "anthropic":
        api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()

    if not api_key:
        raise HTTPException(500, f"No API key configured for {PROVIDER_LABELS.get(provider, provider)}")

    prompt = f"""You are a clinical supply chain analyst at NUPCO (National Unified Procurement Company) in Saudi Arabia.

Based on the following data about the **{dept_name}** department's medical supply limits for {effective_year}, write a concise analytical report in English covering:

1. Overall supply profile (scale, diversity, utilization)
2. Dominant supply categories and highest-volume items
3. Concerning patterns (e.g. high % of zero-quantity items, heavy concentration, over-allocation)
4. 2–3 specific, actionable recommendations for supply optimization

Data:
{context}

Write a clear, professional report in 3–5 paragraphs suitable for a supply chain manager."""

    def generate() -> Generator[str, None, None]:
        try:
            if provider == "anthropic":
                yield from _stream_anthropic(prompt, model, api_key)
            elif provider == "openai":
                yield from _stream_openai(prompt, model, api_key)
            elif provider == "gemini":
                yield from _stream_gemini(prompt, model, api_key)
            else:
                yield f"data: {json.dumps({'text': f'Unknown provider: {provider}'})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
        finally:
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
