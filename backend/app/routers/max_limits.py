"""
Max-limits APIs for the UI: list departments, paginated limits per department, upsert one limit.
Used by: department selector dropdown, limits table (paginated + search), edit-limit form.
"""
import io
import re
from typing import Any

import pandas as pd
from fastapi import APIRouter, Depends, Header, Query
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.crud.audit import log_max_limit_change
from app.database import get_db
from app.models import Department, DepartmentMaxLimit, FacilityMaxLimit, Item

router = APIRouter(prefix="/api", tags=["max-limits"])


# --- Schemas ---


class DepartmentOut(BaseModel):
    id: int
    name: str
    is_active: bool


class MaxLimitRowOut(BaseModel):
    item_id: int
    generic_item_number: str
    generic_description: str | None
    department_max_quantity: int
    facility_total_quantity: int
    updated_at: Any  # datetime
    # clinical metadata (nullable)
    category_ar: str | None = None
    clinical_use: str | None = None
    clinical_category: str | None = None
    specialty_tags: str | None = None
    item_family_group: str | None = None

    class Config:
        from_attributes = True


class UpsertMaxLimitBody(BaseModel):
    department_id: int
    item_id: int
    max_quantity: int = Field(..., ge=0)
    effective_year: int = 2025
    notes: str | None = None


class UpsertMaxLimitResponse(BaseModel):
    item_id: int
    department_id: int
    department_max_quantity: int
    facility_total_quantity: int
    effective_year: int | None


# --- Endpoints ---


@router.get("/departments", response_model=list[DepartmentOut])
def list_departments(db: Session = Depends(get_db)):
    """
    UI: Department dropdown / selector. Returns all departments ordered by name.
    """
    rows = db.execute(
        select(Department.id, Department.name, Department.is_active).order_by(Department.name.asc())
    ).all()
    return [DepartmentOut(id=r.id, name=r.name, is_active=r.is_active) for r in rows]


