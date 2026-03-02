"""
AI-powered report generation for department supply limits.
Streams a Claude-generated analytical report via Server-Sent Events (SSE).
"""
import json
import os
from typing import Generator

import anthropic
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Department, DepartmentMaxLimit, FacilityMaxLimit, Item

router = APIRouter(prefix="/api/ai", tags=["ai"])


def _build_department_context(
    db: Session, department_id: int, effective_year: int
) -> tuple[str | None, str | None]:
    """Query department limits data and format it as a text context for Claude."""
    dept_name = db.execute(
        select(Department.name).where(Department.id == department_id)
    ).scalar_one_or_none()

    if not dept_name:
        return None, None

    dml = DepartmentMaxLimit
    i = Item
    fml = FacilityMaxLimit

    # Summary stats
    total_items = db.execute(
        select(func.count())
        .select_from(dml)
        .where(dml.department_id == department_id)
        .where(dml.effective_year == effective_year)
    ).scalar() or 0

    total_dept_qty = db.execute(
        select(func.sum(dml.max_quantity))
        .where(dml.department_id == department_id)
        .where(dml.effective_year == effective_year)
    ).scalar() or 0

    zero_qty_count = db.execute(
        select(func.count())
        .select_from(dml)
        .where(dml.department_id == department_id)
        .where(dml.effective_year == effective_year)
        .where(dml.max_quantity == 0)
    ).scalar() or 0

    # Category breakdown (top 10 by total quantity)
    by_category = db.execute(
        select(i.category_ar, func.count().label("item_count"), func.sum(dml.max_quantity).label("total_qty"))
        .select_from(dml)
        .join(i, dml.item_id == i.id)
        .where(dml.department_id == department_id)
        .where(dml.effective_year == effective_year)
        .where(i.category_ar.isnot(None))
        .group_by(i.category_ar)
        .order_by(func.sum(dml.max_quantity).desc())
        .limit(10)
    ).all()

    # Clinical use breakdown (top 8 by total quantity)
    by_clinical_use = db.execute(
        select(i.clinical_use, func.count().label("item_count"), func.sum(dml.max_quantity).label("total_qty"))
        .select_from(dml)
        .join(i, dml.item_id == i.id)
        .where(dml.department_id == department_id)
        .where(dml.effective_year == effective_year)
        .where(i.clinical_use.isnot(None))
        .group_by(i.clinical_use)
        .order_by(func.sum(dml.max_quantity).desc())
        .limit(8)
    ).all()

    # Top 15 items by department max quantity
    top_items = db.execute(
        select(
            i.generic_item_number,
            i.generic_description,
            dml.max_quantity,
            func.coalesce(fml.total_max_quantity, 0).label("facility_total"),
            i.category_ar,
            i.clinical_use,
        )
        .select_from(dml)
        .join(i, dml.item_id == i.id)
        .outerjoin(fml, dml.item_id == fml.item_id)
        .where(dml.department_id == department_id)
        .where(dml.effective_year == effective_year)
        .where(dml.max_quantity > 0)
        .order_by(dml.max_quantity.desc())
        .limit(15)
    ).all()

    lines = [
        f"Department: {dept_name}",
        f"Year: {effective_year}",
        f"Total items with limits: {total_items}",
        f"Total department max quantity (sum): {total_dept_qty:,}",
        f"Items with zero quantity: {zero_qty_count} ({zero_qty_count * 100 // total_items if total_items else 0}%)",
        "",
        "Supply category breakdown (Arabic categories, top 10 by total quantity):",
    ]

    for row in by_category:
        lines.append(f"  - {row.category_ar}: {row.item_count} items, total qty {row.total_qty:,}")

    lines.extend(["", "Clinical use breakdown (top 8 by total quantity):"])
    for row in by_clinical_use:
        lines.append(f"  - {row.clinical_use}: {row.item_count} items, total qty {row.total_qty:,}")

    lines.extend(["", "Top 15 items by department max quantity:"])
    for row in top_items:
        desc = row.generic_description or "(no description)"
        dept_share = f"{row.max_quantity * 100 // row.facility_total}%" if row.facility_total else "100%"
        lines.append(
            f"  - [{row.generic_item_number}] {desc}: "
            f"dept={row.max_quantity:,}, facility_total={row.facility_total:,} ({dept_share} of facility)"
            + (f" | {row.category_ar}" if row.category_ar else "")
        )

    return dept_name, "\n".join(lines)


@router.get("/department-report")
def stream_department_report(
    department_id: int = Query(..., description="Department ID"),
    effective_year: int = Query(2025, description="Year"),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    """
    Stream an AI-generated analytical report summarizing a department's supply limits.
    Returns Server-Sent Events (SSE): data: {"text": "..."} per chunk, then data: [DONE].
    """
    dept_name, context = _build_department_context(db, department_id, effective_year)

    if not dept_name:
        raise HTTPException(status_code=404, detail="Department not found")

    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY is not configured")

    client = anthropic.Anthropic(api_key=api_key)

    prompt = f"""You are a clinical supply chain analyst at NUPCO (National Unified Procurement Company) in Saudi Arabia.

Based on the following data about the **{dept_name}** department's medical supply limits for {effective_year}, write a concise analytical report in English. The report should:

1. Summarize the overall supply profile (scale, diversity, utilization)
2. Highlight the dominant supply categories and highest-volume items
3. Flag any concerning patterns (e.g., high proportion of zero-quantity items, heavy concentration in a single category, items where one department holds a large share of facility total)
4. Provide 2–3 specific, actionable recommendations for supply optimization

Data:
{context}

Write a clear, professional report in 3–5 paragraphs. Use plain language suitable for a supply chain manager."""

    def generate() -> Generator[str, None, None]:
        with client.messages.stream(
            model="claude-opus-4-6",
            max_tokens=2048,
            thinking={"type": "adaptive"},
            messages=[{"role": "user", "content": prompt}],
        ) as stream:
            for text in stream.text_stream:
                yield f"data: {json.dumps({'text': text})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
