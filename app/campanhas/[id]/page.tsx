"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  Pencil,
  X,
  LineChart,
  Copy
} from "lucide-react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { CampanhaForm } from "@/components/campanha-form";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/lib/toast-context";
import {
  formatCurrency,
  formatMesAnoLong,
  nextMonthFirstDay,
  toMonthString
} from "@/lib/format";
import type {
  Campanha,
  CampanhaApp,
  CampanhaMediaSource,
  Moeda
} from "@/types";

export default function CampanhaDetailPage() {
  return (
    <AppShell>
      <CampanhaDetail />
    </AppShell>
  );
}

function CampanhaDetail() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const id = params?.id;

  const [campanha, setCampanha] = useState<Campanha | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [duplicating, setDuplicating] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const res: Campanha = await apiFetch(`/campanhas/${id}`);
        if (!cancelled) setCampanha(res);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || "Falha ao carregar campanha.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const handleDuplicate = async () => {
    if (!campanha) return;
    setDuplicating(true);
    try {
      const created: { id?: string } = await apiFetch(
        `/campanhas/${campanha.id}/duplicate`,
        { method: "POST", body: JSON.stringify({}) }
      );
      toast.success("Campanha duplicada.");
      setDuplicateOpen(false);
      if (created?.id) {
        router.push(`/campanhas/${created.id}`);
      }
    } catch (err: any) {
      const msg = err?.message || "Falha ao duplicar campanha.";
      if (/ja existe|already exists|409/i.test(msg)) {
        const nextMes = nextMonthFirstDay(campanha.mes_referencia || "");
        toast.error(
          `Ja existe campanha pro mes ${formatMesAnoLong(nextMes)}. Edite a existente.`
        );
      } else {
        toast.error(msg);
      }
    } finally {
      setDuplicating(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <Link
        href="/campanhas"
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
          <div className="mb-6 flex items-start justify-between gap-4">
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
                Campanha
              </h4>
              <h1 className="truncate text-2xl font-semibold text-foreground">
                {campanha.name}
              </h1>
            </div>
            <div className="flex items-center gap-2">
              {!editing && (
                <>
                  <button
                    type="button"
                    onClick={() => setDuplicateOpen(true)}
                    className="flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-background"
                    title="Duplicar pro proximo mes"
                  >
                    <Copy className="h-4 w-4" />
                    Duplicar pro proximo mes
                  </button>
                  <Link
                    href={`/campanhas/${campanha.id}/desempenho`}
                    className="flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-background"
                  >
                    <LineChart className="h-4 w-4" />
                    Desempenho
                  </Link>
                </>
              )}
              <button
                type="button"
                onClick={() => setEditing((v) => !v)}
                className="flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-background"
              >
                {editing ? (
                  <>
                    <X className="h-4 w-4" />
                    Cancelar
                  </>
                ) : (
                  <>
                    <Pencil className="h-4 w-4" />
                    Editar
                  </>
                )}
              </button>
            </div>
          </div>

          {editing ? (
            <CampanhaForm initial={campanha} campanhaId={campanha.id} />
          ) : (
            <CampanhaView campanha={campanha} />
          )}

          {duplicateOpen && (
            <DuplicateModal
              campanhaName={campanha.name}
              currentMes={campanha.mes_referencia}
              submitting={duplicating}
              onConfirm={handleDuplicate}
              onCancel={() => setDuplicateOpen(false)}
            />
          )}
        </>
      )}
    </div>
  );
}

