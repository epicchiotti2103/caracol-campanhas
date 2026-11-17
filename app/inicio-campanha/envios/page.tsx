"use client";

// Acompanhamento de envios do Inicio de Campanha.
//
// Lista GET /campanhas/envios (desc por sent_at) com filtros (campanha,
// publisher via supplier_id, status, modo, periodo, busca). Status troca
// inline (select -> PATCH /campanhas/envios/{id}/status, sem nota) ou pelo
// drawer (com nota opcional). Clique na linha abre o drawer com o corpo
// gravado + botao copiar.
//
// `disponivel:false` (migration 084 pendente) OU erro da rota (backend ainda
// sem a rota: /envios cai em /{campanha_id} -> 404/422) => aviso "Em
// implantacao" com tentar de novo — nunca erro vermelho.

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Loader2,
  Search,
  RefreshCw,
  Construction,
  X,
  Copy,
  CheckCircle2,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Inbox,
  Mail,
  ClipboardCopy
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { cachedFetch } from "@/lib/cache";
import { useToast } from "@/lib/toast-context";
import { formatMesAnoShort } from "@/lib/format";
import {
  copyToClipboard,
  friendlyError,
  listEnvios,
  MODO_LABEL,
  patchEnvioStatus,
  STATUS_CLASS,
  STATUS_LABEL,
  type Envio,
  type EnvioModo,
  type EnvioStatus
} from "@/lib/inicio-campanha";
import type { Campanha, Supplier, SuppliersResponse } from "@/types";

const PAGE_SIZE = 50;
const STATUSES: EnvioStatus[] = ["oferecido", "enviado", "aceito", "recusado"];

const ctrlCls =
  "rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-primary/50";

