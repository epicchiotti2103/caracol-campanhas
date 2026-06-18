"use client";

// Modal de fechamento mensal de campanha (Etapa 3 do eixo financeiro).
// Backend (em prod): /api/v1/campanhas/{id}/fechamento + /api/v1/campanhas/fechamento/*
//
// Fluxo:
// 1) Ao abrir, GET /campanhas/{id}/fechamento?month=YYYY-MM — backend retorna
//    fechamento persistido OU stub pre-populado (id=null) com publishers vindos
//    do AppsFlyer summary do mes. Front trata os 2 com o mesmo render.
// 2) User edita cliente, spend_final, publishers e salva (POST upsert).
// 3) Locked: read-only. Botao "Destravar" volta pra editavel.

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Loader2,
  Lock,
  Plus,
  Trash2,
  Unlock,
  X
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/lib/toast-context";
import {
  blurFormatNumberPtBr,
  formatCurrency,
  formatMesAnoLong,
  moedaShort,
  parseNumberPtBr,
  sanitizeNumberInput
} from "@/lib/format";
import { ChevronDown, ChevronRight } from "lucide-react";
import type {
  CampanhaCapTipo,
  CampanhaCapUnidade,
  CampanhaPublisherRenegociacao,
  CapBreakdownPeriodo,
  Client,
  Fechamento,
  FechamentoPublisher,
  FechamentoPublisherCadastrado,
  FechamentoUpsertPayload,
  Moeda
} from "@/types";

interface Props {
  campanhaId: string;
  campanhaNome: string;
  /** "YYYY-MM" do mes que esta sendo fechado. */
  month: string;
  /** Moeda da campanha (BRL/USD). */
  moeda: string | null | undefined;
  onClose: () => void;
  /** Chamado depois de qualquer mutacao bem sucedida (upsert/lock/unlock). */
  onSaved?: (fechamento: Fechamento) => void;
}

// Linha editavel — espelha FechamentoPublisher mas com spend_final como string
// pra preservar o digitado pelo user (mascara PT-BR).
interface PublisherRow {
  id?: string | null;
  publisher_name: string;
  platform: string; // sempre "consolidado" no MVP — coluna nao exibida
  spend_real_display: string; // read-only
  spend_real_raw: number | null;
  spend_final_input: string; // mascara PT-BR
  moeda: Moeda; // moeda de PAGAMENTO do publisher (default USD)
  p360_event_rate: number | null; // % fraud events (Protect 360 AF) — read-only
  notes: string;

  // ---- Cap de eventos (so quando o publisher tem cap; vem do backend) ----
  cap_tipo: CampanhaCapTipo | null; // mensal|diario|null
  cap_unidade: CampanhaCapUnidade | null;
  realizado_qty: number | null;
  realizado_spend: number | null;
  valido_qty: number | null;
  excedente_qty: number | null;
  spend_valido: number | null;
  spend_excedente: number | null;
  excedente_aprovado: boolean;
  cap_breakdown: CapBreakdownPeriodo[];
}

function hasCap(p: PublisherRow): boolean {
  return p.cap_tipo === "mensal" || p.cap_tipo === "diario";
}

function toRow(p: FechamentoPublisher, moeda: string | null | undefined): PublisherRow {
  return {
    id: p.id ?? null,
    publisher_name: p.publisher_name || "",
    platform: p.platform || "consolidado",
    spend_real_display:
      p.spend_real != null ? formatCurrency(p.spend_real, moeda) : "—",
    spend_real_raw: p.spend_real ?? null,
    spend_final_input:
      p.spend_final != null ? blurFormatNumberPtBr(String(p.spend_final), 2) : "",
    moeda: p.moeda === "BRL" ? "BRL" : "USD",
    p360_event_rate: p.p360_event_rate ?? null,
    notes: p.notes || "",
    cap_tipo: (p.cap_tipo as CampanhaCapTipo | null) ?? null,
    cap_unidade: (p.cap_unidade as CampanhaCapUnidade | null) ?? null,
    realizado_qty: p.realizado_qty ?? null,
    realizado_spend: p.realizado_spend ?? null,
    valido_qty: p.valido_qty ?? null,
    excedente_qty: p.excedente_qty ?? null,
    spend_valido: p.spend_valido ?? null,
    spend_excedente: p.spend_excedente ?? null,
    excedente_aprovado: p.excedente_aprovado === true,
    cap_breakdown: Array.isArray(p.cap_breakdown) ? p.cap_breakdown : []
  };
}

