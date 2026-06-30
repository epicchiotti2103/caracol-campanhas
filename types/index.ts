// Tipos compartilhados do Caracol Campanhas.
// Backend (rotas /api/v1/campanhas/*) vive no Tracker — ver tracker-caracol/backend/app/routes/campanhas.py.

export type CampanhaStatus = "ativa" | "pausada" | "encerrada";

export type Moeda = "BRL" | "USD";

export type CampanhaTipo = "ua" | "rtg";

export type CampanhaBudgetMode = "total" | "per_event" | "per_platform";

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
  /** Budget mensal do app — usado quando budget_mode === 'per_platform'. */
  budget_monthly?: number | null;
  ordem?: number;
}

/** PO (payout) repassado a um publisher por evento. Keyado por `evento_nome`. */
export interface CampanhaPublisherPayout {
  evento_nome: string;
  payout: number | null;
}

// ---- Cap de eventos por publisher ----

/** Tipo de cap de entrega de um publisher: nenhum, mensal ou diario (nunca os dois). */
export type CampanhaCapTipo = "nenhum" | "mensal" | "diario";

/** Unidade do cap: eventos (quantidade) ou US$ (spend). */
export type CampanhaCapUnidade = "eventos" | "usd";

/**
 * Cap de eventos VIGENTE de um publisher numa campanha.
 * Cap diario corta dia-a-dia sem netting; mensal corta no acumulado do mes.
 * Quando o user muda o valor numa campanha que ja tem cap vigente, envia
 * `data_efetiva` -> backend fecha a vigencia atual e abre uma nova (historico).
 */
export interface CampanhaPublisherCap {
  tipo: CampanhaCapTipo;
  unidade: CampanhaCapUnidade;
  valor: number | null;
  vigencia_inicio: string | null; // ISO YYYY-MM-DD
  vigencia_fim: string | null; // ISO YYYY-MM-DD (null = aberta)
  /** So no PATCH: data efetiva da renegociacao do cap (default hoje). */
  data_efetiva?: string | null;
}

/**
 * Uma vigencia historica do cap de um publisher (read-only, vinda do backend).
 * Lista ordenada por vigencia_inicio ASC.
 */
export interface CampanhaCapHistorico {
  tipo: CampanhaCapTipo;
  unidade: CampanhaCapUnidade;
  valor: number | null;
  vigencia_inicio: string | null;
  vigencia_fim: string | null;
  changed_at?: string | null;
}

/**
 * Renegociacao do payout de um publisher num evento (historico).
 * Lista vinda do backend ordenada por changed_at (mais antiga -> mais recente).
 */
export interface CampanhaPublisherRenegociacao {
  evento_nome: string;
  payout_anterior: number | null;
  payout_novo: number | null;
  changed_at: string;
}

/**
 * Media source (PID) de um publisher. Tem estado ativo/inativo: ao desativar
 * exige justificativa (`deactivated_reason`) e guarda DUAS datas:
 * `deactivated_at` = data EFETIVA da pausa (informada pelo user, default hoje);
 * `deactivated_registered_at` = registro automatico (now() no backend, read-only).
 */
export interface CampanhaMediaSource {
  id: string;
  name: string;
  active: boolean;
  deactivated_reason: string | null;
  deactivated_at: string | null;
  deactivated_registered_at: string | null;
}

/**
 * Publisher cadastrado na campanha. Cada publisher tem suas media sources
 * (objetos com estado, ex: "googleadwords_int") e o PO por evento (`payouts`, casado por nome).
 */
