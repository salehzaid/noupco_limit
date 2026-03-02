const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8011";
const FETCH_TIMEOUT_MS = 10000;

export function getApiBase() {
  return API_BASE;
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
