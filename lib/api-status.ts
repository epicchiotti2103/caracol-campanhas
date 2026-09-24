import Cookies from "js-cookie";
import { apiFetch } from "@/lib/api";
import { API_BASE_URL } from "@/lib/config";

/**
 * Variante do `apiFetch` que preserva o status HTTP e o `detail` cru do erro.
 *
 * `lib/api.ts` e replicado nos 5 apps e nao pode mudar; ele joga
 * `new Error(detail)`, o que perde o status (404 "em implantacao") e vira
 * "[object Object]" quando o backend devolve `detail` estruturado (409 com
 * lista de conflitos). Aqui: fetch direto com o mesmo Bearer; 401 delega pro
 * `apiFetch` (que faz refresh + retry + logout) — nada de auth reimplementado.
 */
export class ApiError extends Error {
  status: number;
  detail: unknown;
  constructor(status: number, detail: unknown, message: string) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

export async function apiFetchStatus<T = any>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = Cookies.get("auth_token");
  const headers = new Headers(options.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (!(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(`${API_BASE_URL}${endpoint}`, { ...options, headers });
  if (res.status === 401) return apiFetch(endpoint, options);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const detail = body?.detail ?? body?.message ?? null;
    throw new ApiError(res.status, detail, describeDetail(detail) || `Erro ${res.status}`);
  }
  if (res.status === 204) return null as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

/**
 * Rota ainda nao publicada no backend: FastAPI devolve 404 com o detail padrao
 * "Not Found" (ou 405 quando o path existe com outro metodo). 404 com detail
 * proprio (ex.: "Publisher nao encontrado") e erro de verdade.
 */
export function isEmImplantacao(e: unknown): boolean {
  if (e instanceof ApiError) {
    if (e.status === 405) return true;
    if (e.status !== 404) return false;
    return e.detail == null || (typeof e.detail === "string" && /^not found$/i.test(e.detail.trim()));
  }
  return e instanceof Error && /^not found$/i.test(e.message.trim());
}

/** Transforma um `detail` qualquer (string, lista, objeto) em texto legivel. */
export function describeDetail(detail: unknown): string {
  if (detail == null) return "";
  if (typeof detail === "string") return detail;
  if (typeof detail === "number" || typeof detail === "boolean") return String(detail);
  if (Array.isArray(detail)) {
    return detail.map((d) => describeItem(d)).filter(Boolean).join("; ");
  }
  if (typeof detail === "object") {
    const o = detail as Record<string, unknown>;
    const msg =
      typeof o.message === "string"
        ? o.message
        : typeof o.detail === "string"
          ? o.detail
          : typeof o.msg === "string"
            ? o.msg
            : "";
    const lista = Object.entries(o).find(
      ([k, v]) => Array.isArray(v) && !["loc"].includes(k)
    )?.[1] as unknown[] | undefined;
    const itens = lista ? lista.map((d) => describeItem(d)).filter(Boolean).join("; ") : "";
    if (msg && itens) return `${msg}: ${itens}`;
    return msg || itens || JSON.stringify(detail);
  }
  return String(detail);
}

function describeItem(d: unknown): string {
  if (d == null) return "";
  if (typeof d !== "object") return String(d);
  const o = d as Record<string, unknown>;
  // Erro de validacao do FastAPI (422): {loc, msg}
  if (typeof o.msg === "string") return o.msg;
  const pid = o.media_source ?? o.name ?? o.pid ?? o.nome;
  const pub = o.publisher_nome ?? o.publisher ?? o.publisher_name;
  if (pid && pub) return `${pid} (ja em ${pub})`;
  if (pid) return String(pid);
  return JSON.stringify(d);
}
