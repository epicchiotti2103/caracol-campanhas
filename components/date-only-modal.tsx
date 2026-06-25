"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { todayIso } from "./reason-date-modal";

/**
 * Modal generico de "data efetiva" (sem motivo). Espelha o visual do
 * `ReasonDateModal`, mas sem o campo de motivo — usado na REATIVACAO da campanha,
 * onde so se pede a data efetiva da reativacao (default hoje). O registro
 * automatico (now()) e feito pelo backend, sem input aqui.
 */
export function DateOnlyModal({
  title,
  description,
  dateLabel = "Data efetiva",
  registeredNote = "Registrado automaticamente na data de hoje.",
  confirmLabel = "Confirmar",
  confirmVariant = "primary",
  submitting,
  onConfirm,
  onCancel
}: {
  title: string;
  description: React.ReactNode;
  dateLabel?: string;
  registeredNote?: string;
  confirmLabel?: string;
  confirmVariant?: "danger" | "primary";
  submitting: boolean;
  onConfirm: (effectiveAt: string) => void;
  onCancel: () => void;
}) {
  const [effectiveAt, setEffectiveAt] = useState(todayIso());
  const canConfirm = !!effectiveAt;

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
          {dateLabel}
        </label>
        <input
          type="date"
          value={effectiveAt}
          onChange={(e) => setEffectiveAt(e.target.value)}
          autoFocus
          className="mb-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
        />
        <p className="mb-4 text-xs text-muted">{registeredNote}</p>
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
            onClick={() => onConfirm(effectiveAt)}
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
