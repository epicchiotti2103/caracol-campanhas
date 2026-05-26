// Helpers de formatacao reusados na suite.

import type { Moeda } from "@/types";

/**
 * Formata um numero em moeda BRL ou USD usando Intl.NumberFormat.
 *
 * - BRL: locale pt-BR → "R$ 1.234,56"
 * - USD: locale en-US → "$1,234.56"
 *
 * Aceita `moeda` como string flexivel (fallback BRL) pra tolerar payloads
 * antigos ou indefinidos.
 */
export function formatCurrency(
  value: number | null | undefined,
  moeda: Moeda | string | null | undefined
): string {
  if (value == null || Number.isNaN(value)) return "—";
  const m = moeda === "USD" ? "USD" : "BRL";
  try {
    return new Intl.NumberFormat(m === "USD" ? "en-US" : "pt-BR", {
      style: "currency",
      currency: m
    }).format(value);
  } catch {
    return `${m} ${value}`;
  }
}

/**
 * Formata um numero PT-BR sem simbolo de moeda. Ex: 1234.56 → "1.234,56".
 * Usado em inputs de valores (budget, payout, target_cpa, etc) — o prefixo
 * R$/$ fica fora do input.
 */
export function formatNumberPtBr(
  value: number | null | undefined,
  decimals = 2
): string {
  if (value == null || Number.isNaN(value)) return "";
  try {
    return new Intl.NumberFormat("pt-BR", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    }).format(value);
  } catch {
    return String(value);
  }
}

/**
 * Converte string com formatacao PT-BR pra numero.
 * Aceita "1.234,56", "1234,56", "1234.56", "1234".
 * Retorna NaN se nao for parseavel ou string vazia.
 */
export function parseNumberPtBr(raw: string | null | undefined): number {
  if (raw == null) return NaN;
  const s = String(raw).trim();
  if (!s) return NaN;
  // Se tem virgula, assume PT-BR: pontos sao separador de milhar, virgula e decimal.
  // Se nao tem virgula mas tem ponto, deixa o ponto como decimal (US-style).
  let normalized: string;
  if (s.includes(",")) {
    normalized = s.replace(/\./g, "").replace(",", ".");
  } else {
    normalized = s;
  }
  // Remove tudo que nao for digito, ponto ou sinal negativo
  normalized = normalized.replace(/[^0-9.\-]/g, "");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Limpa um input enquanto o user digita: mantem so digitos, virgula e ponto.
 * NAO formata — so sanitiza pra evitar caracteres estranhos.
 */
export function sanitizeNumberInput(raw: string): string {
  return raw.replace(/[^0-9.,]/g, "");
}

/**
 * Formata uma string de input numerico no padrao PT-BR (blur).
 * Se nao for parseavel, retorna a string original.
 */
export function blurFormatNumberPtBr(
  raw: string,
  decimals = 2
): string {
  const n = parseNumberPtBr(raw);
  if (Number.isNaN(n)) return raw;
  return formatNumberPtBr(n, decimals);
}

/** Retorna o simbolo curto da moeda (R$ ou $) — usado em prefix de inputs. */
export function moedaShort(m: Moeda | string | null | undefined): string {
  return m === "USD" ? "$" : "R$";
}

const MES_LABELS_FULL = [
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

/**
 * Recebe "YYYY-MM" ou "YYYY-MM-DD" e retorna "MM/YYYY" (PT-BR).
 * Aceita variacoes — retorna "" se nao parsear.
 */
export function formatMesAnoShort(s: string | null | undefined): string {
  if (!s) return "";
  const m = /^(\d{4})-(\d{2})/.exec(s);
  if (m) return `${m[2]}/${m[1]}`;
  return "";
}

/**
 * Recebe "YYYY-MM" ou "YYYY-MM-DD" e retorna "Maio/2026" (mes por extenso).
 */
export function formatMesAnoLong(s: string | null | undefined): string {
  if (!s) return "";
  const m = /^(\d{4})-(\d{2})/.exec(s);
  if (!m) return "";
  const year = m[1];
  const monthIdx = parseInt(m[2], 10) - 1;
  if (monthIdx < 0 || monthIdx > 11) return "";
  return `${MES_LABELS_FULL[monthIdx]}/${year}`;
}

/** "YYYY-MM-DD" -> "YYYY-MM". */
export function toMonthString(s: string | null | undefined): string {
  if (!s) return "";
  const m = /^(\d{4}-\d{2})/.exec(s);
  return m ? m[1] : "";
}

/** "YYYY-MM" -> "YYYY-MM-01" (date do primeiro dia do mes). */
export function monthToFirstDay(s: string | null | undefined): string {
  if (!s) return "";
  const m = /^(\d{4})-(\d{2})/.exec(s);
  return m ? `${m[1]}-${m[2]}-01` : "";
}

/** Retorna "YYYY-MM" do mes corrente. */
export function currentMonthString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Retorna "YYYY-MM-01" do mes seguinte ao mes informado (ISO). */
export function nextMonthFirstDay(s: string | null | undefined): string {
  if (!s) return "";
  const m = /^(\d{4})-(\d{2})/.exec(s);
  if (!m) return "";
  let year = parseInt(m[1], 10);
  let month = parseInt(m[2], 10);
  month += 1;
  if (month > 12) {
    month = 1;
    year += 1;
  }
  return `${year}-${String(month).padStart(2, "0")}-01`;
}
