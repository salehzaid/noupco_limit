"""
Hospitals API: list hospitals, dashboard analytics.
"""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import and_, delete, func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import require_admin_key
from app.models import Department, DepartmentMaxLimit, FacilityMaxLimit, Hospital, Item, MaxLimitAuditLog

router = APIRouter(prefix="/api", tags=["hospitals"])


class HospitalOut(BaseModel):
    id: int
    name: str
    code: str | None
    is_active: bool


class HospitalFull(BaseModel):
    id: int
    name: str
    code: str | None
    is_active: bool
    city: str | None
    region: str | None
    contact_name: str | None
    contact_phone: str | None
    notes: str | None


class HospitalUpdate(BaseModel):
    name: str | None = None
    code: str | None = None
    city: str | None = None
    region: str | None = None
    contact_name: str | None = None
    contact_phone: str | None = None
    notes: str | None = None


@router.get("/hospitals", response_model=list[HospitalOut])
def list_hospitals(db: Session = Depends(get_db)):
    """Return all hospitals ordered by name."""
    rows = db.execute(select(Hospital).order_by(Hospital.name)).scalars().all()
    return [HospitalOut(id=r.id, name=r.name, code=r.code, is_active=r.is_active) for r in rows]


@router.get("/hospitals/{hospital_id}", response_model=HospitalFull)
def get_hospital(hospital_id: int, db: Session = Depends(get_db)):
    """Return full hospital profile."""
    h = db.execute(select(Hospital).where(Hospital.id == hospital_id)).scalar_one_or_none()
    if not h:
        raise HTTPException(status_code=404, detail="Hospital not found")
    return HospitalFull(
        id=h.id, name=h.name, code=h.code, is_active=h.is_active,
        city=h.city, region=h.region,
        contact_name=h.contact_name, contact_phone=h.contact_phone,
        notes=h.notes,
    )


@router.put("/hospitals/{hospital_id}", response_model=HospitalFull, dependencies=[Depends(require_admin_key)])
def update_hospital(hospital_id: int, body: HospitalUpdate, db: Session = Depends(get_db)):
    """Update editable hospital fields. Protected by admin key."""
    h = db.execute(select(Hospital).where(Hospital.id == hospital_id)).scalar_one_or_none()
    if not h:
        raise HTTPException(status_code=404, detail="Hospital not found")

    if body.name is not None:
        if not body.name.strip():
            raise HTTPException(status_code=422, detail="Name must not be empty")
        h.name = body.name.strip()
    if body.code is not None:
        h.code = body.code.strip() or None
    if body.city is not None:
        h.city = body.city.strip() or None
    if body.region is not None:
        h.region = body.region.strip() or None
    if body.contact_name is not None:
        h.contact_name = body.contact_name.strip() or None
    if body.contact_phone is not None:
        phone = body.contact_phone.strip()
        if phone and len(phone) > 30:
            raise HTTPException(status_code=422, detail="Phone number too long")
        h.contact_phone = phone or None
    if body.notes is not None:
        h.notes = body.notes.strip() or None

    db.commit()
    db.refresh(h)
    return HospitalFull(
        id=h.id, name=h.name, code=h.code, is_active=h.is_active,
        city=h.city, region=h.region,
        contact_name=h.contact_name, contact_phone=h.contact_phone,
        notes=h.notes,
    )


class DepartmentBrief(BaseModel):
    id: int
    name: str


class HospitalLimitsDeleteResult(BaseModel):
    hospital_id: int
    effective_year: int | None
    departments_count: int
    deleted_limits: int


@router.get("/hospitals/{hospital_id}/departments", response_model=list[DepartmentBrief])
def list_hospital_departments(hospital_id: int, db: Session = Depends(get_db)):
    """Return departments for one hospital, ordered by name."""
    hospital = db.execute(select(Hospital).where(Hospital.id == hospital_id)).scalar_one_or_none()
    if not hospital:
        raise HTTPException(status_code=404, detail="Hospital not found")
    rows = db.execute(
        select(Department).where(Department.hospital_id == hospital_id).order_by(Department.name)
    ).scalars().all()
    return [DepartmentBrief(id=r.id, name=r.name) for r in rows]


