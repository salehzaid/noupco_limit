"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Building2, Upload, ArrowDownToLine, ArrowUpFromLine, KeyRound, Settings, Lock, Unlock, Info } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8011";
const ADMIN_KEY_STORAGE_KEY = "nupco_admin_key";

type HospitalProfile = { id: number; name: string; code: string | null; is_active: boolean; city: string | null; region: string | null; contact_name: string | null; contact_phone: string | null; notes: string | null };
type Dept = { id: number; name: string };
type MasterImportResult = { effective_year: number; dry_run: boolean; hospital_id: number | null; departments_created: number; departments_linked: number; departments_total: number; rows_read: number; limits_upserted: number; missing_items: number; created_items: number; skipped_values: number; invalid_values: number; errors_sample: string[] };
type ImportPreviewRow = { generic_item_number: string; item_id: number | null; old_quantity: number | null; new_quantity: number; action: string };
type DeptImportResult = { department_id: number; effective_year: number; dry_run: boolean; rows_read: number; upserted: number; deleted: number; missing_items: number; invalid_values: number; prefix_matched?: number; ambiguous_codes?: number; errors_sample: string[]; preview_rows?: ImportPreviewRow[] };

const TABS = [
  { id: "profile", label: "الملف التعريفي", icon: Building2 },
  { id: "master-import", label: "استيراد رئيسي", icon: Upload },
  { id: "dept-io", label: "تصدير/استيراد أقسام", icon: ArrowDownToLine },
  { id: "pins", label: "إدارة رموز الدخول", icon: KeyRound },
] as const;
type TabId = (typeof TABS)[number]["id"];

const ACTION_STYLE: Record<string, string> = { insert: "bg-emerald-100 text-emerald-700", update: "bg-blue-100 text-blue-700", delete: "bg-red-100 text-red-700", missing: "bg-gray-100 text-gray-500", ambiguous: "bg-amber-100 text-amber-700", skip: "bg-gray-50 text-gray-400" };
const ACTION_LABEL: Record<string, string> = { insert: "إضافة", update: "تحديث", delete: "حذف", missing: "مفقود", ambiguous: "ملتبس", skip: "تخطي" };

