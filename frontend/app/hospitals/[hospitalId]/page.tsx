"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { TrendingUp, Package, Building2, ArrowLeft, RefreshCw } from "lucide-react";
import { getApiBase, fetchWithTimeout, formatApiError } from "@/app/lib/api";

type Summary = { departments_count: number; items_with_limits_count: number; total_limits_sum: number };
type TopDept = { department_id: number; department_name: string; total_limit: number };
type TopItem = { item_id: number; generic_item_number: string; generic_description: string | null; facility_total_quantity: number };
type Usage = { last_7_days_changes: number; last_30_days_changes: number };
type DashboardData = {
  hospital: { id: number; name: string; code: string | null };
  summary: Summary;
  top_departments_by_total_limit: TopDept[];
  top_items_by_facility_total: TopItem[];
  usage?: Usage;
};

function fmt(n: number) { return n.toLocaleString("ar-SA"); }
function shortDesc(d: string | null, max = 20) { return d ? (d.length > max ? d.slice(0, max) + "…" : d) : "غير متوفر"; }

export default function OverviewPage() {
  const params = useParams<{ hospitalId: string }>();
  const hospitalId = params.hospitalId;

  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const LAST_DEPT_KEY = `nupco_last_department_${hospitalId}`;
  const [lastDept, setLastDept] = useState<{ id: number; name: string } | null>(null);

  const loadDashboard = useCallback(() => {
    setLoading(true);
    setError(null);
    const api = getApiBase();
    fetchWithTimeout(`${api}/api/hospitals/${hospitalId}/dashboard`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => {
        if (!d || typeof d !== "object") throw new Error("استجابة غير صالحة");
        setData(d);
      })
      .catch((e) => setError(formatApiError(e, "تعذر تحميل البيانات")))
      .finally(() => setLoading(false));
  }, [hospitalId]);

  useEffect(() => {
    try {
      const raw = typeof window !== "undefined" ? window.localStorage.getItem(LAST_DEPT_KEY) : null;
      if (raw) setLastDept(JSON.parse(raw));
    } catch { /* ignore */ }
    loadDashboard();
  }, [loadDashboard, LAST_DEPT_KEY]);

  if (loading && !data) {
    return (
      <div className="max-w-6xl mx-auto animate-fade-in space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => <div key={i} className="rounded-2xl h-24 bg-gradient-to-br from-gray-200 to-gray-100 animate-pulse" style={{ animationDelay: `${i * 80}ms` }} />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {[0, 1].map((i) => <div key={i} className="rounded-2xl h-72 bg-white/70 animate-pulse border border-gray-100" style={{ animationDelay: `${i * 100}ms` }} />)}
        </div>
      </div>
    );
  }
  if (error && !data) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[280px] gap-4 glass rounded-2xl p-8">
        <p className="text-red-500 font-medium">خطأ: {error}</p>
        <p className="text-xs text-gray-500">تحقق من تشغيل الـ Backend واتصال الشبكة</p>
        <button onClick={loadDashboard} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700 cursor-pointer transition-colors duration-200">
          <RefreshCw size={16} /> إعادة المحاولة
        </button>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <p className="text-gray-400">لا توجد بيانات</p>
      </div>
    );
  }

  const { summary, top_departments_by_total_limit, top_items_by_facility_total, usage } = data;

  const stats = [
    { label: "الأقسام", value: summary.departments_count, icon: Building2, gradient: "from-blue-500 to-blue-600", shadow: "shadow-blue-500/25" },
    { label: "بنود بحدود", value: summary.items_with_limits_count, icon: Package, gradient: "from-teal-500 to-emerald-600", shadow: "shadow-teal-500/25" },
    { label: "إجمالي الحدود", value: summary.total_limits_sum, icon: TrendingUp, gradient: "from-violet-500 to-purple-600", shadow: "shadow-violet-500/25" },
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-fade-in">
      {/* Continue where you left off */}
      {lastDept && (
        <Link
          href={`/hospitals/${hospitalId}/departments/${lastDept.id}/limits`}
          className="flex items-center justify-between p-4 rounded-xl glass border border-blue-200/50 hover:border-blue-400/60 transition-all group"
        >
          <div>
            <p className="text-xs text-blue-500 font-medium mb-0.5">أكمل من حيث توقفت</p>
            <p className="text-sm font-semibold text-gray-800">{lastDept.name}</p>
          </div>
          <ArrowLeft size={18} className="text-blue-400 group-hover:-translate-x-1 transition-transform" />
        </Link>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {stats.map((s, i) => (
          <div
            key={s.label}
            className={`relative overflow-hidden rounded-2xl bg-gradient-to-br ${s.gradient} p-5 text-white shadow-xl ${s.shadow}`}
            style={{ animationDelay: `${i * 80}ms` }}
          >
            <div className="absolute top-3 right-3 opacity-20">
              <s.icon size={40} />
            </div>
            <p className="text-white/80 text-xs font-medium">{s.label}</p>
            <p className="text-3xl font-bold mt-2 tabular-nums">{fmt(s.value)}</p>
          </div>
        ))}
      </div>

      {/* Usage quick glance */}
      {usage && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="glass rounded-2xl p-5 shadow-lg shadow-black/5">
            <p className="text-xs text-indigo-500 font-medium">تغييرات آخر 7 أيام</p>
            <p className="text-2xl font-bold text-gray-800 mt-1">{fmt(usage.last_7_days_changes)}</p>
          </div>
          <div className="glass rounded-2xl p-5 shadow-lg shadow-black/5">
            <p className="text-xs text-indigo-500 font-medium">تغييرات آخر 30 يومًا</p>
            <p className="text-2xl font-bold text-gray-800 mt-1">{fmt(usage.last_30_days_changes)}</p>
          </div>
        </div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="glass rounded-2xl p-6 shadow-lg shadow-black/5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">أعلى 5 أقسام حسب إجمالي الحد</h2>
          {top_departments_by_total_limit.length === 0 ? (
            <p className="text-gray-400 text-sm py-8 text-center">لا توجد بيانات</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={top_departments_by_total_limit} layout="vertical" margin={{ left: 10, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis type="number" tickFormatter={(v) => fmt(v)} fontSize={11} stroke="#94a3b8" />
                <YAxis type="category" dataKey="department_name" width={130} fontSize={11} tick={{ fill: "#475569" }} />
                <Tooltip formatter={(v) => fmt(Number(v))} contentStyle={{ borderRadius: 12, border: "none", boxShadow: "0 8px 32px rgba(0,0,0,0.12)" }} />
                <Bar dataKey="total_limit" fill="url(#blueGrad)" radius={[0, 6, 6, 0]} />
                <defs>
                  <linearGradient id="blueGrad" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#3b82f6" />
                    <stop offset="100%" stopColor="#6366f1" />
                  </linearGradient>
                </defs>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="glass rounded-2xl p-6 shadow-lg shadow-black/5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">أعلى 5 بنود حسب إجمالي المنشأة</h2>
          {top_items_by_facility_total.length === 0 ? (
            <p className="text-gray-400 text-sm py-8 text-center">لا توجد بيانات</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart
                data={top_items_by_facility_total.map((it) => ({ ...it, label: shortDesc(it.generic_description) }))}
                layout="vertical"
                margin={{ left: 10, right: 20 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis type="number" tickFormatter={(v) => fmt(v)} fontSize={11} stroke="#94a3b8" />
                <YAxis type="category" dataKey="label" width={130} fontSize={11} tick={{ fill: "#475569" }} />
                <Tooltip
                  formatter={(v) => fmt(Number(v))}
                  labelFormatter={(_label, payload) => {
                    const p = payload as Array<{ payload?: TopItem }>;
                    return p?.[0]?.payload?.generic_item_number || "";
                  }}
                  contentStyle={{ borderRadius: 12, border: "none", boxShadow: "0 8px 32px rgba(0,0,0,0.12)" }}
                />
                <Bar dataKey="facility_total_quantity" fill="url(#tealGrad)" radius={[0, 6, 6, 0]} />
                <defs>
                  <linearGradient id="tealGrad" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#14b8a6" />
                    <stop offset="100%" stopColor="#10b981" />
                  </linearGradient>
                </defs>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}
