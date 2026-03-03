"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import LimitsUI from "@/app/_components/LimitsUI";
import { ArrowRight, AlertTriangle, ShieldAlert } from "lucide-react";
import { getApiBase } from "@/app/lib/api";

const API = getApiBase();

export default function HospitalDepartmentLimitsPage() {
  const params = useParams<{ hospitalId: string; departmentId: string }>();
  const hospitalId = params.hospitalId;
  const departmentId = Number(params.departmentId);

  const [deptName, setDeptName] = useState<string | null>(null);
  const [hospitalName, setHospitalName] = useState<string | null>(null);
  const [validated, setValidated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setValidated(false);
    setError(null);

    Promise.all([
      fetch(`${API}/api/hospitals/${hospitalId}/departments/${departmentId}`).then(async (r) => {
        if (r.status === 404) throw new Error("not_found");
        if (!r.ok) throw new Error(`تعذر التحقق من القسم (${r.status})`);
        return r.json();
      }),
      fetch(`${API}/api/hospitals`).then((r) => r.json()).catch(() => []),
    ])
      .then(([dept, hospitals]) => {
        setDeptName(dept.name);
        const h = (hospitals as { id: number; name: string }[]).find((x) => String(x.id) === hospitalId);
        if (h) setHospitalName(h.name);
        setValidated(true);
      })
      .catch((e) => {
        setError(e.message === "not_found" ? "not_found" : e.message);
        setValidated(true);
      });
  }, [hospitalId, departmentId]);

  if (!validated) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-400">جارٍ التحقق…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-lg mx-auto mt-20 animate-fade-in">
        <div className="glass rounded-2xl p-8 text-center shadow-xl shadow-black/5 border border-red-200/50">
          <ShieldAlert size={48} className="mx-auto text-red-400 mb-4" />
          {error === "not_found" ? (
            <>
              <p className="text-red-600 font-semibold text-lg mb-2">القسم غير موجود</p>
              <p className="text-gray-500 text-sm mb-6">هذا القسم لا يتبع هذا المستشفى أو غير موجود في النظام.</p>
            </>
          ) : (
            <p className="text-red-600 mb-6">{error}</p>
          )}
          <Link
            href={`/hospitals/${hospitalId}`}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 text-white text-sm font-medium shadow-lg shadow-blue-500/25 hover:shadow-xl transition-all"
          >
            <ArrowRight size={16} />
            العودة إلى لوحة المستشفى
          </Link>
        </div>
      </div>
    );
  }

  const pinVerified = typeof window !== "undefined" && sessionStorage.getItem(`nupco_pin_ok_${hospitalId}_${departmentId}`) === "1";

  const header = (
    <div className="mb-2">
      <div className="flex items-center gap-3 mb-2">
        <Link
          href={`/hospitals/${hospitalId}/departments`}
          className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 transition-colors"
        >
          <ArrowRight size={14} />
          <span>{hospitalName || "المستشفى"}</span>
        </Link>
      </div>
      <h1 className="text-xl font-bold text-gray-800">{deptName} — الحدود القصوى</h1>
      {!pinVerified && (
        <div className="mt-3 flex items-center gap-2 px-4 py-2.5 bg-amber-50/80 border border-amber-200/60 rounded-xl text-xs text-amber-700">
          <AlertTriangle size={14} className="flex-shrink-0" />
          <span>
            دخلت هذه الصفحة مباشرة. للدخول المُوثّق، استخدم{" "}
            <Link href={`/hospitals/${hospitalId}/enter`} className="underline font-semibold hover:text-amber-900">صفحة دخول القسم</Link>.
          </span>
        </div>
      )}
    </div>
  );

  return <LimitsUI lockedDeptId={departmentId} headerSlot={header} />;
}
