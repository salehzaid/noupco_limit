"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Search, ArrowLeft, CheckCircle2, AlertCircle, Building2, Layers } from "lucide-react";
import { getApiBase } from "@/app/lib/api";

const API = getApiBase();

type DeptBrief = { id: number; name: string };
type CoverageRow = { department_id: number; department_name: string; items_with_limits: number };

function LoadingSkeleton() {
  return (
    <div className="max-w-6xl mx-auto animate-fade-in">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-gray-200/70 animate-pulse" />
        <div>
          <div className="h-5 w-24 bg-gray-200/70 rounded-lg animate-pulse mb-1.5" />
          <div className="h-3 w-16 bg-gray-200/50 rounded animate-pulse" />
        </div>
      </div>
      <div className="h-12 w-full bg-gray-200/50 rounded-xl animate-pulse mb-5" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-2xl bg-white/60 p-5 shadow-sm animate-pulse" style={{ animationDelay: `${i * 60}ms` }}>
            <div className="flex justify-between mb-3">
              <div className="h-4 w-32 bg-gray-200 rounded" />
              <div className="h-4 w-4 bg-gray-200 rounded" />
            </div>
            <div className="h-3 w-20 bg-gray-100 rounded mb-3" />
            <div className="h-1.5 w-full bg-gray-100 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DepartmentsPage() {
  const params = useParams<{ hospitalId: string }>();
  const hospitalId = params.hospitalId;

  const [depts, setDepts] = useState<DeptBrief[]>([]);
  const [coverage, setCoverage] = useState<CoverageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const LAST_DEPT_KEY = `nupco_last_department_${hospitalId}`;
  const [lastDept, setLastDept] = useState<{ id: number; name: string } | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(LAST_DEPT_KEY);
      if (raw) setLastDept(JSON.parse(raw));
    } catch { /* ignore */ }

    Promise.all([
      fetch(`${API}/api/hospitals/${hospitalId}/departments`).then((r) => r.json()),
      fetch(`${API}/api/hospitals/${hospitalId}/dashboard`).then((r) => r.json()),
    ])
      .then(([deps, dash]) => {
        setDepts(deps);
        if (dash?.usage?.coverage_by_department) setCoverage(dash.usage.coverage_by_department);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [hospitalId, LAST_DEPT_KEY]);

  const coverageMap = useMemo(() => {
    const m = new Map<number, number>();
    coverage.forEach((c) => m.set(c.department_id, c.items_with_limits));
    return m;
  }, [coverage]);

  const maxCoverage = useMemo(() => Math.max(1, ...coverage.map((c) => c.items_with_limits)), [coverage]);

  const filtered = useMemo(() => {
    if (!search.trim()) return depts;
    const q = search.trim().toLowerCase();
    return depts.filter((d) => d.name.toLowerCase().includes(q));
  }, [depts, search]);

  const handleOpenLimits = (dept: DeptBrief) => {
    try {
      window.localStorage.setItem(LAST_DEPT_KEY, JSON.stringify({ id: dept.id, name: dept.name }));
    } catch { /* ignore */ }
  };

  if (loading) return <LoadingSkeleton />;

  return (
    <div className="max-w-6xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/25">
          <Building2 size={20} className="text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-800">الأقسام</h1>
          <p className="text-sm text-gray-500 mt-0.5">{depts.length} قسم مسجل</p>
        </div>
      </div>

      {/* Continue where you left off */}
      {lastDept && (
        <Link
          href={`/hospitals/${hospitalId}/departments/${lastDept.id}/limits`}
          className="flex items-center justify-between p-4 mb-5 rounded-xl bg-blue-50 border border-blue-200/60 hover:border-blue-400/70 hover:bg-blue-50/80 transition-all duration-200 group cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
              <Layers size={15} className="text-blue-600" />
            </div>
            <div>
              <p className="text-xs text-blue-500 font-medium mb-0.5">أكمل من حيث توقفت</p>
              <p className="text-sm font-semibold text-gray-800">{lastDept.name}</p>
            </div>
          </div>
          <ArrowLeft size={18} className="text-blue-400 group-hover:-translate-x-1 transition-transform" />
        </Link>
      )}

      {/* Search */}
      <div className="relative mb-5">
        <Search size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input
          type="text"
          placeholder="ابحث عن قسم…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pr-10 pl-4 py-3 rounded-xl bg-white/80 border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/40 focus:border-blue-300 transition-all shadow-sm"
        />
        {search && (
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs text-gray-400">
            {filtered.length} نتيجة
          </span>
        )}
      </div>

      {/* Department cards grid */}
      {filtered.length === 0 ? (
        <div className="text-center py-16">
          <AlertCircle size={40} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-400 text-sm">{depts.length === 0 ? "لا توجد أقسام" : `لا توجد نتائج لـ "${search}"`}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((d, i) => {
            const items = coverageMap.get(d.id) ?? 0;
            const pct = maxCoverage > 0 ? Math.round((items / maxCoverage) * 100) : 0;
            return (
              <Link
                key={d.id}
                href={`/hospitals/${hospitalId}/departments/${d.id}/limits`}
                onClick={() => handleOpenLimits(d)}
                className="group bg-white/80 rounded-2xl p-5 shadow-sm border border-gray-100 hover:border-blue-200 hover:-translate-y-1 hover:shadow-md hover:shadow-blue-500/8 transition-all duration-200 cursor-pointer animate-fade-in"
                style={{ animationDelay: `${i * 40}ms` }}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-start gap-2.5 flex-1 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-slate-100 to-blue-50 flex items-center justify-center flex-shrink-0 group-hover:from-blue-100 group-hover:to-indigo-100 transition-colors">
                      <Building2 size={14} className="text-slate-400 group-hover:text-blue-500 transition-colors" />
                    </div>
                    <h3 className="font-semibold text-gray-800 text-sm leading-tight pt-1">{d.name}</h3>
                  </div>
                  <ArrowLeft size={15} className="text-gray-300 group-hover:text-blue-500 group-hover:-translate-x-0.5 transition-all flex-shrink-0 mt-1.5" />
                </div>
                <div className="flex items-center gap-1.5 mb-2.5">
                  <CheckCircle2 size={13} className="text-teal-500" />
                  <span className="text-xs text-gray-500">{items} بند بحد أعلى</span>
                  {items > 0 && (
                    <span className="mr-auto text-xs font-medium text-teal-600">{pct}%</span>
                  )}
                </div>
                {/* Coverage bar */}
                <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-teal-400 to-emerald-500 transition-all duration-700"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