@router.delete(
    "/hospitals/{hospital_id}/max-limits",
    response_model=HospitalLimitsDeleteResult,
    dependencies=[Depends(require_admin_key)],
)
def delete_hospital_max_limits(
    hospital_id: int,
    effective_year: int | None = Query(2025, description="Year to delete. Pass null to delete all years."),
    db: Session = Depends(get_db),
):
    """
    Delete all department max limits for one hospital across all its departments.
    By default deletes only the requested effective_year.
    """
    hospital = db.execute(select(Hospital).where(Hospital.id == hospital_id)).scalar_one_or_none()
    if not hospital:
        raise HTTPException(status_code=404, detail="Hospital not found")

    dept_ids = [
        r[0]
        for r in db.execute(
            select(Department.id).where(Department.hospital_id == hospital_id)
        ).all()
    ]
    if not dept_ids:
        return HospitalLimitsDeleteResult(
            hospital_id=hospital_id,
            effective_year=effective_year,
            departments_count=0,
            deleted_limits=0,
        )

    filters = [DepartmentMaxLimit.department_id.in_(dept_ids)]
    if effective_year is not None:
        filters.append(DepartmentMaxLimit.effective_year == effective_year)

    deleted_limits = (
        db.execute(select(func.count()).select_from(DepartmentMaxLimit).where(*filters)).scalar() or 0
    )
    if deleted_limits:
        db.execute(delete(DepartmentMaxLimit).where(*filters))
    db.commit()

    return HospitalLimitsDeleteResult(
        hospital_id=hospital_id,
        effective_year=effective_year,
        departments_count=len(dept_ids),
        deleted_limits=deleted_limits,
    )


# ── Department PIN endpoints (must be before {department_id} catch-all) ──


class DeptPinInfo(BaseModel):
    department_id: int
    department_name: str
    has_pin: bool


@router.get("/hospitals/{hospital_id}/departments/pins", response_model=list[DeptPinInfo])
def list_department_pins(hospital_id: int, db: Session = Depends(get_db)):
    """List departments with whether a PIN is set (never exposes actual PIN)."""
    hospital = db.execute(select(Hospital).where(Hospital.id == hospital_id)).scalar_one_or_none()
    if not hospital:
        raise HTTPException(status_code=404, detail="Hospital not found")
    rows = db.execute(
        select(Department).where(Department.hospital_id == hospital_id).order_by(Department.name)
    ).scalars().all()
    return [DeptPinInfo(department_id=r.id, department_name=r.name, has_pin=bool(r.access_pin)) for r in rows]


class DepartmentDetail(BaseModel):
    id: int
    name: str
    hospital_id: int | None
    is_active: bool


class DepartmentDeleteResult(BaseModel):
    hospital_id: int
    department_id: int
    department_name: str
    deleted_limits: int
    deleted_audit_logs: int


@router.get("/hospitals/{hospital_id}/departments/{department_id}", response_model=DepartmentDetail)
def get_hospital_department(hospital_id: int, department_id: int, db: Session = Depends(get_db)):
    """Return a single department if it belongs to the given hospital; 404 otherwise."""
    dept = db.execute(
        select(Department).where(Department.id == department_id, Department.hospital_id == hospital_id)
    ).scalar_one_or_none()
    if not dept:
        raise HTTPException(status_code=404, detail="Department not found in this hospital")
    return DepartmentDetail(id=dept.id, name=dept.name, hospital_id=dept.hospital_id, is_active=dept.is_active)


