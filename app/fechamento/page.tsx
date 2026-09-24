"use client";

// Painel "Fechamento do mes": uma linha por campanha do mes com tudo que
// falta pra fechar — robo atrasado, PIDs do robo fora do cadastro, publishers
// sem valor, status do fechamento, spend final e NF vinculada.
// Fonte unica: GET /campanhas/fechamento/status?month=YYYY-MM (1 chamada).
// Clique na linha abre o CampanhaFechamentoModal (mesmo do /desempenho).

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { CampanhaFechamentoModal } from "@/components/campanha-fechamento-modal";
import { PIDS_NAO_CADASTRADOS_ANCHOR } from "@/components/pids-nao-cadastrados";
import { apiFetchStatus, isEmImplantacao } from "@/lib/api-status";
import { cachedFetch, MONTHS_AVAILABLE_TTL_MS } from "@/lib/cache";
import { NF_URL } from "@/lib/config";
import {
  currentMonthString,
  formatCurrency,
  formatDateOnly,
  formatMesAnoShort
} from "@/lib/format";
import type { CampanhaMonthsAvailable, Moeda } from "@/types";

type FechStatus = "sem" | "aberto" | "fechado" | "travado";

interface StatusItem {
  campanha_id: string;
  codigo: string | null;
  nome: string;
  cliente_nome: string | null;
  moeda: Moeda | string | null;
  coleta: "auto" | "manual";
  ultimo_report_date: string | null;
  robo_atrasado: boolean;
  pids_nao_cadastrados: number;
  fechamento_status: FechStatus;
  spend_final: number | null;
  publishers_total: number;
  publishers_sem_valor: number;
  nf_vinculada: boolean;
  nf_ids: string[];
  /** Tipado (pagar/receber + numero). Ausente em backend antigo -> fallback nf_ids. */
  nfs?: NfRef[];
}

interface NfRef {
  id: string;
  tipo: "pagar" | "receber";
  numero: string | number | null;
}

function nfHref(nf: NfRef): string {
  return nf.tipo === "receber"
    ? `${NF_URL}/receber?id=${encodeURIComponent(nf.id)}`
    : `${NF_URL}/invoice/${nf.id}`;
}

interface StatusResponse {
  month: string;
  items: StatusItem[];
}

/** Mes anterior ate o dia 10 (janela de fechamento), senao o corrente. */
function defaultMonth(): string {
  const d = new Date();
  if (d.getDate() <= 10) {
    const p = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    return `${p.getFullYear()}-${String(p.getMonth() + 1).padStart(2, "0")}`;
  }
  return currentMonthString();
}

/** Linha com algo por resolver. */
function pendencias(it: StatusItem): string[] {
  const p: string[] = [];
  if (it.robo_atrasado) p.push("robo");
  if (it.pids_nao_cadastrados > 0) p.push("pids");
  if (it.publishers_sem_valor > 0) p.push("sem_valor");
  if (it.fechamento_status !== "travado") p.push("fechamento");
  if (!it.nf_vinculada) p.push("nf");
  return p;
}

const STATUS_ORDER: Record<FechStatus, number> = { sem: 0, aberto: 1, fechado: 2, travado: 3 };

export default function FechamentoPage() {
  return (
    <AppShell>
      <Suspense
        fallback={
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        }
      >
        <FechamentoPainel />
      </Suspense>
    </AppShell>
  );
}