export function CampanhaFechamentoModal({
  campanhaId,
  campanhaNome,
  month,
  moeda,
  onClose,
  onSaved
}: Props) {
  const toast = useToast();

  const moedaPrefix = moedaShort(moeda);

  // ----- Estado do fechamento -----
  const [loading, setLoading] = useState(true);
  const [fechamento, setFechamento] = useState<Fechamento | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // Form
  const [clientId, setClientId] = useState("");
  const [spendFinalInput, setSpendFinalInput] = useState("");
  const [spendRealRaw, setSpendRealRaw] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [publishers, setPublishers] = useState<PublisherRow[]>([]);
  // Linhas de cap com o breakdown expandido (por indice de publisher).
  const [expandedCaps, setExpandedCaps] = useState<Set<number>>(new Set());
  const toggleCapExpanded = (idx: number) =>
    setExpandedCaps((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  // PO acordado do cadastro (referencia; casa por NOME com o realizado).
  const [publishersCadastrados, setPublishersCadastrados] = useState<
    FechamentoPublisherCadastrado[]
  >([]);

  // ----- Clientes (dropdown buscavel) -----
  const [clients, setClients] = useState<Client[]>([]);
  const [clientSearch, setClientSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [loadingClients, setLoadingClients] = useState(false);
  const [clientsError, setClientsError] = useState("");

  // ----- Load fechamento (stub ou real) -----
  const loadFechamento = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const f = (await apiFetch(
        `/campanhas/${campanhaId}/fechamento?month=${month}`
      )) as Fechamento;
      setFechamento(f);
      setClientId(f.client_id || "");
      setSpendFinalInput(
        f.spend_final != null ? blurFormatNumberPtBr(String(f.spend_final), 2) : ""
      );
      // spend_real: quando e stub, backend NAO retorna spend_real no root, so nos publishers.
      // Usamos a soma dos spend_real dos publishers como spend_real "consolidado" de referencia.
      // Se a row e persistida (id != null), spend_real do root = soma dos publishers tb (melhor que nada).
      const sumReal = (f.publishers || []).reduce(
        (acc, p) => acc + (p.spend_real ?? 0),
        0
      );
      setSpendRealRaw(sumReal > 0 ? sumReal : null);
      setNotes(f.notes || "");
      setPublishers((f.publishers || []).map((p) => toRow(p, f.moeda || moeda)));
      setPublishersCadastrados(f.publishers_cadastrados || []);
    } catch (err: any) {
      setError(err?.message || "Falha ao carregar fechamento.");
    } finally {
      setLoading(false);
    }
  }, [campanhaId, month, moeda]);

  useEffect(() => {
    loadFechamento();
  }, [loadFechamento]);

  // ----- Carrega lista de clientes -----
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(clientSearch.trim()), 250);
    return () => clearTimeout(t);
  }, [clientSearch]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingClients(true);
      setClientsError("");
      try {
        const params = new URLSearchParams({ active: "true" });
        if (debouncedSearch) params.set("q", debouncedSearch);
        const res: { items: Client[] } | Client[] = await apiFetch(
          `/clients?${params.toString()}`
        );
        const items = Array.isArray(res) ? res : res?.items || [];
        if (!cancelled) setClients(items);
      } catch (err: any) {
        if (!cancelled) {
          setClientsError(err?.message || "Falha ao carregar clientes.");
        }
      } finally {
        if (!cancelled) setLoadingClients(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [debouncedSearch]);

  // ----- Helpers -----
  const isLocked = fechamento?.is_locked || fechamento?.locked || false;
  const isStub = !fechamento?.id;
  const readOnly = isLocked;

  const spendFinalNumber = useMemo(() => {
    const n = parseNumberPtBr(spendFinalInput);
    return Number.isFinite(n) ? n : 0;
  }, [spendFinalInput]);

  const delta = useMemo(() => {
    if (spendRealRaw == null || spendRealRaw === 0) return null;
    const diff = spendFinalNumber - spendRealRaw;
    const pct = (diff / spendRealRaw) * 100;
    return { diff, pct };
  }, [spendFinalNumber, spendRealRaw]);

  // Soma dos pagamentos dos publishers AGRUPADA por moeda (cada pub pode ter
  // moeda diferente da campanha). Ex: { USD: 1000, BRL: 500 }.
  const publishersSumByMoeda = useMemo(() => {
    const acc: Partial<Record<Moeda, number>> = {};
    for (const p of publishers) {
      const n = parseNumberPtBr(p.spend_final_input);
      const v = Number.isFinite(n) ? n : 0;
      acc[p.moeda] = (acc[p.moeda] ?? 0) + v;
    }
    return acc;
  }, [publishers]);

  // String formatada da soma (ex: "$ 1.000,00 + R$ 500,00").
  const publishersSumLabel = useMemo(() => {
    const parts: string[] = [];
    // Ordem estavel: USD primeiro, BRL depois.
    (["USD", "BRL"] as Moeda[]).forEach((m) => {
      const v = publishersSumByMoeda[m];
      if (v != null) parts.push(formatCurrency(v, m));
    });
    return parts.length > 0 ? parts.join(" + ") : formatCurrency(0, "USD");
  }, [publishersSumByMoeda]);

  // Moeda de RECEBIMENTO (campanha) normalizada.
  const moedaRecebimento: Moeda = moeda === "USD" ? "USD" : "BRL";

  // So compara soma x spend final da campanha quando TODOS os pubs pagam na
  // mesma moeda do recebimento. Com moedas mistas/distintas, nao da pra somar
  // direto — suaviza o aviso (nao mostra mismatch numerico).
  const sumComparable = useMemo(() => {
    if (publishers.length === 0) return null;
    const moedasUsadas = Object.keys(publishersSumByMoeda) as Moeda[];
    if (moedasUsadas.length !== 1 || moedasUsadas[0] !== moedaRecebimento) {
      return null;
    }
    return publishersSumByMoeda[moedaRecebimento] ?? 0;
  }, [publishers.length, publishersSumByMoeda, moedaRecebimento]);

  const publishersMismatch = useMemo(() => {
    if (sumComparable == null) return false;
    return Math.abs(sumComparable - spendFinalNumber) > 0.01;
  }, [sumComparable, spendFinalNumber]);

  // PO acordado (cadastro) indexado por nome do publisher (case-insensitive).
  // Referencia pro user ter o numero na frente — SEM calculo de margem.
  const poAcordadoByPublisher = useMemo(() => {
    const m = new Map<string, FechamentoPublisherCadastrado>();
    for (const pc of publishersCadastrados) {
      if (pc.publisher_name) {
        m.set(pc.publisher_name.trim().toLowerCase(), pc);
      }
    }
    return m;
  }, [publishersCadastrados]);

  const renderPoAcordado = useCallback(
    (publisherName: string) => {
      const pc = poAcordadoByPublisher.get(
        publisherName.trim().toLowerCase()
      );
      if (!pc || !pc.po_acordado || pc.po_acordado.length === 0) return "—";
      // PO acordado e na moeda do publisher cadastrado (default USD), nao na da campanha.
      const pcMoeda = pc.moeda ?? moeda;
      // Renegociacoes indexadas por evento (mais recente primeiro).
      const renegByEvento = new Map<string, CampanhaPublisherRenegociacao[]>();
      for (const r of pc.renegociacoes || []) {
        if (!r?.evento_nome) continue;
        const key = r.evento_nome.trim().toLowerCase();
        const arr = renegByEvento.get(key) || [];
        arr.push(r);
        renegByEvento.set(key, arr);
      }
      return (
        <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1">
          {pc.po_acordado.map((po, i) => {
            const renegs = (renegByEvento.get(po.evento_nome.trim().toLowerCase()) || [])
              .slice()
              .sort((a, b) => a.changed_at.localeCompare(b.changed_at));
            const last = renegs.length > 0 ? renegs[renegs.length - 1] : null;
            // Cadeia completa pro tooltip (ex: "$10 → $8 (06/jun) → $7 (08/jun)").
            const chainTitle =
              renegs.length > 0
                ? renegs
                    .map(
                      (r) =>
                        `${
                          r.payout_anterior != null
                            ? formatCurrency(r.payout_anterior, pcMoeda)
                            : "—"
                        } → ${
                          r.payout_novo != null
                            ? formatCurrency(r.payout_novo, pcMoeda)
                            : "—"
                        } (${fmtDateShort(r.changed_at)})`
                    )
                    .join("  ·  ")
                : undefined;
            return (
              <span key={`${po.evento_nome}-${i}`} className="inline-flex items-center gap-1">
                <span>
                  {po.evento_nome}:{" "}
                  {po.payout != null ? formatCurrency(po.payout, pcMoeda) : "—"}
                </span>
                {last && (
                  <span
                    className="rounded bg-amber-500/10 px-1 py-0.5 text-[11px] font-medium text-amber-300"
                    title={chainTitle}
                  >
                    (era{" "}
                    {last.payout_anterior != null
                      ? formatCurrency(last.payout_anterior, pcMoeda)
                      : "—"}{" "}
                    · {fmtDateShort(last.changed_at)})
                  </span>
                )}
                {i < pc.po_acordado.length - 1 && (
                  <span className="text-muted/60">·</span>
                )}
              </span>
            );
          })}
        </span>
      );
    },
    [poAcordadoByPublisher, moeda]
  );

  // ----- Handlers de publishers -----
  const updatePub = (idx: number, patch: Partial<PublisherRow>) => {
    setPublishers((prev) =>
      prev.map((row, i) => (i === idx ? { ...row, ...patch } : row))
    );
  };
  const addPub = () =>
    setPublishers((prev) => [
      ...prev,
      {
        id: null,
        publisher_name: "",
        platform: "consolidado",
        spend_real_display: "—",
        spend_real_raw: null,
        spend_final_input: "",
        moeda: "USD",
        p360_event_rate: null,
        notes: "",
        cap_tipo: null,
        cap_unidade: null,
        realizado_qty: null,
        realizado_spend: null,
        valido_qty: null,
        excedente_qty: null,
        spend_valido: null,
        spend_excedente: null,
        excedente_aprovado: false,
        cap_breakdown: []
      }
    ]);
  const removePub = (idx: number) =>
    setPublishers((prev) => prev.filter((_, i) => i !== idx));

  // Toggle "pagar excedente mesmo assim": reflete o spend_final na hora
  // (cheio = realizado_spend; cortado = spend_valido). O backend recalcula
  // de qualquer forma, mas a UI mostra o impacto imediato.
  const toggleExcedente = (idx: number, aprovado: boolean) =>
    setPublishers((prev) =>
      prev.map((row, i) => {
        if (i !== idx) return row;
        const target = aprovado ? row.realizado_spend : row.spend_valido;
        return {
          ...row,
          excedente_aprovado: aprovado,
          spend_final_input:
            target != null
              ? blurFormatNumberPtBr(String(target), 2)
              : row.spend_final_input
        };
      })
    );

  // ----- Submit (upsert) -----
  const handleSave = async () => {
    setError("");
    if (!clientId) {
      setError("Selecione um cliente.");
      return;
    }
    if (!Number.isFinite(spendFinalNumber) || spendFinalNumber < 0) {
      setError("Spend final invalido.");
      return;
    }

    const publishersPayload: FechamentoUpsertPayload["publishers"] = [];
    for (const p of publishers) {
      const name = p.publisher_name.trim();
      if (!name) continue;
      const spend = parseNumberPtBr(p.spend_final_input);
      if (!Number.isFinite(spend) || spend < 0) {
        setError(`Spend final invalido no publisher "${name}".`);
        return;
      }
      publishersPayload.push({
        publisher_name: name,
        platform: p.platform || null,
        spend_final: spend,
        moeda: p.moeda,
        p360_event_rate: p.p360_event_rate,
        notes: p.notes.trim() || null,
        // So envia a flag pra publishers com cap; backend recalcula spend_valido.
        ...(hasCap(p) ? { excedente_aprovado: p.excedente_aprovado } : {})
      });
    }

    const payload: FechamentoUpsertPayload = {
      client_id: clientId,
      spend_final: spendFinalNumber,
      notes: notes.trim() || null,
      publishers: publishersPayload
    };

    setSaving(true);
    try {
      const saved = (await apiFetch(
        `/campanhas/${campanhaId}/fechamento?month=${month}`,
        {
          method: "POST",
          body: JSON.stringify(payload)
        }
      )) as Fechamento;
      toast.success("Fechamento salvo.");
      setFechamento(saved);
      onSaved?.(saved);
      onClose();
    } catch (err: any) {
      setError(err?.message || "Falha ao salvar fechamento.");
    } finally {
      setSaving(false);
    }
  };

  // ----- Lock / Unlock -----
  const handleLock = async () => {
    if (!fechamento?.id) return;
    const reason = window.prompt(
      "Motivo do travamento (opcional — NF emitida, etc):"
    );
    setSaving(true);
    setError("");
    try {
      const saved = (await apiFetch(
        `/campanhas/fechamento/${fechamento.id}/lock`,
        {
          method: "POST",
          body: JSON.stringify({ reason: reason || null })
        }
      )) as Fechamento;
      toast.success("Fechamento travado.");
      setFechamento(saved);
      setPublishersCadastrados(saved.publishers_cadastrados || []);
      onSaved?.(saved);
    } catch (err: any) {
      setError(err?.message || "Falha ao travar fechamento.");
    } finally {
      setSaving(false);
    }
  };

  const handleUnlock = async () => {
    if (!fechamento?.id) return;
    if (
      !window.confirm("Destravar fechamento? Isso libera edicao novamente.")
    ) {
      return;
    }
    setSaving(true);
    setError("");
    try {
      const saved = (await apiFetch(
        `/campanhas/fechamento/${fechamento.id}/unlock`,
        { method: "POST" }
      )) as Fechamento;
      toast.success("Fechamento destravado.");
      setFechamento(saved);
      // Recarrega pra refazer o form a partir do novo estado.
      setClientId(saved.client_id || "");
      setSpendFinalInput(
        saved.spend_final != null
          ? blurFormatNumberPtBr(String(saved.spend_final), 2)
          : ""
      );
      setNotes(saved.notes || "");
      setPublishers(
        (saved.publishers || []).map((p) => toRow(p, saved.moeda || moeda))
      );
      setPublishersCadastrados(saved.publishers_cadastrados || []);
      onSaved?.(saved);
    } catch (err: any) {
      setError(err?.message || "Falha ao destravar fechamento.");
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-primary/60 disabled:opacity-60";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-xl border border-border bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-border bg-zinc-950 px-6 py-4">
          <div className="min-w-0">
            <p className="text-base font-semibold text-orange-50">
              Fechamento de {formatMesAnoLong(`${month}-01`) || month}
            </p>
            <p className="mt-0.5 truncate text-xs text-orange-100/60">
              {campanhaNome}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <StatusBadge locked={isLocked} stub={isStub} />
            <button
              onClick={onClose}
              className="text-orange-100/40 hover:text-orange-50"
              aria-label="Fechar"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="max-h-[70vh] overflow-y-auto px-6 py-5">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : error && !fechamento ? (
            <ErrorBox text={error} />
          ) : (
            <div className="space-y-6">
              {fechamento?.campanha_paused && (
                <div className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
                  <p className="font-medium">
                    ⚠ Campanha inteira foi pausada
                    {fechamento.paused_at &&
                      ` em ${fmtDate(fechamento.paused_at)}`}
                    {fechamento.paused_reason &&
                      ` — ${fechamento.paused_reason}`}
                    {fechamento.paused_registered_at &&
                      ` (registrado ${fmtDate(
                        fechamento.paused_registered_at
                      )})`}
                  </p>
                </div>
              )}

              {/* Section 1: Dados do fechamento */}
              <section className="space-y-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-primary">
                  Dados do fechamento
                </h3>

                {/* Cliente */}
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-foreground">
                    Cliente <span className="text-primary">*</span>
                  </label>
                  {!readOnly && (
                    <input
                      type="text"
                      value={clientSearch}
                      onChange={(e) => setClientSearch(e.target.value)}
                      placeholder="Buscar cliente por nome..."
                      className={inputCls + " mb-2"}
                      aria-label="Buscar cliente"
                    />
                  )}
                  <select
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    disabled={readOnly || loadingClients}
                    className={inputCls}
                  >
                    <option value="">
                      {loadingClients ? "Carregando..." : "Selecione um cliente"}
                    </option>
                    {/* Garante que o cliente atual aparece mesmo se nao bate com busca */}
                    {clientId &&
                      !clients.find((c) => c.id === clientId) &&
                      fechamento?.client_name && (
                        <option value={clientId}>
                          {fechamento.client_name} (atual)
                        </option>
                      )}
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {c.tax_id ? ` — ${c.tax_id}` : ""}
                      </option>
                    ))}
                  </select>
                  {clientsError && (
                    <p className="mt-1 text-xs text-danger">{clientsError}</p>
                  )}
                </div>

                {/* Spend final + spend real + moeda */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-foreground">
                      Spend final (cliente paga){" "}
                      <span className="text-primary">*</span>
                    </label>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted">{moedaPrefix}</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={spendFinalInput}
                        onChange={(e) =>
                          setSpendFinalInput(sanitizeNumberInput(e.target.value))
                        }
                        onBlur={(e) =>
                          setSpendFinalInput(blurFormatNumberPtBr(e.target.value))
                        }
                        disabled={readOnly}
                        placeholder="0,00"
                        className={inputCls + " flex-1"}
                      />
                    </div>
                    <div className="mt-1.5 space-y-0.5 text-xs">
                      <p className="text-muted">
                        Real do AppsFlyer:{" "}
                        <span className="font-mono text-foreground">
                          {spendRealRaw != null
                            ? formatCurrency(spendRealRaw, moeda)
                            : "—"}
                        </span>
                      </p>
                      {delta && (
                        <p
                          className={`font-mono ${
                            delta.diff < 0 ? "text-danger" : "text-emerald-300"
                          }`}
                        >
                          Diferenca: {delta.diff >= 0 ? "+" : ""}
                          {formatCurrency(delta.diff, moeda)} (
                          {delta.pct >= 0 ? "+" : ""}
                          {delta.pct.toFixed(1)}%)
                        </p>
                      )}
                    </div>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-foreground">
                      Moeda
                    </label>
                    <input
                      type="text"
                      value={fechamento?.moeda || moeda || "BRL"}
                      disabled
                      className={inputCls}
                    />
                    <p className="mt-1 text-xs text-muted">
                      Moeda da campanha (read-only).
                    </p>
                  </div>
                </div>

                {/* Notas */}
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-foreground">
                    Notas internas
                  </label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={2}
                    disabled={readOnly}
                    placeholder="Observacoes (opcional)"
                    className={inputCls + " resize-y"}
                  />
                  {isLocked && fechamento?.locked_at && (
                    <p className="mt-1.5 text-xs text-amber-300">
                      Travado em {fmtDateTime(fechamento.locked_at)}.
                    </p>
                  )}
                </div>
              </section>

              {/* Section 2: Publishers */}
              <section className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-primary">
                    Publishers
                  </h3>
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={addPub}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border bg-background px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-primary/40 hover:text-foreground"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Adicionar publisher
                    </button>
                  )}
                </div>

                {publishers.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border bg-background p-6 text-center text-sm text-muted">
                    Nenhum publisher. Adicione manualmente se quiser detalhar o
                    repasse por canal.
                  </p>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border bg-background/40">
                          <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted">
                            Publisher
                          </th>
                          <th
                            className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted"
                            title="PO (payout) acordado no cadastro da campanha, por evento. Referencia."
                          >
                            PO acordado
                          </th>
                          <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-muted">
                            Spend real
                          </th>
                          <th
                            className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-muted"
                            title="Valor pago ao publisher (repasse). A moeda e por publisher (default USD), independente da moeda de recebimento da campanha."
                          >
                            Pagamento
                          </th>
                          <th className="px-3 py-2 text-center text-xs font-semibold uppercase tracking-wider text-muted">
                            Moeda
                          </th>
                          <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-muted">
                            % Fraud Events
                          </th>
                          {!readOnly && (
                            <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-muted">
                              {""}
                            </th>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {publishers.map((p, idx) => {
                          const capColSpan = readOnly ? 6 : 7;
                          const showCap = hasCap(p);
                          const expanded = expandedCaps.has(idx);
                          return (
                          <Fragment key={p.id || `new-${idx}`}>
                          <tr
                            className={
                              !showCap && idx < publishers.length - 1
                                ? "border-b border-border"
                                : ""
                            }
                          >
                            <td className="px-3 py-2">
                              <input
                                type="text"
                                value={p.publisher_name}
                                onChange={(e) =>
                                  updatePub(idx, {
                                    publisher_name: e.target.value
                                  })
                                }
                                disabled={readOnly}
                                placeholder="Ex: googleadwords_int"
                                className="w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-sm text-foreground outline-none focus:border-primary/40 disabled:opacity-60"
                              />
                              <InactiveMediaSources
                                cadastrado={poAcordadoByPublisher.get(
                                  p.publisher_name.trim().toLowerCase()
                                )}
                              />
                            </td>
                            <td className="px-3 py-2 text-left text-xs text-muted">
                              {renderPoAcordado(p.publisher_name)}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-xs text-muted">
                              {p.spend_real_display}
                            </td>
                            <td className="px-3 py-2 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                <span className="text-xs text-muted">
                                  {moedaShort(p.moeda)}
                                </span>
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={p.spend_final_input}
                                  onChange={(e) =>
                                    updatePub(idx, {
                                      spend_final_input: sanitizeNumberInput(
                                        e.target.value
                                      )
                                    })
                                  }
                                  onBlur={(e) =>
                                    updatePub(idx, {
                                      spend_final_input: blurFormatNumberPtBr(
                                        e.target.value
                                      )
                                    })
                                  }
                                  disabled={readOnly}
                                  placeholder="0,00"
                                  className="w-28 rounded border border-border bg-background px-2 py-1 text-right font-mono text-sm text-foreground outline-none focus:border-primary/40 disabled:opacity-60"
                                />
                              </div>
                            </td>
                            <td className="px-3 py-2 text-center">
                              <select
                                value={p.moeda}
                                onChange={(e) =>
                                  updatePub(idx, {
                                    moeda: e.target.value === "BRL" ? "BRL" : "USD"
                                  })
                                }
                                disabled={readOnly}
                                aria-label="Moeda de pagamento do publisher"
                                className="rounded border border-border bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-primary/40 disabled:opacity-60"
                              >
                                <option value="USD">USD</option>
                                <option value="BRL">BRL</option>
                              </select>
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-xs text-muted">
                              {p.p360_event_rate != null
                                ? `${(p.p360_event_rate * 100).toFixed(2)}%`
                                : "—"}
                            </td>
                            {!readOnly && (
                              <td className="px-3 py-2 text-right">
                                <button
                                  type="button"
                                  onClick={() => removePub(idx)}
                                  className="text-muted transition-colors hover:text-danger"
                                  aria-label="Remover publisher"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </td>
                            )}
                          </tr>
                          {showCap && (
                            <tr
                              className={
                                idx < publishers.length - 1
                                  ? "border-b border-border"
                                  : ""
                              }
                            >
                              <td colSpan={capColSpan} className="px-3 pb-3 pt-0">
                                <CapExcedenteBlock
                                  row={p}
                                  moeda={p.moeda}
                                  expanded={expanded}
                                  onToggleExpand={() => toggleCapExpanded(idx)}
                                  onToggleAprovado={(v) =>
                                    toggleExcedente(idx, v)
                                  }
                                  readOnly={readOnly}
                                />
                              </td>
                            </tr>
                          )}
                          </Fragment>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-border bg-background/40">
                          <td
                            className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-muted"
                            colSpan={3}
                          >
                            Soma (pagamentos)
                          </td>
                          <td
                            className="px-3 py-2 text-right font-mono text-sm text-foreground"
                            colSpan={2}
                          >
                            {publishersSumLabel}
                          </td>
                          <td className="px-3 py-2" colSpan={readOnly ? 1 : 2} />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}

                {publishersMismatch && sumComparable != null && (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                    <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-300" />
                    <p className="text-xs text-amber-200">
                      A soma dos pagamentos (
                      {formatCurrency(sumComparable, moedaRecebimento)}) e
                      diferente do spend final da campanha (
                      {formatCurrency(spendFinalNumber, moedaRecebimento)}).
                      Ajuste se for o caso — nao bloqueia o salvamento.
                    </p>
                  </div>
                )}
              </section>

              {error && fechamento && <ErrorBox text={error} />}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-surface px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg border border-border bg-background px-4 py-2 text-sm text-muted transition-colors hover:text-foreground disabled:opacity-50"
          >
            {readOnly ? "Fechar" : "Cancelar"}
          </button>

          {/* Lock: aparece quando existe (id != null) e nao locked */}
          {fechamento?.id && !isLocked && (
            <button
              type="button"
              onClick={handleLock}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm font-semibold text-amber-200 transition-colors hover:bg-amber-500/20 disabled:opacity-50"
            >
              <Lock className="h-4 w-4" />
              Travar fechamento
            </button>
          )}

          {/* Unlock: aparece quando locked */}
          {fechamento?.id && isLocked && (
            <button
              type="button"
              onClick={handleUnlock}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-surface disabled:opacity-50"
            >
              <Unlock className="h-4 w-4" />
              Destravar
            </button>
          )}

          {/* Save: oculto quando locked */}
          {!isLocked && (
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || loading}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {saving ? "Salvando..." : "Salvar fechamento"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ locked, stub }: { locked: boolean; stub: boolean }) {
  if (locked) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider text-emerald-300">
        <Lock className="h-3 w-3" />
        Travado
      </span>
    );
  }
  if (stub) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-zinc-500/30 bg-zinc-500/10 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider text-zinc-300">
        Aberto
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider text-amber-300">
      Fechado
    </span>
  );
}

function ErrorBox({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-danger/20 bg-danger/10 p-3">
      <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-danger" />
      <p className="text-sm text-danger">{text}</p>
    </div>
  );
}

function fmtDateTime(s: string | null | undefined): string {
  if (!s) return "";
  try {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return s;
    return d.toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch {
    return s;
  }
}

// Quantidade inteira PT-BR (1.234) pra cap em eventos.
function fmtQty(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(v);
}

// Formata realizado/valido/excedente conforme a unidade do cap.
// US$: valor monetario na moeda do publisher; Eventos: quantidade.
function fmtCapValue(
  v: number | null | undefined,
  unidade: CampanhaCapUnidade | null,
  moeda: Moeda
): string {
  if (v == null) return "—";
  return unidade === "usd" ? formatCurrency(v, moeda) : fmtQty(v);
}

function capTipoLabelPt(t: CampanhaCapTipo | null): string {
  return t === "diario" ? "diario" : t === "mensal" ? "mensal" : "—";
}

/**
 * Bloco de cap/excedente de um publisher no fechamento.
 * Mostra Realizado / Valido / Excedente desconsiderado + breakdown expansivel
 * + toggle "pagar excedente mesmo assim".
 */
function CapExcedenteBlock({
  row,
  moeda,
  expanded,
  onToggleExpand,
  onToggleAprovado,
  readOnly
}: {
  row: PublisherRow;
  moeda: Moeda;
  expanded: boolean;
  onToggleExpand: () => void;
  onToggleAprovado: (v: boolean) => void;
  readOnly: boolean;
}) {
  const unidade = row.cap_unidade;
  const realizadoQ = unidade === "usd" ? row.realizado_spend : row.realizado_qty;
  const validoQ = unidade === "usd" ? row.spend_valido : row.valido_qty;
  const excedenteQ = unidade === "usd" ? row.spend_excedente : row.excedente_qty;
  const hasExcedente = (excedenteQ ?? 0) > 0.0001;
  const breakdown = row.cap_breakdown || [];

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <span className="font-semibold uppercase tracking-wider text-amber-300">
            Cap {capTipoLabelPt(row.cap_tipo)}
          </span>
          <span className="text-muted">
            Realizado:{" "}
            <span className="font-mono text-foreground">
              {fmtCapValue(realizadoQ, unidade, moeda)}
            </span>
          </span>
          <span className="text-muted">
            Valido:{" "}
            <span className="font-mono text-emerald-300">
              {fmtCapValue(validoQ, unidade, moeda)}
            </span>
          </span>
          <span className="text-muted">
            Excedente desconsiderado:{" "}
            <span
              className={
                hasExcedente
                  ? "font-mono text-danger"
                  : "font-mono text-foreground"
              }
            >
              {fmtCapValue(excedenteQ, unidade, moeda)}
            </span>
          </span>
        </div>
        {breakdown.length > 0 && (
          <button
            type="button"
            onClick={onToggleExpand}
            className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-1 text-xs text-muted transition-colors hover:text-foreground"
          >
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            Detalhe
          </button>
        )}
      </div>

      {expanded && breakdown.length > 0 && (
        <div className="mt-2 overflow-x-auto rounded border border-border bg-background/40">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-muted">
                <th className="px-2 py-1.5 text-left font-medium">Periodo</th>
                <th className="px-2 py-1.5 text-right font-medium">Cap</th>
                <th className="px-2 py-1.5 text-right font-medium">Dias</th>
                <th className="px-2 py-1.5 text-right font-medium">Realizado</th>
                <th className="px-2 py-1.5 text-right font-medium">Valido</th>
                <th className="px-2 py-1.5 text-right font-medium">Excedente</th>
              </tr>
            </thead>
            <tbody>
              {breakdown.map((b, i) => (
                <tr key={i} className="border-b border-border/60 last:border-0">
                  <td className="px-2 py-1.5 text-foreground">
                    {fmtDateShort(b.inicio)}
                    {b.fim ? `–${fmtDateShort(b.fim)}` : ""}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-muted">
                    {fmtCapValue(b.cap, unidade, moeda)}
                    {row.cap_tipo === "diario" ? "/dia" : ""}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-muted">
                    {b.dias != null ? b.dias : "—"}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-foreground">
                    {fmtCapValue(b.realizado, unidade, moeda)}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-emerald-300">
                    {fmtCapValue(b.valido, unidade, moeda)}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-danger">
                    {fmtCapValue(b.excedente, unidade, moeda)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <label
        className={`mt-2 inline-flex items-center gap-2 text-xs ${
          readOnly ? "opacity-60" : "cursor-pointer"
        }`}
      >
        <input
          type="checkbox"
          checked={row.excedente_aprovado}
          disabled={readOnly || !hasExcedente}
          onChange={(e) => onToggleAprovado(e.target.checked)}
          className="h-3.5 w-3.5 accent-amber-500"
        />
        <span className="text-foreground">
          Pagar excedente mesmo assim
        </span>
        {!hasExcedente && (
          <span className="text-muted">(sem excedente neste mes)</span>
        )}
      </label>
    </div>
  );
}

/** Data curta PT-BR (ex: "06/jun") pro indicador de renegociacao. */
function fmtDateShort(s: string | null | undefined): string {
  if (!s) return "";
  try {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return s;
    return d.toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "short"
    });
  } catch {
    return s;
  }
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return "";
  try {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return s;
    return d.toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    });
  } catch {
    return s;
  }
}

/** Destaca as media sources INATIVAS de um publisher cadastrado no fechamento. */
function InactiveMediaSources({
  cadastrado
}: {
  cadastrado: FechamentoPublisherCadastrado | undefined;
}) {
  const inativas = (cadastrado?.media_sources || []).filter(
    (ms) => ms && ms.active === false
  );
  if (inativas.length === 0) return null;
  return (
    <div className="mt-1.5 space-y-1">
      {inativas.map((ms) => (
        <div
          key={ms.id || ms.name}
          className="flex flex-wrap items-center gap-1.5 text-[11px] leading-tight"
        >
          <span className="font-mono text-muted line-through">{ms.name}</span>
          <span className="rounded bg-danger/10 px-1 py-0.5 font-semibold uppercase tracking-wider text-danger">
            inativa
          </span>
          {ms.deactivated_reason && (
            <span className="text-muted">— {ms.deactivated_reason}</span>
          )}
          {ms.deactivated_at && (
            <span className="text-muted">
              Pausado em {fmtDate(ms.deactivated_at)}
              {ms.deactivated_registered_at && (
                <span className="ml-1 text-[10px] text-muted/70">
                  (registrado em {fmtDate(ms.deactivated_registered_at)})
                </span>
              )}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
