import { apiFetch } from "@/lib/api";
import type { CampanhaPauseWindowsResponse } from "@/types";

/**
 * Helper isolado pra buscar as JANELAS de pausa do mes de referencia de uma
 * campanha (feature pause-log: cada pausa/reativacao vira uma janela; serve pra
 * apurar o periodo ativo no mes).
 *
 * ⚠ CONTRATO PENDENTE DE CONFIRMACAO. O backend (slug `campanhas-pause-log`, job
 * do subagente `tracker`) ainda nao reportou o shape/endpoint exato em
 * outbox/tracker.md. Este helper assume o endpoint e shape PROVAVEIS abaixo —
 * quando o tracker confirmar, ajustar APENAS este arquivo (e o tipo
 * `CampanhaPauseWindowsResponse` em types/index.ts) e o resto da UI segue.
 *
 * Endpoint assumido: GET /campanhas/{id}/pause-windows
 * Response assumido: CampanhaPauseWindowsResponse
 *   { mes_referencia?, windows: [{inicio, fim|null, reason?}], dias_ativos?, dias_no_mes? }
 *
 * Tolerante a backend ausente: se o endpoint ainda nao existe (404) ou a rede
 * falha, resolve `null` (a UI simplesmente nao mostra a secao) em vez de quebrar
 * o detalhe da campanha.
 */
export async function fetchPauseWindows(
  campanhaId: string
): Promise<CampanhaPauseWindowsResponse | null> {
  try {
    const res: CampanhaPauseWindowsResponse = await apiFetch(
      `/campanhas/${campanhaId}/pause-windows`
    );
    return res ?? null;
  } catch (err: any) {
    // Backend ainda nao expoe o endpoint (404) ou falha de rede — degrada
    // silenciosamente. Erros de sessao (401) ja sao tratados no apiFetch.
    const msg = String(err?.message || "");
    if (/404|not found|failed to fetch|request failed/i.test(msg)) {
      return null;
    }
    return null;
  }
}