function FechamentoPainel() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const monthFromUrl = searchParams?.get("month") || "";

  const [month, setMonth] = useState<string>(monthFromUrl || defaultMonth());
  const [months, setMonths] = useState<string[]>([]);
  const [items, setItems] = useState<StatusItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [emImplantacao, setEmImplantacao] = useState(false);
  const [soPendentes, setSoPendentes] = useState(false);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<StatusItem | null>(null);

  useEffect(() => {
    cachedFetch<CampanhaMonthsAvailable>("/campanhas?months_available=1", {
      ttlMs: MONTHS_AVAILABLE_TTL_MS
    })
      .then((res) => setMonths(res?.months || []))
      .catch(() => {});
  }, []);

  const load = async (m: string, silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const res = await apiFetchStatus<StatusResponse>(
        `/campanhas/fechamento/status?month=${m}`
      );
      setItems(res?.items ?? []);
      setEmImplantacao(false);
    } catch (e) {
      setItems([]);
      if (isEmImplantacao(e)) setEmImplantacao(true);
      else setError(e instanceof Error ? e.message : "Falha ao carregar o painel.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load(month);
    const params = new URLSearchParams(searchParams?.toString() || "");
    params.set("month", month);
    router.replace(`/fechamento?${params.toString()}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  const monthOptions = useMemo(() => {
    const set = new Set<string>(months);
    set.add(month);
    set.add(currentMonthString());
    set.add(defaultMonth());
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [months, month]);

  const contadores = useMemo(
    () => ({
      total: items.length,
      travadas: items.filter((i) => i.fechamento_status === "travado").length,
      pids: items.filter((i) => i.pids_nao_cadastrados > 0).length,
      semNf: items.filter((i) => !i.nf_vinculada).length,
      robo: items.filter((i) => i.robo_atrasado).length,
      semValor: items.filter((i) => i.publishers_sem_valor > 0).length,
      pendentes: items.filter((i) => pendencias(i).length > 0).length
    }),
    [items]
  );

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items
      .filter((it) => !soPendentes || pendencias(it).length > 0)
      .filter(
        (it) =>
          !q ||
          it.nome.toLowerCase().includes(q) ||
          (it.codigo || "").toLowerCase().includes(q) ||
          (it.cliente_nome || "").toLowerCase().includes(q)
      )
      .sort((a, b) => {
        const pa = pendencias(a).length;
        const pb = pendencias(b).length;
        if ((pa > 0) !== (pb > 0)) return pa > 0 ? -1 : 1;
        if (pa !== pb) return pb - pa;
        const sa = STATUS_ORDER[a.fechamento_status] ?? 0;
        const sb = STATUS_ORDER[b.fechamento_status] ?? 0;
        if (sa !== sb) return sa - sb;
        return a.nome.localeCompare(b.nome, "pt-BR");
      });
  }, [items, soPendentes, search]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-widest text-primary">
            Fechamento
          </h4>
          <h1 className="text-2xl font-semibold text-foreground">Fechamento do mes</h1>
          <p className="mt-1 text-sm text-muted">
            O que falta pra fechar cada campanha: robo, PIDs, valores, travamento e NF.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted">
              Mes
            </span>
            <select
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground outline-none focus:border-primary/50"
            >
              {monthOptions.map((m) => (
                <option key={m} value={m}>
                  {formatMesAnoShort(m)}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={() => load(month, true)}
            disabled={refreshing || loading}
            className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-muted transition-colors hover:bg-background disabled:opacity-50"
            title="Atualizar"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            Atualizar
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-danger/20 bg-danger/10 p-3">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-danger" />
          <p className="text-sm text-danger">{error}</p>
        </div>
      )}

      {emImplantacao ? (
        <div className="rounded-xl border border-border bg-surface px-6 py-16 text-center">
          <p className="text-sm font-semibold text-foreground">Painel em implantacao</p>
          <p className="mt-1 text-sm text-muted">
            O backend deste painel ainda esta sendo publicado. Tente de novo em instantes.
          </p>
        </div>
      ) : (
        <>
          {!loading && items.length > 0 && (
            <p className="mb-4 text-sm text-muted">
              <span className="font-semibold text-foreground">{contadores.total}</span>{" "}
              {contadores.total === 1 ? "campanha" : "campanhas"} ·{" "}
              <span className="text-emerald-300">{contadores.travadas} travadas</span>
              {contadores.pids > 0 && (
                <>
                  {" · "}
                  <span className="text-amber-300">{contadores.pids} com PID faltando</span>
                </>
              )}
              {contadores.semValor > 0 && (
                <>
                  {" · "}
                  <span className="text-amber-300">
                    {contadores.semValor} com publisher sem valor
                  </span>
                </>
              )}
              {contadores.robo > 0 && (
                <>
                  {" · "}
                  <span className="text-red-300">{contadores.robo} com robo atrasado</span>
                </>
              )}
              {" · "}
              <span className={contadores.semNf > 0 ? "text-amber-300" : ""}>
                {contadores.semNf} sem NF
              </span>
            </p>
          )}

          <div className="rounded-xl border border-border bg-surface">
            <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar campanha, codigo ou cliente"
                className="min-w-[220px] flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground outline-none focus:border-primary/50"
              />
              <label className="flex cursor-pointer items-center gap-2 text-sm text-muted">
                <input
                  type="checkbox"
                  checked={soPendentes}
                  onChange={(e) => setSoPendentes(e.target.checked)}
                  className="accent-orange-500"
                />
                So pendentes ({contadores.pendentes})
              </label>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : items.length === 0 ? (
              <p className="py-16 text-center text-sm text-muted">
                Nenhuma campanha em {formatMesAnoShort(month) || "—"}.
              </p>
            ) : rows.length === 0 ? (
              <p className="py-16 text-center text-sm text-muted">
                Nada pendente neste filtro.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      {[
                        "Campanha",
                        "Robo",
                        "PIDs",
                        "Publishers",
                        "Fechamento",
                        "Spend final",
                        "NF"
                      ].map((h) => (
                        <th
                          key={h}
                          className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((it) => (
                      <Linha key={it.campanha_id} it={it} onOpen={() => setModal(it)} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {modal && (
        <CampanhaFechamentoModal
          campanhaId={modal.campanha_id}
          campanhaNome={modal.nome}
          month={month}
          moeda={modal.moeda}
          onClose={() => setModal(null)}
          onSaved={() => load(month, true)}
        />
      )}
    </div>
  );
}

function Linha({ it, onOpen }: { it: StatusItem; onOpen: () => void }) {
  const pend = pendencias(it).length > 0;
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  return (
    <tr
      onClick={onOpen}
      className={`cursor-pointer border-b border-border/60 transition-colors last:border-0 hover:bg-white/[0.03] ${
        pend ? "" : "opacity-70"
      }`}
    >
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          {it.codigo && (
            <span className="font-mono text-[11px] text-muted">{it.codigo}</span>
          )}
          <span className="font-medium text-foreground">{it.nome}</span>
        </div>
        {it.cliente_nome && <p className="text-xs text-muted">{it.cliente_nome}</p>}
      </td>
      <td className="whitespace-nowrap px-4 py-3">
        {it.coleta === "manual" ? (
          <span className="text-xs text-muted">Manual</span>
        ) : it.robo_atrasado ? (
          <Pill tone="red" title="Robo nao rodou ate ontem">
            Atrasado · {formatDateOnly(it.ultimo_report_date, "sem dados")}
          </Pill>
        ) : (
          <Pill tone="green">
            OK{it.ultimo_report_date ? ` · ${formatDateOnly(it.ultimo_report_date)}` : ""}
          </Pill>
        )}
      </td>
      <td className="whitespace-nowrap px-4 py-3">
        {it.pids_nao_cadastrados > 0 ? (
          <Link
            href={`/campanhas/${it.campanha_id}#${PIDS_NAO_CADASTRADOS_ANCHOR}`}
            onClick={stop}
            title="Ver e cadastrar PIDs do robo"
          >
            <Pill tone="amber" interactive>
              {it.pids_nao_cadastrados} nao cadastrado{it.pids_nao_cadastrados === 1 ? "" : "s"}
            </Pill>
          </Link>
        ) : (
          <span className="text-xs text-muted">—</span>
        )}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-xs">
        {it.publishers_sem_valor > 0 ? (
          <Pill tone="amber">
            {it.publishers_sem_valor} de {it.publishers_total} sem valor
          </Pill>
        ) : (
          <span className="text-muted">
            {it.publishers_total} {it.publishers_total === 1 ? "publisher" : "publishers"}
          </span>
        )}
      </td>
      <td className="whitespace-nowrap px-4 py-3">
        <FechBadge status={it.fechamento_status} />
      </td>
      <td className="whitespace-nowrap px-4 py-3 tabular-nums text-foreground">
        {it.spend_final == null
          ? <span className="text-muted">—</span>
          : formatCurrency(it.spend_final, it.moeda === "BRL" ? "BRL" : "USD")}
      </td>
      <td className="whitespace-nowrap px-4 py-3" onClick={stop}>
        {it.nfs && it.nfs.length ? (
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            {it.nfs.map((nf) => (
              <a
                key={`${nf.tipo}-${nf.id}`}
                href={nfHref(nf)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-emerald-300 hover:underline"
                title={`Abrir NF a ${nf.tipo}`}
              >
                NF{nf.numero != null && String(nf.numero).trim() ? ` ${nf.numero}` : ""}
                <span className="text-muted">· {nf.tipo}</span>
                <ExternalLink className="h-3 w-3" />
              </a>
            ))}
          </div>
        ) : it.nf_vinculada ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {((it.nf_ids ?? []).length ? it.nf_ids : [null]).map((id, i) =>
              id ? (
                <a
                  key={id}
                  href={`${NF_URL}/invoice/${id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-emerald-300 hover:underline"
                  title="Abrir NF"
                >
                  NF{it.nf_ids.length > 1 ? ` ${i + 1}` : ""}
                  <ExternalLink className="h-3 w-3" />
                </a>
              ) : (
                <span key="sim" className="text-xs text-emerald-300">Sim</span>
              )
            )}
          </div>
        ) : (
          <Pill tone="zinc">Sem NF</Pill>
        )}
      </td>
    </tr>
  );
}

function Pill({
  tone,
  interactive,
  title,
  children
}: {
  tone: "red" | "amber" | "green" | "zinc";
  interactive?: boolean;
  title?: string;
  children: React.ReactNode;
}) {
  const cls = {
    red: "border-red-500/30 bg-red-500/10 text-red-300",
    amber: "border-amber-500/30 bg-amber-500/10 text-amber-200",
    green: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    zinc: "border-zinc-500/30 bg-zinc-500/10 text-zinc-300"
  }[tone];
  return (
    <span
      title={title}
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${cls} ${
        interactive ? "hover:brightness-125" : ""
      }`}
    >
      {children}
    </span>
  );
}

/** Mesmas cores do FechamentoBadge do /desempenho; "sem" = nenhum fechamento salvo. */
function FechBadge({ status }: { status: FechStatus }) {
  const cls =
    status === "travado"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
      : status === "fechado"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
        : status === "aberto"
          ? "border-zinc-500/30 bg-zinc-500/10 text-zinc-300"
          : "border-dashed border-zinc-500/40 bg-transparent text-zinc-400";
  const label =
    status === "travado"
      ? "Travado"
      : status === "fechado"
        ? "Fechado"
        : status === "aberto"
          ? "Aberto"
          : "Sem fechamento";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${cls}`}
    >
      {label}
    </span>
  );
}
