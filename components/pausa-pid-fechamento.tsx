"use client";

// Desconto por pausa de PID no fechamento (tracker 450e8ef).
// O backend desconta do valor SUGERIDO os eventos dos dias em que um PID ficou
// pausado — quando o robo manda o daily por media source e mapeia o PID pro
// publisher. Aqui so exibimos: o valor digitado continua soberano.
// Campos so existem em fechamento NAO travado; ausentes -> nada renderiza.

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { fmtDateDigits } from "./media-source-status-log-modal";
import type { PausaPidItem, PausaPidPublisher } from "@/types";

const AMBAR = "bg-amber-500/10 text-amber-300";
const VERDE = "bg-emerald-500/10 text-emerald-300";
const NEUTRO = "bg-muted/15 text-muted";

function somaEventos(ev: Record<string, number> | null | undefined): number {
  return Object.values(ev || {}).reduce((acc, v) => acc + (Number(v) || 0), 0);
}

function fmtInt(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return Math.round(v).toLocaleString("pt-BR");
}

/** Rotulo + cor do status de UM PID. */
export function pausaPidStatusInfo(pid: PausaPidItem): {
  label: string;
  cls: string;
  title: string;
} {
  switch (pid.status) {
    case "descontado": {
      const n = somaEventos(pid.eventos_descontados);
      return n > 0
        ? {
            label: `${fmtInt(n)} eventos descontados`,
            cls: VERDE,
            title: "Eventos dos dias pausados sairam do valor sugerido."
          }
        : {
            label: "sem eventos nos dias pausados",
            cls: NEUTRO,
            title: "O robo manda o daily do PID, mas ele nao teve eventos nos dias pausados."
          };
    }
    case "sem_dado_diario":
      return {
        label: "sem dado diario",
        cls: AMBAR,
        title:
          "O robo ainda nao manda o daily desse PID: o valor sugerido NAO desconta a pausa. Confira a mao."
      };
    case "sem_mapeamento_robo":
      return {
        label: "PID sem publisher no robo",
        cls: AMBAR,
        title:
          "O robo atribui esse PID a \"nao encontrado\": os eventos dele nao estao no MTD do publisher e a pausa NAO desconta nada. Acertar o mapeamento no robo."
      };
    case "sem_atividade":
      return {
        label: "sem atividade no robo",
        cls: NEUTRO,
        title: "O robo manda daily, mas esse PID nao aparece: nada a descontar."
      };
    default:
      return { label: String(pid.status || "—"), cls: NEUTRO, title: "" };
  }
}