export default function AdminHubPage() {
  const params = useParams<{ hospitalId: string }>();
  const searchParams = useSearchParams();
  const hospitalId = params.hospitalId;
  const initialTab = (searchParams.get("tab") as TabId) || "profile";

  const [activeTab, setActiveTab] = useState<TabId>(initialTab);
  const [adminKey, setAdminKey] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") setAdminKey(window.localStorage.getItem(ADMIN_KEY_STORAGE_KEY) || "");
  }, []);

  const onAdminKeyChange = (v: string) => {
    setAdminKey(v);
    if (typeof window === "undefined") return;
    if (v) window.localStorage.setItem(ADMIN_KEY_STORAGE_KEY, v);
    else window.localStorage.removeItem(ADMIN_KEY_STORAGE_KEY);
  };

  return (
    <div className="max-w-5xl mx-auto animate-fade-in">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-slate-600 to-slate-800 flex items-center justify-center shadow-lg shadow-slate-500/20">
          <Settings size={20} className="text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-800">الإدارة</h1>
          <p className="text-sm text-gray-500">إعدادات المستشفى، الاستيراد، التصدير، وإدارة أرقام الدخول.</p>
        </div>
      </div>

      {/* Admin key */}
      <div className="glass rounded-2xl p-4 mb-6 shadow-lg shadow-black/5 flex flex-wrap items-center gap-4">
        <Settings size={18} className="text-gray-400" />
        <label className="flex w-full items-center gap-2 text-sm sm:w-auto">
          <span className="text-gray-600 whitespace-nowrap">مفتاح المسؤول:</span>
          <input type="password" value={adminKey} onChange={(e) => onAdminKeyChange(e.target.value)} placeholder="مطلوب للعمليات" className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-400/40 focus:outline-none sm:w-48" />
        </label>
        {!adminKey && <span className="text-xs text-amber-600">يرجى إدخال المفتاح لتفعيل العمليات</span>}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 overflow-x-auto pb-1">
        {TABS.map((tab) => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition-all duration-200 ${activeTab === tab.id ? "bg-gradient-to-r from-blue-500 to-indigo-600 text-white shadow-lg shadow-blue-500/25" : "text-gray-600 hover:bg-gray-100"}`}>
            <tab.icon size={16} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="animate-scale-in" key={activeTab}>
        {activeTab === "profile" && <ProfileTab hospitalId={hospitalId} adminKey={adminKey} />}
        {activeTab === "master-import" && <MasterImportTab hospitalId={hospitalId} adminKey={adminKey} />}
        {activeTab === "dept-io" && <DeptIOTab hospitalId={hospitalId} adminKey={adminKey} />}
        {activeTab === "pins" && <PinsTab hospitalId={hospitalId} adminKey={adminKey} />}
      </div>
    </div>
  );
}

/* ====================== PROFILE TAB ====================== */
function ProfileTab({ hospitalId, adminKey }: { hospitalId: string; adminKey: string }) {
  const [profile, setProfile] = useState<HospitalProfile | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Partial<HospitalProfile>>({});
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`${API}/api/hospitals/${hospitalId}`).then((r) => r.ok ? r.json() : null).then((p) => { if (p) setProfile(p); }).catch(() => {});
  }, [hospitalId]);

  const startEdit = () => { if (!profile) return; setDraft({ name: profile.name, code: profile.code ?? "", city: profile.city ?? "", region: profile.region ?? "", contact_name: profile.contact_name ?? "", contact_phone: profile.contact_phone ?? "", notes: profile.notes ?? "" }); setEditing(true); setMsg(null); };

  const save = async () => {
    setSaving(true); setMsg(null);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (adminKey) headers["X-Admin-Key"] = adminKey;
      const res = await fetch(`${API}/api/hospitals/${hospitalId}`, { method: "PUT", headers, body: JSON.stringify(draft) });
      if (res.status === 403) { setMsg({ type: "err", text: "مفتاح المسؤول مطلوب أو غير صحيح" }); return; }
      if (!res.ok) { const e = await res.json().catch(() => ({})); setMsg({ type: "err", text: (e as { detail?: string }).detail || `تعذر الحفظ (${res.status})` }); return; }
      const updated: HospitalProfile = await res.json();
      setProfile(updated); setEditing(false); setMsg({ type: "ok", text: "تم الحفظ" });
      setTimeout(() => setMsg(null), 3000);
    } catch (e) { setMsg({ type: "err", text: String(e) }); } finally { setSaving(false); }
  };

  if (!profile) return <div className="text-gray-400 text-sm py-8 text-center">جارٍ التحميل…</div>;

  const fields = [
    { key: "name", label: "الاسم" }, { key: "code", label: "الرمز" },
    { key: "city", label: "المدينة" }, { key: "region", label: "المنطقة" },
    { key: "contact_name", label: "جهة الاتصال" }, { key: "contact_phone", label: "الهاتف" },
  ] as const;

  return (
    <div className="glass rounded-2xl p-6 shadow-lg shadow-black/5">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-sm font-semibold text-gray-700">الملف التعريفي للمستشفى</h2>
        <div className="flex items-center gap-2">
          {msg && <span className={`text-xs ${msg.type === "ok" ? "text-green-600" : "text-red-600"}`}>{msg.text}</span>}
          {!editing ? (
            <button onClick={startEdit} className="px-4 py-1.5 text-xs rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors">تعديل</button>
          ) : (
            <>
              <button onClick={() => { setEditing(false); setMsg(null); }} className="px-4 py-1.5 text-xs rounded-lg border border-gray-300 hover:bg-gray-50">إلغاء</button>
              <button onClick={save} disabled={saving} className="px-4 py-1.5 text-xs rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">{saving ? "جارٍ الحفظ…" : "حفظ"}</button>
            </>
          )}
        </div>
      </div>
      {editing ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {fields.map((f) => (
            <label key={f.key} className="block">
              <span className="text-xs text-gray-500 mb-1 block">{f.label}</span>
              <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400/40 focus:outline-none" value={(draft as Record<string, string>)[f.key] ?? ""} onChange={(e) => setDraft((p) => ({ ...p, [f.key]: e.target.value }))} />
            </label>
          ))}
          <label className="block sm:col-span-2">
            <span className="text-xs text-gray-500 mb-1 block">ملاحظات</span>
            <textarea className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400/40 focus:outline-none" rows={2} value={draft.notes ?? ""} onChange={(e) => setDraft((p) => ({ ...p, notes: e.target.value }))} />
          </label>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3">
          {fields.map((f) => (
            <div key={f.key}>
              <p className="text-xs text-gray-400 mb-0.5">{f.label}</p>
              <p className="text-sm font-medium text-gray-700">{(profile as Record<string, unknown>)[f.key] as string || "—"}</p>
            </div>
          ))}
          <div className="sm:col-span-3">
            <p className="text-xs text-gray-400 mb-0.5">ملاحظات</p>
            <p className="text-sm text-gray-700">{profile.notes || "—"}</p>
          </div>
        </div>
      )}
    </div>
  );
}

/* ====================== MASTER IMPORT TAB ====================== */
function MasterImportTab({ hospitalId, adminKey }: { hospitalId: string; adminKey: string }) {
  const [effectiveYear, setEffectiveYear] = useState("2025");
  const [result, setResult] = useState<MasterImportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const doImport = async (file: File, dryRun: boolean) => {
    setLoading(true); if (dryRun) setResult(null);
    const form = new FormData(); form.append("file", file);
    const headers: Record<string, string> = {}; if (adminKey) headers["X-Admin-Key"] = adminKey;
    try {
      const res = await fetch(`${API}/api/import/max-limits-master?effective_year=${effectiveYear}&dry_run=${dryRun}&hospital_id=${hospitalId}`, { method: "POST", body: form, headers });
      const data: MasterImportResult = await res.json();
      if (res.status === 403) { setResult({ ...data, errors_sample: ["مفتاح المسؤول مطلوب أو غير صحيح"] }); setPendingFile(null); return; }
      setResult(data); setPendingFile(dryRun ? file : null);
    } catch (e) {
      setResult({ effective_year: Number(effectiveYear), dry_run: dryRun, hospital_id: Number(hospitalId), departments_created: 0, departments_linked: 0, departments_total: 0, rows_read: 0, limits_upserted: 0, missing_items: 0, created_items: 0, skipped_values: 0, invalid_values: 0, errors_sample: [String(e)] });
      setPendingFile(null);
    } finally { setLoading(false); if (dryRun && fileRef.current) fileRef.current.value = ""; }
  };

  return (
    <div className="space-y-5">
      <div className="glass rounded-2xl p-5 shadow-lg shadow-black/5">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">استيراد الحد الأعلى الرئيسي</h2>
        <p className="text-xs text-gray-500 mb-4">يُنشئ الأقسام تلقائيًا من أعمدة الملف ويربطها بهذا المستشفى، ثم يوزّع قيم الحد الأعلى لكل قسم.</p>
        <div className="flex flex-wrap gap-3 items-end mb-4">
          <label className="block text-sm"><span className="text-xs text-gray-500 block mb-1">السنة</span><input type="number" value={effectiveYear} onChange={(e) => setEffectiveYear(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-1.5 w-24 text-sm" /></label>
        </div>
        <div className="p-4 rounded-xl bg-amber-50/80 border border-amber-200/60 text-xs text-amber-800 mb-4">
          <p className="font-medium mb-1 flex items-center gap-1"><Info size={14} /> الصيغة المطلوبة:</p>
          <ul className="list-disc list-inside space-y-0.5 mr-5">
            <li>ملف <strong>.xlsx</strong> يحتوي على ورقة اسمها <strong>«المجموع»</strong></li>
            <li>أعمدة إلزامية: <code className="bg-amber-100 px-1 rounded">كود نوبكو</code> · <code className="bg-amber-100 px-1 rounded">Desc</code> (الوصف) · <code className="bg-amber-100 px-1 rounded">الحد الأعلى للمستشفى 2025</code></li>
            <li>بقية الأعمدة = أسماء الأقسام</li>
          </ul>
        </div>
        <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) doImport(f, true); }} />
        {!result && !loading && (
          <button onClick={() => fileRef.current?.click()} className="w-full py-4 border-2 border-dashed border-blue-400/60 rounded-xl text-blue-600 hover:bg-blue-50/50 text-sm font-medium transition-colors">
            <Upload size={20} className="inline mr-2" />اختر ملف Excel
          </button>
        )}
        {loading && <div className="w-full py-4 border-2 border-dashed border-gray-300 rounded-xl text-center text-gray-400 text-sm">جارٍ المعالجة…</div>}
      </div>

      {result && !loading && (
        <div className={`glass rounded-2xl p-5 shadow-lg shadow-black/5 ${result.errors_sample.length > 0 ? "border border-red-200" : ""}`}>
          <h3 className="text-sm font-semibold text-gray-800 mb-4">{result.dry_run ? "معاينة (لم يُحفظ بعد)" : "نتيجة الاستيراد"}</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
            <StatBadge label="أقسام جديدة" value={result.departments_created} color="blue" />
            <StatBadge label="أقسام مرتبطة" value={result.departments_linked} color="indigo" />
            <StatBadge label="إجمالي الأقسام" value={result.departments_total} color="gray" />
            <StatBadge label="صفوف مقروءة" value={result.rows_read} color="gray" />
            <StatBadge label="حدود محدّثة" value={result.limits_upserted} color="green" />
            <StatBadge label="بنود منشأة" value={result.created_items} color="teal" />
            <StatBadge label="بنود مفقودة" value={result.missing_items} color="amber" />
            <StatBadge label="قيم غير صالحة" value={result.invalid_values} color="red" />
            <StatBadge label="قيم متجاهلة" value={result.skipped_values} color="gray" />
          </div>
          {result.errors_sample.length > 0 && <ErrorSample errors={result.errors_sample} />}
          {result.dry_run ? (
            <div className="flex gap-3 mt-2">
              <button onClick={() => { setResult(null); setPendingFile(null); }} className="px-4 py-2 text-sm rounded-lg border border-gray-300 hover:bg-gray-50">إلغاء</button>
              <button onClick={() => { if (pendingFile) doImport(pendingFile, false); }} disabled={result.errors_sample.some((e) => e.includes("مفتاح"))} className="px-4 py-2 text-sm rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50">تأكيد الاستيراد</button>
            </div>
          ) : (
            <button onClick={() => { setResult(null); setPendingFile(null); }} className="px-4 py-2 text-sm rounded-lg border border-gray-300 hover:bg-gray-50">استيراد جديد</button>
          )}
        </div>
      )}
    </div>
  );
}

/* ====================== DEPT I/O TAB ====================== */
function DeptIOTab({ hospitalId, adminKey }: { hospitalId: string; adminKey: string }) {
  const [depts, setDepts] = useState<Dept[]>([]);
  const [selectedDeptId, setSelectedDeptId] = useState<number | null>(null);
  const [effectiveYear, setEffectiveYear] = useState("2025");
  const [result, setResult] = useState<DeptImportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch(`${API}/api/hospitals/${hospitalId}/departments`).then((r) => r.json()).then((d: Dept[]) => setDepts(d)).catch(() => {});
  }, [hospitalId]);

  const selectedDept = depts.find((d) => d.id === selectedDeptId);

  const handleExport = () => {
    if (!selectedDeptId) return;
    const a = document.createElement("a"); a.href = `${API}/api/export/department-max-limits?department_id=${selectedDeptId}&effective_year=${effectiveYear}`; a.download = ""; a.click();
  };

  const doImport = async (file: File, dryRun: boolean) => {
    if (!selectedDeptId) return; setLoading(true); if (dryRun) setResult(null);
    const form = new FormData(); form.append("file", file);
    const headers: Record<string, string> = {}; if (adminKey) headers["X-Admin-Key"] = adminKey;
    try {
      const res = await fetch(`${API}/api/import/department-max-limits?department_id=${selectedDeptId}&effective_year=${effectiveYear}&dry_run=${dryRun}`, { method: "POST", body: form, headers });
      const data: DeptImportResult = await res.json();
      if (res.status === 403) { setResult({ ...data, errors_sample: ["مفتاح المسؤول مطلوب أو غير صحيح"] }); setPendingFile(null); return; }
      setResult(data); setPendingFile(dryRun ? file : null);
    } catch (e) { setResult({ department_id: selectedDeptId, effective_year: Number(effectiveYear), dry_run: dryRun, rows_read: 0, upserted: 0, deleted: 0, missing_items: 0, invalid_values: 0, errors_sample: [String(e)] }); setPendingFile(null);
    } finally { setLoading(false); if (dryRun && fileRef.current) fileRef.current.value = ""; }
  };

  return (
    <div className="space-y-5">
      <div className="glass rounded-2xl p-5 shadow-lg shadow-black/5">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">تصدير واستيراد حدود الأقسام</h2>
        <div className="flex flex-wrap gap-3 items-end mb-5">
          <label className="block text-sm"><span className="text-xs text-gray-500 block mb-1">القسم</span>
            <select className="w-full border border-gray-300 rounded-lg bg-white px-3 py-2 text-sm sm:w-auto sm:min-w-[240px]" value={selectedDeptId ?? ""} onChange={(e) => { setSelectedDeptId(e.target.value ? Number(e.target.value) : null); setResult(null); setPendingFile(null); }}>
              <option value="">-- اختر قسمًا --</option>
              {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
          <label className="block text-sm"><span className="text-xs text-gray-500 block mb-1">السنة</span><input type="number" value={effectiveYear} onChange={(e) => setEffectiveYear(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 w-24 text-sm" /></label>
        </div>

        {selectedDeptId ? (
          <div className="flex flex-wrap gap-3">
            <button onClick={handleExport} className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-green-500 to-emerald-600 text-white text-sm font-medium shadow-lg shadow-green-500/25 hover:shadow-xl transition-all">
              <ArrowDownToLine size={16} /> تصدير — {selectedDept?.name}
            </button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) doImport(f, true); }} />
            <button onClick={() => fileRef.current?.click()} disabled={loading} className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 text-white text-sm font-medium shadow-lg shadow-blue-500/25 hover:shadow-xl transition-all disabled:opacity-50">
              <ArrowUpFromLine size={16} /> {loading ? "جارٍ المعالجة…" : `استيراد — ${selectedDept?.name}`}
            </button>
          </div>
        ) : (
          <div className="text-center py-8 text-gray-400 text-sm">اختر قسمًا لتظهر خيارات التصدير والاستيراد.</div>
        )}
      </div>

      {result && !loading && (
        <div className={`glass rounded-2xl p-5 shadow-lg shadow-black/5 ${result.errors_sample.length ? "border border-red-200" : ""}`}>
          <h3 className="text-sm font-semibold text-gray-800 mb-4">{result.dry_run ? `معاينة — ${selectedDept?.name}` : `نتيجة — ${selectedDept?.name}`}</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <StatBadge label="صفوف" value={result.rows_read} color="gray" />
            <StatBadge label="ستُحدَّث" value={result.upserted} color="blue" />
            <StatBadge label="ستُحذف" value={result.deleted} color="red" />
            <StatBadge label="مفقودة" value={result.missing_items} color="amber" />
          </div>
          {result.errors_sample.length > 0 && <ErrorSample errors={result.errors_sample} />}
          {result.dry_run && result.preview_rows && result.preview_rows.length > 0 && (
            <div className="mb-4 rounded-xl border border-gray-200/60">
              <p className="border-b border-gray-100 px-3 py-1.5 text-[11px] text-gray-500 sm:hidden">اسحب أفقيا لعرض كل الأعمدة</p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] text-xs">
                  <thead className="bg-gray-50/80"><tr><th className="px-3 py-2 text-right">الكود</th><th className="px-3 py-2 text-right">القديم</th><th className="px-3 py-2 text-right">الجديد</th><th className="px-3 py-2 text-center">العملية</th></tr></thead>
                  <tbody>{result.preview_rows.map((r, i) => (
                    <tr key={i} className="border-t border-gray-100 hover:bg-blue-50/30"><td className="px-3 py-1.5 font-mono">{r.generic_item_number}</td><td className="px-3 py-1.5 text-right text-gray-500">{r.old_quantity ?? "—"}</td><td className="px-3 py-1.5 text-right font-semibold">{r.new_quantity}</td><td className="px-3 py-1.5 text-center"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ACTION_STYLE[r.action] ?? "bg-gray-100 text-gray-600"}`}>{ACTION_LABEL[r.action] ?? r.action}</span></td></tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          )}
          {result.dry_run ? (
            <div className="flex gap-3"><button onClick={() => { setResult(null); setPendingFile(null); }} className="px-4 py-2 text-sm rounded-lg border border-gray-300 hover:bg-gray-50">إلغاء</button><button onClick={() => { if (pendingFile) doImport(pendingFile, false); }} className="px-4 py-2 text-sm rounded-lg bg-green-600 text-white hover:bg-green-700">تأكيد</button></div>
          ) : (
            <div className="flex gap-3"><button onClick={() => { setResult(null); setPendingFile(null); }} className="px-4 py-2 text-sm rounded-lg border border-gray-300 hover:bg-gray-50">جديد</button><Link href={`/hospitals/${hospitalId}/departments/${selectedDeptId}/limits`} className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700">فتح الحدود</Link></div>
          )}
        </div>
      )}
    </div>
  );
}

