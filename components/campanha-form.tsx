"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, AlertCircle, Plus, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/lib/toast-context";
import {
  blurFormatNumberPtBr,
  formatNumberPtBr,
  moedaShort,
  parseNumberPtBr,
  sanitizeNumberInput
} from "@/lib/format";
import type {
  AppPlatform,
  Campanha,
  CampanhaApp,
  CampanhaBudgetMode,
  CampanhaEvento,
  CampanhaMediaSource,
  CampanhaMMP,
  CampanhaStatus,
  CampanhaTipo,
  MediaSourceCampaignType,
  Moeda
} from "@/types";

const STATUS_OPTIONS: { value: CampanhaStatus; label: string }[] = [
  { value: "ativa", label: "Ativa" },
  { value: "pausada", label: "Pausada" },
  { value: "encerrada", label: "Encerrada" }
];

const MOEDA_OPTIONS: { value: Moeda; label: string; short: string }[] = [
  { value: "BRL", label: "R$ (BRL)", short: "R$" },
  { value: "USD", label: "U$ (USD)", short: "U$" }
];

const TIMEZONE_OPTIONS: { value: string; label: string }[] = [
  { value: "America/Sao_Paulo", label: "America/Sao_Paulo (BRT)" },
  { value: "UTC", label: "UTC" },
  { value: "America/New_York", label: "America/New_York (ET)" },
  { value: "Asia/Hong_Kong", label: "Asia/Hong_Kong (HKT)" }
];

const MESES_LABELS = [
  "Janeiro",
  "Fevereiro",
  "Marco",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro"
];

interface CampanhaFormProps {
  initial?: Campanha | null;
  /** Quando passado, o form faz PATCH /campanhas/{id} em vez de POST */
  campanhaId?: string;
}

interface EventoRow {
  nome: string;
  payout: string;
  target_cpa: string;
  budget_monthly: string;
}

interface AppRow {
  name: string;
  app_id: string;
  platform: AppPlatform;
  p360_enabled: boolean;
  only_primary_attribution: boolean;
}

interface MediaSourceRow {
  name: string;
  campaign_type: MediaSourceCampaignType;
  target_cpi: string;
  min_installs_to_evaluate: string;
}

function toDateInput(s: string | null | undefined): string {
  if (!s) return "";
  return s.length >= 10 ? s.slice(0, 10) : "";
}

function normalizeMoeda(m: string | null | undefined): Moeda {
  return m === "USD" ? "USD" : "BRL";
}

function eventoToRow(e: CampanhaEvento): EventoRow {
  return {
    nome: e.nome ?? "",
    payout: e.payout != null ? formatNumberPtBr(e.payout) : "",
    target_cpa: e.target_cpa != null ? formatNumberPtBr(e.target_cpa) : "",
    budget_monthly:
      e.budget_monthly != null ? formatNumberPtBr(e.budget_monthly) : ""
  };
}

function appToRow(a: CampanhaApp): AppRow {
  return {
    name: a.name ?? "",
    app_id: a.app_id ?? "",
    platform: a.platform ?? "android",
    p360_enabled: !!a.p360_enabled,
    only_primary_attribution: a.only_primary_attribution !== false
  };
}

function mediaSourceToRow(m: CampanhaMediaSource): MediaSourceRow {
  return {
    name: m.name ?? "",
    campaign_type: m.campaign_type ?? "cpa",
    target_cpi: m.target_cpi != null ? formatNumberPtBr(m.target_cpi) : "",
    min_installs_to_evaluate:
      m.min_installs_to_evaluate != null
        ? String(m.min_installs_to_evaluate)
        : "30"
  };
}

