"use client";

// Lista plana GLOBAL: publisher × media source × payout de TODAS as campanhas do
// mes, uma linha por combinacao. Substitui o fluxo antigo do Google Sheets que o
// Elio sentia falta — filtrar por campanha, ver tudo de uma vez e EXPORTAR pro
// Excel pra fazer PROCV/VLOOKUP.
//
// - Escopo POR MES (cada mes = snapshot de campanha; sem escopo double-conta).
// - Filtro multi-select por campanha (vazio = todas) + busca por texto.
// - Exportar CSV (dialeto pt-BR: `;`, decimal virgula, BOM UTF-8) e Copiar TSV
//   (cola direto numa aba do Excel). Ambos respeitam o filtro ativo e exportam o
//   conjunto FILTRADO COMPLETO — nunca so a pagina visivel (nao ha paginacao).
// - Payout vai como NUMERO CRU + Moeda em coluna propria (nao "R$ 12,50") pra
//   nao matar o PROCV/soma no Excel.
//
// Backend: GET /campanhas/summary/flat-list?month=YYYY-MM (tolerante a 404/rede
// enquanto a rota nao existe — mostra "indisponivel", sem erro vermelho).

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  RefreshCw,
  Loader2,
  AlertCircle,
  Search,
  Table2,
  Download,
  Copy,
  Check,
  ChevronDown,
  Filter
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { cachedFetch, MONTHS_AVAILABLE_TTL_MS } from "@/lib/cache";
import {
  currentMonthString,
  formatCurrency,
  formatMesAnoShort
} from "@/lib/format";
import { useToast } from "@/lib/toast-context";
import type {
  CampanhaFlatListResponse,
  CampanhaFlatRow,
  CampanhaMonthsAvailable
} from "@/types";

// ---- Definicao das colunas (display na tabela + valor cru pra export) ----

type Col = {
  key: string;
  header: string;
  /** Celula renderizada na tabela (pode formatar). */
  display: (r: CampanhaFlatRow) => string;
  /** Valor CRU pra export CSV/TSV (numero sem simbolo, texto sem formatacao). */
  exportVal: (r: CampanhaFlatRow) => string;
  align?: "right";
  className?: string;
};

/** Numero -> string decimal-virgula (pt-BR) sem separador de milhar. Ex: 1234.5 -> "1234,5". */
function numToComma(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "";
  return String(n).replace(".", ",");
}

function fmtCap(r: CampanhaFlatRow): string {
  if (!r.cap_tipo || r.cap_tipo === "nenhum") return "";
  const unidade = r.cap_unidade === "usd" ? "US$" : "eventos";
  const valor = r.cap_valor != null ? String(r.cap_valor) : "";
  return `${r.cap_tipo} ${valor} ${unidade}`.trim();
}

const COLS: Col[] = [
  {
    key: "codigo",
    header: "Codigo",
    display: (r) => r.campanha_codigo || "—",
    exportVal: (r) => r.campanha_codigo || "",
    className: "font-mono text-primary whitespace-nowrap"
  },
  {
    key: "campanha",
    header: "Campanha",
    display: (r) => r.campanha_nome || "",
    exportVal: (r) => r.campanha_nome || "",
    className: "text-foreground"
  },
  {
    key: "status",
    header: "Status",
    display: (r) => (r.campanha_status ? String(r.campanha_status) : "—"),
    exportVal: (r) => (r.campanha_status ? String(r.campanha_status) : ""),
    className: "text-muted whitespace-nowrap"
  },
  {
    key: "publisher",
    header: "Publisher",
    display: (r) => r.publisher_nome || "—",
    exportVal: (r) => r.publisher_nome || "",
    className: "text-foreground"
  },
  {
    key: "media_source",
    header: "Media source",
    display: (r) => r.media_source || "—",
    exportVal: (r) => r.media_source || "",
    className: "font-mono text-foreground whitespace-nowrap"
  },
  {
    key: "ativa",
    header: "Ativa",
    display: (r) =>
      r.media_source == null
        ? "—"
        : r.media_source_ativa === false
          ? "Nao"
          : "Sim",
    exportVal: (r) =>
      r.media_source == null
        ? ""
        : r.media_source_ativa === false
          ? "Nao"
          : "Sim",
    className: "text-muted whitespace-nowrap"
  },
  {
    key: "evento",
    header: "Evento",
    display: (r) => r.evento_nome || "—",
    exportVal: (r) => r.evento_nome || "",
    className: "text-foreground whitespace-nowrap"
  },
  {
    key: "payout",
    header: "Payout",
    display: (r) =>
      r.payout != null ? formatCurrency(r.payout, r.moeda) : "—",
    exportVal: (r) => numToComma(r.payout),
    align: "right",
    className: "font-mono text-foreground whitespace-nowrap"
  },
  {
    key: "moeda",
    header: "Moeda",
    display: (r) => (r.moeda ? String(r.moeda) : "—"),
    exportVal: (r) => (r.moeda ? String(r.moeda) : ""),
    className: "text-muted whitespace-nowrap"
  },
  {
    key: "cap",
    header: "Cap",
    display: (r) => fmtCap(r) || "—",
    exportVal: (r) => fmtCap(r),
    className: "text-muted whitespace-nowrap"
  }
];

