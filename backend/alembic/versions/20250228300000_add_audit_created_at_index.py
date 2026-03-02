"""add index on max_limit_audit_logs.created_at for usage analytics

Revision ID: 20250228300000
Revises: 20250228200000
Create Date: 2026-02-28

"""
from typing import Sequence, Union

from alembic import op

revision: str = "20250228300000"
down_revision: Union[str, None] = "20250228200000"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index(
        op.f("ix_max_limit_audit_logs_created_at"),
        "max_limit_audit_logs",
        ["created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_max_limit_audit_logs_created_at"), table_name="max_limit_audit_logs")
