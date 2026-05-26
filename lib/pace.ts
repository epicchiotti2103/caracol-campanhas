// Helpers de cores/labels relacionados a pace_status e metricas do api_af.
// Usados em /campanhas/[id]/desempenho e /desempenho.

/**
 * Cor da barra de progresso baseada no pace_status + budget_used_pct.
 * Escala do brief: verde=OK, amarelo=UNDERPACING/MUITO ABAIXO, vermelho=OVERPACING ou >120%.
 */
export function paceColor(
  status: string,
  budgetUsedPct: number | null | undefined
): string {
  if (status === "OVERPACING" || (budgetUsedPct != null && budgetUsedPct > 120))
    return "bg-rose-500";
  if (status === "UNDERPACING" || status === "MUITO ABAIXO")
    return "bg-amber-500";
  if (status === "OK") return "bg-emerald-500";
  return "bg-zinc-500";
}

/**
 * Cor do texto da % MTD (spend_pace_pct).
 * Verde 90-120, amarelo 70-90 ou >=120, vermelho <70.
 */
export function pacePctColor(pct: number | null | undefined): string {
  if (pct == null) return "";
  if (pct < 70) return "text-rose-300";
  if (pct >= 90 && pct <= 120) return "text-emerald-300";
  return "text-amber-300"; // 70-90 ou >120
}

/**
 * Cor do texto das taxas de fraude (P360, PA False — vem como rate 0..1).
 * Verde <5%, amarelo 5-25%, vermelho >25%.
 */
export function fraudColor(rate: number | null | undefined): string {
  if (rate == null) return "";
  const pct = rate * 100;
  if (pct < 5) return "text-emerald-300";
  if (pct <= 25) return "text-amber-300";
  return "text-rose-300";
}

/**
 * Classes do badge do pace_status. Retorna classes prontas pra `<span>`.
 */
export function paceBadgeClasses(status: string): string {
  const map: Record<string, string> = {
    OK: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    OVERPACING: "border-rose-500/30 bg-rose-500/10 text-rose-300",
    UNDERPACING: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    "MUITO ABAIXO": "border-amber-500/30 bg-amber-500/10 text-amber-300"
  };
  return map[status] || "border-zinc-500/30 bg-zinc-500/10 text-zinc-300";
}

/** Normaliza pace_status pra UPPERCASE — backend pode mandar em qualquer caixa. */
export function normalizePaceStatus(raw: string | null | undefined): string {
  return (raw || "").toUpperCase();
}

/** Data YYYY-MM-DD → DD/MM/YYYY. */
export function fmtDateBr(s: string | null | undefined): string {
  if (!s) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return s;
}
