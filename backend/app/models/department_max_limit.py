from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint, func

from app.database import Base


class DepartmentMaxLimit(Base):
    """Per-department max quantity for an item (optionally per effective_year)."""

    __tablename__ = "department_max_limits"
    __table_args__ = (
        UniqueConstraint(
            "item_id", "department_id", "effective_year",
            name="uq_department_max_limits_item_dept_year",
        ),
        Index("ix_department_max_limits_dept_item", "department_id", "item_id"),
    )

    id = Column(Integer, primary_key=True, index=True)
    item_id = Column(Integer, ForeignKey("items.id"), nullable=False, index=True)
    department_id = Column(Integer, ForeignKey("departments.id"), nullable=False, index=True)
    max_quantity = Column(Integer, nullable=False)
    effective_year = Column(Integer, nullable=True)
    source = Column(String(64), default="manual", nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
