import { ApiError, apiFetchStatus, describeDetail, isEmImplantacao } from "@/lib/api-status";

/**
 * Adiciona PIDs (media sources) ativos a um publisher SEM recriar os outros:
 * `POST /campanhas/publishers/{publisher_id}/media-sources` body `{names}`.
 * Backend ignora duplicado (case/espaco-insensivel) e responde 409 se o PID ja
 * esta em OUTRO publisher da mesma campanha.
 */
export interface AddMediaSourcesResult {
  criados: string[];
  ja_existiam: string[];
}

export async function addMediaSourcesToPublisher(
  publisherId: string,
  names: string[]
): Promise<AddMediaSourcesResult> {
  const res = await apiFetchStatus<Partial<AddMediaSourcesResult> | null>(
    `/campanhas/publishers/${publisherId}/media-sources`,
    { method: "POST", body: JSON.stringify({ names }) }
  );
  return { criados: res?.criados ?? [], ja_existiam: res?.ja_existiam ?? [] };
}

/** Mensagem legivel pro erro do POST acima (404 = em implantacao, 409 = conflito). */
export function describeAddMediaSourcesError(e: unknown, publisherNome?: string): string {
  const alvo = publisherNome ? ` em ${publisherNome}` : "";
  if (isEmImplantacao(e)) return "Cadastro de PIDs em implantacao no backend — tente de novo em instantes.";
  if (e instanceof ApiError && e.status === 409) {
    // Contrato: detail = {message, conflitos: [{media_source, publisher_id, publisher_nome}]}
    const d = e.detail as { conflitos?: unknown } | null;
    const conflitos = d && typeof d === "object" && Array.isArray(d.conflitos)
      ? (d.conflitos as Array<Record<string, unknown>>)
      : null;
    if (conflitos && conflitos.length) {
      const itens = conflitos
        .map((c) => {
          const pid = String(c.media_source ?? "").trim();
          const pub = String(c.publisher_nome ?? "").trim() || "outro publisher";
          return pid ? `${pid} ja esta em ${pub}` : "";
        })
        .filter(Boolean)
        .join("; ");
      return `Nao cadastrado${alvo}: ${itens}. Mova o PID no publisher de origem ou escolha outro publisher.`;
    }
    const det = describeDetail(e.detail);
    return `Nao cadastrado${alvo}: PID ja pertence a outro publisher desta campanha${det ? ` — ${det}` : ""}.`;
  }
  return e instanceof Error ? e.message : "Nao foi possivel cadastrar os PIDs.";
}

/**
 * Cadastra em lote: agrupa por publisher e faz 1 POST por publisher.
 * Nao aborta no primeiro erro — devolve o que entrou e as falhas por publisher.
 */
export async function cadastrarPidsPorPublisher(
  grupos: Array<{ publisherId: string; publisherNome: string; names: string[] }>
): Promise<{ criados: number; jaExistiam: number; erros: string[] }> {
  let criados = 0;
  let jaExistiam = 0;
  const erros: string[] = [];
  for (const g of grupos) {
    if (!g.names.length) continue;
    try {
      const r = await addMediaSourcesToPublisher(g.publisherId, g.names);
      criados += r.criados.length;
      jaExistiam += r.ja_existiam.length;
    } catch (e) {
      erros.push(describeAddMediaSourcesError(e, g.publisherNome));
    }
  }
  return { criados, jaExistiam, erros };
}
