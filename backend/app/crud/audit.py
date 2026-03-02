"""Audit log helpers for max limit changes."""
from sqlalchemy.orm import Session

from app.models.max_limit_audit_log import MaxLimitAuditLog


def log_max_limit_change(
    db: Session,
    item_id: int,
    department_id: int,
    effective_year: int | None,
    action: str,  # "insert" | "update" | "delete"
    old_quantity: int | None,
    new_quantity: int | None,
    source: str,
) -> None:
    """Append one row to max_limit_audit_logs (same transaction)."""
    db.add(
        MaxLimitAuditLog(
            item_id=item_id,
            department_id=department_id,
            effective_year=effective_year,
            action=action,
            old_quantity=old_quantity,
            new_quantity=new_quantity,
            source=source,
        )
    )
