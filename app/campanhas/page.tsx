"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Megaphone,
  Search,
  Plus,
  RefreshCw,
  Eye,
  Loader2,
  AlertCircle
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { apiFetch } from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import type { Campanha, CampanhaEvento, CampanhaStatus, Moeda } from "@/types";

const STATUS_OPTIONS: { value: CampanhaStatus | "todos"; label: string }[] = [
  { value: "todos", label: "Todos" },
  { value: "ativa", label: "Ativa" },
  { value: "pausada", label: "Pausada" },
  { value: "encerrada", label: "Encerrada" }
];

export default function CampanhasPage() {
  return (
    <AppShell>
      <CampanhasList />
    </AppShell>
  );
}

function CampanhasList() {
  const router = useRouter();
  const [campanhas, setCampanhas] = useState<Campanha[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<CampanhaStatus | "todos">(
    "todos"
  );

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const res: { items: Campanha[] } | Campanha[] = await apiFetch(
        "/campanhas"
      );
      const items = Array.isArray(res) ? res : res?.items || [];
      setCampanhas(items);
    } catch (err: any) {
      // Backend ainda nao implementado — tolera erro/404 silenciosamente
      // mas mantem campanhas como [] pra renderizar empty state.
      setCampanhas([]);
      const msg = err?.message || "";
      // So mostra erro se nao for 404 ou "not found" — backend pode estar fora do ar
      if (msg && !/404|not found|failed to fetch/i.test(msg)) {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    return campanhas.filter((c) => {
      const matchStatus = statusFilter === "todos" || c.status === statusFilter;
      const q = search.trim().toLowerCase();
      const matchSearch =
        !q ||
        c.name.toLowerCase().includes(q) ||
        (c.codigo || "").toLowerCase().includes(q);
      return matchStatus && matchSearch;
    });
  }, [campanhas, search, statusFilter]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-widest text-primary">
            Campanhas
          </h4>
          <h1 className="text-2xl font-semibold text-foreground">
            Todas as campanhas
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            disabled={loading}
            className="rounded-lg border border-border bg-surface p-2 text-muted transition-colors hover:bg-surface/80 disabled:opacity-50"
            title="Atualizar"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
          <Link
            href="/campanhas/new"
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90"
          >
            <Plus className="h-4 w-4" />
            Nova campanha
          </Link>
        </div>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-danger/20 bg-danger/10 p-3">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-danger" />
          <p className="text-sm text-danger">{error}</p>
        </div>
      )}

      <div className="rounded-xl border border-border bg-surface">
        <div className="flex flex-col items-start gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-center">
          <div className="relative w-full flex-1 sm:w-auto">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              type="text"
              placeholder="Buscar por nome ou codigo..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm text-foreground outline-none focus:border-primary/50"
            />
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {STATUS_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setStatusFilter(opt.value)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  statusFilter === opt.value
                    ? "bg-primary text-black"
                    : "bg-background text-muted hover:text-foreground"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                {[
                  "Codigo",
                  "Inicio",
                  "Fim",
                  "Campanha",
                  "Budget",
                  "Eventos",
                  "Status",
                  ""
                ].map((h, i) => (
                  <th
                    key={`${h}-${i}`}
                    className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-16 text-center">
                    <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" />
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-16 text-center">
                    <Megaphone className="mx-auto mb-3 h-8 w-8 opacity-20" />
                    <p className="text-sm text-muted">
                      {campanhas.length === 0
                        ? "Nenhuma campanha cadastrada ainda."
                        : "Nenhuma campanha para esse filtro."}
                    </p>
                    {campanhas.length === 0 && (
                      <Link
                        href="/campanhas/new"
                        className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90"
                      >
                        <Plus className="h-4 w-4" />
                        Cadastrar a primeira
                      </Link>
                    )}
                  </td>
                </tr>
              ) : (
                filtered.map((c, i) => (
                  <CampanhaRow
                    key={c.id}
                    campanha={c}
                    isLast={i === filtered.length - 1}
                    onClick={() => router.push(`/campanhas/${c.id}`)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>

        {!loading && filtered.length > 0 && (
          <div className="flex items-center justify-between border-t border-border px-5 py-3">
            <p className="text-xs text-muted">
              {filtered.length}{" "}
              {filtered.length === 1 ? "campanha" : "campanhas"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function CampanhaRow({
  campanha,
  isLast,
  onClick
}: {
  campanha: Campanha;
  isLast: boolean;
  onClick: () => void;
}) {
  return (
    <tr
      onClick={onClick}
      className={`group cursor-pointer transition-colors hover:bg-background ${
        !isLast ? "border-b border-border" : ""
      }`}
    >
      <td className="whitespace-nowrap px-4 py-4">
        <span className="font-mono text-xs font-semibold text-primary">
          {campanha.codigo || "—"}
        </span>
      </td>
      <td className="whitespace-nowrap px-4 py-4 text-muted">
        {fmtDate(campanha.inicio)}
      </td>
      <td className="whitespace-nowrap px-4 py-4 text-muted">
        {fmtDate(campanha.fim)}
      </td>
      <td className="px-4 py-4">
        <p className="font-medium text-foreground">{campanha.name}</p>
      </td>
      <td className="whitespace-nowrap px-4 py-4 text-foreground">
        {fmtBudget(campanha.budget, campanha.moeda)}
      </td>
      <td
        className="px-4 py-4 text-muted"
        title={eventosTooltip(campanha.eventos, campanha.moeda)}
      >
        {summarizeEventosCount(campanha.eventos)}
      </td>
      <td className="whitespace-nowrap px-4 py-4">
        <StatusBadge status={campanha.status} />
      </td>
      <td className="px-4 py-4">
        <Eye className="h-4 w-4 text-muted opacity-0 transition-opacity group-hover:opacity-100" />
      </td>
    </tr>
  );
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(s);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("pt-BR");
}

function fmtBudget(
  budget: number | null | undefined,
  moeda: Moeda | string | null | undefined
): string {
  return formatCurrency(budget, moeda);
}

function summarizeEventosCount(eventos: CampanhaEvento[] | undefined): string {
  if (!eventos || eventos.length === 0) return "—";
  return `${eventos.length} ${eventos.length === 1 ? "evento" : "eventos"}`;
}

function eventosTooltip(
  eventos: CampanhaEvento[] | undefined,
  moeda: Moeda | string | null | undefined
): string {
  if (!eventos || eventos.length === 0) return "";
  const total = eventos.reduce((acc, ev) => acc + (ev.payout ?? 0), 0);
  return `${formatCurrency(total, moeda)} em ${eventos.length} ${
    eventos.length === 1 ? "evento" : "eventos"
  }`;
}
