"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Loader2, AlertCircle, Pencil } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { apiFetch } from "@/lib/api";
import type { Campanha } from "@/types";

export default function CampanhaDetailPage() {
  return (
    <AppShell>
      <CampanhaDetail />
    </AppShell>
  );
}

function CampanhaDetail() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [campanha, setCampanha] = useState<Campanha | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const res: Campanha = await apiFetch(`/campanhas/${id}`);
        if (!cancelled) setCampanha(res);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || "Falha ao carregar campanha.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <Link
        href="/campanhas"
        className="mb-4 inline-flex items-center gap-1 text-xs text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Voltar
      </Link>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : error ? (
        <div className="flex items-start gap-2.5 rounded-lg border border-danger/20 bg-danger/10 p-3">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-danger" />
          <p className="text-sm text-danger">{error}</p>
        </div>
      ) : !campanha ? (
        <p className="text-sm text-muted">Campanha nao encontrada.</p>
      ) : (
        <>
          <div className="mb-6 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-widest text-primary">
                Campanha
              </h4>
              <h1 className="truncate text-2xl font-semibold text-foreground">
                {campanha.name}
              </h1>
              {campanha.slug && (
                <p className="mt-1 text-xs text-muted">/{campanha.slug}</p>
              )}
            </div>
            <button
              type="button"
              disabled
              title="Edicao chega na fase 2"
              className="flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-muted opacity-60"
            >
              <Pencil className="h-4 w-4" />
              Editar
            </button>
          </div>

          <div className="space-y-4 rounded-xl border border-border bg-surface p-6">
            <Field label="Status">
              <StatusBadge status={campanha.status} />
            </Field>
            <Field label="Owner">
              <p className="text-sm text-foreground">
                {campanha.owner_name || campanha.owner_id}
              </p>
            </Field>
            <Field label="Criada em">
              <p className="text-sm text-foreground">
                {fmtDateTime(campanha.created_at)}
              </p>
            </Field>
            {campanha.updated_at && (
              <Field label="Atualizada em">
                <p className="text-sm text-foreground">
                  {fmtDateTime(campanha.updated_at)}
                </p>
              </Field>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Field({
  label,
  children
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-3 items-start gap-3">
      <p className="text-xs font-medium uppercase tracking-wider text-muted">
        {label}
      </p>
      <div className="col-span-2">{children}</div>
    </div>
  );
}

function fmtDateTime(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR");
}
