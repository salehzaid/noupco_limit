"""Audit log for department max limit changes (who/what/when)."""
from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, func

from app.database import Base


class MaxLimitAuditLog(Base):
    """One row per insert/update/delete on department_max_limits."""

    __tablename__ = "max_limit_audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    item_id = Column(Integer, ForeignKey("items.id"), nullable=False, index=True)
    department_id = Column(Integer, ForeignKey("departments.id"), nullable=False, index=True)
    effective_year = Column(Integer, nullable=True, index=True)
    action = Column(String(16), nullable=False)  # "insert" | "update" | "delete"
    old_quantity = Column(Integer, nullable=True)
    new_quantity = Column(Integer, nullable=True)
    source = Column(String(64), nullable=False)  # "manual" | "import_excel" | "seed_excel"
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
