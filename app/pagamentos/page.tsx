"use client";

// Agregado de pagamento por publisher no mes.
//
// Problema que resolve: no fechamento por CAMPANHA o user ve quanto pagar por
// publisher NAQUELA campanha. Mas quando o publisher emite a NF, ele precisa do
// TOTAL DO MES (somando todas as campanhas fechadas). Esta tela faz esse corte:
// seletor de mes -> lista de publishers com o total a pagar (por moeda), com
// drill-down mostrando de quais campanhas veio cada parcela.
//
// O valor exibido e o `spend_final` JA CALCULADO pelo fechamento (inclui cap,
// exclusao por pausa, excedente aprovado). Nao recalcula nada no front — e a
// soma pura do que o backend persistiu. A partilha Wave (1/3) NUNCA se aplica
// aqui: o publisher recebe o spend_final cheio.
//
// Backend: GET /campanhas/fechamento/summary/publishers?month=YYYY-MM
// (tolerante a 404/rede enquanto a rota nao existe — some com aviso).

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  RefreshCw,
  Loader2,
  AlertCircle,
  Search,
  ChevronRight,
  ChevronDown,
  Users,
  Lock,
  ArrowRight
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { cachedFetch, MONTHS_AVAILABLE_TTL_MS } from "@/lib/cache";
import {
  currentMonthString,
  formatCurrency,
  formatMesAnoShort
} from "@/lib/format";
import type {
  CampanhaMonthsAvailable,
  Moeda,
  PublisherPagamento,
  PublishersPagamentoResponse
} from "@/types";

// Ordem estavel de moeda na exibicao (USD primeiro, BRL depois) — espelha o
// modal de fechamento.
const MOEDA_ORDER: Moeda[] = ["USD", "BRL"];

// "$ 1.234,50 + R$ 500,00" a partir de um mapa por moeda. Vazio -> "—".
function totalsLabel(
  totals: Partial<Record<Moeda, number>> | null | undefined
): string {
  if (!totals) return "—";
  const parts: string[] = [];
  for (const m of MOEDA_ORDER) {
    const v = totals[m];
    if (v != null && v !== 0) parts.push(formatCurrency(v, m));
  }
  return parts.length > 0 ? parts.join(" + ") : "—";
}

export default function PagamentosPage() {
  return (
    <AppShell>
      <Suspense
        fallback={
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        }
      >
        <PagamentosView />
      </Suspense>
    </AppShell>
  );
}

