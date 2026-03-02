"""
Import max limits master Excel: creates departments and fills department_max_limits.
Facility totals are updated automatically by the DB trigger.
"""
import io
import re
from typing import Any

import pandas as pd
from fastapi import APIRouter, Depends, File, Query, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.crud.audit import log_max_limit_change
from app.database import get_db
from app.dependencies import require_admin_key
from app.models import Department, DepartmentMaxLimit, Item

router = APIRouter(prefix="/api/import", tags=["import"])

SHEET_NAME = "المجموع"
REQUIRED_HEADERS = ["كود نوبكو", "Desc", "الحد الأعلى للمستشفى 2025"]
MAX_ERROR_SAMPLE = 20


def _normalize_code(val: Any) -> str | None:
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return None
    s = str(val).strip().replace("\u00a0", " ").strip()
    s = re.sub(r"\.0+$", "", s)
    return s if s else None


def _parse_cell_value(val: Any) -> tuple[int | None, bool, bool]:
    """
    Returns (value, is_skipped, is_invalid).
    - value: positive int to use, or None
    - is_skipped: empty, 0, or NaN (not counted as invalid)
    - is_invalid: non-numeric, negative, or other bad value
    """
    if val is None or (isinstance(val, float) and pd.isna(val)) or val == "":
        return None, True, False
    s = str(val).strip()
    if not s:
        return None, True, False
    try:
        n = int(float(val))
        if n < 0:
            return None, False, True
        if n == 0:
            return None, True, False
        return n, False, False
    except (ValueError, TypeError):
        return None, False, True


def _error_response(
    effective_year: int,
    dry_run: bool,
    errors_sample: list[str],
    rows_read: int = 0,
    **kwargs: int,
) -> dict:
    return {
        "effective_year": effective_year,
        "dry_run": dry_run,
        "hospital_id": kwargs.get("hospital_id"),
        "departments_created": kwargs.get("departments_created", 0),
        "departments_linked": kwargs.get("departments_linked", 0),
        "departments_total": kwargs.get("departments_total", 0),
        "rows_read": rows_read,
        "limits_upserted": kwargs.get("limits_upserted", 0),
        "missing_items": kwargs.get("missing_items", 0),
        "created_items": kwargs.get("created_items", 0),
        "skipped_values": kwargs.get("skipped_values", 0),
        "invalid_values": kwargs.get("invalid_values", 0),
        "errors_sample": errors_sample[:MAX_ERROR_SAMPLE],
    }


@router.post("/max-limits-master")
def import_max_limits_master(
    file: UploadFile = File(..., description="Excel file (.xlsx) with sheet 'المجموع'"),
    effective_year: int = Query(2025, description="Year for effective_year"),
    dry_run: bool = Query(False, description="If true, do not commit changes"),
    create_missing_items: bool = Query(True, description="If true, create placeholder Item for unknown codes"),
    hospital_id: int | None = Query(None, description="If provided, link all created/matched departments to this hospital"),
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_key),
):
    try:
        return _import_max_limits_master_impl(file, effective_year, dry_run, create_missing_items, db, hospital_id=hospital_id)
    except Exception as e:
        import traceback
        db.rollback()
        return _error_response(
            effective_year,
            dry_run,
            [f"Internal error: {e!s}", traceback.format_exc()[-500:]],
        )


