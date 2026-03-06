"use client";

import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { LayoutGrid, Database, FileDown, FileUp, History, ChevronDown, Search, Plus, RefreshCw } from "lucide-react";
import AiReportPanel from "@/app/_components/AiReportPanel";
import { getApiBase, formatApiError } from "@/app/lib/api";

const API = getApiBase();
const PAGE_SIZE = 50;
const ALT_MODE_STORAGE_KEY = "nupco_limits_alternatives_mode";
const CHANGED_ITEMS_STORAGE_PREFIX = "nupco_changed_items_dept_";

type ApiErrorPayload = { detail?: string; message?: string; error?: string };

async function readApiError(res: Response, fallback: string): Promise<string> {
  if (res.status === 502 || res.status === 503 || res.status === 504) {
    return "الخدمة غير متاحة حاليا (Gateway). حاول مرة أخرى بعد دقيقة.";
  }

  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const payload = (await res.json().catch(() => null)) as ApiErrorPayload | null;
    const message = payload?.detail || payload?.message || payload?.error;
    if (message && message.trim()) return message.trim();
    return `${fallback} (${res.status})`;
  }

  const bodyText = await res.text().catch(() => "");
  const trimmed = bodyText.trim();
  if (trimmed && !trimmed.startsWith("<!DOCTYPE") && !trimmed.startsWith("<html")) {
    return trimmed.slice(0, 220);
  }

  return `${fallback} (${res.status})`;
}

type AltMode = "strict" | "balanced" | "wide";
const ALT_MODE_CONFIG: Record<AltMode, { top_k: number; min_score_override?: number }> = {
  strict: { top_k: 5, min_score_override: 60 },
  balanced: { top_k: 5 },
  wide: { top_k: 10, min_score_override: 45 },
};

type Dept = { id: number; name: string; is_active: boolean };
type LimitRow = { item_id: number; generic_item_number: string; generic_description: string | null; department_max_quantity: number; facility_total_quantity: number; updated_at: string; source: string; category_ar: string | null; clinical_use: string | null; clinical_category: string | null; specialty_tags: string | null; item_family_group: string | null };
type ClinicalMeta = { category_ar: string[]; clinical_use: string[]; clinical_category: string[]; specialty_tags: string[]; item_family_group: string[] };
type ItemHit = { id: number; generic_item_number: string; generic_description: string | null };
type UpsertRes = { item_id: number; department_id: number; department_max_quantity: number; facility_total_quantity: number; effective_year: number | null };
type AlternativeRow = { id: number; generic_item_number: string; generic_description: string | null; similarity_score: number; reasons?: string[] };
type AltWithLimit = AlternativeRow & { current_qty: number | null; facility_total: number };
type ImportPreviewRow = { generic_item_number: string; item_id: number | null; old_quantity: number | null; new_quantity: number; action: string };
type ImportResult = { department_id: number; effective_year: number; dry_run: boolean; rows_read: number; upserted: number; deleted: number; missing_items: number; invalid_values: number; prefix_matched?: number; ambiguous_codes?: number; errors_sample: string[]; preview_rows?: ImportPreviewRow[] };

const CLINICAL_LABELS: Record<string, string> = {
  category_ar: "التصنيف",
  clinical_use: "الاستخدام السريري",
  clinical_category: "الفئة السريرية",
  specialty_tags: "التخصص",
  item_family_group: "مجموعة البند",
};

/**
 * Props:
 *  - lockedDeptId: if set, department is fixed (no dropdown).
 *  - headerSlot: custom header content (e.g. back link + department name).
 */
