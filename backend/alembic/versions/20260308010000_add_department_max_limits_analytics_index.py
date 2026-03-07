"""add composite index for department analytics sorting

Revision ID: 20260308010000
Revises: 20250228500000
Create Date: 2026-03-08

"""

from typing import Sequence, Union

from alembic import op

revision: str = "20260308010000"
down_revision: Union[str, None] = "20250228500000"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index(
        "ix_department_max_limits_dept_year_updated",
        "department_max_limits",
        ["department_id", "effective_year", "updated_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_department_max_limits_dept_year_updated",
        table_name="department_max_limits",
    )
