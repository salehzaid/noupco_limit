"""add max_limit_audit_logs table

Revision ID: 20250228100000
Revises: 65aad24d4996
Create Date: 2026-02-28

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20250228100000"
down_revision: Union[str, None] = "65aad24d4996"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "max_limit_audit_logs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("item_id", sa.Integer(), nullable=False),
        sa.Column("department_id", sa.Integer(), nullable=False),
        sa.Column("effective_year", sa.Integer(), nullable=True),
        sa.Column("action", sa.String(length=16), nullable=False),
        sa.Column("old_quantity", sa.Integer(), nullable=True),
        sa.Column("new_quantity", sa.Integer(), nullable=True),
        sa.Column("source", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["department_id"], ["departments.id"]),
        sa.ForeignKeyConstraint(["item_id"], ["items.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_max_limit_audit_logs_id"), "max_limit_audit_logs", ["id"], unique=False)
    op.create_index(op.f("ix_max_limit_audit_logs_item_id"), "max_limit_audit_logs", ["item_id"], unique=False)
    op.create_index(op.f("ix_max_limit_audit_logs_department_id"), "max_limit_audit_logs", ["department_id"], unique=False)
    op.create_index(op.f("ix_max_limit_audit_logs_effective_year"), "max_limit_audit_logs", ["effective_year"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_max_limit_audit_logs_effective_year"), table_name="max_limit_audit_logs")
    op.drop_index(op.f("ix_max_limit_audit_logs_department_id"), table_name="max_limit_audit_logs")
    op.drop_index(op.f("ix_max_limit_audit_logs_item_id"), table_name="max_limit_audit_logs")
    op.drop_index(op.f("ix_max_limit_audit_logs_id"), table_name="max_limit_audit_logs")
    op.drop_table("max_limit_audit_logs")