function fmtDateTime(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export default function EnviosPage() {
  return (
    <AppShell>
      <Suspense
        fallback={
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        }
      >
        <EnviosView />
      </Suspense>
    </AppShell>
  );
}

function EnviosView() {
  const toast = useToast();

  // filtros
  const [campanhaId, setCampanhaId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [status, setStatus] = useState("");
  const [modo, setModo] = useState("");
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [qDraft, setQDraft] = useState("");
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);

  // opcoes dos filtros
  const [campanhas, setCampanhas] = useState<Campanha[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);

  // dados
  const [items, setItems] = useState<Envio[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [indisponivel, setIndisponivel] = useState(false);
  const [patching, setPatching] = useState<Set<string>>(new Set());
  const [aberto, setAberto] = useState<Envio | null>(null);

  // debounce da busca
  useEffect(() => {
    const t = setTimeout(() => setQ(qDraft.trim()), 300);
    return () => clearTimeout(t);
  }, [qDraft]);

  // volta pra 1a pagina quando filtro muda
  useEffect(() => {
    setOffset(0);
  }, [campanhaId, supplierId, status, modo, de, ate, q]);

  useEffect(() => {
    (async () => {
      try {
        const res: { items: Campanha[] } | Campanha[] = await cachedFetch("/campanhas", { ttlMs: 60_000 });
        const list = Array.isArray(res) ? res : res?.items || [];
        setCampanhas(
          [...list].sort(
            (a, b) =>
              (b.mes_referencia || "").localeCompare(a.mes_referencia || "") || a.name.localeCompare(b.name)
          )
        );
      } catch {
        // filtro de campanha fica vazio
      }
    })();
    (async () => {
      try {
        const res = await cachedFetch<SuppliersResponse>("/suppliers?is_publisher=true&active=true", {
          ttlMs: 5 * 60_000
        });
        setSuppliers([...(res?.items || [])].sort((a, b) => a.name.localeCompare(b.name)));
      } catch {
        // filtro de publisher fica vazio (busca livre cobre)
      }
    })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listEnvios({
        campanha_id: campanhaId || undefined,
        supplier_id: supplierId || undefined,
        status: status || undefined,
        modo: modo || undefined,
        de: de || undefined,
        ate: ate || undefined,
        q: q || undefined,
        limit: PAGE_SIZE,
        offset
      });
      if (!res || res.disponivel === false || !Array.isArray(res.items)) {
        setIndisponivel(true);
        setItems([]);
        setTotal(0);
      } else {
        setIndisponivel(false);
        setItems(res.items);
        setTotal(res.total ?? res.items.length);
      }
    } catch {
      // rota ainda nao existe no backend -> trata como em implantacao
      setIndisponivel(true);
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [campanhaId, supplierId, status, modo, de, ate, q, offset]);

  useEffect(() => {
    load();
  }, [load]);

  const changeStatus = async (envio: Envio, next: EnvioStatus, nota?: string) => {
    if (next === envio.status && !nota) return;
    setPatching((s) => new Set(s).add(envio.id));
    try {
      const updated = await patchEnvioStatus(envio.id, next, nota);
      const merged: Envio = updated && updated.id ? updated : { ...envio, status: next, status_nota: nota ?? envio.status_nota };
      setItems((list) => list.map((e) => (e.id === envio.id ? merged : e)));
      setAberto((a) => (a && a.id === envio.id ? merged : a));
      toast.success(`Status: ${STATUS_LABEL[next]}`);
    } catch (e) {
      toast.error(friendlyError(e, "Falha ao trocar o status."));
    } finally {
      setPatching((s) => {
        const n = new Set(s);
        n.delete(envio.id);
        return n;
      });
    }
  };

  const hasFilters = !!(campanhaId || supplierId || status || modo || de || ate || qDraft);
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const contagem = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of items) c[e.status] = (c[e.status] || 0) + 1;
    return c;
  }, [items]);

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-widest text-primary">Inicio Campanha</h4>
          <h1 className="text-2xl font-semibold text-foreground">Acompanhamento de envios</h1>
          <p className="mt-1 text-sm text-muted">
            Ofertas e reinicios registrados. Troque o status conforme o publisher responde.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/inicio-campanha"
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-black hover:bg-primary/90"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Nova oferta
          </Link>
          <button
            onClick={load}
            disabled={loading}
            title="Recarregar"
            className="rounded-lg border border-border p-2 text-muted transition-colors hover:text-foreground disabled:opacity-40"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
          <input
            value={qDraft}
            onChange={(e) => setQDraft(e.target.value)}
            placeholder="Buscar publisher, campanha ou af_prt"
            className={`${ctrlCls} w-full pl-8`}
          />
        </div>
        <select value={campanhaId} onChange={(e) => setCampanhaId(e.target.value)} className={`${ctrlCls} max-w-[220px]`}>
          <option value="">Todas as campanhas</option>
          {campanhas.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} · {formatMesAnoShort(c.mes_referencia)}
            </option>
          ))}
        </select>
        <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={`${ctrlCls} max-w-[180px]`}>
          <option value="">Todos publishers</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={ctrlCls}>
          <option value="">Todo status</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <select value={modo} onChange={(e) => setModo(e.target.value)} className={ctrlCls}>
          <option value="">Todo modo</option>
          <option value="nova">Nova oferta</option>
          <option value="reinicio">Reinicio</option>
        </select>
        <div className="flex items-center gap-1 text-xs text-muted">
          <input type="date" value={de} onChange={(e) => setDe(e.target.value)} className={ctrlCls} aria-label="De" />
          <span>a</span>
          <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} className={ctrlCls} aria-label="Ate" />
        </div>
        {hasFilters && (
          <button
            onClick={() => {
              setCampanhaId("");
              setSupplierId("");
              setStatus("");
              setModo("");
              setDe("");
              setAte("");
              setQDraft("");
            }}
            className="flex items-center gap-1 px-2 py-1.5 text-xs text-muted hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" /> Limpar
          </button>
        )}
      </div>

      {indisponivel ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 px-6 py-12 text-center">
          <Construction className="h-8 w-8 text-amber-400" />
          <p className="text-sm font-semibold text-foreground">Em implantacao (migration pendente)</p>
          <p className="max-w-md text-xs text-muted">
            O registro de envios ainda nao esta ativo no backend. Assim que a migration 084 for aplicada os envios
            aparecem aqui.
          </p>
          <button
            onClick={load}
            className="mt-1 flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted hover:text-foreground"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Tentar de novo
          </button>
        </div>
      ) : (
        <>
          {!loading && items.length > 0 && (
            <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-muted">
              <span>
                {total} envio{total === 1 ? "" : "s"}
              </span>
              {STATUSES.filter((s) => contagem[s]).map((s) => (
                <span key={s} className={`rounded-full border px-2 py-0.5 ${STATUS_CLASS[s]}`}>
                  {STATUS_LABEL[s]} {contagem[s]}
                </span>
              ))}
              {pages > 1 && <span>(nesta pagina)</span>}
            </div>
          )}
          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="w-full min-w-[960px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wider text-muted">
                  <th className="px-4 py-3">Data</th>
                  <th className="px-4 py-3">Campanha</th>
                  <th className="px-4 py-3">Publisher</th>
                  <th className="px-4 py-3">Modo</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Enviado por</th>
                  <th className="px-4 py-3">Destinatarios</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center">
                      <Loader2 className="mx-auto h-5 w-5 animate-spin text-primary" />
                    </td>
                  </tr>
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-sm text-muted">
                      <Inbox className="mx-auto mb-2 h-6 w-6 text-muted/60" />
                      {hasFilters ? "Nenhum envio com esses filtros." : "Nenhum envio registrado ainda."}
                    </td>
                  </tr>
                ) : (
                  items.map((e) => (
                    <tr
                      key={e.id}
                      onClick={() => setAberto(e)}
                      className="cursor-pointer border-b border-border/60 transition-colors last:border-0 hover:bg-white/[0.03]"
                    >
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-muted">
                        <span className="flex items-center gap-1.5">
                          {e.canal === "mailto" ? (
                            <Mail className="h-3 w-3" aria-label="mailto" />
                          ) : (
                            <ClipboardCopy className="h-3 w-3" aria-label="copiado" />
                          )}
                          {fmtDateTime(e.sent_at)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <p className="max-w-[220px] truncate text-foreground">{e.campanha_nome || "—"}</p>
                        {e.mes_referencia && (
                          <p className="text-[11px] text-muted">{formatMesAnoShort(e.mes_referencia)}</p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-foreground">{e.publisher_nome}</p>
                        {e.af_prt && <p className="font-mono text-[11px] text-muted">{e.af_prt}</p>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-muted">
                        {MODO_LABEL[e.modo as EnvioModo] || e.modo}
                        {e.budget_events ? <span className="block text-[11px]">{e.budget_events} events</span> : null}
                      </td>
                      <td className="px-4 py-3" onClick={(ev) => ev.stopPropagation()}>
                        <StatusSelect
                          value={e.status}
                          disabled={patching.has(e.id)}
                          onChange={(s) => changeStatus(e, s)}
                        />
                      </td>
                      <td className="max-w-[180px] truncate px-4 py-3 text-xs text-muted">{e.sent_by_email || "—"}</td>
                      <td className="max-w-[240px] px-4 py-3 text-xs text-muted">
                        <span className="line-clamp-2 break-all">{(e.destinatarios || []).join(", ") || "—"}</span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <div className="mt-3 flex items-center justify-end gap-2 text-xs text-muted">
              <button
                onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
                disabled={offset === 0 || loading}
                className="rounded-md border border-border p-1.5 disabled:opacity-40"
                aria-label="Pagina anterior"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <span>
                {page} / {pages}
              </span>
              <button
                onClick={() => setOffset((o) => o + PAGE_SIZE)}
                disabled={page >= pages || loading}
                className="rounded-md border border-border p-1.5 disabled:opacity-40"
                aria-label="Proxima pagina"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </>
      )}

      {aberto && (
        <EnvioDrawer
          envio={aberto}
          busy={patching.has(aberto.id)}
          onClose={() => setAberto(null)}
          onStatus={(s, nota) => changeStatus(aberto, s, nota)}
        />
      )}
    </div>
  );
}

function StatusSelect({
  value,
  onChange,
  disabled
}: {
  value: EnvioStatus;
  onChange: (s: EnvioStatus) => void;
  disabled?: boolean;
}) {
  return (
    <div className="relative inline-flex items-center">
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as EnvioStatus)}
        className={`cursor-pointer appearance-none rounded-full border py-0.5 pl-2.5 pr-6 text-xs font-medium outline-none disabled:opacity-50 ${
          STATUS_CLASS[value] || "border-border text-muted"
        }`}
      >
        {STATUSES.map((s) => (
          <option key={s} value={s} className="bg-zinc-900 text-foreground">
            {STATUS_LABEL[s]}
          </option>
        ))}
      </select>
      {disabled ? (
        <Loader2 className="pointer-events-none absolute right-1.5 h-3 w-3 animate-spin" />
      ) : (
        <ChevronRight className="pointer-events-none absolute right-1.5 h-3 w-3 rotate-90 opacity-60" />
      )}
    </div>
  );
}

function EnvioDrawer({
  envio,
  busy,
  onClose,
  onStatus
}: {
  envio: Envio;
  busy: boolean;
  onClose: () => void;
  onStatus: (s: EnvioStatus, nota?: string) => void;
}) {
  const [novo, setNovo] = useState<EnvioStatus>(envio.status);
  const [nota, setNota] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setNovo(envio.status);
    setNota("");
  }, [envio.id, envio.status]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const texto = `${envio.assunto ? envio.assunto + "\n\n" : ""}${envio.corpo}`;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-xl flex-col border-l border-border bg-background shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-widest text-primary">
              {MODO_LABEL[envio.modo] || envio.modo}
            </p>
            <h2 className="truncate text-lg font-semibold text-foreground">{envio.publisher_nome}</h2>
            <p className="truncate text-xs text-muted">
              {envio.campanha_nome}
              {envio.mes_referencia ? ` · ${formatMesAnoShort(envio.mes_referencia)}` : ""}
            </p>
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 text-muted hover:bg-white/5 hover:text-foreground" aria-label="Fechar">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-xs">
            <dt className="text-muted">Registrado em</dt>
            <dd className="text-foreground">
              {fmtDateTime(envio.sent_at)} {envio.canal ? <span className="text-muted">via {envio.canal}</span> : null}
            </dd>
            <dt className="text-muted">Por</dt>
            <dd className="text-foreground">{envio.sent_by_email || "—"}</dd>
            <dt className="text-muted">Para</dt>
            <dd className="break-all text-foreground">{(envio.destinatarios || []).join(", ") || "—"}</dd>
            {envio.cc && envio.cc.length > 0 && (
              <>
                <dt className="text-muted">Cc</dt>
                <dd className="break-all text-foreground">{envio.cc.join(", ")}</dd>
              </>
            )}
            {envio.po && (
              <>
                <dt className="text-muted">PO</dt>
                <dd className="text-foreground">{envio.po}</dd>
              </>
            )}
            {envio.af_prt && (
              <>
                <dt className="text-muted">af_prt</dt>
                <dd className="font-mono text-foreground">{envio.af_prt}</dd>
              </>
            )}
            {envio.budget_events ? (
              <>
                <dt className="text-muted">Budget</dt>
                <dd className="text-foreground">{envio.budget_events} events</dd>
              </>
            ) : null}
          </dl>

          {/* Status */}
          <div className="rounded-xl border border-border bg-surface p-4">
            <div className="mb-3 flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted">Status</span>
              <span className={`rounded-full border px-2 py-0.5 text-xs ${STATUS_CLASS[envio.status]}`}>
                {STATUS_LABEL[envio.status] || envio.status}
              </span>
            </div>
            {envio.status_updated_at && (
              <p className="mb-3 text-[11px] text-muted">
                Ultima troca {fmtDateTime(envio.status_updated_at)}
                {envio.status_updated_by_email ? ` por ${envio.status_updated_by_email}` : ""}
                {envio.status_nota ? (
                  <span className="mt-1 block rounded-md bg-white/[0.03] px-2 py-1.5 text-foreground">
                    &quot;{envio.status_nota}&quot;
                  </span>
                ) : null}
              </p>
            )}
            <div className="flex flex-wrap gap-1.5">
              {STATUSES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setNovo(s)}
                  className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                    novo === s ? STATUS_CLASS[s] : "border-border text-muted hover:text-foreground"
                  }`}
                >
                  {STATUS_LABEL[s]}
                </button>
              ))}
            </div>
            <textarea
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              rows={2}
              placeholder="Nota (opcional) — ex: aceitou por WhatsApp, pediu PO maior..."
              className="mt-3 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground outline-none placeholder:text-muted/60 focus:border-primary/60"
            />
            <button
              type="button"
              disabled={busy || (novo === envio.status && !nota.trim())}
              onClick={() => onStatus(novo, nota)}
              className="mt-2 flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-40"
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Salvar status
            </button>
          </div>

          {/* Corpo */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted">E-mail registrado</span>
              <button
                type="button"
                onClick={() =>
                  copyToClipboard(texto).then((ok) => {
                    setCopied(ok);
                    if (ok) setTimeout(() => setCopied(false), 1500);
                  })
                }
                className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs text-muted hover:text-foreground"
              >
                {copied ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                Copiar
              </button>
            </div>
            {envio.assunto && (
              <p className="mb-2 rounded-t-lg border border-b-0 border-border bg-surface px-4 py-2 text-xs">
                <span className="text-muted">Assunto: </span>
                <span className="text-foreground">{envio.assunto}</span>
              </p>
            )}
            <pre
              className={`whitespace-pre-wrap break-words border border-border bg-surface px-4 py-3 font-sans text-[13px] leading-relaxed text-foreground ${
                envio.assunto ? "-mt-2 rounded-b-lg" : "rounded-lg"
              }`}
            >
              {envio.corpo}
            </pre>
            {envio.observacao && (
              <p className="mt-2 text-[11px] text-muted">Observacao registrada: {envio.observacao}</p>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
