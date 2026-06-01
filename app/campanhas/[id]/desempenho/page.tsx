"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  RefreshCw,
  Info,
  Plus,
  X,
  Trash2
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { CampanhaFechamentoModal } from "@/components/campanha-fechamento-modal";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/lib/toast-context";
import {
  blurFormatNumberPtBr,
  formatCurrency,
  formatMesAnoLong,
  parseNumberPtBr,
  sanitizeNumberInput,
  toMonthString
} from "@/lib/format";
import {
  paceColor,
  pacePctColor,
  fraudColor,
  paceBadgeClasses,
  normalizePaceStatus
} from "@/lib/pace";
import type {
  Campanha,
  CampanhaMetricsLatest,
  CampanhaMetricsManualPayload,
  CampanhaMetricsRow,
  CampanhaPublisherInput,
  CampanhaPublisherRow,
  CampanhaPublishersResponse,
  Fechamento,
  MetricPlatform,
  Moeda
} from "@/types";

const PLATFORM_ORDER: MetricPlatform[] = ["consolidado", "android", "ios"];

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
  const [publishers, setPublishers] = useState<CampanhaPublishersResponse | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [fechamentoOpen, setFechamentoOpen] = useState(false);
  const [fechamento, setFechamento] = useState<Fechamento | null>(null);

  const loadAll = async (opts?: { silent?: boolean }) => {
    if (!id) return;
    if (opts?.silent) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const [c, l] = await Promise.all([
        apiFetch(`/campanhas/${id}`),
        apiFetch(`/campanhas/${id}/metrics/latest`)
      ]);
      const campanhaData = c as Campanha;
      setCampanha(campanhaData);
      setLatest(l as CampanhaMetricsLatest);

      // Publishers: usa o mes_referencia da campanha (nao o mes selecionado em outro lugar)
      const mesParam = toMonthString(campanhaData.mes_referencia);
      const pubsQuery = mesParam ? `?month=${mesParam}` : "";
      try {
        const p = (await apiFetch(
          `/campanhas/${id}/metrics/publishers${pubsQuery}`
        )) as CampanhaPublishersResponse;
        setPublishers(p);
      } catch {
        // Sem publishers ainda — render empty state na tabela
        setPublishers({ month: mesParam || null, report_date: null, rows: [] });
      }

      // Fechamento: pega status atual pra mostrar texto certo no botao.
      // Backend retorna stub (id=null) se ainda nao foi salvo — tratamos como
      // "Fechar mes" no botao.
      if (mesParam) {
        try {
          const f = (await apiFetch(
            `/campanhas/${id}/fechamento?month=${mesParam}`
          )) as Fechamento;
          setFechamento(f);
        } catch {
          setFechamento(null);
        }
      }
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

  const platformsOrdered: { platform: MetricPlatform; row: CampanhaMetricsRow }[] =
    useMemo(() => {
      if (!latest?.platforms) return [];
      const list: { platform: MetricPlatform; row: CampanhaMetricsRow }[] = [];
      for (const p of PLATFORM_ORDER) {
        const row = latest.platforms[p];
        if (row) list.push({ platform: p, row });
      }
      Object.entries(latest.platforms).forEach(([p, row]) => {
        if (!PLATFORM_ORDER.includes(p as MetricPlatform) && row) {
          list.push({ platform: p as MetricPlatform, row });
        }
      });
      return list;
    }, [latest]);

  const hasData = (latest?.report_date && platformsOrdered.length > 0) || false;
  // Input manual liberado pra Adjust OU campanha marcada coleta_manual
  // (ex: parceiro AppsFlyer sem coleta automatica).
  const canInputManual =
    campanha?.mmp === "adjust" || !!campanha?.coleta_manual;

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
              <div className="mb-1 flex flex-wrap items-center gap-1.5">
                {campanha.codigo && (
                  <span className="inline-block rounded-md bg-primary/10 px-2 py-0.5 font-mono text-xs font-semibold tracking-wider text-primary">
                    {campanha.codigo}
                  </span>
                )}
                {campanha.mes_referencia && (
                  <span className="inline-block rounded-md border border-border bg-background px-2 py-0.5 text-xs font-medium text-foreground">
                    {formatMesAnoLong(campanha.mes_referencia)}
                  </span>
                )}
              </div>
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
                {campanha.mmp && (
                  <span className="rounded-md border border-border bg-surface px-2 py-0.5 uppercase">
                    {campanha.mmp}
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
            <div className="flex items-center gap-2">
              {canInputManual && (
                <button
                  type="button"
                  onClick={() => setManualOpen(true)}
                  className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-background"
                >
                  <Plus className="h-4 w-4" />
                  Inserir metrics manualmente
                </button>
              )}
              <FechamentoButton
                fechamento={fechamento}
                onClick={() => setFechamentoOpen(true)}
              />
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
          </div>

          {!hasData ? (
            <EmptyState externalId={campanha.external_id} />
          ) : (
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
          )}

          <PublishersSection
            data={publishers}
            moeda={campanha.moeda}
          />

          {manualOpen && (
            <ManualMetricsModal
              campanhaId={campanha.id}
              moeda={campanha.moeda}
              onClose={() => setManualOpen(false)}
              onSuccess={() => {
                setManualOpen(false);
                loadAll({ silent: true });
              }}
            />
          )}

          {fechamentoOpen && (
            <CampanhaFechamentoModal
              campanhaId={campanha.id}
              campanhaNome={campanha.name}
              month={toMonthString(campanha.mes_referencia) || ""}
              moeda={campanha.moeda}
              onClose={() => setFechamentoOpen(false)}
              onSaved={(f) => {
                setFechamento(f);
              }}
            />
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

function PublishersSection({
  data,
  moeda
}: {
  data: CampanhaPublishersResponse | null;
  moeda: Moeda | string | null | undefined;
}) {
  // Filtra rows: consolidado por default
  const consolidatedRows: CampanhaPublisherRow[] = useMemo(() => {
    if (!data?.rows) return [];
    const consolidated = data.rows.filter((r) => r.platform === "consolidado");
    if (consolidated.length > 0) return consolidated;
    // Fallback: se nao tem consolidado, usa todas
    return data.rows;
  }, [data]);

  const sorted = useMemo(() => {
    return [...consolidatedRows].sort(
      (a, b) => (b.spend_actual ?? 0) - (a.spend_actual ?? 0)
    );
  }, [consolidatedRows]);

  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-primary">
            Publishers
          </h2>
          <p className="mt-0.5 text-xs text-muted">
            Spend por publisher{" "}
            {data?.report_date && (
              <>
                — atualizado em{" "}
                <span className="text-foreground">
                  {fmtDate(data.report_date)}
                </span>
              </>
            )}
          </p>
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-background p-8 text-center">
          <Info className="mx-auto mb-3 h-8 w-8 text-muted opacity-50" />
          <p className="text-sm text-muted">
            Sem dados de publisher ainda. O api_af envia diariamente apos 8h
            (precisa de{" "}
            <code className="rounded bg-surface px-1 py-0.5 font-mono text-xs text-foreground">
              publishers_lookup.enabled = true
            </code>{" "}
            no apps.yaml).
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-background/40">
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted">
                  Publisher
                </th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-muted">
                  Spend
                </th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-muted">
                  Installs/Conv
                </th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-muted">
                  % P360
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => (
                <tr
                  key={`${r.publisher}-${r.platform}-${i}`}
                  className={
                    i < sorted.length - 1 ? "border-b border-border" : ""
                  }
                >
                  <td className="px-3 py-2 text-foreground">
                    {r.publisher || "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-foreground">
                    {formatCurrency(r.spend_actual, moeda)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-foreground">
                    {r.installs_or_conversions != null
                      ? r.installs_or_conversions.toLocaleString("pt-BR")
                      : "—"}
                  </td>
                  <td
                    className={`px-3 py-2 text-right font-mono ${fraudColor(
                      r.p360_event_rate
                    )}`}
                  >
                    {r.p360_event_rate != null
                      ? `${(r.p360_event_rate * 100).toFixed(1)}%`
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ---------- Manual metrics modal (Adjust) ----------

interface ManualPlatformRow {
  platform: MetricPlatform;
  spend_actual: string;
}

interface ManualPublisherRow {
  name: string;
  spend: string;
  installs_or_conversions: string;
  p360_event_rate: string;
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function firstDayOfMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function ManualMetricsModal({
  campanhaId,
  moeda,
  onClose,
  onSuccess
}: {
  campanhaId: string;
  moeda: Moeda | string | null | undefined;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const toast = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [reportDate, setReportDate] = useState(todayIso());
  const [dateFrom, setDateFrom] = useState(firstDayOfMonth());
  const [dateTo, setDateTo] = useState(todayIso());
  const [platforms, setPlatforms] = useState<ManualPlatformRow[]>([
    {
      platform: "consolidado",
      spend_actual: ""
    }
  ]);
  const [pubRows, setPubRows] = useState<ManualPublisherRow[]>([]);

  const updatePlatform = (idx: number, patch: Partial<ManualPlatformRow>) => {
    setPlatforms((prev) =>
      prev.map((row, i) => (i === idx ? { ...row, ...patch } : row))
    );
  };
  const addPlatform = () => {
    setPlatforms((prev) => [
      ...prev,
      {
        platform: "android",
        spend_actual: ""
      }
    ]);
  };
  const removePlatform = (idx: number) =>
    setPlatforms((prev) => prev.filter((_, i) => i !== idx));

  const updatePub = (idx: number, patch: Partial<ManualPublisherRow>) => {
    setPubRows((prev) =>
      prev.map((row, i) => (i === idx ? { ...row, ...patch } : row))
    );
  };
  const addPub = () =>
    setPubRows((prev) => [
      ...prev,
      {
        name: "",
        spend: "",
        installs_or_conversions: "",
        p360_event_rate: ""
      }
    ]);
  const removePub = (idx: number) =>
    setPubRows((prev) => prev.filter((_, i) => i !== idx));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!reportDate || !dateFrom || !dateTo) {
      setError("Datas obrigatorias (report_date, date_from, date_to).");
      return;
    }

    const platformsPayload: CampanhaMetricsManualPayload["platforms"] = {};
    for (const row of platforms) {
      const spend = row.spend_actual.trim()
        ? parseNumberPtBr(row.spend_actual)
        : null;
      if (spend != null && (Number.isNaN(spend) || spend < 0)) {
        setError(`Spend invalido na plataforma ${row.platform}.`);
        return;
      }
      platformsPayload[row.platform] = {
        platform: row.platform,
        spend_actual: spend
      };
    }

    const publishersPayload: CampanhaPublisherInput[] = [];
    for (const row of pubRows) {
      const name = row.name.trim();
      if (!name) continue;
      const spend = row.spend.trim() ? parseNumberPtBr(row.spend) : null;
      if (spend != null && (Number.isNaN(spend) || spend < 0)) {
        setError(`Spend invalido no publisher "${name}".`);
        return;
      }
      const installs = row.installs_or_conversions.trim()
        ? Number(row.installs_or_conversions)
        : null;
      if (installs != null && (Number.isNaN(installs) || installs < 0)) {
        setError(`Installs/Conv invalido no publisher "${name}".`);
        return;
      }
      const p360Raw = row.p360_event_rate.trim();
      // Aceita "5,2" como 5.2% -> 0.052, ou "0,052" como 5.2% — pra evitar ambiguidade,
      // tratar como percentual (user digita 5 = 5%) e dividir por 100.
      let p360: number | null = null;
      if (p360Raw) {
        const n = parseNumberPtBr(p360Raw);
        if (Number.isNaN(n) || n < 0) {
          setError(`% P360 invalido no publisher "${name}".`);
          return;
        }
        p360 = n > 1 ? n / 100 : n;
      }
      publishersPayload.push({
        name,
        platform: "consolidado",
        spend,
        installs_or_conversions: installs,
        p360_event_rate: p360
      });
    }

    const payload: CampanhaMetricsManualPayload = {
      report_date: reportDate,
      date_from: dateFrom,
      date_to: dateTo,
      platforms: platformsPayload,
      publishers: publishersPayload.length > 0 ? publishersPayload : undefined
    };

    setSubmitting(true);
    try {
      await apiFetch(`/campanhas/${campanhaId}/metrics/manual`, {
        method: "POST",
        body: JSON.stringify(payload)
      });
      toast.success("Metrics inseridos.");
      onSuccess();
    } catch (err: any) {
      setError(err?.message || "Falha ao inserir metrics.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-border bg-surface p-6 shadow-xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h3 className="text-lg font-semibold text-foreground">
            Inserir metrics manualmente
          </h3>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="text-muted transition-colors hover:text-foreground disabled:opacity-50"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {error && (
            <div className="flex items-start gap-2.5 rounded-lg border border-danger/20 bg-danger/10 p-3">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-danger" />
              <p className="text-sm text-danger">{error}</p>
            </div>
          )}

          <fieldset className="space-y-3">
            <legend className="text-xs font-semibold uppercase tracking-wider text-primary">
              Periodo
            </legend>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className="block">
                <span className="mb-1 block text-sm text-foreground">
                  Report date
                </span>
                <input
                  type="date"
                  value={reportDate}
                  onChange={(e) => setReportDate(e.target.value)}
                  className={modalInputCls}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm text-foreground">
                  Date from
                </span>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className={modalInputCls}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm text-foreground">
                  Date to
                </span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className={modalInputCls}
                />
              </label>
            </div>
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="text-xs font-semibold uppercase tracking-wider text-primary">
              Spend por plataforma
            </legend>
            {platforms.map((row, idx) => (
              <div
                key={idx}
                className="space-y-2 rounded-lg border border-border bg-background p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <select
                    value={row.platform}
                    onChange={(e) =>
                      updatePlatform(idx, {
                        platform: e.target.value as MetricPlatform
                      })
                    }
                    className={`${modalInputCls} max-w-[200px]`}
                  >
                    <option value="consolidado">consolidado</option>
                    <option value="android">android</option>
                    <option value="ios">ios</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => removePlatform(idx)}
                    disabled={platforms.length <= 1}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-surface text-muted transition-colors hover:border-danger/40 hover:text-danger disabled:opacity-30"
                    aria-label="Remover plataforma"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-2">
                  <label className="block">
                    <span className="mb-1 block text-xs text-muted">
                      Spend ({moeda === "USD" ? "$" : "R$"})
                    </span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={row.spend_actual}
                      onChange={(e) =>
                        updatePlatform(idx, {
                          spend_actual: sanitizeNumberInput(e.target.value)
                        })
                      }
                      onBlur={(e) =>
                        updatePlatform(idx, {
                          spend_actual: blurFormatNumberPtBr(e.target.value)
                        })
                      }
                      placeholder="0,00"
                      className={modalInputCls}
                    />
                  </label>
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={addPlatform}
              className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border bg-background px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-primary/40 hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" />
              Adicionar plataforma
            </button>
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="text-xs font-semibold uppercase tracking-wider text-primary">
              Publishers (opcional)
            </legend>
            {pubRows.length === 0 && (
              <p className="text-xs text-muted">
                Nenhum publisher adicionado. Use o botao abaixo se quiser
                detalhar.
              </p>
            )}
            {pubRows.map((row, idx) => (
              <div
                key={idx}
                className="grid grid-cols-1 items-end gap-2 rounded-lg border border-border bg-background p-3 sm:grid-cols-[1fr,1fr,1fr,1fr,auto]"
              >
                <label className="block">
                  <span className="mb-1 block text-xs text-muted">
                    Publisher
                  </span>
                  <input
                    type="text"
                    value={row.name}
                    onChange={(e) =>
                      updatePub(idx, { name: e.target.value })
                    }
                    placeholder="Ex: googleadwords_int"
                    className={modalInputCls}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-muted">
                    Spend ({moeda === "USD" ? "$" : "R$"})
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={row.spend}
                    onChange={(e) =>
                      updatePub(idx, {
                        spend: sanitizeNumberInput(e.target.value)
                      })
                    }
                    onBlur={(e) =>
                      updatePub(idx, {
                        spend: blurFormatNumberPtBr(e.target.value)
                      })
                    }
                    placeholder="0,00"
                    className={modalInputCls}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-muted">
                    Installs/Conv
                  </span>
                  <input
                    type="number"
                    min="0"
                    value={row.installs_or_conversions}
                    onChange={(e) =>
                      updatePub(idx, {
                        installs_or_conversions: e.target.value
                      })
                    }
                    placeholder="0"
                    className={modalInputCls}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-muted">
                    % P360
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={row.p360_event_rate}
                    onChange={(e) =>
                      updatePub(idx, {
                        p360_event_rate: sanitizeNumberInput(e.target.value)
                      })
                    }
                    onBlur={(e) =>
                      updatePub(idx, {
                        p360_event_rate: blurFormatNumberPtBr(e.target.value)
                      })
                    }
                    placeholder="0,0"
                    className={modalInputCls}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => removePub(idx)}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface text-muted transition-colors hover:border-danger/40 hover:text-danger"
                  aria-label="Remover publisher"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={addPub}
              className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border bg-background px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-primary/40 hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" />
              Adicionar publisher
            </button>
          </fieldset>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-lg border border-border bg-background px-4 py-2 text-sm text-muted transition-colors hover:text-foreground disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {submitting ? "Enviando..." : "Salvar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const modalInputCls =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-primary/60";

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

function FechamentoButton({
  fechamento,
  onClick
}: {
  fechamento: Fechamento | null;
  onClick: () => void;
}) {
  const isPersisted = !!fechamento?.id;
  const isLocked = !!(fechamento?.is_locked || fechamento?.locked);

  let label = "Fechar mes";
  let cls =
    "border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20";
  if (isLocked) {
    label = "Ver fechamento (travado)";
    cls =
      "border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20";
  } else if (isPersisted) {
    label = "Editar fechamento";
    cls =
      "border border-amber-500/40 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20";
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${cls}`}
    >
      {label}
    </button>
  );
}
