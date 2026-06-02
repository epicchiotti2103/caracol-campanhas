// Tipos compartilhados do Caracol Campanhas.
// Backend (rotas /api/v1/campanhas/*) vive no Tracker — ver tracker-caracol/backend/app/routes/campanhas.py.

export type CampanhaStatus = "ativa" | "pausada" | "encerrada";

export type Moeda = "BRL" | "USD";

export type CampanhaTipo = "ua" | "rtg";

export type CampanhaBudgetMode = "total" | "per_event";

export type AppPlatform = "android" | "ios";

export type MetricPlatform = "android" | "ios" | "consolidado";

export type CampanhaMMP = "appsflyer" | "adjust";

/**
 * 1 evento da campanha = nome + target_cpa (PO/CPA contratado pelo cliente)
 * + budget_monthly (so quando budget_mode === 'per_event').
 * O payout (repasse ao publisher) NAO vive mais aqui — ele e por publisher,
 * em `CampanhaPublisher.payouts` (keyado por `evento_nome`).
 * A moeda dos valores e a moeda da campanha (campo `moeda` em `Campanha`).
 */
export interface CampanhaEvento {
  id?: string | null;
  nome: string;
  target_cpa?: number | null;
  budget_monthly?: number | null;
  ordem?: number;
}

export interface CampanhaApp {
  id?: string | null;
  name: string;
  app_id: string;
  platform: AppPlatform;
  p360_enabled?: boolean;
  only_primary_attribution?: boolean;
  ordem?: number;
}

/** PO (payout) repassado a um publisher por evento. Keyado por `evento_nome`. */
export interface CampanhaPublisherPayout {
  evento_nome: string;
  payout: number | null;
}

/**
 * Publisher cadastrado na campanha. Cada publisher tem suas media sources
 * (strings, ex: "googleadwords_int") e o PO por evento (`payouts`, casado por nome).
 */
export interface CampanhaPublisher {
  id?: string | null;
  nome: string;
  media_sources: string[];
  payouts: CampanhaPublisherPayout[];
  ordem?: number;
}

export interface Campanha {
  id: string;
  codigo?: string | null;
  name: string;
  slug?: string | null;
  status: CampanhaStatus;
  owner_id: string;
  owner_name?: string | null;
  created_at: string;
  updated_at?: string | null;

  // Periodo
  inicio?: string | null;
  fim?: string | null;

  // App e parceiro
  app?: string | null;
  af_prt?: string | null;
  plataforma?: string | null;

  // Financeiro
  budget?: number | null;
  moeda?: Moeda | string | null;
  fluxo?: string | null;

  // Novos campos (api_af integration)
  tipo?: CampanhaTipo | null;
  budget_mode?: CampanhaBudgetMode | null;
  timezone?: string | null;
  external_id?: string | null;

  // Fase 2 — snapshot mensal + MMP
  mes_referencia: string; // ISO YYYY-MM-01
  mmp: CampanhaMMP;

  // Parceria Wave (Wavesync): se true, entra no relatorio enviado pro parceiro.
  parceria_wave?: boolean | null;

  // Coleta manual: se true, o robo api_af NAO busca os dados (so input manual),
  // mesmo sendo mmp=appsflyer. Libera o form de metrics manual.
  coleta_manual?: boolean | null;

  // Eventos pagos (backend usa esse nome). Moeda vem da campanha.
  eventos_pagos?: CampanhaEvento[];

  // Apps (para integracao com api_af)
  apps?: CampanhaApp[];

  // Publishers cadastrados (media sources + PO por evento). Substituiu media_sources.
  publishers?: CampanhaPublisher[];

  // Criativo e observacoes
  criativo?: string | null;
  obs?: string | null;
}

// Papel de um user dentro de uma campanha (N:N via tabela campanhas_users).
export type CampanhaUserRole = "gestor";

export interface CampanhaUser {
  campanha_id: string;
  user_id: string;
  user_name?: string | null;
  user_email?: string | null;
  role: CampanhaUserRole;
}

// ---- Metrics (api_af) ----

export interface CampanhaMetricsRow {
  platform: MetricPlatform;
  spend_actual?: number | null;
  budget_monthly?: number | null;
  spend_pace_pct?: number | null;
  budget_used_pct?: number | null;
  p360_event_rate?: number | null;
  pa_false_rate?: number | null;
  pace_status?: string | null;
  report_date?: string | null;
  date_from?: string | null;
  date_to?: string | null;
}

export interface CampanhaMetricsLatest {
  report_date: string | null;
  date_from: string | null;
  date_to: string | null;
  platforms: Partial<Record<MetricPlatform, CampanhaMetricsRow>>;
}

