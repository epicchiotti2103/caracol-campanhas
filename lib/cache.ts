"use client";

import { apiFetch } from "@/lib/api";

/**
 * Camada de cache/dedupe LOCAL do Campanhas por cima do `apiFetch`.
 *
 * Motivacao (perf): o boot da listagem dispara `GET /hub/me/apps` (no gate),
 * `GET /campanhas?months_available=1` e `GET /campanhas?month=...` em cascata.
 * Varios desses se repetem a cada navegacao/refresh sem necessidade.
 *
 * IMPORTANTE: `lib/api.ts` (`apiFetch`) e replicado nos 5 apps da suite — NAO
 * pode ser editado aqui. Por isso este cache vive num arquivo proprio do
 * Campanhas e apenas envolve o `apiFetch`.
 *
 * - Dedupe in-flight: requests GET identicas disparadas em paralelo compartilham
 *   a mesma Promise (evita N chamadas simultaneas pro mesmo endpoint).
 * - Cache por sessao com TTL: respostas ficam guardadas em memoria de modulo
 *   por `ttlMs` (default 60s). `months_available` muda pouco, entao ganha TTL
 *   maior por padrao.
 *
 * O cache vive na memoria do modulo (some no reload da pagina), o que e
 * suficiente: o objetivo e cortar chamadas repetidas dentro da mesma sessao de
 * navegacao SPA.
 */

type CacheEntry = {
  expiresAt: number;
  value: any;
};

const cacheStore = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<any>>();

const DEFAULT_TTL_MS = 60_000;

export type CachedFetchOptions = {
  /** TTL do cache em ms. Default 60s. Passe 0 pra so dedupar (sem cachear). */
  ttlMs?: number;
  /** Ignora o cache e refaz a chamada (revalida). Mantem o dedupe in-flight. */
  force?: boolean;
};

/**
 * GET cacheado + deduplicado. Use so pra leituras idempotentes.
 * Para mutacoes (POST/PATCH/DELETE) continue usando `apiFetch` direto.
 */
export async function cachedFetch<T = any>(
  endpoint: string,
  opts: CachedFetchOptions = {}
): Promise<T> {
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const key = endpoint;

  if (!opts.force) {
    const hit = cacheStore.get(key);
    if (hit && hit.expiresAt > Date.now()) {
      return hit.value as T;
    }
  }

  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;

  const promise = (async () => {
    const value = await apiFetch(endpoint);
    if (ttlMs > 0) {
      cacheStore.set(key, { value, expiresAt: Date.now() + ttlMs });
    }
    return value;
  })();

  inflight.set(key, promise);
  try {
    return (await promise) as T;
  } finally {
    inflight.delete(key);
  }
}

/** Invalida uma entrada (ou tudo, se sem argumento) — usar apos mutacoes. */
export function invalidateCache(endpoint?: string) {
  if (endpoint) {
    cacheStore.delete(endpoint);
  } else {
    cacheStore.clear();
  }
}

/** TTL sugerido pra `months_available` (muda raramente). */
export const MONTHS_AVAILABLE_TTL_MS = 10 * 60_000;
