"""
Fallback helper to recompute facility_max_limits for an item (e.g. after bulk import).
Normally the DB trigger keeps totals in sync; use this when you bypass the trigger.
"""
from sqlalchemy import text
from sqlalchemy.orm import Session


def recompute_facility_total(
    db: Session,
    item_id: int,
    effective_year: int | None = None,
) -> None:
    """Recompute and upsert facility_max_limits for one (item_id, effective_year) by calling the DB function."""
    db.execute(
        text("SELECT facility_max_limits_recalc(:item_id, :year)"),
        {"item_id": item_id, "year": effective_year},
    )
    db.commit()