export function CampanhaForm({ initial, campanhaId }: CampanhaFormProps) {
  const router = useRouter();
  const toast = useToast();
  const isEdit = Boolean(campanhaId);

  // Identificacao
  const [name, setName] = useState(initial?.name ?? "");
  const [status, setStatus] = useState<CampanhaStatus>(
    initial?.status ?? "ativa"
  );

  // Periodo
  const [inicio, setInicio] = useState(toDateInput(initial?.inicio));
  const [fim, setFim] = useState(toDateInput(initial?.fim));

  // App e parceiro
  const [app, setApp] = useState(initial?.app ?? "");
  const [afPrt, setAfPrt] = useState(initial?.af_prt ?? "");
  const [plataforma, setPlataforma] = useState(initial?.plataforma ?? "");

  // Financeiro
  const [budget, setBudget] = useState<string>(
    initial?.budget != null ? formatNumberPtBr(initial.budget) : ""
  );
  const [moeda, setMoeda] = useState<Moeda>(normalizeMoeda(initial?.moeda));
  const [fluxo, setFluxo] = useState(initial?.fluxo ?? "");

  // Tipo / budget_mode / timezone / external_id (api_af)
  const [tipo, setTipo] = useState<CampanhaTipo>(
    (initial?.tipo as CampanhaTipo) || "ua"
  );
  const [budgetMode, setBudgetMode] = useState<CampanhaBudgetMode>(
    (initial?.budget_mode as CampanhaBudgetMode) || "total"
  );
  const [timezone, setTimezone] = useState<string>(
    initial?.timezone || "America/Sao_Paulo"
  );
  const [externalId, setExternalId] = useState<string>(
    initial?.external_id || ""
  );

  // mes_referencia (Fase 2): UI = 2 selects (mes 01-12, ano corrente +/- 1 / +1).
  // Default = mes corrente. Valor salvo: YYYY-MM-01.
  const today = new Date();
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth() + 1; // 1..12
  const parseMesRef = (
    raw: string | null | undefined
  ): { mes: number; ano: number } => {
    if (raw) {
      const m = /^(\d{4})-(\d{2})/.exec(raw);
      if (m) return { mes: parseInt(m[2], 10), ano: parseInt(m[1], 10) };
    }
    return { mes: currentMonth, ano: currentYear };
  };
  const initialMesRef = parseMesRef(initial?.mes_referencia);
  const [mesRefMes, setMesRefMes] = useState<number>(initialMesRef.mes);
  const [mesRefAno, setMesRefAno] = useState<number>(initialMesRef.ano);

  // mmp (Fase 2): default appsflyer
  const [mmp, setMmp] = useState<CampanhaMMP>(
    (initial?.mmp as CampanhaMMP) || "appsflyer"
  );

  // Eventos pagos — comeca com 1 linha vazia se nao tem nada
  const [eventos, setEventos] = useState<EventoRow[]>(
    initial?.eventos_pagos && initial.eventos_pagos.length > 0
      ? initial.eventos_pagos.map(eventoToRow)
      : [{ nome: "", payout: "", target_cpa: "", budget_monthly: "" }]
  );

  // Apps (api_af) — comeca vazio (nao obrigatorio)
  const [apps, setApps] = useState<AppRow[]>(
    initial?.apps && initial.apps.length > 0 ? initial.apps.map(appToRow) : []
  );

  // Media sources — comeca vazio
  const [mediaSources, setMediaSources] = useState<MediaSourceRow[]>(
    initial?.media_sources && initial.media_sources.length > 0
      ? initial.media_sources.map(mediaSourceToRow)
      : []
  );

  // Criativo e observacoes
  const [criativo, setCriativo] = useState(initial?.criativo ?? "");
  const [obs, setObs] = useState(initial?.obs ?? "");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // ---- helpers eventos ----
  const updateEvento = (idx: number, patch: Partial<EventoRow>) => {
    setEventos((prev) =>
      prev.map((row, i) => (i === idx ? { ...row, ...patch } : row))
    );
  };
  const addEvento = () =>
    setEventos((prev) => [
      ...prev,
      { nome: "", payout: "", target_cpa: "", budget_monthly: "" }
    ]);
  const removeEvento = (idx: number) => {
    setEventos((prev) =>
      prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)
    );
  };

  // ---- helpers apps ----
  const updateApp = (idx: number, patch: Partial<AppRow>) => {
    setApps((prev) =>
      prev.map((row, i) => (i === idx ? { ...row, ...patch } : row))
    );
  };
  const addApp = () =>
    setApps((prev) => [
      ...prev,
      {
        name: "",
        app_id: "",
        platform: "android",
        p360_enabled: false,
        only_primary_attribution: true
      }
    ]);
  const removeApp = (idx: number) =>
    setApps((prev) => prev.filter((_, i) => i !== idx));

  // ---- helpers media sources ----
  const updateMediaSource = (idx: number, patch: Partial<MediaSourceRow>) => {
    setMediaSources((prev) =>
      prev.map((row, i) => (i === idx ? { ...row, ...patch } : row))
    );
  };
  const addMediaSource = () =>
    setMediaSources((prev) => [
      ...prev,
      {
        name: "",
        campaign_type: "cpa",
        target_cpi: "",
        min_installs_to_evaluate: "30"
      }
    ]);
  const removeMediaSource = (idx: number) =>
    setMediaSources((prev) => prev.filter((_, i) => i !== idx));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Informe o nome da campanha.");
      return;
    }

    // Parse budget
    let parsedBudget: number | null = null;
    if (budget.trim()) {
      parsedBudget = parseNumberPtBr(budget);
      if (Number.isNaN(parsedBudget) || parsedBudget < 0) {
        setError("Budget invalido. Use um numero >= 0.");
        return;
      }
    }

    // Eventos
    const cleanEventos: CampanhaEvento[] = [];
    for (const row of eventos) {
      const nomeTrim = row.nome.trim();
      if (!nomeTrim) continue;

      const parseOpt = (
        raw: string,
        field: string
      ): number | null | "ERR" => {
        const s = raw.trim();
        if (!s) return null;
        const n = parseNumberPtBr(s);
        if (Number.isNaN(n) || n < 0) {
          setError(`${field} invalido no evento "${nomeTrim}". Use um numero >= 0.`);
          return "ERR";
        }
        return n;
      };

      const payout = parseOpt(row.payout, "Payout");
      if (payout === "ERR") return;
      const targetCpa = parseOpt(row.target_cpa, "PO (CPA)");
      if (targetCpa === "ERR") return;

      let budgetMonthly: number | null = null;
      if (budgetMode === "per_event") {
        const parsed = parseOpt(row.budget_monthly, "Budget mensal");
        if (parsed === "ERR") return;
        if (parsed == null) {
          setError(
            `Budget mensal e obrigatorio no evento "${nomeTrim}" (budget por evento).`
          );
          return;
        }
        budgetMonthly = parsed;
      }

      cleanEventos.push({
        nome: nomeTrim,
        payout,
        target_cpa: targetCpa,
        budget_monthly: budgetMonthly
      });
    }

    // Apps
    const cleanApps: CampanhaApp[] = [];
    for (let i = 0; i < apps.length; i++) {
      const row = apps[i];
      const nameTrim = row.name.trim();
      const appIdTrim = row.app_id.trim();
      if (!nameTrim && !appIdTrim) continue; // skip linhas totalmente vazias
      if (!nameTrim || !appIdTrim) {
        setError(`App ${i + 1}: preencha nome e app_id (ou remova a linha).`);
        return;
      }
      cleanApps.push({
        name: nameTrim,
        app_id: appIdTrim,
        platform: row.platform,
        p360_enabled: row.p360_enabled,
        only_primary_attribution: row.only_primary_attribution,
        ordem: i
      });
    }

    // Media sources
    const cleanMediaSources: CampanhaMediaSource[] = [];
    for (let i = 0; i < mediaSources.length; i++) {
      const row = mediaSources[i];
      const nameTrim = row.name.trim();
      if (!nameTrim) continue;

      let targetCpi: number | null = null;
      if (row.campaign_type === "cpi") {
        if (row.target_cpi.trim()) {
          targetCpi = parseNumberPtBr(row.target_cpi);
          if (Number.isNaN(targetCpi) || targetCpi < 0) {
            setError(`Media source "${nameTrim}": target_cpi invalido.`);
            return;
          }
        }
      }

      let minInstalls = 30;
      if (row.min_installs_to_evaluate.trim()) {
        const m = Number(row.min_installs_to_evaluate);
        if (!Number.isFinite(m) || m < 0) {
          setError(
            `Media source "${nameTrim}": min_installs_to_evaluate invalido.`
          );
          return;
        }
        minInstalls = Math.floor(m);
      }

      cleanMediaSources.push({
        name: nameTrim,
        campaign_type: row.campaign_type,
        target_cpi: targetCpi,
        min_installs_to_evaluate: minInstalls,
        ordem: i
      });
    }

    const mesRefIso = `${mesRefAno}-${String(mesRefMes).padStart(2, "0")}-01`;

    const payload: Record<string, any> = {
      name: trimmedName,
      status,
      inicio: inicio || null,
      fim: fim || null,
      app: app.trim() || null,
      af_prt: afPrt.trim() || null,
      plataforma: plataforma.trim() || null,
      budget: parsedBudget,
      moeda,
      fluxo: fluxo.trim() || null,
      tipo,
      budget_mode: budgetMode,
      timezone: timezone || null,
      external_id: externalId.trim() || null,
      mes_referencia: mesRefIso,
      mmp,
      criativo: criativo.trim() || null,
      obs: obs.trim() || null,
      eventos_pagos: cleanEventos,
      apps: cleanApps,
      media_sources: cleanMediaSources
    };

    setSubmitting(true);
    try {
      const endpoint = isEdit ? `/campanhas/${campanhaId}` : "/campanhas";
      const method = isEdit ? "PATCH" : "POST";
      const saved: { id?: string } = await apiFetch(endpoint, {
        method,
        body: JSON.stringify(payload)
      });

      toast.success(isEdit ? "Campanha atualizada." : "Campanha criada.");
      const targetId = saved?.id || campanhaId;
      if (targetId) {
        router.push(`/campanhas/${targetId}`);
      } else {
        router.push("/campanhas");
      }
    } catch (err: any) {
      setError(err?.message || "Falha ao salvar campanha.");
    } finally {
      setSubmitting(false);
    }
  };

  const moedaSym = moedaShort(moeda);

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="flex items-start gap-2.5 rounded-lg border border-danger/20 bg-danger/10 p-3">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-danger" />
          <p className="text-sm text-danger">{error}</p>
        </div>
      )}

      <Section title="Identificacao">
        <Field label="Nome" required>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex: Campanha Black Friday 2026"
            required
            className={inputCls}
          />
        </Field>
        <Field label="Status">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as CampanhaStatus)}
            className={inputCls}
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </Field>
      </Section>

      <Section title="Mes de referencia e MMP">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="Mes de referencia"
            hint="Mes da campanha (snapshot mensal)"
          >
            <div className="flex gap-2">
              <select
                value={mesRefMes}
                onChange={(e) => setMesRefMes(parseInt(e.target.value, 10))}
                className={inputCls}
                aria-label="Mes"
              >
                {MESES_LABELS.map((label, i) => (
                  <option key={i + 1} value={i + 1}>
                    {String(i + 1).padStart(2, "0")} — {label}
                  </option>
                ))}
              </select>
              <select
                value={mesRefAno}
                onChange={(e) => setMesRefAno(parseInt(e.target.value, 10))}
                className={inputCls}
                aria-label="Ano"
              >
                {[currentYear - 1, currentYear, currentYear + 1].map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
          </Field>
          <Field
            label="MMP"
            hint="Adjust ainda nao tem integracao automatica — metrics via form manual"
          >
            <div className="flex gap-2">
              {(["appsflyer", "adjust"] as CampanhaMMP[]).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setMmp(opt)}
                  className={`flex-1 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                    mmp === opt
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-background text-muted hover:text-foreground"
                  }`}
                >
                  {opt === "appsflyer" ? "AppsFlyer" : "Adjust"}
                </button>
              ))}
            </div>
          </Field>
        </div>
      </Section>

      <Section title="Tipo e budget">
        <Field
          label="Tipo da campanha"
          hint="UA = User Acquisition (installs novos). RTG = Retargeting (re-engajamento)."
        >
          <div className="flex gap-2">
            {(["ua", "rtg"] as CampanhaTipo[]).map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => setTipo(opt)}
                className={`flex-1 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                  tipo === opt
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-background text-muted hover:text-foreground"
                }`}
              >
                {opt.toUpperCase()}
              </button>
            ))}
          </div>
        </Field>

        <Field
          label="Modo de budget"
          hint="Total: um pote unico pro produto. Por evento: cada evento pago tem seu proprio orcamento."
        >
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setBudgetMode("total")}
              className={`flex-1 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                budgetMode === "total"
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-background text-muted hover:text-foreground"
              }`}
            >
              Budget total unico
            </button>
            <button
              type="button"
              onClick={() => setBudgetMode("per_event")}
              className={`flex-1 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                budgetMode === "per_event"
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-background text-muted hover:text-foreground"
              }`}
            >
              Budget por evento
            </button>
          </div>
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Timezone">
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className={inputCls}
            >
              {TIMEZONE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="ID externo (api_af)"
            hint="Identico ao product_name no config/apps.yaml do api_af (ex: 'Claro UA')"
          >
            <input
              type="text"
              value={externalId}
              onChange={(e) => setExternalId(e.target.value)}
              placeholder="Ex: Claro UA"
              className={inputCls}
            />
          </Field>
        </div>
      </Section>

      <Section title="Periodo">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Inicio">
            <input
              type="date"
              value={inicio}
              onChange={(e) => setInicio(e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="Fim">
            <input
              type="date"
              value={fim}
              onChange={(e) => setFim(e.target.value)}
              className={inputCls}
            />
          </Field>
        </div>
      </Section>

      <Section title="App e parceiro">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="App">
            <input
              type="text"
              value={app}
              onChange={(e) => setApp(e.target.value)}
              placeholder="Ex: caracol-ios"
              className={inputCls}
            />
          </Field>
          <Field label="af_prt" hint="AppsFlyer Partner">
            <input
              type="text"
              value={afPrt}
              onChange={(e) => setAfPrt(e.target.value)}
              placeholder="Ex: meta_int"
              className={inputCls}
            />
          </Field>
          <Field label="Plataforma">
            <input
              type="text"
              value={plataforma}
              onChange={(e) => setPlataforma(e.target.value)}
              placeholder="Ex: iOS / Android / Web / Cross"
              className={inputCls}
            />
          </Field>
        </div>
      </Section>

      <Section title="Financeiro">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr,140px,1fr]">
          <Field label="Budget" hint={`em ${moedaSym}`}>
            <PtBrCurrencyInput
              value={budget}
              onChange={setBudget}
              prefix={moedaSym}
            />
          </Field>
          <Field label="Moeda">
            <select
              value={moeda}
              onChange={(e) => setMoeda(e.target.value as Moeda)}
              className={inputCls}
            >
              {MOEDA_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Fluxo" hint="CPI / CPA / CPL / CPM">
            <input
              type="text"
              value={fluxo}
              onChange={(e) => setFluxo(e.target.value)}
              placeholder="Ex: CPI"
              className={inputCls}
            />
          </Field>
        </div>
      </Section>

      <Section
        title="Eventos pagos"
        hint={`Valores em ${moedaSym} (moeda da campanha)`}
      >
        <div className="space-y-2">
          {/* Header de colunas */}
          <div
            className={`hidden gap-2 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted sm:grid ${
              budgetMode === "per_event"
                ? "grid-cols-[1fr,140px,140px,140px,auto]"
                : "grid-cols-[1fr,140px,140px,auto]"
            }`}
          >
            <span>Nome</span>
            <span title="PO contratado por evento (preco pago pelo cliente)">
              PO (CPA)
            </span>
            <span title="Quanto voce repassa ao publisher">Payout</span>
            {budgetMode === "per_event" && <span>Budget mensal</span>}
            <span />
          </div>

          {eventos.map((row, idx) => (
            <div
              key={idx}
              className={`grid items-center gap-2 ${
                budgetMode === "per_event"
                  ? "grid-cols-1 sm:grid-cols-[1fr,140px,140px,140px,auto]"
                  : "grid-cols-1 sm:grid-cols-[1fr,140px,140px,auto]"
              }`}
            >
              <input
                type="text"
                value={row.nome}
                onChange={(e) => updateEvento(idx, { nome: e.target.value })}
                placeholder="Nome do evento (ex: install, purchase)"
                className={inputCls}
              />
              <PtBrCurrencyInput
                value={row.target_cpa}
                onChange={(v) => updateEvento(idx, { target_cpa: v })}
                prefix={moedaSym}
                aria-label="PO (CPA)"
              />
              <PtBrCurrencyInput
                value={row.payout}
                onChange={(v) => updateEvento(idx, { payout: v })}
                prefix={moedaSym}
                aria-label="Payout"
              />
              {budgetMode === "per_event" && (
                <PtBrCurrencyInput
                  value={row.budget_monthly}
                  onChange={(v) => updateEvento(idx, { budget_monthly: v })}
                  prefix={moedaSym}
                  aria-label="Budget mensal"
                />
              )}
              <button
                type="button"
                onClick={() => removeEvento(idx)}
                disabled={eventos.length <= 1}
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted transition-colors hover:border-danger/40 hover:text-danger disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-border disabled:hover:text-muted"
                title="Remover"
                aria-label="Remover evento"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addEvento}
            className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border bg-background px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-primary/40 hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
            Adicionar evento
          </button>
        </div>
      </Section>

      <Section
        title="Apps"
        hint="Apps que api_af deve trackear (Android / iOS)"
      >
        <div className="space-y-3">
          {apps.length === 0 && (
            <p className="text-xs text-muted">
              Nenhum app cadastrado. Para que o robo api_af envie metrics,
              cadastre ao menos 1 plataforma.
            </p>
          )}
          {apps.map((row, idx) => (
            <div
              key={idx}
              className="space-y-3 rounded-lg border border-border bg-background p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                  App {idx + 1}
                </p>
                <button
                  type="button"
                  onClick={() => removeApp(idx)}
                  className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-muted transition-colors hover:border-danger/40 hover:text-danger"
                  title="Remover app"
                  aria-label="Remover app"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Nome">
                  <input
                    type="text"
                    value={row.name}
                    onChange={(e) =>
                      updateApp(idx, { name: e.target.value })
                    }
                    placeholder="Ex: Claro Android"
                    className={inputCls}
                  />
                </Field>
                <Field label="App ID">
                  <input
                    type="text"
                    value={row.app_id}
                    onChange={(e) =>
                      updateApp(idx, { app_id: e.target.value })
                    }
                    placeholder="com.claro.app ou id1234567890"
                    className={inputCls}
                  />
                </Field>
                <Field label="Plataforma">
                  <select
                    value={row.platform}
                    onChange={(e) =>
                      updateApp(idx, {
                        platform: e.target.value as AppPlatform
                      })
                    }
                    className={inputCls}
                  >
                    <option value="android">android</option>
                    <option value="ios">ios</option>
                  </select>
                </Field>
                <div className="flex flex-col gap-2 pt-6">
                  <label className="flex items-center gap-2 text-sm text-foreground">
                    <input
                      type="checkbox"
                      checked={row.p360_enabled}
                      onChange={(e) =>
                        updateApp(idx, { p360_enabled: e.target.checked })
                      }
                      className="h-4 w-4 rounded border-border bg-background"
                    />
                    P360 habilitado
                  </label>
                  <label className="flex items-center gap-2 text-sm text-foreground">
                    <input
                      type="checkbox"
                      checked={row.only_primary_attribution}
                      onChange={(e) =>
                        updateApp(idx, {
                          only_primary_attribution: e.target.checked
                        })
                      }
                      className="h-4 w-4 rounded border-border bg-background"
                    />
                    So atribuicao primaria
                  </label>
                </div>
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={addApp}
            className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border bg-background px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-primary/40 hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
            Adicionar plataforma
          </button>
        </div>
      </Section>

      <Section title="Media sources" hint="Origens (ex: googleadwords_int)">
        <div className="space-y-3">
          {mediaSources.length === 0 && (
            <p className="text-xs text-muted">
              Nenhuma media source cadastrada.
            </p>
          )}
          {mediaSources.map((row, idx) => (
            <div
              key={idx}
              className="space-y-3 rounded-lg border border-border bg-background p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                  Media source {idx + 1}
                </p>
                <button
                  type="button"
                  onClick={() => removeMediaSource(idx)}
                  className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-muted transition-colors hover:border-danger/40 hover:text-danger"
                  title="Remover media source"
                  aria-label="Remover media source"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Nome">
                  <input
                    type="text"
                    value={row.name}
                    onChange={(e) =>
                      updateMediaSource(idx, { name: e.target.value })
                    }
                    placeholder="Ex: googleadwords_int"
                    className={inputCls}
                  />
                </Field>
                <Field label="Tipo">
                  <select
                    value={row.campaign_type}
                    onChange={(e) =>
                      updateMediaSource(idx, {
                        campaign_type: e.target
                          .value as MediaSourceCampaignType
                      })
                    }
                    className={inputCls}
                  >
                    <option value="cpa">CPA</option>
                    <option value="cpi">CPI</option>
                  </select>
                </Field>
                {row.campaign_type === "cpi" && (
                  <Field label="Target CPI" hint={`em ${moedaSym}`}>
                    <PtBrCurrencyInput
                      value={row.target_cpi}
                      onChange={(v) =>
                        updateMediaSource(idx, { target_cpi: v })
                      }
                      prefix={moedaSym}
                    />
                  </Field>
                )}
                <Field label="Min. installs p/ avaliar">
                  <input
                    type="number"
                    min="0"
                    value={row.min_installs_to_evaluate}
                    onChange={(e) =>
                      updateMediaSource(idx, {
                        min_installs_to_evaluate: e.target.value
                      })
                    }
                    className={inputCls}
                  />
                </Field>
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={addMediaSource}
            className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border bg-background px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-primary/40 hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
            Adicionar media source
          </button>
        </div>
      </Section>

      <Section title="Criativo e observacoes">
        <Field label="Criativo" hint="Caminho, link ou descricao">
          <textarea
            value={criativo}
            onChange={(e) => setCriativo(e.target.value)}
            rows={3}
            className={textareaCls}
            placeholder="Ex: drive.google.com/... ou descricao do criativo"
          />
        </Field>
        <Field label="Observacoes">
          <textarea
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            rows={3}
            className={textareaCls}
            placeholder="Notas internas, alinhamentos, etc."
          />
        </Field>
      </Section>

      <div className="flex items-center justify-end gap-2 pt-2">
        <Link
          href={isEdit && campanhaId ? `/campanhas/${campanhaId}` : "/campanhas"}
          className="rounded-lg border border-border bg-background px-4 py-2 text-sm text-muted transition-colors hover:text-foreground"
        >
          Cancelar
        </Link>
        <button
          type="submit"
          disabled={submitting}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {submitting
            ? isEdit
              ? "Salvando..."
              : "Criando..."
            : isEdit
            ? "Salvar alteracoes"
            : "Criar campanha"}
        </button>
      </div>
    </form>
  );
}

const inputCls =
  "w-full rounded-lg border border-border bg-background px-3.5 py-2.5 text-sm text-foreground outline-none transition-colors focus:border-primary/60";
const textareaCls =
  "w-full resize-y rounded-lg border border-border bg-background px-3.5 py-2.5 text-sm text-foreground outline-none transition-colors focus:border-primary/60";

// Input numerico com formatacao PT-BR e prefixo de moeda.
// Aceita digitos/virgula/ponto enquanto digita; formata como "1.234,56" no blur.
function PtBrCurrencyInput({
  value,
  onChange,
  prefix,
  "aria-label": ariaLabel
}: {
  value: string;
  onChange: (v: string) => void;
  prefix: string;
  "aria-label"?: string;
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted">
        {prefix}
      </span>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(sanitizeNumberInput(e.target.value))}
        onBlur={(e) => onChange(blurFormatNumberPtBr(e.target.value))}
        placeholder="0,00"
        aria-label={ariaLabel}
        className={`${inputCls} pl-9`}
      />
    </div>
  );
}

function Section({
  title,
  hint,
  children
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4 rounded-xl border border-border bg-surface p-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-primary">
          {title}
        </h2>
        {hint && <p className="text-xs text-muted">{hint}</p>}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Field({
  label,
  hint,
  required,
  children
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-foreground">
        {label}
        {required && <span className="text-danger"> *</span>}
        {hint && (
          <span className="ml-1 text-xs font-normal text-muted">({hint})</span>
        )}
      </label>
      {children}
    </div>
  );
}
