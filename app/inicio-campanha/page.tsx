"use client";

// Inicio de Campanha — composer do e-mail de oferta pro publisher.
//
// Fluxo: campanha (busca, default mes atual) -> publisher (da campanha) ->
// modo (Nova oferta | Reinicio do mes anterior) -> prefill do backend (PO,
// af_prt ativos, destinatarios do supplier, budget do mes anterior) ->
// template da oferta (proprio | herdado | sugestao) -> preview ao vivo no
// formato exato -> Copiar e registrar | Abrir no e-mail (mailto) + registro.
//
// Sem provedor de e-mail ainda: o "registro" (POST /campanhas/{id}/envios) e
// o que alimenta o Acompanhamento de envios. Status default fica no backend
// (nova -> oferecido, reinicio -> enviado); o front nao manda status.

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Loader2,
  Search,
  Copy,
  Mail,
  Send,
  ChevronDown,
  ChevronRight,
  Save,
  RotateCcw,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  X,
  Sparkles,
  History,
  BadgeCheck,
  Info
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { cachedFetch, MONTHS_AVAILABLE_TTL_MS } from "@/lib/cache";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useCan } from "@/lib/perms-context";
import { useToast } from "@/lib/toast-context";
import { currentMonthString, formatMesAnoShort } from "@/lib/format";
import {
  buildCorpo,
  buildMailto,
  copyToClipboard,
  createEnvio,
  defaultAssunto,
  emptyTemplate,
  friendlyError,
  getInicioPrefill,
  getOfertaTemplate,
  looksLikeEmail,
  MAILTO_WARN_LEN,
  normalizeTemplate,
  ORIGEM_LABEL,
  parseBudgetEvents,
  putOfertaTemplate,
  splitEmails,
  STATUS_LABEL,
  TEMPLATE_FIELD_LABEL,
  TEMPLATE_KEYS,
  type Envio,
  type EnvioCanal,
  type EnvioModo,
  type InicioPrefill,
  type OfertaTemplate,
  type OfertaTemplateResponse,
  type TemplateKey
} from "@/lib/inicio-campanha";
import type { Campanha, CampanhaMonthsAvailable, CampanhaPublisher } from "@/types";

const inputCls =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted/60 focus:border-primary/60 disabled:opacity-50";
const labelCls = "mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted";

export default function InicioCampanhaPage() {
  return (
    <AppShell>
      <Suspense
        fallback={
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        }
      >
        <Composer />
      </Suspense>
    </AppShell>
  );
}

