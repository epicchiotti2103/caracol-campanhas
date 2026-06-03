"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

/**
 * Modal de justificativa OBRIGATORIA pra desativar uma media source (PID).
 * Compartilhado entre a tela de detalhe (PublishersTable, modo leitura) e o
 * form de edicao (CampanhaForm). O backend exige `reason` ao desativar.
 */
export function DeactivateMediaSourceModal({
  name,
  submitting,
  onConfirm,
  onCancel
}: {
  name: string;
  submitting: boolean;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  const trimmed = reason.trim();
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
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          autoFocus
          placeholder="Ex: fraude detectada, parceiro pausado..."
          className="mb-4 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
        />
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
            onClick={() => onConfirm(trimmed)}
            disabled={submitting || !trimmed}
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
