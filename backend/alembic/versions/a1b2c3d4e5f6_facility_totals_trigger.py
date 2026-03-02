"""facility totals trigger

Adds SQL function and trigger so facility_max_limits is updated automatically
when department_max_limits changes (sum per item_id + effective_year).
"""
from typing import Sequence, Union

from alembic import op


revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = "7b7b97a458d3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


RECALC_SQL = """
CREATE OR REPLACE FUNCTION facility_max_limits_recalc(p_item_id integer, p_year integer)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_sum integer;
BEGIN
  SELECT SUM(max_quantity) INTO v_sum
  FROM department_max_limits
  WHERE item_id = p_item_id
    AND (effective_year IS NOT DISTINCT FROM p_year);

  IF v_sum IS NULL THEN
    DELETE FROM facility_max_limits
    WHERE item_id = p_item_id
      AND (effective_year IS NOT DISTINCT FROM p_year);
    RETURN;
  END IF;

  INSERT INTO facility_max_limits (item_id, total_max_quantity, effective_year, updated_at)
  VALUES (p_item_id, v_sum, p_year, now())
  ON CONFLICT (item_id) DO UPDATE SET
    total_max_quantity = EXCLUDED.total_max_quantity,
    effective_year = EXCLUDED.effective_year,
    updated_at = now();
END;
$$;
"""

TRIGGER_FN_SQL = """
CREATE OR REPLACE FUNCTION facility_max_limits_trigger_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM facility_max_limits_recalc(NEW.item_id, NEW.effective_year);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.item_id IS DISTINCT FROM NEW.item_id OR OLD.effective_year IS DISTINCT FROM NEW.effective_year THEN
      PERFORM facility_max_limits_recalc(OLD.item_id, OLD.effective_year);
    END IF;
    PERFORM facility_max_limits_recalc(NEW.item_id, NEW.effective_year);
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM facility_max_limits_recalc(OLD.item_id, OLD.effective_year);
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;
"""


def upgrade() -> None:
    op.execute(RECALC_SQL)
    op.execute(TRIGGER_FN_SQL)
    op.execute("""
        CREATE TRIGGER trg_department_max_limits_facility_recalc
        AFTER INSERT OR UPDATE OR DELETE ON department_max_limits
        FOR EACH ROW
        EXECUTE FUNCTION facility_max_limits_trigger_fn();
    """)


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_department_max_limits_facility_recalc ON department_max_limits;")
    op.execute("DROP FUNCTION IF EXISTS facility_max_limits_trigger_fn();")
    op.execute("DROP FUNCTION IF EXISTS facility_max_limits_recalc(integer, integer);")
