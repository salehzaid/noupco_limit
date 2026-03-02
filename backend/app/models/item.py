from sqlalchemy import Column, Integer, String

from app.database import Base


class Item(Base):
    __tablename__ = "items"

    id = Column(Integer, primary_key=True, index=True)
    generic_item_number = Column(String(255), unique=True, nullable=False, index=True)
    generic_description = Column(String(512), nullable=True)

    # Clinical metadata (populated from NUPCO Clinical Details Excel)
    category_ar = Column(String(255), nullable=True, index=True)
    clinical_use = Column(String(255), nullable=True, index=True)
    clinical_category = Column(String(255), nullable=True, index=True)
    specialty_tags = Column(String(255), nullable=True, index=True)
    item_family_group = Column(String(255), nullable=True, index=True)
    detailed_use = Column(String(1024), nullable=True)