export interface CampanhaMetricsHistoryPoint {
  report_date: string;
  platform: MetricPlatform;
  spend_actual: number | null;
  spend_pace_pct: number | null;
  budget_used_pct: number | null;
  budget_monthly: number | null;
  p360_event_rate: number | null;
  pa_false_rate: number | null;
  pace_status: string | null;
}

export interface CampanhaMetricsHistory {
  days: number;
  series: CampanhaMetricsHistoryPoint[];
}

// ---- Fase 2: publishers + dashboard summary + ingestao manual (adjust) ----

/** Linha do GET /campanhas/{id}/metrics/publishers (response). */
export interface CampanhaPublisherRow {
  publisher: string;
  platform: MetricPlatform;
  spend_actual: number | null;
  installs_or_conversions: number | null;
  p360_event_rate: number | null;
}

export interface CampanhaPublishersResponse {
  month: string | null;
  report_date: string | null;
  rows: CampanhaPublisherRow[];
}

/** Linha de publisher no payload do POST /metrics/manual (input — usa `name`/`spend`). */
export interface CampanhaPublisherInput {
  name: string;
  platform?: MetricPlatform;
  spend?: number | null;
  installs_or_conversions?: number | null;
  p360_event_rate?: number | null;
}

/** Body de POST /campanhas/{id}/metrics/manual. */
export interface CampanhaMetricsManualPayload {
  report_date: string;
  date_from: string;
  date_to: string;
  platforms: Partial<Record<MetricPlatform, Partial<CampanhaMetricsRow>>>;
  publishers?: CampanhaPublisherInput[];
}

export interface CampanhaDashboardSummary {
  month: string;
  campanhas_count: number;
  budget_total: number;
  spend_total: number;
  budget_used_pct: number | null;
  by_status: Record<CampanhaStatus, number>;
  by_tipo: Record<CampanhaTipo, number>;
}

export interface CampanhaMonthsAvailable {
  months: string[]; // ["YYYY-MM", ...] desc
}

// ---- Cliente (entidade cadastral — mesmo shape do NF/Tracker) ----
// Backend: /api/v1/clients (vem do tracker-caracol).
export type ClientEntity = "BR" | "LLC";

export interface Client {
  id: string;
  name: string;
  tax_id?: string | null;
  default_entity?: ClientEntity;
  default_moeda?: Moeda;
  contact_name?: string | null;
  contact_email?: string | null;
  notes?: string | null;
  active?: boolean;
  created_at?: string | null;
  updated_at?: string | null;
}

// ---- Etapa 3: Fechamento mensal de campanha ----
// Backend: tracker-caracol/backend/app/models/campanhas_fechamento.py
// + routes/campanhas_fechamento.py (6 endpoints sob /api/v1/campanhas/fechamento/*).

export interface FechamentoPublisher {
  id?: string | null;
  publisher_name: string;
  platform?: string | null;
  spend_final: number;
  installs_or_conversions?: number | null;
  p360_event_rate?: number | null;
  notes?: string | null;
  locked?: boolean;
  locked_at?: string | null;
  locked_invoice_id?: string | null;
  // Derivado quando vem do stub pre-pop (spend real do AppsFlyer no mes).
  spend_real?: number | null;
}

/**
 * PO acordado vindo do CADASTRO da campanha (campanhas_publishers).
 * Referencia pro front comparar com o realizado (casa por NOME do publisher).
 */
export interface FechamentoPublisherCadastrado {
  publisher_name: string;
  media_sources: string[];
  po_acordado: CampanhaPublisherPayout[];
}

export interface Fechamento {
  id: string | null; // null = stub (nao persistido ainda)
  campanha_id: string;
  client_id: string | null;
  client_name?: string | null;
  mes_referencia: string; // ISO YYYY-MM-DD
  spend_final: number;
  moeda: string;
  closed_at?: string | null;
  closed_by?: string | null;
  locked: boolean;
  locked_at?: string | null;
  notes?: string | null;
  updated_at?: string | null;
  is_locked: boolean;
  publishers: FechamentoPublisher[];
  // PO acordado do cadastro (referencia; casa por nome com `publishers`).
  publishers_cadastrados?: FechamentoPublisherCadastrado[];
}

/** Body do POST /campanhas/{id}/fechamento?month=YYYY-MM. */
export interface FechamentoUpsertPayload {
  client_id: string;
  spend_final: number;
  notes?: string | null;
  publishers: Array<{
    publisher_name: string;
    platform?: string | null;
    spend_final: number;
    installs_or_conversions?: number | null;
    p360_event_rate?: number | null;
    notes?: string | null;
  }>;
}

/** Response do GET /campanhas/fechamento/summary?month=YYYY-MM. */
export interface FechamentoSummary {
  month: string;
  campanhas_total: number;
  fechamentos_count: number;
  fechamentos_locked: number;
  spend_final_total_brl: number;
  spend_final_total_usd: number;
  by_moeda: Record<string, number>;
}
