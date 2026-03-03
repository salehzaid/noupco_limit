# Backend local setup (macOS)

Exact step-by-step to run the backend and use import/export endpoints. See root **README.md** for full quick start (backend + frontend).

---

## 1. Python 3.11+

```bash
python3 --version   # should be 3.11 or higher
```

## 2. Virtual environment

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## 3. Create PostgreSQL database

```bash
psql -U postgres -d postgres -c "CREATE DATABASE nupco_limit;"
```

If your Mac user is the DB superuser (e.g. Homebrew Postgres):

```bash
psql -d postgres -c "CREATE DATABASE nupco_limit;"
```

## 4. Environment file

```bash
# From backend/
echo 'DATABASE_URL=postgresql://postgres:postgres@localhost:5432/nupco_limit' > .env
echo 'APP_ENV=local' >> .env
```

Edit `.env` if your username, password, or database name differ.  
- `APP_ENV=local`: enables DB backup.  
- `ADMIN_KEY`: currently ignored (admin-key checks are disabled).

## 5. Run migrations

```bash
cd backend
source .venv/bin/activate
alembic upgrade head
```

## 6. Run the server

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8011
```

Health: http://127.0.0.1:8011/health → `{"status":"ok"}`.

## 7. Run backend tests (optional)

```bash
cd backend
source .venv/bin/activate
pip install -r requirements-dev.txt
pytest -q
```

---

## Import steps (order matters)

### a) Import items (clinical file)

Seeds the `items` table from the NUPCO Clinical Details Excel (sheet "البيانات المحسنة"):

```bash
cd backend
source .venv/bin/activate
python import_items.py --file "../NUPCO_Clinical_Details_20260215_185552.xlsx"
```

Use `--file path/to/file.xlsx` if the file is elsewhere.

### b) Import max-limits-master (creates departments + limits)

Uploads an Excel file with sheet **"المجموع"**. Creates departments from column headers and upserts `department_max_limits`.

```bash
curl -X POST "http://127.0.0.1:8011/api/import/max-limits-master?effective_year=2025&dry_run=false&create_missing_items=true" \
  -F "file=@/path/to/الحد الاعلى الماستر حوطة سدير.xlsx"
```

Use `dry_run=true` first to see counts without applying.

### c) Import department-max-limits (preview + confirm)

Updates one department from an Excel file with columns **Generic Item Number** and **Department Max Quantity**. In the UI: choose file → preview table → Confirm Import. Via curl: dry run then apply.

```bash
# Dry run (preview, no writes)
curl -X POST "http://127.0.0.1:8011/api/import/department-max-limits?department_id=1&effective_year=2025&dry_run=true" \
  -F "file=@/path/to/department_1_max_limits_2025.xlsx"

# Apply
curl -X POST "http://127.0.0.1:8011/api/import/department-max-limits?department_id=1&effective_year=2025&dry_run=false" \
  -F "file=@/path/to/department_1_max_limits_2025.xlsx"
```

Short codes (e.g. 6 digits) are allowed only when they match exactly one item; otherwise the row is reported as ambiguous and skipped.

---

## Export steps

### a) Export department max limits (Excel)

```bash
curl -o department_1_max_limits_2025.xlsx \
  "http://127.0.0.1:8011/api/export/department-max-limits?department_id=1&effective_year=2025"
```

Optional search: `&q=LANCET`.

### b) DB backup (SQL dump)

Requires `pg_dump` (e.g. `brew install postgresql` or Postgres.app). Allowed when `APP_ENV=local`.

```bash
curl -o nupco_limit_backup.sql "http://127.0.0.1:8011/api/admin/db-backup"
```

---

## Other endpoints (curl)

**Audit log** (no admin key):

```bash
curl -s "http://127.0.0.1:8011/api/audit/max-limits?department_id=1&limit=5"
```

---

## Troubleshooting

### CORS

If the frontend (e.g. localhost:1111) cannot call the backend (127.0.0.1:8011), the backend allows `localhost:1111` and `127.0.0.1:1111`. Ensure the frontend uses one of these origins and that `NEXT_PUBLIC_API_URL` points at `http://127.0.0.1:8011` (or the same host the browser uses). If you use another port or domain, add it in `app/main.py` in `CORSMiddleware` `allow_origins`.

### Access control note

- Admin-key checks are currently disabled, so import/admin endpoints are open in this phase.

### pg_dump missing

- **Symptom:** 503 or error when clicking Backup DB or calling `/api/admin/db-backup`.  
- **Cause:** `pg_dump` is not installed or not on PATH.  
- **Fix:**  
  - **Homebrew:** `brew install postgresql`.  
  - **Postgres.app:** Install from [postgresapp.com](https://postgresapp.com/) and add to PATH, e.g. in `~/.zshrc`:  
    `export PATH="/Applications/Postgres.app/Contents/Versions/latest/bin:$PATH"`.  
  Then ensure `APP_ENV=local` in `backend/.env`.

### Missing or ambiguous codes in import

- **Symptom:** Import response shows `missing_items` or `ambiguous_codes` and sample errors in `errors_sample`.  
- **Cause:**  
  - **Missing:** The Excel contains a Generic Item Number that does not exist in `items`. Run the items import (step a) or use master import with `create_missing_items=true` for unknown codes.  
  - **Ambiguous:** A short code (e.g. 6 digits) matches more than one item (`generic_item_number LIKE 'code%'`). The system refuses to guess.  
- **Fix:** Use full 13-digit codes where possible; for short codes, ensure they match only one item, or add the full code in the Excel.

### Alternatives look unrelated

- **Symptom:** Alternatives seem like unrelated items or just "nearby" codes rather than clinically similar.
- **Causes:**
  1. Item has poor or empty clinical metadata (e.g. placeholder items created from master import only, with no clinical file).
  2. Using Wide mode or a low `min_score`, so weaker matches are shown.
  3. Item description is too generic (e.g. "DEVICE", "KIT") so keyword overlap is weak.
- **Fixes:**
  1. Try **Strict** mode or raise `min_score` in the UI/API.
  2. Prefer items that have filled clinical fields (`category_ar`, `clinical_use`, `clinical_category`, `specialty_tags`).
  3. Re-run `import_items.py` from the NUPCO clinical file to enrich metadata for existing items.
  4. Call `/api/items/{id}/alternatives` without `min_score` so the backend applies `recommended_min_score`.
- **Quick debug:**

  Check metadata for an item:

  ```bash
  psql -d nupco_limit -c "SELECT id, generic_item_number, generic_description, category_ar, clinical_use, clinical_category FROM items WHERE id = 1;"
  ```

  Alternatives with backend-recommended min_score (no override):

  ```bash
  curl -s "http://127.0.0.1:8011/api/items/1/alternatives?auto_generate=true&top_k=5"
  ```

  With explicit min_score (e.g. stricter):

  ```bash
  curl -s "http://127.0.0.1:8011/api/items/1/alternatives?auto_generate=true&top_k=5&min_score=60"
  ```

---

## Verify tables (optional)

```bash
psql -d nupco_limit -c "\dt"
psql -d nupco_limit -c "\d items"
```

You should see `alembic_version`, `items`, `departments`, `department_max_limits`, `facility_max_limits`, `max_limit_audit_logs`, etc.

## Facility totals trigger

The DB trigger keeps `facility_max_limits` in sync with `department_max_limits`. Any insert/update/delete on `department_max_limits` recalculates the sum per (item_id, effective_year). No extra app code needed for normal imports.
