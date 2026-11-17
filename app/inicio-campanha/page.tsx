"use client";

// Inicio de Campanha — composer do e-mail de oferta pro(s) publisher(s).
//
// v2 (slug `inicio-campanha-v2`): a tela e so "quem recebe e quanto".
// - Template da oferta e SOMENTE LEITURA aqui (edita no cadastro da campanha,
//   secao "E-mail de oferta (template)"). Fonte: GET /campanhas/{id}/oferta-template.
// - af_prt e FIXO da campanha (resposta do oferta-template; fallback
//   campanhas.af_prt do GET da campanha). Sem input.
// - PO: default da oferta (template.po | sugestao.po), fallback po vigente do
//   publisher (prefill); editavel POR publisher (override), com "voltar ao padrao".
// - Selecao multipla de publishers: cada um vira um card com destinatarios/CC/
//   PO/budget/observacao proprios + prefill proprio. Preview com abas.
// - Acoes por publisher (Copiar e registrar | mailto) + "Registrar todos"
//   (1 POST por publisher, canal=manual, pula os ja registrados).
// - Modo (nova/reinicio) e unico pro lote.
//
// Status default fica no backend (nova -> oferecido, reinicio -> enviado).

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
  RotateCcw,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  X,
  Sparkles,
  History,
  Info,
  Pencil,
  ListChecks,
  Lock
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { OrigemSelo } from "@/components/oferta-template-section";
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
  effectiveTemplate,
  friendlyError,
  getInicioPrefill,
  getOfertaTemplate,
  looksLikeEmail,
  MAILTO_WARN_LEN,
  parseBudgetEvents,
  splitEmails,
  STATUS_LABEL,
  TEMPLATE_FIELD_LABEL,
  TEMPLATE_KEYS,
  type Envio,
  type EnvioCanal,
  type EnvioModo,
  type InicioPrefill,
  type OfertaTemplateResponse
} from "@/lib/inicio-campanha";
import type { Campanha, CampanhaMonthsAvailable, CampanhaPublisher } from "@/types";

const inputCls =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted/60 focus:border-primary/60 disabled:opacity-50";
const labelCls = "mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted";

// ---- Estado por publisher ----

interface Registro {
  envio: Envio | null;
  canal: EnvioCanal;
  copied?: boolean;
}

interface PubDraft {
  prefill: InicioPrefill | null;
  loading: boolean;
  err: string;
  /** null = usa o PO padrao (oferta -> prefill). String = especifico deste publisher. */
  poOverride: string | null;
  destinatarios: string[];
  destTouched: boolean;
  cc: string[];
  budgetText: string;
  budgetTouched: boolean;
  observacao: string;
  registro: Registro | null;
  busy: EnvioCanal | null;
  actionErr: string;
}

function newDraft(): PubDraft {
  return {
    prefill: null,
    loading: true,
    err: "",
    poOverride: null,
    destinatarios: [],
    destTouched: false,
    cc: [],
    budgetText: "",
    budgetTouched: false,
    observacao: "",
    registro: null,
    busy: null,
    actionErr: ""
  };
}

function pubKey(p: CampanhaPublisher, i: number): string {
  return p.id || `idx:${i}`;
}