export interface CampanhaPublisher {
  id?: string | null;
  nome: string;
  // FK pro cadastro de fornecedor (suppliers). Fase 0 da unificacao de publisher:
  // o nome deixou de ser texto livre e passou a referenciar um supplier. O backend
  // resolve `nome` a partir do supplier_id. Campanhas antigas ja vem com supplier_id
  // populado via migration; defensivo: pode vir null (cai no `nome` como fallback).
  supplier_id?: string | null;
  media_sources: CampanhaMediaSource[];
  payouts: CampanhaPublisherPayout[];
  // Moeda do PO desse publisher (aplica a todos os POs dele). Default 'USD'.
  moeda: Moeda;
  // Historico de renegociacoes de payout por evento (mesmo shape do fechamento).
  // Ausente/vazio = nenhuma renegociacao. Ordenado por changed_at ASC.
  renegociacoes?: CampanhaPublisherRenegociacao[];
  // Cap de eventos vigente (tipo nenhum/mensal/diario). Ausente = sem cap.
  cap?: CampanhaPublisherCap | null;
  // Serie de vigencias do cap (read-only). Ausente/[] = nunca houve cap.
  caps_historico?: CampanhaCapHistorico[];
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
  // Budget efetivo por modo (vem da listagem do backend): soma das plataformas
  // no per_platform, soma dos eventos no per_event, ou o budget total. Pode ser
  // null se o backend ainda nao retorna — nesse caso cai no fallback `budget`.
  budget_total?: number | null;
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

  // Pausa da campanha INTEIRA (status='pausada' via POST /{id}/pause).
  // paused_at = data EFETIVA da pausa (informada, default hoje);
  // paused_registered_at = registro automatico (now() no backend, read-only);
  // paused_reason = justificativa (select Fraude/Budget/Outro -> texto livre).
  paused_at?: string | null;
  paused_registered_at?: string | null;
  paused_reason?: string | null;

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

// ---- Historico de pausa/reativacao da campanha (status-windows) ----
// Cada pausa/reativacao da campanha inteira fica registrada num log; o backend
// expoe as JANELAS de pausa do mes + os dias ativos via
// GET /campanhas/{id}/status-windows?month=YYYY-MM (e tambem no fechamento, no
// campo `status_windows`). Backend (slug `campanhas-pause-log`, subagente `tracker`).

/**
 * Uma janela de pausa dentro do mes. Janela e [inicio, fim): o dia da reativacao
 * (fim) JA conta como ativo. `fim` = null => segue pausada no fim do mes.
 * O endpoint NAO retorna motivo.
 */
export interface CampanhaPauseWindow {
  inicio: string; // ISO YYYY-MM-DD (data efetiva da pausa)
  fim: string | null; // ISO YYYY-MM-DD (data da reativacao) ou null se segue pausada
}

/**
 * Resposta de GET /campanhas/{id}/status-windows?month=YYYY-MM
 * (e do campo `status_windows` no GET do fechamento).
 */
export interface CampanhaStatusWindowsResponse {
  dias_ativos: number;
  dias_no_mes: number;
  pausas: CampanhaPauseWindow[];
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

// ---- Suppliers (cadastro de fornecedores) ----

/**
 * Fornecedor cadastrado. Quando `is_publisher`, pode ser selecionado como
 * publisher de uma campanha. `default_moeda` pre-preenche a moeda do PO ao
 * escolher o fornecedor no form. Fonte: GET /suppliers (backend do Tracker).
 */
export interface Supplier {
  id: string;
  name: string;
  default_moeda?: Moeda | string | null;
  is_publisher?: boolean | null;
  active?: boolean | null;
}

export interface SuppliersResponse {
  items: Supplier[];
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
  // Moeda de PAGAMENTO desse publisher (repasse). Independente da moeda de
  // recebimento (campanha). Default 'USD'. Backend retorna sempre.
  moeda?: Moeda;

  // ---- Cap de eventos (so quando o publisher tem cap cadastrado) ----
  // Realizado = total que o publisher entregou no mes (qty + spend).
  // Valido = o que passa pelo cap; Excedente = o que foi cortado.
  realizado_qty?: number | null;
  realizado_spend?: number | null;
  cap_tipo?: CampanhaCapTipo | null; // 'mensal' | 'diario' | null/'nenhum'
  cap_unidade?: CampanhaCapUnidade | null;
  valido_qty?: number | null;
  excedente_qty?: number | null;
  spend_valido?: number | null;
  spend_excedente?: number | null;
  // Quando true, o user decidiu pagar o excedente (spend_final volta pro cheio).
  excedente_aprovado?: boolean | null;
  // Detalhamento por periodo de vigencia do cap (diario quebra em janelas).
  cap_breakdown?: CapBreakdownPeriodo[];

