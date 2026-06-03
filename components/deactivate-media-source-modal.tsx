"use client";

import { ReasonDateModal } from "./reason-date-modal";

/**
 * Modal de justificativa OBRIGATORIA pra desativar uma media source (PID).
 * Compartilhado entre a tela de detalhe (PublishersTable, modo leitura) e o
 * form de edicao (CampanhaForm). Wrapper fino sobre o `ReasonDateModal` generico
 * (motivo select + data efetiva) — mesma logica reusada pela pausa de campanha.
 */
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
  return (
    <ReasonDateModal
      title="Desativar media source"
      description={
        <>
          Desativar{" "}
          <span className="font-mono text-foreground">{name}</span>. Informe a
          justificativa (obrigatoria).
        </>
      }
      confirmLabel="Desativar"
      confirmVariant="danger"
      submitting={submitting}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
