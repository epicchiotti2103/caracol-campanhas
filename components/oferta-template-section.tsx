"use client";

// Secao "E-mail de oferta (template)" do cadastro da campanha.
//
// O template mora no cadastro (nao mais no Inicio Campanha, que so le). Fonte:
// GET /campanhas/{id}/oferta-template -> proprio | herdado do mes anterior |
// sugestao (derivada da campanha). Salva via PUT separado DEPOIS do save da
// campanha dar certo (nunca vai no PATCH/POST da campanha) — ver
// `useOfertaTemplate().saveTo` chamado no `sendPayload` do campanha-form.
//
// Regras de gravacao:
// - edit: so grava se o GET carregou (backend fora do ar nao pode sobrescrever
//   o template real com vazio). Origem != proprio grava mesmo sem edicao
//   ("salve pra fixar" — fixa a sugestao/heranca como padrao da oferta).
// - create: so grava se algum campo foi preenchido (linha vazia viraria
//   `proprio` e mascararia sugestao/heranca).

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, BadgeCheck, History, Loader2, Send, Sparkles } from "lucide-react";
import { ApiError } from "@/lib/api-status";
import {
  emptyTemplate,
  friendlyError,
  getOfertaTemplate,
  normalizeTemplate,
  ORIGEM_LABEL,
  putOfertaTemplate,
  TEMPLATE_FIELD_LABEL,
  TEMPLATE_KEYS,
  templateHasContent,
  type OfertaTemplate,
  type TemplateKey,
  type TemplateOrigem
} from "@/lib/inicio-campanha";

type LoadState = "idle" | "loading" | "ok" | "error";

export interface OfertaTemplateState {
  tpl: OfertaTemplate;
  setField: (k: TemplateKey, v: string) => void;
  origem: TemplateOrigem | null;
  loadState: LoadState;
  loadErr: string;
  dirty: boolean;
  /**
   * Grava o template na campanha `id` (apos o save da campanha). Nunca joga:
   * devolve `{ok, warn?}` pro form mostrar toast sem bloquear o fluxo.
   */
  saveTo: (id: string, isCreate: boolean) => Promise<{ ok: boolean; skipped?: boolean; warn?: string }>;
}

