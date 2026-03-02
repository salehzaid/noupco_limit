"""add hospitals table and link departments

Revision ID: 20250228200000
Revises: 20250228100000
Create Date: 2026-02-28

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20250228200000"
down_revision: Union[str, None] = "20250228100000"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1) Create hospitals table
    op.create_table(
        "hospitals",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("code", sa.String(length=64), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name", name="uq_hospitals_name"),
        sa.UniqueConstraint("code", name="uq_hospitals_code"),
    )
    op.create_index(op.f("ix_hospitals_id"), "hospitals", ["id"], unique=False)
    op.create_index(op.f("ix_hospitals_name"), "hospitals", ["name"], unique=True)
    op.create_index(op.f("ix_hospitals_code"), "hospitals", ["code"], unique=True)

    # 2) Insert default hospital
    hospitals_table = sa.table(
        "hospitals",
        sa.column("id", sa.Integer),
        sa.column("name", sa.String),
        sa.column("code", sa.String),
        sa.column("is_active", sa.Boolean),
    )
    op.bulk_insert(hospitals_table, [{"id": 1, "name": "Hotat Sudair Hospital", "code": "HSD", "is_active": True}])

    # 3) Add hospital_id column to departments (nullable for safety)
    op.add_column("departments", sa.Column("hospital_id", sa.Integer(), nullable=True))
    op.create_foreign_key("fk_departments_hospital_id", "departments", "hospitals", ["hospital_id"], ["id"])
    op.create_index(op.f("ix_departments_hospital_id"), "departments", ["hospital_id"], unique=False)

    # 4) Set all existing departments to the default hospital
    op.execute("UPDATE departments SET hospital_id = 1 WHERE hospital_id IS NULL")


def downgrade() -> None:
    op.drop_index(op.f("ix_departments_hospital_id"), table_name="departments")
    op.drop_constraint("fk_departments_hospital_id", "departments", type_="foreignkey")
    op.drop_column("departments", "hospital_id")
    op.drop_index(op.f("ix_hospitals_code"), table_name="hospitals")
    op.drop_index(op.f("ix_hospitals_name"), table_name="hospitals")
    op.drop_index(op.f("ix_hospitals_id"), table_name="hospitals")
    op.drop_table("hospitals")
