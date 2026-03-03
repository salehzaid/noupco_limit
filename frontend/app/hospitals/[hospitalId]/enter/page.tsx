"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Search, ArrowRight, ShieldCheck, Lock, Unlock, AlertCircle } from "lucide-react";
import { getApiBase } from "@/app/lib/api";

const API = getApiBase();

type DeptPin = { department_id: number; department_name: string; has_pin: boolean };

export default function DepartmentEntryPage() {
  const params = useParams<{ hospitalId: string }>();
  const router = useRouter();
  const hospitalId = params.hospitalId;

  const [depts, setDepts] = useState<DeptPin[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [selectedDept, setSelectedDept] = useState<DeptPin | null>(null);
  const [pin, setPin] = useState(["", "", "", "", "", ""]);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pinRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    fetch(`${API}/api/hospitals/${hospitalId}/departments/pins`)
      .then((r) => r.json())
      .then((d: DeptPin[]) => setDepts(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [hospitalId]);

  const filtered = useMemo(() => {
    if (!search.trim()) return depts;
    const q = search.trim().toLowerCase();
    return depts.filter((d) => d.department_name.toLowerCase().includes(q));
  }, [depts, search]);

  const handleSelect = (dept: DeptPin) => {
    setSelectedDept(dept);
    setPin(["", "", "", "", "", ""]);
    setError(null);
    if (!dept.has_pin) {
      sessionStorage.setItem(`nupco_pin_ok_${hospitalId}_${dept.department_id}`, "1");
      router.push(`/hospitals/${hospitalId}/departments/${dept.department_id}/limits`);
    } else {
      setTimeout(() => pinRefs.current[0]?.focus(), 100);
    }
  };

  const handlePinChange = (index: number, value: string) => {
    const digit = value.replace(/\D/g, "").slice(-1);
    const newPin = [...pin];
    newPin[index] = digit;
    setPin(newPin);
    setError(null);

    if (digit && index < 5) {
      pinRefs.current[index + 1]?.focus();
    }

    const fullPin = newPin.join("");
    if (fullPin.length >= 4 && newPin.every((d) => d !== "")) {
      doVerify(fullPin);
    }
  };

  const handlePinKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !pin[index] && index > 0) {
      pinRefs.current[index - 1]?.focus();
    }
  };

  const doVerify = async (fullPin: string) => {
    if (!selectedDept) return;
    setVerifying(true); setError(null);
    try {
      const res = await fetch(`${API}/api/hospitals/${hospitalId}/departments/${selectedDept.department_id}/verify-pin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: fullPin }),
      });
      if (res.ok) {
        sessionStorage.setItem(`nupco_pin_ok_${hospitalId}_${selectedDept.department_id}`, "1");
        router.push(`/hospitals/${hospitalId}/departments/${selectedDept.department_id}/limits`);
      } else {
        setError("رمز الدخول غير صحيح");
        setPin(["", "", "", "", "", ""]);
        setTimeout(() => pinRefs.current[0]?.focus(), 100);
      }
    } catch { setError("خطأ في الاتصال"); } finally { setVerifying(false); }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><p className="text-gray-400">جارٍ التحميل…</p></div>;

  return (
    <div className="mx-auto w-full max-w-lg animate-fade-in">
      {/* Header */}
      <div className="text-center mb-8">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center mx-auto mb-4 shadow-xl shadow-emerald-500/25">
          <ShieldCheck size={32} className="text-white" />
        </div>
        <h1 className="text-xl font-bold text-gray-800">دخول القسم</h1>
        <p className="text-sm text-gray-500 mt-1">اختر قسمك وأدخل رمز الدخول</p>
      </div>

      {selectedDept?.has_pin ? (
        /* PIN entry */
        <div className="glass animate-scale-in rounded-2xl p-5 text-center shadow-xl shadow-black/5 sm:p-8">
          <button onClick={() => setSelectedDept(null)} className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 mb-6 mx-auto">
            <ArrowRight size={14} /> العودة للقائمة
          </button>

          <Lock size={24} className="mx-auto text-amber-500 mb-3" />
          <h2 className="text-lg font-semibold text-gray-800 mb-1">{selectedDept.department_name}</h2>
          <p className="text-sm text-gray-500 mb-6">أدخل رمز الدخول للمتابعة</p>

          {/* OTP-style PIN boxes */}
          <div className="mb-4 flex justify-center gap-1.5 sm:gap-2" dir="ltr">
            {pin.map((digit, i) => (
              <input
                key={i}
                ref={(el) => { pinRefs.current[i] = el; }}
                type="password"
                inputMode="numeric"
                maxLength={1}
                value={digit}
                onChange={(e) => handlePinChange(i, e.target.value)}
                onKeyDown={(e) => handlePinKeyDown(i, e)}
                className={`h-12 w-10 rounded-xl border-2 text-center text-lg font-bold transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-400/40 sm:h-14 sm:w-12 sm:text-xl ${error ? "border-red-300 bg-red-50" : digit ? "border-blue-400 bg-blue-50/50" : "border-gray-300"}`}
                disabled={verifying}
              />
            ))}
          </div>

          {verifying && <p className="text-sm text-blue-500 animate-pulse">جارٍ التحقق…</p>}
          {error && (
            <div className="flex items-center justify-center gap-1.5 text-sm text-red-600 mt-2">
              <AlertCircle size={14} />
              <span>{error}</span>
            </div>
          )}
        </div>
      ) : (
        /* Department list */
        <>
          {depts.length > 5 && (
            <div className="relative mb-4">
              <Search size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="ابحث عن قسمك…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pr-10 pl-4 py-3 rounded-xl glass border border-gray-200/60 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/40"
                autoFocus
              />
            </div>
          )}

          {filtered.length === 0 ? (
            <div className="text-center py-12">
              <AlertCircle size={32} className="mx-auto text-gray-300 mb-2" />
              <p className="text-gray-400 text-sm">{depts.length === 0 ? "لا توجد أقسام" : `لا يوجد نتائج لـ "${search}"`}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((d, i) => (
                <button
                  key={d.department_id}
                  onClick={() => handleSelect(d)}
                  className="w-full flex items-center justify-between px-5 py-4 glass rounded-xl hover:-translate-y-0.5 hover:shadow-lg transition-all duration-200 cursor-pointer text-right animate-fade-in"
                  style={{ animationDelay: `${i * 30}ms` }}
                >
                  <div className="flex items-center gap-3">
                    {d.has_pin ? <Lock size={16} className="text-amber-500" /> : <Unlock size={16} className="text-gray-300" />}
                    <span className="font-medium text-gray-800">{d.department_name}</span>
                  </div>
                  <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${d.has_pin ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>
                    {d.has_pin ? "يتطلب رمز دخول" : "دون رمز"}
                  </span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