function Composer() {
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const can = useCan();
  const toast = useToast();

  const initialCampanha = searchParams?.get("campanha") || "";
  const initialPublisher = searchParams?.get("publisher") || "";

  // ---- Campanha ----
  const [months, setMonths] = useState<string[]>([]);
  const [month, setMonth] = useState<string>(currentMonthString());
  const [campanhas, setCampanhas] = useState<Campanha[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [busca, setBusca] = useState("");
  const [campanhaId, setCampanhaId] = useState<string>(initialCampanha);
  const [campanha, setCampanha] = useState<Campanha | null>(null);
  const [loadingCampanha, setLoadingCampanha] = useState(false);

  // ---- Publisher / modo ----
  const [publisherKey, setPublisherKey] = useState<string>("");
  const [modo, setModo] = useState<EnvioModo>("nova");

  // ---- Prefill ----
  const [prefill, setPrefill] = useState<InicioPrefill | null>(null);
  const [prefillLoading, setPrefillLoading] = useState(false);
  const [prefillErr, setPrefillErr] = useState("");

  // ---- Campos do envio ----
  const [po, setPo] = useState("");
  const [afPrt, setAfPrt] = useState("");
  const [destinatarios, setDestinatarios] = useState<string[]>([]);
  const [cc, setCc] = useState<string[]>([]);
  const [budgetText, setBudgetText] = useState("");
  const [observacao, setObservacao] = useState("");
  const [assunto, setAssunto] = useState("");
  const [assuntoTouched, setAssuntoTouched] = useState(false);

  // ---- Template ----
  const [tplResp, setTplResp] = useState<OfertaTemplateResponse | null>(null);
  const [tplErr, setTplErr] = useState("");
  const [tpl, setTpl] = useState<OfertaTemplate>(emptyTemplate());
  const [tplBase, setTplBase] = useState<OfertaTemplate>(emptyTemplate());
  const [tplOpen, setTplOpen] = useState(false);
  const [savingTpl, setSavingTpl] = useState(false);

  // ---- Acoes ----
  const [busy, setBusy] = useState<EnvioCanal | null>(null);
  const [lastEnvio, setLastEnvio] = useState<{ envio: Envio | null; canal: EnvioCanal; copied?: boolean } | null>(null);
  const [actionErr, setActionErr] = useState("");

  // Meses disponiveis
  useEffect(() => {
    (async () => {
      try {
        const res = await cachedFetch<CampanhaMonthsAvailable>("/campanhas?months_available=1", {
          ttlMs: MONTHS_AVAILABLE_TTL_MS
        });
        setMonths(res?.months || []);
      } catch {
        // usa so o mes corrente
      }
    })();
  }, []);

  // Campanhas do mes
  useEffect(() => {
    let cancelled = false;
    setLoadingList(true);
    (async () => {
      try {
        const res: { items: Campanha[] } | Campanha[] = await cachedFetch(`/campanhas?month=${month}`, {
          ttlMs: 30_000
        });
        if (cancelled) return;
        const items = Array.isArray(res) ? res : res?.items || [];
        setCampanhas(items);
      } catch {
        if (!cancelled) setCampanhas([]);
      } finally {
        if (!cancelled) setLoadingList(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [month]);

  const monthOptions = useMemo(() => {
    const set = new Set<string>(months);
    set.add(month);
    set.add(currentMonthString());
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [months, month]);

  const campanhasFiltradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const list = [...campanhas].sort((a, b) => {
      // ativas primeiro, depois por nome
      const sa = a.status === "ativa" ? 0 : 1;
      const sb = b.status === "ativa" ? 0 : 1;
      return sa - sb || a.name.localeCompare(b.name);
    });
    if (!q) return list;
    return list.filter(
      (c) => c.name.toLowerCase().includes(q) || (c.codigo || "").toLowerCase().includes(q)
    );
  }, [campanhas, busca]);

  // Detalhe da campanha (publishers) + template
  useEffect(() => {
    resetPublisherFields();
    setPublisherKey("");
    setCampanha(null);
    setTplResp(null);
    setTplErr("");
    setTpl(emptyTemplate());
    setTplBase(emptyTemplate());
    setAssuntoTouched(false);
    setLastEnvio(null);
    if (!campanhaId) return;
    let cancelled = false;
    setLoadingCampanha(true);
    (async () => {
      try {
        const c: Campanha = await apiFetch(`/campanhas/${campanhaId}`);
        if (cancelled) return;
        setCampanha(c);
        // mes do seletor acompanha a campanha escolhida (deep link)
        const mr = (c.mes_referencia || "").slice(0, 7);
        if (mr && mr !== month) setMonth(mr);
        if (initialPublisher && campanhaId === initialCampanha) {
          const p = (c.publishers || []).find((x) => x.id === initialPublisher);
          if (p?.id) setPublisherKey(p.id);
        }
      } catch (err) {
        if (!cancelled) toast.error(friendlyError(err, "Falha ao carregar a campanha."));
      } finally {
        if (!cancelled) setLoadingCampanha(false);
      }
    })();
    (async () => {
      try {
        const r = await getOfertaTemplate(campanhaId);
        if (cancelled) return;
        setTplResp(r);
        const base = normalizeTemplate(r?.template ?? r?.sugestao ?? null);
        setTpl(base);
        setTplBase(base);
      } catch (err) {
        if (cancelled) return;
        setTplErr(
          friendlyError(err, "Template indisponivel (backend em implantacao). Preencha os campos manualmente.")
        );
        setTplOpen(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campanhaId]);

  const publishers: CampanhaPublisher[] = useMemo(() => campanha?.publishers || [], [campanha]);
  const publisher = useMemo(
    () => publishers.find((p, i) => (p.id || `idx:${i}`) === publisherKey) || null,
    [publishers, publisherKey]
  );

  function resetPublisherFields() {
    setPrefill(null);
    setPrefillErr("");
    setPo("");
    setAfPrt("");
    setDestinatarios([]);
    setCc([]);
    setBudgetText("");
    setObservacao("");
    setActionErr("");
  }

  // Prefill ao escolher publisher
  useEffect(() => {
    resetPublisherFields();
    setLastEnvio(null);
    if (!campanhaId || !publisher) return;
    // fallback local: media sources ativas do proprio cadastro
    const localAfPrts = (publisher.media_sources || []).filter((m) => m.active).map((m) => m.name);
    if (localAfPrts.length === 1) setAfPrt(localAfPrts[0]);
    if (!publisher.id) {
      setPrefillErr("Publisher sem id no cadastro — preencha os campos manualmente.");
      return;
    }
    let cancelled = false;
    setPrefillLoading(true);
    (async () => {
      try {
        const p = await getInicioPrefill(campanhaId, publisher.id!);
        if (cancelled) return;
        setPrefill(p);
        setPo(p?.po ?? "");
        const prts = p?.af_prts || [];
        setAfPrt(prts.length >= 1 ? prts[0] : localAfPrts[0] || "");
        setDestinatarios(p?.destinatarios || []);
        if (modo === "reinicio" && p?.budget_anterior) setBudgetText(String(p.budget_anterior));
      } catch (err) {
        if (cancelled) return;
        setPrefillErr(
          friendlyError(err, "Nao deu pra pre-preencher (backend em implantacao). Preencha manualmente.")
        );
      } finally {
        if (!cancelled) setPrefillLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campanhaId, publisher]);

  // Ao trocar pra reinicio, puxa o budget do mes anterior se o campo estiver vazio
  useEffect(() => {
    if (modo === "reinicio" && !budgetText.trim() && prefill?.budget_anterior) {
      setBudgetText(String(prefill.budget_anterior));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modo]);

  const afPrtOptions = useMemo(() => {
    const fromPrefill = prefill?.af_prts || [];
    if (fromPrefill.length) return fromPrefill;
    return (publisher?.media_sources || []).filter((m) => m.active).map((m) => m.name);
  }, [prefill, publisher]);

  const budgetEvents = parseBudgetEvents(budgetText);
  const budgetInvalid = budgetText.trim() !== "" && budgetEvents === null;
  const budgetMissing = modo === "reinicio" && !budgetEvents;

  const corpo = useMemo(
    () =>
      buildCorpo({
        template: tpl,
        budgetEvents,
        po,
        afPrt,
        observacao
      }),
    [tpl, budgetEvents, po, afPrt, observacao]
  );

  const assuntoFinal = assuntoTouched ? assunto : defaultAssunto(tpl.offer_name);

  const mailtoUrl = useMemo(
    () => buildMailto({ to: destinatarios, cc, subject: assuntoFinal, body: corpo }),
    [destinatarios, cc, assuntoFinal, corpo]
  );
  const mailtoLong = mailtoUrl.length > MAILTO_WARN_LEN;

  const tplDirty = useMemo(
    () => TEMPLATE_KEYS.some((k) => (tpl[k] || "") !== (tplBase[k] || "")),
    [tpl, tplBase]
  );

  const canWrite = !!campanha && (can("campanhas.edit") || (!!user && campanha.owner_id === user.id));
  const invalidEmails = [...destinatarios, ...cc].filter((e) => !looksLikeEmail(e));

  function validate(canal: EnvioCanal): string | null {
    if (!campanha) return "Escolha a campanha.";
    if (!publisher) return "Escolha o publisher.";
    if (!canWrite) return "Voce nao tem permissao de edicao nesta campanha.";
    if (modo === "reinicio" && !budgetEvents) return "No reinicio o Budget Events e obrigatorio (inteiro > 0).";
    if (budgetInvalid) return "Budget Events invalido — use um numero (ex: 500).";
    if (invalidEmails.length) return `E-mail invalido: ${invalidEmails.join(", ")}`;
    if (canal === "mailto" && destinatarios.length === 0) return "Informe ao menos um destinatario pro mailto.";
    if (!corpo.trim()) return "Corpo vazio.";
    return null;
  }

  async function registrar(canal: EnvioCanal): Promise<Envio | null> {
    if (!campanha || !publisher) return null;
    return createEnvio(campanha.id, {
      publisher_id: publisher.id || null,
      publisher_nome: publisher.nome,
      supplier_id: prefill?.supplier_id ?? publisher.supplier_id ?? null,
      modo,
      destinatarios,
      cc,
      assunto: assuntoFinal,
      corpo,
      po: po.trim() || null,
      af_prt: afPrt.trim() || null,
      budget_events: budgetEvents,
      observacao: observacao.trim() || null,
      canal
    });
  }

  function handleCopiar() {
    const err = validate("copiar");
    setActionErr(err || "");
    if (err) return;
    // Copia SINCRONO no clique (antes do await) — user activation no Safari.
    const copyP = copyToClipboard(`${assuntoFinal}\n\n${corpo}`);
    setBusy("copiar");
    (async () => {
      const copied = await copyP;
      try {
        const envio = await registrar("copiar");
        setLastEnvio({ envio, canal: "copiar", copied });
        toast.success(
          copied ? "Copiado e registrado no acompanhamento." : "Registrado — mas a copia falhou, use os botoes de copiar do preview."
        );
      } catch (e) {
        const msg = friendlyError(e, "Falha ao registrar o envio.");
        setActionErr(copied ? `Copiado, mas NAO registrado: ${msg}` : msg);
        toast.error(copied ? "Copiado, mas nao registrado." : msg);
      } finally {
        setBusy(null);
      }
    })();
  }

  function handleMailto() {
    const err = validate("mailto");
    setActionErr(err || "");
    if (err) return;
    // Abre o cliente de e-mail no clique; registra em seguida.
    window.location.href = mailtoUrl;
    setBusy("mailto");
    (async () => {
      try {
        const envio = await registrar("mailto");
        setLastEnvio({ envio, canal: "mailto" });
        toast.success("E-mail aberto e envio registrado.");
      } catch (e) {
        const msg = friendlyError(e, "Falha ao registrar o envio.");
        setActionErr(`E-mail aberto, mas NAO registrado: ${msg}`);
        toast.error("E-mail aberto, mas nao registrado.");
      } finally {
        setBusy(null);
      }
    })();
  }

  async function handleSalvarTemplate() {
    if (!campanha) return;
    setSavingTpl(true);
    try {
      const saved = await putOfertaTemplate(campanha.id, tpl);
      const base = normalizeTemplate(saved ?? tpl);
      setTplBase(base);
      setTpl(base);
      setTplResp((r) => ({
        template: base,
        origem: "proprio",
        sugestao: r?.sugestao ?? base
      }));
      setTplErr("");
      toast.success("Template salvo como padrao desta oferta.");
    } catch (e) {
      toast.error(friendlyError(e, "Falha ao salvar o template."));
    } finally {
      setSavingTpl(false);
    }
  }

  const origem = tplResp?.origem;

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-widest text-primary">Inicio Campanha</h4>
          <h1 className="text-2xl font-semibold text-foreground">Oferta pro publisher</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Monte o e-mail de oferta ou de reinicio a partir do cadastro da campanha. Copie ou abra no seu
            cliente de e-mail — cada envio fica registrado no acompanhamento.
          </p>
        </div>
        <Link
          href="/inicio-campanha/envios"
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium text-muted transition-colors hover:border-primary/40 hover:text-foreground"
        >
          Acompanhamento de envios
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {lastEnvio && (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
          <span className="flex-1 text-foreground">
            {lastEnvio.canal === "copiar"
              ? lastEnvio.copied
                ? "Assunto + corpo copiados."
                : "Registrado (copia falhou — use os botoes de copiar do preview)."
              : "Cliente de e-mail aberto."}{" "}
            Envio registrado
            {lastEnvio.envio?.status ? ` como "${STATUS_LABEL[lastEnvio.envio.status] || lastEnvio.envio.status}"` : ""}.
          </span>
          <Link
            href="/inicio-campanha/envios"
            className="flex items-center gap-1 text-xs font-semibold text-emerald-300 hover:underline"
          >
            Ver acompanhamento <ArrowRight className="h-3.5 w-3.5" />
          </Link>
          <button onClick={() => setLastEnvio(null)} className="text-muted hover:text-foreground" aria-label="Fechar">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        {/* ================= Formulario ================= */}
        <div className="space-y-5">
          {/* 1. Campanha */}
          <Section step={1} title="Campanha">
            <div className="flex flex-wrap gap-2">
              <select
                value={month}
                onChange={(e) => {
                  setMonth(e.target.value);
                  setCampanhaId("");
                }}
                className={`${inputCls} w-auto`}
                aria-label="Mes de referencia"
              >
                {monthOptions.map((m) => (
                  <option key={m} value={m}>
                    {formatMesAnoShort(m)}
                  </option>
                ))}
              </select>
              <div className="relative min-w-[180px] flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar por nome ou codigo"
                  className={`${inputCls} pl-9`}
                />
              </div>
            </div>
            <select
              value={campanhaId}
              onChange={(e) => setCampanhaId(e.target.value)}
              className={`${inputCls} mt-2`}
              disabled={loadingList}
            >
              <option value="">
                {loadingList
                  ? "Carregando..."
                  : campanhasFiltradas.length
                  ? `Selecione (${campanhasFiltradas.length})`
                  : "Nenhuma campanha neste mes"}
              </option>
              {campanhaId && campanha && !campanhasFiltradas.some((c) => c.id === campanhaId) && (
                <option value={campanha.id}>
                  {campanha.codigo ? `${campanha.codigo} · ` : ""}
                  {campanha.name}
                </option>
              )}
              {campanhasFiltradas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.codigo ? `${c.codigo} · ` : ""}
                  {c.name}
                  {c.status !== "ativa" ? ` (${c.status})` : ""}
                </option>
              ))}
            </select>
            {loadingCampanha && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-muted">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando campanha...
              </p>
            )}
            {campanha && !canWrite && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-300">
                <AlertTriangle className="h-3.5 w-3.5" /> Somente leitura: precisa ser owner ou ter permissao de
                edicao pra registrar envios.
              </p>
            )}
          </Section>

          {/* 2. Publisher + modo */}
          <Section step={2} title="Publisher e modo" disabled={!campanha}>
            <select
              value={publisherKey}
              onChange={(e) => setPublisherKey(e.target.value)}
              className={inputCls}
              disabled={!campanha}
            >
              <option value="">
                {!campanha ? "Escolha a campanha antes" : publishers.length ? "Selecione o publisher" : "Campanha sem publishers cadastrados"}
              </option>
              {publishers.map((p, i) => (
                <option key={p.id || `idx:${i}`} value={p.id || `idx:${i}`}>
                  {p.nome}
                </option>
              ))}
            </select>

            <div className="mt-3 inline-flex rounded-lg border border-border bg-background p-0.5">
              {(
                [
                  ["nova", "Nova oferta", Sparkles],
                  ["reinicio", "Reinicio do mes anterior", History]
                ] as const
              ).map(([v, label, Icon]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setModo(v)}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                    modo === v ? "bg-primary text-black" : "text-muted hover:text-foreground"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-muted">
              Registro entra como{" "}
              <strong className="text-foreground">{modo === "nova" ? "Oferecido" : "Enviado"}</strong> — da pra
              trocar depois no acompanhamento.
            </p>
          </Section>

          {/* 3. Dados do envio */}
          <Section step={3} title="Dados do envio" disabled={!publisher}>
            {prefillLoading && (
              <p className="mb-3 flex items-center gap-1.5 text-xs text-muted">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Buscando PO, af_prt e contatos...
              </p>
            )}
            {prefillErr && (
              <p className="mb-3 flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {prefillErr}
              </p>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className={labelCls}>
                  PO {prefill?.moeda ? <span className="normal-case text-muted/70">({prefill.moeda})</span> : null}
                </label>
                <input
                  value={po}
                  onChange={(e) => setPo(e.target.value)}
                  placeholder={prefill && !prefill.po ? "Sem PO vigente — informe" : "ex: 1,77"}
                  className={inputCls}
                  disabled={!publisher}
                />
              </div>
              <div>
                <label className={labelCls}>af_prt</label>
                <input
                  value={afPrt}
                  onChange={(e) => setAfPrt(e.target.value)}
                  list="af-prt-options"
                  placeholder="media source"
                  className={inputCls}
                  disabled={!publisher}
                />
                <datalist id="af-prt-options">
                  {afPrtOptions.map((o) => (
                    <option key={o} value={o} />
                  ))}
                </datalist>
                {afPrtOptions.length > 1 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {afPrtOptions.map((o) => (
                      <button
                        key={o}
                        type="button"
                        onClick={() => setAfPrt(o)}
                        className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                          afPrt === o
                            ? "border-primary/50 bg-primary/15 text-primary"
                            : "border-border text-muted hover:text-foreground"
                        }`}
                      >
                        {o}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-4">
              <label className={labelCls}>
                Budget Events{" "}
                {modo === "reinicio" ? (
                  <span className="normal-case text-primary">(obrigatorio)</span>
                ) : (
                  <span className="normal-case text-muted/70">(opcional — vazio some do e-mail)</span>
                )}
              </label>
              <input
                value={budgetText}
                onChange={(e) => setBudgetText(e.target.value)}
                placeholder="ex: 500 ou 500 events"
                className={`${inputCls} ${budgetInvalid || (budgetMissing && budgetText) ? "border-red-500/60" : ""}`}
                disabled={!publisher}
              />
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]">
                {budgetEvents ? <span className="text-muted">No e-mail: &quot;{budgetEvents} events&quot;</span> : null}
                {budgetInvalid && <span className="text-red-400">Nao achei um numero inteiro.</span>}
                {prefill?.budget_anterior ? (
                  <span className="flex items-center gap-1.5 text-muted">
                    <Info className="h-3 w-3" />
                    Rodou <strong className="text-foreground">{prefill.budget_anterior}</strong> events no mes anterior
                    {prefill.budget_anterior_fonte ? ` (${prefill.budget_anterior_fonte})` : ""}
                    {String(prefill.budget_anterior) !== budgetText.trim() && (
                      <button
                        type="button"
                        onClick={() => setBudgetText(String(prefill.budget_anterior))}
                        className="font-semibold text-primary hover:underline"
                      >
                        usar
                      </button>
                    )}
                  </span>
                ) : modo === "reinicio" && prefill ? (
                  <span className="text-amber-300">Sem dado do mes anterior — informe manualmente.</span>
                ) : null}
              </div>
            </div>

            <div className="mt-4">
              <label className={labelCls}>
                Destinatarios{" "}
                {prefill?.supplier_nome ? (
                  <span className="normal-case text-muted/70">(contato de {prefill.supplier_nome})</span>
                ) : null}
              </label>
              <EmailChips value={destinatarios} onChange={setDestinatarios} disabled={!publisher} />
            </div>
            <div className="mt-3">
              <label className={labelCls}>
                CC <span className="normal-case text-muted/70">(opcional)</span>
              </label>
              <EmailChips value={cc} onChange={setCc} disabled={!publisher} />
            </div>

            <div className="mt-4">
              <label className={labelCls}>
                Observacao <span className="normal-case text-muted/70">(entra depois do IMPORTANT, antes dos criativos)</span>
              </label>
              <textarea
                value={observacao}
                onChange={(e) => setObservacao(e.target.value)}
                rows={3}
                className={`${inputCls} resize-y`}
                disabled={!publisher}
              />
            </div>
          </Section>

          {/* 4. Template */}
          <div className={`rounded-xl border border-border bg-surface ${!campanha ? "opacity-50" : ""}`}>
            <button
              type="button"
              onClick={() => setTplOpen((o) => !o)}
              disabled={!campanha}
              className="flex w-full items-center gap-2 px-5 py-4 text-left"
            >
              <StepBadge n={4} />
              <span className="text-sm font-semibold text-foreground">Template da oferta</span>
              {origem && <OrigemBadge origem={origem} />}
              {tplDirty && (
                <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                  editado so neste envio
                </span>
              )}
              <span className="ml-auto text-muted">
                {tplOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </span>
            </button>
            {tplOpen && campanha && (
              <div className="border-t border-border px-5 pb-5 pt-4">
                {tplErr && (
                  <p className="mb-3 flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {tplErr}
                  </p>
                )}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {TEMPLATE_KEYS.map((k: TemplateKey) => {
                    const multi = k === "important_note" || k === "creative_links";
                    return (
                      <div key={k} className={multi ? "sm:col-span-2" : ""}>
                        <label className={labelCls}>{TEMPLATE_FIELD_LABEL[k]}</label>
                        {multi ? (
                          <textarea
                            value={tpl[k] || ""}
                            onChange={(e) => setTpl((t) => ({ ...t, [k]: e.target.value }))}
                            rows={k === "creative_links" ? 3 : 2}
                            className={`${inputCls} resize-y font-mono text-xs`}
                          />
                        ) : (
                          <input
                            value={tpl[k] || ""}
                            onChange={(e) => setTpl((t) => ({ ...t, [k]: e.target.value }))}
                            className={inputCls}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleSalvarTemplate}
                    disabled={!canWrite || savingTpl}
                    title={!canWrite ? "Sem permissao de edicao nesta campanha" : undefined}
                    className="flex items-center gap-1.5 rounded-lg border border-primary/40 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/10 disabled:opacity-40"
                  >
                    {savingTpl ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                    Salvar como padrao da oferta
                  </button>
                  {tplDirty && (
                    <button
                      type="button"
                      onClick={() => setTpl(tplBase)}
                      className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-muted hover:text-foreground"
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> Desfazer edicoes
                    </button>
                  )}
                  {tplResp?.sugestao && origem !== "sugestao" && (
                    <button
                      type="button"
                      onClick={() => setTpl(normalizeTemplate(tplResp.sugestao))}
                      className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-muted hover:text-foreground"
                    >
                      <Sparkles className="h-3.5 w-3.5" /> Usar sugestao da campanha
                    </button>
                  )}
                  <span className="text-[11px] text-muted">Editar aqui vale so pra este envio, ate salvar.</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ================= Preview ================= */}
        <div className="lg:sticky lg:top-6 lg:self-start">
          <div className="overflow-hidden rounded-xl border border-border bg-surface">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <span className="text-xs font-semibold uppercase tracking-widest text-primary">Pre-visualizacao</span>
              <span className="text-[11px] text-muted">texto exato que sera copiado/enviado</span>
            </div>
            <div className="space-y-2 border-b border-border px-5 py-3 text-xs">
              <PreviewRow label="Para" value={destinatarios.join(", ")} placeholder="sem destinatario" />
              {cc.length > 0 && <PreviewRow label="Cc" value={cc.join(", ")} />}
              <div className="flex items-center gap-2">
                <span className="w-12 shrink-0 font-semibold text-muted">Assunto</span>
                <input
                  value={assuntoFinal}
                  onChange={(e) => {
                    setAssuntoTouched(true);
                    setAssunto(e.target.value);
                  }}
                  className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-primary/60"
                />
                {assuntoTouched && (
                  <button
                    type="button"
                    onClick={() => setAssuntoTouched(false)}
                    title="Voltar ao assunto padrao"
                    className="text-muted hover:text-foreground"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </button>
                )}
                <CopyIcon text={assuntoFinal} label="assunto" />
              </div>
            </div>
            <div className="relative">
              <div className="absolute right-3 top-3">
                <CopyIcon text={corpo} label="corpo" />
              </div>
              <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words px-5 py-4 font-sans text-[13px] leading-relaxed text-foreground">
                {corpo}
              </pre>
            </div>

            <div className="space-y-3 border-t border-border bg-background/40 px-5 py-4">
              {actionErr && (
                <p className="flex items-start gap-1.5 text-xs text-red-400">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {actionErr}
                </p>
              )}
              {mailtoLong && (
                <p className="flex items-start gap-1.5 text-[11px] text-amber-300">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  Corpo longo: alguns clientes de e-mail truncam o mailto. Se cortar, prefira &quot;Copiar e
                  registrar&quot;.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleCopiar}
                  disabled={!!busy || !publisher || !canWrite}
                  className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-primary/90 disabled:opacity-40"
                >
                  {busy === "copiar" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
                  Copiar e registrar
                </button>
                <button
                  type="button"
                  onClick={handleMailto}
                  disabled={!!busy || !publisher || !canWrite}
                  className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-primary/40 disabled:opacity-40"
                >
                  {busy === "mailto" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                  Abrir no e-mail
                </button>
                <span title="Envio direto em breve" className="inline-flex">
                  <button
                    type="button"
                    disabled
                    className="flex cursor-not-allowed items-center gap-2 rounded-lg border border-dashed border-border px-4 py-2 text-sm text-muted opacity-60"
                  >
                    <Send className="h-4 w-4" />
                    Enviar
                    <span className="rounded bg-white/5 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider">
                      em breve
                    </span>
                  </button>
                </span>
              </div>
              <p className="text-[11px] text-muted">
                &quot;Copiar e registrar&quot; copia assunto + corpo (assunto na 1a linha). Os icones de copiar acima
                copiam so o pedaco, sem registrar.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function StepBadge({ n }: { n: number }) {
  return (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-bold text-primary">
      {n}
    </span>
  );
}

function Section({
  step,
  title,
  disabled,
  children
}: {
  step: number;
  title: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={`rounded-xl border border-border bg-surface px-5 py-4 transition-opacity ${disabled ? "opacity-50" : ""}`}>
      <div className="mb-3 flex items-center gap-2">
        <StepBadge n={step} />
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function OrigemBadge({ origem }: { origem: OfertaTemplateResponse["origem"] }) {
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

function PreviewRow({ label, value, placeholder }: { label: string; value: string; placeholder?: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="w-12 shrink-0 font-semibold text-muted">{label}</span>
      <span className={`min-w-0 flex-1 break-all ${value ? "text-foreground" : "italic text-muted/60"}`}>
        {value || placeholder}
      </span>
    </div>
  );
}

function CopyIcon({ text, label }: { text: string; label: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      title={`Copiar ${label} (sem registrar)`}
      onClick={() => {
        copyToClipboard(text).then((r) => {
          setOk(r);
          if (r) setTimeout(() => setOk(false), 1500);
        });
      }}
      className="rounded-md border border-border bg-background/80 p-1.5 text-muted transition-colors hover:text-foreground"
    >
      {ok ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

/** Input de e-mails em chips: Enter, virgula, ponto-e-virgula ou blur confirmam; colar lista funciona. */
function EmailChips({
  value,
  onChange,
  disabled
}: {
  value: string[];
  onChange: (v: string[]) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const commit = (raw: string) => {
    const add = splitEmails(raw);
    if (!add.length) return;
    const lower = new Set(value.map((v) => v.toLowerCase()));
    onChange([...value, ...add.filter((a) => !lower.has(a.toLowerCase()))]);
    setDraft("");
  };

  return (
    <div
      onClick={() => inputRef.current?.focus()}
      className={`flex min-h-[40px] w-full flex-wrap items-center gap-1.5 rounded-lg border border-border bg-background px-2 py-1.5 transition-colors focus-within:border-primary/60 ${
        disabled ? "pointer-events-none opacity-50" : "cursor-text"
      }`}
    >
      {value.map((e) => {
        const ok = looksLikeEmail(e);
        return (
          <span
            key={e}
            className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
              ok ? "border-border bg-white/5 text-foreground" : "border-red-500/50 bg-red-500/10 text-red-300"
            }`}
            title={ok ? undefined : "E-mail invalido"}
          >
            {e}
            <button
              type="button"
              onClick={(ev) => {
                ev.stopPropagation();
                onChange(value.filter((v) => v !== e));
              }}
              className="text-muted hover:text-foreground"
              aria-label={`Remover ${e}`}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        );
      })}
      <input
        ref={inputRef}
        value={draft}
        disabled={disabled}
        onChange={(e) => {
          const v = e.target.value;
          if (/[,;\s]$/.test(v)) commit(v);
          else setDraft(v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit(draft);
          } else if (e.key === "Backspace" && !draft && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        onPaste={(e) => {
          const text = e.clipboardData.getData("text");
          if (/[,;\s]/.test(text.trim())) {
            e.preventDefault();
            commit(draft + text);
          }
        }}
        onBlur={() => commit(draft)}
        placeholder={value.length ? "" : "email@exemplo.com, outro@exemplo.com"}
        className="min-w-[160px] flex-1 bg-transparent px-1 py-0.5 text-sm text-foreground outline-none placeholder:text-muted/60"
      />
    </div>
  );
}