  // ---- Exclusao por pausa da campanha (status-windows aplicado no fechamento) ----
  // O backend desconta as conversoes que cairam em dias pausados. Os campos
  // spend_final/spend_real/installs_or_conversions ja vem LIQUIDOS (descontados).
  // `pausa_aplicada` = false quando o publisher nao tem base diaria pra excluir
  // (pagou MTD cheio) — nesse caso o aviso "exclusao nao aplicada" aparece se
  // houve pausa no mes.
  pausa_aplicada?: boolean | null;
  realizado_qty_bruto?: number | null; // conversoes ANTES de excluir dias pausados
  qty_excluida_pausa?: number | null; // conversoes descartadas pela pausa
  spend_excluida_pausa?: number | null; // spend equivalente descartado
}

/**
 * Um periodo de vigencia do cap no calculo do fechamento.
 * Para cap diario, cada janela agrega os dias com aquele cap.
 */
export interface CapBreakdownPeriodo {
  inicio: string | null; // ISO YYYY-MM-DD
  fim: string | null; // ISO YYYY-MM-DD
  cap: number | null; // valor do cap no periodo (por dia se diario, total se mensal)
  dias: number | null;
  realizado: number | null;
  valido: number | null;
  excedente: number | null;
}

/**
 * PO acordado vindo do CADASTRO da campanha (campanhas_publishers).
 * Referencia pro front comparar com o realizado (casa por NOME do publisher).
 */
export interface FechamentoPublisherCadastrado {
  publisher_name: string;
  media_sources: CampanhaMediaSource[];
  po_acordado: CampanhaPublisherPayout[];
  // Historico de renegociacao do payout (era X -> agora Y), por evento.
  // Ordenado por changed_at. Ausente/[] quando nao houve renegociacao.
  renegociacoes?: CampanhaPublisherRenegociacao[];
  // Moeda do PO acordado desse publisher (cadastro). Default 'USD'.
  moeda: Moeda;
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
  // Pausa da campanha inteira (espelha os campos de `Campanha`). Aviso no modal.
  campanha_paused?: boolean;
  paused_at?: string | null;
  paused_registered_at?: string | null;
  paused_reason?: string | null;
  // Janelas de pausa do mes (mesmo objeto do GET /status-windows). Usado pra
  // saber se houve pausa no mes e avisar quando a exclusao nao foi aplicada.
  status_windows?: CampanhaStatusWindowsResponse | null;
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
    // Moeda de pagamento do publisher. Default 'USD' se ausente (backend).
    moeda?: Moeda;
    // Cap de eventos: quando true, paga o excedente mesmo assim (spend cheio).
    // So enviado para publishers que tem cap. Backend recalcula o spend_valido.
    excedente_aprovado?: boolean;
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

// ---------- Brutos arquivados (AppsFlyer) ----------

/** Tipo de relatorio bruto arquivado no Supabase Storage pelo api_af. */
export type RawArchiveKey =
  | "installs"
  | "events"
  | "clicks"
  | "blocked_installs"
  | "blocked_events"
  | "blocked_clicks"
  | "post_attribution_installs"
  | "post_attribution_events";

export type RawArchivePlatform = "android" | "ios" | "consolidado";

/** Um arquivo bruto (CSV.gz) com link assinado de download. */
export interface RawArchiveFile {
  platform: RawArchivePlatform | string;
  key: RawArchiveKey | string;
  filename: string;
  /** Signed URL — expira em ~15 min. */
  url: string;
}

/** Brutos de uma semana (ISO week). */
export interface RawArchiveWeek {
  week: string;
  date_from: string;
  date_to: string;
  files: RawArchiveFile[];
}

/** Response do GET /campanhas/{id}/raw-archives. */
export interface RawArchivesResponse {
  external_id: string | null;
  tipo: string | null;
  /** Mais recente primeiro; pode vir vazio. */
  weeks: RawArchiveWeek[];
}
