const LOCAL_API_BASE = "http://127.0.0.1:8011";
const FETCH_TIMEOUT_MS = 10000;

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

export async function fetchWithTimeout(
  url: string,
  options?: RequestInit
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return res;
  } finally {
    clearTimeout(timeout);
  }
}
