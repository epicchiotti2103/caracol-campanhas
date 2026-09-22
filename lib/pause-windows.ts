import { apiFetch } from "@/lib/api";
import type {
  CampanhaStatusWindowsResponse,
  MediaSourceStatusLogResponse,
  MediaSourcesStatusWindowsResponse
} from "@/types";

/**
 * Deriva o param `month=YYYY-MM` a partir do mes de referencia da campanha
 * (ISO `YYYY-MM-01` ou `YYYY-MM`). Retorna null se nao der pra extrair.
 */
function toMonthParam(mesReferencia: string | null | undefined): string | null {
  if (!mesReferencia) return null;
  const m = /^(\d{4})-(\d{2})/.exec(mesReferencia);
  return m ? `${m[1]}-${m[2]}` : null;
}

/**
 * Busca as JANELAS de pausa do mes de uma campanha (status-windows) — serve pra
 * apurar o periodo ativo no mes. Cada janela e [inicio, fim): o dia da
 * reativacao (fim) JA conta como ativo; fim=null => segue pausada no fim do mes.
 * O endpoint NAO retorna motivo.
 *
 * Endpoint: GET /campanhas/{id}/status-windows?month=YYYY-MM
 * Response: { dias_ativos, dias_no_mes, pausas: [{ inicio, fim|null }] }
 * (o mesmo objeto vem no campo `status_windows` do GET do fechamento.)
 *
 * Tolerante a backend ausente / mes sem dados: se o endpoint falha (404/rede) ou
 * o mes nao da pra derivar, resolve `null` (a UI degrada — secao omitida) em vez
 * de quebrar o detalhe da campanha.
 */
export async function fetchStatusWindows(
  campanhaId: string,
  mesReferencia: string | null | undefined
): Promise<CampanhaStatusWindowsResponse | null> {
  const month = toMonthParam(mesReferencia);
  const qs = month ? `?month=${month}` : "";
  try {
    const res: CampanhaStatusWindowsResponse = await apiFetch(
      `/campanhas/${campanhaId}/status-windows${qs}`
    );
    return res ?? null;
  } catch {
    // 404 / falha de rede — degrada silenciosamente. Erros de sessao (401) ja
    // sao tratados no apiFetch.
    return null;
  }
}

/**
 * Janelas de pausa POR MEDIA SOURCE (PID) no mes, so as que tiveram pausa no
 * mes ou estao pausadas sem data (`only_paused=true`). Log da migration 077.
 *
 * Endpoint: GET /campanhas/{id}/media-sources/status-windows?month=YYYY-MM&only_paused=true
 *
 * Tolerante: qualquer falha (500 antes da migration 077, 404, rede) resolve
 * `null` e a UI esconde a secao.
 */
export async function fetchMediaSourcesStatusWindows(
  campanhaId: string,
  mesReferencia: string | null | undefined
): Promise<MediaSourcesStatusWindowsResponse | null> {
  const month = toMonthParam(mesReferencia);
  if (!month) return null;
  try {
    const res: MediaSourcesStatusWindowsResponse = await apiFetch(
      `/campanhas/${campanhaId}/media-sources/status-windows?month=${month}&only_paused=true`
    );
    return res && Array.isArray(res.media_sources) ? res : null;
  } catch {
    return null;
  }
}

/**
 * Historico de pausa/reativacao de uma media source. `allMonths` inclui os
 * clones mensais da mesma campanha (mesmo publisher + PID). Falha => null.
 *
 * Endpoint: GET /campanhas/publishers/media-sources/{ms_id}/status-log[?all_months=true]
 */
export async function fetchMediaSourceStatusLog(
  msId: string,
  allMonths: boolean
): Promise<MediaSourceStatusLogResponse | null> {
  try {
    const res: MediaSourceStatusLogResponse = await apiFetch(
      `/campanhas/publishers/media-sources/${msId}/status-log${
        allMonths ? "?all_months=true" : ""
      }`
    );
    return res && Array.isArray(res.log) ? res : null;
  } catch {
    return null;
  }
}