/* ====================== PINS TAB ====================== */
function PinsTab({ hospitalId, adminKey }: { hospitalId: string; adminKey: string }) {
  const [depts, setDepts] = useState<Dept[]>([]);
  const [pinMap, setPinMap] = useState<Record<number, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [pinDraft, setPinDraft] = useState<Record<number, string>>({});
  const [pinMsg, setPinMsg] = useState<Record<number, { type: "ok" | "err"; text: string }>>({});
  const [savingId, setSavingId] = useState<number | null>(null);

  const refreshPins = () => {
    fetch(`${API}/api/hospitals/${hospitalId}/departments/pins`).then((r) => r.json()).then((list: { department_id: number; has_pin: boolean }[]) => {
      const m: Record<number, boolean> = {}; (Array.isArray(list) ? list : []).forEach((x) => { m[x.department_id] = x.has_pin; }); setPinMap(m);
    }).catch(() => {});
  };

  useEffect(() => {
    Promise.all([
      fetch(`${API}/api/hospitals/${hospitalId}/departments`).then((r) => r.json()),
      fetch(`${API}/api/hospitals/${hospitalId}/departments/pins`).then((r) => r.json()),
    ]).then(([d, pins]) => {
      setDepts(Array.isArray(d) ? d : []);
      const m: Record<number, boolean> = {}; (Array.isArray(pins) ? pins : []).forEach((x: { department_id: number; has_pin: boolean }) => { m[x.department_id] = x.has_pin; }); setPinMap(m);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [hospitalId]);

  const handleSetPin = async (deptId: number, pinValue: string | null) => {
    setSavingId(deptId); setPinMsg((p) => ({ ...p, [deptId]: { type: "ok", text: "" } }));
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (adminKey) headers["X-Admin-Key"] = adminKey;
      const res = await fetch(`${API}/api/departments/${deptId}/pin`, { method: "PUT", headers, body: JSON.stringify(pinValue !== null ? { pin: pinValue } : { pin: null }) });
      if (res.status === 403) { setPinMsg((p) => ({ ...p, [deptId]: { type: "err", text: "مفتاح غير صحيح" } })); return; }
      if (!res.ok) { const e = await res.json().catch(() => ({})); setPinMsg((p) => ({ ...p, [deptId]: { type: "err", text: (e as { detail?: string }).detail || "تعذر تحديث الرمز" } })); return; }
      setPinMsg((p) => ({ ...p, [deptId]: { type: "ok", text: pinValue !== null ? "تم التعيين" : "تم المسح" } }));
      setPinDraft((p) => ({ ...p, [deptId]: "" })); refreshPins();
      setTimeout(() => setPinMsg((p) => ({ ...p, [deptId]: { type: "ok" as const, text: "" } })), 2500);
    } catch (e) { setPinMsg((p) => ({ ...p, [deptId]: { type: "err", text: String(e) } })); } finally { setSavingId(null); }
  };

  if (loading) return <div className="text-gray-400 text-sm py-8 text-center">جارٍ التحميل…</div>;

  return (
    <div className="glass rounded-2xl shadow-lg shadow-black/5 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200/60">
        <h2 className="text-sm font-semibold text-gray-700">إدارة أرقام الدخول (PINs)</h2>
        <p className="text-xs text-gray-500 mt-0.5">عيّن أو امسح رمز الدخول (4–8 أرقام) لكل قسم.</p>
      </div>
      {depts.length === 0 ? (
        <div className="p-8 text-center text-gray-400 text-sm">لا توجد أقسام</div>
      ) : (
        <div>
          <p className="border-b border-gray-100 px-4 py-1.5 text-[11px] text-gray-500 sm:hidden">اسحب أفقيا لعرض كل الأعمدة</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-gray-50/80 text-xs text-gray-500 uppercase tracking-wider">
                <tr><th className="px-5 py-3 text-right">القسم</th><th className="px-5 py-3 text-center w-24">الحالة</th><th className="px-5 py-3 text-right w-36">PIN جديد</th><th className="px-5 py-3 text-right">إجراءات</th><th className="px-5 py-3 w-32"></th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {depts.map((d) => (
                  <tr key={d.id} className="hover:bg-blue-50/30 transition-colors">
                    <td className="px-5 py-3 font-medium text-gray-800">{d.name}</td>
                    <td className="px-5 py-3 text-center">{pinMap[d.id] ? <Lock size={15} className="inline text-amber-500" /> : <Unlock size={15} className="inline text-gray-300" />}</td>
                    <td className="px-5 py-3"><input type="password" inputMode="numeric" maxLength={8} placeholder="••••" value={pinDraft[d.id] ?? ""} onChange={(e) => setPinDraft((p) => ({ ...p, [d.id]: e.target.value.replace(/\D/g, "").slice(0, 8) }))} className="w-28 border border-gray-300 rounded-lg px-2 py-1.5 text-sm" /></td>
                    <td className="px-5 py-3">
                      <button onClick={() => handleSetPin(d.id, (pinDraft[d.id] ?? "").trim())} disabled={savingId === d.id || (pinDraft[d.id] ?? "").length < 4} className="px-3 py-1.5 text-xs rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 mr-2">حفظ</button>
                      <button onClick={() => handleSetPin(d.id, null)} disabled={savingId === d.id || !pinMap[d.id]} className="px-3 py-1.5 text-xs rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50">مسح</button>
                    </td>
                    <td className="px-5 py-3 text-xs">{pinMsg[d.id]?.text && <span className={pinMsg[d.id].type === "ok" ? "text-green-600" : "text-red-600"}>{pinMsg[d.id].text}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* ====================== SHARED COMPONENTS ====================== */
function StatBadge({ label, value, color }: { label: string; value: number; color: string }) {
  const colors: Record<string, string> = {
    blue: "text-blue-700 bg-blue-50 border-blue-200/60", indigo: "text-indigo-700 bg-indigo-50 border-indigo-200/60",
    green: "text-green-700 bg-green-50 border-green-200/60", teal: "text-teal-700 bg-teal-50 border-teal-200/60",
    amber: "text-amber-700 bg-amber-50 border-amber-200/60", red: "text-red-700 bg-red-50 border-red-200/60",
    gray: "text-gray-700 bg-gray-50 border-gray-200/60",
  };
  return (<div className={`rounded-xl border p-3 ${colors[color] ?? colors.gray}`}><p className="text-xs opacity-70">{label}</p><p className="text-lg font-bold mt-0.5 tabular-nums">{value.toLocaleString("ar-SA")}</p></div>);
}

function ErrorSample({ errors }: { errors: string[] }) {
  return (
    <div className="mb-4 p-3 bg-red-50/80 rounded-xl border border-red-200/60">
      <p className="text-xs font-semibold text-red-700 mb-1">عينة أخطاء:</p>
      <ul className="list-disc list-inside text-xs text-red-600 space-y-0.5 max-h-24 overflow-y-auto">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
    </div>
  );
}
