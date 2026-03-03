const LOCAL_API_BASE = "http://127.0.0.1:8011";
const FETCH_TIMEOUT_MS = 25000;

type FetchWithTimeoutOptions = RequestInit & { timeoutMs?: number };

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

export function getApiBase() {
  const configured = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (configured) return trimTrailingSlash(configured);

  if (typeof window !== "undefined" && isLocalHost(window.location.hostname)) {
    return LOCAL_API_BASE;
  }

  if (process.env.NODE_ENV === "development") {
    return LOCAL_API_BASE;
  }

  return "";
}

function isAbortError(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof DOMException) return error.name === "AbortError";
  if (error instanceof Error) {
    return error.name === "AbortError" || error.message.toLowerCase().includes("aborted");
  }
  return false;
}

export function formatApiError(error: unknown, fallback = "تعذر الوصول إلى واجهة البرمجة"): string {
  if (!error) return fallback;
  if (typeof error === "string") return error;

  if (error instanceof Error) {
    const message = error.message?.trim();
    if (!message) return fallback;

    if (isAbortError(error)) {
      return "انتهت مهلة الاتصال بالخادم. يرجى إعادة المحاولة.";
    }

    if (message === "Failed to fetch") {
      return "تعذر الاتصال بالخادم. تحقق من الشبكة ثم حاول مرة أخرى.";
    }

    if (/^HTTP \d{3}$/.test(message)) {
      const status = Number(message.slice(5));
      if (status === 404) return "الخدمة غير متاحة (404).";
      if (status >= 500) return "الخادم غير متاح حاليا. حاول بعد قليل.";
    }

    if (message.includes("Unexpected token") && message.includes("<!DOCTYPE")) {
      return "استجابة الخادم غير صالحة (ليست JSON).";
    }

    return message;
  }

  return fallback;
}

export async function fetchWithTimeout(
  url: string,
  options?: FetchWithTimeoutOptions
): Promise<Response> {
  const { timeoutMs = FETCH_TIMEOUT_MS, ...requestOptions } = options ?? {};
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...requestOptions,
      signal: controller.signal,
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error("انتهت مهلة الاتصال بالخادم. يرجى إعادة المحاولة.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
