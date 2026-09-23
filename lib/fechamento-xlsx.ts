// Importacao do Excel de fechamento (planilha que o time monta por campanha).
//
// Regra: valor a pagar por publisher = soma de `PO total` agrupada por
// `Publisher`, ignorando maiusculas/minusculas, acento, espacos e pontuacao
// (cada hora e escrito de um jeito: "Click Orbits" = "ClickOrbits"). Roda 100% no navegador (SheetJS) — nada vai pro backend.
//
// Aba: a 1a que tiver os cabecalhos `Publisher` e `PO total` (as outras abas
// costumam ser tabelas dinamicas e sao ignoradas). Linhas sem Publisher, com
// Publisher "PAUSADO"/"TOTAL" sao puladas; PO total vazio/nao numerico = 0.

import type { WorkBook } from "xlsx";

export interface XlsxPublisherTotal {
  /** Nome como apareceu na 1a ocorrencia (trim). */
  nome: string;
  /** Chave de agrupamento (normalizarCompacto). */
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

/** lower + trim + espacos internos colapsados (exibicao/comparacao leve). */
export function normalizarNome(s: string): string {
  return String(s ?? "")
    .normalize("NFKC")
    .replace(/\u00a0/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Chave de casamento: sem acento, lower, SO letras e digitos (sem espaco nem
 * pontuacao). "Click Orbits" = "ClickOrbits" = "click-orbits". E a chave
 * PRIMARIA do casamento (nao fallback).
 */
export function normalizarCompacto(s: string): string {
  return String(s ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Sufixos societarios ignorados no casamento aproximado (so no FIM do nome). */
const SUFIXOS_SOCIETARIOS = new Set([
  "ltda",
  "ltd",
  "inc",
  "llc",
  "sa",
  "me",
  "eireli",
  "limited",
  "co"
]);

/**
 * Palavras do nome pro casamento aproximado: sem acento, lower, "." e "/"
 * colados ("S.A." -> "sa"), resto da pontuacao vira espaco; sufixos
 * societarios no fim sao cortados (repetindo: "ltda me"), sem esvaziar o nome.
 */
export function palavrasNucleo(s: string): string[] {
  const w = String(s ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[./]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  while (w.length > 1 && SUFIXOS_SOCIETARIOS.has(w[w.length - 1])) w.pop();
  return w;
}

function ehPrefixoPorPalavras(a: string[], b: string[]): boolean {
  if (a.length === 0 || a.length > b.length) return false;
  return a.every((x, i) => x === b[i]);
}

/**
 * Casamento aproximado entre dois nomes: nucleos (sem sufixo societario)
 * iguais, ou um e prefixo do outro por palavras inteiras
 * ("horizon" x "horizon exchange ltda").
 */
export function casaAproximado(a: string, b: string): boolean {
  const pa = palavrasNucleo(a);
  const pb = palavrasNucleo(b);
  if (!pa.length || !pb.length) return false;
  if (pa.join("") === pb.join("")) return true;
  return ehPrefixoPorPalavras(pa, pb) || ehPrefixoPorPalavras(pb, pa);
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
        const key = normalizarCompacto(nomeRaw);
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

// ---------------------------------------------------------------------------
// Casamento Excel x rows do fechamento (puro — o componente so guarda o estado
// de UI: checkbox das aproximacoes e escolha dos ambiguos).
// ---------------------------------------------------------------------------

export interface CasamentoRef {
  local_key: string;
  publisher_name: string;
  /** Fornecedor da row (resolvido pelo catalogo); null = sem cadastro. */
  supplier_id: string | null;
}

/**
 * Um publisher do fechamento. Normalmente 1 row; 2+ rows = o mesmo publisher
 * duplicado no fechamento (mesmo supplier_id, ou mesmo nome compacto sem
 * supplier conflitante). O valor do Excel vai SEMPRE pra rows[0].
 */
export interface GrupoFechamento {
  id: string; // = rows[0].local_key
  rows: CasamentoRef[];
}

export type TipoCasamento =
  | "exato" // nome compacto igual, 1 publisher
  | "aproximado" // sufixo societario / prefixo por palavras, 1 candidato
  | "ambiguo_exato" // nome compacto igual em 2+ publishers com supplier diferente
  | "ambiguo_aprox" // 2+ candidatos aproximados — nao casa
  | "nao_achado";

export interface CasamentoExcel {
  excel: XlsxPublisherTotal;
  tipo: TipoCasamento;
  /** Grupo casado (exato/aproximado); null nos demais. */
  grupoId: string | null;
  /** Grupos candidatos (ambiguos). */
  candidatos: string[];
}

function conflitaSupplier(g: GrupoFechamento, sid: string | null): boolean {
  if (!sid) return false;
  return g.rows.some((r) => r.supplier_id && r.supplier_id !== sid);
}

/** Agrupa as rows do fechamento por publisher (detecta duplicados). */
export function agruparFechamento(refs: CasamentoRef[]): GrupoFechamento[] {
  const grupos: GrupoFechamento[] = [];
  for (const ref of refs) {
    const key = normalizarCompacto(ref.publisher_name);
    if (!key) continue;
    const g = grupos.find(
      (g) =>
        (ref.supplier_id != null &&
          g.rows.some((r) => r.supplier_id === ref.supplier_id)) ||
        (g.rows.some((r) => normalizarCompacto(r.publisher_name) === key) &&
          !conflitaSupplier(g, ref.supplier_id))
    );
    if (g) g.rows.push(ref);
    else grupos.push({ id: ref.local_key, rows: [ref] });
  }
  return grupos;
}

/** Casa cada publisher do Excel com um grupo do fechamento. */
export function casarExcel(
  excel: XlsxPublisherTotal[],
  grupos: GrupoFechamento[]
): CasamentoExcel[] {
  return excel.map((x) => {
    const exatos = grupos.filter((g) =>
      g.rows.some((r) => normalizarCompacto(r.publisher_name) === x.key)
    );
    if (exatos.length === 1)
      return { excel: x, tipo: "exato", grupoId: exatos[0].id, candidatos: [] };
    if (exatos.length > 1)
      return {
        excel: x,
        tipo: "ambiguo_exato",
        grupoId: null,
        candidatos: exatos.map((g) => g.id)
      };

    // Aproximado. 1o nivel: nucleo igual (so sufixo societario diferente);
    // 2o: prefixo por palavras inteiras. Conta candidatos por PUBLISHER (grupo),
    // nao por row — duplicado no fechamento nao vira "2 candidatos".
    const nx = palavrasNucleo(x.nome).join("");
    const iguais = grupos.filter((g) =>
      g.rows.some((r) => palavrasNucleo(r.publisher_name).join("") === nx)
    );
    const cands = iguais.length
      ? iguais
      : grupos.filter((g) => g.rows.some((r) => casaAproximado(x.nome, r.publisher_name)));
    if (cands.length === 1)
      return { excel: x, tipo: "aproximado", grupoId: cands[0].id, candidatos: [] };
    if (cands.length > 1)
      return {
        excel: x,
        tipo: "ambiguo_aprox",
        grupoId: null,
        candidatos: cands.map((g) => g.id)
      };
    return { excel: x, tipo: "nao_achado", grupoId: null, candidatos: [] };
  });
}
