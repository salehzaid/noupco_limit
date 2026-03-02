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


def main():
    parser = argparse.ArgumentParser(description="Import items from Excel into items table")
    parser.add_argument(
        "--file",
        default="../NUPCO_Clinical_Details_20260215_185552.xlsx",
        help="Path to Excel file (default: ../NUPCO_Clinical_Details_20260215_185552.xlsx)",
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
    inserted = 0
    updated = 0
    skipped = 0

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

            existing = db.execute(select(Item).where(Item.generic_item_number == num)).scalar_one_or_none()
            if existing:
                existing.generic_description = desc
                for attr, val in clinical.items():
                    setattr(existing, attr, val)
                db.commit()
                updated += 1
            else:
                db.add(Item(generic_item_number=num, generic_description=desc, **clinical))
                db.commit()
                inserted += 1
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
