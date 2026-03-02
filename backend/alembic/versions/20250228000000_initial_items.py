"""Initial items table

Revision ID: 20250228000000
Revises:
Create Date: 2025-02-28

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20250228000000"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "items",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("generic_item_number", sa.String(length=255), nullable=False),
        sa.Column("generic_description", sa.String(length=512), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("generic_item_number", name="uq_items_generic_item_number"),
    )
    op.create_index(
        op.f("ix_items_generic_item_number"),
        "items",
        ["generic_item_number"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_items_generic_item_number"), table_name="items")
    op.drop_table("items")
