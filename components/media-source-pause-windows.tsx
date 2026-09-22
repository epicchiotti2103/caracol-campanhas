"use client";

import { useEffect, useState } from "react";
import { Pause } from "lucide-react";
import { fetchMediaSourcesStatusWindows } from "@/lib/pause-windows";
import { fmtDateDigits } from "./media-source-status-log-modal";
import type {
  MediaSourceStatusWindow,
  MediaSourcesStatusWindowsResponse
} from "@/types";

/**
 * Lista os PIDs (media sources) com pausa no mes: intervalos [inicio, fim) +
 * "X de Y dias ativos", e badge "sem data" pros pausados sem data efetiva.
 * So exibicao — nao entra em nenhum calculo.
 *
 * Recebe `data` ja carregado (detalhe da campanha) e renderiza null se vier
 * null/vazio (rota indisponivel antes da migration 077).
 */
export function MediaSourcePauseWindowsView({
  data
}: {
  data: MediaSourcesStatusWindowsResponse | null;
}) {
  const rows = data?.media_sources ?? [];
  if (rows.length === 0) return null;
  return (
    <ul className="space-y-2">
      {rows.map((r, i) => (
        <MediaSourceWindowItem
          key={`${r.publisher_nome}-${r.media_source_name}-${i}`}
          row={r}
        />
      ))}
    </ul>
  );
}

/**
 * Variante que busca sozinha (usada no modal de fechamento). Renderiza null em
 * erro ou sem PIDs pausados no mes.
 */
export function MediaSourcePauseWindowsPanel({
  campanhaId,
  month
}: {
  campanhaId: string;
  month: string; // YYYY-MM
}) {
  const [data, setData] = useState<MediaSourcesStatusWindowsResponse | null>(
    null
  );
  useEffect(() => {
    let cancelled = false;
    fetchMediaSourcesStatusWindows(campanhaId, month).then((res) => {
      if (!cancelled) setData(res);
    });
    return () => {
      cancelled = true;
    };
  }, [campanhaId, month]);

  if (!data || data.media_sources.length === 0) return null;
  return (
    <div className="rounded-lg border border-border bg-background/40 p-3">
      <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">
        PIDs com pausa no mes (informativo)
      </p>
      <MediaSourcePauseWindowsView data={data} />
    </div>
  );
}

function MediaSourceWindowItem({ row }: { row: MediaSourceStatusWindow }) {
  return (
    <li className="rounded-lg border border-border bg-background/40 px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-muted">{row.publisher_nome || "—"}</span>
        <span className="text-muted/60">/</span>
        <span className="font-mono text-xs text-foreground">
          {row.media_source_name}
        </span>
        {row.sem_data ? (
          <span className="rounded-md bg-muted/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted">
            sem data
          </span>
        ) : (
          row.dias_ativos != null && (
            <span className="ml-auto text-xs text-foreground">
              <span className="font-semibold">{row.dias_ativos}</span> de{" "}
              <span className="font-semibold">{row.dias_no_mes}</span> dias
              ativos
            </span>
          )
        )}
      </div>
      {row.pausas.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {row.pausas.map((w, j) => (
            <li
              key={`${w.inicio}-${w.fim ?? "open"}-${j}`}
              className="flex items-center gap-1.5 text-xs text-muted"
            >
              <Pause className="h-3 w-3 flex-shrink-0 text-danger" />
              Pausada de{" "}
              <span className="text-foreground">{fmtDateDigits(w.inicio)}</span>{" "}
              ate{" "}
              {w.fim ? (
                <span className="text-foreground">{fmtDateDigits(w.fim)}</span>
              ) : (
                <span className="text-danger">o fim do mes</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {row.sem_data && row.deactivated_reason && (
        <p className="mt-1 text-xs text-muted">— {row.deactivated_reason}</p>
      )}
    </li>
  );
}
