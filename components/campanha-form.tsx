"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, AlertCircle, Plus, X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/lib/toast-context";
import type { Campanha, CampanhaPO, CampanhaStatus, Moeda } from "@/types";

const STATUS_OPTIONS: { value: CampanhaStatus; label: string }[] = [
  { value: "ativa", label: "Ativa" },
  { value: "pausada", label: "Pausada" },
  { value: "encerrada", label: "Encerrada" }
];

const MOEDA_OPTIONS: { value: Moeda; label: string; short: string }[] = [
  { value: "BRL", label: "R$ (BRL)", short: "R$" },
  { value: "USD", label: "U$ (USD)", short: "U$" }
];

interface CampanhaFormProps {
  initial?: Campanha | null;
  /** Quando passado, o form faz PATCH /campanhas/{id} em vez de POST */
  campanhaId?: string;
}

function toDateInput(s: string | null | undefined): string {
  if (!s) return "";
  // Aceita "YYYY-MM-DD" ou ISO completo.
  return s.length >= 10 ? s.slice(0, 10) : "";
}

function normalizeMoeda(m: string | null | undefined): Moeda {
  return m === "USD" ? "USD" : "BRL";
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
    initial?.budget != null ? String(initial.budget) : ""
  );
  const [moeda, setMoeda] = useState<Moeda>(normalizeMoeda(initial?.moeda));
  const [fluxo, setFluxo] = useState(initial?.fluxo ?? "");

  // Listas dinamicas — comecam com 1 linha vazia se nao tem nada
  const [eventosPagos, setEventosPagos] = useState<string[]>(
    initial?.eventos_pagos && initial.eventos_pagos.length > 0
      ? [...initial.eventos_pagos]
      : [""]
  );
  const [pos, setPos] = useState<CampanhaPO[]>(
    initial?.pos && initial.pos.length > 0
      ? initial.pos.map((p) => ({
          numero: p.numero,
          moeda: normalizeMoeda(p.moeda)
        }))
      : [{ numero: "", moeda: "BRL" }]
  );

  // Criativo e observacoes
  const [criativo, setCriativo] = useState(initial?.criativo ?? "");
  const [obs, setObs] = useState(initial?.obs ?? "");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const updateEvento = (idx: number, value: string) => {
    setEventosPagos((prev) => prev.map((v, i) => (i === idx ? value : v)));
  };
  const addEvento = () => setEventosPagos((prev) => [...prev, ""]);
  const removeEvento = (idx: number) => {
    setEventosPagos((prev) =>
      prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)
    );
  };

  const updatePo = (idx: number, patch: Partial<CampanhaPO>) => {
    setPos((prev) =>
      prev.map((p, i) => (i === idx ? { ...p, ...patch } : p))
    );
  };
  const addPo = () =>
    setPos((prev) => [...prev, { numero: "", moeda: "BRL" }]);
  const removePo = (idx: number) => {
    setPos((prev) =>
      prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Informe o nome da campanha.");
      return;
    }

    // Limpa listas — remove entradas totalmente vazias.
    const cleanEventos = eventosPagos
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
    const cleanPos = pos
      .map((p) => ({ numero: p.numero.trim(), moeda: p.moeda }))
      .filter((p) => p.numero.length > 0);

    const parsedBudget = budget.trim() ? Number(budget) : null;
    if (parsedBudget != null && Number.isNaN(parsedBudget)) {
      setError("Budget invalido.");
      return;
    }

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
      criativo: criativo.trim() || null,
      obs: obs.trim() || null,
      eventos_pagos: cleanEventos,
      pos: cleanPos
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
          <Field label="Budget">
            <input
              type="number"
              step="0.01"
              min="0"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              placeholder="0,00"
              className={inputCls}
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

      <Section title="Eventos pagos">
        <div className="space-y-2">
          {eventosPagos.map((ev, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <input
                type="text"
                value={ev}
                onChange={(e) => updateEvento(idx, e.target.value)}
                placeholder="Ex: install, purchase, registration"
                className={inputCls}
              />
              {eventosPagos.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeEvento(idx)}
                  className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted transition-colors hover:border-danger/40 hover:text-danger"
                  title="Remover"
                  aria-label="Remover evento"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
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

      <Section title="POs">
        <div className="space-y-2">
          {pos.map((p, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <input
                type="text"
                value={p.numero}
                onChange={(e) => updatePo(idx, { numero: e.target.value })}
                placeholder="Numero da PO (ex: PO-123)"
                className={inputCls}
              />
              <select
                value={p.moeda}
                onChange={(e) =>
                  updatePo(idx, { moeda: e.target.value as Moeda })
                }
                className="w-24 flex-shrink-0 rounded-lg border border-border bg-background px-2 py-2.5 text-sm text-foreground outline-none transition-colors focus:border-primary/60"
                aria-label="Moeda da PO"
              >
                {MOEDA_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.short}
                  </option>
                ))}
              </select>
              {pos.length > 1 && (
                <button
                  type="button"
                  onClick={() => removePo(idx)}
                  className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted transition-colors hover:border-danger/40 hover:text-danger"
                  title="Remover"
                  aria-label="Remover PO"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={addPo}
            className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border bg-background px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-primary/40 hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
            Adicionar PO
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

function Section({
  title,
  children
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4 rounded-xl border border-border bg-surface p-6">
      <h2 className="text-xs font-semibold uppercase tracking-widest text-primary">
        {title}
      </h2>
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
