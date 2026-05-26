// Tipos compartilhados do Caracol Campanhas.
// Backend (rotas /api/v1/campanhas/*) vive no Tracker — ver tracker-caracol/backend/app/routes/campanhas.py.

export type CampanhaStatus = "ativa" | "pausada" | "encerrada";

export type Moeda = "BRL" | "USD";

export type CampanhaTipo = "ua" | "rtg";

export type CampanhaBudgetMode = "total" | "per_event";

export type AppPlatform = "android" | "ios";

export type MetricPlatform = "android" | "ios" | "consolidado";

export type MediaSourceCampaignType = "cpa" | "cpi";

export type CampanhaMMP = "appsflyer" | "adjust";

/**
 * 1 evento da campanha = nome + payout (repasse) + target_cpa (CPA contratado)
 * + budget_monthly (so quando budget_mode === 'per_event').
 * A moeda dos valores e a moeda da campanha (campo `moeda` em `Campanha`).
 */
export interface CampanhaEvento {
  id?: string | null;
  nome: string;
  payout?: number | null;
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

export interface CampanhaMediaSource {
  id?: string | null;
  name: string;
  campaign_type: MediaSourceCampaignType;
  target_cpi?: number | null;
  min_installs_to_evaluate?: number;
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

  // Eventos pagos (backend usa esse nome). Moeda vem da campanha.
  eventos_pagos?: CampanhaEvento[];

  // Apps e media sources (para integracao com api_af)
  apps?: CampanhaApp[];
  media_sources?: CampanhaMediaSource[];

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
