#!/usr/bin/env python3
"""
Import items from Excel (sheet "البيانات المحسنة") into the items table.
Upserts by generic_item_number.
Run from backend/: python import_items.py --file "../path/to/file.xlsx"
"""
import argparse
import re
from pathlib import Path

import pandas as pd
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.database import SessionLocal
from app.models import Item

SHEET_NAME = "البيانات المحسنة"
COL_NUMBER = "Generic Item Number"
COL_DESCRIPTION = "Generic Item description"

CLINICAL_COL_MAP = {
    "Category_AR": "category_ar",
    "Clinical_Use": "clinical_use",
    "Clinical_Category": "clinical_category",
    "Specialty_Tags": "specialty_tags",
    "Item Family Group": "item_family_group",
    "Detailed_Use": "detailed_use",
}


def _clean_str(val, max_len: int = 255) -> str | None:
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return None
    s = str(val).strip()
    return s[:max_len] if s else None


def normalize_item_number(val) -> str | None:
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return None
    s = str(val).strip()
    if not s:
        return None
    # Remove trailing .0 from Excel numbers
    s = re.sub(r"\.0+$", "", s)
    return s if s else None


def _chunked(rows: list[dict], size: int):
    for i in range(0, len(rows), size):
        yield rows[i : i + size]


def main():
    parser = argparse.ArgumentParser(description="Import items from Excel into items table")
    parser.add_argument(
        "--file",
        default="../NUPCO_Clinical_Details_20260215_185552.xlsx",
        help="Path to Excel file (default: ../NUPCO_Clinical_Details_20260215_185552.xlsx)",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=1000,
        help="Batch size for bulk upsert (default: 1000)",
    )
    args = parser.parse_args()
    path = Path(args.file).resolve()
    if not path.exists():
        print(f"Error: file not found: {path}")
        return 1

    df = pd.read_excel(path, sheet_name=SHEET_NAME, engine="openpyxl")
    # Normalize column names (strip whitespace)
    df.columns = df.columns.str.strip()
    if COL_NUMBER not in df.columns:
        print(f"Error: column '{COL_NUMBER}' not found. Columns: {list(df.columns)}")
        return 1

    desc_col = COL_DESCRIPTION if COL_DESCRIPTION in df.columns else None
    total = len(df)
    skipped = 0
    rows_by_code: dict[str, dict] = {}

    db = SessionLocal()
    try:
        for _, row in df.iterrows():
            num = normalize_item_number(row.get(COL_NUMBER))
            if not num:
                skipped += 1
                continue
            desc = row.get(desc_col)
            if desc is not None and isinstance(desc, str):
                desc = desc.strip() or None
            elif pd.isna(desc):
                desc = None
            else:
                desc = str(desc).strip() or None

            clinical = {}
            for excel_col, model_attr in CLINICAL_COL_MAP.items():
                max_len = 1024 if model_attr == "detailed_use" else 255
                clinical[model_attr] = _clean_str(row.get(excel_col), max_len) if excel_col in df.columns else None

            rows_by_code[num] = {
                "generic_item_number": num,
                "generic_description": desc,
                **clinical,
            }

        if not rows_by_code:
            print("Import summary:")
            print(f"  Total rows read:  {total}")
            print("  Inserted:        0")
            print("  Updated:         0")
            print(f"  Skipped/invalid:  {skipped}")
            return 0

        codes = list(rows_by_code.keys())
        existing_codes = set(
            db.execute(
                select(Item.generic_item_number).where(Item.generic_item_number.in_(codes))
            ).scalars().all()
        )

        payload = list(rows_by_code.values())
        for chunk in _chunked(payload, max(1, args.batch_size)):
            stmt = pg_insert(Item).values(chunk)
            stmt = stmt.on_conflict_do_update(
                index_elements=[Item.generic_item_number],
                set_={
                    "generic_description": stmt.excluded.generic_description,
                    "category_ar": stmt.excluded.category_ar,
                    "clinical_use": stmt.excluded.clinical_use,
                    "clinical_category": stmt.excluded.clinical_category,
                    "specialty_tags": stmt.excluded.specialty_tags,
                    "item_family_group": stmt.excluded.item_family_group,
                    "detailed_use": stmt.excluded.detailed_use,
                },
            )
            db.execute(stmt)

        db.commit()

        inserted = sum(1 for code in rows_by_code if code not in existing_codes)
        updated = len(rows_by_code) - inserted
    finally:
        db.close()

    print("Import summary:")
    print(f"  Total rows read:  {total}")
    print(f"  Inserted:        {inserted}")
    print(f"  Updated:         {updated}")
    print(f"  Skipped/invalid:  {skipped}")
    return 0


if __name__ == "__main__":
    exit(main())
