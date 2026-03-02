"""
Audit log API: list max limit change history (who/what/when).
"""
from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Item, MaxLimitAuditLog

router = APIRouter(prefix="/api/audit", tags=["audit"])


@router.get("/max-limits")
def list_max_limit_audit_logs(
    department_id: int | None = Query(None, description="Filter by department"),
    item_id: int | None = Query(None, description="Filter by item"),
    effective_year: int | None = Query(None, description="Filter by year"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    """
    List audit log rows for department max limit changes, newest first.
    Optional filters: department_id, item_id, effective_year.
    """
    base = select(MaxLimitAuditLog, Item.generic_item_number).join(
        Item, Item.id == MaxLimitAuditLog.item_id
    )
    count_base = select(MaxLimitAuditLog.id)
    if department_id is not None:
        base = base.where(MaxLimitAuditLog.department_id == department_id)
        count_base = count_base.where(MaxLimitAuditLog.department_id == department_id)
    if item_id is not None:
        base = base.where(MaxLimitAuditLog.item_id == item_id)
        count_base = count_base.where(MaxLimitAuditLog.item_id == item_id)
    if effective_year is not None:
        base = base.where(MaxLimitAuditLog.effective_year == effective_year)
        count_base = count_base.where(MaxLimitAuditLog.effective_year == effective_year)

    total = db.execute(select(func.count()).select_from(count_base)).scalar() or 0

    stmt = (
        base.order_by(MaxLimitAuditLog.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    rows = db.execute(stmt).all()

    out = [
        {
            "id": r.MaxLimitAuditLog.id,
            "item_id": r.MaxLimitAuditLog.item_id,
            "department_id": r.MaxLimitAuditLog.department_id,
            "effective_year": r.MaxLimitAuditLog.effective_year,
            "action": r.MaxLimitAuditLog.action,
            "old_quantity": r.MaxLimitAuditLog.old_quantity,
            "new_quantity": r.MaxLimitAuditLog.new_quantity,
            "source": r.MaxLimitAuditLog.source,
            "created_at": r.MaxLimitAuditLog.created_at.isoformat() if r.MaxLimitAuditLog.created_at else None,
            "generic_item_number": r.generic_item_number,
        }
        for r in rows
    ]
    return JSONResponse(
        content=out,
        headers={"X-Total-Count": str(total)},
    )
