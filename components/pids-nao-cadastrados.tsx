"use client";

// Bloco "PIDs do robo nao cadastrados (N)" do detalhe da campanha.
// GET /campanhas/{id}/pids-nao-cadastrados -> media sources que o robo (api_af)
// viu no ultimo snapshot mas que nao estao em nenhum publisher da campanha.
// O backend sugere o publisher SO a partir do cadastro da mesma campanha em
// meses anteriores (o mesmo PID pode ser de publishers diferentes em campanhas
// diferentes); sem sugestao o dropdown fica vazio e o user escolhe.
// "Cadastrar selecionados" agrupa por publisher e faz 1 POST por publisher em
// /campanhas/publishers/{publisher_id}/media-sources (nao recria os outros).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Loader2, RefreshCw } from "lucide-react";
import { apiFetchStatus, isEmImplantacao } from "@/lib/api-status";
import { cadastrarPidsPorPublisher } from "@/lib/publisher-media-sources";
import { formatNumberPtBr } from "@/lib/format";
import { useToast } from "@/lib/toast-context";
import type { CampanhaPublisher } from "@/types";

export const PIDS_NAO_CADASTRADOS_ANCHOR = "pids-nao-cadastrados";

interface PidItem {
  media_source: string;
  installs: number | null;
  events_total: number | null;
  events_valid: number | null;
  sugestao_publisher_id: string | null;
  sugestao_motivo: string | null;
}

interface Props {
  campanhaId: string;
  publishers: CampanhaPublisher[] | undefined;
  canEdit: boolean;
  /** Chamado depois de cadastrar (pra recarregar a campanha). */
  onCadastrado?: () => Promise<void> | void;
}

