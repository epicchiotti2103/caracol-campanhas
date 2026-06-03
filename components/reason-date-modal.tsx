"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

export function todayIso(): string {
  // YYYY-MM-DD no fuso local (input type="date" usa esse formato)
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

/**
 * Opcoes de motivo compartilhadas (pausa de media source OU campanha inteira):
 * select [Fraude em excesso, Limite budget, Outro]. "Outro" abre campo livre.
 */
export const PAUSE_REASONS = [
  "Fraude em excesso",
  "Limite budget",
  "Outro"
] as const;

/**
 * Modal generico "motivo + data" (DRY entre desativar PID e pausar campanha).
 * O `reason` final = label da opcao escolhida OU texto livre quando "Outro".
 * O `effectiveAt` = data EFETIVA (default hoje, editavel). O registro automatico
 * (now()) e feito pelo backend, sem input aqui.
 */
export function ReasonDateModal({
  title,
  description,
  dateLabel = "Data da pausa",
  confirmLabel = "Confirmar",
  confirmVariant = "danger",
  submitting,
  onConfirm,
  onCancel
}: {
  title: string;
  description: React.ReactNode;
  dateLabel?: string;
  confirmLabel?: string;
  confirmVariant?: "danger" | "primary";
  submitting: boolean;
  onConfirm: (reason: string, effectiveAt: string) => void;
  onCancel: () => void;
}) {
  const [option, setOption] = useState("");
  const [otherReason, setOtherReason] = useState("");
  const [effectiveAt, setEffectiveAt] = useState(todayIso());
  const isOther = option === "Outro";
  const otherTrimmed = otherReason.trim();
  const finalReason = isOther ? otherTrimmed : option;
  const canConfirm = !!option && (!isOther || !!otherTrimmed) && !!effectiveAt;

  const confirmCls =
    confirmVariant === "primary"
      ? "bg-primary text-black"
      : "bg-danger text-white";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-xl">
        <h3 className="mb-2 text-base font-semibold text-foreground">{title}</h3>
        <p className="mb-4 text-sm text-muted">{description}</p>
        <label className="mb-1 block text-xs font-medium text-muted">
          Motivo da pausa
        </label>
        <select
          value={option}
          onChange={(e) => setOption(e.target.value)}
          autoFocus
          className="mb-4 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
        >
          <option value="">Selecione um motivo...</option>
          {PAUSE_REASONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        {isOther && (
          <textarea
            value={otherReason}
            onChange={(e) => setOtherReason(e.target.value)}
            rows={3}
            placeholder="Descreva o motivo..."
            className="mb-4 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
          />
        )}
        <label className="mb-1 block text-xs font-medium text-muted">
          {dateLabel}
        </label>
        <input
          type="date"
          value={effectiveAt}
          onChange={(e) => setEffectiveAt(e.target.value)}
          className="mb-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
        />
        <p className="mb-4 text-xs text-muted">
          Registrado automaticamente na data de hoje.
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="rounded-lg border border-border bg-background px-4 py-2 text-sm text-muted transition-colors hover:text-foreground disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => onConfirm(finalReason, effectiveAt)}
            disabled={submitting || !canConfirm}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-50 ${confirmCls}`}
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