function CampanhaView({ campanha }: { campanha: Campanha }) {
  return (
    <div className="space-y-6">
      <Section title="Identificacao">
        <Field label="Codigo">
          <p className="font-mono text-sm text-foreground">
            {campanha.codigo || "—"}
          </p>
        </Field>
        <Field label="Nome">
          <p className="text-sm text-foreground">{campanha.name}</p>
        </Field>
        <Field label="Status">
          <StatusBadge status={campanha.status} />
        </Field>
      </Section>

      <Section title="Tipo e budget">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Tipo">
            <p className="text-sm uppercase text-foreground">
              {campanha.tipo || "—"}
            </p>
          </Field>
          <Field label="Modo de budget">
            <p className="text-sm text-foreground">
              {campanha.budget_mode === "per_event"
                ? "Por evento"
                : campanha.budget_mode === "total"
                ? "Total unico"
                : "—"}
            </p>
          </Field>
          <Field label="MMP">
            <p className="text-sm uppercase text-foreground">
              {campanha.mmp === "adjust"
                ? "Adjust"
                : campanha.mmp === "appsflyer"
                ? "AppsFlyer"
                : "—"}
            </p>
          </Field>
          <Field label="Parceria Wave">
            <p className="text-sm text-foreground">
              {campanha.parceria_wave ? "Sim" : "Nao"}
            </p>
          </Field>
          <Field label="Timezone">
            <p className="text-sm text-foreground">
              {campanha.timezone || "—"}
            </p>
          </Field>
          <Field label="ID externo (api_af)">
            <p className="font-mono text-sm text-foreground">
              {campanha.external_id || "—"}
            </p>
          </Field>
          <Field label="Mes de referencia">
            <p className="text-sm text-foreground">
              {formatMesAnoLong(campanha.mes_referencia) || "—"}
            </p>
          </Field>
        </div>
      </Section>

      <Section title="Periodo">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Inicio">
            <p className="text-sm text-foreground">{fmtDate(campanha.inicio)}</p>
          </Field>
          <Field label="Fim">
            <p className="text-sm text-foreground">{fmtDate(campanha.fim)}</p>
          </Field>
        </div>
      </Section>

      <Section title="App e parceiro">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="App">
            <p className="text-sm text-foreground">{campanha.app || "—"}</p>
          </Field>
          <Field label="af_prt">
            <p className="text-sm text-foreground">{campanha.af_prt || "—"}</p>
          </Field>
          <Field label="Plataforma">
            <p className="text-sm text-foreground">
              {campanha.plataforma || "—"}
            </p>
          </Field>
        </div>
      </Section>

      <Section title="Financeiro">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Budget">
            <p className="text-sm text-foreground">
              {fmtBudget(campanha.budget, campanha.moeda)}
            </p>
          </Field>
          <Field label="Moeda">
            <p className="text-sm text-foreground">
              {moedaLabel(campanha.moeda)}
            </p>
          </Field>
          <Field label="Fluxo">
            <p className="text-sm text-foreground">{campanha.fluxo || "—"}</p>
          </Field>
        </div>
      </Section>

      <Section title="Eventos pagos">
        <EventosTable
          eventos={campanha.eventos_pagos}
          moeda={campanha.moeda}
          budgetMode={campanha.budget_mode}
        />
      </Section>

      <Section title="Apps">
        <AppsTable apps={campanha.apps} />
      </Section>

      <Section title="Media sources">
        <MediaSourcesTable
          sources={campanha.media_sources}
          moeda={campanha.moeda}
        />
      </Section>

      <Section title="Criativo e observacoes">
        <Field label="Criativo">
          <p className="whitespace-pre-wrap text-sm text-foreground">
            {campanha.criativo || "—"}
          </p>
        </Field>
        <Field label="Observacoes">
          <p className="whitespace-pre-wrap text-sm text-foreground">
            {campanha.obs || "—"}
          </p>
        </Field>
      </Section>

      <Section title="Metadados">
        <Field label="Owner">
          <p className="text-sm text-foreground">
            {campanha.owner_name || campanha.owner_id}
          </p>
        </Field>
        <Field label="Criada em">
          <p className="text-sm text-foreground">
            {fmtDateTime(campanha.created_at)}
          </p>
        </Field>
        {campanha.updated_at && (
          <Field label="Atualizada em">
            <p className="text-sm text-foreground">
              {fmtDateTime(campanha.updated_at)}
            </p>
          </Field>
        )}
      </Section>
    </div>
  );
}

