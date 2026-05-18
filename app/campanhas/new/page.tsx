"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, AlertCircle } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/lib/toast-context";
import type { CampanhaStatus } from "@/types";

const STATUS_OPTIONS: { value: CampanhaStatus; label: string }[] = [
  { value: "ativa", label: "Ativa" },
  { value: "pausada", label: "Pausada" },
  { value: "encerrada", label: "Encerrada" }
];

export default function NewCampanhaPage() {
  return (
    <AppShell>
      <NewCampanhaForm />
    </AppShell>
  );
}

function NewCampanhaForm() {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [status, setStatus] = useState<CampanhaStatus>("ativa");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Informe o nome da campanha.");
      return;
    }

    setSubmitting(true);
    try {
      const body: Record<string, any> = {
        name: trimmedName,
        status
      };
      const trimmedSlug = slug.trim();
      if (trimmedSlug) body.slug = trimmedSlug;

      const created: { id: string } = await apiFetch("/campanhas", {
        method: "POST",
        body: JSON.stringify(body)
      });

      toast.success("Campanha criada.");
      if (created?.id) {
        router.push(`/campanhas/${created.id}`);
      } else {
        router.push("/campanhas");
      }
    } catch (err: any) {
      setError(err?.message || "Falha ao criar campanha.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 lg:px-8">
      <Link
        href="/campanhas"
        className="mb-4 inline-flex items-center gap-1 text-xs text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Voltar
      </Link>

      <div className="mb-6">
        <h4 className="mb-1 text-xs font-semibold uppercase tracking-widest text-primary">
          Nova campanha
        </h4>
        <h1 className="text-2xl font-semibold text-foreground">Cadastrar</h1>
        <p className="mt-1 text-sm text-muted">
          So o nome e obrigatorio. Slug e status podem ser ajustados depois.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="space-y-5 rounded-xl border border-border bg-surface p-6"
      >
        {error && (
          <div className="flex items-start gap-2.5 rounded-lg border border-danger/20 bg-danger/10 p-3">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-danger" />
            <p className="text-sm text-danger">{error}</p>
          </div>
        )}

        <div>
          <label className="mb-1.5 block text-sm font-medium text-foreground">
            Nome <span className="text-danger">*</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex: Campanha Black Friday 2026"
            required
            className="w-full rounded-lg border border-border bg-background px-3.5 py-2.5 text-sm text-foreground outline-none transition-colors focus:border-primary/60"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-foreground">
            Slug{" "}
            <span className="text-xs font-normal text-muted">(opcional)</span>
          </label>
          <input
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="black-friday-2026"
            className="w-full rounded-lg border border-border bg-background px-3.5 py-2.5 text-sm text-foreground outline-none transition-colors focus:border-primary/60"
          />
          <p className="mt-1 text-xs text-muted">
            Usado em URLs e referencias. Deixe em branco pra gerar depois.
          </p>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-foreground">
            Status
          </label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as CampanhaStatus)}
            className="w-full rounded-lg border border-border bg-background px-3.5 py-2.5 text-sm text-foreground outline-none transition-colors focus:border-primary/60"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <Link
            href="/campanhas"
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
            {submitting ? "Criando..." : "Criar campanha"}
          </button>
        </div>
      </form>
    </div>
  );
}