export function PidsNaoCadastrados({ campanhaId, publishers, canEdit, onCadastrado }: Props) {
  const toast = useToast();
  const [items, setItems] = useState<PidItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [emImplantacao, setEmImplantacao] = useState(false);
  const [erro, setErro] = useState("");
  // PID -> publisher escolhido ("" = nenhum) e selecao.
  const [escolha, setEscolha] = useState<Record<string, string>>({});
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [salvando, setSalvando] = useState(false);
  const scrolled = useRef(false);

  const pubs = useMemo(
    () => (publishers ?? []).filter((p): p is CampanhaPublisher & { id: string } => !!p.id),
    [publishers]
  );

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro("");
    try {
      const res = await apiFetchStatus<{ items?: PidItem[] }>(
        `/campanhas/${campanhaId}/pids-nao-cadastrados`
      );
      const list = res?.items ?? [];
      setItems(list);
      setEmImplantacao(false);
      const init: Record<string, string> = {};
      for (const it of list) init[it.media_source] = it.sugestao_publisher_id ?? "";
      setEscolha(init);
      setSel(new Set());
    } catch (e) {
      if (isEmImplantacao(e)) {
        setEmImplantacao(true);
        setItems(null);
      } else {
        setErro(e instanceof Error ? e.message : "Falha ao carregar PIDs do robo.");
      }
    } finally {
      setLoading(false);
    }
  }, [campanhaId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // Link do /fechamento chega com #pids-nao-cadastrados; o bloco so existe
  // depois do fetch, entao rola aqui.
  useEffect(() => {
    if (loading || scrolled.current) return;
    if (typeof window !== "undefined" && window.location.hash === `#${PIDS_NAO_CADASTRADOS_ANCHOR}`) {
      scrolled.current = true;
      document.getElementById(PIDS_NAO_CADASTRADOS_ANCHOR)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [loading]);

  // Escolha so vale se o publisher e DESTA campanha (sugestao fora da lista = vazio).
  const pubIds = useMemo(() => new Set(pubs.map((p) => p.id)), [pubs]);
  const escolhaDe = (pid: string) => {
    const v = escolha[pid] ?? "";
    return v && pubIds.has(v) ? v : "";
  };
  const selecionaveis = (items ?? []).filter((it) => !!escolhaDe(it.media_source));
  const selecionados = selecionaveis.filter((it) => sel.has(it.media_source));

  const toggle = (pid: string) =>
    setSel((prev) => {
      const next = new Set(prev);
      if (next.has(pid)) next.delete(pid);
      else next.add(pid);
      return next;
    });

  const toggleTodos = () =>
    setSel((prev) =>
      prev.size === selecionaveis.length && selecionaveis.length > 0
        ? new Set()
        : new Set(selecionaveis.map((it) => it.media_source))
    );

  const cadastrar = async () => {
    if (!selecionados.length || salvando) return;
    const grupos = new Map<string, string[]>();
    for (const it of selecionados) {
      const pid = escolhaDe(it.media_source);
      grupos.set(pid, [...(grupos.get(pid) ?? []), it.media_source]);
    }
    setSalvando(true);
    try {
      const r = await cadastrarPidsPorPublisher(
        Array.from(grupos.entries()).map(([publisherId, names]) => ({
          publisherId,
          publisherNome: pubs.find((p) => p.id === publisherId)?.nome ?? "publisher",
          names
        }))
      );
      if (r.criados > 0 || r.jaExistiam > 0) {
        toast.success(
          `${r.criados} PID(s) cadastrado(s)${r.jaExistiam ? ` · ${r.jaExistiam} ja existiam` : ""}.`
        );
      }
      for (const msg of r.erros) toast.error(msg);
      if (r.criados > 0 || r.jaExistiam > 0) {
        await onCadastrado?.();
        await carregar();
      }
    } finally {
      setSalvando(false);
    }
  };

  const n = items?.length ?? 0;
  // Nada a mostrar: carregou e nao ha PID faltando.
  if (!loading && !emImplantacao && !erro && n === 0) return null;

  return (
    <section
      id={PIDS_NAO_CADASTRADOS_ANCHOR}
      className="scroll-mt-20 space-y-3 rounded-xl border border-amber-500/30 bg-surface p-6"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-amber-300">
          PIDs do robo nao cadastrados{items ? ` (${n})` : ""}
        </h2>
        {!emImplantacao && (
          <button
            type="button"
            onClick={carregar}
            disabled={loading || salvando}
            className="rounded-md p-1 text-muted hover:text-foreground disabled:opacity-50"
            title="Recarregar"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        )}
      </div>

      {loading && !items ? (
        <div className="flex items-center gap-2 text-xs text-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando PIDs do robo...
        </div>
      ) : emImplantacao ? (
        <p className="text-xs text-muted">
          Lista de PIDs nao cadastrados em implantacao no backend.
        </p>
      ) : erro ? (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          {erro}
        </div>
      ) : (
        <>
          <p className="text-xs text-muted">
            Media sources que o robo reportou neste mes e que nao estao em nenhum publisher
            da campanha. Escolha o publisher e cadastre (o PID entra ativo; os outros PIDs
            do publisher nao mudam).
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted">
                  <th className="w-8 px-2 py-2">
                    {canEdit && (
                      <input
                        type="checkbox"
                        aria-label="Selecionar todos"
                        checked={selecionaveis.length > 0 && sel.size === selecionaveis.length}
                        onChange={toggleTodos}
                        disabled={salvando || selecionaveis.length === 0}
                        className="accent-orange-500"
                      />
                    )}
                  </th>
                  <th className="px-2 py-2">PID</th>
                  <th className="px-2 py-2 text-right">Installs</th>
                  <th className="px-2 py-2 text-right">Eventos</th>
                  <th className="px-2 py-2 text-right">Validos</th>
                  <th className="px-2 py-2">Publisher</th>
                </tr>
              </thead>
              <tbody>
                {(items ?? []).map((it) => {
                  const escolhido = escolhaDe(it.media_source);
                  const sugerido =
                    !!it.sugestao_publisher_id && escolhido === it.sugestao_publisher_id;
                  return (
                    <tr key={it.media_source} className="border-b border-border/60 last:border-0">
                      <td className="px-2 py-2">
                        {canEdit && (
                          <input
                            type="checkbox"
                            aria-label={`Selecionar ${it.media_source}`}
                            checked={sel.has(it.media_source)}
                            onChange={() => toggle(it.media_source)}
                            disabled={salvando || !escolhido}
                            className="accent-orange-500"
                          />
                        )}
                      </td>
                      <td className="px-2 py-2 font-mono text-foreground">{it.media_source}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{num(it.installs)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{num(it.events_total)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{num(it.events_valid)}</td>
                      <td className="px-2 py-2">
                        <select
                          value={escolhido}
                          disabled={!canEdit || salvando || pubs.length === 0}
                          onChange={(e) => {
                            const v = e.target.value;
                            setEscolha((prev) => ({ ...prev, [it.media_source]: v }));
                            if (!v)
                              setSel((prev) => {
                                const next = new Set(prev);
                                next.delete(it.media_source);
                                return next;
                              });
                          }}
                          className="w-full min-w-[160px] rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground disabled:opacity-60"
                          aria-label={`Publisher para ${it.media_source}`}
                        >
                          <option value="">— escolher —</option>
                          {pubs.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.nome}
                            </option>
                          ))}
                        </select>
                        {sugerido && it.sugestao_motivo && (
                          <p className="mt-0.5 text-[11px] text-muted">
                            Sugestao: {it.sugestao_motivo}
                          </p>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {pubs.length === 0 && (
            <p className="text-xs text-muted">
              A campanha nao tem publishers cadastrados — cadastre pela edicao da campanha.
            </p>
          )}
          {canEdit && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={cadastrar}
                disabled={selecionados.length === 0 || salvando}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-black hover:opacity-90 disabled:opacity-50"
              >
                {salvando && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Cadastrar selecionados ({selecionados.length})
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function num(v: number | null | undefined): string {
  return v == null ? "—" : formatNumberPtBr(v, 0);
}