def _import_max_limits_master_impl(
    file: UploadFile,
    effective_year: int,
    dry_run: bool,
    create_missing_items: bool,
    db: Session,
    hospital_id: int | None = None,
) -> dict:
    if not file.filename or not file.filename.lower().endswith((".xlsx", ".xls")):
        return _error_response(effective_year, dry_run, ["File must be .xlsx"])

    content = file.file.read()
    try:
        df = pd.read_excel(io.BytesIO(content), sheet_name=SHEET_NAME, engine="openpyxl")
    except Exception as e:
        return _error_response(effective_year, dry_run, [str(e)[:200]])

    df.columns = [str(c).strip() for c in df.columns]
    missing_items_count = 0
    created_items_count = 0
    skipped_values_count = 0
    invalid_values_count = 0
    errors_sample: list[str] = []

    # Find required columns and department columns
    required_set = set(REQUIRED_HEADERS)
    first_three = [c for c in df.columns if c in required_set]
    if len(first_three) < 3:
        return _error_response(
            effective_year,
            dry_run,
            [f"Missing required columns. Need: {REQUIRED_HEADERS}. Got: {list(df.columns)[:10]}"],
            rows_read=len(df),
        )

    # Department columns = all columns that are not one of the 3 required (we do not import facility column)
    dept_columns = [c for c in df.columns if c not in required_set]

    # Preload item map: generic_item_number -> id
    items = db.execute(select(Item.id, Item.generic_item_number)).all()
    item_map: dict[str, int] = {str(r.generic_item_number).strip(): r.id for r in items}

    # Preload and upsert departments by name; optionally link them to a hospital
    existing_depts = db.execute(select(Department)).scalars().all()
    dept_map: dict[str, int] = {r.name: r.id for r in existing_depts}
    departments_created = 0
    departments_linked = 0  # existing depts that were linked to hospital for the first time

    for name in dept_columns:
        if not name or not str(name).strip():
            continue
        name = str(name).strip()
        if name not in dept_map:
            dept = Department(name=name, is_active=True, hospital_id=hospital_id)
            db.add(dept)
            db.flush()
            dept_map[name] = dept.id
            departments_created += 1
        elif hospital_id is not None:
            # Link existing department to this hospital if not already linked
            dept_obj = db.execute(select(Department).where(Department.id == dept_map[name])).scalar_one_or_none()
            if dept_obj and dept_obj.hospital_id is None:
                dept_obj.hospital_id = hospital_id
                departments_linked += 1

    limits_upserted = 0
    BATCH = 200
    to_upsert: list[tuple[int, int, int]] = []

    for _, row in df.iterrows():
        code = _normalize_code(row.get("كود نوبكو"))
        if not code:
            continue
        item_id = item_map.get(code)
        if item_id is None:
            if create_missing_items:
                desc = row.get("Desc")
                if desc is None or (isinstance(desc, float) and pd.isna(desc)):
                    desc = ""
                else:
                    desc = str(desc).strip()[:512] if desc else ""
                new_item = Item(generic_item_number=code, generic_description=desc or None)
                db.add(new_item)
                db.flush()
                item_map[code] = new_item.id
                created_items_count += 1
                item_id = new_item.id
            else:
                missing_items_count += 1
                if len(errors_sample) < MAX_ERROR_SAMPLE:
                    errors_sample.append(f"Missing item for code: {code!r}")
                continue

        for col in dept_columns:
            val = row.get(col)
            n, is_skipped, is_invalid = _parse_cell_value(val)
            if is_skipped:
                skipped_values_count += 1
                continue
            if is_invalid:
                invalid_values_count += 1
                if len(errors_sample) < MAX_ERROR_SAMPLE:
                    errors_sample.append(f"Invalid value for {code!r} / {col!r}: {val!r}")
                continue
            if n is None:
                continue
            dept_id = dept_map.get(str(col).strip())
            if dept_id is None:
                continue
            to_upsert.append((item_id, dept_id, n))
            if len(to_upsert) >= BATCH:
                _flush_upserts(db, to_upsert, effective_year, dry_run=dry_run)
                limits_upserted += len(to_upsert)
                to_upsert = []

    if to_upsert:
        _flush_upserts(db, to_upsert, effective_year, dry_run=dry_run)
        limits_upserted += len(to_upsert)

    if dry_run:
        db.rollback()
    else:
        db.commit()

    return {
        "effective_year": effective_year,
        "dry_run": dry_run,
        "hospital_id": hospital_id,
        "departments_created": departments_created,
        "departments_linked": departments_linked,
        "departments_total": len(dept_map),
        "rows_read": len(df),
        "limits_upserted": limits_upserted,
        "missing_items": missing_items_count,
        "created_items": created_items_count,
        "skipped_values": skipped_values_count,
        "invalid_values": invalid_values_count,
        "errors_sample": errors_sample[:MAX_ERROR_SAMPLE],
    }


