"""add access_pin to departments

Revision ID: 20250228500000
Revises: 20250228400000
Create Date: 2026-02-28

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20250228500000"
down_revision: Union[str, None] = "20250228400000"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("departments", sa.Column("access_pin", sa.String(16), nullable=True))


def downgrade() -> None:
    op.drop_column("departments", "access_pin")
