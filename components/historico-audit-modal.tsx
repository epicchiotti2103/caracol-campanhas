"use client";

import { useEffect, useState } from "react";
import { History, Loader2, X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { formatCurrency, formatInstantDateTime, formatNumberPtBr } from "@/lib/format";
import type { AuditEntidade, AuditItem, AuditResponse } from "@/types";

/**
 * Historico de alteracoes (audit_log) de uma entidade, lido de
 * GET /audit?entidade=&entidade_id= (desc por created_at).
 *
 * - `disponivel: false` => tabela ainda nao criada (migration 079) =>
 *   "Historico em implantacao".
 * - 403 => `fetchAudit` devolve { forbidden: true } e o chamador esconde o botao.
 */

export type AuditFetchResult =
  | { forbidden: true }
  | { forbidden: false; data: AuditResponse | null; error: string | null };

const RE_FORBIDDEN = /acesso negado|forbidden|permiss/i;

export async function fetchAudit(
  entidade: AuditEntidade,
  entidadeId: string
): Promise<AuditFetchResult> {
  try {
    const res: AuditResponse = await apiFetch(
      `/audit?entidade=${encodeURIComponent(entidade)}&entidade_id=${encodeURIComponent(entidadeId)}`
    );
    const items = Array.isArray(res?.items) ? res.items : [];
    return {
      forbidden: false,
      data: { items, total: res?.total ?? items.length, disponivel: res?.disponivel !== false },
      error: null
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (RE_FORBIDDEN.test(msg)) return { forbidden: true };
    return { forbidden: false, data: null, error: msg || "Falha ao carregar historico" };
  }
}

const ACAO_LABEL: Record<string, string> = {
  fechar: "Fechamento criado",
  salvar: "Alterado",
  travar: "Travado",
  destravar: "Destravado",
  criar: "Criado",
  editar: "Alterado",
  excluir: "Excluido",
  pagar: "Pago",
  receber: "Recebido"
};

const CAMPO_LABEL: Record<string, string> = {
  spend_final: "Faturamento",
  custo_invoice_usd: "Custo invoice (US$)",
  client_id: "Cliente",
  imposto_pct: "Imposto %",
  fx_rate: "Cambio",
  locked: "Travado",
  reason: "Motivo",
  publishers: "Publishers"
};

export interface AuditFormatContext {
  /** Moeda do fechamento (formata spend_final). */
  moeda?: string | null;
  /** Resolve uuid -> nome legivel por campo (ex.: client_id -> nome do cliente). */
  resolve?: (campo: string, valor: string) => string | null | undefined;
}

function campoLabel(campo: string): string {
  if (campo.startsWith("publisher:")) return `Pagamento ${campo.slice("publisher:".length)}`;
  return CAMPO_LABEL[campo] ?? campo;
}

function moedaDoCampo(campo: string, ctx: AuditFormatContext): string | null {
  if (campo === "spend_final") return ctx.moeda ?? "BRL";
  if (campo === "custo_invoice_usd") return "USD";
  if (campo.startsWith("publisher:")) {
    const m = /\((BRL|USD)\)\s*$/.exec(campo);
    return m ? m[1] : "USD";
  }
  return null;
}

const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;
const RE_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function truncar(s: string, max = 120): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function formatAuditValor(
  campo: string | null,
  v: unknown,
  ctx: AuditFormatContext = {}
): string {
  if (v === null || v === undefined || v === "") return "—";
  const c = campo ?? "";
  if (typeof v === "boolean") return v ? "Sim" : "Nao";
  const num =
    typeof v === "number" ? v : typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : NaN;
  if (!Number.isNaN(num)) {
    const moeda = moedaDoCampo(c, ctx);
    if (moeda) return formatCurrency(num, moeda);
    if (c === "imposto_pct") return `${formatNumberPtBr(num, 2)}%`;
    if (c === "fx_rate") return formatNumberPtBr(num, 4);
    return formatNumberPtBr(num, Number.isInteger(num) ? 0 : 2);
  }
  if (typeof v === "string") {
    const resolvido = ctx.resolve?.(c, v);
    if (resolvido) return resolvido;
    if (RE_DATE.test(v)) return `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}`;
    if (RE_INSTANT.test(v)) return formatInstantDateTime(v, v);
    return truncar(v);
  }
  if (typeof v === "object" && !Array.isArray(v)) {
    const partes = Object.entries(v as Record<string, unknown>)
      .filter(([, val]) => val !== null && val !== undefined && !(typeof val === "object" && Object.keys(val as object).length === 0))
      .map(([k, val]) => {
        if (val && typeof val === "object" && !Array.isArray(val)) {
          const sub = Object.entries(val as Record<string, unknown>)
            .map(([sk, sv]) => `${campoLabel(sk)}: ${formatAuditValor(sk, sv, ctx)}`)
            .join("; ");
          return `${campoLabel(k)}: ${sub}`;
        }
        return `${campoLabel(k)}: ${formatAuditValor(k, val, ctx)}`;
      });
    return partes.length ? partes.join(" · ") : "—";
  }
  try {
    return truncar(JSON.stringify(v));
  } catch {
    return String(v);
  }
}

export function HistoricoAuditModal({
  entidade,
  entidadeId,
  titulo,
  subtitulo,
  ctx,
  onClose
}: {
  entidade: AuditEntidade;
  entidadeId: string;
  titulo?: string;
  subtitulo?: string;
  ctx?: AuditFormatContext;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<AuditFetchResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchAudit(entidade, entidadeId).then((r) => {
      if (cancelled) return;
      setResult(r);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [entidade, entidadeId]);

  const items: AuditItem[] = result && !result.forbidden ? result.data?.items ?? [] : [];
  const disponivel = result && !result.forbidden ? result.data?.disponivel !== false : true;
  const erro = result && !result.forbidden ? result.error : null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => {
        // Pode estar aninhado em outro modal: nao deixa o clique fechar o pai.
        e.stopPropagation();
        onClose();
      }}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-border bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h3 className="inline-flex items-center gap-2 text-base font-semibold text-foreground">
              <History className="h-4 w-4 text-primary" />
              {titulo ?? "Historico de alteracoes"}
            </h3>
            {subtitulo && <p className="truncate text-sm text-muted">{subtitulo}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted transition-colors hover:text-foreground"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-muted">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : result?.forbidden ? (
            <p className="py-8 text-center text-sm text-muted">Sem acesso ao historico.</p>
          ) : erro ? (
            <p className="py-8 text-center text-sm text-red-300">{erro}</p>
          ) : !disponivel ? (
            <p className="py-8 text-center text-sm text-muted">Historico em implantacao.</p>
          ) : items.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">Nenhuma alteracao registrada.</p>
          ) : (
            <ol className="relative space-y-4 border-l border-border pl-5">
              {items.map((it) => (
                <li key={it.id} className="relative">
                  <span className="absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full border border-primary bg-surface" />
                  <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted">
                    <span className="font-mono text-foreground">
                      {formatInstantDateTime(it.created_at)}
                    </span>
                    <span>·</span>
                    <span>{it.user_email || "sistema"}</span>
                  </div>
                  <p className="mt-0.5 text-sm font-semibold text-foreground">
                    {ACAO_LABEL[it.acao] ?? it.acao}
                    {it.campo && (
                      <span className="font-normal text-muted"> — {campoLabel(it.campo)}</span>
                    )}
                  </p>
                  {(it.valor_antes != null || it.valor_depois != null) && (
                    <p className="mt-0.5 break-words text-sm">
                      {it.valor_antes != null && (
                        <>
                          <span className="text-muted line-through decoration-muted/50">
                            {formatAuditValor(it.campo, it.valor_antes, ctx)}
                          </span>
                          <span className="mx-1.5 text-muted">→</span>
                        </>
                      )}
                      <span className="text-foreground">
                        {formatAuditValor(it.campo, it.valor_depois, ctx)}
                      </span>
                    </p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}
