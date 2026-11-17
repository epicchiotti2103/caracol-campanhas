// Inicio de Campanha — chamadas da API + builder do e-mail de oferta.
//
// Backend (subagente `tracker`, migration 084): rotas em /api/v1/campanhas/*
// (API_BASE_URL ja inclui /api/v1). Contrato fechado em inbox/campanhas.md sob
// o slug `inicio-campanha`. NAO usa cachedFetch nas listas de envios (dado
// mutavel) — so apiFetch direto.
//
// O texto do e-mail sai SEMPRE de `buildCorpo()`: preview, copiar, mailto e o
// `corpo` gravado no POST sao a mesma string (o snapshot do registro bate com o
// que foi efetivamente copiado/aberto).

import { apiFetch } from "@/lib/api";

// ---- Tipos (espelham o contrato) ----

export type EnvioModo = "nova" | "reinicio";
export type EnvioStatus = "oferecido" | "enviado" | "aceito" | "recusado";
export type EnvioCanal = "copiar" | "mailto" | "manual" | "email";
export type TemplateOrigem = "proprio" | "mes_anterior" | "sugestao";

export const TEMPLATE_KEYS = [
  "campaign_info",
  "offer_name",
  "vertical",
  "model",
  "attribution_model",
  "geo",
  "os",
  "ideal_fraud_rate",
  "payable_events",
  "important_note",
  "creative_links"
] as const;

export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export type OfertaTemplate = Record<TemplateKey, string | null> & {
  updated_at?: string | null;
};

export interface OfertaTemplateResponse {
  template: OfertaTemplate | null;
  origem: TemplateOrigem;
  sugestao: OfertaTemplate;
}

export interface InicioPrefill {
  po: string | null;
  moeda: string | null;
  af_prts: string[];
  supplier_id: string | null;
  supplier_nome: string | null;
  destinatarios: string[];
  budget_anterior: number | null;
  budget_anterior_fonte: "fechamento" | "metricas" | string | null;
  campanha_anterior_id: string | null;
}

export interface Envio {
  id: string;
  campanha_id: string | null;
  campanha_nome: string | null;
  mes_referencia: string | null;
  publisher_id: string | null;
  publisher_nome: string;
  supplier_id: string | null;
  modo: EnvioModo;
  status: EnvioStatus;
  destinatarios: string[];
  cc: string[] | null;
  assunto: string | null;
  corpo: string;
  po: string | null;
  af_prt: string | null;
  budget_events: number | null;
  observacao: string | null;
  canal: EnvioCanal | string | null;
  sent_by: string | null;
  sent_by_email: string | null;
  sent_at: string;
  status_updated_at: string | null;
  status_updated_by_email: string | null;
  status_nota: string | null;
  created_at: string | null;
}

export interface EnviosListResponse {
  items: Envio[];
  total: number;
  disponivel: boolean;
}

export interface EnvioCreatePayload {
  publisher_id?: string | null;
  publisher_nome: string;
  supplier_id?: string | null;
  modo: EnvioModo;
  destinatarios: string[];
  cc: string[];
  assunto: string;
  corpo: string;
  po?: string | null;
  af_prt?: string | null;
  budget_events?: number | null;
  observacao?: string | null;
  canal?: EnvioCanal;
}

