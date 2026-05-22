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
