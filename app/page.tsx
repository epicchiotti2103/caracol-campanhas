"use client";

import Link from "next/link";
import { Megaphone, ArrowRight } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { useAuth } from "@/lib/auth-context";

export default function HomePage() {
  return (
    <AppShell>
      <HomeContent />
    </AppShell>
  );
}

function HomeContent() {
  const { user } = useAuth();

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
      <div className="mb-8">
        <h4 className="mb-1 text-xs font-semibold uppercase tracking-widest text-primary">
          Caracol Campanhas
        </h4>
        <h1 className="text-2xl font-semibold text-foreground">
          Ola, {user?.name?.split(" ")[0] || "voce"}
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          Cadastre e gerencie as campanhas da suite Caracol. Aqui voce define
          status, owner e gestores de cada campanha — outros apps (NF, Tracker)
          referenciam essas campanhas como fonte de verdade.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Link
          href="/campanhas"
          className="group flex items-start gap-4 rounded-xl border border-border bg-surface p-5 transition-colors hover:border-primary/40"
        >
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Megaphone className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">
              Ver campanhas
            </p>
            <p className="mt-1 text-xs text-muted">
              Lista completa, filtros por status e acesso ao detalhe.
            </p>
          </div>
          <ArrowRight className="mt-2 h-4 w-4 flex-shrink-0 text-muted transition-colors group-hover:text-primary" />
        </Link>

        <Link
          href="/campanhas/new"
          className="group flex items-start gap-4 rounded-xl border border-border bg-surface p-5 transition-colors hover:border-primary/40"
        >
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <span className="text-lg font-bold text-primary">+</span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">
              Nova campanha
            </p>
            <p className="mt-1 text-xs text-muted">
              Cadastre uma campanha nova com nome, slug e status.
            </p>
          </div>
          <ArrowRight className="mt-2 h-4 w-4 flex-shrink-0 text-muted transition-colors group-hover:text-primary" />
        </Link>
      </div>
    </div>
  );
}