export function useOfertaTemplate(campanhaId: string | undefined | null): OfertaTemplateState {
  const [tpl, setTpl] = useState<OfertaTemplate>(emptyTemplate());
  const [base, setBase] = useState<OfertaTemplate>(emptyTemplate());
  const [origem, setOrigem] = useState<TemplateOrigem | null>(null);
  const [loadState, setLoadState] = useState<LoadState>(campanhaId ? "loading" : "idle");
  const [loadErr, setLoadErr] = useState("");

  useEffect(() => {
    if (!campanhaId) {
      setLoadState("idle");
      return;
    }
    let cancelled = false;
    setLoadState("loading");
    (async () => {
      try {
        const r = await getOfertaTemplate(campanhaId);
        if (cancelled) return;
        const t = normalizeTemplate(r?.template ?? r?.sugestao ?? null);
        setTpl(t);
        setBase(t);
        setOrigem(r?.origem ?? (r?.template ? "proprio" : "sugestao"));
        setLoadState("ok");
      } catch (err) {
        if (cancelled) return;
        setLoadErr(friendlyError(err, "Template indisponivel (backend em implantacao)."));
        setLoadState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [campanhaId]);

  const dirty = TEMPLATE_KEYS.some((k) => (tpl[k] || "") !== (base[k] || ""));

  const setField = (k: TemplateKey, v: string) => setTpl((t) => ({ ...t, [k]: v }));

  const saveTo: OfertaTemplateState["saveTo"] = async (id, isCreate) => {
    if (isCreate) {
      if (!templateHasContent(tpl)) return { ok: true, skipped: true };
    } else {
      if (loadState !== "ok") return { ok: true, skipped: true };
      if (!dirty && origem === "proprio") return { ok: true, skipped: true };
    }
    try {
      const saved = await putOfertaTemplate(id, tpl);
      const t = normalizeTemplate(saved ?? tpl);
      setTpl(t);
      setBase(t);
      setOrigem("proprio");
      return { ok: true };
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) {
        return {
          ok: false,
          warn: "Campanha salva, mas o template de e-mail nao foi gravado (migration pendente no banco)."
        };
      }
      return {
        ok: false,
        warn: `Campanha salva, mas o template de e-mail nao foi gravado: ${friendlyError(
          err,
          "erro no backend"
        )}`
      };
    }
  };

  return { tpl, setField, origem, loadState, loadErr, dirty, saveTo };
}

const inputCls =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted/60 focus:border-primary/60";

const PLACEHOLDER: Partial<Record<TemplateKey, string>> = {
  campaign_info: "ex: RTG",
  offer_name: "ex: Claro Flex RTG",
  vertical: "ex: Telecom",
  model: "ex: CPA",
  attribution_model: "ex: Retargeting",
  geo: "ex: BR",
  os: "ex: iOS and Android",
  ideal_fraud_rate: "ex: Below 10%",
  payable_events: "ex: af_purchase/af_purchase_sd",
  po: "ex: 1,77 (pode trocar por publisher no envio)",
  important_note: "ex: We will NOT consider conversions where is_primary_attribution = FALSE.",
  creative_links: "RTG: 40GB -> https://drive.google.com/..."
};

export function OfertaTemplateSection({
  state,
  campanhaId
}: {
  state: OfertaTemplateState;
  campanhaId?: string | null;
}) {
  const { tpl, setField, origem, loadState, loadErr, dirty } = state;

  return (
    <section id="oferta-template" className="scroll-mt-6 space-y-4 rounded-xl border border-border bg-surface p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-primary">
            E-mail de oferta (template)
          </h2>
          {loadState === "ok" && origem && <OrigemSelo origem={origem} />}
          {dirty && (
            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
              alterado — salva junto com a campanha
            </span>
          )}
        </div>
        <p className="text-xs text-muted">
          Usado no{" "}
          {campanhaId ? (
            <Link
              href={`/inicio-campanha?campanha=${campanhaId}`}
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              <Send className="h-3 w-3" />
              Inicio Campanha
            </Link>
          ) : (
            "Inicio Campanha"
          )}
          . af_prt vem do campo de App e parceiro.
        </p>
      </div>

      {loadState === "loading" && (
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando template...
        </p>
      )}
      {loadState === "error" && (
        <p className="flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {loadErr} Os campos abaixo nao serao gravados neste save (pra nao sobrescrever o template atual).
        </p>
      )}
      {loadState === "ok" && origem && origem !== "proprio" && (
        <p className="flex items-start gap-1.5 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs text-sky-200">
          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {origem === "mes_anterior"
            ? "Herdado do mes anterior — salve a campanha pra fixar como padrao desta oferta."
            : "Sugestao montada com os dados da campanha — salve a campanha pra fixar."}
        </p>
      )}
      {!campanhaId && (
        <p className="text-xs text-muted">
          Opcional. Se deixar em branco, o Inicio Campanha usa uma sugestao montada com os dados da campanha.
        </p>
      )}

      <fieldset disabled={loadState === "loading"} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {TEMPLATE_KEYS.map((k) => {
          const multi = k === "important_note" || k === "creative_links";
          return (
            <div key={k} className={multi ? "sm:col-span-2" : ""}>
              <label className="mb-1.5 block text-xs font-medium text-muted">{TEMPLATE_FIELD_LABEL[k]}</label>
              {multi ? (
                <textarea
                  value={tpl[k] || ""}
                  onChange={(e) => setField(k, e.target.value)}
                  rows={k === "creative_links" ? 3 : 2}
                  placeholder={PLACEHOLDER[k]}
                  className={`${inputCls} resize-y font-mono text-xs`}
                />
              ) : (
                <input
                  value={tpl[k] || ""}
                  onChange={(e) => setField(k, e.target.value)}
                  placeholder={PLACEHOLDER[k]}
                  className={inputCls}
                />
              )}
            </div>
          );
        })}
      </fieldset>
    </section>
  );
}

export function OrigemSelo({ origem }: { origem: TemplateOrigem }) {
  const cls =
    origem === "proprio"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
      : origem === "mes_anterior"
      ? "border-sky-500/30 bg-sky-500/10 text-sky-300"
      : "border-zinc-500/30 bg-zinc-500/10 text-zinc-300";
  const Icon = origem === "proprio" ? BadgeCheck : origem === "mes_anterior" ? History : Sparkles;
  return (
    <span className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${cls}`}>
      <Icon className="h-3 w-3" />
      {ORIGEM_LABEL[origem] || origem}
    </span>
  );
}
