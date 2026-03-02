"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { Activity, TrendingUp, Clock, BarChart3 } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8011";

type DeptChange = { department_id: number; department_name: string; changes: number };
type RecentChange = { created_at: string | null; department_name: string; generic_item_number: string; action: string; old_quantity: number | null; new_quantity: number | null; source: string };
type CoverageRow = { department_id: number; department_name: string; items_with_limits: number };
type Usage = {
  last_7_days_changes: number;
  last_30_days_changes: number;
  top_departments_by_changes_7d: DeptChange[];
  recent_changes: RecentChange[];
  coverage_by_department: CoverageRow[];
};

function fmt(n: number) { return n.toLocaleString("ar-SA"); }

const ACTION_BADGE: Record<string, string> = {
  insert: "bg-emerald-100 text-emerald-700",
  update: "bg-blue-100 text-blue-700",
  delete: "bg-red-100 text-red-700",
};

const ACTION_LABEL: Record<string, string> = {
  insert: "إضافة",
  update: "تحديث",
  delete: "حذف",
};

const SOURCE_LABEL: Record<string, string> = {
  manual: "يدوي",
  import_excel: "استيراد",
  seed_excel: "تهيئة",
};

export default function AnalyticsPage() {
  const params = useParams<{ hospitalId: string }>();
  const hospitalId = params.hospitalId;

  const [usage, setUsage] = useState<Usage | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/api/hospitals/${hospitalId}/dashboard`)
      .then((r) => r.json())
      .then((d) => { if (d?.usage) setUsage(d.usage); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [hospitalId]);

  if (loading) return (
    <div className="max-w-6xl mx-auto animate-fade-in space-y-6">
      <div className="h-7 w-28 bg-gray-200 rounded-lg animate-pulse" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[0, 1].map((i) => <div key={i} className="rounded-2xl h-24 bg-gradient-to-br from-gray-200 to-gray-100 animate-pulse" style={{ animationDelay: `${i * 80}ms` }} />)}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {[0, 1].map((i) => <div key={i} className="rounded-2xl h-72 bg-white/70 animate-pulse border border-gray-100" style={{ animationDelay: `${i * 80}ms` }} />)}
      </div>
      <div className="rounded-2xl h-64 bg-white/70 animate-pulse border border-gray-100" />
    </div>
  );

  if (!usage) {
    return (
      <div className="max-w-6xl mx-auto text-center py-20 animate-fade-in">
        <Activity size={48} className="mx-auto text-gray-300 mb-4" />
        <p className="text-gray-400 text-sm">لا توجد بيانات تحليلية بعد.</p>
        <p className="text-gray-400 text-xs mt-1">ستظهر هنا بعد إجراء تعديلات على الحدود.</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-fade-in">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-500/25">
          <BarChart3 size={20} className="text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-800">التحليلات</h1>
          <p className="text-sm text-gray-500">نشاط التعديلات والتغطية</p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 p-5 text-white shadow-xl shadow-indigo-500/25">
          <div className="absolute top-3 right-3 opacity-20"><Activity size={36} /></div>
          <p className="text-white/80 text-xs font-medium uppercase tracking-wider">تغييرات آخر 7 أيام</p>
          <p className="text-3xl font-bold mt-2 tabular-nums">{fmt(usage.last_7_days_changes)}</p>
        </div>
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-fuchsia-500 to-pink-600 p-5 text-white shadow-xl shadow-fuchsia-500/25">
          <div className="absolute top-3 right-3 opacity-20"><TrendingUp size={36} /></div>
          <p className="text-white/80 text-xs font-medium uppercase tracking-wider">تغييرات آخر 30 يوم</p>
          <p className="text-3xl font-bold mt-2 tabular-nums">{fmt(usage.last_30_days_changes)}</p>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Active departments */}
        <div className="glass rounded-2xl p-6 shadow-lg shadow-black/5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">أكثر الأقسام نشاطًا (7 أيام)</h2>
          {usage.top_departments_by_changes_7d.length === 0 ? (
            <p className="text-gray-400 text-sm py-8 text-center">لا توجد تغييرات</p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={usage.top_departments_by_changes_7d} layout="vertical" margin={{ left: 10, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis type="number" fontSize={11} stroke="#94a3b8" />
                <YAxis type="category" dataKey="department_name" width={120} fontSize={11} tick={{ fill: "#475569" }} />
                <Tooltip contentStyle={{ borderRadius: 12, border: "none", boxShadow: "0 8px 32px rgba(0,0,0,0.12)" }} />
                <Bar dataKey="changes" fill="url(#purpleGrad)" radius={[0, 6, 6, 0]} />
                <defs>
                  <linearGradient id="purpleGrad" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#8b5cf6" />
                    <stop offset="100%" stopColor="#a78bfa" />
                  </linearGradient>
                </defs>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Coverage */}
        <div className="glass rounded-2xl p-6 shadow-lg shadow-black/5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">تغطية الأقسام (أعلى 10)</h2>
          {usage.coverage_by_department.length === 0 ? (
            <p className="text-gray-400 text-sm py-8 text-center">لا توجد بيانات</p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={usage.coverage_by_department.slice(0, 10)} layout="vertical" margin={{ left: 10, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis type="number" fontSize={11} stroke="#94a3b8" />
                <YAxis type="category" dataKey="department_name" width={120} fontSize={11} tick={{ fill: "#475569" }} />
                <Tooltip contentStyle={{ borderRadius: 12, border: "none", boxShadow: "0 8px 32px rgba(0,0,0,0.12)" }} />
                <Bar dataKey="items_with_limits" fill="url(#tealCoverageGrad)" radius={[0, 6, 6, 0]} />
                <defs>
                  <linearGradient id="tealCoverageGrad" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#14b8a6" />
                    <stop offset="100%" stopColor="#34d399" />
                  </linearGradient>
                </defs>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Recent changes table */}
      <div className="glass rounded-2xl p-6 shadow-lg shadow-black/5">
        <div className="flex items-center gap-2 mb-4">
          <Clock size={16} className="text-gray-400" />
          <h2 className="text-sm font-semibold text-gray-700">آخر 20 تعديل</h2>
        </div>
        {usage.recent_changes.length === 0 ? (
          <p className="text-gray-400 text-sm py-8 text-center">لا توجد تعديلات</p>
        ) : (
          <div className="rounded-xl border border-gray-200/60">
            <p className="border-b border-gray-100 px-3 py-1.5 text-[11px] text-gray-500 sm:hidden">اسحب أفقيا لعرض كل الأعمدة</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-gray-50/80">
                  <tr className="text-xs text-gray-500">
                    <th className="px-4 py-3 text-right">الوقت</th>
                    <th className="px-4 py-3 text-right">القسم</th>
                    <th className="px-4 py-3 text-right">الكود</th>
                    <th className="px-4 py-3 text-center">العملية</th>
                    <th className="px-4 py-3 text-right">قديم → جديد</th>
                    <th className="px-4 py-3 text-right">المصدر</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {usage.recent_changes.map((c, i) => (
                    <tr key={i} className="hover:bg-blue-50/40 transition-colors">
                      <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap">
                        {c.created_at ? new Date(c.created_at).toLocaleString("ar-SA", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-xs font-medium text-gray-700">{c.department_name}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-gray-600">{c.generic_item_number}</td>
                      <td className="px-4 py-2.5 text-center">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${ACTION_BADGE[c.action] ?? "bg-gray-100 text-gray-600"}`}>
                          {ACTION_LABEL[c.action] ?? c.action}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-600 tabular-nums">{c.old_quantity ?? "—"} → {c.new_quantity ?? "—"}</td>
                      <td className="px-4 py-2.5 text-xs text-gray-500">{SOURCE_LABEL[c.source] ?? c.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