export default function LimitsUI({ lockedDeptId, headerSlot }: { lockedDeptId?: number; headerSlot?: ReactNode } = {}) {
  const [departments, setDepartments] = useState<Dept[]>([]);
  const [deptId, setDeptId] = useState<number | null>(lockedDeptId ?? null);

  const [rows, setRows] = useState<LimitRow[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [hasMore, setHasMore] = useState(true);
  const [sortBy, setSortBy] = useState("dept_max_desc");
  const [qtyFilter, setQtyFilter] = useState("all");
  const [customQty, setCustomQty] = useState("");
  const [clinicalFilters, setClinicalFilters] = useState<Record<string, string>>({});
  const [clinicalMeta, setClinicalMeta] = useState<ClinicalMeta | null>(null);
  const [tableLoading, setTableLoading] = useState(false);
  const [tableLoadingMore, setTableLoadingMore] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);
  const isFetchingMoreRef = useRef(false);
  const rowsLengthRef = useRef(0);

  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [inlineQty, setInlineQty] = useState("");
  const [inlineSaveMsg, setInlineSaveMsg] = useState("");

  const [editedQtyByItemId, setEditedQtyByItemId] = useState<Record<number, string>>({});
  const [changedItemIds, setChangedItemIds] = useState<Record<number, boolean>>({});
  const [quickSavingItemId, setQuickSavingItemId] = useState<number | null>(null);
  const [quickSavedItemId, setQuickSavedItemId] = useState<number | null>(null);
  const savedIndicatorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [altsEnriched, setAltsEnriched] = useState<AltWithLimit[]>([]);
  const [altsRecommendedMinScore, setAltsRecommendedMinScore] = useState<number | null>(null);
  const [altsLoading, setAltsLoading] = useState(false);
  const [altsError, setAltsError] = useState<string | null>(null);
  const [altQtyMap, setAltQtyMap] = useState<Record<number, string>>({});
  const [altSaveMsg, setAltSaveMsg] = useState<Record<number, string>>({});

  const [itemQuery, setItemQuery] = useState("");
  const [itemHits, setItemHits] = useState<ItemHit[]>([]);
  const [selectedItem, setSelectedItem] = useState<ItemHit | null>(null);
  const [maxQty, setMaxQty] = useState("");
  const [saveMsg, setSaveMsg] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const itemTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [panelAlts, setPanelAlts] = useState<AltWithLimit[]>([]);
  const [panelAltsRecommendedMinScore, setPanelAltsRecommendedMinScore] = useState<number | null>(null);
  const [panelAltsLoading, setPanelAltsLoading] = useState(false);
  const [panelAltsError, setPanelAltsError] = useState<string | null>(null);
  const [panelAltQtyMap, setPanelAltQtyMap] = useState<Record<number, string>>({});
  const [panelAltSaveMsg, setPanelAltSaveMsg] = useState<Record<number, string>>({});

  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  type AuditLogRow = { id: number; created_at: string; generic_item_number: string; action: string; old_quantity: number | null; new_quantity: number | null; source: string };
  const [auditModalOpen, setAuditModalOpen] = useState(false);
  const [auditLogs, setAuditLogs] = useState<AuditLogRow[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);

  const [backupMsg, setBackupMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const [alternativesMode, setAlternativesMode] = useState<AltMode>("wide");
  const [altsMinScoreOverride, setAltsMinScoreOverride] = useState<number | null>(null);
  const [panelAltsMinScoreOverride, setPanelAltsMinScoreOverride] = useState<number | null>(null);

  useEffect(() => { try { window.localStorage.setItem(ALT_MODE_STORAGE_KEY, alternativesMode); } catch { /* ignore */ } }, [alternativesMode]);
  useEffect(() => () => { if (savedIndicatorTimeoutRef.current) clearTimeout(savedIndicatorTimeoutRef.current); }, []);

  useEffect(() => {
    if (!deptId || typeof window === "undefined") { setChangedItemIds({}); return; }
    try {
      const raw = window.localStorage.getItem(`${CHANGED_ITEMS_STORAGE_PREFIX}${deptId}`);
      if (!raw) { setChangedItemIds({}); return; }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) { setChangedItemIds({}); return; }
      const next: Record<number, boolean> = {};
      for (const id of parsed) if (typeof id === "number") next[id] = true;
      setChangedItemIds(next);
    } catch { setChangedItemIds({}); }
  }, [deptId]);

  useEffect(() => {
    if (lockedDeptId) return;
    fetch(`${API}/api/departments`).then((r) => r.json()).then((d: Dept[]) => setDepartments(d)).catch(() => { });
  }, [lockedDeptId]);

  useEffect(() => {
    if (!deptId) { setClinicalMeta(null); return; }
    fetch(`${API}/api/max-limits/department/clinical-meta?department_id=${deptId}`)
      .then((r) => r.json()).then((m: ClinicalMeta) => setClinicalMeta(m)).catch(() => { });
  }, [deptId]);

  const buildParams = useCallback((dept: number, offset: number, q: string, sort: string, filter: string, clinical: Record<string, string>) => {
    const p = new URLSearchParams({ department_id: String(dept), limit: String(PAGE_SIZE), offset: String(offset) });
    if (q.trim()) p.set("q", q.trim());
    if (sort !== "code") p.set("sort_by", sort);
    if (filter !== "all") p.set("qty_filter", filter);
    for (const [k, v] of Object.entries(clinical)) { if (v) p.set(k, v); }
    return p;
  }, []);

  const loadInitial = useCallback(
    (
      dept: number | null,
      q: string,
      sort: string,
      filter: string,
      clinical: Record<string, string>,
      preserveRows = false,
    ) => {
      if (!dept) {
        setRows([]);
        setTotal(0);
        setHasMore(false);
        rowsLengthRef.current = 0;
        return;
      }

      setTableLoading(true);
      if (!preserveRows) {
        setRows([]);
        setHasMore(true);
        rowsLengthRef.current = 0;
      }
      isFetchingMoreRef.current = false;

      fetch(`${API}/api/max-limits/department?${buildParams(dept, 0, q, sort, filter, clinical)}`)
        .then(async (r) => {
          const count = Number(r.headers.get("X-Total-Count") || "0");
          const d: LimitRow[] = await r.json();
          setTotal(count);
          setRows(d);
          setHasMore(d.length < count);
          rowsLengthRef.current = d.length;
        })
        .catch(() => {
          if (!preserveRows) {
            setRows([]);
            setTotal(0);
            setHasMore(false);
            rowsLengthRef.current = 0;
          }
        })
        .finally(() => setTableLoading(false));
    },
    [buildParams],
  );

  const loadMore = useCallback(() => {
    if (isFetchingMoreRef.current || !deptId || tableLoading || tableLoadingMore || !hasMore) return;
    const offset = rowsLengthRef.current; isFetchingMoreRef.current = true; setTableLoadingMore(true);
    fetch(`${API}/api/max-limits/department?${buildParams(deptId, offset, search, sortBy, qtyFilter, clinicalFilters)}`)
      .then(async (r) => { const count = Number(r.headers.get("X-Total-Count") || "0"); const d: LimitRow[] = await r.json(); setTotal(count); setRows((prev) => [...prev, ...d]); setHasMore(offset + d.length < count); rowsLengthRef.current = offset + d.length; })
      .catch(() => { }).finally(() => { setTableLoadingMore(false); isFetchingMoreRef.current = false; });
  }, [deptId, search, sortBy, qtyFilter, clinicalFilters, hasMore, tableLoading, tableLoadingMore, buildParams]);

  useEffect(() => { loadInitial(deptId, search, sortBy, qtyFilter, clinicalFilters); }, [deptId, search, sortBy, qtyFilter, clinicalFilters, loadInitial]);

  const onSearchChange = (val: string) => { if (searchTimer.current) clearTimeout(searchTimer.current); searchTimer.current = setTimeout(() => setSearch(val), 300); };
  const refreshTable = useCallback(() => {
    if (!deptId) return;
    loadInitial(deptId, search, sortBy, qtyFilter, clinicalFilters, true);
  }, [deptId, search, sortBy, qtyFilter, clinicalFilters, loadInitial]);

  const markItemAsChanged = useCallback((itemId: number) => {
    if (!deptId || typeof window === "undefined") return;
    setChangedItemIds((prev) => {
      if (prev[itemId]) return prev;
      const next = { ...prev, [itemId]: true };
      try {
        window.localStorage.setItem(`${CHANGED_ITEMS_STORAGE_PREFIX}${deptId}`, JSON.stringify(Object.keys(next).map(Number)));
      } catch { /* ignore */ }
      return next;
    });
  }, [deptId]);

  const handleImportFile = useCallback(async (file: File, confirmImport = false) => {
    if (!deptId) return; setImportLoading(true); if (!confirmImport) setImportResult(null);
    const form = new FormData(); form.append("file", file); const dryRun = !confirmImport;
    try {
      const res = await fetch(`${API}/api/import/department-max-limits?department_id=${deptId}&effective_year=2025&dry_run=${dryRun}`, { method: "POST", body: form });
      if (!res.ok) throw new Error(await readApiError(res, "تعذر تنفيذ الاستيراد"));
      const data = await res.json().catch(() => null) as ImportResult | null;
      if (!data || typeof data !== "object") throw new Error("استجابة غير صالحة من الخادم");
      setImportResult(data);
      if (dryRun && data.preview_rows && data.preview_rows.length > 0) { setPendingImportFile(file); } else { setPendingImportFile(null); if (!data.dry_run && (data.upserted > 0 || data.deleted > 0)) refreshTable(); }
    } catch (e) { setImportResult({ department_id: deptId, effective_year: 2025, dry_run: false, rows_read: 0, upserted: 0, deleted: 0, missing_items: 0, invalid_values: 0, prefix_matched: 0, ambiguous_codes: 0, errors_sample: [formatApiError(e, "تعذر تنفيذ الاستيراد")] }); setPendingImportFile(null); }
    finally { setImportLoading(false); if (!confirmImport && fileInputRef.current) fileInputRef.current.value = ""; }
  }, [deptId, refreshTable]);

  const handleConfirmImport = useCallback(() => { if (!pendingImportFile || !deptId) return; handleImportFile(pendingImportFile, true); }, [pendingImportFile, deptId, handleImportFile]);

  const openAuditModal = useCallback(() => {
    setAuditModalOpen(true); setAuditLogs([]); if (!deptId) return; setAuditLoading(true);
    fetch(`${API}/api/audit/max-limits?department_id=${deptId}&limit=50`).then((r) => r.json()).then((data: AuditLogRow[]) => setAuditLogs(Array.isArray(data) ? data : [])).catch(() => setAuditLogs([])).finally(() => setAuditLoading(false));
  }, [deptId]);

  const handleBackupDb = useCallback(async () => {
    setBackupMsg(null);
    try {
      const res = await fetch(`${API}/api/admin/db-backup`);
      if (!res.ok) { const err = await res.json().catch(() => ({ detail: res.statusText })); setBackupMsg({ type: "err", text: ((err as { detail?: string }).detail || "فشل إنشاء النسخة الاحتياطية") }); return; }
      const blob = await res.blob(); const disp = res.headers.get("Content-Disposition"); const match = disp?.match(/filename="?([^";]+)"?/); const name = match?.[1] || "nupco_limit_backup.sql";
      const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url); setBackupMsg({ type: "ok", text: "تم تنزيل النسخة الاحتياطية" });
    } catch (e) { setBackupMsg({ type: "err", text: String(e) }); }
    setTimeout(() => setBackupMsg(null), 4000);
  }, []);

  const fetchAltsWithLimits = useCallback(async (itemId: number, departmentId: number, setList: (v: AltWithLimit[]) => void, setLoading: (v: boolean) => void, setError: (v: string | null) => void, setQtyMap: (v: Record<number, string>) => void, setRecommendedMinScore: (v: number | null) => void, setMinScoreOverride: (v: number | null) => void) => {
    setList([]); setError(null); setRecommendedMinScore(null); setMinScoreOverride(null); setLoading(true);
    try {
      const config = ALT_MODE_CONFIG[alternativesMode]; const params = new URLSearchParams({ auto_generate: "true", top_k: String(config.top_k) });
      if (config.min_score_override != null) { params.set("min_score", String(config.min_score_override)); setMinScoreOverride(config.min_score_override); }
      const altRes = await fetch(`${API}/api/items/${itemId}/alternatives?${params}`);
      if (!altRes.ok) throw new Error(altRes.status === 404 ? "غير متوفر" : `خطأ ${altRes.status}`);
      const altData = await altRes.json(); const rawAlts: AlternativeRow[] = Array.isArray(altData) ? altData : altData.alternatives ?? [];
      const rec = typeof altData?.recommended_min_score === "number" ? altData.recommended_min_score : null; setRecommendedMinScore(rec);
      if (rawAlts.length === 0) { setList([]); setLoading(false); return; }
      const lookupRes = await fetch(`${API}/api/max-limits/department/batch-lookup`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ department_id: departmentId, item_ids: rawAlts.map((a) => a.id), effective_year: 2025 }) });
      const lookupData: { item_id: number; max_quantity: number; facility_total_quantity: number }[] = lookupRes.ok ? await lookupRes.json() : [];
      const limitMap = new Map(lookupData.map((r) => [r.item_id, r]));
      const enriched: AltWithLimit[] = rawAlts.map((alt) => { const ex = limitMap.get(alt.id); return { ...alt, current_qty: ex ? ex.max_quantity : null, facility_total: ex ? ex.facility_total_quantity : 0 }; });
      setList(enriched); const qm: Record<number, string> = {}; for (const e of enriched) qm[e.id] = e.current_qty !== null ? String(e.current_qty) : ""; setQtyMap(qm);
    } catch (err: unknown) { setList([]); setError(err instanceof Error ? err.message : "تعذر تحميل البدائل"); } finally { setLoading(false); }
  }, [alternativesMode]);

  const toggleRow = (row: LimitRow) => {
    if (expandedId === row.item_id) { setExpandedId(null); setAltsEnriched([]); return; }
    setExpandedId(row.item_id); setInlineQty(String(row.department_max_quantity)); setInlineSaveMsg(""); setAltSaveMsg({});
    if (deptId) fetchAltsWithLimits(row.item_id, deptId, setAltsEnriched, setAltsLoading, setAltsError, setAltQtyMap, setAltsRecommendedMinScore, setAltsMinScoreOverride);
  };

  const handleInlineSave = async (itemId: number) => {
    if (!deptId) return; const qty = Number(inlineQty); if (isNaN(qty) || qty < 0) return; setInlineSaveMsg("");
    try { const res = await fetch(`${API}/api/max-limits/department/upsert`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ department_id: deptId, item_id: itemId, max_quantity: qty, effective_year: 2025 }) }); const data: UpsertRes = await res.json(); setInlineSaveMsg(`تم الحفظ. إجمالي المنشأة: ${data.facility_total_quantity}`); markItemAsChanged(itemId); refreshTable(); } catch { setInlineSaveMsg("تعذر الحفظ."); }
  };

  const handleQuickSave = useCallback(async (row: LimitRow) => {
    if (!deptId) return; const raw = editedQtyByItemId[row.item_id] ?? String(row.department_max_quantity); const qty = Number(raw); if (raw === "" || isNaN(qty) || qty < 0) return; setQuickSavingItemId(row.item_id);
    try {
      const res = await fetch(`${API}/api/max-limits/department/upsert`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ department_id: deptId, item_id: row.item_id, max_quantity: qty, effective_year: 2025 }) }); const data: UpsertRes = await res.json();
      markItemAsChanged(row.item_id);
      if (data.department_max_quantity === 0) { refreshTable(); } else { setRows((prev) => prev.map((r) => r.item_id === row.item_id ? { ...r, department_max_quantity: data.department_max_quantity, facility_total_quantity: data.facility_total_quantity } : r)); }
      setEditedQtyByItemId((prev) => { const next = { ...prev }; delete next[row.item_id]; return next; }); setQuickSavedItemId(row.item_id);
      if (savedIndicatorTimeoutRef.current) clearTimeout(savedIndicatorTimeoutRef.current); savedIndicatorTimeoutRef.current = setTimeout(() => { setQuickSavedItemId(null); savedIndicatorTimeoutRef.current = null; }, 1500);
    } catch { /* could add per-row error */ } finally { setQuickSavingItemId(null); }
  }, [deptId, editedQtyByItemId, markItemAsChanged, refreshTable]);

  const adjustEditedQty = useCallback((itemId: number, baseQty: number, delta: number) => {
    setEditedQtyByItemId((prev) => {
      const raw = prev[itemId] ?? String(baseQty);
      const parsed = Number(raw);
      const current = Number.isFinite(parsed) ? parsed : 0;
      const next = Math.max(0, current + delta);
      return { ...prev, [itemId]: String(next) };
    });
  }, []);

  const handleInlineAltSave = async (alt: AltWithLimit) => {
    if (!deptId) return; const raw = altQtyMap[alt.id] ?? ""; const qty = Number(raw); if (raw === "" || isNaN(qty) || qty < 0) return; setAltSaveMsg((prev) => ({ ...prev, [alt.id]: "" }));
    try { const res = await fetch(`${API}/api/max-limits/department/upsert`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ department_id: deptId, item_id: alt.id, max_quantity: qty, effective_year: 2025 }) }); const data: UpsertRes = await res.json(); setAltSaveMsg((prev) => ({ ...prev, [alt.id]: `تم الحفظ. الإجمالي: ${data.facility_total_quantity}` })); setAltsEnriched((prev) => prev.map((a) => (a.id === alt.id ? { ...a, current_qty: qty, facility_total: data.facility_total_quantity } : a))); markItemAsChanged(alt.id); refreshTable(); } catch { setAltSaveMsg((prev) => ({ ...prev, [alt.id]: "خطأ" })); }
  };

  const onItemQueryChange = (val: string) => {
    setItemQuery(val); setSelectedItem(null); if (itemTimer.current) clearTimeout(itemTimer.current);
    if (val.trim().length < 1) { setItemHits([]); setShowDropdown(false); return; }
    itemTimer.current = setTimeout(() => { fetch(`${API}/api/items/search?q=${encodeURIComponent(val.trim())}&limit=10`).then((r) => r.json()).then((d: ItemHit[]) => { setItemHits(d); setShowDropdown(d.length > 0); }).catch(() => { }); }, 300);
  };

  const pickItem = (it: ItemHit) => {
    setSelectedItem(it); setItemQuery(`${it.generic_item_number} — ${it.generic_description || ""}`); setShowDropdown(false); setItemHits([]); setPanelAltSaveMsg({});
    if (deptId) fetchAltsWithLimits(it.id, deptId, setPanelAlts, setPanelAltsLoading, setPanelAltsError, setPanelAltQtyMap, setPanelAltsRecommendedMinScore, setPanelAltsMinScoreOverride);
  };

  const handlePanelSave = async () => {
    if (!deptId || !selectedItem) return; const qty = Number(maxQty); if (isNaN(qty) || qty < 0) return; setSaveMsg("");
    try { const res = await fetch(`${API}/api/max-limits/department/upsert`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ department_id: deptId, item_id: selectedItem.id, max_quantity: qty, effective_year: 2025 }) }); const data: UpsertRes = await res.json(); setSaveMsg(`تم الحفظ. حد القسم: ${data.department_max_quantity}، إجمالي المنشأة: ${data.facility_total_quantity}`); setMaxQty(""); setItemQuery(""); setSelectedItem(null); setPanelAlts([]); markItemAsChanged(data.item_id); refreshTable(); } catch { setSaveMsg("تعذر الحفظ."); }
  };

  const handlePanelAltSave = async (alt: AltWithLimit) => {
    if (!deptId) return; const raw = panelAltQtyMap[alt.id] ?? ""; const qty = Number(raw); if (raw === "" || isNaN(qty) || qty < 0) return; setPanelAltSaveMsg((prev) => ({ ...prev, [alt.id]: "" }));
    try { const res = await fetch(`${API}/api/max-limits/department/upsert`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ department_id: deptId, item_id: alt.id, max_quantity: qty, effective_year: 2025 }) }); const data: UpsertRes = await res.json(); setPanelAltSaveMsg((prev) => ({ ...prev, [alt.id]: `تم الحفظ. الإجمالي: ${data.facility_total_quantity}` })); setPanelAlts((prev) => prev.map((a) => (a.id === alt.id ? { ...a, current_qty: qty, facility_total: data.facility_total_quantity } : a))); markItemAsChanged(alt.id); refreshTable(); } catch { setPanelAltSaveMsg((prev) => ({ ...prev, [alt.id]: "خطأ" })); }
  };

  useEffect(() => { const handler = (e: MouseEvent) => { if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setShowDropdown(false); }; document.addEventListener("mousedown", handler); return () => document.removeEventListener("mousedown", handler); }, []);

  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current; if (!sentinel || !deptId || !hasMore || tableLoading || tableLoadingMore) return;
    const observer = new IntersectionObserver((entries) => { if (entries[0]?.isIntersecting) loadMore(); }, { rootMargin: "100px", threshold: 0 });
    observer.observe(sentinel); return () => observer.disconnect();
  }, [deptId, hasMore, tableLoading, tableLoadingMore, loadMore]);

  return (
    <main className="relative min-h-screen bg-slate-50">

      {/* ═══ DARK HEADER BANNER ═══ */}
      <div className="bg-gradient-to-br from-slate-900 via-blue-950 to-indigo-950 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute -top-20 -right-20 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl" />
          <div className="absolute bottom-0 left-10 w-48 h-48 bg-teal-500/10 rounded-full blur-3xl" />
        </div>
        <div className="relative mx-auto max-w-7xl px-4 py-5 sm:px-6">
          {headerSlot ? (
            <div>{headerSlot}</div>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-blue-500 to-teal-400 flex items-center justify-center shadow-xl shadow-blue-500/30 flex-shrink-0">
                  <LayoutGrid size={22} className="text-white" />
                </div>
                <div>
                  <h1 className="text-xl font-bold text-white">إدارة الحدود القصوى للأقسام</h1>
                  <p className="text-blue-300/60 text-xs mt-0.5">إدارة الحدود والاستيراد وسجل التدقيق من شاشة واحدة.</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {backupMsg && <span className={`text-sm font-medium ${backupMsg.type === "ok" ? "text-emerald-400" : "text-rose-400"}`}>{backupMsg.text}</span>}
                <button type="button" className="flex items-center gap-1.5 rounded-lg border border-amber-400/60 bg-amber-500/10 px-3 py-1.5 text-sm text-amber-300 hover:bg-amber-500/20 transition-colors cursor-pointer" onClick={handleBackupDb}>
                  <Database size={14} /> نسخة احتياطية
                </button>
                <button type="button" className="flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/8 px-3 py-1.5 text-sm text-blue-200 hover:bg-white/15 transition-colors cursor-pointer" onClick={openAuditModal}>
                  <History size={14} /> سجل التدقيق
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ═══ MAIN CONTENT ═══ */}
      <div className="mx-auto max-w-7xl px-3 py-4 sm:px-4 sm:py-6 lg:px-6">

        {/* Controls card */}
        <div className="mb-4 rounded-2xl bg-white border border-gray-100 shadow-sm p-4">

          {/* Row 1: department + actions */}
          <div className="mb-3 flex flex-wrap gap-2.5 items-center pb-3 border-b border-gray-100">
            {!lockedDeptId && (
              <div className="relative w-full sm:w-auto">
                <select className="w-full sm:min-w-[240px] appearance-none rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 pr-8 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-400/40 focus:border-blue-300 cursor-pointer" value={deptId ?? ""} onChange={(e) => { setDeptId(e.target.value ? Number(e.target.value) : null); setExpandedId(null); }}>
                  <option value="">-- اختر القسم --</option>
                  {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
                <ChevronDown size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              </div>
            )}
            {!lockedDeptId && (
              <>
                <a href={deptId ? `${API}/api/export/department-max-limits?department_id=${deptId}&effective_year=2025${search.trim() ? `&q=${encodeURIComponent(search.trim())}` : ""}` : "#"} download className={`flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-sm font-medium transition-all cursor-pointer ${deptId ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100" : "cursor-not-allowed border-gray-200 bg-gray-50 text-gray-400"}`} onClick={(e) => !deptId && e.preventDefault()}>
                  <FileDown size={15} /> تصدير Excel
                </a>
                <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImportFile(f); }} />
                <button type="button" disabled={!deptId || importLoading} className={`flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-sm font-medium transition-all cursor-pointer ${deptId && !importLoading ? "border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100" : "cursor-not-allowed border-gray-200 bg-gray-50 text-gray-400"}`} onClick={() => fileInputRef.current?.click()}>
                  <FileUp size={15} /> {importLoading ? "جارٍ الاستيراد…" : "استيراد Excel"}
                </button>
                {deptId && (
                  <AiReportPanel
                    deptId={deptId}
                    deptName={departments.find((d) => d.id === deptId)?.name ?? ""}
                    effectiveYear={2025}
                  />
                )}
              </>
            )}
            {/* <div className="ms-auto flex items-center gap-2 text-sm text-gray-600">
              <span className="text-xs text-gray-500 whitespace-nowrap">وضع البدائل:</span>
              <select className="rounded-xl border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-400/40 cursor-pointer" value={alternativesMode} onChange={(e) => setAlternativesMode(e.target.value as AltMode)} title="صارم = بدائل أقل/تشابه أعلى، متوازن = موصى به، واسع = بدائل أكثر/تشابه أقل">
                <option value="strict">صارم</option><option value="balanced">متوازن</option><option value="wide">واسع</option>
              </select>
            </div> */}
          </div>

          {/* Row 2: search + sort + quick filters */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[180px]">
              <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input type="text" placeholder="بحث بالكود أو الوصف…" className="w-full rounded-xl border border-gray-200 bg-gray-50 pr-9 pl-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/40 focus:border-blue-300" onChange={(e) => onSearchChange(e.target.value)} />
            </div>
            <label className="flex items-center gap-1 whitespace-nowrap text-xs text-gray-500">
              ترتيب:
              <select className="rounded-xl border border-gray-200 bg-gray-50 px-2.5 py-2 text-sm text-gray-700 focus:outline-none cursor-pointer" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                <option value="code">الكود ↑</option><option value="dept_max_asc">الحد ↑</option><option value="dept_max_desc">الحد ↓</option><option value="facility_total_desc">اجمالي الحد الاعلى للمستشفى ↓</option><option value="updated_desc">آخر تعديل ↓</option>
              </select>
            </label>
            {Object.entries(clinicalFilters).filter(([, v]) => v).map(([k, v]) => (
              <button key={k} onClick={() => setClinicalFilters((p) => ({ ...p, [k]: "" }))}
                className="flex items-center gap-1 rounded-lg bg-indigo-100 px-2 py-1 text-xs text-indigo-700 hover:bg-indigo-200 cursor-pointer">
                {CLINICAL_LABELS[k] ?? k}: {v} <span className="font-bold">×</span>
              </button>
            ))}
          </div>
        </div>

        {/* Clinical filters */}
        {clinicalMeta && deptId && (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl bg-indigo-50 border border-indigo-100 px-4 py-3">
            <span className="text-xs font-medium text-indigo-600">فلاتر سريرية:</span>
            {(Object.entries(CLINICAL_LABELS) as [string, string][]).map(([field, label]) => {
              const opts = clinicalMeta[field as keyof ClinicalMeta] ?? [];
              if (opts.length === 0) return null;
              return (
                <label key={field} className="flex items-center gap-1 text-xs text-indigo-700">
                  <span className="whitespace-nowrap">{label}:</span>
                  <select
                    className={`rounded-lg border px-2 py-1.5 text-xs cursor-pointer ${clinicalFilters[field] ? "border-indigo-400 bg-indigo-100 font-medium" : "border-indigo-200 bg-white"}`}
                    value={clinicalFilters[field] ?? ""}
                    onChange={(e) => setClinicalFilters((p) => ({ ...p, [field]: e.target.value }))}
                  >
                    <option value="">الكل</option>
                    {opts.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </label>
              );
            })}
            {Object.values(clinicalFilters).some(Boolean) && (
              <button onClick={() => setClinicalFilters({})} className="rounded-lg border border-indigo-300 bg-white px-2.5 py-1 text-xs text-indigo-600 hover:bg-indigo-50 cursor-pointer">مسح الكل</button>
            )}
          </div>
        )}

        {/* Mobile cards */}
        <div className="mb-4 sm:hidden">
          <p className="mb-2 px-1 text-xs font-medium text-gray-500">إدخال سريع مناسب للجوال</p>
          {tableLoading && rows.length === 0 && <div className="rounded-2xl border border-gray-100 bg-white px-3 py-8 text-center text-gray-400">جارٍ التحميل…</div>}
          {!tableLoading && rows.length === 0 && <div className="rounded-2xl border border-gray-100 bg-white px-3 py-8 text-center text-gray-400">{deptId ? "لا توجد بنود" : "اختر قسمًا"}</div>}
          <div className="space-y-2">
            {rows.map((r) => (
              <MobileLimitCard key={r.item_id} row={r} editedQty={editedQtyByItemId[r.item_id] ?? String(r.department_max_quantity)} onEditedQtyChange={(v: string) => setEditedQtyByItemId((prev) => ({ ...prev, [r.item_id]: v }))} onStepDown={() => adjustEditedQty(r.item_id, r.department_max_quantity, -1)} onStepUp={() => adjustEditedQty(r.item_id, r.department_max_quantity, 1)} onSave={() => handleQuickSave(r)} quickSaving={quickSavingItemId === r.item_id} quickSaved={quickSavedItemId === r.item_id} isChanged={Boolean(changedItemIds[r.item_id]) || r.source === "manual"} isExpanded={expandedId === r.item_id} onToggleAlternatives={() => toggleRow(r)} alts={altsEnriched} altsMinScoreOverride={altsMinScoreOverride} altsRecommendedMinScore={altsRecommendedMinScore} altsLoading={altsLoading} altsError={altsError} altQtyMap={altQtyMap} setAltQtyMap={setAltQtyMap} altSaveMsg={altSaveMsg} onAltSave={handleInlineAltSave} />
            ))}
          </div>
        </div>

        {/* Desktop table */}
        <div className="mb-4 hidden overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm sm:block">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="bg-gradient-to-r from-blue-700 to-indigo-700 text-white">
                  <th className="px-4 py-3 text-right font-medium text-sm">الكود</th>
                  <th className="px-4 py-3 text-right font-medium text-sm">الوصف</th>
                  <th className="px-4 py-3 text-right font-medium text-sm">حد القسم</th>
                  <th className="px-4 py-3 text-right font-medium text-sm">اجمالي الحد الاعلى للمستشفى</th>
                  <th className="px-4 py-3 text-right font-medium text-sm">آخر تحديث</th>
                </tr>
              </thead>
              <tbody>
                {tableLoading && rows.length === 0 && <tr><td colSpan={5} className="py-12 text-center text-gray-400"><RefreshCw size={20} className="mx-auto mb-2 animate-spin opacity-40" />جارٍ التحميل…</td></tr>}
                {!tableLoading && rows.length === 0 && <tr><td colSpan={5} className="py-12 text-center text-gray-400">{deptId ? "لا توجد بنود" : "اختر قسمًا لعرض البنود"}</td></tr>}
                {rows.map((r) => (
                  <ExpandableRow key={r.item_id} row={r} isChanged={Boolean(changedItemIds[r.item_id]) || r.source === "manual"} isExpanded={expandedId === r.item_id} onToggle={() => toggleRow(r)} inlineQty={inlineQty} setInlineQty={setInlineQty} onSave={() => handleInlineSave(r.item_id)} saveMsg={inlineSaveMsg} alts={altsEnriched} altsMinScoreOverride={altsMinScoreOverride} altsRecommendedMinScore={altsRecommendedMinScore} altsLoading={altsLoading} altsError={altsError} altQtyMap={altQtyMap} setAltQtyMap={setAltQtyMap} altSaveMsg={altSaveMsg} onAltSave={handleInlineAltSave} editedQty={editedQtyByItemId[r.item_id] ?? String(r.department_max_quantity)} onEditedQtyChange={(v) => setEditedQtyByItemId((prev) => ({ ...prev, [r.item_id]: v }))} onQuickSave={() => handleQuickSave(r)} quickSaving={quickSavingItemId === r.item_id} quickSaved={quickSavedItemId === r.item_id} />
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Pagination bar */}
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-sm text-gray-500 font-medium">{rows.length} <span className="text-gray-400">من</span> {total} بند</span>
          {hasMore && deptId && <button onClick={loadMore} disabled={tableLoading || tableLoadingMore} className="flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-5 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40 cursor-pointer shadow-sm transition-colors sm:w-auto">{tableLoadingMore ? <><RefreshCw size={14} className="animate-spin" />جارٍ التحميل…</> : "تحميل المزيد"}</button>}
        </div>
        <div ref={loadMoreSentinelRef} className="h-4" aria-hidden />

        {/* Add item panel */}
        <div className="rounded-2xl bg-white border border-gray-100 shadow-sm overflow-hidden">
          <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-3 flex items-center gap-2">
            <Plus size={18} className="text-white" />
            <h2 className="text-sm font-semibold text-white">إضافة حد أعلى لبند جديد</h2>
          </div>
          <div className="p-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="relative w-full flex-1 sm:min-w-[260px]" ref={dropdownRef}>
                <label className="mb-1 block text-xs text-gray-500">ابحث عن بند (كود أو وصف)</label>
                <input type="text" value={itemQuery} onChange={(e) => onItemQueryChange(e.target.value)} onFocus={() => itemHits.length > 0 && setShowDropdown(true)} placeholder="مثال: 401616 أو HYDROGEN" className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/40 focus:border-blue-300" />
                {showDropdown && <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-gray-100 bg-white text-sm shadow-xl">{itemHits.map((it) => <li key={it.id} onClick={() => pickItem(it)} className="cursor-pointer px-3 py-2.5 hover:bg-blue-50 border-b border-gray-50 last:border-0"><span className="font-mono text-xs text-blue-700 font-medium">{it.generic_item_number}</span><span className="text-gray-500 text-xs me-2">{it.generic_description || ""}</span></li>)}</ul>}
              </div>
              <div className="w-full sm:w-32">
                <label className="mb-1 block text-xs text-gray-500">الحد الأعلى</label>
                <input type="number" min={0} inputMode="numeric" pattern="[0-9]*" value={maxQty} onChange={(e) => setMaxQty(e.target.value)} className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/40" />
              </div>
              <button type="button" onClick={handlePanelSave} disabled={!deptId || !selectedItem || maxQty === ""} className="rounded-xl bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40 cursor-pointer transition-colors shadow-sm">حفظ</button>
            </div>
            {saveMsg && <p className="mt-3 text-sm text-emerald-700 font-medium bg-emerald-50 rounded-lg px-3 py-2">{saveMsg}</p>}
            {selectedItem && (
              <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50/60 p-3">
                <p className="mb-2 text-xs font-semibold text-blue-800">البدائل المقترحة</p>
                {(panelAltsMinScoreOverride ?? panelAltsRecommendedMinScore) != null && panelAlts.length > 0 && <p className="mb-1 text-xs text-blue-600/70">يتم عرض البدائل بنسبة تشابه لا تقل عن {panelAltsMinScoreOverride ?? panelAltsRecommendedMinScore}</p>}
                {panelAltsLoading && <p className="text-xs text-gray-400">جارٍ التحميل…</p>}
                {panelAltsError && <p className="text-xs text-amber-600">{panelAltsError}</p>}
                {!panelAltsLoading && !panelAltsError && panelAlts.length === 0 && <p className="text-xs text-gray-400">لا توجد بدائل متاحة.</p>}
                {panelAlts.length > 0 && <AltTable alts={panelAlts} qtyMap={panelAltQtyMap} setQtyMap={setPanelAltQtyMap} saveMsgMap={panelAltSaveMsg} onSave={handlePanelAltSave} />}
              </div>
            )}
          </div>
        </div>
      </div>

      {importResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => { setImportResult(null); setPendingImportFile(null); }}>
          <div className={`mx-3 rounded-2xl shadow-2xl bg-white p-3 text-sm sm:mx-4 sm:p-4 ${importResult.preview_rows?.length ? "max-h-[90vh] w-full max-w-2xl flex flex-col" : "w-full max-w-md"}`} onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-gray-800 mb-3">{importResult.preview_rows?.length ? "معاينة الاستيراد" : "نتيجة الاستيراد"}</h3>
            <ul className="space-y-1 text-gray-600 mb-3 flex-shrink-0">
              <li>الصفوف المقروءة: {importResult.rows_read}</li><li>البنود المضافة/المحدثة: {importResult.upserted}</li><li>البنود المحذوفة: {importResult.deleted}</li><li>بنود مفقودة: {importResult.missing_items}</li><li>قيم غير صالحة: {importResult.invalid_values}</li>
              {typeof importResult.prefix_matched === "number" && <li>تطابق البادئة: {importResult.prefix_matched}</li>}
              {typeof importResult.ambiguous_codes === "number" && importResult.ambiguous_codes > 0 && <li>أكواد ملتبسة: {importResult.ambiguous_codes}</li>}
              {importResult.dry_run && importResult.preview_rows?.length && <li className="text-amber-600">لم تُحفظ التغييرات بعد — اضغط تأكيد للتطبيق</li>}
              {importResult.dry_run && !importResult.preview_rows?.length && <li className="text-amber-600">معاينة فقط (لا تغييرات محفوظة)</li>}
            </ul>
            {importResult.preview_rows && importResult.preview_rows.length > 0 && (
              <div className="mb-3 flex-1 min-h-0 rounded border border-gray-200">
                <p className="border-b border-gray-100 px-2 py-1 text-[11px] text-gray-500 sm:hidden">اسحب أفقيا لعرض كل الأعمدة</p>
                <div className="overflow-auto" style={{ maxHeight: "40vh" }}>
                  <table className="w-full min-w-[560px] text-xs"><thead className="bg-gray-100 sticky top-0"><tr><th className="px-2 py-1.5 text-right">الكود</th><th className="px-2 py-1.5 text-right">القديم</th><th className="px-2 py-1.5 text-right">الجديد</th><th className="px-2 py-1.5 text-right">العملية</th></tr></thead>
                    <tbody>{importResult.preview_rows.map((pr, i) => <tr key={i} className="border-t border-gray-100"><td className="px-2 py-1 font-mono">{pr.generic_item_number}</td><td className="px-2 py-1 text-right">{pr.old_quantity ?? "—"}</td><td className="px-2 py-1 text-right">{pr.new_quantity}</td><td className="px-2 py-1 text-right"><span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${pr.action === "insert" ? "bg-emerald-100 text-emerald-700" : pr.action === "update" ? "bg-blue-100 text-blue-700" : pr.action === "delete" ? "bg-red-100 text-red-700" : pr.action === "missing" ? "bg-gray-100 text-gray-600" : "bg-slate-100 text-slate-600"}`}>{pr.action}</span></td></tr>)}</tbody></table>
                </div>
              </div>
            )}
            {importResult.errors_sample.length > 0 && (
              <div className="mb-3 flex-shrink-0"><p className="font-medium text-gray-700 mb-1">عينة الأخطاء:</p><ul className="list-disc list-inside text-gray-600 max-h-24 overflow-y-auto">{importResult.errors_sample.map((err, i) => <li key={i}>{err}</li>)}</ul><a href={`data:text/csv;charset=utf-8,${encodeURIComponent("error\n" + importResult.errors_sample.join("\n"))}`} download="import_errors.csv" className="text-blue-600 hover:underline mt-1 inline-block">تنزيل الأخطاء CSV</a></div>
            )}
            <div className="flex flex-shrink-0 flex-wrap gap-2">{importResult.preview_rows?.length ? (<><button type="button" className="px-4 py-2 bg-gray-200 rounded-lg hover:bg-gray-300 cursor-pointer" onClick={() => { setImportResult(null); setPendingImportFile(null); }}>إلغاء</button><button type="button" className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 cursor-pointer" disabled={importLoading} onClick={handleConfirmImport}>تأكيد الاستيراد</button></>) : (<button type="button" className="px-4 py-2 bg-gray-200 rounded-lg hover:bg-gray-300 cursor-pointer" onClick={() => { setImportResult(null); setPendingImportFile(null); }}>إغلاق</button>)}</div>
          </div>
        </div>
      )}

      {auditModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setAuditModalOpen(false)}>
          <div className="mx-3 flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl shadow-2xl bg-white p-3 sm:mx-4 sm:p-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-gray-800 mb-3">سجل التدقيق (آخر 50 للقسم)</h3>
            {!deptId && <p className="text-gray-500 text-sm mb-3">اختر قسمًا لعرض سجل التدقيق.</p>}
            {auditLoading && <p className="text-gray-500 text-sm">جارٍ التحميل…</p>}
            {!auditLoading && auditLogs.length === 0 && deptId && <p className="text-gray-500 text-sm">لا توجد إدخالات بعد.</p>}
            {!auditLoading && auditLogs.length > 0 && (
              <div className="flex-1 min-h-0 rounded border border-gray-200 text-xs">
                <p className="border-b border-gray-100 px-2 py-1 text-[11px] text-gray-500 sm:hidden">اسحب أفقيا لعرض كل الأعمدة</p>
                <div className="overflow-auto" style={{ maxHeight: "50vh" }}>
                  <table className="w-full min-w-[700px]"><thead className="bg-gray-100 sticky top-0"><tr><th className="px-2 py-1.5 text-right">الوقت</th><th className="px-2 py-1.5 text-right">الكود</th><th className="px-2 py-1.5 text-right">العملية</th><th className="px-2 py-1.5 text-right">القديم → الجديد</th><th className="px-2 py-1.5 text-right">المصدر</th></tr></thead>
                    <tbody>{auditLogs.map((log) => <tr key={log.id} className="border-t border-gray-100"><td className="px-2 py-1 text-gray-600">{log.created_at ? new Date(log.created_at).toLocaleString() : "—"}</td><td className="px-2 py-1 font-mono">{log.generic_item_number}</td><td className="px-2 py-1"><span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${log.action === "insert" ? "bg-emerald-100 text-emerald-700" : log.action === "update" ? "bg-blue-100 text-blue-700" : log.action === "delete" ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-600"}`}>{log.action}</span></td><td className="px-2 py-1 text-right">{log.old_quantity ?? "—"} → {log.new_quantity ?? "—"}</td><td className="px-2 py-1">{log.source}</td></tr>)}</tbody></table>
                </div>
              </div>
            )}
            <button type="button" className="mt-3 px-4 py-2 bg-gray-200 rounded-lg hover:bg-gray-300 cursor-pointer" onClick={() => setAuditModalOpen(false)}>إغلاق</button>
          </div>
        </div>
      )}
    </main>
  );
}


function MobileLimitCard({ row, editedQty, onEditedQtyChange, onStepDown, onStepUp, onSave, quickSaving, quickSaved, isChanged, isExpanded, onToggleAlternatives, alts, altsMinScoreOverride, altsRecommendedMinScore, altsLoading, altsError, altQtyMap, setAltQtyMap, altSaveMsg, onAltSave }: { row: LimitRow; editedQty: string; onEditedQtyChange: (v: string) => void; onStepDown: () => void; onStepUp: () => void; onSave: () => void | Promise<void>; quickSaving: boolean; quickSaved: boolean; isChanged: boolean; isExpanded: boolean; onToggleAlternatives: () => void; alts: AltWithLimit[]; altsMinScoreOverride: number | null; altsRecommendedMinScore: number | null; altsLoading: boolean; altsError: string | null; altQtyMap: Record<number, string>; setAltQtyMap: React.Dispatch<React.SetStateAction<Record<number, string>>>; altSaveMsg: Record<number, string>; onAltSave: (alt: AltWithLimit) => void }) {
  return (
    <article className={`rounded-2xl border p-3 shadow-sm transition-colors ${isChanged ? "border-emerald-300 bg-emerald-50/70" : "border-slate-200 bg-white"}`}>
      <button type="button" onClick={onToggleAlternatives} className="mb-3 flex w-full items-start justify-between gap-2 text-left">
        <div className="min-w-0">
          <p className="truncate font-mono text-xs text-slate-500">{row.generic_item_number}</p>
          <p className="max-h-10 overflow-hidden text-sm leading-5 text-slate-700">{row.generic_description || "—"}</p>
          <p className={`mt-2 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold transition-all shadow-sm ${isExpanded ? "bg-amber-100 text-amber-800 border border-amber-200" : "bg-gradient-to-r from-amber-400 to-rose-400 text-white shadow-amber-200"}`}>
            ✨ {isExpanded ? "إخفاء البدائل" : "إظهار البدائل والمقارنة"}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          {isChanged && <span className="whitespace-nowrap rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] text-emerald-700">تم التعديل</span>}
          <span className="whitespace-nowrap rounded-full bg-slate-100 px-2 py-1 text-[11px] text-slate-600">اجمالي الحد الاعلى للمستشفى: {row.facility_total_quantity}</span>
        </div>
      </button>

      <div className="grid grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-2">
        <button type="button" onClick={onStepDown} className="h-11 rounded-lg border border-slate-300 bg-slate-50 text-lg font-semibold text-slate-700 active:scale-[0.98] cursor-pointer">-</button>
        <input
          type="number"
          min={0}
          inputMode="numeric"
          pattern="[0-9]*"
          enterKeyHint="done"
          value={editedQty}
          onChange={(e) => onEditedQtyChange(e.target.value)}
          className="h-11 rounded-lg border border-slate-300 px-3 text-center text-base font-semibold"
        />
        <button type="button" onClick={onStepUp} className="h-11 rounded-lg border border-slate-300 bg-slate-50 text-lg font-semibold text-slate-700 active:scale-[0.98] cursor-pointer">+</button>
      </div>

      <button
        type="button"
        onClick={onSave}
        disabled={quickSaving}
        className="mt-2 w-full rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-sky-700 disabled:opacity-50"
      >
        {quickSaving ? "جارٍ الحفظ..." : quickSaved ? "تم الحفظ ✓" : "حفظ الحد الأعلى"}
      </button>

      {isExpanded && (
        <div className="mt-3 rounded-xl border border-amber-200/80 bg-amber-50/60 p-2.5">
          <p className="mb-1 text-xs font-semibold text-slate-700">البدائل المقترحة</p>
          {(altsMinScoreOverride ?? altsRecommendedMinScore) != null && alts.length > 0 && <p className="mb-2 text-[11px] text-slate-500">الحد الأدنى لنسبة التشابه: {altsMinScoreOverride ?? altsRecommendedMinScore}</p>}
          {altsLoading && <p className="text-xs text-slate-500">جارٍ تحميل البدائل...</p>}
          {altsError && <p className="text-xs text-amber-700">{altsError}</p>}
          {!altsLoading && !altsError && alts.length === 0 && <p className="text-xs text-slate-500">لا توجد بدائل متاحة لهذا البند.</p>}
          {alts.length > 0 && <MobileAltList alts={alts} qtyMap={altQtyMap} setQtyMap={setAltQtyMap} saveMsgMap={altSaveMsg} onSave={onAltSave} />}
        </div>
      )}
    </article>
  );
}

function MobileAltList({ alts, qtyMap, setQtyMap, saveMsgMap, onSave }: { alts: AltWithLimit[]; qtyMap: Record<number, string>; setQtyMap: React.Dispatch<React.SetStateAction<Record<number, string>>>; saveMsgMap: Record<number, string>; onSave: (alt: AltWithLimit) => void }) {
  return (
    <div className="space-y-2">
      {alts.map((alt) => (
        <div key={alt.id} className="rounded-lg border-2 border-amber-200 bg-gradient-to-b from-amber-50 to-rose-50 p-2 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[11px] text-slate-700">{alt.generic_item_number}</span>
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">{alt.similarity_score}%</span>
          </div>
          <p className="mt-1 text-xs text-slate-600">{alt.generic_description || "—"}</p>
          <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
            <span>الحد الحالي: {alt.current_qty ?? "—"}</span>
            <span>اجمالي الحد الاعلى للمستشفى: {alt.facility_total || "—"}</span>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <input
              type="number"
              min={0}
              inputMode="numeric"
              pattern="[0-9]*"
              value={qtyMap[alt.id] ?? ""}
              onChange={(e) => setQtyMap((prev) => ({ ...prev, [alt.id]: e.target.value }))}
              placeholder={alt.current_qty !== null ? String(alt.current_qty) : "0"}
              className="h-9 w-full rounded-lg border border-slate-300 px-2 text-sm"
            />
            <button type="button" onClick={() => onSave(alt)} disabled={(qtyMap[alt.id] ?? "") === ""} className="h-9 rounded-lg bg-sky-600 px-3 text-xs font-medium text-white disabled:opacity-50 cursor-pointer">حفظ</button>
          </div>
          {saveMsgMap[alt.id] && <p className={`mt-1 text-[11px] ${saveMsgMap[alt.id]?.startsWith("Error") ? "text-red-600" : "text-emerald-700"}`}>{saveMsgMap[alt.id]}</p>}
        </div>
      ))}
    </div>
  );
}

/* ---------- AltTable ---------- */
function AltTable({ alts, qtyMap, setQtyMap, saveMsgMap, onSave }: { alts: AltWithLimit[]; qtyMap: Record<number, string>; setQtyMap: React.Dispatch<React.SetStateAction<Record<number, string>>>; saveMsgMap: Record<number, string>; onSave: (alt: AltWithLimit) => void }) {
  return (
    <div>
      <p className="mb-1 text-[11px] text-gray-500 sm:hidden">اسحب أفقيا لعرض كل الأعمدة</p>
      <div className="overflow-x-auto rounded-xl border-2 border-amber-300 bg-gradient-to-b from-amber-50 to-rose-50 shadow-inner">
        <table className="w-full min-w-[680px] text-xs">
          <thead className="bg-gradient-to-r from-amber-100 to-rose-100">
            <tr className="text-slate-500">
              <th className="px-3 py-2 text-right font-medium">الكود</th>
              <th className="px-3 py-2 text-right font-medium">الوصف</th>
              <th className="px-3 py-2 text-right font-medium">نسبة التشابه</th>
              <th className="px-3 py-2 text-right font-medium">السبب</th>
              <th className="px-3 py-2 text-right font-medium">الحد الحالي</th>
              <th className="px-3 py-2 text-right font-medium">اجمالي الحد الاعلى للمستشفى</th>
              <th className="px-3 py-2 text-center font-medium w-28">الكمية</th>
              <th className="py-2 w-24"></th>
            </tr>
          </thead>
          <tbody>
            {alts.map((alt, index) => (
              <tr
                key={alt.id}
                className={`border-t border-amber-200 transition-colors ${index % 2 === 0 ? "bg-amber-100/70" : "bg-rose-100/70"} hover:bg-amber-200/60`}
              >
                <td className="px-3 py-2 text-slate-700">
                  <div className="flex items-center gap-2">
                    <span className="font-mono">{alt.generic_item_number}</span>
                    <span className="rounded-full bg-rose-600/10 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700">بديل</span>
                  </div>
                </td>
                <td className="px-3 py-2 text-slate-600 truncate max-w-[180px]" title={alt.generic_description || ""}>{alt.generic_description || "—"}</td>
                <td className="px-3 py-2 text-right">
                  <span className="inline-block px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">{alt.similarity_score}%</span>
                </td>
                <td className="px-3 py-2">
                  {alt.reasons?.length
                    ? <span className="text-rose-600 cursor-help border-b border-dotted border-rose-400" title={alt.reasons.join("\n")}>لماذا؟</span>
                    : <span className="text-gray-300">—</span>}
                </td>
                <td className="px-3 py-2 text-right font-semibold text-slate-700">{alt.current_qty !== null ? alt.current_qty : <span className="text-gray-300">—</span>}</td>
                <td className="px-3 py-2 text-right text-gray-500">{alt.facility_total || "—"}</td>
                <td className="px-3 py-2 text-center">
                  <input type="number" min={0} inputMode="numeric" pattern="[0-9]*" value={qtyMap[alt.id] ?? ""} onClick={(e) => e.stopPropagation()} onChange={(e) => setQtyMap((prev) => ({ ...prev, [alt.id]: e.target.value }))} placeholder={alt.current_qty !== null ? String(alt.current_qty) : "0"} className="w-24 border border-gray-200 rounded-lg px-2 py-1 text-xs text-center focus:ring-2 focus:ring-blue-300 focus:outline-none" />
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    <button type="button" onClick={(e) => { e.stopPropagation(); onSave(alt); }} disabled={(qtyMap[alt.id] ?? "") === ""} className="px-3 py-1 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 disabled:opacity-40 cursor-pointer transition-colors">حفظ</button>
                    {saveMsgMap[alt.id] && <span className={`text-xs ${saveMsgMap[alt.id]?.startsWith("Error") || saveMsgMap[alt.id]?.includes("خطأ") ? "text-red-600" : "text-emerald-700"}`}>{saveMsgMap[alt.id]}</span>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------- ExpandableRow ---------- */
function ExpandableRow({ row, isChanged, isExpanded, onToggle, inlineQty, setInlineQty, onSave, saveMsg, alts, altsMinScoreOverride, altsRecommendedMinScore, altsLoading, altsError, altQtyMap, setAltQtyMap, altSaveMsg, onAltSave, editedQty, onEditedQtyChange, onQuickSave, quickSaving, quickSaved }: { row: LimitRow; isChanged: boolean; isExpanded: boolean; onToggle: () => void; inlineQty: string; setInlineQty: (v: string) => void; onSave: () => void; saveMsg: string; alts: AltWithLimit[]; altsMinScoreOverride: number | null; altsRecommendedMinScore: number | null; altsLoading: boolean; altsError: string | null; altQtyMap: Record<number, string>; setAltQtyMap: React.Dispatch<React.SetStateAction<Record<number, string>>>; altSaveMsg: Record<number, string>; onAltSave: (alt: AltWithLimit) => void; editedQty: string; onEditedQtyChange: (v: string) => void; onQuickSave: () => void; quickSaving: boolean; quickSaved: boolean }) {
  return (
    <>
      <tr onClick={onToggle} className={`border-t cursor-pointer transition-colors ${isChanged ? "border-emerald-200" : "border-gray-100"} ${isExpanded ? (isChanged ? "bg-emerald-100/70" : "bg-blue-50") : (isChanged ? "bg-emerald-50/70 hover:bg-emerald-100/70" : "hover:bg-gray-50")}`}>
        <td className="px-3 py-2 font-mono text-xs">
          <div className="flex flex-col gap-1">
            <span>{row.generic_item_number}</span>
            {isChanged && <span className="w-fit rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-700 font-bold">معدل</span>}
          </div>
        </td>
        <td className="px-3 py-2 text-xs">
          <p className="mb-2 line-clamp-1">{row.generic_description || "—"}</p>
          <button type="button" onClick={(e) => { e.stopPropagation(); onToggle(); }} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1 text-[11px] font-bold transition-all ${isExpanded ? "bg-amber-100 text-amber-800 border border-amber-200 px-4" : "bg-gradient-to-r from-amber-400 to-rose-400 text-white shadow-sm shadow-amber-200 hover:scale-105"}`}>
            ✨ {isExpanded ? "إخفاء البدائل" : "إظهار البدائل الذكية"}
          </button>
        </td>
        <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-end gap-1">
            <input type="number" min={0} inputMode="numeric" pattern="[0-9]*" value={editedQty} onChange={(e) => onEditedQtyChange(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onQuickSave(); } }} className="w-24 border border-gray-300 rounded px-1.5 py-0.5 text-xs text-right" />
            <button type="button" onClick={onQuickSave} disabled={quickSaving} className="px-2 py-0.5 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 disabled:opacity-40 cursor-pointer">{quickSaving ? "…" : "حفظ"}</button>
            {quickSaved && <span className="text-emerald-600 text-xs">✓</span>}
          </div>
        </td>
        <td className="px-3 py-2 text-right text-gray-500">{row.facility_total_quantity}</td><td className="px-3 py-2 text-xs text-gray-400">{new Date(row.updated_at).toLocaleDateString()}</td>
      </tr>
      {isExpanded && (
        <tr><td colSpan={5} className={`px-4 py-3 border-b ${isChanged ? "bg-emerald-50/80 border-emerald-100" : "bg-indigo-50/40 border-indigo-100"}`}>
          <div className="rounded-xl bg-white/70 border border-slate-200 p-3 mb-3">
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <span className="text-xs text-gray-600">تعديل الحد للكود: <strong className="font-mono text-blue-700">{row.generic_item_number}</strong></span>
              <input type="number" min={0} inputMode="numeric" pattern="[0-9]*" value={inlineQty} onChange={(e) => setInlineQty(e.target.value)} onClick={(e) => e.stopPropagation()} className="w-24 border border-gray-300 rounded px-2 py-1 text-sm sm:w-32" />
              <button type="button" onClick={(e) => { e.stopPropagation(); onSave(); }} className="px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 cursor-pointer">حفظ</button>
              {saveMsg && <span className="text-xs text-green-700">{saveMsg}</span>}
            </div>
          </div>
          {/* Clinical metadata badges */}
          {(row.category_ar || row.clinical_use || row.clinical_category || row.specialty_tags || row.item_family_group) && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {row.category_ar && <span className="px-2 py-0.5 rounded-full text-xs bg-purple-100 text-purple-700">التصنيف: {row.category_ar}</span>}
              {row.clinical_use && <span className="px-2 py-0.5 rounded-full text-xs bg-teal-100 text-teal-700">الاستخدام: {row.clinical_use}</span>}
              {row.clinical_category && <span className="px-2 py-0.5 rounded-full text-xs bg-sky-100 text-sky-700">الفئة: {row.clinical_category}</span>}
              {row.specialty_tags && <span className="px-2 py-0.5 rounded-full text-xs bg-indigo-100 text-indigo-700">التخصص: {row.specialty_tags}</span>}
              {row.item_family_group && <span className="px-2 py-0.5 rounded-full text-xs bg-amber-100 text-amber-700">المجموعة: {row.item_family_group}</span>}
            </div>
          )}
          <p className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-1.5">البدائل المقترحة</p>
          {(altsMinScoreOverride ?? altsRecommendedMinScore) != null && alts.length > 0 && <p className="text-xs text-gray-500 mb-1">يتم عرض البدائل بنسبة تشابه لا تقل عن {altsMinScoreOverride ?? altsRecommendedMinScore}</p>}
          {altsLoading && <p className="text-xs text-gray-400">جارٍ التحميل…</p>}
          {altsError && <p className="text-xs text-amber-600">{altsError}</p>}
          {!altsLoading && !altsError && alts.length === 0 && <p className="text-xs text-gray-400">لا توجد بدائل لهذا البند.</p>}
          {alts.length > 0 && <AltTable alts={alts} qtyMap={altQtyMap} setQtyMap={setAltQtyMap} saveMsgMap={altSaveMsg} onSave={onAltSave} />}
        </td></tr>
      )}
    </>
  );
}