@router.delete(
    "/hospitals/{hospital_id}/departments/{department_id}",
    response_model=DepartmentDeleteResult,
    dependencies=[Depends(require_admin_key)],
)
def delete_hospital_department(hospital_id: int, department_id: int, db: Session = Depends(get_db)):
    """Delete one department from a hospital (including its limits and audit rows)."""
    dept = db.execute(
        select(Department).where(Department.id == department_id, Department.hospital_id == hospital_id)
    ).scalar_one_or_none()
    if not dept:
        raise HTTPException(status_code=404, detail="Department not found in this hospital")

    deleted_limits = (
        db.execute(
            select(func.count())
            .select_from(DepartmentMaxLimit)
            .where(DepartmentMaxLimit.department_id == department_id)
        ).scalar()
        or 0
    )
    if deleted_limits:
        db.execute(delete(DepartmentMaxLimit).where(DepartmentMaxLimit.department_id == department_id))

    deleted_audit_logs = (
        db.execute(
            select(func.count())
            .select_from(MaxLimitAuditLog)
            .where(MaxLimitAuditLog.department_id == department_id)
        ).scalar()
        or 0
    )
    if deleted_audit_logs:
        db.execute(delete(MaxLimitAuditLog).where(MaxLimitAuditLog.department_id == department_id))

    dept_name = dept.name
    db.delete(dept)
    db.commit()

    return DepartmentDeleteResult(
        hospital_id=hospital_id,
        department_id=department_id,
        department_name=dept_name,
        deleted_limits=deleted_limits,
        deleted_audit_logs=deleted_audit_logs,
    )


class PinVerifyBody(BaseModel):
    pin: str


@router.post("/hospitals/{hospital_id}/departments/{department_id}/verify-pin")
def verify_department_pin(hospital_id: int, department_id: int, body: PinVerifyBody, db: Session = Depends(get_db)):
    """Check if provided PIN matches the department's access_pin."""
    dept = db.execute(
        select(Department).where(Department.id == department_id, Department.hospital_id == hospital_id)
    ).scalar_one_or_none()
    if not dept:
        raise HTTPException(status_code=404, detail="Department not found in this hospital")
    if not dept.access_pin:
        return {"ok": True, "message": "No PIN required"}
    if body.pin.strip() == dept.access_pin:
        return {"ok": True}
    raise HTTPException(status_code=403, detail="Incorrect PIN")


class SetPinBody(BaseModel):
    pin: str | None = None


@router.put("/departments/{department_id}/pin", dependencies=[Depends(require_admin_key)])
def set_department_pin(department_id: int, body: SetPinBody, db: Session = Depends(get_db)):
    """Set or clear a department's access PIN. Admin-only."""
    dept = db.execute(select(Department).where(Department.id == department_id)).scalar_one_or_none()
    if not dept:
        raise HTTPException(status_code=404, detail="Department not found")
    if body.pin is not None:
        pin = body.pin.strip()
        if len(pin) < 4 or len(pin) > 8:
            raise HTTPException(status_code=422, detail="PIN must be 4-8 characters")
        dept.access_pin = pin
    else:
        dept.access_pin = None
    db.commit()
    return {"department_id": dept.id, "has_pin": bool(dept.access_pin)}


class DepartmentRegisteredNodeRow(BaseModel):
    department_id: int
    department_name: str
    registered_nodes_count: int
    last_modified_at: datetime | None


class DepartmentRegisteredNodesOut(BaseModel):
    hospital_id: int
    total: int
    limit: int
    offset: int
    rows: list[DepartmentRegisteredNodeRow]