export function PausaPidStatusChip({ pid }: { pid: PausaPidItem }) {
  const s = pausaPidStatusInfo(pid);
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${s.cls}`}
      title={s.title || undefined}
    >
      {s.label}
    </span>
  );
}

function janelasLabel(pid: PausaPidItem): string {
  return (pid.pausas || [])
    .map(
      (w) =>
        `${fmtDateDigits(w.inicio)} ate ${w.fim ? fmtDateDigits(w.fim) : "o fim do mes"}`
    )
    .join("; ");
}

/**
 * Badge na linha do publisher com `pausa_pid.resumo`. Ambar quando falta dado
 * (sem daily ou PID sem publisher no robo), verde quando o desconto foi aplicado.
 * Clique abre o memorial: eventos brutos/descontados/considerados + PIDs.
 */
export function PausaPidBadge({ info }: { info: PausaPidPublisher | null | undefined }) {
  const [open, setOpen] = useState(false);
  if (!info) return null;

  const pids = Array.isArray(info.pids) ? info.pids : [];
  const semMapeamento = pids.some((p) => p.status === "sem_mapeamento_robo");
  const cls =
    info.sem_dado_diario || semMapeamento ? AMBAR : info.aplicada ? VERDE : NEUTRO;

  const brutos = info.eventos_brutos || {};
  const desc = info.eventos_descontados || {};
  const cons = info.eventos_considerados || {};
  const eventos = Array.from(
    new Set([...Object.keys(brutos), ...Object.keys(desc), ...Object.keys(cons)])
  ).sort();

  return (
    <div className="mt-1.5 text-[11px] leading-tight">
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-left font-semibold ${cls}`}
        title="Pausa de PID: clique pra ver o detalhe do desconto"
      >
        {open ? (
          <ChevronDown className="h-3 w-3 flex-shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 flex-shrink-0" />
        )}
        Pausa de PID: {info.resumo}
      </button>
      {open && (
        <div className="mt-1.5 space-y-2 rounded border border-border bg-background/60 p-2">
          {eventos.length > 0 ? (
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-muted">
                  <th className="pr-2 text-left font-medium">Evento</th>
                  <th className="px-2 text-right font-medium">Brutos</th>
                  <th className="px-2 text-right font-medium">Descontados</th>
                  <th className="pl-2 text-right font-medium">Considerados</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {eventos.map((ev) => (
                  <tr key={ev}>
                    <td className="pr-2 text-left text-foreground">{ev}</td>
                    <td className="px-2 text-right text-muted">{fmtInt(brutos[ev])}</td>
                    <td className="px-2 text-right text-danger">
                      {desc[ev] ? `−${fmtInt(desc[ev])}` : "0"}
                    </td>
                    <td className="pl-2 text-right text-foreground">
                      {fmtInt(cons[ev] ?? brutos[ev])}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-muted">Sem eventos no MTD desse publisher.</p>
          )}
          <p className="text-muted">
            {fmtInt(info.dias_pausados)} dias pausados (maior janela entre os PIDs).
            O valor sugerido ja vem com o desconto; o valor digitado nao muda sozinho.
          </p>
          {pids.length > 0 && (
            <ul className="space-y-1 border-t border-border pt-1.5">
              {pids.map((pid, i) => (
                <li
                  key={`${pid.media_source}-${i}`}
                  className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5"
                >
                  <span className="font-mono text-foreground">{pid.media_source}</span>
                  <PausaPidStatusChip pid={pid} />
                  <span className="text-muted">
                    {fmtInt(pid.dias_pausados)} dias
                    {janelasLabel(pid) ? ` · ${janelasLabel(pid)}` : ""}
                  </span>
                  {pid.publisher_robo &&
                    pid.publisher_robo.toLowerCase() !==
                      (pid.publisher_cadastro || "").toLowerCase() && (
                      <span className="text-muted/80">· robo: {pid.publisher_robo}</span>
                    )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** Contadores por status pro topo do painel de PIDs pausados. */
export function PausaPidContadores({ pids }: { pids: PausaPidItem[] }) {
  if (!pids || pids.length === 0) return null;
  const count = (s: string) => pids.filter((p) => p.status === s).length;
  const descontados = pids.filter(
    (p) => p.status === "descontado" && somaEventos(p.eventos_descontados) > 0
  ).length;
  const semDado = count("sem_dado_diario");
  const semMap = count("sem_mapeamento_robo");
  return (
    <span className="flex flex-wrap items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider">
      {descontados > 0 && (
        <span className={`rounded px-1.5 py-0.5 ${VERDE}`}>{descontados} com desconto</span>
      )}
      {semDado > 0 && (
        <span className={`rounded px-1.5 py-0.5 ${AMBAR}`}>{semDado} sem dado diario</span>
      )}
      {semMap > 0 && (
        <span className={`rounded px-1.5 py-0.5 ${AMBAR}`}>
          {semMap} PID sem publisher no robo
        </span>
      )}
    </span>
  );
}

/** Chave de casamento PID <-> janela: publisher do cadastro + nome do PID. */
export function pausaPidKey(publisher: string | null | undefined, ms: string | null | undefined): string {
  return `${(publisher || "").trim().toLowerCase()}|${(ms || "").trim().toLowerCase()}`;
}
