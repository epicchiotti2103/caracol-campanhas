// Importacao do Excel de fechamento (planilha que o time monta por campanha).
//
// Regra: valor a pagar por publisher = soma de `PO total` agrupada por
// `Publisher`, ignorando maiusculas/minusculas e espacos (cada hora e escrito
// de um jeito). Roda 100% no navegador (SheetJS) — nada vai pro backend.
//
// Aba: a 1a que tiver os cabecalhos `Publisher` e `PO total` (as outras abas
// costumam ser tabelas dinamicas e sao ignoradas). Linhas sem Publisher, com
// Publisher "PAUSADO"/"TOTAL" sao puladas; PO total vazio/nao numerico = 0.

import type { WorkBook } from "xlsx";

export interface XlsxPublisherTotal {
  /** Nome como apareceu na 1a ocorrencia (trim). */
  nome: string;
  /** Chave de agrupamento (normalizada). */
  key: string;
  valor: number;
  linhas: number;
  /** false = nenhuma linha tinha PO total numerico (publisher sem PO). */
  temValor: boolean;
}

export interface XlsxFechamentoParse {
  aba: string;
  publishers: XlsxPublisherTotal[];
  total: number;
}

/** lower + trim + espacos internos colapsados. */
export function normalizarNome(s: string): string {
  return String(s ?? "")
    .normalize("NFKC")
    .replace(/\u00a0/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** Versao sem nenhum espaco ("Click Orbits" x "Clickorbits"). */
export function normalizarCompacto(s: string): string {
  return normalizarNome(s).replace(/\s+/g, "");
}

const IGNORAR = new Set(["pausado", "total"]);

/** Converte a celula em numero (null = vazio/nao numerico). Aceita number ou texto "1.234,56"/"1234.56". */
function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  let s = v.replace(/[^\d,.\-]/g, "");
  if (!s || !/\d/.test(s)) return null;
  if (s.includes(",") && s.includes(".")) {
    // o separador que aparece por ultimo e o decimal
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Le um workbook ja carregado (XLSX.read) e agrega PO total por publisher.
 * `utils` vem do modulo xlsx (injetado pra permitir import dinamico).
 * Lanca Error com mensagem amigavel se nenhuma aba tiver os cabecalhos.
 */
export function parseFechamentoWorkbook(
  wb: WorkBook,
  utils: typeof import("xlsx").utils
): XlsxFechamentoParse {
  for (const aba of wb.SheetNames) {
    const ws = wb.Sheets[aba];
    if (!ws) continue;
    const rows = utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      raw: true,
      defval: null,
      blankrows: false
    });
    // cabecalho pode nao estar na 1a linha — procura nas primeiras 20
    for (let h = 0; h < Math.min(rows.length, 20); h++) {
      const header = (rows[h] || []).map((c) => normalizarNome(String(c ?? "")));
      const iPub = header.indexOf("publisher");
      const iPo = header.indexOf("po total");
      if (iPub < 0 || iPo < 0) continue;

      const map = new Map<string, XlsxPublisherTotal>();
      for (let r = h + 1; r < rows.length; r++) {
        const row = rows[r] || [];
        const nomeRaw = String(row[iPub] ?? "").trim();
        const key = normalizarNome(nomeRaw);
        if (!key || IGNORAR.has(key)) continue;
        const n = toNumber(row[iPo]);
        const valor = n ?? 0;
        const cur = map.get(key);
        if (cur) {
          cur.valor += valor;
          cur.linhas += 1;
          cur.temValor ||= n != null;
        } else {
          map.set(key, {
            nome: nomeRaw.replace(/\s+/g, " "),
            key,
            valor,
            linhas: 1,
            temValor: n != null
          });
        }
      }
      const publishers = Array.from(map.values()).map((p) => ({
        ...p,
        valor: Math.round(p.valor * 100) / 100
      }));
      const total =
        Math.round(publishers.reduce((a, p) => a + p.valor, 0) * 100) / 100;
      return { aba, publishers, total };
    }
  }
  throw new Error(
    'Nenhuma aba com as colunas "Publisher" e "PO total" foi encontrada.'
  );
}

/** Le o File do input e devolve o parse (import dinamico do SheetJS). */
export async function parseFechamentoXlsxFile(
  file: File
): Promise<XlsxFechamentoParse> {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  return parseFechamentoWorkbook(wb, XLSX.utils);
}
