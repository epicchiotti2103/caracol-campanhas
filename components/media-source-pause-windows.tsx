"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Pause } from "lucide-react";
import { fetchMediaSourcesStatusWindows } from "@/lib/pause-windows";
import { fmtDateDigits } from "./media-source-status-log-modal";
import {
  PausaPidContadores,
  PausaPidStatusChip,
  pausaPidKey
} from "./pausa-pid-fechamento";
import type {
  MediaSourceStatusWindow,
  MediaSourcesStatusWindowsResponse,
  PausaPidItem
} from "@/types";

/**
 * Lista os PIDs (media sources) com pausa no mes: intervalos [inicio, fim) +
 * "X de Y dias ativos", e badge "sem data" pros pausados sem data efetiva.
 * As janelas em si sao so exibicao. Com `pausasPid` (fechamento aberto), cada
 * PID ganha o status do desconto que o backend aplicou no valor SUGERIDO.
 *
 * Recebe `data` ja carregado (detalhe da campanha) e renderiza null se vier
 * null/vazio (rota indisponivel antes da migration 077).
 */
export function MediaSourcePauseWindowsView({
  data,
  pausasPid
}: {
  data: MediaSourcesStatusWindowsResponse | null;
  /** Status do desconto no fechamento (so fechamento aberto). Opcional. */
  pausasPid?: PausaPidItem[] | null;
}) {
  const rows = data?.media_sources ?? [];
  const pidByKey = new Map<string, PausaPidItem>();
  for (const p of pausasPid || []) {
    pidByKey.set(pausaPidKey(p.publisher_cadastro, p.media_source), p);
  }
  const usados = new Set<string>();
  const itens = rows.map((r) => {
    const k = pausaPidKey(r.publisher_nome, r.media_source_name);
    const pid = pidByKey.get(k);
    if (pid) usados.add(k);
    return { r, pid };
  });
  // PIDs do fechamento sem janela correspondente (rota de janelas falhou ou
  // divergiu): viram linha propria, montada com as pausas do proprio item.
  const orfaos = (pausasPid || []).filter(
    (p) => !usados.has(pausaPidKey(p.publisher_cadastro, p.media_source))
  );
  if (itens.length === 0 && orfaos.length === 0) return null;
  return (
    <ul className="space-y-2">
      {itens.map(({ r, pid }, i) => (
        <MediaSourceWindowItem
          key={`${r.publisher_nome}-${r.media_source_name}-${i}`}
          row={r}
          pid={pid}
        />
      ))}
      {orfaos.map((p, i) => (
        <MediaSourceWindowItem
          key={`orfao-${p.publisher_cadastro}-${p.media_source}-${i}`}
          row={{
            media_source_id: null,
            publisher_nome: p.publisher_cadastro || "",
            media_source_name: p.media_source,
            active: null,
            deactivated_reason: null,
            sem_data: false,
            fonte: "log",
            dias_ativos: null,
            dias_no_mes: 0,
            pausas: p.pausas || []
          }}
          pid={p}
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
  month,
  pausasPid
}: {
  campanhaId: string;
  month: string; // YYYY-MM
  /** `pausas_pid` do fechamento aberto (status do desconto). Opcional. */
  pausasPid?: PausaPidItem[] | null;
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

  // Comeca colapsado: no modal de fechamento e so consulta (fica no fim).
  const [open, setOpen] = useState(false);

  const temPausasPid = (pausasPid?.length ?? 0) > 0;
  if ((!data || data.media_sources.length === 0) && !temPausasPid) return null;
  // Contagem do cabecalho = PIDs distintos entre janelas + itens do fechamento.
  const keys = new Set<string>();
  for (const r of data?.media_sources ?? []) {
    keys.add(pausaPidKey(r.publisher_nome, r.media_source_name));
  }
  for (const p of pausasPid || []) {
    keys.add(pausaPidKey(p.publisher_cadastro, p.media_source));
  }
  return (
    <div className="rounded-lg border border-border bg-background/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-left"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-muted" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-muted" />
        )}
        <span className="text-xs font-semibold uppercase tracking-wider text-muted">
          {temPausasPid
            ? "PIDs com pausa no mes"
            : "PIDs com pausa no mes (informativo)"}
        </span>
        <span className="text-[11px] text-muted/70">({keys.size})</span>
        {temPausasPid && (
          <span className="ml-auto">
            <PausaPidContadores pids={pausasPid || []} />
          </span>
        )}
      </button>
      {open && (
        <div className="border-t border-border p-3">
          {temPausasPid && (
            <p className="mb-2 text-[11px] text-muted">
              O valor sugerido desconta os eventos dos dias pausados quando o
              robo manda o dado diario do PID. O valor digitado nao muda sozinho.
            </p>
          )}
          <MediaSourcePauseWindowsView data={data} pausasPid={pausasPid} />
        </div>
      )}
    </div>
  );
}

function MediaSourceWindowItem({
  row,
  pid
}: {
  row: MediaSourceStatusWindow;
  pid?: PausaPidItem;
}) {
  return (
    <li className="rounded-lg border border-border bg-background/40 px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-muted">{row.publisher_nome || "—"}</span>
        <span className="text-muted/60">/</span>
        <span className="font-mono text-xs text-foreground">
          {row.media_source_name}
        </span>
        {pid && <PausaPidStatusChip pid={pid} />}
        {pid?.publisher_robo &&
          pid.publisher_robo.toLowerCase() !==
            (pid.publisher_cadastro || "").toLowerCase() && (
            <span className="text-xs text-muted/80">
              robo: {pid.publisher_robo}
            </span>
          )}
        {row.sem_data ? (
          <span className="rounded-md bg-muted/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted">
            sem data
          </span>
        ) : (
          row.dias_ativos != null &&
          row.dias_no_mes > 0 && (
            <span className="ml-auto text-xs text-foreground">
              <span className="font-semibold">{row.dias_ativos}</span> de{" "}
              <span className="font-semibold">{row.dias_no_mes}</span> dias
              ativos
            </span>
          )
        )}
        {pid && !row.sem_data && row.dias_ativos == null && (
          <span className="ml-auto text-xs text-foreground">
            <span className="font-semibold">{pid.dias_pausados}</span> dias
            pausados
          </span>
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