interface LoteResultado {
  key: string;
  nome: string;
  ok: boolean;
  msg: string;
}

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

  // ---- Template (read-only) ----
  const [tplResp, setTplResp] = useState<OfertaTemplateResponse | null>(null);
  const [tplLoading, setTplLoading] = useState(false);
  const [tplErr, setTplErr] = useState("");
  const [tplOpen, setTplOpen] = useState(false);

  // ---- Publishers / lote ----
  const [selected, setSelected] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, PubDraft>>({});
  const [activeKey, setActiveKey] = useState<string>("");
  const [modo, setModo] = useState<EnvioModo>("nova");
  const modoRef = useRef<EnvioModo>("nova");
  modoRef.current = modo;
  const [assunto, setAssunto] = useState("");
  const [assuntoTouched, setAssuntoTouched] = useState(false);
  const [lote, setLote] = useState<LoteResultado[] | null>(null);
  const [loteBusy, setLoteBusy] = useState(false);

  // Geracao da campanha: resposta de prefill atrasada de outra campanha e descartada.
  const genRef = useRef(0);
  const requested = useRef<Set<string>>(new Set());

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
    genRef.current += 1;
    requested.current = new Set();
    setSelected([]);
    setDrafts({});
    setActiveKey("");
    setLote(null);
    setCampanha(null);
    setTplResp(null);
    setTplErr("");
    setAssuntoTouched(false);
    if (!campanhaId) return;
    let cancelled = false;
    setLoadingCampanha(true);
    setTplLoading(true);
    (async () => {
      try {
        const c: Campanha = await apiFetch(`/campanhas/${campanhaId}`);
        if (cancelled) return;
        setCampanha(c);
        const mr = (c.mes_referencia || "").slice(0, 7);
        if (mr && mr !== month) setMonth(mr);
        if (initialPublisher && campanhaId === initialCampanha) {
          const idx = (c.publishers || []).findIndex((x) => x.id === initialPublisher);
          if (idx >= 0) {
            const k = pubKey(c.publishers![idx], idx);
            setSelected([k]);
            setActiveKey(k);
          }
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
        if (!cancelled) setTplResp(r);
      } catch (err) {
        if (!cancelled) setTplErr(friendlyError(err, "Template da oferta indisponivel (backend em implantacao)."));
      } finally {
        if (!cancelled) setTplLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campanhaId]);

  const publishers: CampanhaPublisher[] = useMemo(() => campanha?.publishers || [], [campanha]);
  const pubByKey = useMemo(() => {
    const m = new Map<string, CampanhaPublisher>();
    publishers.forEach((p, i) => m.set(pubKey(p, i), p));
    return m;
  }, [publishers]);
  // Selecionados na ordem do cadastro
  const selectedOrdered = useMemo(
    () => publishers.map((p, i) => pubKey(p, i)).filter((k) => selected.includes(k)),
    [publishers, selected]
  );

  const tpl = useMemo(() => effectiveTemplate(tplResp), [tplResp]);
  const afPrtFixo = ((tplResp?.af_prt ?? campanha?.af_prt) || "").trim();
  const poPadraoOferta = (tpl.po || "").trim();

  function patchDraft(key: string, patch: Partial<PubDraft> | ((d: PubDraft) => Partial<PubDraft>)) {
    setDrafts((all) => {
      const cur = all[key];
      if (!cur) return all;
      const p = typeof patch === "function" ? patch(cur) : patch;
      return { ...all, [key]: { ...cur, ...p } };
    });
  }

  // Prefill de cada publisher recem-selecionado (1x por publisher/campanha).
  useEffect(() => {
    if (!campanhaId || !campanha) return;
    const gen = genRef.current;
    for (const key of selected) {
      if (requested.current.has(key)) continue;
      requested.current.add(key);
      const pub = pubByKey.get(key);
      setDrafts((all) => (all[key] ? all : { ...all, [key]: newDraft() }));
      if (!pub?.id) {
        patchDraftSafe(gen, key, {
          loading: false,
          err: "Publisher sem id no cadastro — preencha destinatarios e PO manualmente."
        });
        continue;
      }
      const pubId = pub.id;
      (async () => {
        try {
          const p = await getInicioPrefill(campanhaId, pubId);
          if (genRef.current !== gen) return;
          setDrafts((all) => {
            const cur = all[key];
            if (!cur) return all;
            const next: PubDraft = { ...cur, prefill: p, loading: false, err: "" };
            if (!cur.destTouched) next.destinatarios = p?.destinatarios || [];
            if (
              modoRef.current === "reinicio" &&
              !cur.budgetTouched &&
              !cur.budgetText.trim() &&
              p?.budget_anterior
            ) {
              next.budgetText = String(p.budget_anterior);
            }
            return { ...all, [key]: next };
          });
        } catch (err) {
          if (genRef.current !== gen) return;
          patchDraftSafe(gen, key, {
            loading: false,
            err: friendlyError(err, "Nao deu pra pre-preencher este publisher. Preencha manualmente.")
          });
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, campanha, campanhaId, pubByKey]);

  function patchDraftSafe(gen: number, key: string, patch: Partial<PubDraft>) {
    if (genRef.current !== gen) return;
    setDrafts((all) => (all[key] ? { ...all, [key]: { ...all[key], ...patch } } : all));
  }

  // Reinicio: preenche o budget vazio de TODAS as linhas com o do mes anterior.
  useEffect(() => {
    if (modo !== "reinicio") return;
    setDrafts((all) => {
      let changed = false;
      const out: Record<string, PubDraft> = {};
      for (const [k, d] of Object.entries(all)) {
        if (!d.budgetText.trim() && d.prefill?.budget_anterior) {
          out[k] = { ...d, budgetText: String(d.prefill.budget_anterior) };
          changed = true;
        } else out[k] = d;
      }
      return changed ? out : all;
    });
  }, [modo]);

  // Aba ativa sempre aponta pra um selecionado
  useEffect(() => {
    if (selectedOrdered.length === 0) {
      if (activeKey) setActiveKey("");
    } else if (!selectedOrdered.includes(activeKey)) {
      setActiveKey(selectedOrdered[0]);
    }
  }, [selectedOrdered, activeKey]);

  function toggleSelect(key: string) {
    setLote(null);
    setSelected((s) => (s.includes(key) ? s.filter((k) => k !== key) : [...s, key]));
  }
  const allKeys = useMemo(() => publishers.map((p, i) => pubKey(p, i)), [publishers]);
  const allSelected = allKeys.length > 0 && allKeys.every((k) => selected.includes(k));
  function toggleAll() {
    setLote(null);
    setSelected(allSelected ? [] : allKeys);
  }

  const canWrite = !!campanha && (can("campanhas.edit") || (!!user && campanha.owner_id === user.id));
  const assuntoFinal = assuntoTouched ? assunto : defaultAssunto(tpl.offer_name);

  function poFor(d: PubDraft | undefined): string {
    if (!d) return poPadraoOferta;
    if (d.poOverride !== null) return d.poOverride;
    return poPadraoOferta || (d.prefill?.po ?? "");
  }

  function corpoFor(d: PubDraft | undefined): string {
    return buildCorpo({
      template: tpl,
      budgetEvents: parseBudgetEvents(d?.budgetText),
      po: poFor(d),
      afPrt: afPrtFixo,
      observacao: d?.observacao ?? ""
    });
  }

  function validate(key: string, canal: EnvioCanal): string | null {
    const d = drafts[key];
    const pub = pubByKey.get(key);
    if (!campanha) return "Escolha a campanha.";
    if (!pub || !d) return "Publisher nao selecionado.";
    if (!canWrite) return "Sem permissao de edicao nesta campanha.";
    if (tplErr || !tplResp) return "Template da oferta indisponivel — confira no cadastro da campanha.";
    const be = parseBudgetEvents(d.budgetText);
    if (d.budgetText.trim() && be === null) return "Budget Events invalido — use um numero (ex: 500).";
    if (modo === "reinicio" && !be) return "No reinicio o Budget Events e obrigatorio (inteiro > 0).";
    const bad = [...d.destinatarios, ...d.cc].filter((e) => !looksLikeEmail(e));
    if (bad.length) return `E-mail invalido: ${bad.join(", ")}`;
    if (canal === "mailto" && d.destinatarios.length === 0) return "Informe ao menos um destinatario pro mailto.";
    return null;
  }

  function registrar(key: string, canal: EnvioCanal): Promise<Envio> {
    const d = drafts[key];
    const pub = pubByKey.get(key)!;
    const po = poFor(d).trim();
    return createEnvio(campanha!.id, {
      publisher_id: pub.id || null,
      publisher_nome: pub.nome,
      supplier_id: d.prefill?.supplier_id ?? pub.supplier_id ?? null,
      modo,
      destinatarios: d.destinatarios,
      cc: d.cc,
      assunto: assuntoFinal,
      corpo: corpoFor(d),
      po: po || null,
      af_prt: afPrtFixo || null,
      budget_events: parseBudgetEvents(d.budgetText),
      observacao: d.observacao.trim() || null,
      canal
    });
  }

  function handleCopiar(key: string) {
    const d = drafts[key];
    if (!d) return;
    const text = `${assuntoFinal}\n\n${corpoFor(d)}`;
    // Ja registrado: so copia (re-registro e explicito, via "Registrar de novo").
    if (d.registro) {
      copyToClipboard(text).then((ok) =>
        ok ? toast.success("Copiado (sem novo registro).") : toast.error("A copia falhou.")
      );
      return;
    }
    const err = validate(key, "copiar");
    patchDraft(key, { actionErr: err || "" });
    if (err) return;
    // Copia SINCRONO no clique (antes do await) — user activation no Safari.
    const copyP = copyToClipboard(text);
    patchDraft(key, { busy: "copiar" });
    (async () => {
      const copied = await copyP;
      try {
        const envio = await registrar(key, "copiar");
        patchDraft(key, { registro: { envio, canal: "copiar", copied }, busy: null });
        toast.success(copied ? "Copiado e registrado no acompanhamento." : "Registrado — mas a copia falhou.");
      } catch (e) {
        const msg = friendlyError(e, "Falha ao registrar o envio.");
        patchDraft(key, { busy: null, actionErr: copied ? `Copiado, mas NAO registrado: ${msg}` : msg });
        toast.error(copied ? "Copiado, mas nao registrado." : msg);
      }
    })();
  }

  function handleMailto(key: string) {
    const d = drafts[key];
    if (!d) return;
    const url = buildMailto({ to: d.destinatarios, cc: d.cc, subject: assuntoFinal, body: corpoFor(d) });
    if (d.registro) {
      window.location.href = url;
      return;
    }
    const err = validate(key, "mailto");
    patchDraft(key, { actionErr: err || "" });
    if (err) return;
    window.location.href = url;
    patchDraft(key, { busy: "mailto" });
    (async () => {
      try {
        const envio = await registrar(key, "mailto");
        patchDraft(key, { registro: { envio, canal: "mailto" }, busy: null });
        toast.success("E-mail aberto e envio registrado.");
      } catch (e) {
        const msg = friendlyError(e, "Falha ao registrar o envio.");
        patchDraft(key, { busy: null, actionErr: `E-mail aberto, mas NAO registrado: ${msg}` });
        toast.error("E-mail aberto, mas nao registrado.");
      }
    })();
  }

  async function handleRegistrarTodos() {
    if (!campanha) return;
    setLoteBusy(true);
    const out: LoteResultado[] = [];
    for (const key of selectedOrdered) {
      const pub = pubByKey.get(key);
      const d = drafts[key];
      const nome = pub?.nome || key;
      if (d?.registro) {
        out.push({ key, nome, ok: true, msg: "ja registrado — pulado" });
        continue;
      }
      if (d?.loading) {
        out.push({ key, nome, ok: false, msg: "ainda carregando o prefill — tente de novo" });
        continue;
      }
      const err = validate(key, "manual");
      if (err) {
        out.push({ key, nome, ok: false, msg: err });
        patchDraft(key, { actionErr: err });
        continue;
      }
      try {
        const envio = await registrar(key, "manual");
        patchDraft(key, { registro: { envio, canal: "manual" }, actionErr: "" });
        out.push({
          key,
          nome,
          ok: true,
          msg: `registrado${envio?.status ? ` como ${STATUS_LABEL[envio.status] || envio.status}` : ""}`
        });
      } catch (e) {
        const msg = friendlyError(e, "falha ao registrar");
        patchDraft(key, { actionErr: msg });
        out.push({ key, nome, ok: false, msg });
      }
    }
    setLote(out);
    setLoteBusy(false);
    const okN = out.filter((r) => r.ok && !r.msg.startsWith("ja ")).length;
    const failN = out.filter((r) => !r.ok).length;
    if (failN) toast.error(`${okN} registrado(s), ${failN} com problema.`);
    else toast.success(`${okN} envio(s) registrado(s).`);
  }

  const origem = tplResp?.origem;
  const activeDraft = activeKey ? drafts[activeKey] : undefined;
  const activePub = activeKey ? pubByKey.get(activeKey) : undefined;
  const activeCorpo = corpoFor(activeDraft);
  const activeMailtoLong =
    !!activeDraft &&
    buildMailto({ to: activeDraft.destinatarios, cc: activeDraft.cc, subject: assuntoFinal, body: activeCorpo })
      .length > MAILTO_WARN_LEN;
  const pendentes = selectedOrdered.filter((k) => !drafts[k]?.registro).length;
  const editHref = campanha ? `/campanhas/${campanha.id}?editar=1&secao=oferta-template` : "#";
  const actionsBlocked = !!tplErr || !tplResp;

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-widest text-primary">Inicio Campanha</h4>
          <h1 className="text-2xl font-semibold text-foreground">Oferta pros publishers</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Escolha quem recebe e quanto. O texto da oferta vem do cadastro da campanha; aqui voce ajusta
            destinatarios, PO e budget por publisher. Cada envio fica registrado no acompanhamento.
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

          {/* 2. Oferta (read-only) */}
          <section
            className={`rounded-xl border border-border bg-surface transition-opacity ${!campanha ? "opacity-50" : ""}`}
          >
            <div className="flex flex-wrap items-center gap-2 px-5 pt-4">
              <StepBadge n={2} />
              <h2 className="text-sm font-semibold text-foreground">Oferta</h2>
              {origem && <OrigemSelo origem={origem} />}
              <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted">
                <Lock className="h-3 w-3" /> somente leitura
              </span>
              {campanha && (
                <Link
                  href={editHref}
                  className="ml-auto flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                >
                  <Pencil className="h-3.5 w-3.5" /> Editar no cadastro da oferta
                </Link>
              )}
            </div>
            <div className="px-5 pb-4 pt-3">
              {!campanha ? (
                <p className="text-xs text-muted">Escolha a campanha.</p>
              ) : tplLoading ? (
                <p className="flex items-center gap-1.5 text-xs text-muted">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando template...
                </p>
              ) : tplErr ? (
                <p className="flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    {tplErr} Sem o template nao da pra montar o e-mail.{" "}
                    <Link href={editHref} className="font-semibold underline">
                      Abrir o cadastro
                    </Link>
                  </span>
                </p>
              ) : (
                <>
                  <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
                    <SummaryItem label="Offer" value={tpl.offer_name} />
                    <SummaryItem
                      label="af_prt (fixo)"
                      value={afPrtFixo}
                      empty={
                        <span className="text-amber-300">
                          Oferta sem af_prt —{" "}
                          <Link href={editHref} className="underline">
                            preencha no cadastro
                          </Link>
                        </span>
                      }
                    />
                    <SummaryItem
                      label="PO padrao"
                      value={poPadraoOferta}
                      empty={<span className="text-muted/70">sem PO na oferta — usa o vigente de cada publisher</span>}
                    />
                  </dl>
                  {origem && origem !== "proprio" && (
                    <p className="mt-3 flex items-start gap-1.5 text-[11px] text-sky-300">
                      <Info className="mt-0.5 h-3 w-3 shrink-0" />
                      {origem === "mes_anterior"
                        ? "Template herdado do mes anterior — salve no cadastro pra fixar."
                        : "Sugestao montada com os dados da campanha — revise e salve no cadastro."}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => setTplOpen((o) => !o)}
                    className="mt-3 flex items-center gap-1 text-[11px] font-semibold text-muted hover:text-foreground"
                  >
                    {tplOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    {tplOpen ? "Esconder campos" : "Ver todos os campos"}
                  </button>
                  {tplOpen && (
                    <dl className="mt-2 space-y-1.5 rounded-lg border border-border bg-background/50 px-3 py-2.5 text-xs">
                      {TEMPLATE_KEYS.map((k) => (
                        <div key={k} className="grid grid-cols-[150px_minmax(0,1fr)] gap-2">
                          <dt className="text-muted">{TEMPLATE_FIELD_LABEL[k]}</dt>
                          <dd
                            className={`whitespace-pre-wrap break-words ${
                              tpl[k] ? "text-foreground" : "italic text-muted/50"
                            }`}
                          >
                            {tpl[k] || "vazio (some do e-mail)"}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </>
              )}
            </div>
          </section>

          {/* 3. Publishers + modo */}
          <Section step={3} title="Publishers e modo" disabled={!campanha}>
            {!campanha ? (
              <p className="text-xs text-muted">Escolha a campanha antes.</p>
            ) : publishers.length === 0 ? (
              <p className="text-xs text-muted">Campanha sem publishers cadastrados.</p>
            ) : (
              <>
                <label className="mb-2 flex cursor-pointer items-center gap-2 text-xs font-semibold text-foreground">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="h-4 w-4 accent-primary"
                  />
                  Selecionar todos ({publishers.length})
                </label>
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {publishers.map((p, i) => {
                    const k = pubKey(p, i);
                    const on = selected.includes(k);
                    const reg = drafts[k]?.registro;
                    return (
                      <label
                        key={k}
                        className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                          on ? "border-primary/50 bg-primary/10 text-foreground" : "border-border text-muted hover:text-foreground"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => toggleSelect(k)}
                          className="h-4 w-4 accent-primary"
                        />
                        <span className="min-w-0 flex-1 truncate">{p.nome}</span>
                        {reg && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />}
                      </label>
                    );
                  })}
                </div>
              </>
            )}

            <div className="mt-4 inline-flex rounded-lg border border-border bg-background p-0.5">
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
                  disabled={!campanha}
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
              Vale pro lote todo. Registro entra como{" "}
              <strong className="text-foreground">{modo === "nova" ? "Oferecido" : "Enviado"}</strong> — da pra
              trocar depois no acompanhamento.
            </p>
          </Section>

          {/* 4. Por publisher */}
          {selectedOrdered.map((k, idx) => {
            const pub = pubByKey.get(k);
            const d = drafts[k];
            if (!pub) return null;
            return (
              <PublisherCard
                key={k}
                step={idx === 0 ? 4 : undefined}
                nome={pub.nome}
                draft={d}
                active={k === activeKey}
                modo={modo}
                poPadraoOferta={poPadraoOferta}
                poEfetivo={poFor(d)}
                onFocus={() => setActiveKey(k)}
                onPatch={(p) => patchDraft(k, p)}
                onRemove={() => toggleSelect(k)}
              />
            );
          })}
        </div>

        {/* ================= Preview ================= */}
        <div className="lg:sticky lg:top-6 lg:self-start">
          <div className="overflow-hidden rounded-xl border border-border bg-surface">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <span className="text-xs font-semibold uppercase tracking-widest text-primary">Pre-visualizacao</span>
              <span className="text-[11px] text-muted">texto exato que sera copiado/enviado</span>
            </div>

            {selectedOrdered.length > 1 && (
              <div className="flex gap-1 overflow-x-auto border-b border-border px-3 py-2">
                {selectedOrdered.map((k) => {
                  const reg = !!drafts[k]?.registro;
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setActiveKey(k)}
                      className={`flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1 text-xs transition-colors ${
                        k === activeKey
                          ? "bg-primary/15 font-semibold text-primary"
                          : "text-muted hover:bg-white/5 hover:text-foreground"
                      }`}
                    >
                      {reg && <CheckCircle2 className="h-3 w-3 text-emerald-400" />}
                      {pubByKey.get(k)?.nome || k}
                    </button>
                  );
                })}
              </div>
            )}

            {!activePub || !activeDraft ? (
              <p className="px-5 py-10 text-center text-sm text-muted">
                {campanha ? "Selecione ao menos um publisher." : "Escolha a campanha e os publishers."}
              </p>
            ) : (
              <>
                <div className="space-y-2 border-b border-border px-5 py-3 text-xs">
                  <PreviewRow
                    label="Para"
                    value={activeDraft.destinatarios.join(", ")}
                    placeholder="sem destinatario"
                  />
                  {activeDraft.cc.length > 0 && <PreviewRow label="Cc" value={activeDraft.cc.join(", ")} />}
                  <div className="flex items-center gap-2">
                    <span className="w-12 shrink-0 font-semibold text-muted">Assunto</span>
                    <input
                      value={assuntoFinal}
                      onChange={(e) => {
                        setAssuntoTouched(true);
                        setAssunto(e.target.value);
                      }}
                      title="Assunto unico pro lote"
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
                    <CopyIcon text={activeCorpo} label="corpo" />
                  </div>
                  <pre className="max-h-[55vh] overflow-auto whitespace-pre-wrap break-words px-5 py-4 font-sans text-[13px] leading-relaxed text-foreground">
                    {activeCorpo}
                  </pre>
                </div>

                <div className="space-y-3 border-t border-border bg-background/40 px-5 py-4">
                  {activeDraft.registro && (
                    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs">
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                      <span className="flex-1 text-foreground">
                        {activePub.nome}: registrado
                        {activeDraft.registro.envio?.status
                          ? ` como "${STATUS_LABEL[activeDraft.registro.envio.status] || activeDraft.registro.envio.status}"`
                          : ""}{" "}
                        ({activeDraft.registro.canal}). Os botoes agora so copiam/abrem, sem novo registro.
                      </span>
                      <button
                        type="button"
                        onClick={() => patchDraft(activeKey, { registro: null })}
                        className="font-semibold text-emerald-300 hover:underline"
                      >
                        Registrar de novo
                      </button>
                    </div>
                  )}
                  {activeDraft.actionErr && (
                    <p className="flex items-start gap-1.5 text-xs text-red-400">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {activeDraft.actionErr}
                    </p>
                  )}
                  {activeMailtoLong && (
                    <p className="flex items-start gap-1.5 text-[11px] text-amber-300">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                      Corpo longo: alguns clientes de e-mail truncam o mailto. Se cortar, prefira &quot;Copiar e
                      registrar&quot;.
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => handleCopiar(activeKey)}
                      disabled={!!activeDraft.busy || loteBusy || !canWrite || actionsBlocked}
                      className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-primary/90 disabled:opacity-40"
                    >
                      {activeDraft.busy === "copiar" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                      {activeDraft.registro ? "Copiar" : "Copiar e registrar"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMailto(activeKey)}
                      disabled={!!activeDraft.busy || loteBusy || !canWrite || actionsBlocked}
                      className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-primary/40 disabled:opacity-40"
                    >
                      {activeDraft.busy === "mailto" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Mail className="h-4 w-4" />
                      )}
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
                    Botoes acima agem so no publisher da aba ({activePub.nome}). &quot;Copiar e registrar&quot; copia
                    assunto + corpo (assunto na 1a linha).
                  </p>
                </div>

                {selectedOrdered.length > 1 && (
                  <div className="space-y-2 border-t border-border px-5 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={handleRegistrarTodos}
                        disabled={loteBusy || !canWrite || actionsBlocked || pendentes === 0}
                        className="flex items-center gap-2 rounded-lg border border-primary/40 px-4 py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary/10 disabled:opacity-40"
                      >
                        {loteBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListChecks className="h-4 w-4" />}
                        Registrar todos ({pendentes})
                      </button>
                      <span className="text-[11px] text-muted">
                        So registra no acompanhamento (canal &quot;manual&quot;), sem copiar nem abrir e-mail. Pula
                        os ja registrados.
                      </span>
                    </div>
                    {lote && (
                      <ul className="space-y-1 text-xs">
                        {lote.map((r) => (
                          <li key={r.key} className="flex items-start gap-1.5">
                            {r.ok ? (
                              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                            ) : (
                              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
                            )}
                            <span>
                              <strong className="text-foreground">{r.nome}</strong>{" "}
                              <span className={r.ok ? "text-muted" : "text-red-300"}>— {r.msg}</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {selectedOrdered.some((k) => drafts[k]?.registro) && (
                  <div className="border-t border-border px-5 py-3 text-right">
                    <Link
                      href="/inicio-campanha/envios"
                      className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                    >
                      Ver acompanhamento <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function SummaryItem({
  label,
  value,
  empty
}: {
  label: string;
  value: string | null | undefined;
  empty?: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-foreground">
        {value ? value : empty ?? <span className="italic text-muted/60">—</span>}
      </dd>
    </div>
  );
}

function PublisherCard({
  step,
  nome,
  draft,
  active,
  modo,
  poPadraoOferta,
  poEfetivo,
  onFocus,
  onPatch,
  onRemove
}: {
  step?: number;
  nome: string;
  draft: PubDraft | undefined;
  active: boolean;
  modo: EnvioModo;
  poPadraoOferta: string;
  poEfetivo: string;
  onFocus: () => void;
  onPatch: (p: Partial<PubDraft>) => void;
  onRemove: () => void;
}) {
  if (!draft) {
    return (
      <div className="rounded-xl border border-border bg-surface px-5 py-4 text-xs text-muted">
        <Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" /> {nome}
      </div>
    );
  }
  const d = draft;
  const prefill = d.prefill;
  const budgetEvents = parseBudgetEvents(d.budgetText);
  const budgetInvalid = d.budgetText.trim() !== "" && budgetEvents === null;
  const budgetMissing = modo === "reinicio" && !budgetEvents;
  const poCustom = d.poOverride !== null;
  const poDefault = poPadraoOferta || prefill?.po || "";
  const poDefaultFonte = poPadraoOferta ? "padrao da oferta" : prefill?.po ? "PO vigente do publisher" : "";

  return (
    <section
      onFocusCapture={onFocus}
      onClick={onFocus}
      className={`rounded-xl border bg-surface px-5 py-4 transition-colors ${
        active ? "border-primary/50" : "border-border"
      }`}
    >
      <div className="mb-3 flex items-center gap-2">
        {step ? <StepBadge n={step} /> : <span className="w-5" />}
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{nome}</h2>
        {d.loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted" />}
        {d.registro && (
          <span className="flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
            <CheckCircle2 className="h-3 w-3" /> registrado
          </span>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          title="Tirar do lote"
          className="text-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {d.err && (
        <p className="mb-3 flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {d.err}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={labelCls}>
            PO {prefill?.moeda ? <span className="normal-case text-muted/70">({prefill.moeda})</span> : null}
          </label>
          <input
            value={poEfetivo}
            onChange={(e) => onPatch({ poOverride: e.target.value })}
            placeholder={poDefault ? poDefault : "sem PO — informe (ou some do e-mail)"}
            className={`${inputCls} ${poCustom ? "border-amber-500/50" : ""}`}
          />
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
            {poCustom ? (
              <>
                <span className="text-amber-300">especifico deste publisher</span>
                <button
                  type="button"
                  onClick={() => onPatch({ poOverride: null })}
                  className="flex items-center gap-1 font-semibold text-primary hover:underline"
                >
                  <RotateCcw className="h-3 w-3" /> voltar ao padrao{poDefault ? ` (${poDefault})` : ""}
                </button>
              </>
            ) : poDefaultFonte ? (
              <span className="text-muted">{poDefaultFonte}</span>
            ) : null}
          </div>
        </div>
        <div>
          <label className={labelCls}>
            Budget Events{" "}
            {modo === "reinicio" ? (
              <span className="normal-case text-primary">(obrigatorio)</span>
            ) : (
              <span className="normal-case text-muted/70">(opcional)</span>
            )}
          </label>
          <input
            value={d.budgetText}
            onChange={(e) => onPatch({ budgetText: e.target.value, budgetTouched: true })}
            placeholder="ex: 500"
            className={`${inputCls} ${budgetInvalid || (budgetMissing && d.budgetTouched) ? "border-red-500/60" : ""}`}
          />
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
            {budgetInvalid && <span className="text-red-400">Nao achei um numero inteiro.</span>}
            {prefill?.budget_anterior ? (
              <span className="flex items-center gap-1 text-muted">
                <Info className="h-3 w-3" />
                Rodou <strong className="text-foreground">{prefill.budget_anterior}</strong> no mes anterior
                {prefill.budget_anterior_fonte ? ` (${prefill.budget_anterior_fonte})` : ""}
                {String(prefill.budget_anterior) !== d.budgetText.trim() && (
                  <button
                    type="button"
                    onClick={() => onPatch({ budgetText: String(prefill.budget_anterior) })}
                    className="font-semibold text-primary hover:underline"
                  >
                    usar
                  </button>
                )}
              </span>
            ) : modo === "reinicio" && prefill ? (
              <span className="text-amber-300">Sem dado do mes anterior — informe.</span>
            ) : !budgetEvents && modo === "nova" ? (
              <span className="text-muted/70">vazio some do e-mail</span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-4">
        <label className={labelCls}>
          Destinatarios{" "}
          {prefill?.supplier_nome ? (
            <span className="normal-case text-muted/70">(contato de {prefill.supplier_nome})</span>
          ) : null}
        </label>
        <EmailChips
          value={d.destinatarios}
          onChange={(v) => onPatch({ destinatarios: v, destTouched: true })}
        />
      </div>
      <div className="mt-3">
        <label className={labelCls}>
          CC <span className="normal-case text-muted/70">(opcional)</span>
        </label>
        <EmailChips value={d.cc} onChange={(v) => onPatch({ cc: v })} />
      </div>

      <div className="mt-4">
        <label className={labelCls}>
          Observacao <span className="normal-case text-muted/70">(depois do IMPORTANT, antes dos criativos)</span>
        </label>
        <textarea
          value={d.observacao}
          onChange={(e) => onPatch({ observacao: e.target.value })}
          rows={2}
          className={`${inputCls} resize-y`}
        />
      </div>
    </section>
  );
}

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
