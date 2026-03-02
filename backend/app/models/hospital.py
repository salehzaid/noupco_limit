"""Hospital entity — each hospital has many departments."""
from sqlalchemy import Boolean, Column, DateTime, Integer, String, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.database import Base


class Hospital(Base):
    __tablename__ = "hospitals"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), unique=True, nullable=False, index=True)
    code = Column(String(64), unique=True, nullable=True, index=True)
    is_active = Column(Boolean, default=True, nullable=False)
    city = Column(String(128), nullable=True)
    region = Column(String(128), nullable=True)
    contact_name = Column(String(255), nullable=True)
    contact_phone = Column(String(32), nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    departments = relationship("Department", back_populates="hospital")