def _flush_upserts(db: Session, rows: list[tuple[int, int, int]], effective_year: int, dry_run: bool = False) -> None:
    for item_id, department_id, max_quantity in rows:
        existing = db.execute(
            select(DepartmentMaxLimit).where(
                DepartmentMaxLimit.item_id == item_id,
                DepartmentMaxLimit.department_id == department_id,
                DepartmentMaxLimit.effective_year == effective_year,
            )
        ).scalar_one_or_none()
        if existing:
            if not dry_run:
                log_max_limit_change(
                    db, item_id, department_id, effective_year,
                    "update", existing.max_quantity, max_quantity, "seed_excel",
                )
            existing.max_quantity = max_quantity
            existing.source = "seed_excel"
        else:
            if not dry_run:
                log_max_limit_change(
                    db, item_id, department_id, effective_year,
                    "insert", None, max_quantity, "seed_excel",
                )
            db.add(
                DepartmentMaxLimit(
                    item_id=item_id,
                    department_id=department_id,
                    max_quantity=max_quantity,
                    effective_year=effective_year,
                    source="seed_excel",
                )
            )
    db.flush()


# --- Department-specific import (Excel format matches export) ---

DEPT_IMPORT_CODE_COL = "Generic Item Number"
DEPT_IMPORT_QTY_COL = "Department Max Quantity"
# Short codes (e.g. 6 digits) may be resolved by prefix match only when unique.
SHORT_CODE_MAX_LENGTH = 13
# Max preview rows returned when dry_run=true to avoid huge payload.
PREVIEW_MAX_ROWS = 200


def _parse_qty_for_import(val: Any) -> tuple[int | None, str | None]:
    """
    Returns (value, error). value is int for upsert, 0 for delete, None for skip.
    error is non-empty if invalid.
    """
    if val is None or (isinstance(val, float) and pd.isna(val)) or val == "":
        return None, None  # skip
    s = str(val).strip()
    if not s:
        return None, None
    try:
        n = int(float(val))
        if n < 0:
            return None, f"Negative: {val!r}"
        return n, None
    except (ValueError, TypeError):
        return None, f"Invalid: {val!r}"


@router.post("/department-max-limits")
def import_department_max_limits(
    file: UploadFile = File(..., description="Excel file (.xlsx) matching export columns"),
    department_id: int = Query(..., description="Department ID"),
    effective_year: int = Query(2025, description="Year for effective_year"),
    dry_run: bool = Query(False, description="If true, do not commit changes"),
    db: Session = Depends(get_db),
    _: None = Depends(require_admin_key),
):
    """
    Import department max limits from Excel. Minimum columns: Generic Item Number, Department Max Quantity.
    Rows with qty <= 0 unset the limit (delete); positive qty upserts with source=import_excel.
    """
    try:
        return _import_department_max_limits_impl(file, department_id, effective_year, dry_run, db)
    except Exception as e:
        import traceback
        db.rollback()
        return {
            "department_id": department_id,
            "effective_year": effective_year,
            "dry_run": dry_run,
            "rows_read": 0,
            "upserted": 0,
            "deleted": 0,
            "missing_items": 0,
            "invalid_values": 0,
            "prefix_matched": 0,
            "ambiguous_codes": 0,
            "errors_sample": [f"Internal error: {e!s}", traceback.format_exc()[-400:]],
        }