function Section({
  title,
  children
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-xl border border-border bg-surface p-6">
      <h2 className="text-xs font-semibold uppercase tracking-widest text-primary">
        {title}
      </h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Field({
  label,
  children
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted">
        {label}
      </p>
      {children}
    </div>
  );
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  // Aceita "YYYY-MM-DD"
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(s);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("pt-BR");
}

function fmtDateTime(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR");
}

function fmtBudget(
  budget: number | null | undefined,
  moeda: Moeda | string | null | undefined
): string {
  return formatCurrency(budget, moeda);
}

function moedaLabel(m: Moeda | string | null | undefined): string {
  if (m === "USD") return "USD (U$)";
  if (m === "BRL") return "BRL (R$)";
  return "—";
}

function EventosTable({
  eventos,
  moeda,
  budgetMode
}: {
  eventos: Campanha["eventos_pagos"];
  moeda: Moeda | string | null | undefined;
  budgetMode?: Campanha["budget_mode"];
}) {
  if (!eventos || eventos.length === 0) {
    return <p className="text-sm text-muted">—</p>;
  }
  const showBudgetMonthly = budgetMode === "per_event";
  const totalPayout = eventos.reduce((acc, ev) => acc + (ev.payout ?? 0), 0);
  const totalBudget = showBudgetMonthly
    ? eventos.reduce((acc, ev) => acc + (ev.budget_monthly ?? 0), 0)
    : null;
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-background/40">
            <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted">
              Evento
            </th>
            <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-muted">
              PO (CPA)
            </th>
            <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-muted">
              Payout
            </th>
            {showBudgetMonthly && (
              <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-muted">
                Budget mensal
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {eventos.map((ev, i) => (
            <tr
              key={`${ev.nome}-${i}`}
              className={i < eventos.length - 1 ? "border-b border-border" : ""}
            >
              <td className="px-3 py-2 text-foreground">{ev.nome}</td>
              <td className="px-3 py-2 text-right font-mono text-foreground">
                {formatCurrency(ev.target_cpa, moeda)}
              </td>
              <td className="px-3 py-2 text-right font-mono text-foreground">
                {formatCurrency(ev.payout, moeda)}
              </td>
              {showBudgetMonthly && (
                <td className="px-3 py-2 text-right font-mono text-foreground">
                  {formatCurrency(ev.budget_monthly, moeda)}
                </td>
              )}
            </tr>
          ))}
          <tr className="border-t border-border bg-background/40">
            <td
              className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-muted"
              colSpan={2}
            >
              Total
            </td>
            <td className="px-3 py-2 text-right font-mono text-sm font-semibold text-foreground">
              {formatCurrency(totalPayout, moeda)}
            </td>
            {showBudgetMonthly && (
              <td className="px-3 py-2 text-right font-mono text-sm font-semibold text-foreground">
                {formatCurrency(totalBudget, moeda)}
              </td>
            )}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function AppsTable({ apps }: { apps: CampanhaApp[] | undefined }) {
  if (!apps || apps.length === 0) {
    return <p className="text-sm text-muted">—</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-background/40">
            <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted">
              Nome
            </th>
            <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted">
              App ID
            </th>
            <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted">
              Plataforma
            </th>
            <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted">
              P360
            </th>
            <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted">
              Primary attr.
            </th>
          </tr>
        </thead>
        <tbody>
          {apps.map((a, i) => (
            <tr
              key={a.id || `${a.app_id}-${i}`}
              className={i < apps.length - 1 ? "border-b border-border" : ""}
            >
              <td className="px-3 py-2 text-foreground">{a.name}</td>
              <td className="px-3 py-2 font-mono text-xs text-foreground">
                {a.app_id}
              </td>
              <td className="px-3 py-2 text-muted">{a.platform}</td>
              <td className="px-3 py-2 text-muted">
                {a.p360_enabled ? "sim" : "nao"}
              </td>
              <td className="px-3 py-2 text-muted">
                {a.only_primary_attribution !== false ? "sim" : "nao"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DuplicateModal({
  campanhaName,
  currentMes,
  submitting,
  onConfirm,
  onCancel
}: {
  campanhaName: string;
  currentMes: string | null | undefined;
  submitting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const fromLabel = formatMesAnoLong(currentMes) || "—";
  const toIso = nextMonthFirstDay(currentMes || "");
  const toLabel = formatMesAnoLong(toIso) || "—";
  const fromShort = toMonthString(currentMes || "")
    .replace(/^(\d{4})-(\d{2})$/, "$2/$1");
  const toShort = toIso.replace(/^(\d{4})-(\d{2})-\d{2}$/, "$2/$1");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h3 className="text-lg font-semibold text-foreground">
            Duplicar pro proximo mes
          </h3>
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="text-muted transition-colors hover:text-foreground disabled:opacity-50"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="mb-5 text-sm text-foreground">
          Duplicar &quot;
          <span className="font-medium">
            {campanhaName} — {fromShort || fromLabel}
          </span>
          &quot; pro mes{" "}
          <span className="font-semibold text-primary">
            {toShort || toLabel}
          </span>
          ? Vai copiar apps, media sources e eventos pagos. Voce edita depois se
          quiser ajustar budget/eventos.
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="rounded-lg border border-border bg-background px-4 py-2 text-sm text-muted transition-colors hover:text-foreground disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={submitting}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Confirmar
          </button>
        </div>
      </div>
    </div>
  );
}

function MediaSourcesTable({
  sources,
  moeda
}: {
  sources: CampanhaMediaSource[] | undefined;
  moeda: Moeda | string | null | undefined;
}) {
  if (!sources || sources.length === 0) {
    return <p className="text-sm text-muted">—</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-background/40">
            <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted">
              Nome
            </th>
            <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted">
              Tipo
            </th>
            <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-muted">
              Target CPI
            </th>
            <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-muted">
              Min. installs
            </th>
          </tr>
        </thead>
        <tbody>
          {sources.map((s, i) => (
            <tr
              key={s.id || `${s.name}-${i}`}
              className={
                i < sources.length - 1 ? "border-b border-border" : ""
              }
            >
              <td className="px-3 py-2 text-foreground">{s.name}</td>
              <td className="px-3 py-2 text-muted uppercase">
                {s.campaign_type}
              </td>
              <td className="px-3 py-2 text-right font-mono text-foreground">
                {s.campaign_type === "cpi"
                  ? formatCurrency(s.target_cpi, moeda)
                  : "—"}
              </td>
              <td className="px-3 py-2 text-right font-mono text-foreground">
                {s.min_installs_to_evaluate ?? 30}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
