# Nupco Limit (MVP)

Manage **department max limits** for items: set per-department ceilings, see facility totals, get **alternatives** suggestions, **import/export Excel**, **audit log**, and **DB backup**. Local-first, no full auth — protected by an optional admin key.

**Stack:** Backend FastAPI + SQLAlchemy + Alembic + PostgreSQL · Frontend Next.js (App Router) + TypeScript + Tailwind.

---

## What the project does

- **Department max limits:** Per-department max quantity per item (and effective year). Facility totals are computed automatically (DB trigger).
- **Alternatives:** Similar-item suggestions with scores; set limits from the table or the “Add new item” panel.
- **Import:**  
  - **Master Excel** — creates departments and bulk-fills limits (sheet "المجموع").  
  - **Department Excel** — update one department from a file (preview table then confirm).
- **Export:** Download department limits as `.xlsx` (matches import format).
- **Audit:** Log of every change (insert/update/delete) with old/new value and source (manual, import_excel, seed_excel).
- **Backup:** Download a PostgreSQL dump (`.sql`) when `APP_ENV=local`.

---

## Quick start

**Prerequisites:** Python 3.11+, Node.js 18+, PostgreSQL, macOS (commands below).

### 1. Backend — venv and install

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 2. Database

```bash
# Create DB (adjust user if needed)
psql -U postgres -d postgres -c "CREATE DATABASE nupco_limit;"
# Or with local superuser:
psql -d postgres -c "CREATE DATABASE nupco_limit;"
```

### 3. Backend — env and migrations

```bash
# From repo root
cp backend/.env.example backend/.env
# Edit backend/.env: set DATABASE_URL, and optionally APP_ENV=local

cd backend
source .venv/bin/activate
alembic upgrade head
```

### 4. Run backend

```bash
cd backend
source .venv/bin/activate
uvicorn app.main:app --reload --host 0.0.0.0 --port 8011
```

Backend: **http://127.0.0.1:8011** · Health: http://127.0.0.1:8011/health → `{"status":"ok"}`.

### 5. Frontend — install and run

In a **new terminal**:

```bash
cd frontend
cp .env.local.example .env.local
# Edit .env.local if API is not at http://127.0.0.1:8011 (e.g. NEXT_PUBLIC_API_URL)
npm install
npm run dev
```

Open **http://localhost:1111**. Main app page: **http://localhost:1111/hospitals/1/departments**.

---

## Required env vars

| Where | Variable | Description |
|-------|----------|-------------|
| **backend/.env** | `DATABASE_URL` | PostgreSQL URL, e.g. `postgresql://user:pass@localhost:5432/nupco_limit` |
| **backend/.env** | `APP_ENV` | Set to `local` to enable DB backup; leave unset in production |
| **backend/.env** | `ADMIN_KEY` | Optional (currently ignored; admin-key checks are disabled) |
| **frontend/.env.local** | `NEXT_PUBLIC_API_URL` | Backend URL, default `http://127.0.0.1:8011` |

---

## Main UI: /hospitals/1/departments

- **Department dropdown** — select department; table shows limits and facility totals.
- **Search** — filter by item code/description.
- **Export Excel** — download limits for the selected department (and search).
- **Import Excel** — upload file → preview table → Confirm to apply (or Cancel).
- **Backup DB** — download `.sql` dump (when `APP_ENV=local`).
- **Audit** — open modal with last 50 changes for the selected department.
- **Table** — inline edit quantity; expand row for alternatives and set limits there.
- **Add new item** — search item, set max qty; optional alternatives with limits.

---

## Safety notes

- **Access control:** Admin-key checks are currently disabled, so import/admin endpoints are open in this phase.
- **Local-first:** Backup and “local-only” behaviour are gated by `APP_ENV=local`. Do not set that in production.
- **Backup:** Take a DB backup (Backup DB or `curl` to `/api/admin/db-backup`) before bulk imports or restore.

---

More detail, import/export order, and troubleshooting: **backend/LOCAL_SETUP.md**.
