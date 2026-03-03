"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { Hospital, MapPin, ArrowRight, RefreshCw } from "lucide-react";
import { getApiBase, fetchWithTimeout, formatApiError } from "@/app/lib/api";

type HospitalItem = { id: number; name: string; code: string | null; is_active: boolean; city?: string | null; region?: string | null };

export default function HospitalsPage() {
  const [hospitals, setHospitals] = useState<HospitalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadHospitals = useCallback(() => {
    setLoading(true);
    setError(null);
    const api = getApiBase();
    fetchWithTimeout(`${api}/api/hospitals`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => setHospitals(Array.isArray(d) ? d : []))
      .catch((e) => { setError(formatApiError(e, "تعذر تحميل البيانات")); setHospitals([]); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadHospitals(); }, [loadHospitals]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-indigo-950 relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl" />
        <div className="absolute top-1/2 -left-20 w-72 h-72 bg-teal-500/10 rounded-full blur-3xl" />
        <div className="absolute bottom-20 right-1/4 w-60 h-60 bg-violet-500/10 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-16">
        {/* Hero */}
        <div className="mb-12 animate-fade-in">
          <Link href="/" className="inline-flex items-center gap-1 text-blue-300/60 hover:text-blue-200 text-sm mb-6 transition-colors">
            <ArrowRight size={14} className="rotate-180" />
            <span>الرئيسية</span>
          </Link>
          <div className="mb-3 flex items-center gap-3 sm:gap-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500 to-teal-400 flex items-center justify-center shadow-xl shadow-blue-500/30">
              <Hospital size={28} className="text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-white">المستشفيات</h1>
              <p className="text-blue-300/60 text-sm mt-0.5">
                {loading ? "جارٍ التحميل…" : `${hospitals.length} مستشفى`}
              </p>
            </div>
          </div>
        </div>

        {/* Error state */}
        {error && (
          <div className="text-center py-12 glass-dark rounded-2xl p-6">
            <p className="text-red-300 text-sm mb-3">{error}</p>
            <button onClick={loadHospitals} className="flex items-center gap-2 mx-auto px-4 py-2 rounded-lg bg-blue-500/20 text-blue-200 text-sm hover:bg-blue-500/30 cursor-pointer transition-colors duration-200">
              <RefreshCw size={16} /> إعادة المحاولة
            </button>
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && hospitals.length === 0 && (
          <div className="text-center py-20">
            <Hospital size={48} className="mx-auto text-blue-300/30 mb-4" />
            <p className="text-blue-200/50 text-sm">لا توجد مستشفيات مسجلة.</p>
          </div>
        )}

        {!error && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {hospitals.map((h, i) => (
            <Link
              key={h.id}
              href={`/hospitals/${h.id}`}
              className="group glass-dark rounded-2xl p-6 hover:-translate-y-1 hover:shadow-2xl hover:shadow-blue-500/10 transition-all duration-300 cursor-pointer animate-fade-in"
              style={{ animationDelay: `${i * 80}ms` }}
            >
              <div className="flex items-start justify-between mb-4">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500/20 to-teal-400/20 flex items-center justify-center">
                  <Hospital size={20} className="text-blue-400" />
                </div>
                <ArrowRight size={16} className="text-white/20 group-hover:text-blue-400 group-hover:translate-x-0.5 transition-all mt-1" />
              </div>

              <h2 className="text-white font-semibold text-base mb-1">{h.name}</h2>

              {h.code && (
                <span className="inline-block px-2 py-0.5 rounded-md bg-blue-500/15 text-blue-300 text-xs font-mono mb-3">
                  {h.code}
                </span>
              )}

              {(h.city || h.region) && (
                <div className="flex items-center gap-1.5 text-blue-300/50 text-xs mt-2">
                  <MapPin size={12} />
                  <span>{[h.city, h.region].filter(Boolean).join("، ")}</span>
                </div>
              )}

              <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-between">
                <span className={`text-xs font-medium ${h.is_active ? "text-emerald-400" : "text-red-400"}`}>
                  {h.is_active ? "نشط" : "غير نشط"}
                </span>
                <span className="text-xs text-white/20 group-hover:text-blue-300/60 transition-colors">
                  فتح اللوحة
                </span>
              </div>
            </Link>
          ))}
        </div>
        )}
      </div>
    </div>
  );
}