export interface EnviosFiltros {
  campanha_id?: string;
  publisher_id?: string;
  supplier_id?: string;
  status?: string;
  modo?: string;
  de?: string;
  ate?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

// ---- Rotulos ----

export const STATUS_LABEL: Record<EnvioStatus, string> = {
  oferecido: "Oferecido",
  enviado: "Enviado",
  aceito: "Aceito",
  recusado: "Recusado"
};

export const STATUS_CLASS: Record<EnvioStatus, string> = {
  oferecido: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  enviado: "border-primary/30 bg-primary/10 text-primary",
  aceito: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  recusado: "border-red-500/30 bg-red-500/10 text-red-300"
};

export const MODO_LABEL: Record<EnvioModo, string> = {
  nova: "Nova oferta",
  reinicio: "Reinicio"
};

export const ORIGEM_LABEL: Record<TemplateOrigem, string> = {
  proprio: "Padrao da oferta",
  mes_anterior: "Herdado do mes anterior",
  sugestao: "Sugestao (dados da campanha)"
};

export const TEMPLATE_FIELD_LABEL: Record<TemplateKey, string> = {
  campaign_info: "Campaign Information",
  offer_name: "Offer",
  vertical: "Vertical",
  model: "Model",
  attribution_model: "Attribution Model",
  geo: "GEO",
  os: "OS",
  ideal_fraud_rate: "Ideal Fraud Rate",
  payable_events: "Payable Event",
  important_note: "Important to note",
  creative_links: "Criativos (1 por linha: label -> url)"
};

export function emptyTemplate(): OfertaTemplate {
  const t = {} as OfertaTemplate;
  for (const k of TEMPLATE_KEYS) t[k] = null;
  return t;
}

/** So as 11 chaves do contrato; string vazia vira null. */
export function normalizeTemplate(t: Partial<OfertaTemplate> | null | undefined): OfertaTemplate {
  const out = emptyTemplate();
  if (!t) return out;
  for (const k of TEMPLATE_KEYS) {
    const v = t[k];
    out[k] = typeof v === "string" && v.trim() !== "" ? v : null;
  }
  return out;
}

// ---- Erros ----

/** Mensagem amigavel (o 422 do FastAPI vem com detail array -> "[object Object]"). */
export function friendlyError(err: unknown, fallback: string): string {
  const msg = (err as any)?.message;
  if (!msg || typeof msg !== "string" || msg.includes("[object Object]") || msg === "Request failed") {
    return fallback;
  }
  return msg;
}

// ---- Chamadas ----

function qs(params: Record<string, string | number | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

export function listEnvios(f: EnviosFiltros): Promise<EnviosListResponse> {
  return apiFetch(
    `/campanhas/envios${qs({
      campanha_id: f.campanha_id,
      publisher_id: f.publisher_id,
      supplier_id: f.supplier_id,
      status: f.status,
      modo: f.modo,
      de: f.de,
      ate: f.ate,
      q: f.q,
      limit: f.limit ?? 50,
      offset: f.offset ?? 0
    })}`
  );
}

export function patchEnvioStatus(
  envioId: string,
  status: EnvioStatus,
  nota?: string | null
): Promise<Envio> {
  const body: { status: EnvioStatus; nota?: string } = { status };
  if (nota && nota.trim()) body.nota = nota.trim();
  return apiFetch(`/campanhas/envios/${envioId}/status`, {
    method: "PATCH",
    body: JSON.stringify(body)
  });
}

export function getOfertaTemplate(campanhaId: string): Promise<OfertaTemplateResponse> {
  return apiFetch(`/campanhas/${campanhaId}/oferta-template`);
}

export function putOfertaTemplate(
  campanhaId: string,
  tpl: Partial<OfertaTemplate>
): Promise<OfertaTemplate> {
  return apiFetch(`/campanhas/${campanhaId}/oferta-template`, {
    method: "PUT",
    body: JSON.stringify(normalizeTemplate(tpl))
  });
}

export function getInicioPrefill(campanhaId: string, publisherId: string): Promise<InicioPrefill> {
  return apiFetch(
    `/campanhas/${campanhaId}/inicio/prefill${qs({ publisher_id: publisherId })}`
  );
}

export function createEnvio(campanhaId: string, payload: EnvioCreatePayload): Promise<Envio> {
  return apiFetch(`/campanhas/${campanhaId}/envios`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

// ---- Helpers de formulario ----

/** "a@x.com, b@y.com; c@z.com" -> ["a@x.com","b@y.com","c@z.com"] (dedup, case-insensitive). */
export function splitEmails(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[,;\s]+/)) {
    const v = part.trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

export function looksLikeEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/**
 * Budget livre -> inteiro. Aceita "500", "500 events", "1.000", "1,000 events".
 * Retorna null se nao houver numero inteiro positivo.
 */
export function parseBudgetEvents(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const m = /\d[\d.,\s]*/.exec(raw);
  if (!m) return null;
  const digits = m[0].replace(/[^\d]/g, "");
  if (!digits) return null;
  const n = parseInt(digits, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ---- Builder do e-mail ----

export interface EmailInput {
  template: Partial<OfertaTemplate>;
  budgetEvents: number | null;
  po: string | null;
  afPrt: string | null;
  observacao: string | null;
}

function clean(v: string | null | undefined): string {
  return (v ?? "").trim();
}

export function defaultAssunto(offerName: string | null | undefined): string {
  const o = clean(offerName);
  return o ? `Offer Overview – ${o}` : "Offer Overview";
}

/**
 * Monta o corpo no formato do exemplo do Elio. Linha com valor vazio some;
 * bloco vazio (IMPORTANT/observacao/criativos) some inteiro. Quebra "\n"
 * (o mailto converte pra CRLF).
 *
 * Ordem dos blocos: saudacao -> titulo -> bullets -> IMPORTANT TO NOTE ->
 * observacao livre -> criativos.
 */
export function buildCorpo(input: EmailInput): string {
  const t = input.template || {};
  const offer = clean(t.offer_name);

  const bullets: string[] = [];
  const info = clean(t.campaign_info);
  if (info) bullets.push(`* Campaign Information- ${info}`);
  const pairs: [string, string][] = [
    ["Offer", offer],
    ["Vertical", clean(t.vertical)],
    ["Model", clean(t.model)],
    ["Attribution Model", clean(t.attribution_model)],
    ["GEO", clean(t.geo)],
    ["OS", clean(t.os)],
    ["Ideal Fraud Rate", clean(t.ideal_fraud_rate)],
    ["Payable Event", clean(t.payable_events)],
    ["Budget Events", input.budgetEvents && input.budgetEvents > 0 ? `${input.budgetEvents} events` : ""],
    ["PO", clean(input.po)],
    ["af_prt", clean(input.afPrt)]
  ];
  for (const [label, value] of pairs) {
    if (value) bullets.push(`* ${label}: ${value}`);
  }

  const blocks: string[] = [];
  blocks.push("Hello,\nHope this email finds you well.");
  blocks.push(offer ? `Offer Overview – ${offer}` : "Offer Overview");
  if (bullets.length) blocks.push(bullets.join("\n"));

  const note = clean(t.important_note);
  if (note) blocks.push(`IMPORTANT TO NOTE\n${note}`);

  const obs = clean(input.observacao);
  if (obs) blocks.push(obs);

  const creatives = (t.creative_links ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");
  if (creatives) blocks.push(creatives);

  return blocks.join("\n\n");
}

export const MAILTO_WARN_LEN = 1800;

export function buildMailto(opts: {
  to: string[];
  cc: string[];
  subject: string;
  body: string;
}): string {
  const crlf = (s: string) => s.replace(/\r?\n/g, "\r\n");
  const parts: string[] = [];
  if (opts.cc.length) parts.push(`cc=${encodeURIComponent(opts.cc.join(","))}`);
  parts.push(`subject=${encodeURIComponent(opts.subject)}`);
  parts.push(`body=${encodeURIComponent(crlf(opts.body))}`);
  const to = opts.to.map((e) => encodeURIComponent(e)).join(",");
  return `mailto:${to}?${parts.join("&")}`;
}

/**
 * Copia texto pro clipboard. Chamar SINCRONO no handler do clique (antes de
 * qualquer await) pra nao perder a user activation (Safari). Fallback via
 * textarea + execCommand.
 */
export function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      return navigator.clipboard.writeText(text).then(
        () => true,
        () => Promise.resolve(legacyCopy(text))
      );
    }
  } catch {
    // cai no legado
  }
  return Promise.resolve(legacyCopy(text));
}

function legacyCopy(text: string): boolean {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