function PagamentosView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const monthFromUrl = searchParams?.get("month") || "";

  const [data, setData] = useState<PublishersPagamentoResponse | null>(null);
  const [months, setMonths] = useState<string[]>([]);
  const [month, setMonth] = useState<string>(
    monthFromUrl || currentMonthString()
  );
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleExpanded = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // Meses disponiveis (mesmo endpoint do /desempenho).
  useEffect(() => {
    (async () => {
      try {
        const res = await cachedFetch<CampanhaMonthsAvailable>(
          "/campanhas?months_available=1",
          { ttlMs: MONTHS_AVAILABLE_TTL_MS }
        );
        const list = res?.months || [];
        setMonths(list);
        if (list.length > 0 && !monthFromUrl && !list.includes(month)) {
          setMonth(list[0]);
        }
      } catch {
        // ignore
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = async (selectedMonth: string, opts?: { silent?: boolean }) => {
    if (opts?.silent) setRefreshing(true);
    else setLoading(true);
    setError("");
    setUnavailable(false);
    try {
      const res = await cachedFetch<PublishersPagamentoResponse>(
        `/campanhas/fechamento/summary/publishers?month=${selectedMonth}`,
        { ttlMs: 30_000, force: opts?.silent === true }
      );
      setData(res || null);
    } catch (err: any) {
      const msg = err?.message || "";
      // Backend ainda nao tem a rota -> some silenciosamente com aviso, sem erro
      // vermelho (mesmo padrao tolerante do resto do app).
      if (/404|not found|failed to fetch/i.test(msg)) {
        setUnavailable(true);
        setData(null);
      } else {
        setError(msg || "Falha ao carregar pagamentos.");
        setData(null);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load(month);
    const params = new URLSearchParams(searchParams?.toString() || "");
    if (month) params.set("month", month);
    else params.delete("month");
    const qs = params.toString();
    router.replace(`/pagamentos${qs ? `?${qs}` : ""}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  const publishers = data?.publishers || [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return publishers;
    return publishers.filter((p) =>
      (p.publisher_name || "").toLowerCase().includes(q)
    );
  }, [publishers, search]);

  const monthOptions = useMemo(() => {
    const set = new Set<string>(months);
    set.add(month);
    set.add(currentMonthString());
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [months, month]);

  // Ha algum fechamento nao travado nas parcelas exibidas? (aviso "parcial")
  const hasUnlocked = useMemo(
    () => publishers.some((p) => p.items.some((it) => !it.locked)),
    [publishers]
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-widest text-primary">
            Pagamentos
          </h4>
          <h1 className="text-2xl font-semibold text-foreground">
            Agregado por publisher no mes
          </h1>
          <p className="mt-1 text-sm text-muted">
            Total a pagar a cada publisher somando todas as campanhas fechadas do
            mes. Base pra emissao da NF do publisher.
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
            onClick={() => load(month, { silent: true })}
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

      {/* Big number: total geral por moeda */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <article className="rounded-xl border border-border bg-surface p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">
            Total a pagar no mes
          </p>
          <p className="mt-2 font-mono text-2xl font-semibold text-foreground">
            {loading ? "..." : totalsLabel(data?.grand_total_by_moeda)}
          </p>
          <p className="mt-1 text-[11px] text-muted">
            Soma do repasse a todos os publishers (por moeda).
          </p>
        </article>
        <article className="rounded-xl border border-border bg-surface p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">
            Publishers no mes
          </p>
          <p className="mt-2 font-mono text-2xl font-semibold text-foreground">
            {loading ? "..." : String(publishers.length)}
          </p>
          <p className="mt-1 text-[11px] text-muted">
            Com pelo menos uma campanha fechada no mes.
          </p>
        </article>
      </div>

      {hasUnlocked && !loading && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-300" />
          <p className="text-xs text-amber-200">
            Alguns valores vem de fechamentos ainda nao travados — podem mudar ate
            o travamento. As parcelas nao travadas ficam marcadas.
          </p>
        </div>
      )}

      <div className="rounded-xl border border-border bg-surface">
        <div className="border-b border-border px-5 py-4">
          <div className="relative w-full">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              type="text"
              placeholder="Buscar publisher por nome..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm text-foreground outline-none focus:border-primary/50"
            />
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : unavailable ? (
          <EmptyState
            title="Agregado indisponivel"
            text="A rota de agregado por publisher ainda nao esta no ar no backend. Assim que o Tracker publicar, esta tela passa a listar os totais."
          />
        ) : publishers.length === 0 ? (
          <EmptyState
            title={`Nenhum fechamento em ${formatMesAnoShort(month) || "—"}`}
            text="Nenhuma campanha fechada no mes selecionado gerou repasse a publisher. Troque o mes ou feche as campanhas."
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            title="Nenhum publisher para a busca"
            text="Ajuste o termo de busca."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  {["Publisher", "Campanhas", "Total a pagar", ""].map((h, i) => (
                    <th
                      key={`${h}-${i}`}
                      className={`whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted ${
                        h === "Total a pagar" ? "text-right" : "text-left"
                      }`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((p, i) => (
                  <PublisherRows
                    key={p.supplier_id || `name-${p.publisher_name}-${i}`}
                    pub={p}
                    isLast={i === filtered.length - 1}
                    expanded={expanded.has(
                      p.supplier_id || `name-${p.publisher_name}-${i}`
                    )}
                    onToggle={() =>
                      toggleExpanded(
                        p.supplier_id || `name-${p.publisher_name}-${i}`
                      )
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <div className="flex items-center justify-between border-t border-border px-5 py-3">
            <p className="text-xs text-muted">
              {filtered.length} de {publishers.length}{" "}
              {publishers.length === 1 ? "publisher" : "publishers"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function PublisherRows({
  pub,
  isLast,
  expanded,
  onToggle
}: {
  pub: PublisherPagamento;
  isLast: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const rowBorder = !expanded && !isLast ? "border-b border-border" : "";
  return (
    <>
      <tr
        className={`group cursor-pointer transition-colors hover:bg-background ${rowBorder}`}
        onClick={onToggle}
      >
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            {expanded ? (
              <ChevronDown className="h-4 w-4 flex-shrink-0 text-muted" />
            ) : (
              <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted" />
            )}
            <span className="font-medium text-foreground">
              {pub.publisher_name || "— sem cadastro"}
            </span>
            {!pub.supplier_id && (
              <span
                className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-300"
                title="Publisher sem fornecedor cadastrado — agrupado pelo nome do fechamento."
              >
                sem cadastro
              </span>
            )}
          </div>
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-muted">
          <span className="inline-flex items-center gap-1.5 text-xs">
            <Users className="h-3.5 w-3.5" />
            {pub.campanhas_count}
          </span>
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-sm font-semibold text-foreground">
          {totalsLabel(pub.totals_by_moeda)}
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-right text-xs text-muted">
          {expanded ? "Ocultar" : "Detalhar"}
        </td>
      </tr>
      {expanded && (
        <tr className={!isLast ? "border-b border-border" : ""}>
          <td colSpan={4} className="bg-background/40 px-4 py-3">
            <div className="overflow-x-auto rounded-lg border border-border bg-surface">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-background/40">
                    <th className="px-3 py-2 text-left font-semibold uppercase tracking-wider text-muted">
                      Campanha
                    </th>
                    <th className="px-3 py-2 text-center font-semibold uppercase tracking-wider text-muted">
                      Fechamento
                    </th>
                    <th className="px-3 py-2 text-right font-semibold uppercase tracking-wider text-muted">
                      A pagar
                    </th>
                    <th className="px-3 py-2 text-right font-semibold uppercase tracking-wider text-muted" />
                  </tr>
                </thead>
                <tbody>
                  {pub.items.map((it, j) => (
                    <tr
                      key={`${it.campanha_id}-${it.moeda}-${j}`}
                      className={
                        j < pub.items.length - 1 ? "border-b border-border" : ""
                      }
                    >
                      <td className="px-3 py-2">
                        <div className="flex flex-col gap-0.5">
                          {it.campanha_codigo && (
                            <span className="font-mono text-[10px] font-semibold tracking-wider text-primary">
                              {it.campanha_codigo}
                            </span>
                          )}
                          <span className="text-foreground">
                            {it.campanha_nome}
                          </span>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-center">
                        {it.locked ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
                            <Lock className="h-3 w-3" />
                            Travado
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-200">
                            Fechado
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-foreground">
                        {formatCurrency(it.spend_final, it.moeda)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        <Link
                          href={`/campanhas/${it.campanha_id}`}
                          className="inline-flex items-center gap-1 text-muted transition-colors hover:text-primary"
                          onClick={(e) => e.stopPropagation()}
                        >
                          Abrir
                          <ArrowRight className="h-3 w-3" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <div className="py-20 text-center">
      <Users className="mx-auto mb-3 h-8 w-8 opacity-20" />
      <p className="mb-1 text-sm font-semibold text-foreground">{title}</p>
      <p className="mx-auto max-w-md text-sm text-muted">{text}</p>
    </div>
  );
}
