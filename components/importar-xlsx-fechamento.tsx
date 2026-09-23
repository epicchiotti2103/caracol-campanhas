"use client";

// Botao "Importar Excel" do fechamento + previa antes de aplicar.
// Le o .xlsx no navegador (lib/fechamento-xlsx.ts), casa os publishers do
// Excel com as rows do fechamento por nome normalizado e, so no "Aplicar",
// devolve os valores pro modal preencher o pagamento digitado. Nada salva
// sozinho — o user revisa e clica Salvar como sempre.

import { useMemo, useRef, useState } from "react";
import { AlertCircle, FileSpreadsheet, Loader2, X } from "lucide-react";
import { formatCurrency, parseNumberPtBr } from "@/lib/format";
import {
  normalizarCompacto,
  normalizarNome,
  parseFechamentoXlsxFile,
  type XlsxFechamentoParse
} from "@/lib/fechamento-xlsx";
import type { Moeda } from "@/types";

export interface ImportXlsxPublisherRef {
  local_key: string;
  publisher_name: string;
  spend_final_input: string;
  moeda: Moeda;
}

export interface ImportXlsxUpdate {
  local_key: string;
  valor: number;
}

type Status = "casou" | "sem_po" | "nao_achado" | "fora_do_excel";

interface LinhaPrevia {
  id: string;
  nome: string;
  nomeExcel: string | null;
  local_key: string | null;
  moeda: Moeda | null;
  atual: number | null;
  excel: number | null;
  status: Status;
}

interface Props {
  publishers: ImportXlsxPublisherRef[];
  disabled?: boolean;
  onApply: (updates: ImportXlsxUpdate[]) => void;
}

export function ImportarXlsxFechamento({ publishers, disabled, onApply }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [arquivo, setArquivo] = useState("");
  const [parse, setParse] = useState<XlsxFechamentoParse | null>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setLoading(true);
    setError("");
    setParse(null);
    setArquivo(file.name);
    try {
      setParse(await parseFechamentoXlsxFile(file));
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
  };

  const linhas = useMemo<LinhaPrevia[]>(() => {
    if (!parse) return [];
    const valid = publishers.filter((p) => p.publisher_name.trim());
    const byNome = new Map<string, ImportXlsxPublisherRef>();
    const byCompacto = new Map<string, ImportXlsxPublisherRef>();
    for (const p of valid) {
      const n = normalizarNome(p.publisher_name);
      const c = normalizarCompacto(p.publisher_name);
      if (!byNome.has(n)) byNome.set(n, p);
      if (!byCompacto.has(c)) byCompacto.set(c, p);
    }

    // Varios nomes do Excel podem cair na mesma row (ex: "Click Orbits" e
    // "Clickorbits") — soma.
    const casados = new Map<
      string,
      { row: ImportXlsxPublisherRef; valor: number; nomes: string[]; temValor: boolean }
    >();
    const naoAchados: LinhaPrevia[] = [];
    for (const x of parse.publishers) {
      const row = byNome.get(x.key) ?? byCompacto.get(normalizarCompacto(x.nome));
      if (!row) {
        naoAchados.push({
          id: `x-${x.key}`,
          nome: x.nome,
          nomeExcel: x.nome,
          local_key: null,
          moeda: null,
          atual: null,
          excel: x.temValor ? x.valor : null,
          status: "nao_achado"
        });
        continue;
      }
      const cur = casados.get(row.local_key);
      if (cur) {
        cur.valor += x.valor;
        cur.nomes.push(x.nome);
        cur.temValor ||= x.temValor;
      } else {
        casados.set(row.local_key, {
          row,
          valor: x.valor,
          nomes: [x.nome],
          temValor: x.temValor
        });
      }
    }

    const out: LinhaPrevia[] = [];
    for (const p of valid) {
      const atualN = parseNumberPtBr(p.spend_final_input);
      const atual = Number.isFinite(atualN) ? atualN : null;
      const c = casados.get(p.local_key);
      out.push({
        id: p.local_key,
        nome: p.publisher_name,
        nomeExcel: c ? c.nomes.join(" + ") : null,
        local_key: p.local_key,
        moeda: p.moeda,
        atual,
        // Casou mas o Excel nao tem PO total pra ele: nao escreve 0 por cima
        // (regra da suite: sem PO fica vazio, nunca 0) — mantem o atual.
        excel: c && c.temValor ? Math.round(c.valor * 100) / 100 : null,
        status: !c ? "fora_do_excel" : c.temValor ? "casou" : "sem_po"
      });
    }
    const ordem: Record<Status, number> = {
      casou: 0,
      nao_achado: 1,
      sem_po: 2,
      fora_do_excel: 3
    };
    return [...out, ...naoAchados].sort(
      (a, b) => ordem[a.status] - ordem[b.status] || a.nome.localeCompare(b.nome)
    );
  }, [parse, publishers]);

  const casou = linhas.filter((l) => l.status === "casou");
  const naoAchados = linhas.filter((l) => l.status === "nao_achado");
  const brl = casou.filter((l) => l.moeda === "BRL");
  const naoAchadoSoma = naoAchados.reduce((a, l) => a + (l.excel ?? 0), 0);

  const aplicar = () => {
    onApply(
      casou.map((l) => ({ local_key: l.local_key as string, valor: l.excel ?? 0 }))
    );
    fechar();
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
                  {naoAchados.length > 0 && (
                    <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                      <span>
                        {naoAchados.length} publisher(s) do Excel nao estao no fechamento
                        ({naoAchados.map((l) => l.nome).join(", ")}) — somam{" "}
                        {fmt(naoAchadoSoma, "USD")} e NAO serao aplicados. Adicione a
                        row no fechamento e importe de novo, se for o caso.
                      </span>
                    </div>
                  )}
                  {brl.length > 0 && (
                    <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                      <span>
                        {brl.map((l) => l.nome).join(", ")} paga(m) em R$. O valor do
                        Excel entra no campo como esta, sem conversao — confira se o PO
                        total da planilha esta em reais.
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
                          <tr key={l.id}>
                            <td className="px-3 py-2 text-foreground">
                              {l.nome}
                              {l.nomeExcel &&
                                normalizarNome(l.nomeExcel) !== normalizarNome(l.nome) && (
                                  <span className="ml-1 text-xs text-muted">
                                    (Excel: {l.nomeExcel})
                                  </span>
                                )}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-muted">
                              {l.status === "nao_achado" ? "—" : fmt(l.atual, l.moeda)}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-foreground">
                              {fmt(l.excel, l.moeda ?? "USD")}
                            </td>
                            <td className="px-3 py-2 text-xs">
                              {l.status === "casou" && (
                                <span className="text-emerald-400">casou</span>
                              )}
                              {l.status === "sem_po" && (
                                <span className="text-muted">
                                  sem PO total no Excel (mantido)
                                </span>
                              )}
                              {l.status === "nao_achado" && (
                                <span className="text-amber-300">nao achado no fechamento</span>
                              )}
                              {l.status === "fora_do_excel" && (
                                <span className="text-muted">
                                  nao esta no Excel (mantido)
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
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
