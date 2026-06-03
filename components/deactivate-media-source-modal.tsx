"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

function todayIso(): string {
  // YYYY-MM-DD no fuso local (input type="date" usa esse formato)
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

/**
 * Modal de justificativa OBRIGATORIA pra desativar uma media source (PID).
 * Compartilhado entre a tela de detalhe (PublishersTable, modo leitura) e o
 * form de edicao (CampanhaForm). O backend exige `reason` ao desativar e aceita
 * `deactivated_at` (data EFETIVA da pausa, default hoje). O `deactivated_registered_at`
 * e gravado automaticamente pelo backend (now()), nao tem input aqui.
 */
const PAUSE_REASONS = ["Fraude em excesso", "Limite budget", "Outro"] as const;

export function DeactivateMediaSourceModal({
  name,
  submitting,
  onConfirm,
  onCancel
}: {
  name: string;
  submitting: boolean;
  onConfirm: (reason: string, deactivatedAt: string) => void;
  onCancel: () => void;
}) {
  const [option, setOption] = useState("");
  const [otherReason, setOtherReason] = useState("");
  const [deactivatedAt, setDeactivatedAt] = useState(todayIso());
  const isOther = option === "Outro";
  const otherTrimmed = otherReason.trim();
  const finalReason = isOther ? otherTrimmed : option;
  const canConfirm =
    !!option && (!isOther || !!otherTrimmed) && !!deactivatedAt;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-xl">
        <h3 className="mb-2 text-base font-semibold text-foreground">
          Desativar media source
        </h3>
        <p className="mb-4 text-sm text-muted">
          Desativar{" "}
          <span className="font-mono text-foreground">{name}</span>. Informe a
          justificativa (obrigatoria).
        </p>
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
          Data da pausa
        </label>
        <input
          type="date"
          value={deactivatedAt}
          onChange={(e) => setDeactivatedAt(e.target.value)}
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
            onClick={() => onConfirm(finalReason, deactivatedAt)}
            disabled={submitting || !canConfirm}
            className="flex items-center gap-2 rounded-lg bg-danger px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Desativar
          </button>
        </div>
      </div>
    </div>
  );
}
