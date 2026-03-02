"""add hospital profile fields (city, region, contact_name, contact_phone, notes)

Revision ID: 20250228400000
Revises: 20250228300000
Create Date: 2026-02-28

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20250228400000"
down_revision: Union[str, None] = "20250228300000"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("hospitals", sa.Column("city", sa.String(128), nullable=True))
    op.add_column("hospitals", sa.Column("region", sa.String(128), nullable=True))
    op.add_column("hospitals", sa.Column("contact_name", sa.String(255), nullable=True))
    op.add_column("hospitals", sa.Column("contact_phone", sa.String(32), nullable=True))
    op.add_column("hospitals", sa.Column("notes", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("hospitals", "notes")
    op.drop_column("hospitals", "contact_phone")
    op.drop_column("hospitals", "contact_name")
    op.drop_column("hospitals", "region")
    op.drop_column("hospitals", "city")
