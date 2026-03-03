"use client";

import { useCallback, useRef, useState } from "react";
import { RefreshCw, X, Settings } from "lucide-react";
import AiSettingsModal from "@/app/_components/AiSettingsModal";
import { getApiBase } from "@/app/lib/api";

const API = getApiBase();

interface AiReportPanelProps {
  deptId: number;
  deptName: string;
  effectiveYear?: number;
}

export default function AiReportPanel({
  deptId,
  deptName,
  effectiveYear = 2025,
}: AiReportPanelProps) {
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [providerLabel, setProviderLabel] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const generate = useCallback(async () => {
    // Cancel any in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setReport("");
    setError(null);
    setLoading(true);
    setOpen(true);

    // Fetch provider label for footer
    try {
      const cfg = await fetch(`${API}/api/ai/settings`).then((r) => r.json());
      setProviderLabel(cfg.provider_labels?.[cfg.provider] ?? null);
    } catch {
      setProviderLabel(null);
    }

    try {
      const res = await fetch(
        `${API}/api/ai/department-report?department_id=${deptId}&effective_year=${effectiveYear}`,
        { signal: controller.signal }
      );

      if (!res.ok) {
        const msg = await res.text().catch(() => res.statusText);
        throw new Error(msg || `HTTP ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") break;
          try {
            const { text } = JSON.parse(payload) as { text: string };
            setReport((prev) => prev + text);
          } catch {
            // skip malformed chunks
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setError((err as Error).message || "Failed to generate report");
    } finally {
      setLoading(false);
    }
  }, [deptId, effectiveYear]);

  const close = () => {
    abortRef.current?.abort();
    setOpen(false);
    setReport("");
    setError(null);
    setLoading(false);
  };

  return (
    <>
      {/* Trigger buttons */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={generate}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-xl border border-violet-200 bg-violet-50 px-3.5 py-2 text-sm font-medium text-violet-700 transition-all hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
          title="Generate an AI summary report for this department"
        >
          {loading ? (
            <RefreshCw size={15} className="animate-spin" />
          ) : (
            <span className="text-base leading-none">✨</span>
          )}
          {loading ? "جارٍ التوليد…" : "تقرير ذكي"}
        </button>
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="flex items-center justify-center rounded-xl border border-violet-200 bg-violet-50 p-2 text-violet-500 hover:bg-violet-100 hover:text-violet-700 transition-all cursor-pointer"
          title="إعدادات الذكاء الاصطناعي"
        >
          <Settings size={15} />
        </button>
      </div>

      {/* Settings modal */}
      {settingsOpen && (
        <AiSettingsModal onClose={() => setSettingsOpen(false)} />
      )}

      {/* Report modal */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={close}
        >
          <div
            className="flex w-full max-w-2xl flex-col rounded-2xl bg-white shadow-2xl"
            style={{ maxHeight: "85vh" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between rounded-t-2xl bg-gradient-to-r from-violet-700 to-indigo-700 px-5 py-4">
              <div>
                <p className="text-xs font-medium text-violet-200 mb-0.5">
                  AI Supply Report · Claude Opus
                </p>
                <h2 className="text-base font-bold text-white">{deptName}</h2>
              </div>
              <div className="flex items-center gap-2">
                {!loading && report && (
                  <button
                    type="button"
                    onClick={generate}
                    className="flex items-center gap-1 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-xs text-white hover:bg-white/20 cursor-pointer transition-colors"
                  >
                    <RefreshCw size={12} /> Regenerate
                  </button>
                )}
                <button
                  type="button"
                  onClick={close}
                  className="rounded-lg border border-white/20 bg-white/10 p-1.5 text-white hover:bg-white/20 cursor-pointer transition-colors"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-5">
              {error && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
                  <p className="font-semibold mb-1">Error</p>
                  <p>{error}</p>
                </div>
              )}

              {!error && !report && loading && (
                <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                  <RefreshCw size={28} className="animate-spin mb-3 text-violet-400" />
                  <p className="text-sm">Analyzing department data…</p>
                </div>
              )}

              {report && (
                <div className="prose prose-sm max-w-none text-gray-700 leading-relaxed whitespace-pre-wrap">
                  {report}
                  {loading && (
                    <span className="inline-block w-2 h-4 bg-violet-500 animate-pulse ml-0.5 rounded-sm" />
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            {report && !loading && (
              <div className="border-t border-gray-100 px-5 py-3 text-right">
                <p className="text-xs text-gray-400">
                  Generated by {providerLabel ?? "AI"} · {effectiveYear} data
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