@router.get("/hospitals/{hospital_id}/analytics/registered-nodes", response_model=DepartmentRegisteredNodesOut)
def list_hospital_registered_nodes(
    hospital_id: int,
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
    q: str | None = Query(None, description="Search by department name"),
    effective_year: int | None = Query(2025, description="Year filter; pass null for all years"),
    sort_by: str = Query("last_modified_desc", description="last_modified_desc | nodes_desc | name_asc | name_desc"),
    db: Session = Depends(get_db),
):
    """Follow-up table for registered nodes per department, sorted by last update."""
    hospital = db.execute(select(Hospital).where(Hospital.id == hospital_id)).scalar_one_or_none()
    if not hospital:
        raise HTTPException(status_code=404, detail="Hospital not found")

    d = Department.__table__
    dml = DepartmentMaxLimit.__table__

    join_condition = dml.c.department_id == d.c.id
    if effective_year is not None:
        join_condition = and_(join_condition, dml.c.effective_year == effective_year)

    dept_filters = [d.c.hospital_id == hospital_id]
    if q and q.strip():
        dept_filters.append(d.c.name.ilike(f"%{q.strip()}%"))

    nodes_count = func.count(func.distinct(dml.c.item_id))
    last_modified = func.max(dml.c.updated_at)

    stmt = (
        select(
            d.c.id.label("department_id"),
            d.c.name.label("department_name"),
            nodes_count.label("registered_nodes_count"),
            last_modified.label("last_modified_at"),
        )
        .select_from(d.outerjoin(dml, join_condition))
        .where(*dept_filters)
        .group_by(d.c.id, d.c.name)
    )

    if sort_by == "nodes_desc":
        order_by = [nodes_count.desc(), last_modified.is_(None).asc(), last_modified.desc(), d.c.name.asc()]
    elif sort_by == "name_asc":
        order_by = [d.c.name.asc()]
    elif sort_by == "name_desc":
        order_by = [d.c.name.desc()]
    else:
        order_by = [last_modified.is_(None).asc(), last_modified.desc(), nodes_count.desc(), d.c.name.asc()]

    total = db.execute(select(func.count()).select_from(d).where(*dept_filters)).scalar() or 0
    rows = db.execute(stmt.order_by(*order_by).offset(offset).limit(limit)).all()

    return DepartmentRegisteredNodesOut(
        hospital_id=hospital_id,
        total=total,
        limit=limit,
        offset=offset,
        rows=[
            DepartmentRegisteredNodeRow(
                department_id=r.department_id,
                department_name=r.department_name,
                registered_nodes_count=r.registered_nodes_count,
                last_modified_at=r.last_modified_at,
            )
            for r in rows
        ],
    )


