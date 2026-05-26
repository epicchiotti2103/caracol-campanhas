"use client";

// Dashboard cross-campanha. Lista TODAS as campanhas com a linha consolidada
// (mais recente) de cada uma + big numbers do mes (via /dashboard/summary).
//
// Estrategia de fetch: GET /campanhas?month=YYYY-MM pega a lista do mes,
// depois Promise.all em /campanhas/{id}/metrics/latest pra cada uma.
// /dashboard/summary?month=YYYY-MM pega os totals (campanhas_count, budget_total,
// spend_total, budget_used_pct).

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Search,
  RefreshCw,
  Loader2,
  AlertCircle,
  Megaphone,
  ArrowRight,
  Info,
  Plus
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { CampanhaFechamentoModal } from "@/components/campanha-fechamento-modal";
import { apiFetch } from "@/lib/api";
import {
  currentMonthString,
  formatCurrency,
  formatMesAnoShort
} from "@/lib/format";
import {
  paceColor,
  pacePctColor,
  fraudColor,
  paceBadgeClasses,
  normalizePaceStatus,
  fmtDateBr
} from "@/lib/pace";
import type {
  Campanha,
  CampanhaDashboardSummary,
  CampanhaMetricsLatest,
  CampanhaMetricsRow,
  CampanhaMonthsAvailable,
  CampanhaStatus,
  CampanhaTipo,
  Fechamento,
  FechamentoSummary,
  MetricPlatform,
  Moeda
} from "@/types";

const PLATFORM_PRIORITY: MetricPlatform[] = ["consolidado", "android", "ios"];

const STATUS_OPTIONS: { value: CampanhaStatus | "todos"; label: string }[] = [
  { value: "todos", label: "Todos" },
  { value: "ativa", label: "Ativa" },
  { value: "pausada", label: "Pausada" },
  { value: "encerrada", label: "Encerrada" }
];

const TIPO_OPTIONS: { value: CampanhaTipo | "todos"; label: string }[] = [
  { value: "todos", label: "Todos" },
  { value: "ua", label: "UA" },
  { value: "rtg", label: "RTG" }
];

const PACE_OPTIONS: { value: string; label: string }[] = [
  { value: "todos", label: "Todos" },
  { value: "OK", label: "OK" },
  { value: "OVERPACING", label: "Overpacing" },
  { value: "UNDERPACING", label: "Underpacing" },
  { value: "MUITO ABAIXO", label: "Muito abaixo" },
  { value: "SEM_DADOS", label: "Sem dados" }
];

interface CampanhaSummary {
  campanha: Campanha;
  row: CampanhaMetricsRow | null;
  reportDate: string | null;
  noData: boolean;
  fechamento: Fechamento | null;
}

type FechamentoStatus = "aberto" | "fechado" | "travado";

function fechamentoStatusOf(f: Fechamento | null | undefined): FechamentoStatus {
  if (!f || !f.id) return "aberto";
  if (f.is_locked || f.locked) return "travado";
  return "fechado";
}

export default function DesempenhoDashboardPage() {
  return (
    <AppShell>
      <Suspense
        fallback={
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        }
      >
        <DesempenhoDashboard />
      </Suspense>
    </AppShell>
  );
}

function DesempenhoDashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const monthFromUrl = searchParams?.get("month") || "";

  const [summaries, setSummaries] = useState<CampanhaSummary[]>([]);
  const [summary, setSummary] = useState<CampanhaDashboardSummary | null>(null);
  const [fechSummary, setFechSummary] = useState<FechamentoSummary | null>(null);
  const [modalCampanha, setModalCampanha] = useState<Campanha | null>(null);
  const [months, setMonths] = useState<string[]>([]);
  const [month, setMonth] = useState<string>(
    monthFromUrl || currentMonthString()
  );
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<CampanhaStatus | "todos">(
    "todos"
  );
  const [tipoFilter, setTipoFilter] = useState<CampanhaTipo | "todos">("todos");
  const [paceFilter, setPaceFilter] = useState<string>("todos");

  // Carrega meses disponiveis
  useEffect(() => {
    (async () => {
      try {
        const res: CampanhaMonthsAvailable = await apiFetch(
          "/campanhas?months_available=1"
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

  const loadAll = async (
    selectedMonth: string,
    opts?: { silent?: boolean }
  ) => {
    if (opts?.silent) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const monthQuery = selectedMonth ? `?month=${selectedMonth}` : "";
      const [listRes, summaryRes, fechSummaryRes] = await Promise.all([
        apiFetch(`/campanhas${monthQuery}`),
        apiFetch(
          `/campanhas/dashboard/summary${monthQuery}`
        ).catch(() => null),
        apiFetch(
          `/campanhas/fechamento/summary${monthQuery}`
        ).catch(() => null)
      ]);
      const campanhas: Campanha[] = Array.isArray(listRes)
        ? listRes
        : listRes?.items || [];

      setSummary(summaryRes as CampanhaDashboardSummary | null);
      setFechSummary(fechSummaryRes as FechamentoSummary | null);

      // Metrics latest + fechamento (em paralelo por campanha)
      const [metricsResults, fechResults] = await Promise.all([
        Promise.allSettled(
          campanhas.map((c) =>
            apiFetch(`/campanhas/${c.id}/metrics/latest`).then(
              (m) => m as CampanhaMetricsLatest
            )
          )
        ),
        Promise.allSettled(
          campanhas.map((c) => {
            const mes = selectedMonth || "";
            if (!mes) return Promise.resolve(null as Fechamento | null);
            return apiFetch(
              `/campanhas/${c.id}/fechamento?month=${mes}`
            ).then((f) => f as Fechamento);
          })
        )
      ]);

      const next: CampanhaSummary[] = campanhas.map((campanha, i) => {
        const r = metricsResults[i];
        const f = fechResults[i];
        const fechamento =
          f.status === "fulfilled" ? (f.value as Fechamento | null) : null;

        if (r.status === "rejected") {
          return {
            campanha,
            row: null,
            reportDate: null,
            noData: true,
            fechamento
          };
        }
        const latest = r.value;
        const platforms = latest?.platforms || {};
        const keys = Object.keys(platforms) as MetricPlatform[];
        if (keys.length === 0 || !latest?.report_date) {
          return {
            campanha,
            row: null,
            reportDate: null,
            noData: true,
            fechamento
          };
        }
        let row: CampanhaMetricsRow | null = null;
        for (const p of PLATFORM_PRIORITY) {
          if (platforms[p]) {
            row = platforms[p]!;
            break;
          }
        }
        if (!row) {
          const firstKey = keys[0];
          row = platforms[firstKey] || null;
        }
        return {
          campanha,
          row,
          reportDate: latest.report_date,
          noData: row == null,
          fechamento
        };
      });

      setSummaries(next);
    } catch (err: any) {
      const msg = err?.message || "";
      if (msg && !/404|not found|failed to fetch/i.test(msg)) {
        setError(msg);
      }
      setSummaries([]);
      setSummary(null);
      setFechSummary(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadAll(month);
    // Atualiza querystring
    const params = new URLSearchParams(searchParams?.toString() || "");
    if (month) {
      params.set("month", month);
    } else {
      params.delete("month");
    }
    const qs = params.toString();
    router.replace(`/desempenho${qs ? `?${qs}` : ""}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return summaries.filter((s) => {
      if (statusFilter !== "todos" && s.campanha.status !== statusFilter)
        return false;
      if (tipoFilter !== "todos" && s.campanha.tipo !== tipoFilter)
        return false;
      if (paceFilter !== "todos") {
        const ps = normalizePaceStatus(s.row?.pace_status);
        if (paceFilter === "SEM_DADOS") {
          if (s.row && ps) return false;
        } else if (ps !== paceFilter) {
          return false;
        }
      }
      if (q) {
        const name = s.campanha.name.toLowerCase();
        const codigo = (s.campanha.codigo || "").toLowerCase();
        if (!name.includes(q) && !codigo.includes(q)) return false;
      }
      return true;
    });
  }, [summaries, search, statusFilter, tipoFilter, paceFilter]);

  const totalCount = summaries.length;

  const monthOptions = useMemo(() => {
    const set = new Set<string>(months);
    set.add(month);
    set.add(currentMonthString());
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [months, month]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-widest text-primary">
            Desempenho
          </h4>
          <h1 className="text-2xl font-semibold text-foreground">
            Dashboard cross-campanha
          </h1>
          <p className="mt-1 text-sm text-muted">
            KPIs consolidados (linha mais recente) das campanhas do mes.
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
            onClick={() => loadAll(month, { silent: true })}
            disabled={refreshing || loading}
            className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-muted transition-colors hover:bg-background disabled:opacity-50"
            title="Atualizar"
          >
            <RefreshCw
              className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
            />
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

      <BigNumbers
        summary={summary}
        fechSummary={fechSummary}
        loading={loading}
      />

      <div className="rounded-xl border border-border bg-surface">
        <FiltersBar
          search={search}
          onSearch={setSearch}
          status={statusFilter}
          onStatus={setStatusFilter}
          tipo={tipoFilter}
          onTipo={setTipoFilter}
          pace={paceFilter}
          onPace={setPaceFilter}
        />

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : totalCount === 0 ? (
          <EmptyStateNoCampanhas month={month} />
        ) : filtered.length === 0 ? (
          <EmptyStateNoFilter />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  {[
                    "Campanha",
                    "Tipo",
                    "Status",
                    "Gasto / Budget",
                    "Fechamento",
                    "% MTD",
                    "Pace",
                    "P360 Evt",
                    "PA False",
                    "Atualizacao",
                    ""
                  ].map((h, i) => (
                    <th
                      key={`${h}-${i}`}
                      className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((s, i) => (
                  <SummaryRow
                    key={s.campanha.id}
                    summary={s}
                    isLast={i === filtered.length - 1}
                    onOpenFechamento={() => setModalCampanha(s.campanha)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <div className="flex items-center justify-between border-t border-border px-5 py-3">
            <p className="text-xs text-muted">
              {filtered.length} de {totalCount}{" "}
              {totalCount === 1 ? "campanha" : "campanhas"}
            </p>
          </div>
        )}
      </div>

      {modalCampanha && (
        <CampanhaFechamentoModal
          campanhaId={modalCampanha.id}
          campanhaNome={modalCampanha.name}
          month={month}
          moeda={modalCampanha.moeda}
          onClose={() => setModalCampanha(null)}
          onSaved={() => {
            // Recarrega o dashboard apos qualquer mutacao
            loadAll(month, { silent: true });
          }}
        />
      )}
    </div>
  );
}

function BigNumbers({
  summary,
  fechSummary,
  loading
}: {
  summary: CampanhaDashboardSummary | null;
  fechSummary: FechamentoSummary | null;
  loading: boolean;
}) {
  const budgetUsedPct = summary?.budget_used_pct
    ? summary.budget_used_pct * 100
    : null;

  const usedColor = pacePctColor(budgetUsedPct);

  // Faturamento fechado: soma BRL+USD pra simplicidade (mostra so BRL formatado
  // por enquanto — multi-moeda fica como ajuste futuro se ficar relevante).
  const faturamentoFechado =
    fechSummary != null
      ? (fechSummary.spend_final_total_brl || 0)
      : null;

  return (
    <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
      <KpiCard
        label="Budget total do mes"
        value={
          summary?.budget_total != null
            ? formatCurrency(summary.budget_total, "BRL")
            : loading
            ? "..."
            : "—"
        }
      />
      <KpiCard
        label="A faturar no mes"
        value={
          summary?.spend_total != null
            ? formatCurrency(summary.spend_total, "BRL")
            : loading
            ? "..."
            : "—"
        }
      />
      <KpiCard
        label="% consumido"
        value={
          budgetUsedPct != null
            ? `${budgetUsedPct.toFixed(1)}%`
            : loading
            ? "..."
            : "—"
        }
        valueClass={usedColor || undefined}
      />
      <KpiCard
        label="Faturamento fechado"
        value={
          faturamentoFechado != null
            ? formatCurrency(faturamentoFechado, "BRL")
            : loading
            ? "..."
            : "—"
        }
        sublabel={
          fechSummary
            ? `${fechSummary.fechamentos_count}/${
                fechSummary.campanhas_total
              } fechado${fechSummary.fechamentos_count === 1 ? "" : "s"}${
                fechSummary.fechamentos_locked > 0
                  ? ` · ${fechSummary.fechamentos_locked} travado${
                      fechSummary.fechamentos_locked === 1 ? "" : "s"
                    }`
                  : ""
              }`
            : undefined
        }
      />
      <KpiCard
        label="Campanhas no mes"
        value={
          summary?.campanhas_count != null
            ? String(summary.campanhas_count)
            : loading
            ? "..."
            : "0"
        }
        compact
      />
    </div>
  );
}

function KpiCard({
  label,
  value,
  valueClass,
  compact,
  sublabel
}: {
  label: string;
  value: string;
  valueClass?: string;
  compact?: boolean;
  sublabel?: string;
}) {
  return (
    <article className="rounded-xl border border-border bg-surface p-5">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted">
        {label}
      </p>
      <p
        className={`mt-2 font-mono ${
          compact ? "text-xl" : "text-2xl"
        } font-semibold ${valueClass || "text-foreground"}`}
      >
        {value}
      </p>
      {sublabel && (
        <p className="mt-1 text-[11px] text-muted">{sublabel}</p>
      )}
    </article>
  );
}

function FiltersBar(props: {
  search: string;
  onSearch: (v: string) => void;
  status: CampanhaStatus | "todos";
  onStatus: (v: CampanhaStatus | "todos") => void;
  tipo: CampanhaTipo | "todos";
  onTipo: (v: CampanhaTipo | "todos") => void;
  pace: string;
  onPace: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-border px-5 py-4">
      <div className="relative w-full">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input
          type="text"
          placeholder="Buscar por nome ou codigo..."
          value={props.search}
          onChange={(e) => props.onSearch(e.target.value)}
          className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm text-foreground outline-none focus:border-primary/50"
        />
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <FilterGroup
          label="Status"
          options={STATUS_OPTIONS}
          value={props.status}
          onChange={(v) => props.onStatus(v as CampanhaStatus | "todos")}
        />
        <FilterGroup
          label="Tipo"
          options={TIPO_OPTIONS}
          value={props.tipo}
          onChange={(v) => props.onTipo(v as CampanhaTipo | "todos")}
        />
        <FilterGroup
          label="Pace"
          options={PACE_OPTIONS}
          value={props.pace}
          onChange={props.onPace}
        />
      </div>
    </div>
  );
}

function FilterGroup({
  label,
  options,
  value,
  onChange
}: {
  label: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-semibold uppercase tracking-wider text-muted">
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-1">
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
              value === opt.value
                ? "bg-primary text-black"
                : "bg-background text-muted hover:text-foreground"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function SummaryRow({
  summary,
  isLast,
  onOpenFechamento
}: {
  summary: CampanhaSummary;
  isLast: boolean;
  onOpenFechamento: () => void;
}) {
  const { campanha, row, reportDate, noData, fechamento } = summary;
  const moeda: Moeda | string | null | undefined = campanha.moeda;
  const paceStatus = normalizePaceStatus(row?.pace_status);
  const spend = row?.spend_actual ?? null;
  const budget = row?.budget_monthly ?? campanha.budget ?? null;
  const budgetUsedPct = row?.budget_used_pct ?? null;
  const mtdPct = row?.spend_pace_pct ?? null;

  return (
    <tr
      className={`group transition-colors hover:bg-background ${
        !isLast ? "border-b border-border" : ""
      }`}
    >
      <td className="px-4 py-4">
        <div className="flex flex-col gap-0.5">
          {campanha.codigo && (
            <span className="font-mono text-[10px] font-semibold tracking-wider text-primary">
              {campanha.codigo}
            </span>
          )}
          <Link
            href={`/campanhas/${campanha.id}/desempenho`}
            className="font-medium text-foreground hover:text-primary"
          >
            {campanha.name}
          </Link>
        </div>
      </td>
      <td className="whitespace-nowrap px-4 py-4">
        {campanha.tipo ? (
          <span className="rounded-md border border-border bg-background px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
            {campanha.tipo}
          </span>
        ) : (
          <span className="text-muted">—</span>
        )}
      </td>
      <td className="whitespace-nowrap px-4 py-4">
        <StatusBadge status={campanha.status} />
      </td>
      <td className="whitespace-nowrap px-4 py-4">
        {noData ? (
          <span className="text-xs text-muted">—</span>
        ) : (
          <div className="min-w-[180px]">
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <span className="font-mono text-xs text-foreground">
                {formatCurrency(spend, moeda)}
              </span>
              <span className="font-mono text-[11px] text-muted">
                {budgetUsedPct != null
                  ? `${budgetUsedPct.toFixed(1)}%`
                  : "—"}
              </span>
            </div>
            <p className="font-mono text-[11px] text-muted">
              / {formatCurrency(budget, moeda)}
            </p>
            <ProgressBar
              pct={budgetUsedPct ?? 0}
              color={paceColor(paceStatus, budgetUsedPct)}
            />
          </div>
        )}
      </td>
      <td className="whitespace-nowrap px-4 py-4">
        <FechamentoBadge
          fechamento={fechamento}
          onClick={onOpenFechamento}
        />
      </td>
      <td className="whitespace-nowrap px-4 py-4">
        <span className={`font-mono text-sm ${pacePctColor(mtdPct)}`}>
          {mtdPct != null ? `${mtdPct.toFixed(1)}%` : "—"}
        </span>
      </td>
      <td className="whitespace-nowrap px-4 py-4">
        <PaceBadgeInline status={paceStatus} hasRow={!noData} />
      </td>
      <td className="whitespace-nowrap px-4 py-4">
        <span className={`font-mono text-xs ${fraudColor(row?.p360_event_rate)}`}>
          {row?.p360_event_rate != null
            ? `${(row.p360_event_rate * 100).toFixed(1)}%`
            : "—"}
        </span>
      </td>
      <td className="whitespace-nowrap px-4 py-4">
        <span className={`font-mono text-xs ${fraudColor(row?.pa_false_rate)}`}>
          {row?.pa_false_rate != null
            ? `${(row.pa_false_rate * 100).toFixed(1)}%`
            : "—"}
        </span>
      </td>
      <td className="whitespace-nowrap px-4 py-4 text-xs text-muted">
        {fmtDateBr(reportDate) || "—"}
      </td>
      <td className="whitespace-nowrap px-4 py-4">
        <Link
          href={`/campanhas/${campanha.id}/desempenho`}
          className="inline-flex items-center gap-1 text-xs text-muted transition-colors hover:text-primary"
        >
          Ver detalhe
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </td>
    </tr>
  );
}

function PaceBadgeInline({
  status,
  hasRow
}: {
  status: string;
  hasRow: boolean;
}) {
  if (!hasRow || !status) {
    return (
      <span className="rounded-full border border-zinc-500/30 bg-zinc-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-300">
        sem dados
      </span>
    );
  }
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${paceBadgeClasses(
        status
      )}`}
    >
      {status}
    </span>
  );
}

function ProgressBar({ pct, color }: { pct: number; color: string }) {
  const capped = Math.max(0, Math.min(pct, 100));
  return (
    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-background">
      <div
        className={`h-full transition-all ${color}`}
        style={{ width: `${capped}%` }}
      />
    </div>
  );
}

function EmptyStateNoCampanhas({ month }: { month: string }) {
  return (
    <div className="py-20 text-center">
      <Megaphone className="mx-auto mb-3 h-8 w-8 opacity-20" />
      <p className="mb-1 text-sm font-semibold text-foreground">
        Nenhuma campanha em {formatMesAnoShort(month) || "—"}.
      </p>
      <p className="mx-auto mb-5 max-w-md text-sm text-muted">
        Cadastre uma campanha ou troque o mes selecionado.
      </p>
      <Link
        href="/campanhas/new"
        className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90"
      >
        <Plus className="h-4 w-4" />
        Criar campanha
      </Link>
    </div>
  );
}

function EmptyStateNoFilter() {
  return (
    <div className="py-16 text-center">
      <Info className="mx-auto mb-3 h-8 w-8 opacity-20" />
      <p className="text-sm text-muted">
        Nenhuma campanha para os filtros atuais.
      </p>
    </div>
  );
}

function FechamentoBadge({
  fechamento,
  onClick
}: {
  fechamento: Fechamento | null;
  onClick: () => void;
}) {
  const status = fechamentoStatusOf(fechamento);
  const cls =
    status === "travado"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
      : status === "fechado"
      ? "border-amber-500/30 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20"
      : "border-zinc-500/30 bg-zinc-500/10 text-zinc-300 hover:bg-zinc-500/20";
  const label =
    status === "travado" ? "Travado" : status === "fechado" ? "Fechado" : "Aberto";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition-colors ${cls}`}
    >
      {label}
    </button>
  );
}
