from sqlalchemy import Column, DateTime, ForeignKey, Integer, func

from app.database import Base


class FacilityMaxLimit(Base):
    """Facility-wide total max quantity per item (derived or manual). One row per item."""

    __tablename__ = "facility_max_limits"

    item_id = Column(Integer, ForeignKey("items.id"), primary_key=True)
    total_max_quantity = Column(Integer, nullable=False)
    effective_year = Column(Integer, nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