// ---- Builders de export ----

/** Escapa uma celula pro CSV pt-BR (delimitador `;`). */
function csvEscape(v: string): string {
  if (/[";\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

/** Sanitiza celula pro TSV (tabs/quebras viram espaco pra nao quebrar colunas). */
function tsvCell(v: string): string {
  return v.replace(/[\t\n\r]+/g, " ");
}

function buildCsv(rows: CampanhaFlatRow[]): string {
  const header = COLS.map((c) => csvEscape(c.header)).join(";");
  const body = rows
    .map((r) => COLS.map((c) => csvEscape(c.exportVal(r))).join(";"))
    .join("\r\n");
  // BOM UTF-8 pra Excel pt-BR nao quebrar acentos.
  return `﻿${header}\r\n${body}`;
}

function buildTsv(rows: CampanhaFlatRow[]): string {
  const header = COLS.map((c) => tsvCell(c.header)).join("\t");
  const body = rows
    .map((r) => COLS.map((c) => tsvCell(c.exportVal(r))).join("\t"))
    .join("\n");
  return `${header}\n${body}`;
}

export default function MediaSourcesPage() {
  return (
    <AppShell>
      <Suspense
        fallback={
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        }
      >
        <MediaSourcesView />
      </Suspense>
    </AppShell>
  );
}

function MediaSourcesView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();
  const monthFromUrl = searchParams?.get("month") || "";

  const [data, setData] = useState<CampanhaFlatListResponse | null>(null);
  const [months, setMonths] = useState<string[]>([]);
  const [month, setMonth] = useState<string>(
    monthFromUrl || currentMonthString()
  );
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  const [search, setSearch] = useState("");
  const [copied, setCopied] = useState(false);

  // Filtro multi-select de campanha. Set vazio = TODAS.
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Meses disponiveis (mesmo endpoint das outras telas).
  useEffect(() => {
    (async () => {
      try {
        const res = await cachedFetch<CampanhaMonthsAvailable>(
          "/campanhas?months_available=1",
          { ttlMs: MONTHS_AVAILABLE_TTL_MS }
        );
        const list = res?.months || [];
        setMonths(list);
        if (list.length > 0 && !monthFromUrl && !list.includes(month)) {
          setMonth(list[0]);
        }
      } catch {
        // ignore
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = async (selectedMonth: string, opts?: { silent?: boolean }) => {
    if (opts?.silent) setRefreshing(true);
    else setLoading(true);
    setError("");
    setUnavailable(false);
    try {
      const res = await cachedFetch<CampanhaFlatListResponse>(
        `/campanhas/summary/flat-list?month=${selectedMonth}`,
        { ttlMs: 30_000, force: opts?.silent === true }
      );
      setData(res || null);
      // Reseta o filtro de campanha ao trocar de mes (as campanhas mudam).
      setSelected(new Set());
    } catch (err: any) {
      const msg = err?.message || "";
      if (/404|not found|failed to fetch/i.test(msg)) {
        setUnavailable(true);
        setData(null);
      } else {
        setError(msg || "Falha ao carregar a lista.");
        setData(null);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load(month);
    const params = new URLSearchParams(searchParams?.toString() || "");
    if (month) params.set("month", month);
    else params.delete("month");
    const qs = params.toString();
    router.replace(`/media-sources${qs ? `?${qs}` : ""}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  const rows = data?.rows || [];

  // Campanhas distintas do mes (pro multi-select), ordenadas por codigo/nome.
  const campanhaOptions = useMemo(() => {
    const map = new Map<string, { id: string; label: string }>();
    for (const r of rows) {
      if (!map.has(r.campanha_id)) {
        const label = r.campanha_codigo
          ? `${r.campanha_codigo} · ${r.campanha_nome}`
          : r.campanha_nome;
        map.set(r.campanha_id, { id: r.campanha_id, label });
      }
    }
    return Array.from(map.values()).sort((a, b) =>
      a.label.localeCompare(b.label)
    );
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (selected.size > 0 && !selected.has(r.campanha_id)) return false;
      if (!q) return true;
      return [
        r.publisher_nome,
        r.media_source,
        r.campanha_nome,
        r.campanha_codigo,
        r.evento_nome
      ].some((v) => (v || "").toLowerCase().includes(q));
    });
  }, [rows, selected, search]);

  const monthOptions = useMemo(() => {
    const set = new Set<string>(months);
    set.add(month);
    set.add(currentMonthString());
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [months, month]);

  const handleCsv = () => {
    if (filtered.length === 0) return;
    const csv = buildCsv(filtered);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `campanhas-media-sources-${month}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(`CSV exportado (${filtered.length} linhas).`);
  };

  const handleCopy = async () => {
    if (filtered.length === 0) return;
    const tsv = buildTsv(filtered);
    try {
      await navigator.clipboard.writeText(tsv);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
      toast.success(`Copiado (${filtered.length} linhas) — cole no Excel.`);
    } catch {
      toast.error("Nao foi possivel copiar. Tente o CSV.");
    }
  };

  const canExport = !loading && !unavailable && filtered.length > 0;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-widest text-primary">
            Media Sources
          </h4>
          <h1 className="text-2xl font-semibold text-foreground">
            Lista plana (publisher × media source × payout)
          </h1>
          <p className="mt-1 text-sm text-muted">
            Todas as campanhas do mes numa tabela unica. Filtre por campanha e
            exporte pro Excel (PROCV).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted">
              Mes
            </span>
            <select
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground outline-none focus:border-primary/50"
            >
              {monthOptions.map((m) => (
                <option key={m} value={m}>
                  {formatMesAnoShort(m)}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={() => load(month, { silent: true })}
            disabled={refreshing || loading}
            className="rounded-lg border border-border bg-surface p-2 text-muted transition-colors hover:bg-background disabled:opacity-50"
            title="Atualizar"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-danger/20 bg-danger/10 p-3">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-danger" />
          <p className="text-sm text-danger">{error}</p>
        </div>
      )}

      <div className="rounded-xl border border-border bg-surface">
        {/* Barra de filtros + acoes de export */}
        <div className="flex flex-col gap-3 border-b border-border px-5 py-4 lg:flex-row lg:items-center">
          <div className="relative w-full flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              type="text"
              placeholder="Buscar por publisher, media source, campanha ou evento..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm text-foreground outline-none focus:border-primary/50"
            />
          </div>

          <CampanhaMultiSelect
            options={campanhaOptions}
            selected={selected}
            onChange={setSelected}
          />

          <div className="flex items-center gap-2">
            <button
              onClick={handleCsv}
              disabled={!canExport}
              className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-surface disabled:opacity-40"
              title="Baixar CSV (Excel pt-BR)"
            >
              <Download className="h-4 w-4" />
              CSV
            </button>
            <button
              onClick={handleCopy}
              disabled={!canExport}
              className="flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-40"
              title="Copiar como TSV pra colar no Excel"
            >
              {copied ? (
                <Check className="h-4 w-4" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
              {copied ? "Copiado" : "Copiar"}
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                {COLS.map((c) => (
                  <th
                    key={c.key}
                    className={`whitespace-nowrap px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted ${
                      c.align === "right" ? "text-right" : "text-left"
                    }`}
                  >
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={COLS.length} className="py-16 text-center">
                    <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" />
                  </td>
                </tr>
              ) : unavailable ? (
                <tr>
                  <td colSpan={COLS.length} className="py-16 text-center">
                    <Table2 className="mx-auto mb-3 h-8 w-8 opacity-20" />
                    <p className="mb-1 text-sm font-semibold text-foreground">
                      Lista indisponivel
                    </p>
                    <p className="mx-auto max-w-md text-sm text-muted">
                      A rota de lista plana ainda nao esta no ar no backend.
                      Assim que o Tracker publicar, esta tela passa a listar tudo.
                    </p>
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={COLS.length} className="py-16 text-center">
                    <Table2 className="mx-auto mb-3 h-8 w-8 opacity-20" />
                    <p className="text-sm text-muted">
                      {rows.length === 0
                        ? `Nenhum registro em ${formatMesAnoShort(month) || "—"}.`
                        : "Nenhum registro para o filtro."}
                    </p>
                  </td>
                </tr>
              ) : (
                filtered.map((r, i) => (
                  <tr
                    key={`${r.campanha_id}-${r.publisher_id ?? r.publisher_nome}-${
                      r.media_source ?? "noms"
                    }-${r.evento_nome ?? "noev"}-${i}`}
                    className={`transition-colors hover:bg-background ${
                      i % 2 === 1 ? "bg-white/[0.02]" : ""
                    } ${i < filtered.length - 1 ? "border-b border-border" : ""}`}
                  >
                    {COLS.map((c) => (
                      <td
                        key={c.key}
                        className={`px-3 py-2 align-top ${
                          c.align === "right" ? "text-right" : "text-left"
                        } ${c.className || ""}`}
                      >
                        {c.display(r)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {!loading && !unavailable && (
          <div className="flex items-center justify-between border-t border-border px-5 py-3">
            <p className="text-xs text-muted">
              {filtered.length}{" "}
              {filtered.length === 1 ? "linha" : "linhas"}
              {rows.length !== filtered.length && ` de ${rows.length}`}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/** Dropdown multi-select de campanhas (native <details> — fecha ao clicar fora nao, mas simples). */
function CampanhaMultiSelect({
  options,
  selected,
  onChange
}: {
  options: { id: string; label: string }[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const ref = useRef<HTMLDetailsElement>(null);

  // Fecha ao clicar fora.
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        ref.current.removeAttribute("open");
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };

  const label =
    selected.size === 0
      ? "Todas as campanhas"
      : `${selected.size} campanha${selected.size > 1 ? "s" : ""}`;

  return (
    <details ref={ref} className="group relative">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors hover:bg-surface [&::-webkit-details-marker]:hidden">
        <Filter className="h-4 w-4 text-muted" />
        <span className="whitespace-nowrap">{label}</span>
        <ChevronDown className="h-4 w-4 text-muted transition-transform group-open:rotate-180" />
      </summary>
      <div className="absolute right-0 z-30 mt-2 w-72 rounded-lg border border-border bg-surface p-2 shadow-xl">
        <div className="mb-2 flex items-center justify-between px-1">
          <button
            onClick={() => onChange(new Set())}
            className="text-xs font-medium text-primary hover:underline"
          >
            Todas
          </button>
          <button
            onClick={() => onChange(new Set(options.map((o) => o.id)))}
            className="text-xs font-medium text-muted hover:text-foreground"
          >
            Selecionar todas
          </button>
        </div>
        <div className="max-h-64 overflow-y-auto">
          {options.length === 0 ? (
            <p className="px-2 py-3 text-center text-xs text-muted">
              Nenhuma campanha no mes.
            </p>
          ) : (
            options.map((o) => (
              <label
                key={o.id}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs text-foreground hover:bg-background"
              >
                <input
                  type="checkbox"
                  checked={selected.has(o.id)}
                  onChange={() => toggle(o.id)}
                  className="h-3.5 w-3.5 accent-primary"
                />
                <span className="truncate">{o.label}</span>
              </label>
            ))
          )}
        </div>
      </div>
    </details>
  );
}
