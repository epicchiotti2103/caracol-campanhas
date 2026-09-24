"use client";

// Botao "Importar Excel" do fechamento + previa antes de aplicar.
// Le o .xlsx no navegador (lib/fechamento-xlsx.ts) e casa os publishers do
// Excel com as rows do fechamento (lib: agruparFechamento + casarExcel):
//   1. exato pela chave compacta (sem espaco/pontuacao/acento) — "Click
//      Orbits" = "ClickOrbits";
//   2. sem exato: aproximado (sufixo societario ignorado / prefixo por palavras
//      inteiras — "Horizon" -> "HORIZON EXCHANGE LTDA"), so com 1 candidato;
//      vem com checkbox marcada pro user desmarcar;
//   3. varios nomes do Excel no mesmo publisher somam;
//   4. rows duplicadas no fechamento (mesmo supplier / mesmo nome compacto)
//      viram 1 publisher: valor na 1a row + aviso. Supplier diferente = o user
//      escolhe.
// So no "Aplicar" devolve os valores pro modal preencher o pagamento digitado.
// Nada salva sozinho — o user revisa e clica Salvar como sempre.
//
// Secao extra (recolhida): PIDs do Excel (coluna "Media Source") que nao estao
// no cadastro da campanha. Cadastro OPCIONAL e manual: checkbox desmarcada por
// padrao + botao "Cadastrar selecionados", que adiciona o PID ao publisher
// casado (ativo) via POST /campanhas/publishers/{id}/media-sources (1 por
// publisher; so adiciona, nao recria os outros). Nao mexe nos valores nem
// salva o fechamento.

