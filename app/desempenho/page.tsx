"use client";

// Dashboard cross-campanha. Lista TODAS as campanhas com a linha consolidada
// (mais recente) de cada uma: gasto/budget, % MTD, pace_status, % P360 Evt,
// % PA False e data de atualizacao.
//
// Estrategia de fetch (opcao A do plano): GET /campanhas pega a lista,
// depois Promise.all em /campanhas/{id}/metrics/latest pra cada uma.
// Se a lista crescer (>20 campanhas), vale pedir endpoint agregador
// /api/v1/campanhas/metrics/summary no backend (reportado no outbox).

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
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
import { apiFetch } from "@/lib/api";
import { formatCurrency } from "@/lib/format";
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
  CampanhaMetricsLatest,
  CampanhaMetricsRow,
  CampanhaStatus,
  CampanhaTipo,
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

// Inclui "sem dados" como opcao explicita pra filtrar campanhas que ainda nao
// receberam dados do api_af.
const PACE_OPTIONS: { value: string; label: string }[] = [
  { value: "todos", label: "Todos" },
  { value: "OK", label: "OK" },
  { value: "OVERPACING", label: "Overpacing" },
  { value: "UNDERPACING", label: "Underpacing" },
  { value: "MUITO ABAIXO", label: "Muito abaixo" },
  { value: "SEM_DADOS", label: "Sem dados" }
];

// Linha do dashboard: campanha + metrics consolidadas pra ela.
interface CampanhaSummary {
  campanha: Campanha;
  // Row escolhida pra ser exibida (consolidado preferido, fallback pra primeira platform).
  row: CampanhaMetricsRow | null;
  // Data mais recente entre todas as plataformas (pra exibir "ultima atualizacao").
  reportDate: string | null;
  // True quando NENHUMA platform tem dados — empty state na linha.
  noData: boolean;
}

export default function DesempenhoDashboardPage() {
  return (
    <AppShell>
      <DesempenhoDashboard />
    </AppShell>
  );
}

function DesempenhoDashboard() {
  const [summaries, setSummaries] = useState<CampanhaSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<CampanhaStatus | "todos">(
    "todos"
  );
  const [tipoFilter, setTipoFilter] = useState<CampanhaTipo | "todos">("todos");
  const [paceFilter, setPaceFilter] = useState<string>("todos");

  const loadAll = async (opts?: { silent?: boolean }) => {
    if (opts?.silent) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const res: { items: Campanha[] } | Campanha[] = await apiFetch(
        "/campanhas"
      );
      const campanhas = Array.isArray(res) ? res : res?.items || [];

      // Promise.all pra metrics/latest de cada campanha.
      // settled (em vez de all) pra nao quebrar a lista inteira se 1 falhar.
      const results = await Promise.allSettled(
        campanhas.map((c) =>
          apiFetch(`/campanhas/${c.id}/metrics/latest`).then(
            (m) => m as CampanhaMetricsLatest
          )
        )
      );

      const next: CampanhaSummary[] = campanhas.map((campanha, i) => {
        const r = results[i];
        if (r.status === "rejected") {
          return { campanha, row: null, reportDate: null, noData: true };
        }
        const latest = r.value;
        const platforms = latest?.platforms || {};
        const keys = Object.keys(platforms) as MetricPlatform[];
        if (keys.length === 0 || !latest?.report_date) {
          return { campanha, row: null, reportDate: null, noData: true };
        }
        // Escolhe row: consolidado > android > ios > qualquer outra
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
          noData: row == null
        };
      });

      setSummaries(next);
    } catch (err: any) {
      const msg = err?.message || "";
      // 404/network: trata como lista vazia (mesmo padrao da /campanhas)
      if (msg && !/404|not found|failed to fetch/i.test(msg)) {
        setError(msg);
      }
      setSummaries([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

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

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-widest text-primary">
            Desempenho
          </h4>
          <h1 className="text-2xl font-semibold text-foreground">
            Dashboard cross-campanha
          </h1>
          <p className="mt-1 text-sm text-muted">
            KPIs consolidados (linha mais recente) de todas as campanhas.
          </p>
        </div>
        <button
          onClick={() => loadAll({ silent: true })}
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

      {error && (
        <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-danger/20 bg-danger/10 p-3">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-danger" />
          <p className="text-sm text-danger">{error}</p>
        </div>
      )}

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
          <EmptyStateNoCampanhas />
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
    </div>
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
  isLast
}: {
  summary: CampanhaSummary;
  isLast: boolean;
}) {
  const { campanha, row, reportDate, noData } = summary;
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

function EmptyStateNoCampanhas() {
  return (
    <div className="py-20 text-center">
      <Megaphone className="mx-auto mb-3 h-8 w-8 opacity-20" />
      <p className="mb-1 text-sm font-semibold text-foreground">
        Nenhuma campanha cadastrada.
      </p>
      <p className="mx-auto mb-5 max-w-md text-sm text-muted">
        Cadastre a primeira campanha pra comecar a ver os KPIs aqui.
      </p>
      <Link
        href="/campanhas/new"
        className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90"
      >
        <Plus className="h-4 w-4" />
        Criar primeira
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

