"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { CampanhaForm } from "@/components/campanha-form";

export default function NewCampanhaPage() {
  return (
    <AppShell>
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
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
            So o nome e obrigatorio. O codigo (CMP-NNN) e gerado pelo backend.
          </p>
        </div>

        <CampanhaForm />
      </div>
    </AppShell>
  );
}
