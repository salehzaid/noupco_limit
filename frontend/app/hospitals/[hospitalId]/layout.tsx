"use client";

import Link from "next/link";
import { usePathname, useParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  Building2,
  BarChart3,
  ShieldCheck,
  DoorOpen,
  ChevronRight,
  Menu,
  X,
  Hospital,
} from "lucide-react";

import { getApiBase, fetchWithTimeout } from "@/app/lib/api";

type HospitalInfo = { id: number; name: string; code: string | null };

const NAV_ITEMS = (id: string) => [
  { href: `/hospitals/${id}`, label: "نظرة عامة", icon: LayoutDashboard, exact: true },
  { href: `/hospitals/${id}/departments`, label: "الأقسام", icon: Building2 },
  { href: `/hospitals/${id}/analytics`, label: "التحليلات", icon: BarChart3 },
  { href: `/hospitals/${id}/admin`, label: "الإدارة", icon: ShieldCheck },
  { href: `/hospitals/${id}/enter`, label: "دخول قسم", icon: DoorOpen },
];

export default function HospitalLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ hospitalId: string }>();
  const pathname = usePathname();
  const hospitalId = params.hospitalId;

  const [hospital, setHospital] = useState<HospitalInfo | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    const api = getApiBase();
    fetchWithTimeout(`${api}/api/hospitals/${hospitalId}/dashboard`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.hospital) setHospital(d.hospital); })
      .catch(() => {});
  }, [hospitalId]);

  const navItems = NAV_ITEMS(hospitalId);

  const isActive = (href: string, exact?: boolean) => {
    if (exact) return pathname === href;
    return pathname.startsWith(href);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/40 to-indigo-50/30 flex items-start">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed top-0 right-0 z-50 h-screen w-64 flex flex-col
          bg-gradient-to-b from-slate-900 via-blue-950 to-indigo-950
          transition-transform duration-300 ease-in-out
          lg:translate-x-0 lg:sticky lg:top-0 lg:z-auto
          sidebar-scroll overflow-y-auto
          ${sidebarOpen ? "translate-x-0" : "translate-x-full"}
        `}
      >
        {/* Sidebar header */}
        <div className="px-5 pt-6 pb-4 border-b border-white/10">
          <Link href="/hospitals" className="flex items-center gap-2 text-blue-300/70 hover:text-blue-200 text-xs mb-3 transition-colors">
            <ChevronRight size={14} />
            <span>كل المستشفيات</span>
          </Link>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-teal-400 flex items-center justify-center flex-shrink-0">
              <Hospital size={20} className="text-white" />
            </div>
            <div className="min-w-0">
              <p className="text-white font-semibold text-sm truncate">
                {hospital?.name || "..."}
              </p>
              {hospital?.code && (
                <span className="text-blue-300/60 text-xs">{hospital.code}</span>
              )}
            </div>
          </div>
          {/* Close button (mobile) */}
          <button
            onClick={() => setSidebarOpen(false)}
            className="absolute top-4 left-4 text-white/50 hover:text-white lg:hidden"
          >
            <X size={20} />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map((item) => {
            const active = isActive(item.href, item.exact);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setSidebarOpen(false)}
                className={`
                  flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium
                  transition-all duration-200 cursor-pointer
                  ${active
                    ? "bg-white/10 text-white border-r-2 border-blue-400 shadow-lg shadow-blue-500/10"
                    : "text-blue-200/70 hover:text-white hover:bg-white/5 border-r-2 border-transparent"
                  }
                `}
              >
                <item.icon size={18} className={active ? "text-blue-400" : ""} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Sidebar footer */}
        <div className="px-5 py-4 border-t border-white/10">
          <p className="text-blue-300/40 text-[10px] tracking-wide uppercase">NUPCO Limit v1.0</p>
        </div>
      </aside>

      {/* Main content area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top bar (mobile) */}
        <header className="lg:hidden sticky top-0 z-30 bg-white/80 backdrop-blur-lg border-b border-gray-200/60 px-4 py-3 flex items-center gap-3">
          <button onClick={() => setSidebarOpen(true)} className="text-gray-600 hover:text-gray-900 cursor-pointer">
            <Menu size={22} />
          </button>
          <h1 className="text-sm font-semibold text-gray-800 truncate">
            {hospital?.name || "لوحة المستشفى"}
          </h1>
        </header>

        {/* Page content */}
        <main className="flex-1 p-4 lg:p-8 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
