import Cookies from "js-cookie";
import { API_BASE_URL } from "@/lib/config";

const ROOT_DOMAIN = ".aeobr.com.br";

function cookieOpts() {
  const isCrossSubdomain =
    typeof window !== "undefined" && window.location.hostname.endsWith(ROOT_DOMAIN);
  return isCrossSubdomain
    ? { expires: 7, domain: ROOT_DOMAIN, secure: true, sameSite: "lax" as const }
    : { expires: 7 };
}

function removeOpts() {
  const opts = cookieOpts();
  return "domain" in opts ? { domain: opts.domain } : undefined;
}

function clearAuth() {
  const opts = removeOpts();
  Cookies.remove("auth_token", opts);
  Cookies.remove("refresh_token", opts);
  Cookies.remove("user_data", opts);
}

let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const refreshToken = Cookies.get("refresh_token");
    if (!refreshToken) return null;

    try {
      const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken })
      });

      if (!res.ok) return null;

      const data = await res.json();
      const opts = cookieOpts();
      Cookies.set("auth_token", data.access_token, opts);
      Cookies.set("refresh_token", data.refresh_token, opts);
      if (data.user) {
        Cookies.set("user_data", JSON.stringify(data.user), opts);
      }
      return data.access_token as string;
    } catch {
      return null;
    }
  })();

  refreshPromise.finally(() => {
    refreshPromise = null;
  });

  return refreshPromise;
}

export async function apiFetch(
  endpoint: string,
  options: RequestInit = {},
  _isRetry = false
): Promise<any> {
  const token = Cookies.get("auth_token");

  const headers = new Headers(options.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (!(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, { ...options, headers });

  if (response.status === 401) {
    if (!_isRetry) {
      const newToken = await refreshAccessToken();
      if (newToken) {
        return apiFetch(endpoint, options, true);
      }
    }
    clearAuth();
    if (typeof window !== "undefined") {
      window.location.href = "/login";
    }
    throw new Error("Sessao expirada");
  }

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || errorData.message || "Request failed");
  }

  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