import { useMemo, useRef, useState } from "react";
import { AlertCircle, FileSpreadsheet, Loader2, X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { formatCurrency, parseNumberPtBr } from "@/lib/format";
import { useToast } from "@/lib/toast-context";
import { cadastrarPidsPorPublisher } from "@/lib/publisher-media-sources";
import {
  agruparFechamento,
  casarExcel,
  normalizarCompacto,
  normalizarPid,
  parseFechamentoXlsxFile,
  pidsFaltantes,
  type CasamentoExcel,
  type GrupoFechamento,
  type PidFaltante,
  type XlsxFechamentoParse
} from "@/lib/fechamento-xlsx";
import type { CampanhaPublisher, Moeda, Supplier } from "@/types";

export interface ImportXlsxPublisherRef {
  local_key: string;
  publisher_name: string;
  spend_final_input: string;
  moeda: Moeda;
  /** Se ausente, e resolvido pelo catalogo `suppliers` (nome compacto). */
  supplier_id?: string | null;
}

export interface ImportXlsxUpdate {
  local_key: string;
  valor: number;
}

type Status = "casou" | "sem_po" | "fora_do_excel";

/** Uma fonte do Excel que caiu num publisher do fechamento. */
interface Fonte {
  c: CasamentoExcel;
  incluida: boolean;
  modo: "exato" | "aproximado" | "escolhido";
}

interface LinhaGrupo {
  grupo: GrupoFechamento;
  ref: ImportXlsxPublisherRef;
  fontes: Fonte[];
  atual: number | null;
  excel: number | null;
  status: Status;
}

interface Props {
  /** Campanha do fechamento — usada so pra listar/cadastrar PIDs faltantes. */
  campanhaId: string;
  publishers: ImportXlsxPublisherRef[];
  /** Catalogo de fornecedores (resolve supplier_id das rows pelo nome). */
  suppliers?: Supplier[];
  disabled?: boolean;
  onApply: (updates: ImportXlsxUpdate[]) => void;
}

export function ImportarXlsxFechamento({
  campanhaId,
  publishers,
  suppliers,
  disabled,
  onApply
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [arquivo, setArquivo] = useState("");
  const [parse, setParse] = useState<XlsxFechamentoParse | null>(null);
  // Aproximacoes desmarcadas (por chave do Excel) e escolhas dos ambiguos
  // (chave do Excel -> id do grupo; "" = nao casar).
  const [aproxOff, setAproxOff] = useState<Set<string>>(new Set());
  const [escolhas, setEscolhas] = useState<Record<string, string>>({});
  // Cadastro da campanha (publishers -> media sources) pra comparar os PIDs.
  const toast = useToast();
  const [cadastro, setCadastro] = useState<CampanhaPublisher[] | null>(null);
  const [cadastroErro, setCadastroErro] = useState("");
  const [pidSel, setPidSel] = useState<Set<string>>(new Set());
  const [salvandoPids, setSalvandoPids] = useState(false);

  const carregarCadastro = async (): Promise<CampanhaPublisher[]> => {
    const res: { items?: CampanhaPublisher[] } = await apiFetch(
      `/campanhas/${campanhaId}/publishers`
    );
    return res?.items ?? [];
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setLoading(true);
    setError("");
    setParse(null);
    setAproxOff(new Set());
    setEscolhas({});
    setCadastro(null);
    setCadastroErro("");
    setPidSel(new Set());
    setArquivo(file.name);
    try {
      const p = await parseFechamentoXlsxFile(file);
      setParse(p);
      if (p.pares.length > 0) {
        carregarCadastro()
          .then(setCadastro)
          .catch((e) =>
            setCadastroErro(
              e instanceof Error ? e.message : "Nao foi possivel ler o cadastro."
            )
          );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Nao foi possivel ler o arquivo.");
    } finally {
      setLoading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const fechar = () => {
    setParse(null);
    setError("");
    setArquivo("");
    setAproxOff(new Set());
    setEscolhas({});
    setCadastro(null);
    setCadastroErro("");
    setPidSel(new Set());
  };

  // Rows validas com supplier_id resolvido + agrupamento por publisher.
  const { refsByKey, grupos } = useMemo(() => {
    const supByNome = new Map<string, string>();
    for (const s of suppliers ?? []) {
      const k = normalizarCompacto(s.name || "");
      if (k && !supByNome.has(k)) supByNome.set(k, s.id);
    }
    const refsByKey = new Map<string, ImportXlsxPublisherRef>();
    const refs = publishers
      .filter((p) => p.publisher_name.trim())
      .map((p) => {
        refsByKey.set(p.local_key, p);
        return {
          local_key: p.local_key,
          publisher_name: p.publisher_name,
          supplier_id:
            p.supplier_id ?? supByNome.get(normalizarCompacto(p.publisher_name)) ?? null
        };
      });
    return { refsByKey, grupos: agruparFechamento(refs) };
  }, [publishers, suppliers]);

  const casamentos = useMemo<CasamentoExcel[]>(
    () => (parse ? casarExcel(parse.publishers, grupos) : []),
    [parse, grupos]
  );

  const grupoNome = (id: string) =>
    grupos.find((g) => g.id === id)?.rows[0].publisher_name ?? id;

  const linhas = useMemo<LinhaGrupo[]>(() => {
    if (!parse) return [];
    const fontesPorGrupo = new Map<string, Fonte[]>();
    const push = (gid: string, f: Fonte) =>
      fontesPorGrupo.set(gid, [...(fontesPorGrupo.get(gid) ?? []), f]);
    for (const c of casamentos) {
      if (c.tipo === "exato" && c.grupoId) {
        push(c.grupoId, { c, incluida: true, modo: "exato" });
      } else if (c.tipo === "aproximado" && c.grupoId) {
        push(c.grupoId, {
          c,
          incluida: !aproxOff.has(c.excel.key),
          modo: "aproximado"
        });
      } else if (c.tipo === "ambiguo_exato" || c.tipo === "ambiguo_aprox") {
        const gid = escolhas[c.excel.key];
        if (gid) push(gid, { c, incluida: true, modo: "escolhido" });
      }
    }

    const out: LinhaGrupo[] = grupos.map((grupo) => {
      const ref = refsByKey.get(grupo.id) as ImportXlsxPublisherRef;
      const atualN = parseNumberPtBr(ref.spend_final_input);
      const fontes = fontesPorGrupo.get(grupo.id) ?? [];
      const inc = fontes.filter((f) => f.incluida);
      const temValor = inc.some((f) => f.c.excel.temValor);
      const soma = inc.reduce((a, f) => a + f.c.excel.valor, 0);
      return {
        grupo,
        ref,
        fontes,
        atual: Number.isFinite(atualN) ? atualN : null,
        // Casou mas o Excel nao tem PO total pra ele: nao escreve 0 por cima
        // (regra da suite: sem PO fica vazio, nunca 0) — mantem o atual.
        excel: temValor ? Math.round(soma * 100) / 100 : null,
        status: !inc.length ? "fora_do_excel" : temValor ? "casou" : "sem_po"
      };
    });
    const ordem: Record<Status, number> = { casou: 0, sem_po: 1, fora_do_excel: 2 };
    return out.sort(
      (a, b) =>
        ordem[a.status] - ordem[b.status] ||
        a.ref.publisher_name.localeCompare(b.ref.publisher_name)
    );
  }, [parse, casamentos, grupos, refsByKey, aproxOff, escolhas]);

  // Publishers do Excel sem publisher definido no fechamento (nao achado ou
  // ambiguo) — ficam numa tabela propria, com seletor nos ambiguos.
  const pendentes = casamentos.filter(
    (c) => c.tipo === "nao_achado" || c.tipo === "ambiguo_exato" || c.tipo === "ambiguo_aprox"
  );
  const semDestino = pendentes.filter((c) => !escolhas[c.excel.key]);
  const ambiguosSemEscolha = semDestino.filter((c) => c.tipo !== "nao_achado");
  const naoAplicadoSoma = semDestino.reduce((a, c) => a + c.excel.valor, 0);
  const duplicados = grupos.filter((g) => g.rows.length > 1);

  const casou = linhas.filter((l) => l.status === "casou");
  const brl = casou.filter((l) => l.ref.moeda === "BRL");

  const aplicar = () => {
    onApply(
      casou.map((l) => ({ local_key: l.grupo.id, valor: l.excel ?? 0 }))
    );
    fechar();
  };

  const toggleAprox = (key: string) =>
    setAproxOff((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // ---- PIDs do Excel fora do cadastro (opcional/manual) ----
  const faltantes = useMemo<PidFaltante[]>(
    () =>
      parse && cadastro
        ? pidsFaltantes(
            parse.pares,
            cadastro
              .filter((p) => p.id)
              .map((p) => ({
                id: p.id as string,
                nome: p.nome,
                supplier_id: p.supplier_id ?? null,
                media_sources: p.media_sources ?? []
              }))
          )
        : [],
    [parse, cadastro]
  );
  const cadastraveis = faltantes.filter((f) => f.status === "cadastravel");
  const selecionados = cadastraveis.filter((f) => pidSel.has(f.key));

  const togglePid = (key: string) =>
    setPidSel((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const cadastrarPids = async () => {
    if (!selecionados.length || salvandoPids) return;
    // O mesmo PID marcado em 2 publishers viraria duplicata.
    const porPid = new Map<string, string>();
    for (const f of selecionados) {
      const k = normalizarPid(f.media_source);
      if (porPid.has(k) && porPid.get(k) !== f.publisher_id) {
        toast.error(`${f.media_source} marcado em 2 publishers — deixe so um.`);
        return;
      }
      porPid.set(k, f.publisher_id as string);
    }
    setSalvandoPids(true);
    try {
      // 1 POST por publisher em /campanhas/publishers/{id}/media-sources: so
      // ADICIONA os PIDs (ativos), sem recriar os outros publishers/PIDs.
      // Backend ignora duplicado e devolve 409 se o PID esta em outro publisher.
      const porPub = new Map<string, { nome: string; names: string[] }>();
      for (const f of selecionados) {
        const id = f.publisher_id as string;
        const g = porPub.get(id) ?? { nome: f.publisher_nome ?? "publisher", names: [] as string[] };
        if (!g.names.some((n) => normalizarPid(n) === normalizarPid(f.media_source)))
          g.names.push(f.media_source.trim());
        porPub.set(id, g);
      }
      const r = await cadastrarPidsPorPublisher(
        Array.from(porPub.entries()).map(([publisherId, g]) => ({
          publisherId,
          publisherNome: g.nome,
          names: g.names
        }))
      );
      if (r.criados > 0) {
        toast.success(
          `${r.criados} PID(s) cadastrado(s) na campanha${r.jaExistiam ? ` · ${r.jaExistiam} ja existiam` : ""}.`
        );
      } else if (r.jaExistiam > 0 && r.erros.length === 0) {
        toast.info("Nada a cadastrar — os PIDs ja estao no cadastro.");
      }
      for (const msg of r.erros) toast.error(msg);
      setPidSel(new Set());
      setCadastro(await carregarCadastro());
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Nao foi possivel cadastrar os PIDs."
      );
    } finally {
      setSalvandoPids(false);
    }
  };

  const fmt = (v: number | null, m: Moeda | null) =>
    v == null ? "—" : formatCurrency(v, m ?? "USD");

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0])}
      />
      <button
        type="button"
        disabled={disabled || loading}
        onClick={() => inputRef.current?.click()}
        title='Soma "PO total" por Publisher do Excel de fechamento e preenche o pagamento (com previa)'
        className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border bg-background px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-60"
      >
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <FileSpreadsheet className="h-3.5 w-3.5" />
        )}
        Importar Excel
      </button>

      {(parse || error) && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
          onClick={(e) => {
            e.stopPropagation();
            fechar();
          }}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-border bg-zinc-950 px-5 py-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-orange-50">
                  Previa da importacao
                </p>
                <p className="mt-0.5 truncate text-xs text-orange-100/60">
                  {arquivo}
                  {parse && ` · aba "${parse.aba}" · total PO ${fmt(parse.total, "USD")}`}
                </p>
              </div>
              <button
                type="button"
                onClick={fechar}
                className="rounded-lg p-1 text-orange-100/60 hover:bg-white/5 hover:text-orange-50"
                aria-label="Fechar previa"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 space-y-3 overflow-auto px-5 py-4">
              {error && (
                <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                  <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  {error}
                </div>
              )}

              {parse && (
                <>
                  {duplicados.map((g) => (
                    <div
                      key={`dup-${g.id}`}
                      className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300"
                    >
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                      <span>
                        publisher duplicado no fechamento:{" "}
                        {g.rows.map((r) => r.publisher_name).join(" e ")}. O valor do Excel
                        vai so pra primeira linha ({g.rows[0].publisher_name}); as outras
                        ficam como estao — remova a duplicata antes de salvar.
                      </span>
                    </div>
                  ))}
                  {semDestino.length > 0 && (
                    <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                      <span>
                        {semDestino.length} publisher(s) do Excel sem destino no fechamento
                        ({semDestino.map((c) => c.excel.nome).join(", ")}) — somam{" "}
                        {fmt(naoAplicadoSoma, "USD")} e NAO serao aplicados
                        {ambiguosSemEscolha.length > 0
                          ? ". Nos ambiguos, escolha a linha na tabela abaixo"
                          : ""}
                        . Se faltar a row, adicione no fechamento e importe de novo.
                      </span>
                    </div>
                  )}
                  {brl.length > 0 && (
                    <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                      <span>
                        {brl.map((l) => l.ref.publisher_name).join(", ")} paga(m) em R$. O
                        valor do Excel entra no campo como esta, sem conversao — confira se
                        o PO total da planilha esta em reais.
                      </span>
                    </div>
                  )}

                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full text-sm">
                      <thead className="bg-background text-xs uppercase tracking-wider text-muted">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium">Publisher</th>
                          <th className="px-3 py-2 text-right font-medium">Valor atual</th>
                          <th className="px-3 py-2 text-right font-medium">Valor do Excel</th>
                          <th className="px-3 py-2 text-left font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {linhas.map((l) => (
                          <tr key={l.grupo.id}>
                            <td className="px-3 py-2 align-top text-foreground">
                              {l.ref.publisher_name}
                              {l.grupo.rows.length > 1 && (
                                <span className="ml-1 text-xs text-amber-300">
                                  (+ duplicata: {l.grupo.rows
                                    .slice(1)
                                    .map((r) => r.publisher_name)
                                    .join(", ")})
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right align-top tabular-nums text-muted">
                              {fmt(l.atual, l.ref.moeda)}
                            </td>
                            <td className="px-3 py-2 text-right align-top tabular-nums text-foreground">
                              {fmt(l.excel, l.ref.moeda)}
                            </td>
                            <td className="space-y-0.5 px-3 py-2 text-xs">
                              {l.fontes.length === 0 && (
                                <span className="text-muted">nao esta no Excel (mantido)</span>
                              )}
                              {l.fontes.map((f) => {
                                const valorFonte = f.c.excel.temValor
                                  ? ` · ${fmt(f.c.excel.valor, l.ref.moeda)}`
                                  : "";
                                if (f.modo === "aproximado")
                                  return (
                                    <label
                                      key={f.c.excel.key}
                                      className="flex cursor-pointer items-start gap-1.5"
                                    >
                                      <input
                                        type="checkbox"
                                        checked={f.incluida}
                                        onChange={() => toggleAprox(f.c.excel.key)}
                                        className="mt-0.5 accent-orange-500"
                                      />
                                      <span
                                        className={f.incluida ? "text-sky-300" : "text-muted line-through"}
                                      >
                                        casou por aproximacao ({f.c.excel.nome} →{" "}
                                        {l.ref.publisher_name}){valorFonte}
                                      </span>
                                    </label>
                                  );
                                return (
                                  <div key={f.c.excel.key} className="text-emerald-400">
                                    {f.modo === "escolhido" ? "escolhido" : "casou"}
                                    {normalizarCompacto(f.c.excel.nome) !==
                                      normalizarCompacto(l.ref.publisher_name) ||
                                    l.fontes.length > 1
                                      ? ` (Excel: ${f.c.excel.nome})`
                                      : ""}
                                    {l.fontes.length > 1 ? valorFonte : ""}
                                  </div>
                                );
                              })}
                              {l.status === "sem_po" && (
                                <div className="text-muted">sem PO total no Excel (mantido)</div>
                              )}
                              {l.fontes.length > 0 && l.status === "fora_do_excel" && (
                                <div className="text-muted">aproximacao desmarcada (mantido)</div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {pendentes.length > 0 && (
                    <div className="overflow-x-auto rounded-lg border border-border">
                      <table className="w-full text-sm">
                        <thead className="bg-background text-xs uppercase tracking-wider text-muted">
                          <tr>
                            <th className="px-3 py-2 text-left font-medium">No Excel</th>
                            <th className="px-3 py-2 text-right font-medium">Valor do Excel</th>
                            <th className="px-3 py-2 text-left font-medium">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {pendentes.map((c) => (
                            <tr key={`x-${c.excel.key}`}>
                              <td className="px-3 py-2 align-top text-foreground">
                                {c.excel.nome}
                              </td>
                              <td className="px-3 py-2 text-right align-top tabular-nums text-foreground">
                                {fmt(c.excel.temValor ? c.excel.valor : null, "USD")}
                              </td>
                              <td className="space-y-1 px-3 py-2 text-xs">
                                {c.tipo === "nao_achado" && (
                                  <span className="text-amber-300">
                                    nao achado no fechamento
                                  </span>
                                )}
                                {c.tipo !== "nao_achado" && (
                                  <>
                                    <div className="text-amber-300">
                                      {c.tipo === "ambiguo_exato"
                                        ? "mesmo nome em publishers com fornecedor diferente — escolha a linha"
                                        : `nao casou: ${c.candidatos.length} candidatos (${c.candidatos
                                            .map(grupoNome)
                                            .join(", ")})`}
                                    </div>
                                    <select
                                      value={escolhas[c.excel.key] ?? ""}
                                      onChange={(e) =>
                                        setEscolhas((prev) => ({
                                          ...prev,
                                          [c.excel.key]: e.target.value
                                        }))
                                      }
                                      className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
                                      aria-label={`Linha do fechamento para ${c.excel.nome}`}
                                    >
                                      <option value="">nao aplicar</option>
                                      {c.candidatos.map((gid) => (
                                        <option key={gid} value={gid}>
                                          {grupoNome(gid)}
                                        </option>
                                      ))}
                                    </select>
                                  </>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {cadastroErro && (
                    <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                      Nao foi possivel comparar os PIDs com o cadastro: {cadastroErro}
                    </div>
                  )}
                  {faltantes.length > 0 && (
                    <details className="rounded-lg border border-border">
                      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-amber-300">
                        {faltantes.length} PIDs do Excel nao estao no cadastro
                        {cadastraveis.length < faltantes.length &&
                          ` (${cadastraveis.length} cadastraveis)`}
                      </summary>
                      <div className="space-y-2 border-t border-border px-3 py-2">
                        <p className="text-xs text-muted">
                          Opcional. Marque os PIDs que quer adicionar ao publisher da
                          campanha (entram ativos). Isso altera o cadastro da campanha,
                          nao os valores nem o fechamento.
                        </p>
                        <ul className="space-y-1 text-xs">
                          {faltantes.map((f) => (
                            <li key={f.key}>
                              {f.status === "cadastravel" ? (
                                <label className="flex cursor-pointer items-start gap-1.5">
                                  <input
                                    type="checkbox"
                                    checked={pidSel.has(f.key)}
                                    onChange={() => togglePid(f.key)}
                                    disabled={salvandoPids}
                                    className="mt-0.5 accent-orange-500"
                                  />
                                  <span className="text-foreground">
                                    <span className="font-mono">{f.media_source}</span>
                                    <span className="text-muted">
                                      {" "}
                                      → {f.publisher_nome}
                                      {f.aproximado && ` (Excel: ${f.publisher_excel}, por aproximacao)`}
                                    </span>
                                  </span>
                                </label>
                              ) : (
                                <div className="flex items-start gap-1.5 pl-[18px]">
                                  <span className="text-muted">
                                    <span className="font-mono text-foreground/70">
                                      {f.media_source}
                                    </span>{" "}
                                    —{" "}
                                    {f.status === "outro_publisher"
                                      ? `Excel diz ${f.publisher_excel}, mas ja esta cadastrado em ${f.detalhe.join(", ")}`
                                      : f.status === "publisher_ambiguo"
                                        ? `publisher ${f.publisher_excel} ambiguo na campanha (${f.detalhe.join(", ")})`
                                        : `publisher ${f.publisher_excel} nao esta na campanha`}
                                  </span>
                                </div>
                              )}
                            </li>
                          ))}
                        </ul>
                        {cadastraveis.length > 0 && (
                          <div className="flex justify-end">
                            <button
                              type="button"
                              onClick={cadastrarPids}
                              disabled={selecionados.length === 0 || salvandoPids}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:border-primary/40 disabled:opacity-50"
                            >
                              {salvandoPids && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                              Cadastrar selecionados ({selecionados.length})
                            </button>
                          </div>
                        )}
                      </div>
                    </details>
                  )}
                  <p className="text-xs text-muted">
                    Aplicar preenche o pagamento dos {casou.length} publisher(s) que
                    casaram. Nada e salvo ate voce clicar em Salvar.
                  </p>
                </>
              )}
            </div>

            <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
              <button
                type="button"
                onClick={fechar}
                className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted hover:text-foreground"
              >
                Cancelar
              </button>
              {parse && (
                <button
                  type="button"
                  onClick={aplicar}
                  disabled={casou.length === 0}
                  className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-black hover:opacity-90 disabled:opacity-50"
                >
                  Aplicar ({casou.length})
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