@router.get("/hospitals/{hospital_id}/dashboard")
def hospital_dashboard(hospital_id: int, db: Session = Depends(get_db)):
    """Aggregated analytics for one hospital: counts, top departments, top items."""
    hospital = db.execute(select(Hospital).where(Hospital.id == hospital_id)).scalar_one_or_none()
    if not hospital:
        raise HTTPException(status_code=404, detail="Hospital not found")

    # IDs of departments belonging to this hospital
    dept_ids_q = select(Department.id).where(Department.hospital_id == hospital_id)
    dept_ids = [r[0] for r in db.execute(dept_ids_q).all()]

    empty_usage = {
        "last_7_days_changes": 0,
        "last_30_days_changes": 0,
        "top_departments_by_changes_7d": [],
        "recent_changes": [],
        "coverage_by_department": [],
    }

    if not dept_ids:
        return {
            "hospital": {"id": hospital.id, "name": hospital.name, "code": hospital.code},
            "summary": {"departments_count": 0, "items_with_limits_count": 0, "total_limits_sum": 0},
            "top_departments_by_total_limit": [],
            "top_items_by_facility_total": [],
            "usage": empty_usage,
        }

    dml = DepartmentMaxLimit.__table__
    d = Department.__table__

    departments_count = len(dept_ids)

    items_with_limits_count = db.execute(
        select(func.count(func.distinct(dml.c.item_id))).where(dml.c.department_id.in_(dept_ids))
    ).scalar() or 0

    total_limits_sum = db.execute(
        select(func.coalesce(func.sum(dml.c.max_quantity), 0)).where(dml.c.department_id.in_(dept_ids))
    ).scalar() or 0

    # Top 5 departments by sum of max_quantity
    top_depts = db.execute(
        select(
            dml.c.department_id,
            d.c.name.label("department_name"),
            func.sum(dml.c.max_quantity).label("total_limit"),
        )
        .join(d, d.c.id == dml.c.department_id)
        .where(dml.c.department_id.in_(dept_ids))
        .group_by(dml.c.department_id, d.c.name)
        .order_by(func.sum(dml.c.max_quantity).desc())
        .limit(5)
    ).all()

    # Top 5 items by facility total — only items present in this hospital's departments
    item_ids_sub = select(func.distinct(dml.c.item_id)).where(dml.c.department_id.in_(dept_ids))
    fml = FacilityMaxLimit.__table__
    i = Item.__table__
    top_items = db.execute(
        select(
            fml.c.item_id,
            i.c.generic_item_number,
            i.c.generic_description,
            fml.c.total_max_quantity.label("facility_total_quantity"),
        )
        .join(i, i.c.id == fml.c.item_id)
        .where(fml.c.item_id.in_(item_ids_sub))
        .order_by(fml.c.total_max_quantity.desc())
        .limit(5)
    ).all()

    # ── Usage analytics (audit-based) ──────────────────────────────
    audit = MaxLimitAuditLog.__table__
    now = datetime.now(timezone.utc)
    cutoff_7d = now - timedelta(days=7)
    cutoff_30d = now - timedelta(days=30)

    base_audit = audit.c.department_id.in_(dept_ids)

    last_7 = db.execute(
        select(func.count()).select_from(audit).where(base_audit, audit.c.created_at >= cutoff_7d)
    ).scalar() or 0

    last_30 = db.execute(
        select(func.count()).select_from(audit).where(base_audit, audit.c.created_at >= cutoff_30d)
    ).scalar() or 0

    top_depts_changes = db.execute(
        select(
            audit.c.department_id,
            d.c.name.label("department_name"),
            func.count().label("changes"),
        )
        .join(d, d.c.id == audit.c.department_id)
        .where(base_audit, audit.c.created_at >= cutoff_7d)
        .group_by(audit.c.department_id, d.c.name)
        .order_by(func.count().desc())
        .limit(5)
    ).all()

    recent = db.execute(
        select(
            audit.c.created_at,
            d.c.name.label("department_name"),
            i.c.generic_item_number,
            audit.c.action,
            audit.c.old_quantity,
            audit.c.new_quantity,
            audit.c.source,
        )
        .join(d, d.c.id == audit.c.department_id)
        .join(i, i.c.id == audit.c.item_id)
        .where(base_audit)
        .order_by(audit.c.created_at.desc())
        .limit(20)
    ).all()

    coverage = db.execute(
        select(
            dml.c.department_id,
            d.c.name.label("department_name"),
            func.count(func.distinct(dml.c.item_id)).label("items_with_limits"),
        )
        .join(d, d.c.id == dml.c.department_id)
        .where(dml.c.department_id.in_(dept_ids))
        .group_by(dml.c.department_id, d.c.name)
        .order_by(func.count(func.distinct(dml.c.item_id)).desc())
    ).all()

    usage = {
        "last_7_days_changes": last_7,
        "last_30_days_changes": last_30,
        "top_departments_by_changes_7d": [
            {"department_id": r.department_id, "department_name": r.department_name, "changes": r.changes}
            for r in top_depts_changes
        ],
        "recent_changes": [
            {
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "department_name": r.department_name,
                "generic_item_number": r.generic_item_number,
                "action": r.action,
                "old_quantity": r.old_quantity,
                "new_quantity": r.new_quantity,
                "source": r.source,
            }
            for r in recent
        ],
        "coverage_by_department": [
            {"department_id": r.department_id, "department_name": r.department_name, "items_with_limits": r.items_with_limits}
            for r in coverage
        ],
    }

    return {
        "hospital": {"id": hospital.id, "name": hospital.name, "code": hospital.code},
        "summary": {
            "departments_count": departments_count,
            "items_with_limits_count": items_with_limits_count,
            "total_limits_sum": total_limits_sum,
        },
        "top_departments_by_total_limit": [
            {"department_id": r.department_id, "department_name": r.department_name, "total_limit": r.total_limit}
            for r in top_depts
        ],
        "top_items_by_facility_total": [
            {
                "item_id": r.item_id,
                "generic_item_number": r.generic_item_number,
                "generic_description": r.generic_description,
                "facility_total_quantity": r.facility_total_quantity,
            }
            for r in top_items
        ],
        "usage": usage,
    }
