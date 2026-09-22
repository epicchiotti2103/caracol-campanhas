"use client";

import { useEffect, useState } from "react";
import { Loader2, Pause, Play, X } from "lucide-react";
import { fetchMediaSourceStatusLog } from "@/lib/pause-windows";
import { formatMesAnoShort } from "@/lib/format";
import type { MediaSourceStatusLogResponse } from "@/types";

/**
 * Historico de pausa/reativacao de UMA media source (PID), lido de
 * GET /campanhas/publishers/media-sources/{ms_id}/status-log.
 * Toggle "todos os meses" => all_months=true (inclui os clones mensais).
 *
 * So exibicao. Se a rota falhar (ex.: migration 077 ainda nao rodou) mostra
 * "Historico indisponivel" — nunca quebra a tela.
 */
export function MediaSourceStatusLogModal({
  msId,
  name,
  onClose
}: {
  msId: string;
  name: string;
  onClose: () => void;
}) {
  const [allMonths, setAllMonths] = useState(false);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<MediaSourceStatusLogResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchMediaSourceStatusLog(msId, allMonths).then((res) => {
      if (cancelled) return;
      setData(res);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [msId, allMonths]);

  const log = data?.log ?? [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-border bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-foreground">
              Historico de pausa
            </h3>
            <p className="truncate text-sm text-muted">
              {data?.publisher_nome ? `${data.publisher_nome} / ` : ""}
              <span className="font-mono text-foreground">{name}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted transition-colors hover:text-foreground"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center justify-between gap-3 px-5 pt-3">
          <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={allMonths}
              onChange={(e) => setAllMonths(e.target.checked)}
              className="h-3.5 w-3.5 accent-primary"
            />
            Todos os meses
          </label>
          {data && (
            <span className="text-xs text-muted">
              Estado atual:{" "}
              {data.active ? (
                <span className="font-semibold text-primary">ativa</span>
              ) : (
                <span className="font-semibold text-danger">pausada</span>
              )}
            </span>
          )}
        </div>

        <div className="overflow-auto px-5 py-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
            </div>
          ) : !data ? (
            <p className="text-sm text-muted">Historico indisponivel.</p>
          ) : log.length === 0 ? (
            <p className="text-sm text-muted">
              Nenhuma pausa ou reativacao registrada
              {allMonths ? "." : " neste mes."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted">
                    <th className="py-2 pr-3 font-medium">Acao</th>
                    <th className="py-2 pr-3 font-medium">Data efetiva</th>
                    {allMonths && <th className="py-2 pr-3 font-medium">Mes</th>}
                    <th className="py-2 pr-3 font-medium">Motivo</th>
                    <th className="py-2 pr-3 font-medium">Quem</th>
                    <th className="py-2 font-medium">Registrado em</th>
                  </tr>
                </thead>
                <tbody>
                  {log.map((r) => (
                    <tr key={r.id} className="border-b border-border/60 align-top">
                      <td className="py-2 pr-3">
                        {r.action === "pausa" ? (
                          <span className="inline-flex items-center gap-1 text-danger">
                            <Pause className="h-3.5 w-3.5" /> Pausa
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-primary">
                            <Play className="h-3.5 w-3.5" /> Reativacao
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-foreground">
                        {fmtDateDigits(r.effective_at)}
                      </td>
                      {allMonths && (
                        <td className="py-2 pr-3 text-muted">
                          {formatMesAnoShort(r.mes_referencia) || "—"}
                        </td>
                      )}
                      <td className="py-2 pr-3 text-muted">{r.reason || "—"}</td>
                      <td className="py-2 pr-3 text-muted">
                        {r.changed_by_name || "—"}
                      </td>
                      <td className="py-2 text-xs text-muted">
                        {fmtInstant(r.registered_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Data efetiva (digitada pelo user, gravada a meia-noite): le os digitos. */
export function fmtDateDigits(s: string | null | undefined): string {
  if (!s) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
}

/** Instante real (registered_at): converte pro fuso local. */
function fmtInstant(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  return isNaN(d.getTime()) ? "—" : d.toLocaleString("pt-BR");
}