def _import_department_max_limits_impl(
    file: UploadFile,
    department_id: int,
    effective_year: int,
    dry_run: bool,
    db: Session,
) -> dict:
    if not file.filename or not file.filename.lower().endswith((".xlsx", ".xls")):
        return {
            "department_id": department_id,
            "effective_year": effective_year,
            "dry_run": dry_run,
            "rows_read": 0,
            "upserted": 0,
            "deleted": 0,
            "missing_items": 0,
            "invalid_values": 0,
            "prefix_matched": 0,
            "ambiguous_codes": 0,
            "errors_sample": ["File must be .xlsx"],
        }

    content = file.file.read()
    try:
        df = pd.read_excel(io.BytesIO(content), sheet_name=0, engine="openpyxl")
    except Exception as e:
        return {
            "department_id": department_id,
            "effective_year": effective_year,
            "dry_run": dry_run,
            "rows_read": 0,
            "upserted": 0,
            "deleted": 0,
            "missing_items": 0,
            "invalid_values": 0,
            "prefix_matched": 0,
            "ambiguous_codes": 0,
            "errors_sample": [str(e)[:200]],
        }

    df.columns = [str(c).strip() for c in df.columns]
    if DEPT_IMPORT_CODE_COL not in df.columns or DEPT_IMPORT_QTY_COL not in df.columns:
        return {
            "department_id": department_id,
            "effective_year": effective_year,
            "dry_run": dry_run,
            "rows_read": len(df),
            "upserted": 0,
            "deleted": 0,
            "missing_items": 0,
            "invalid_values": 0,
            "prefix_matched": 0,
            "ambiguous_codes": 0,
            "errors_sample": [f"Required columns: {DEPT_IMPORT_CODE_COL!r}, {DEPT_IMPORT_QTY_COL!r}. Got: {list(df.columns)[:10]}"],
        }

    items = db.execute(select(Item.id, Item.generic_item_number)).all()
    item_map: dict[str, int] = {}
    for r in items:
        k = _normalize_code(r.generic_item_number)
        if k:
            item_map[k] = r.id

    rows_read = len(df)
    upserted = 0
    deleted = 0
    missing_items = 0
    invalid_values = 0
    prefix_matched = 0
    ambiguous_codes = 0
    errors_sample: list[str] = []
    preview_rows: list[dict] = []  # only populated when dry_run

    for _, row in df.iterrows():
        code = _normalize_code(row.get(DEPT_IMPORT_CODE_COL))
        if not code:
            continue
        # 1) Exact match first
        item_id = item_map.get(code)
        if item_id is None and len(code) < SHORT_CODE_MAX_LENGTH:
            # 2) Short code: try prefix match (LIKE code%) — safe only when exactly one match
            prefix_rows = db.execute(
                select(Item.id).where(Item.generic_item_number.like(f"{code}%"))
            ).all()
            if len(prefix_rows) == 1:
                item_id = prefix_rows[0].id
                prefix_matched += 1
            elif len(prefix_rows) > 1:
                ambiguous_codes += 1
                if len(errors_sample) < MAX_ERROR_SAMPLE:
                    errors_sample.append(f"Ambiguous code prefix {code!r} matched {len(prefix_rows)} items")
                if dry_run and len(preview_rows) < PREVIEW_MAX_ROWS:
                    preview_rows.append({
                        "generic_item_number": code,
                        "item_id": None,
                        "old_quantity": None,
                        "new_quantity": 0,
                        "action": "ambiguous",
                    })
                continue
        if item_id is None:
            missing_items += 1
            if len(errors_sample) < MAX_ERROR_SAMPLE:
                errors_sample.append(f"Missing item for code: {code!r}")
            if dry_run and len(preview_rows) < PREVIEW_MAX_ROWS:
                preview_rows.append({
                    "generic_item_number": code,
                    "item_id": None,
                    "old_quantity": None,
                    "new_quantity": 0,
                    "action": "missing",
                })
            continue

        qty_val, err = _parse_qty_for_import(row.get(DEPT_IMPORT_QTY_COL))
        if err:
            invalid_values += 1
            if len(errors_sample) < MAX_ERROR_SAMPLE:
                errors_sample.append(f"{code!r} qty {err}")
            if dry_run and len(preview_rows) < PREVIEW_MAX_ROWS:
                existing = db.execute(
                    select(DepartmentMaxLimit).where(
                        DepartmentMaxLimit.item_id == item_id,
                        DepartmentMaxLimit.department_id == department_id,
                        DepartmentMaxLimit.effective_year == effective_year,
                    )
                ).scalar_one_or_none()
                preview_rows.append({
                    "generic_item_number": code,
                    "item_id": item_id,
                    "old_quantity": existing.max_quantity if existing else None,
                    "new_quantity": 0,
                    "action": "skip",
                })
            continue
        if qty_val is None:
            if dry_run and len(preview_rows) < PREVIEW_MAX_ROWS:
                existing = db.execute(
                    select(DepartmentMaxLimit).where(
                        DepartmentMaxLimit.item_id == item_id,
                        DepartmentMaxLimit.department_id == department_id,
                        DepartmentMaxLimit.effective_year == effective_year,
                    )
                ).scalar_one_or_none()
                preview_rows.append({
                    "generic_item_number": code,
                    "item_id": item_id,
                    "old_quantity": existing.max_quantity if existing else None,
                    "new_quantity": 0,
                    "action": "skip",
                })
            continue  # skip empty

        # Resolve existing limit once for this row
        existing = db.execute(
            select(DepartmentMaxLimit).where(
                DepartmentMaxLimit.item_id == item_id,
                DepartmentMaxLimit.department_id == department_id,
                DepartmentMaxLimit.effective_year == effective_year,
            )
        ).scalar_one_or_none()
        old_qty = existing.max_quantity if existing else None
        new_qty = qty_val if qty_val > 0 else 0

        if qty_val <= 0:
            action = "delete" if existing else "skip"
            if dry_run:
                if len(preview_rows) < PREVIEW_MAX_ROWS:
                    preview_rows.append({
                        "generic_item_number": code,
                        "item_id": item_id,
                        "old_quantity": old_qty,
                        "new_quantity": 0,
                        "action": action,
                    })
                if existing:
                    deleted += 1
            else:
                if existing:
                    log_max_limit_change(
                        db, item_id, department_id, effective_year,
                        "delete", old_qty, None, "import_excel",
                    )
                    db.delete(existing)
                    deleted += 1
        else:
            action = "update" if existing else "insert"
            if dry_run:
                if len(preview_rows) < PREVIEW_MAX_ROWS:
                    preview_rows.append({
                        "generic_item_number": code,
                        "item_id": item_id,
                        "old_quantity": old_qty,
                        "new_quantity": new_qty,
                        "action": action,
                    })
                upserted += 1
            else:
                if existing:
                    log_max_limit_change(
                        db, item_id, department_id, effective_year,
                        "update", old_qty, new_qty, "import_excel",
                    )
                    existing.max_quantity = qty_val
                    existing.source = "import_excel"
                else:
                    log_max_limit_change(
                        db, item_id, department_id, effective_year,
                        "insert", None, new_qty, "import_excel",
                    )
                    db.add(
                        DepartmentMaxLimit(
                            item_id=item_id,
                            department_id=department_id,
                            max_quantity=qty_val,
                            effective_year=effective_year,
                            source="import_excel",
                        )
                    )
                upserted += 1

    if dry_run:
        db.rollback()
    else:
        db.commit()

    out: dict = {
        "department_id": department_id,
        "effective_year": effective_year,
        "dry_run": dry_run,
        "rows_read": rows_read,
        "upserted": upserted,
        "deleted": deleted,
        "missing_items": missing_items,
        "invalid_values": invalid_values,
        "prefix_matched": prefix_matched,
        "ambiguous_codes": ambiguous_codes,
        "errors_sample": errors_sample[:MAX_ERROR_SAMPLE],
    }
    if dry_run and preview_rows:
        out["preview_rows"] = preview_rows
    return out