@router.get("/max-limits/department")
def list_department_limits(
    department_id: int = Query(..., description="Department ID"),
    q: str | None = Query(None, description="Search by item code or description"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    effective_year: int | None = Query(2025, description="Year filter"),
    sort_by: str = Query("code", description="code | dept_max_asc | dept_max_desc | facility_total_desc | updated_desc"),
    qty_filter: str = Query("all", description="all | zero | nonzero | below:N | above:N"),
    category_ar: str | None = Query(None, description="Filter by category_ar (exact)"),
    clinical_use: str | None = Query(None, description="Filter by clinical_use (exact)"),
    clinical_category: str | None = Query(None, description="Filter by clinical_category (exact)"),
    specialty_tags: str | None = Query(None, description="Filter by specialty_tags (contains)"),
    item_family_group: str | None = Query(None, description="Filter by item_family_group (exact)"),
    db: Session = Depends(get_db),
):
    """
    UI: Paginated table of limits for the selected department. Only rows that have a limit.
    Optional search (q) on item code or description. X-Total-Count header for pagination.
    """
    # Base: department_max_limits joined with items, left join facility_max_limits
    dml = DepartmentMaxLimit
    i = Item
    fml = FacilityMaxLimit

    stmt = (
        select(
            dml.item_id,
            i.generic_item_number,
            i.generic_description,
            dml.max_quantity.label("department_max_quantity"),
            func.coalesce(fml.total_max_quantity, 0).label("facility_total_quantity"),
            dml.updated_at,
            i.category_ar,
            i.clinical_use,
            i.clinical_category,
            i.specialty_tags,
            i.item_family_group,
        )
        .select_from(dml)
        .join(i, dml.item_id == i.id)
        .outerjoin(fml, dml.item_id == fml.item_id)
        .where(dml.department_id == department_id)
        .where(dml.effective_year == effective_year)
    )
    # count_stmt always joins Item so clinical filters can be applied consistently
    count_stmt = (
        select(func.count())
        .select_from(dml)
        .join(i, dml.item_id == i.id)
        .where(dml.department_id == department_id)
        .where(dml.effective_year == effective_year)
    )

    if q and q.strip():
        q_pattern = f"%{q.strip()}%"
        q_cond = or_(
            i.generic_item_number.ilike(q_pattern),
            (i.generic_description.isnot(None) & i.generic_description.ilike(q_pattern)),
        )
        stmt = stmt.where(q_cond)
        count_stmt = count_stmt.where(q_cond)

    # qty_filter
    if qty_filter == "zero":
        stmt = stmt.where(dml.max_quantity == 0)
        count_stmt = count_stmt.where(dml.max_quantity == 0)
    elif qty_filter == "nonzero":
        stmt = stmt.where(dml.max_quantity > 0)
        count_stmt = count_stmt.where(dml.max_quantity > 0)
    elif qty_filter.startswith("below:"):
        try:
            n = int(qty_filter.split(":", 1)[1])
            stmt = stmt.where(dml.max_quantity < n)
            count_stmt = count_stmt.where(dml.max_quantity < n)
        except ValueError:
            pass
    elif qty_filter.startswith("above:"):
        try:
            n = int(qty_filter.split(":", 1)[1])
            stmt = stmt.where(dml.max_quantity > n)
            count_stmt = count_stmt.where(dml.max_quantity > n)
        except ValueError:
            pass

    # clinical filters (applied to both stmt and count_stmt; count_stmt already joins Item)
    if category_ar:
        stmt = stmt.where(i.category_ar == category_ar)
        count_stmt = count_stmt.where(i.category_ar == category_ar)
    if clinical_use:
        stmt = stmt.where(i.clinical_use == clinical_use)
        count_stmt = count_stmt.where(i.clinical_use == clinical_use)
    if clinical_category:
        stmt = stmt.where(i.clinical_category == clinical_category)
        count_stmt = count_stmt.where(i.clinical_category == clinical_category)
    if specialty_tags:
        stmt = stmt.where(i.specialty_tags.ilike(f"%{specialty_tags}%"))
        count_stmt = count_stmt.where(i.specialty_tags.ilike(f"%{specialty_tags}%"))
    if item_family_group:
        stmt = stmt.where(i.item_family_group == item_family_group)
        count_stmt = count_stmt.where(i.item_family_group == item_family_group)

    total = db.execute(count_stmt).scalar() or 0

    # sort_by
    if sort_by == "dept_max_asc":
        order = dml.max_quantity.asc()
    elif sort_by == "dept_max_desc":
        order = dml.max_quantity.desc()
    elif sort_by == "facility_total_desc":
        order = func.coalesce(fml.total_max_quantity, 0).desc()
    elif sort_by == "updated_desc":
        order = dml.updated_at.desc()
    else:
        order = i.generic_item_number.asc()

    stmt = stmt.order_by(order).offset(offset).limit(limit)
    rows = db.execute(stmt).all()

    out = [
        MaxLimitRowOut(
            item_id=r.item_id,
            generic_item_number=r.generic_item_number,
            generic_description=r.generic_description,
            department_max_quantity=r.department_max_quantity,
            facility_total_quantity=r.facility_total_quantity,
            updated_at=r.updated_at,
            category_ar=r.category_ar,
            clinical_use=r.clinical_use,
            clinical_category=r.clinical_category,
            specialty_tags=r.specialty_tags,
            item_family_group=r.item_family_group,
        )
        for r in rows
    ]
    return JSONResponse(
        content=[r.model_dump(mode="json") for r in out],
        headers={"X-Total-Count": str(total)},
    )


@router.get("/max-limits/department/clinical-meta")
def get_clinical_meta(
    department_id: int = Query(...),
    effective_year: int = Query(2025),
    db: Session = Depends(get_db),
):
    """Return distinct non-null values for each clinical field for items in this department.
    Used to populate filter dropdowns in the UI."""
    dml = DepartmentMaxLimit
    i = Item
    base = (
        select(i)
        .join(dml, i.id == dml.item_id)
        .where(dml.department_id == department_id)
        .where(dml.effective_year == effective_year)
    )
    fields = ["category_ar", "clinical_use", "clinical_category", "specialty_tags", "item_family_group"]
    result: dict[str, list[str]] = {}
    for field in fields:
        col = getattr(i, field)
        rows = db.execute(
            select(col).distinct()
            .join(dml, i.id == dml.item_id)
            .where(dml.department_id == department_id)
            .where(dml.effective_year == effective_year)
            .where(col.isnot(None))
            .where(col != "")
            .order_by(col.asc())
        ).scalars().all()
        result[field] = list(rows)
    return result


@router.get("/export/department-max-limits")
def export_department_max_limits(
    department_id: int = Query(..., description="Department ID"),
    effective_year: int = Query(2025, description="Year filter"),
    q: str | None = Query(None, description="Search by item code or description"),
    db: Session = Depends(get_db),
):
    """
    Export department max limits to Excel. Same query as list endpoint, no pagination.
    Returns .xlsx file with: Generic Item Number, Generic Description, Department Name,
    Department Max Quantity, Facility Total Quantity, Effective Year, Updated At.
    """
    dml = DepartmentMaxLimit
    i = Item
    fml = FacilityMaxLimit
    dept = Department

    stmt = (
        select(
            i.generic_item_number,
            i.generic_description,
            dept.name.label("department_name"),
            dml.max_quantity.label("department_max_quantity"),
            func.coalesce(fml.total_max_quantity, 0).label("facility_total_quantity"),
            dml.effective_year,
            dml.updated_at,
        )
        .select_from(dml)
        .join(i, dml.item_id == i.id)
        .join(dept, dml.department_id == dept.id)
        .outerjoin(fml, dml.item_id == fml.item_id)
        .where(dml.department_id == department_id)
        .where(dml.effective_year == effective_year)
        .order_by(i.generic_item_number.asc())
    )

    if q and q.strip():
        q_pattern = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                i.generic_item_number.ilike(q_pattern),
                (i.generic_description.isnot(None) & i.generic_description.ilike(q_pattern)),
            )
        )

    rows = db.execute(stmt).all()
    df = pd.DataFrame(
        [
            {
                "Generic Item Number": r.generic_item_number,
                "Generic Description": r.generic_description or "",
                "Department Name": r.department_name,
                "Department Max Quantity": r.department_max_quantity,
                "Facility Total Quantity": r.facility_total_quantity,
                "Effective Year": r.effective_year,
                "Updated At": r.updated_at.isoformat() if r.updated_at else "",
            }
            for r in rows
        ]
    )

    buf = io.BytesIO()
    df.to_excel(buf, index=False, engine="openpyxl")
    buf.seek(0)

    filename = f"department_{department_id}_max_limits_{effective_year}.xlsx"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


