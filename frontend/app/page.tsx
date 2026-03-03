"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { Hospital, LayoutGrid, CheckCircle2, XCircle, RefreshCw, Activity } from "lucide-react";
import { getApiBase, fetchWithTimeout, formatApiError } from "@/app/lib/api";

type Health = { status?: string } | null;

export default function Home() {
  const [health, setHealth] = useState<Health>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const checkHealth = useCallback(() => {
    setLoading(true);
    setError(null);
    const url = getApiBase();
    fetchWithTimeout(`${url}/health`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const contentType = res.headers.get("content-type") || "";
        if (!contentType.includes("application/json")) {
          throw new Error("استجابة غير صالحة من الخادم");
        }
        return res.json();
      })
      .then((data) => {
        setHealth(data);
        setError(null);
      })
      .catch((err) => {
        setError(formatApiError(err, "تعذر الوصول إلى واجهة البرمجة"));
        setHealth(null);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { checkHealth(); }, [checkHealth]);

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-indigo-950 relative overflow-hidden flex flex-col items-center justify-center p-4 sm:p-8">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl" />
        <div className="absolute top-1/2 -left-20 w-72 h-72 bg-teal-500/10 rounded-full blur-3xl" />
        <div className="absolute bottom-20 right-1/4 w-60 h-60 bg-violet-500/10 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-md animate-fade-in">
        {/* Logo / Title */}
        <div className="mb-8 text-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-teal-400 flex items-center justify-center shadow-xl shadow-blue-500/30 mx-auto mb-4">
            <Hospital size={32} className="text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white mb-1">نوبكو</h1>
          <p className="text-blue-300/60 text-sm">منصة إدارة الحدود القصوى للمستشفيات</p>
        </div>

        {/* API Health Card */}
        <div className="glass-dark rounded-2xl p-5 mb-6 border border-white/5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Activity size={15} className="text-blue-400" />
              <p className="text-blue-300/70 text-xs font-medium">حالة واجهة البرمجة</p>
            </div>
            {!loading && (
              <button
                onClick={checkHealth}
                className="text-blue-400/60 hover:text-blue-300 transition-colors cursor-pointer"
                aria-label="إعادة الفحص"
              >
                <RefreshCw size={14} />
              </button>
            )}
          </div>

          {loading && !health && !error && (
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
              <p className="text-blue-300/50 text-sm">جارٍ الفحص…</p>
            </div>
          )}

          {error && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <XCircle size={16} className="text-red-400 flex-shrink-0" />
                <p className="text-red-300 text-sm" data-testid="health-error">{error}</p>
              </div>
              <p className="text-blue-300/40 text-xs mb-3">
                تأكد أن Backend يعمل على {getApiBase() || "/api"}
              </p>
              <button
                onClick={checkHealth}
                className="flex items-center gap-1.5 text-xs text-blue-300 hover:text-blue-200 transition-colors cursor-pointer"
              >
                <RefreshCw size={12} /> إعادة المحاولة
              </button>
            </div>
          )}

          {health && !error && (
            <div className="flex items-center gap-2">
              <CheckCircle2 size={16} className="text-emerald-400" />
              <p className="text-emerald-300 text-sm font-medium" data-testid="health-status">
                {health.status ?? "يعمل"}
              </p>
            </div>
          )}
        </div>

        {/* Navigation Buttons */}
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link
            href="/hospitals"
            className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-blue-600 px-4 py-3 text-center text-sm font-medium text-white hover:from-blue-400 hover:to-blue-500 transition-all duration-200 shadow-lg shadow-blue-500/25 cursor-pointer"
          >
            <Hospital size={16} />
            لوحة المستشفيات
          </Link>
          <Link
            href="/hospitals/1/departments"
            className="flex-1 flex items-center justify-center gap-2 rounded-xl glass-dark border border-white/10 px-4 py-3 text-center text-sm font-medium text-blue-200 hover:bg-white/10 hover:border-white/20 transition-all duration-200 cursor-pointer"
          >
            <LayoutGrid size={16} />
            إدارة حدود الأقسام
          </Link>
        </div>
      </div>
    </main>
  );
}
