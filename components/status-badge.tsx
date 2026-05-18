import type { CampanhaStatus } from "@/types";

const labels: Record<CampanhaStatus, string> = {
  ativa: "Ativa",
  pausada: "Pausada",
  encerrada: "Encerrada"
};

const classes: Record<CampanhaStatus, string> = {
  ativa: "border border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  pausada: "border border-amber-500/30 bg-amber-500/10 text-amber-300",
  encerrada: "border border-zinc-500/30 bg-zinc-500/10 text-zinc-300"
};

export function StatusBadge({ status }: { status: CampanhaStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${classes[status]}`}
    >
      {labels[status]}
    </span>
  );
}
