"use client";

import { useCallback, useEffect, useState } from "react";
import { X, Eye, EyeOff, RefreshCw, Check, KeyRound } from "lucide-react";
import { getApiBase } from "@/app/lib/api";

const API = getApiBase();
const ADMIN_KEY_STORAGE_KEY = "nupco_admin_key";

interface Settings {
  provider: string;
  model: string;
  masked_keys: Record<string, string>;
  has_key: Record<string, boolean>;
  provider_models: Record<string, string[]>;
  provider_labels: Record<string, string>;
}

interface AiSettingsModalProps {
  onClose: () => void;
}

const PROVIDER_ICONS: Record<string, string> = {
  anthropic: "🟠",
  openai: "🟢",
  gemini: "🔵",
};

export default function AiSettingsModal({ onClose }: AiSettingsModalProps) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [provider, setProvider] = useState("anthropic");
  const [model, setModel] = useState("claude-opus-4-6");
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({
    anthropic: "", openai: "", gemini: "",
  });
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});
  const [adminKey, setAdminKey] = useState(() =>
    typeof window !== "undefined" ? window.localStorage.getItem(ADMIN_KEY_STORAGE_KEY) || "" : ""
  );

  // Persist admin key to localStorage
  useEffect(() => {
    if (typeof window !== "undefined") {
      if (adminKey) window.localStorage.setItem(ADMIN_KEY_STORAGE_KEY, adminKey);
    }
  }, [adminKey]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/api/ai/settings`);
      if (!res.ok) throw new Error(await res.text());
      const data: Settings = await res.json();
      setSettings(data);
      setProvider(data.provider);
      setModel(data.model);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Reset model when provider changes
  useEffect(() => {
    if (settings) {
      const models = settings.provider_models[provider] ?? [];
      if (!models.includes(model)) setModel(models[0] ?? "");
    }
  }, [provider, settings, model]);

  const save = async () => {
    if (!adminKey.trim()) {
      setError("مفتاح المسؤول مطلوب لحفظ الإعدادات");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API}/api/ai/settings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Admin-Key": adminKey,
        },
        body: JSON.stringify({ provider, model, api_keys: apiKeys }),
      });
      if (!res.ok) {
        const msg = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(msg.detail ?? res.statusText);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const models = settings?.provider_models[provider] ?? [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between rounded-t-2xl bg-gradient-to-r from-slate-800 to-slate-700 px-5 py-4">
          <div>
            <p className="text-xs text-slate-400 mb-0.5">إعدادات الذكاء الاصطناعي</p>
            <h2 className="text-base font-bold text-white">مزود الذكاء الاصطناعي والموديل</h2>
          </div>
          <button onClick={onClose} className="rounded-lg border border-white/20 bg-white/10 p-1.5 text-white hover:bg-white/20 cursor-pointer">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-5">
          {loading && (
            <div className="flex items-center justify-center py-8 text-gray-400">
              <RefreshCw size={20} className="animate-spin mr-2" /> جارٍ التحميل…
            </div>
          )}

          {!loading && (
            <>
              {/* Provider */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-2">مزود الذكاء الاصطناعي</label>
                <div className="grid grid-cols-3 gap-2">
                  {Object.entries(settings?.provider_labels ?? {}).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setProvider(key)}
                      className={`flex flex-col items-center gap-1.5 rounded-xl border-2 px-3 py-3 text-xs font-medium transition-all cursor-pointer ${
                        provider === key
                          ? "border-blue-500 bg-blue-50 text-blue-700"
                          : "border-gray-200 bg-gray-50 text-gray-500 hover:border-gray-300"
                      }`}
                    >
                      <span className="text-xl">{PROVIDER_ICONS[key]}</span>
                      <span className="text-center leading-tight">{label}</span>
                      {settings?.has_key[key] && (
                        <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-600">
                          ✓ مُفعَّل
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Model */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-2">الموديل</label>
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-400/40 cursor-pointer"
                >
                  {models.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>

              {/* API Keys */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-2">
                  مفاتيح API
                  <span className="font-normal text-gray-400 mr-1">(اتركه فارغاً للإبقاء على المفتاح الحالي)</span>
                </label>
                <div className="space-y-2">
                  {Object.entries(settings?.provider_labels ?? {}).map(([key, label]) => (
                    <div key={key} className="flex items-center gap-2">
                      <span className="w-6 text-base flex-shrink-0">{PROVIDER_ICONS[key]}</span>
                      <div className="relative flex-1">
                        <input
                          type={showKey[key] ? "text" : "password"}
                          placeholder={
                            settings?.has_key[key]
                              ? `${settings.masked_keys[key]} (اتركه لعدم التغيير)`
                              : `${label} API Key`
                          }
                          value={apiKeys[key] ?? ""}
                          onChange={(e) => setApiKeys((prev) => ({ ...prev, [key]: e.target.value }))}
                          className="w-full rounded-xl border border-gray-200 bg-gray-50 pr-10 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/40"
                        />
                        <button
                          type="button"
                          onClick={() => setShowKey((prev) => ({ ...prev, [key]: !prev[key] }))}
                          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 cursor-pointer"
                        >
                          {showKey[key] ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Admin key */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-2">مفتاح المسؤول</label>
                <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
                  <KeyRound size={14} className="text-gray-400 flex-shrink-0" />
                  <input
                    type="password"
                    placeholder="أدخل مفتاح المسؤول للحفظ"
                    value={adminKey}
                    onChange={(e) => setAdminKey(e.target.value)}
                    className="flex-1 bg-transparent text-sm text-gray-700 placeholder:text-gray-400 focus:outline-none"
                  />
                </div>
              </div>

              {/* Error */}
              {error && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">
                  {error}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {!loading && (
          <div className="border-t border-gray-100 px-5 py-4 flex items-center justify-between">
            <p className="text-xs text-gray-400">
              الإعدادات محفوظة على الخادم فقط
            </p>
            <button
              type="button"
              onClick={save}
              disabled={saving || !adminKey.trim()}
              className="flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40 cursor-pointer transition-colors"
            >
              {saving ? <RefreshCw size={14} className="animate-spin" /> : saved ? <Check size={14} /> : null}
              {saving ? "جارٍ الحفظ…" : saved ? "تم الحفظ ✓" : "حفظ الإعدادات"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