class ItemSearchOut(BaseModel):
    id: int
    generic_item_number: str
    generic_description: str | None


class AlternativeOut(BaseModel):
    id: int
    generic_item_number: str
    generic_description: str | None
    similarity_score: int
    reasons: list[str] = []


class AlternativesResponse(BaseModel):
    recommended_min_score: int
    alternatives: list[AlternativeOut]


@router.get("/items/search", response_model=list[ItemSearchOut])
def search_items(
    q: str = Query(..., min_length=1, description="Search by code or description"),
    limit: int = Query(10, ge=1, le=50),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    """
    UI: Autocomplete search for items (by code or description). Never loads all items.
    """
    q_pattern = f"%{q.strip()}%"
    stmt = (
        select(Item.id, Item.generic_item_number, Item.generic_description)
        .where(
            or_(
                Item.generic_item_number.ilike(q_pattern),
                (Item.generic_description.isnot(None) & Item.generic_description.ilike(q_pattern)),
            )
        )
        .order_by(Item.generic_item_number.asc())
        .offset(offset)
        .limit(limit)
    )
    rows = db.execute(stmt).all()
    return [
        ItemSearchOut(id=r.id, generic_item_number=r.generic_item_number, generic_description=r.generic_description)
        for r in rows
    ]


_WORD_RE = re.compile(r"[\w\u0600-\u06FF]+", re.UNICODE)
_GAUGE_RE = re.compile(r"\b(\d+)G\b", re.IGNORECASE)
_GENERIC_CLINICAL_USE = {"استخدام عام", "general use", "general"}
_GENERIC_SPECIALTY = {"عام", "general"}
_GENERIC_CATEGORY = {"مستهلكات عامة", "عام", "general"}
_GENERIC_CLINICAL_CATEGORY = {"أخرى", "اخرى", "other"}
_GENERIC_FAMILY = {"medicalsupplies", "general"}


def _extract_gauge(desc: str | None) -> str | None:
    """Extract gauge pattern from description (e.g. 30G, 28G)."""
    if not desc:
        return None
    m = _GAUGE_RE.search(desc)
    return f"{m.group(1)}G" if m else None


def _tokenize(text: str | None) -> set[str]:
    if not text:
        return set()
    return {w.lower() for w in _WORD_RE.findall(text) if len(w) > 1}


def _jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def _is_informative(value: str | None, generic_values: set[str]) -> bool:
    if not value:
        return False
    normalized = str(value).strip().lower()
    if not normalized:
        return False
    return normalized not in generic_values


def _score_candidate(
    source: Item,
    candidate: Item,
    source_desc_tokens: set[str],
    source_detail_tokens: set[str],
) -> tuple[int, list[str]]:
    """
    Multi-signal similarity score and explainability reasons.
    Returns (score, reasons).
    """
    raw = 0
    reasons: list[str] = []

    # Strong: keyword overlap from generic_description + detailed_use
    source_all_tokens = source_desc_tokens | source_detail_tokens
    cand_desc_tokens = _tokenize(candidate.generic_description)
    cand_detail_tokens = _tokenize(candidate.detailed_use)
    cand_all_tokens = cand_desc_tokens | cand_detail_tokens
    shared = source_all_tokens & cand_all_tokens
    if len(shared) >= 2:
        raw += 30
        top3 = sorted(shared)[:3]
        reasons.append(f"Shared keywords: {', '.join(top3)}")
    elif len(shared) >= 1:
        raw += 15
        top3 = sorted(shared)[:3]
        reasons.append(f"Shared keywords: {', '.join(top3)}")

    # Strong: first word of generic_description matches exactly
    src_desc = (source.generic_description or "").strip()
    cand_desc = (candidate.generic_description or "").strip()
    src_first = src_desc.split()[0].lower() if src_desc else ""
    cand_first = cand_desc.split()[0].lower() if cand_desc else ""
    if src_first and cand_first and src_first == cand_first:
        raw += 25
        reasons.append(f"First word match: {src_first}")

    # Reduced: category match
    if source.category_ar and candidate.category_ar and source.category_ar == candidate.category_ar:
        raw += 15
        reasons.append("Same category")

    # Moderate: clinical_use
    if (
        source.clinical_use
        and candidate.clinical_use
        and source.clinical_use == candidate.clinical_use
        and source.clinical_use != "استخدام عام"
    ):
        raw += 20
        reasons.append("Same clinical use")

    # Moderate: specialty_tags
    if (
        source.specialty_tags
        and candidate.specialty_tags
        and source.specialty_tags == candidate.specialty_tags
        and source.specialty_tags != "عام"
    ):
        raw += 12
        reasons.append("Same specialty")

    if (
        source.clinical_category
        and candidate.clinical_category
        and source.clinical_category == candidate.clinical_category
        and source.clinical_category != "أخرى"
    ):
        raw += 10
        reasons.append("Same clinical category")

    if (
        source.item_family_group
        and candidate.item_family_group
        and source.item_family_group == candidate.item_family_group
    ):
        raw += 10

    raw += int(_jaccard(source_detail_tokens, cand_detail_tokens) * 20)

    src_code = (source.generic_item_number or "")[:4]
    cand_code = (candidate.generic_item_number or "")[:4]
    if src_code and cand_code and src_code == cand_code:
        raw += 5

    score = min(int(raw * 100 / 162), 100)
    return (score, reasons)


def _recommended_min_score(item: Item) -> int:
    """Dynamic min_score based on informative metadata richness."""
    informative_count = 0
    if _is_informative(item.category_ar, _GENERIC_CATEGORY):
        informative_count += 1
    if _is_informative(item.clinical_use, _GENERIC_CLINICAL_USE):
        informative_count += 1
    if _is_informative(item.clinical_category, _GENERIC_CLINICAL_CATEGORY):
        informative_count += 1
    if _is_informative(item.specialty_tags, _GENERIC_SPECIALTY):
        informative_count += 1
    if _is_informative(item.item_family_group, _GENERIC_FAMILY):
        informative_count += 1

    if informative_count <= 1:
        return 35
    if informative_count == 2:
        return 45
    return 55


@router.get("/items/{item_id}/alternatives", response_model=AlternativesResponse)
def get_item_alternatives(
    item_id: int,
    auto_generate: bool = Query(True),
    top_k: int = Query(5, ge=1, le=20),
    min_score: int | None = Query(None, ge=0, le=100, description="Override recommended; omit to use dynamic"),
    db: Session = Depends(get_db),
):
    """
    Suggested alternatives using multi-signal clinical metadata scoring.
    If min_score is omitted, uses recommended_min_score based on item metadata richness.
    """
    item = db.execute(select(Item).where(Item.id == item_id)).scalar_one_or_none()
    if not item:
        return AlternativesResponse(recommended_min_score=55, alternatives=[])

    recommended = _recommended_min_score(item)
    effective_min = min_score if min_score is not None else recommended
    source_desc_tokens = _tokenize(item.generic_description)
    source_detail_tokens = _tokenize(item.detailed_use)

    # Build candidate filter: must share at least one clinical signal
    filters = []
    if item.category_ar:
        filters.append(Item.category_ar == item.category_ar)
    if item.clinical_use and item.clinical_use != "استخدام عام":
        filters.append(Item.clinical_use == item.clinical_use)
    if item.specialty_tags and item.specialty_tags != "عام":
        filters.append(Item.specialty_tags == item.specialty_tags)
    if item.item_family_group:
        filters.append(Item.item_family_group == item.item_family_group)

    fallback_mode = False
    candidate_stmt = select(Item).where(Item.id != item_id)
    if filters:
        candidate_stmt = candidate_stmt.where(or_(*filters))
    else:
        # Metadata may be sparse after base imports; fallback to text/code similarity.
        fallback_mode = True
        fallback_filters = []

        item_code = (item.generic_item_number or "").strip()
        code_prefix = item_code[:6] if len(item_code) >= 6 else item_code[:4]
        if code_prefix:
            fallback_filters.append(Item.generic_item_number.like(f"{code_prefix}%"))

        item_desc = (item.generic_description or "").strip()
        first_word = item_desc.split()[0].lower() if item_desc else ""
        if len(first_word) >= 3:
            fallback_filters.append(Item.generic_description.ilike(f"{first_word}%"))

        sorted_tokens = sorted(source_desc_tokens | source_detail_tokens, key=len, reverse=True)
        for token in sorted_tokens:
            if len(token) < 3:
                continue
            fallback_filters.append(Item.generic_description.ilike(f"%{token}%"))
            if len(fallback_filters) >= 6:
                break

        if not fallback_filters:
            return AlternativesResponse(recommended_min_score=recommended, alternatives=[])

        candidate_stmt = candidate_stmt.where(or_(*fallback_filters))

    candidates = (
        db.execute(candidate_stmt.limit(500))
        .scalars()
        .all()
    )

    if not candidates:
        return AlternativesResponse(recommended_min_score=recommended, alternatives=[])

    threshold = effective_min
    if fallback_mode and min_score is None:
        threshold = min(effective_min, 30)

    scored_all = []
    for cand in candidates:
        s, reasons = _score_candidate(item, cand, source_desc_tokens, source_detail_tokens)
        scored_all.append((cand, s, reasons))

    scored = [row for row in scored_all if row[1] >= threshold]
    if not scored and min_score is None and not fallback_mode:
        relaxed_threshold = min(threshold, 35)
        scored = [row for row in scored_all if row[1] >= relaxed_threshold]

    scored.sort(key=lambda x: x[1], reverse=True)

    # Diversity rule: if top results all share same gauge (e.g. 30G), allow at least one
    # alternative with different gauge (e.g. 28G) if score >= effective_min - 5.
    top = list(scored[:top_k])
    source_gauge = _extract_gauge(item.generic_description)
    if source_gauge and len(top) >= top_k:
        top_gauges = [_extract_gauge(c.generic_description) for c, _, _ in top]
        if all(g == source_gauge for g in top_gauges):
            diversity_min = effective_min - 5
            best_diff = None
            for cand, s, reasons in scored[top_k:]:
                if s < diversity_min:
                    continue
                g = _extract_gauge(cand.generic_description)
                if g and g != source_gauge:
                    reasons_diversity = list(reasons)
                    reasons_diversity.append(f"Different gauge: {g} vs {source_gauge}")
                    best_diff = (cand, s, reasons_diversity)
                    break
            if best_diff:
                top = top[: top_k - 1] + [best_diff]

    alts = [
        AlternativeOut(
            id=c.id,
            generic_item_number=c.generic_item_number,
            generic_description=c.generic_description,
            similarity_score=s,
            reasons=reasons,
        )
        for c, s, reasons in top
    ]
    return AlternativesResponse(recommended_min_score=recommended, alternatives=alts)


class BatchLookupBody(BaseModel):
    department_id: int
    item_ids: list[int]
    effective_year: int = 2025


class BatchLookupRow(BaseModel):
    item_id: int
    max_quantity: int
    facility_total_quantity: int


@router.post("/max-limits/department/batch-lookup", response_model=list[BatchLookupRow])
def batch_lookup_limits(
    body: BatchLookupBody,
    db: Session = Depends(get_db),
):
    """
    UI: After loading alternatives, fetch their existing limits in one call.
    Returns [{item_id, max_quantity, facility_total_quantity}] for items that have a limit.
    Items without a limit are omitted.
    """
    if not body.item_ids:
        return []
    stmt = (
        select(
            DepartmentMaxLimit.item_id,
            DepartmentMaxLimit.max_quantity,
            func.coalesce(FacilityMaxLimit.total_max_quantity, 0).label("facility_total_quantity"),
        )
        .outerjoin(FacilityMaxLimit, DepartmentMaxLimit.item_id == FacilityMaxLimit.item_id)
        .where(DepartmentMaxLimit.department_id == body.department_id)
        .where(DepartmentMaxLimit.effective_year == body.effective_year)
        .where(DepartmentMaxLimit.item_id.in_(body.item_ids))
    )
    rows = db.execute(stmt).all()
    return [
        BatchLookupRow(item_id=r.item_id, max_quantity=r.max_quantity, facility_total_quantity=r.facility_total_quantity)
        for r in rows
    ]


@router.post("/max-limits/department/upsert", response_model=UpsertMaxLimitResponse)
def upsert_department_limit(
    body: UpsertMaxLimitBody,
    db: Session = Depends(get_db),
):
    """
    UI: Save (or clear) one limit. If max_quantity is 0, the row is deleted.
    Returns updated department_max_quantity and facility_total_quantity (from trigger).
    """
    if body.max_quantity == 0:
        deleted = db.execute(
            select(DepartmentMaxLimit).where(
                DepartmentMaxLimit.item_id == body.item_id,
                DepartmentMaxLimit.department_id == body.department_id,
                DepartmentMaxLimit.effective_year == body.effective_year,
            )
        ).scalar_one_or_none()
        if deleted:
            log_max_limit_change(
                db, body.item_id, body.department_id, body.effective_year,
                "delete", deleted.max_quantity, None, "manual",
            )
            db.delete(deleted)
        db.commit()
        facility = (
            db.execute(
                select(FacilityMaxLimit).where(FacilityMaxLimit.item_id == body.item_id)
            ).scalar_one_or_none()
        )
        return UpsertMaxLimitResponse(
            item_id=body.item_id,
            department_id=body.department_id,
            department_max_quantity=0,
            facility_total_quantity=facility.total_max_quantity if facility else 0,
            effective_year=body.effective_year,
        )

    existing = db.execute(
        select(DepartmentMaxLimit).where(
            DepartmentMaxLimit.item_id == body.item_id,
            DepartmentMaxLimit.department_id == body.department_id,
            DepartmentMaxLimit.effective_year == body.effective_year,
        )
    ).scalar_one_or_none()
    if existing:
        log_max_limit_change(
            db, body.item_id, body.department_id, body.effective_year,
            "update", existing.max_quantity, body.max_quantity, "manual",
        )
        existing.max_quantity = body.max_quantity
        existing.source = "manual"
    else:
        log_max_limit_change(
            db, body.item_id, body.department_id, body.effective_year,
            "insert", None, body.max_quantity, "manual",
        )
        db.add(
            DepartmentMaxLimit(
                item_id=body.item_id,
                department_id=body.department_id,
                max_quantity=body.max_quantity,
                effective_year=body.effective_year,
                source="manual",
            )
        )
    db.commit()

    facility = db.execute(
        select(FacilityMaxLimit).where(FacilityMaxLimit.item_id == body.item_id)
    ).scalar_one_or_none()
    return UpsertMaxLimitResponse(
        item_id=body.item_id,
        department_id=body.department_id,
        department_max_quantity=body.max_quantity,
        facility_total_quantity=facility.total_max_quantity if facility else 0,
        effective_year=body.effective_year,
    )
