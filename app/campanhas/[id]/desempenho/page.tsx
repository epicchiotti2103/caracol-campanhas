"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  RefreshCw,
  Info
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
  normalizePaceStatus
} from "@/lib/pace";
import type {
  Campanha,
  CampanhaMetricsHistory,
  CampanhaMetricsHistoryPoint,
  CampanhaMetricsLatest,
  CampanhaMetricsRow,
  MetricPlatform,
  Moeda
} from "@/types";

const PLATFORM_ORDER: MetricPlatform[] = ["consolidado", "android", "ios"];
const DAYS_OPTIONS = [7, 30, 90];

export default function DesempenhoPage() {
  return (
    <AppShell>
      <DesempenhoView />
    </AppShell>
  );
}

function DesempenhoView() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [campanha, setCampanha] = useState<Campanha | null>(null);
  const [latest, setLatest] = useState<CampanhaMetricsLatest | null>(null);
  const [history, setHistory] = useState<CampanhaMetricsHistory | null>(null);
  const [days, setDays] = useState<number>(30);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const loadAll = async (opts?: { silent?: boolean }) => {
    if (!id) return;
    if (opts?.silent) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const [c, l, h] = await Promise.all([
        apiFetch(`/campanhas/${id}`),
        apiFetch(`/campanhas/${id}/metrics/latest`),
        apiFetch(`/campanhas/${id}/metrics/history?days=${days}`)
      ]);
      setCampanha(c as Campanha);
      setLatest(l as CampanhaMetricsLatest);
      setHistory(h as CampanhaMetricsHistory);
    } catch (err: any) {
      setError(err?.message || "Falha ao carregar desempenho.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Re-fetch history when days change (mas mantem campanha e latest carregados)
  useEffect(() => {
    if (!id || !campanha) return;
    (async () => {
      setRefreshing(true);
      try {
        const h = await apiFetch(`/campanhas/${id}/metrics/history?days=${days}`);
        setHistory(h as CampanhaMetricsHistory);
      } catch {
        // mantem o historico antigo se falhar
      } finally {
        setRefreshing(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  const platformsOrdered: { platform: MetricPlatform; row: CampanhaMetricsRow }[] =
    useMemo(() => {
      if (!latest?.platforms) return [];
      const list: { platform: MetricPlatform; row: CampanhaMetricsRow }[] = [];
      for (const p of PLATFORM_ORDER) {
        const row = latest.platforms[p];
        if (row) list.push({ platform: p, row });
      }
      // Pega qualquer outro nao mapeado
      Object.entries(latest.platforms).forEach(([p, row]) => {
        if (!PLATFORM_ORDER.includes(p as MetricPlatform) && row) {
          list.push({ platform: p as MetricPlatform, row });
        }
      });
      return list;
    }, [latest]);

  const hasData = (latest?.report_date && platformsOrdered.length > 0) || false;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <Link
        href={id ? `/campanhas/${id}` : "/campanhas"}
        className="mb-4 inline-flex items-center gap-1 text-xs text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Voltar
      </Link>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : error ? (
        <div className="flex items-start gap-2.5 rounded-lg border border-danger/20 bg-danger/10 p-3">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-danger" />
          <p className="text-sm text-danger">{error}</p>
        </div>
      ) : !campanha ? (
        <p className="text-sm text-muted">Campanha nao encontrada.</p>
      ) : (
        <>
          <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              {campanha.codigo && (
                <p className="mb-1 inline-block rounded-md bg-primary/10 px-2 py-0.5 font-mono text-xs font-semibold tracking-wider text-primary">
                  {campanha.codigo}
                </p>
              )}
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-widest text-primary">
                Desempenho
              </h4>
              <h1 className="truncate text-2xl font-semibold text-foreground">
                {campanha.name}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                {campanha.tipo && (
                  <span className="rounded-md border border-border bg-surface px-2 py-0.5 uppercase">
                    {campanha.tipo}
                  </span>
                )}
                <StatusBadge status={campanha.status} />
                <span>
                  Ultima atualizacao:{" "}
                  <span className="text-foreground">
                    {fmtDate(latest?.report_date) || "—"}
                  </span>
                </span>
              </div>
            </div>
            <button
              onClick={() => loadAll({ silent: true })}
              disabled={refreshing}
              className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-muted transition-colors hover:bg-background disabled:opacity-50"
              title="Atualizar"
            >
              <RefreshCw
                className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
              />
              Atualizar
            </button>
          </div>

          {!hasData ? (
            <EmptyState externalId={campanha.external_id} />
          ) : (
            <>
              <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {platformsOrdered.map(({ platform, row }) => (
                  <PlatformCard
                    key={platform}
                    platform={platform}
                    row={row}
                    moeda={campanha.moeda}
                  />
                ))}
              </div>

              <section className="rounded-xl border border-border bg-surface p-5">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-xs font-semibold uppercase tracking-widest text-primary">
                      Historico de gasto
                    </h2>
                    <p className="mt-0.5 text-xs text-muted">
                      Spend diario (
                      {history?.series.length
                        ? primaryPlatformLabel(history.series)
                        : "sem dados"}
                      )
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    {DAYS_OPTIONS.map((opt) => (
                      <button
                        key={opt}
                        onClick={() => setDays(opt)}
                        className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                          days === opt
                            ? "bg-primary text-black"
                            : "bg-background text-muted hover:text-foreground"
                        }`}
                      >
                        {opt}d
                      </button>
                    ))}
                  </div>
                </div>
                <HistoryChart
                  series={history?.series || []}
                  moeda={campanha.moeda}
                />
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}

function PlatformCard({
  platform,
  row,
  moeda
}: {
  platform: MetricPlatform;
  row: CampanhaMetricsRow;
  moeda: Moeda | string | null | undefined;
}) {
  const spend = row.spend_actual ?? 0;
  const budget = row.budget_monthly ?? 0;
  const budgetUsedPct = row.budget_used_pct;
  const spendPacePct = row.spend_pace_pct;
  const paceStatus = normalizePaceStatus(row.pace_status);

  return (
    <article className="space-y-3 rounded-xl border border-border bg-surface p-5">
      <header className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-foreground">
          {platformLabel(platform)}
        </h3>
        <PaceBadge status={paceStatus} />
      </header>

      <div>
        <div className="mb-1 flex items-baseline justify-between">
          <span className="text-xs text-muted">Gasto / Budget</span>
          <span className="font-mono text-xs text-muted">
            {budgetUsedPct != null ? `${budgetUsedPct.toFixed(1)}%` : "—"}
          </span>
        </div>
        <p className="font-mono text-sm text-foreground">
          {formatCurrency(spend, moeda)}{" "}
          <span className="text-muted">/ {formatCurrency(budget, moeda)}</span>
        </p>
        <ProgressBar
          pct={budgetUsedPct ?? 0}
          color={paceColor(paceStatus, budgetUsedPct)}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 pt-1">
        <Metric
          label="% MTD"
          value={spendPacePct}
          format={(v) => `${v.toFixed(1)}%`}
          color={pacePctColor(spendPacePct)}
        />
        <Metric
          label="Budget usado"
          value={budgetUsedPct}
          format={(v) => `${v.toFixed(1)}%`}
        />
        <Metric
          label="Fraude P360"
          value={row.p360_event_rate}
          format={(v) => `${(v * 100).toFixed(1)}%`}
          color={fraudColor(row.p360_event_rate)}
        />
        <Metric
          label="PA False"
          value={row.pa_false_rate}
          format={(v) => `${(v * 100).toFixed(1)}%`}
          color={fraudColor(row.pa_false_rate)}
        />
      </div>
    </article>
  );
}

function Metric({
  label,
  value,
  format,
  color
}: {
  label: string;
  value: number | null | undefined;
  format: (v: number) => string;
  color?: string;
}) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p
        className={`mt-0.5 font-mono text-sm font-medium ${
          color || "text-foreground"
        }`}
      >
        {value == null ? "—" : format(value)}
      </p>
    </div>
  );
}

function ProgressBar({ pct, color }: { pct: number; color: string }) {
  const capped = Math.max(0, Math.min(pct, 100));
  return (
    <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-background">
      <div
        className={`h-full transition-all ${color}`}
        style={{ width: `${capped}%` }}
      />
    </div>
  );
}

function PaceBadge({ status }: { status: string }) {
  if (!status) {
    return (
      <span className="rounded-full border border-zinc-500/30 bg-zinc-500/10 px-2 py-0.5 text-xs font-medium text-zinc-300">
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

function platformLabel(p: MetricPlatform): string {
  if (p === "consolidado") return "Consolidado";
  return p;
}

function primaryPlatformLabel(series: CampanhaMetricsHistoryPoint[]): string {
  // Decidimos qual platform mostrar no grafico (consolidado preferido)
  if (series.some((s) => s.platform === "consolidado")) return "Consolidado";
  const first = series[0]?.platform;
  return first ? platformLabel(first) : "—";
}

function HistoryChart({
  series,
  moeda
}: {
  series: CampanhaMetricsHistoryPoint[];
  moeda: Moeda | string | null | undefined;
}) {
  // Filtra: prefere consolidado, senao primeira platform que aparecer
  const primaryPlatform: MetricPlatform | null = useMemo(() => {
    if (series.length === 0) return null;
    if (series.some((s) => s.platform === "consolidado")) return "consolidado";
    return series[0].platform;
  }, [series]);

  const data = useMemo(() => {
    if (!primaryPlatform) return [];
    return series
      .filter((s) => s.platform === primaryPlatform)
      .filter((s) => s.spend_actual != null)
      .sort((a, b) =>
        (a.report_date || "").localeCompare(b.report_date || "")
      );
  }, [series, primaryPlatform]);

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-dashed border-border bg-background py-12">
        <p className="text-sm text-muted">Sem dados pro periodo selecionado.</p>
      </div>
    );
  }

  const max = Math.max(...data.map((d) => d.spend_actual ?? 0));
  const min = Math.min(...data.map((d) => d.spend_actual ?? 0));
  const range = max - min || max || 1;
  const padding = { top: 10, right: 12, bottom: 28, left: 56 };
  const width = 800;
  const height = 240;
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;

  const x = (i: number) => {
    if (data.length === 1) return padding.left + innerW / 2;
    return padding.left + (i / (data.length - 1)) * innerW;
  };
  const y = (v: number) =>
    padding.top + innerH - ((v - min) / range) * innerH;

  const path = data
    .map((d, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(d.spend_actual ?? 0)}`)
    .join(" ");

  // 4 ticks no eixo Y
  const yTicks = 4;
  const yTickValues = Array.from({ length: yTicks + 1 }, (_, i) => {
    return min + (range * i) / yTicks;
  });

  // Ticks no eixo X: mostra ~6 datas espacadas
  const xTickStep = Math.max(1, Math.ceil(data.length / 6));
  const xTickIndices = data
    .map((_, i) => i)
    .filter((i) => i % xTickStep === 0 || i === data.length - 1);

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        style={{ minWidth: 400, height }}
        preserveAspectRatio="none"
      >
        {/* Grid horizontal */}
        {yTickValues.map((v, i) => (
          <g key={`y-${i}`}>
            <line
              x1={padding.left}
              x2={width - padding.right}
              y1={y(v)}
              y2={y(v)}
              stroke="currentColor"
              strokeOpacity={0.08}
              strokeDasharray="3 3"
            />
            <text
              x={padding.left - 8}
              y={y(v) + 4}
              textAnchor="end"
              fontSize="10"
              fill="currentColor"
              opacity="0.55"
            >
              {formatCurrencyShort(v, moeda)}
            </text>
          </g>
        ))}

        {/* X labels */}
        {xTickIndices.map((i) => (
          <text
            key={`x-${i}`}
            x={x(i)}
            y={height - padding.bottom + 16}
            textAnchor="middle"
            fontSize="10"
            fill="currentColor"
            opacity="0.55"
          >
            {fmtShortDate(data[i].report_date)}
          </text>
        ))}

        {/* Path */}
        <path
          d={path}
          fill="none"
          stroke="rgb(251, 146, 60)"
          strokeWidth={2}
        />

        {/* Pontos */}
        {data.map((d, i) => (
          <circle
            key={`pt-${i}`}
            cx={x(i)}
            cy={y(d.spend_actual ?? 0)}
            r={3}
            fill="rgb(251, 146, 60)"
          >
            <title>{`${d.report_date}: ${formatCurrency(
              d.spend_actual,
              moeda
            )}`}</title>
          </circle>
        ))}
      </svg>
    </div>
  );
}

function EmptyState({
  externalId
}: {
  externalId: string | null | undefined;
}) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-surface p-8 text-center">
      <Info className="mx-auto mb-3 h-8 w-8 text-muted opacity-50" />
      <h3 className="mb-2 text-sm font-semibold text-foreground">
        Sem dados de performance ainda.
      </h3>
      <p className="mx-auto max-w-md text-sm text-muted">
        O robo api_af envia diariamente apos 8h. Verifique se o{" "}
        <code className="rounded bg-background px-1.5 py-0.5 font-mono text-xs text-foreground">
          external_id
        </code>{" "}
        da campanha bate com o{" "}
        <code className="rounded bg-background px-1.5 py-0.5 font-mono text-xs text-foreground">
          product_name
        </code>{" "}
        no <code className="font-mono">config/apps.yaml</code> do api_af.
      </p>
      {externalId ? (
        <p className="mt-3 text-xs text-muted">
          external_id atual:{" "}
          <span className="font-mono text-foreground">{externalId}</span>
        </p>
      ) : (
        <p className="mt-3 text-xs text-amber-300">
          Atencao: external_id nao configurado.
        </p>
      )}
    </div>
  );
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return s;
}

function fmtShortDate(s: string | null | undefined): string {
  if (!s) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[3]}/${m[2]}`;
  return s;
}

function formatCurrencyShort(
  v: number,
  moeda: Moeda | string | null | undefined
): string {
  const sym = moeda === "USD" ? "$" : "R$";
  if (Math.abs(v) >= 1_000_000) return `${sym} ${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `${sym} ${(v / 1_000).toFixed(0)}k`;
  return `${sym} ${v.toFixed(0)}`;
}
