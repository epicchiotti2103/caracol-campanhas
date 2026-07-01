"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Loader2,
  AlertCircle,
  Plus,
  Trash2,
  Ban,
  RotateCcw,
  ChevronDown,
  Search
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/lib/toast-context";
import { DeactivateMediaSourceModal } from "@/components/deactivate-media-source-modal";
import { todayIso } from "@/components/reason-date-modal";
import {
  blurFormatNumberPtBr,
  formatNumberPtBr,
  moedaShort,
  parseNumberPtBr,
  sanitizeNumberInput
} from "@/lib/format";
import type {
  AppPlatform,
  Campanha,
  CampanhaApp,
  CampanhaBudgetMode,
  CampanhaCapHistorico,
  CampanhaCapTipo,
  CampanhaCapUnidade,
  CampanhaEvento,
  CampanhaEventoCap,
  CampanhaMMP,
  CampanhaPublisher,
  CampanhaPublisherCapInput,
  CampanhaStatus,
  CampanhaTipo,
  Moeda,
  Supplier
} from "@/types";

const STATUS_OPTIONS: { value: CampanhaStatus; label: string }[] = [
  { value: "ativa", label: "Ativa" },
  { value: "pausada", label: "Pausada" },
  { value: "encerrada", label: "Encerrada" }
];

const MOEDA_OPTIONS: { value: Moeda; label: string; short: string }[] = [
  { value: "BRL", label: "R$ (BRL)", short: "R$" },
  { value: "USD", label: "U$ (USD)", short: "U$" }
];

const TIMEZONE_OPTIONS: { value: string; label: string }[] = [
  { value: "America/Sao_Paulo", label: "America/Sao_Paulo (BRT)" },
  { value: "UTC", label: "UTC" },
  { value: "America/New_York", label: "America/New_York (ET)" },
  { value: "Asia/Hong_Kong", label: "Asia/Hong_Kong (HKT)" }
];

const MESES_LABELS = [
  "Janeiro",
  "Fevereiro",
  "Marco",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro"
];

interface CampanhaFormProps {
  initial?: Campanha | null;
  /** Quando passado, o form faz PATCH /campanhas/{id} em vez de POST */
  campanhaId?: string;
  /**
   * Quando passado, o form NAO faz router.push apos salvar — apenas chama
   * onSaved(saved) e deixa o pai decidir (ex: edicao inline no detalhe que
   * fecha o form e recarrega). Sem onSaved, mantem o redirect padrao.
   */
  onSaved?: (saved: { id?: string }) => void;
}

interface EventoRow {
  nome: string;
  target_cpa: string;
  budget_monthly: string;
  // Cap deste evento (mesmo CapRow do publisher; evento nao usa vigencia_fim).
  cap: CapRow;
  caps_historico: CampanhaCapHistorico[]; // read-only, vinda do backend
}

interface AppRow {
  name: string;
  app_id: string;
  platform: AppPlatform;
  p360_enabled: boolean;
  only_primary_attribution: boolean;
  budget_monthly: string; // mascara PT-BR; usado no modo per_platform
}

// PO por evento dentro de um publisher: keyado por evento_nome (string).
// Cada evento tem um cap OPCIONAL proprio (mesmo CapRow do cap geral) — cap por
// (publisher, evento). Coexiste com o cap geral do publisher.
interface PublisherPayoutRow {
  evento_nome: string;
  payout: string; // mascara PT-BR
  cap: CapRow;
  caps_historico: CampanhaCapHistorico[]; // read-only, vinda do backend
}

// Media source dentro de um publisher no form. Guarda o objeto completo pra
// poder renderizar e togglar (pausar/reativar). `id` so existe nas ja salvas;
// media source nova (digitada agora) nao tem id e nao pode ser togglada ainda.
interface MediaSourceRow {
  id: string | null;
  name: string;
  link: string; // URL opcional (texto livre no form)
  active: boolean;
  deactivated_reason: string | null;
  deactivated_at: string | null;
  deactivated_registered_at: string | null;
}

// Cap de eventos do publisher no form (valor como string mascarada PT-BR).
interface CapRow {
  tipo: CampanhaCapTipo;
  unidade: CampanhaCapUnidade;
  valor: string; // mascara PT-BR
  vigencia_inicio: string; // YYYY-MM-DD
  vigencia_fim: string; // YYYY-MM-DD (vazio = aberta)
  // Snapshot do cap que veio do backend (pra detectar mudanca de valor/tipo e
  // pedir data efetiva da renegociacao). null = publisher novo / sem cap salvo.
  initial: {
    tipo: CampanhaCapTipo;
    unidade: CampanhaCapUnidade;
    valor: number | null;
    vigencia_inicio: string | null;
    vigencia_fim: string | null;
  } | null;
}

interface PublisherRow {
  nome: string;
  // FK pro fornecedor (suppliers). O nome agora vem do supplier escolhido; o
  // backend resolve `nome` a partir daqui. null = ainda nao escolhido (ou
  // campanha antiga sem supplier_id -> usa `nome` como fallback no select).
  supplier_id: string | null;
  media_sources: MediaSourceRow[]; // lista dinamica de objetos
  payouts: PublisherPayoutRow[];
  moeda: Moeda; // moeda do PO desse publisher (aplica a todos os POs)
  cap: CapRow;
  caps_historico: CampanhaCapHistorico[]; // read-only, vinda do backend
}

function emptyCapRow(): CapRow {
  return {
    tipo: "nenhum",
    unidade: "eventos",
    valor: "",
    vigencia_inicio: "",
    vigencia_fim: "",
    initial: null
  };
}

// Shape minimo de cap aceito por capToRow (publisher OU evento). O cap de evento
// nao tem vigencia_fim — por isso o campo e opcional aqui.
type CapLike = {
  tipo: CampanhaCapTipo;
  unidade?: CampanhaCapUnidade;
  valor?: number | null;
  vigencia_inicio?: string | null;
  vigencia_fim?: string | null;
};

function capToRow(cap: CapLike | null | undefined): CapRow {
  if (!cap || cap.tipo === "nenhum" || !cap.tipo) return emptyCapRow();
  return {
    tipo: cap.tipo,
    unidade: cap.unidade || "eventos",
    valor: cap.valor != null ? formatNumberPtBr(cap.valor) : "",
    vigencia_inicio: cap.vigencia_inicio ? cap.vigencia_inicio.slice(0, 10) : "",
    vigencia_fim: cap.vigencia_fim ? cap.vigencia_fim.slice(0, 10) : "",
    initial: {
      tipo: cap.tipo,
      unidade: cap.unidade || "eventos",
      valor: cap.valor ?? null,
      vigencia_inicio: cap.vigencia_inicio
        ? cap.vigencia_inicio.slice(0, 10)
        : null,
      vigencia_fim: cap.vigencia_fim ? cap.vigencia_fim.slice(0, 10) : null
    }
  };
}

function emptyMediaSourceRow(): MediaSourceRow {
  return {
    id: null,
    name: "",
    link: "",
    active: true,
    deactivated_reason: null,
    deactivated_at: null,
    deactivated_registered_at: null
  };
}

function toDateInput(s: string | null | undefined): string {
  if (!s) return "";
  return s.length >= 10 ? s.slice(0, 10) : "";
}

function normalizeMoeda(m: string | null | undefined): Moeda {
  return m === "USD" ? "USD" : "BRL";
}

function eventoToRow(e: CampanhaEvento): EventoRow {
  return {
    nome: e.nome ?? "",
    target_cpa: e.target_cpa != null ? formatNumberPtBr(e.target_cpa) : "",
    budget_monthly:
      e.budget_monthly != null ? formatNumberPtBr(e.budget_monthly) : "",
    cap: capToRow(e.cap),
    caps_historico: Array.isArray(e.caps_historico) ? e.caps_historico : []
  };
}

function emptyEventoRow(): EventoRow {
  return {
    nome: "",
    target_cpa: "",
    budget_monthly: "",
    cap: emptyCapRow(),
    caps_historico: []
  };
}

function publisherToRow(p: CampanhaPublisher): PublisherRow {
  // media_sources vem como objetos {id, name, active, ...}. Mantemos o objeto
  // inteiro no state pra poder renderizar status e togglar (pausar/reativar).
  const msRows: MediaSourceRow[] =
    Array.isArray(p.media_sources) && p.media_sources.length > 0
      ? p.media_sources.map((ms) => ({
          id: ms?.id ?? null,
          name: ms?.name ?? "",
          link: ms?.link ?? "",
          active: ms?.active !== false,
          deactivated_reason: ms?.deactivated_reason ?? null,
          deactivated_at: ms?.deactivated_at ?? null,
          deactivated_registered_at: ms?.deactivated_registered_at ?? null
        }))
      : [emptyMediaSourceRow()];
  // Caps por evento (read-only do backend), casados por evento_nome. Monta um
  // mapa nome -> { cap, historico } pra pre-carregar o cap de cada payout.
  const capsPorEvento = new Map<
    string,
    { cap: CapRow; caps_historico: CampanhaCapHistorico[] }
  >();
  for (const c of p.caps_por_evento ?? []) {
    const nome = (c?.evento_nome ?? "").trim();
    if (!nome) continue;
    capsPorEvento.set(nome, {
      cap: capToRow(c?.cap),
      caps_historico: Array.isArray(c?.caps_historico) ? c.caps_historico : []
    });
  }
  return {
    nome: p.nome ?? "",
    supplier_id: p.supplier_id ?? null,
    media_sources: msRows,
    payouts: (p.payouts ?? []).map((po) => {
      const nome = po.evento_nome ?? "";
      const evCap = capsPorEvento.get(nome.trim());
      return {
        evento_nome: nome,
        payout: po.payout != null ? formatNumberPtBr(po.payout) : "",
        cap: evCap?.cap ?? emptyCapRow(),
        caps_historico: evCap?.caps_historico ?? []
      };
    }),
    moeda: p.moeda === "BRL" ? "BRL" : "USD",
    cap: capToRow(p.cap),
    caps_historico: Array.isArray(p.caps_historico) ? p.caps_historico : []
  };
}

function appToRow(a: CampanhaApp): AppRow {
  return {
    name: a.name ?? "",
    app_id: a.app_id ?? "",
    platform: a.platform ?? "android",
    p360_enabled: !!a.p360_enabled,
    only_primary_attribution: a.only_primary_attribution !== false,
    budget_monthly:
      a.budget_monthly != null ? formatNumberPtBr(a.budget_monthly) : ""
  };
}

export function CampanhaForm({ initial, campanhaId, onSaved }: CampanhaFormProps) {
  const router = useRouter();
  const toast = useToast();
  const isEdit = Boolean(campanhaId);

  // Identificacao
  const [name, setName] = useState(initial?.name ?? "");
  const [status, setStatus] = useState<CampanhaStatus>(
    initial?.status ?? "ativa"
  );

  // Periodo
  const [inicio, setInicio] = useState(toDateInput(initial?.inicio));
  const [fim, setFim] = useState(toDateInput(initial?.fim));

  // App e parceiro
  const [app, setApp] = useState(initial?.app ?? "");
  const [afPrt, setAfPrt] = useState(initial?.af_prt ?? "");
  const [plataforma, setPlataforma] = useState(initial?.plataforma ?? "");

  // Financeiro
  const [budget, setBudget] = useState<string>(
    initial?.budget != null ? formatNumberPtBr(initial.budget) : ""
  );
  const [moeda, setMoeda] = useState<Moeda>(normalizeMoeda(initial?.moeda));
  const [fluxo, setFluxo] = useState(initial?.fluxo ?? "");

  // Tipo / budget_mode / timezone / external_id (api_af)
  const [tipo, setTipo] = useState<CampanhaTipo>(
    (initial?.tipo as CampanhaTipo) || "ua"
  );
  const [budgetMode, setBudgetMode] = useState<CampanhaBudgetMode>(
    (initial?.budget_mode as CampanhaBudgetMode) || "total"
  );
  const [timezone, setTimezone] = useState<string>(
    initial?.timezone || "America/Sao_Paulo"
  );
  const [externalId, setExternalId] = useState<string>(
    initial?.external_id || ""
  );

  // mes_referencia (Fase 2): UI = 2 selects (mes 01-12, ano corrente +/- 1 / +1).
  // Default = mes corrente. Valor salvo: YYYY-MM-01.
  const today = new Date();
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth() + 1; // 1..12
  const parseMesRef = (
    raw: string | null | undefined
  ): { mes: number; ano: number } => {
    if (raw) {
      const m = /^(\d{4})-(\d{2})/.exec(raw);
      if (m) return { mes: parseInt(m[2], 10), ano: parseInt(m[1], 10) };
    }
    return { mes: currentMonth, ano: currentYear };
  };
  const initialMesRef = parseMesRef(initial?.mes_referencia);
  const [mesRefMes, setMesRefMes] = useState<number>(initialMesRef.mes);
  const [mesRefAno, setMesRefAno] = useState<number>(initialMesRef.ano);

  // mmp (Fase 2): default appsflyer
  const [mmp, setMmp] = useState<CampanhaMMP>(
    (initial?.mmp as CampanhaMMP) || "appsflyer"
  );

  // Parceria Wave (Wavesync): se sim, entra no relatorio enviado pro parceiro.
  // Default NAO (fail-safe: nada vaza sem marcar explicitamente).
  const [parceriaWave, setParceriaWave] = useState<boolean>(
    initial?.parceria_wave ?? false
  );

  // Coleta manual: se sim, o robo api_af nao busca os dados (so input manual).
  // Default NAO (busca automatica, comportamento padrao do appsflyer).
  const [coletaManual, setColetaManual] = useState<boolean>(
    initial?.coleta_manual ?? false
  );

  // Eventos pagos — comeca com 1 linha vazia se nao tem nada
  const [eventos, setEventos] = useState<EventoRow[]>(
    initial?.eventos_pagos && initial.eventos_pagos.length > 0
      ? initial.eventos_pagos.map(eventoToRow)
      : [emptyEventoRow()]
  );

  // Apps (api_af) — comeca vazio (nao obrigatorio)
  const [apps, setApps] = useState<AppRow[]>(
    initial?.apps && initial.apps.length > 0 ? initial.apps.map(appToRow) : []
  );

  // Publishers — comeca vazio. Cada publisher tem media sources + PO por evento.
  const [publishers, setPublishers] = useState<PublisherRow[]>(
    initial?.publishers && initial.publishers.length > 0
      ? initial.publishers.map(publisherToRow)
      : []
  );

  // Contagem de publishers e PIDs (media sources) — reflete o estado atual do form.
  const publisherCount = publishers.length;
  const pidCount = useMemo(
    () => publishers.reduce((acc, p) => acc + p.media_sources.length, 0),
    [publishers]
  );

  // Fornecedores (suppliers) que podem ser publishers — alimenta o seletor de
  // nome de cada publisher. Carregado uma vez no mount. Tolera falha (cai em []).
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [suppliersLoading, setSuppliersLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await apiFetch(
          "/suppliers?is_publisher=true&active=true"
        );
        if (!alive) return;
        const items: Supplier[] = Array.isArray(res?.items) ? res.items : [];
        items.sort((a, b) =>
          (a.name || "").localeCompare(b.name || "", "pt-BR", {
            sensitivity: "base"
          })
        );
        setSuppliers(items);
      } catch {
        if (alive) setSuppliers([]);
      } finally {
        if (alive) setSuppliersLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Criativo e observacoes
  const [criativo, setCriativo] = useState(initial?.criativo ?? "");
  const [obs, setObs] = useState(initial?.obs ?? "");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Cap renegociado: quando o user muda o valor de um cap ja vigente, abrimos
  // um modal pedindo a data efetiva da mudanca (igual renegociacao de payout).
  // `capEffectiveDate` guarda a data confirmada; `pendingSubmit` indica que o
  // submit foi adiado esperando essa data; `capRenegPublishers` so pro texto.
  const [capEffectiveDate, setCapEffectiveDate] = useState<string>("");
  const [pendingSubmit, setPendingSubmit] = useState(false);
  const [capRenegPublishers, setCapRenegPublishers] = useState<string[]>([]);

  // Quando a data efetiva do cap e confirmada no modal, retoma o submit.
  useEffect(() => {
    if (pendingSubmit && capEffectiveDate) {
      setPendingSubmit(false);
      void handleSubmit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capEffectiveDate, pendingSubmit]);

  // Cap de EVENTO renegociado: ao mudar tipo/unidade/valor de um cap de evento
  // ja vigente, abrimos um modal pedindo o MOTIVO da renegociacao (o backend usa
  // a vigencia_inicio do form como data efetiva e fecha a vigencia anterior).
  const [eventoCapReason, setEventoCapReason] = useState<string>("");
  const [pendingEventoCapSubmit, setPendingEventoCapSubmit] = useState(false);
  const [eventoCapRenegEventos, setEventoCapRenegEventos] = useState<string[]>(
    []
  );

  // Quando o motivo do cap de evento e confirmado no modal, retoma o submit.
  useEffect(() => {
    if (pendingEventoCapSubmit && eventoCapReason) {
      setPendingEventoCapSubmit(false);
      void handleSubmit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventoCapReason, pendingEventoCapSubmit]);

  // ---- helpers eventos ----
  const updateEvento = (idx: number, patch: Partial<EventoRow>) => {
    setEventos((prev) =>
      prev.map((row, i) => (i === idx ? { ...row, ...patch } : row))
    );
  };
  const addEvento = () => setEventos((prev) => [...prev, emptyEventoRow()]);
  const removeEvento = (idx: number) => {
    setEventos((prev) =>
      prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)
    );
  };
  // cap de eventos dentro de um evento (mesmo padrao do cap de publisher)
  const updateEventoCap = (idx: number, patch: Partial<CapRow>) =>
    setEventos((prev) =>
      prev.map((row, i) =>
        i === idx ? { ...row, cap: { ...row.cap, ...patch } } : row
      )
    );

  // Nomes de eventos atuais (nao vazios, unicos por trim) — base pra reconciliar
  // os payouts dos publishers quando o user muda os eventos.
  const eventoNomes = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const ev of eventos) {
      const n = ev.nome.trim();
      if (n && !seen.has(n)) {
        seen.add(n);
        out.push(n);
      }
    }
    return out;
  }, [eventos]);

  // Reconcilia os payouts de cada publisher contra os eventos atuais:
  // mantem o payout dos eventos que casam por nome, descarta os orfaos,
  // e garante 1 linha por evento atual (na ordem dos eventos).
  useEffect(() => {
    setPublishers((prev) =>
      prev.map((pub) => {
        // Mantem o objeto inteiro do payout (payout + cap + historico) por nome,
        // reusando a mesma referencia quando o evento continua existindo. Evento
        // renomeado/removido vira novo (cap vazio) — defensivo, nao quebra.
        const byNome = new Map(pub.payouts.map((po) => [po.evento_nome, po]));
        const next: PublisherPayoutRow[] = eventoNomes.map(
          (nome) =>
            byNome.get(nome) ?? {
              evento_nome: nome,
              payout: "",
              cap: emptyCapRow(),
              caps_historico: []
            }
        );
        // Evita re-render se nada mudou (mesma sequencia, mesmas referencias).
        const same =
          next.length === pub.payouts.length &&
          next.every((po, i) => po === pub.payouts[i]);
        return same ? pub : { ...pub, payouts: next };
      })
    );
  }, [eventoNomes]);

  // ---- helpers apps ----
  const updateApp = (idx: number, patch: Partial<AppRow>) => {
    setApps((prev) =>
      prev.map((row, i) => (i === idx ? { ...row, ...patch } : row))
    );
  };
  const addApp = () =>
    setApps((prev) => [
      ...prev,
      {
        name: "",
        app_id: "",
        platform: "android",
        p360_enabled: false,
        only_primary_attribution: true,
        budget_monthly: ""
      }
    ]);
  const removeApp = (idx: number) =>
    setApps((prev) => prev.filter((_, i) => i !== idx));

  // ---- helpers publishers ----
  const updatePublisher = (idx: number, patch: Partial<PublisherRow>) => {
    setPublishers((prev) =>
      prev.map((row, i) => (i === idx ? { ...row, ...patch } : row))
    );
  };
  // Escolha de fornecedor pro publisher: grava supplier_id + nome (do supplier).
  // Pre-preenche a moeda do PO com a default_moeda do supplier APENAS na primeira
  // escolha (supplier_id ainda null), pra nao sobrescrever ajuste manual do user.
  const selectPublisherSupplier = (idx: number, supplier: Supplier) => {
    setPublishers((prev) =>
      prev.map((row, i) => {
        if (i !== idx) return row;
        const patch: Partial<PublisherRow> = {
          supplier_id: supplier.id,
          nome: supplier.name ?? row.nome
        };
        if (row.supplier_id == null) {
          const dm = supplier.default_moeda;
          if (dm === "BRL" || dm === "USD") patch.moeda = dm;
        }
        return { ...row, ...patch };
      })
    );
  };
  const addPublisher = () =>
    setPublishers((prev) => [
      ...prev,
      {
        nome: "",
        supplier_id: null,
        media_sources: [emptyMediaSourceRow()],
        // Ja inicia com 1 linha de payout por evento atual (vazias, sem cap).
        payouts: eventoNomes.map((nome) => ({
          evento_nome: nome,
          payout: "",
          cap: emptyCapRow(),
          caps_historico: []
        })),
        // Default USD em publisher novo (padrao do backend).
        moeda: "USD",
        cap: emptyCapRow(),
        caps_historico: []
      }
    ]);
  const removePublisher = (idx: number) =>
    setPublishers((prev) => prev.filter((_, i) => i !== idx));

  // media sources (objetos) dentro de um publisher
  const updatePublisherMediaSourceName = (
    pubIdx: number,
    msIdx: number,
    value: string
  ) =>
    setPublishers((prev) =>
      prev.map((pub, i) =>
        i === pubIdx
          ? {
              ...pub,
              media_sources: pub.media_sources.map((ms, j) =>
                j === msIdx ? { ...ms, name: value } : ms
              )
            }
          : pub
      )
    );
  const updatePublisherMediaSourceLink = (
    pubIdx: number,
    msIdx: number,
    value: string
  ) =>
    setPublishers((prev) =>
      prev.map((pub, i) =>
        i === pubIdx
          ? {
              ...pub,
              media_sources: pub.media_sources.map((ms, j) =>
                j === msIdx ? { ...ms, link: value } : ms
              )
            }
          : pub
      )
    );
  // Aplica o resultado de um toggle (PATCH ja feito) na media source local.
  const setMediaSourceState = (
    pubIdx: number,
    msIdx: number,
    patch: Partial<MediaSourceRow>
  ) =>
    setPublishers((prev) =>
      prev.map((pub, i) =>
        i === pubIdx
          ? {
              ...pub,
              media_sources: pub.media_sources.map((ms, j) =>
                j === msIdx ? { ...ms, ...patch } : ms
              )
            }
          : pub
      )
    );
  const addPublisherMediaSource = (pubIdx: number) =>
    setPublishers((prev) =>
      prev.map((pub, i) =>
        i === pubIdx
          ? { ...pub, media_sources: [...pub.media_sources, emptyMediaSourceRow()] }
          : pub
      )
    );
  const removePublisherMediaSource = (pubIdx: number, msIdx: number) =>
    setPublishers((prev) =>
      prev.map((pub, i) =>
        i === pubIdx
          ? {
              ...pub,
              media_sources:
                pub.media_sources.length <= 1
                  ? pub.media_sources
                  : pub.media_sources.filter((_, j) => j !== msIdx)
            }
          : pub
      )
    );

  // payout por evento dentro de um publisher
  const updatePublisherPayout = (
    pubIdx: number,
    poIdx: number,
    value: string
  ) =>
    setPublishers((prev) =>
      prev.map((pub, i) =>
        i === pubIdx
          ? {
              ...pub,
              payouts: pub.payouts.map((po, j) =>
                j === poIdx ? { ...po, payout: value } : po
              )
            }
          : pub
      )
    );

  // cap por evento dentro de um publisher (cap de um item do "PO por evento")
  const updatePublisherPayoutCap = (
    pubIdx: number,
    poIdx: number,
    patch: Partial<CapRow>
  ) =>
    setPublishers((prev) =>
      prev.map((pub, i) =>
        i === pubIdx
          ? {
              ...pub,
              payouts: pub.payouts.map((po, j) =>
                j === poIdx ? { ...po, cap: { ...po.cap, ...patch } } : po
              )
            }
          : pub
      )
    );

  // cap GERAL de eventos dentro de um publisher
  const updatePublisherCap = (pubIdx: number, patch: Partial<CapRow>) =>
    setPublishers((prev) =>
      prev.map((pub, i) =>
        i === pubIdx ? { ...pub, cap: { ...pub.cap, ...patch } } : pub
      )
    );

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError("");

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Informe o nome da campanha.");
      return;
    }

    // Parse budget total — nao se aplica no modo Por plataforma (vai null).
    let parsedBudget: number | null = null;
    if (budgetMode !== "per_platform" && budget.trim()) {
      parsedBudget = parseNumberPtBr(budget);
      if (Number.isNaN(parsedBudget) || parsedBudget < 0) {
        setError("Budget invalido. Use um numero >= 0.");
        return;
      }
    }

    // Eventos
    const cleanEventos: CampanhaEvento[] = [];
    // Eventos cujo cap MUDOU de valor/tipo/unidade numa campanha que ja tinha cap
    // vigente -> precisam de motivo (renegociacao). Coletamos pra pedir no modal.
    const eventoCapsRenegociados: string[] = [];
    for (const row of eventos) {
      const nomeTrim = row.nome.trim();
      if (!nomeTrim) continue;

      const parseOpt = (
        raw: string,
        field: string
      ): number | null | "ERR" => {
        const s = raw.trim();
        if (!s) return null;
        const n = parseNumberPtBr(s);
        if (Number.isNaN(n) || n < 0) {
          setError(`${field} invalido no evento "${nomeTrim}". Use um numero >= 0.`);
          return "ERR";
        }
        return n;
      };

      const targetCpa = parseOpt(row.target_cpa, "PO (CPA)");
      if (targetCpa === "ERR") return;

      let budgetMonthly: number | null = null;
      if (budgetMode === "per_event") {
        const parsed = parseOpt(row.budget_monthly, "Budget mensal");
        if (parsed === "ERR") return;
        if (parsed == null) {
          setError(
            `Budget mensal e obrigatorio no evento "${nomeTrim}" (budget por evento).`
          );
          return;
        }
        budgetMonthly = parsed;
      }

      // ---- Cap deste evento (mesmo padrao do cap de publisher) ----
      const evCapRow = row.cap;
      let evCapPayload: CampanhaEventoCap;
      if (evCapRow.tipo === "nenhum") {
        evCapPayload = {
          tipo: "nenhum",
          unidade: "eventos",
          valor: null,
          vigencia_inicio: null
        };
      } else {
        const rawValor = evCapRow.valor.trim();
        const valorNum = rawValor ? parseNumberPtBr(rawValor) : NaN;
        if (!rawValor || Number.isNaN(valorNum) || valorNum < 0) {
          setError(
            `Evento "${nomeTrim}": informe um valor de cap valido (ou tipo Nenhum).`
          );
          return;
        }
        if (!evCapRow.vigencia_inicio) {
          setError(
            `Evento "${nomeTrim}": informe a data de inicio da vigencia do cap.`
          );
          return;
        }
        evCapPayload = {
          tipo: evCapRow.tipo,
          unidade: evCapRow.unidade,
          valor: valorNum,
          vigencia_inicio: evCapRow.vigencia_inicio
        };
        // Renegociacao: ja existia cap vigente (initial) e tipo/unidade/valor
        // mudou -> precisa de motivo. Mudanca de vigencia pura nao conta.
        const prev = evCapRow.initial;
        const changedMaterial =
          prev != null &&
          (prev.tipo !== evCapPayload.tipo ||
            prev.unidade !== evCapPayload.unidade ||
            (prev.valor ?? null) !== (evCapPayload.valor ?? null));
        if (changedMaterial) {
          eventoCapsRenegociados.push(nomeTrim);
          (evCapPayload as any).__needsReason = true;
        }
      }

      cleanEventos.push({
        nome: nomeTrim,
        target_cpa: targetCpa,
        budget_monthly: budgetMonthly,
        cap: evCapPayload
      });
    }

    // Apps
    const cleanApps: CampanhaApp[] = [];
    for (let i = 0; i < apps.length; i++) {
      const row = apps[i];
      const nameTrim = row.name.trim();
      const appIdTrim = row.app_id.trim();
      if (!nameTrim && !appIdTrim) continue; // skip linhas totalmente vazias
      if (!nameTrim || !appIdTrim) {
        setError(`App ${i + 1}: preencha nome e app_id (ou remova a linha).`);
        return;
      }

      // Budget mensal por app: obrigatorio (> 0) no modo Por plataforma.
      let appBudgetMonthly: number | null = null;
      const rawBudget = row.budget_monthly.trim();
      if (rawBudget) {
        appBudgetMonthly = parseNumberPtBr(rawBudget);
        if (Number.isNaN(appBudgetMonthly) || appBudgetMonthly < 0) {
          setError(`App ${i + 1}: budget mensal invalido. Use um numero >= 0.`);
          return;
        }
      }
      if (
        budgetMode === "per_platform" &&
        (appBudgetMonthly == null || appBudgetMonthly <= 0)
      ) {
        setError("Informe o budget de cada app no modo Por plataforma.");
        return;
      }

      cleanApps.push({
        name: nameTrim,
        app_id: appIdTrim,
        platform: row.platform,
        p360_enabled: row.p360_enabled,
        only_primary_attribution: row.only_primary_attribution,
        budget_monthly: appBudgetMonthly,
        ordem: i
      });
    }

    if (budgetMode === "per_platform" && cleanApps.length === 0) {
      setError("Informe o budget de cada app no modo Por plataforma.");
      return;
    }

    // Publishers — cada um com media sources (envia string[] de nomes; o backend
    // reconcilia active/reason/data por nome) + PO por evento + cap de eventos.
    const cleanPublishers: {
      nome: string;
      supplier_id: string | null;
      media_sources: { name: string; link: string | null }[];
      payouts: { evento_nome: string; payout: number | null }[];
      moeda: Moeda;
      // Lista autoritativa de caps do publisher: geral (evento_nome null) + um
      // item por evento que tenha cap (evento_nome preenchido).
      caps: CampanhaPublisherCapInput[];
      ordem: number;
    }[] = [];
    // Caps (geral OU por evento) que MUDARAM de valor numa campanha que ja tinha
    // cap vigente -> precisam de data efetiva (renegociacao). O label descreve
    // o alvo ("Publisher X" ou "Publisher X · evento Y") pro modal.
    const capsRenegociados: string[] = [];

    // Constroi um item de cap (geral se eventoNome=null, ou por evento) a partir
    // de um CapRow. Retorna null quando nao ha nada a enviar (tipo=nenhum e sem
    // cap previo), "ERR" quando invalido (ja setou setError), ou o payload.
    const buildCapInput = (
      capRow: CapRow,
      eventoNome: string | null,
      label: string
    ): CampanhaPublisherCapInput | null | "ERR" => {
      if (capRow.tipo === "nenhum") {
        // So envia 'nenhum' pra ENCERRAR um cap que existia antes; caso contrario
        // omite (nada a fazer). evento_nome preserva o alvo.
        if (capRow.initial == null) return null;
        return {
          tipo: "nenhum",
          unidade: "eventos",
          valor: null,
          vigencia_inicio: null,
          vigencia_fim: null,
          evento_nome: eventoNome
        };
      }
      const rawValor = capRow.valor.trim();
      const valorNum = rawValor ? parseNumberPtBr(rawValor) : NaN;
      if (!rawValor || Number.isNaN(valorNum) || valorNum < 0) {
        setError(`${label}: informe um valor de cap valido (ou tipo Nenhum).`);
        return "ERR";
      }
      if (!capRow.vigencia_inicio) {
        setError(`${label}: informe a data de inicio da vigencia do cap.`);
        return "ERR";
      }
      if (capRow.vigencia_fim && capRow.vigencia_fim < capRow.vigencia_inicio) {
        setError(`${label}: fim da vigencia do cap antes do inicio.`);
        return "ERR";
      }
      const payload: CampanhaPublisherCapInput = {
        tipo: capRow.tipo,
        unidade: capRow.unidade,
        valor: valorNum,
        vigencia_inicio: capRow.vigencia_inicio,
        vigencia_fim: capRow.vigencia_fim || null,
        evento_nome: eventoNome
      };
      // Renegociacao: ja existia cap vigente (initial) e valor/tipo/unidade
      // mudou -> precisa de data efetiva. Mudanca de vigencia pura nao conta.
      const prev = capRow.initial;
      const changedMaterial =
        prev != null &&
        (prev.tipo !== payload.tipo ||
          prev.unidade !== payload.unidade ||
          (prev.valor ?? null) !== (payload.valor ?? null));
      if (changedMaterial) {
        capsRenegociados.push(label);
        // data_efetiva preenchida depois (modal); marca como pendente.
        (payload as any).__needsEfetiva = true;
      }
      return payload;
    };
    for (let i = 0; i < publishers.length; i++) {
      const pub = publishers[i];
      const supplierId = pub.supplier_id || null;
      const nomeTrim = pub.nome.trim();
      const cleanMs = pub.media_sources
        .map((ms) => ({ name: ms.name.trim(), link: ms.link.trim() || null }))
        .filter((ms) => ms.name);
      // Pula publishers totalmente vazios (sem fornecedor, sem nome, sem ms,
      // sem payout, sem cap).
      const hasPayout = pub.payouts.some((po) => po.payout.trim());
      const hasCap =
        pub.cap.tipo !== "nenhum" ||
        pub.payouts.some((po) => po.cap.tipo !== "nenhum");
      if (
        !supplierId &&
        !nomeTrim &&
        cleanMs.length === 0 &&
        !hasPayout &&
        !hasCap
      )
        continue;
      // O nome agora vem do fornecedor escolhido. Defensivo: campanha antiga
      // pode ter nome sem supplier_id (entao aceita o nome como fallback).
      if (!supplierId && !nomeTrim) {
        setError(
          `Publisher ${i + 1}: selecione o fornecedor (ou remova a linha).`
        );
        return;
      }

      const cleanPayouts: { evento_nome: string; payout: number | null }[] = [];
      for (const po of pub.payouts) {
        const evNome = po.evento_nome.trim();
        if (!evNome) continue;
        const raw = po.payout.trim();
        let payoutVal: number | null = null;
        if (raw) {
          payoutVal = parseNumberPtBr(raw);
          if (Number.isNaN(payoutVal) || payoutVal < 0) {
            setError(
              `Publisher "${nomeTrim}": payout invalido no evento "${evNome}".`
            );
            return;
          }
        }
        cleanPayouts.push({ evento_nome: evNome, payout: payoutVal });
      }

      // ---- Caps (geral + por evento) ----
      // Lista autoritativa: cap GERAL (evento_nome null) + um item por evento
      // que tenha cap. buildCapInput valida e marca renegociacao (data efetiva).
      const caps: CampanhaPublisherCapInput[] = [];
      const generalCap = buildCapInput(
        pub.cap,
        null,
        `Publisher "${nomeTrim}"`
      );
      if (generalCap === "ERR") return;
      if (generalCap) caps.push(generalCap);
      for (const po of pub.payouts) {
        const evNome = po.evento_nome.trim();
        if (!evNome) continue;
        const evCap = buildCapInput(
          po.cap,
          evNome,
          `Publisher "${nomeTrim}" · evento "${evNome}"`
        );
        if (evCap === "ERR") return;
        if (evCap) caps.push(evCap);
      }

      cleanPublishers.push({
        nome: nomeTrim,
        supplier_id: supplierId,
        media_sources: cleanMs,
        payouts: cleanPayouts,
        moeda: pub.moeda === "BRL" ? "BRL" : "USD",
        caps,
        ordem: i
      });
    }

    // Se ha cap(s) de publisher renegociado(s) e ainda nao temos a data efetiva,
    // abre modal e adia o submit. O modal preenche capEffectiveDate ao confirmar.
    if (capsRenegociados.length > 0 && !capEffectiveDate) {
      setPendingSubmit(true);
      setCapRenegPublishers(capsRenegociados);
      return;
    }
    // Se ha cap(s) de EVENTO renegociado(s) e ainda nao temos o motivo, abre o
    // modal de motivo e adia o submit (sequencial ao de publisher, se houver).
    if (eventoCapsRenegociados.length > 0 && !eventoCapReason) {
      setPendingEventoCapSubmit(true);
      setEventoCapRenegEventos(eventoCapsRenegociados);
      return;
    }
    // Aplica a data efetiva nos caps (geral E por evento) renegociados.
    for (const cp of cleanPublishers) {
      for (const c of cp.caps) {
        if ((c as any).__needsEfetiva) {
          c.data_efetiva = capEffectiveDate || todayIso();
          delete (c as any).__needsEfetiva;
        }
      }
    }
    // Aplica o motivo nos caps de evento renegociados.
    for (const ev of cleanEventos) {
      const evCap = ev.cap as any;
      if (evCap?.__needsReason) {
        evCap.reason = eventoCapReason || null;
        delete evCap.__needsReason;
      }
    }

    const mesRefIso = `${mesRefAno}-${String(mesRefMes).padStart(2, "0")}-01`;

    const payload: Record<string, any> = {
      name: trimmedName,
      status,
      inicio: inicio || null,
      fim: fim || null,
      app: app.trim() || null,
      af_prt: afPrt.trim() || null,
      plataforma: plataforma.trim() || null,
      budget: parsedBudget,
      moeda,
      fluxo: fluxo.trim() || null,
      tipo,
      budget_mode: budgetMode,
      timezone: timezone || null,
      external_id: externalId.trim() || null,
      mes_referencia: mesRefIso,
      mmp,
      parceria_wave: parceriaWave,
      coleta_manual: coletaManual,
      criativo: criativo.trim() || null,
      obs: obs.trim() || null,
      eventos_pagos: cleanEventos,
      apps: cleanApps,
      publishers: cleanPublishers
    };

    setSubmitting(true);
    try {
      const endpoint = isEdit ? `/campanhas/${campanhaId}` : "/campanhas";
      const method = isEdit ? "PATCH" : "POST";
      const saved: { id?: string } = await apiFetch(endpoint, {
        method,
        body: JSON.stringify(payload)
      });

      toast.success(isEdit ? "Campanha atualizada." : "Campanha criada.");
      if (onSaved) {
        // Pai decide o que fazer (ex: fechar edicao inline + recarregar).
        onSaved(saved);
      } else {
        const targetId = saved?.id || campanhaId;
        if (targetId) {
          router.push(`/campanhas/${targetId}`);
        } else {
          router.push("/campanhas");
        }
      }
    } catch (err: any) {
      setError(err?.message || "Falha ao salvar campanha.");
      // Permite re-prompt da data efetiva / motivo numa nova tentativa.
      setCapEffectiveDate("");
      setCapRenegPublishers([]);
      setEventoCapReason("");
      setEventoCapRenegEventos([]);
    } finally {
      setSubmitting(false);
    }
  };

  const moedaSym = moedaShort(moeda);

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="flex items-start gap-2.5 rounded-lg border border-danger/20 bg-danger/10 p-3">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-danger" />
          <p className="text-sm text-danger">{error}</p>
        </div>
      )}

      <Section title="Identificacao">
        <Field label="Nome" required>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex: Campanha Black Friday 2026"
            required
            className={inputCls}
          />
          <p className="mt-1 text-xs text-muted">
            {publisherCount} publishers · {pidCount} PIDs cadastrados
          </p>
        </Field>
        <Field label="Status">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as CampanhaStatus)}
            className={inputCls}
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </Field>
      </Section>

      <Section title="Mes de referencia e MMP">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="Mes de referencia"
            hint="Mes da campanha (snapshot mensal)"
          >
            <div className="flex gap-2">
              <select
                value={mesRefMes}
                onChange={(e) => setMesRefMes(parseInt(e.target.value, 10))}
                className={inputCls}
                aria-label="Mes"
              >
                {MESES_LABELS.map((label, i) => (
                  <option key={i + 1} value={i + 1}>
                    {String(i + 1).padStart(2, "0")} — {label}
                  </option>
                ))}
              </select>
              <select
                value={mesRefAno}
                onChange={(e) => setMesRefAno(parseInt(e.target.value, 10))}
                className={inputCls}
                aria-label="Ano"
              >
                {[currentYear - 1, currentYear, currentYear + 1].map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
          </Field>
          <Field
            label="MMP"
            hint="Mobile Measurement Partner da campanha. AppsFlyer ou Adjust — o robo api_af busca os metrics no MMP escolhido."
          >
            <div className="flex gap-2">
              {(["appsflyer", "adjust"] as CampanhaMMP[]).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setMmp(opt)}
                  className={`flex-1 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                    mmp === opt
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-background text-muted hover:text-foreground"
                  }`}
                >
                  {opt === "appsflyer" ? "AppsFlyer" : "Adjust"}
                </button>
              ))}
            </div>
          </Field>
        </div>
        <Field
          label="Parceria Wave"
          hint="Se SIM, esta campanha entra no relatorio AppsFlyer enviado pra Wavesync (seg/qua/sex). Default NAO."
        >
          <div className="flex gap-2">
            {([
              { val: false, label: "Nao" },
              { val: true, label: "Sim" }
            ] as { val: boolean; label: string }[]).map((opt) => (
              <button
                key={opt.label}
                type="button"
                onClick={() => setParceriaWave(opt.val)}
                className={`flex-1 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                  parceriaWave === opt.val
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-background text-muted hover:text-foreground"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </Field>
        <Field
          label="Coleta de dados"
          hint="Automatica: o robo api_af busca os dados (padrao). Manual: o robo NAO busca — voce insere os metrics na mao (ex: campanha de parceiro AppsFlyer sem acesso automatico)."
        >
          <div className="flex gap-2">
            {([
              { val: false, label: "Automatica" },
              { val: true, label: "Manual (nao buscar)" }
            ] as { val: boolean; label: string }[]).map((opt) => (
              <button
                key={opt.label}
                type="button"
                onClick={() => setColetaManual(opt.val)}
                className={`flex-1 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                  coletaManual === opt.val
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-background text-muted hover:text-foreground"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </Field>
      </Section>

      <Section title="Tipo e budget">
        <Field
          label="Tipo da campanha"
          hint="UA = User Acquisition (installs novos). RTG = Retargeting (re-engajamento)."
        >
          <div className="flex gap-2">
            {(["ua", "rtg"] as CampanhaTipo[]).map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => setTipo(opt)}
                className={`flex-1 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                  tipo === opt
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-background text-muted hover:text-foreground"
                }`}
              >
                {opt.toUpperCase()}
              </button>
            ))}
          </div>
        </Field>

        <Field
          label="Modo de budget"
          hint="Total: um pote unico pro produto. Por evento: cada evento pago tem seu proprio orcamento. Por plataforma: cada app (iOS/Android) tem seu budget mensal."
        >
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setBudgetMode("total")}
              className={`flex-1 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                budgetMode === "total"
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-background text-muted hover:text-foreground"
              }`}
            >
              Total da campanha
            </button>
            <button
              type="button"
              onClick={() => setBudgetMode("per_event")}
              className={`flex-1 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                budgetMode === "per_event"
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-background text-muted hover:text-foreground"
              }`}
            >
              Por evento
            </button>
            <button
              type="button"
              onClick={() => setBudgetMode("per_platform")}
              className={`flex-1 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                budgetMode === "per_platform"
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-background text-muted hover:text-foreground"
              }`}
            >
              Por plataforma (iOS/Android)
            </button>
          </div>
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Timezone">
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className={inputCls}
            >
              {TIMEZONE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="ID externo (api_af)"
            hint="Identico ao product_name no config/apps.yaml do api_af (ex: 'Claro UA')"
          >
            <input
              type="text"
              value={externalId}
              onChange={(e) => setExternalId(e.target.value)}
              placeholder="Ex: Claro UA"
              className={inputCls}
            />
          </Field>
        </div>
      </Section>

      <Section title="Periodo">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Inicio">
            <input
              type="date"
              value={inicio}
              onChange={(e) => setInicio(e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="Fim">
            <input
              type="date"
              value={fim}
              onChange={(e) => setFim(e.target.value)}
              className={inputCls}
            />
          </Field>
        </div>
      </Section>

      <Section title="App e parceiro">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="App">
            <input
              type="text"
              value={app}
              onChange={(e) => setApp(e.target.value)}
              placeholder="Ex: caracol-ios"
              className={inputCls}
            />
          </Field>
          {mmp !== "adjust" && (
            <Field label="af_prt" hint="AppsFlyer Partner">
              <input
                type="text"
                value={afPrt}
                onChange={(e) => setAfPrt(e.target.value)}
                placeholder="Ex: meta_int"
                className={inputCls}
              />
            </Field>
          )}
          <Field label="Plataforma">
            <input
              type="text"
              value={plataforma}
              onChange={(e) => setPlataforma(e.target.value)}
              placeholder="Ex: iOS / Android / Web / Cross"
              className={inputCls}
            />
          </Field>
        </div>
      </Section>

      <Section title="Financeiro">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr,140px,1fr]">
          <Field
            label="Budget"
            hint={
              budgetMode === "per_platform"
                ? "nao se aplica no modo Por plataforma — defina por app abaixo"
                : `em ${moedaSym}`
            }
          >
            <PtBrCurrencyInput
              value={budgetMode === "per_platform" ? "" : budget}
              onChange={setBudget}
              prefix={moedaSym}
              disabled={budgetMode === "per_platform"}
            />
          </Field>
          <Field label="Moeda">
            <select
              value={moeda}
              onChange={(e) => setMoeda(e.target.value as Moeda)}
              className={inputCls}
            >
              {MOEDA_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Fluxo" hint="CPI / CPA / CPL / CPM">
            <input
              type="text"
              value={fluxo}
              onChange={(e) => setFluxo(e.target.value)}
              placeholder="Ex: CPI"
              className={inputCls}
            />
          </Field>
        </div>
      </Section>

      <Section
        title="Eventos pagos"
        hint={
          mmp === "adjust"
            ? `Valores em ${moedaSym} (moeda da campanha). O nome do evento deve corresponder ao evento no Adjust (o api_af ignora prefixo "NN.", caixa e _/espaco ao casar).`
            : `Valores em ${moedaSym} (moeda da campanha)`
        }
      >
        <div className="space-y-2">
          {/* Header de colunas */}
          <div
            className={`hidden gap-2 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted sm:grid ${
              budgetMode === "per_event"
                ? "grid-cols-[1fr,140px,140px,auto]"
                : "grid-cols-[1fr,140px,auto]"
            }`}
          >
            <span>Nome</span>
            <span title="PO contratado por evento (preco pago pelo cliente)">
              PO (CPA)
            </span>
            {budgetMode === "per_event" && <span>Budget mensal</span>}
            <span />
          </div>

          {eventos.map((row, idx) => (
            <div key={idx} className="space-y-2">
              <div
                className={`grid items-center gap-2 ${
                  budgetMode === "per_event"
                    ? "grid-cols-1 sm:grid-cols-[1fr,140px,140px,auto]"
                    : "grid-cols-1 sm:grid-cols-[1fr,140px,auto]"
                }`}
              >
                <input
                  type="text"
                  value={row.nome}
                  onChange={(e) => updateEvento(idx, { nome: e.target.value })}
                  placeholder="Nome do evento (ex: install, purchase)"
                  className={inputCls}
                />
                <PtBrCurrencyInput
                  value={row.target_cpa}
                  onChange={(v) => updateEvento(idx, { target_cpa: v })}
                  prefix={moedaSym}
                  aria-label="PO (CPA)"
                />
                {budgetMode === "per_event" && (
                  <PtBrCurrencyInput
                    value={row.budget_monthly}
                    onChange={(v) => updateEvento(idx, { budget_monthly: v })}
                    prefix={moedaSym}
                    aria-label="Budget mensal"
                  />
                )}
                <button
                  type="button"
                  onClick={() => removeEvento(idx)}
                  disabled={eventos.length <= 1}
                  className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted transition-colors hover:border-danger/40 hover:text-danger disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-border disabled:hover:text-muted"
                  title="Remover"
                  aria-label="Remover evento"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              {/* Cap deste evento (opcional) — mesmo padrao do cap de publisher */}
              <CapBlock
                cap={row.cap}
                history={row.caps_historico}
                onChange={(patch) => updateEventoCap(idx, patch)}
                title="Cap deste evento"
                hideVigenciaFim
                renegNote=" Mudar o valor pede o motivo da renegociacao (vira nova vigencia)."
              />
            </div>
          ))}
          <button
            type="button"
            onClick={addEvento}
            className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border bg-background px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-primary/40 hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
            Adicionar evento
          </button>
        </div>
      </Section>

      <Section
        title="Apps"
        hint={
          budgetMode === "per_platform"
            ? `Cada app tem seu budget mensal (em ${moedaSym})`
            : "Apps que api_af deve trackear (Android / iOS)"
        }
      >
        <div className="space-y-3">
          {mmp === "adjust" && (
            <p className="text-xs text-muted">
              Para Adjust, informe o app_token de cada app no campo App Token
              (Adjust) abaixo.
            </p>
          )}
          {apps.length === 0 && (
            <p className="text-xs text-muted">
              {budgetMode === "per_platform"
                ? "Modo Por plataforma exige ao menos 1 app com budget mensal. Adicione abaixo."
                : "Nenhum app cadastrado. Para que o robo api_af envie metrics, cadastre ao menos 1 plataforma."}
            </p>
          )}
          {apps.map((row, idx) => (
            <div
              key={idx}
              className="space-y-3 rounded-lg border border-border bg-background p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                  App {idx + 1}
                </p>
                <button
                  type="button"
                  onClick={() => removeApp(idx)}
                  className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-muted transition-colors hover:border-danger/40 hover:text-danger"
                  title="Remover app"
                  aria-label="Remover app"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Nome">
                  <input
                    type="text"
                    value={row.name}
                    onChange={(e) =>
                      updateApp(idx, { name: e.target.value })
                    }
                    placeholder="Ex: Claro Android"
                    className={inputCls}
                  />
                </Field>
                <Field
                  label={mmp === "adjust" ? "App Token (Adjust)" : "App ID"}
                  hint={
                    mmp === "adjust"
                      ? "Token do app no Adjust (hash ~12 chars, ex: tsugshug2328). NAO e o store id (com.x.app / id123)."
                      : "Store id do app no AppsFlyer (Android: com.x.app — iOS: id1234567890)."
                  }
                >
                  <input
                    type="text"
                    value={row.app_id}
                    onChange={(e) =>
                      updateApp(idx, { app_id: e.target.value })
                    }
                    placeholder={
                      mmp === "adjust"
                        ? "tsugshug2328"
                        : "com.claro.app ou id1234567890"
                    }
                    className={inputCls}
                  />
                </Field>
                <Field label="Plataforma">
                  <select
                    value={row.platform}
                    onChange={(e) =>
                      updateApp(idx, {
                        platform: e.target.value as AppPlatform
                      })
                    }
                    className={inputCls}
                  >
                    <option value="android">android</option>
                    <option value="ios">ios</option>
                  </select>
                </Field>
                <div className="flex flex-col gap-2 pt-6">
                  <label className="flex items-center gap-2 text-sm text-foreground">
                    <input
                      type="checkbox"
                      checked={row.p360_enabled}
                      onChange={(e) =>
                        updateApp(idx, { p360_enabled: e.target.checked })
                      }
                      className="h-4 w-4 rounded border-border bg-background"
                    />
                    P360 habilitado
                  </label>
                  <label className="flex items-center gap-2 text-sm text-foreground">
                    <input
                      type="checkbox"
                      checked={row.only_primary_attribution}
                      onChange={(e) =>
                        updateApp(idx, {
                          only_primary_attribution: e.target.checked
                        })
                      }
                      className="h-4 w-4 rounded border-border bg-background"
                    />
                    So atribuicao primaria
                  </label>
                </div>
              </div>
              {budgetMode === "per_platform" && (
                <Field label="Budget mensal" hint={`em ${moedaSym}`}>
                  <PtBrCurrencyInput
                    value={row.budget_monthly}
                    onChange={(v) => updateApp(idx, { budget_monthly: v })}
                    prefix={moedaSym}
                    aria-label={`Budget mensal app ${idx + 1}`}
                  />
                </Field>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={addApp}
            className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border bg-background px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-primary/40 hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
            Adicionar plataforma
          </button>
        </div>
      </Section>

      <Section
        title="Publishers"
        hint="Quem entrega a campanha: media sources + PO (payout) por evento"
      >
        <div className="space-y-3">
          {publishers.length === 0 && (
            <p className="text-xs text-muted">
              Nenhum publisher cadastrado. Cada publisher tem suas media sources
              e o PO (repasse) por evento.
            </p>
          )}
          {publishers.map((pub, pubIdx) => (
            <div
              key={pubIdx}
              className="space-y-4 rounded-lg border border-border bg-background p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                  Publisher {pubIdx + 1}
                </p>
                <button
                  type="button"
                  onClick={() => removePublisher(pubIdx)}
                  className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-muted transition-colors hover:border-danger/40 hover:text-danger"
                  title="Remover publisher"
                  aria-label="Remover publisher"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr,140px]">
                <Field label="Fornecedor">
                  <SupplierCombobox
                    suppliers={suppliers}
                    loading={suppliersLoading}
                    value={pub.supplier_id}
                    fallbackName={pub.nome}
                    onSelect={(s) => selectPublisherSupplier(pubIdx, s)}
                  />
                </Field>
                <Field label="Moeda do PO" hint="aplica a todos os POs">
                  <select
                    value={pub.moeda}
                    onChange={(e) =>
                      updatePublisher(pubIdx, {
                        moeda: e.target.value as Moeda
                      })
                    }
                    className={inputCls}
                    aria-label="Moeda do PO do publisher"
                  >
                    {MOEDA_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              {/* Media sources (strings, lista dinamica) */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  Media sources
                  <span className="ml-1 text-xs font-normal text-muted">
                    (ex: googleadwords_int)
                  </span>
                </label>
                <div className="space-y-2">
                  {pub.media_sources.map((ms, msIdx) => (
                    <FormMediaSourceRow
                      key={ms.id || `new-${msIdx}`}
                      ms={ms}
                      canRemove={pub.media_sources.length > 1}
                      onChangeName={(value) =>
                        updatePublisherMediaSourceName(pubIdx, msIdx, value)
                      }
                      onChangeLink={(value) =>
                        updatePublisherMediaSourceLink(pubIdx, msIdx, value)
                      }
                      onRemove={() =>
                        removePublisherMediaSource(pubIdx, msIdx)
                      }
                      onToggled={(patch) =>
                        setMediaSourceState(pubIdx, msIdx, patch)
                      }
                    />
                  ))}
                  <button
                    type="button"
                    onClick={() => addPublisherMediaSource(pubIdx)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border bg-surface px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-primary/40 hover:text-foreground"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Adicionar media source
                  </button>
                </div>
              </div>

              {/* PO por evento (cada evento com cap opcional proprio) */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  PO por evento
                  <span className="ml-1 text-xs font-normal text-muted">
                    (repasse em {moedaShort(pub.moeda)} + cap opcional por evento)
                  </span>
                </label>
                {eventoNomes.length === 0 ? (
                  <p className="text-xs text-muted">
                    Cadastre eventos pagos acima (com nome) para definir o PO por
                    evento.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {pub.payouts.map((po, poIdx) => (
                      <div
                        key={po.evento_nome}
                        className="space-y-2 rounded-lg border border-border/60 bg-background p-2"
                      >
                        <div className="grid grid-cols-[1fr,160px] items-center gap-2">
                          <span className="truncate text-sm font-medium text-foreground">
                            {po.evento_nome}
                          </span>
                          <PtBrCurrencyInput
                            value={po.payout}
                            onChange={(v) =>
                              updatePublisherPayout(pubIdx, poIdx, v)
                            }
                            prefix={moedaShort(pub.moeda)}
                            aria-label={`Payout ${po.evento_nome}`}
                          />
                        </div>
                        {/* Cap deste (publisher, evento) — opcional. Coexiste
                            com o cap geral do publisher abaixo. */}
                        <CapBlock
                          cap={po.cap}
                          history={po.caps_historico}
                          onChange={(patch) =>
                            updatePublisherPayoutCap(pubIdx, poIdx, patch)
                          }
                          title={`Cap do evento "${po.evento_nome}"`}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Cap GERAL do publisher (coexiste com os caps por evento acima) */}
              <CapBlock
                cap={pub.cap}
                history={pub.caps_historico}
                onChange={(patch) => updatePublisherCap(pubIdx, patch)}
                title="Cap geral do publisher"
              />
            </div>
          ))}
          <button
            type="button"
            onClick={addPublisher}
            className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border bg-background px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-primary/40 hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
            Adicionar publisher
          </button>
        </div>
      </Section>

      <Section title="Criativo e observacoes">
        <Field label="Criativo" hint="Caminho, link ou descricao">
          <textarea
            value={criativo}
            onChange={(e) => setCriativo(e.target.value)}
            rows={3}
            className={textareaCls}
            placeholder="Ex: drive.google.com/... ou descricao do criativo"
          />
        </Field>
        <Field label="Observacoes">
          <textarea
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            rows={3}
            className={textareaCls}
            placeholder="Notas internas, alinhamentos, etc."
          />
        </Field>
      </Section>

      <div className="flex items-center justify-end gap-2 pt-2">
        <Link
          href={isEdit && campanhaId ? `/campanhas/${campanhaId}` : "/campanhas"}
          className="rounded-lg border border-border bg-background px-4 py-2 text-sm text-muted transition-colors hover:text-foreground"
        >
          Cancelar
        </Link>
        <button
          type="submit"
          disabled={submitting}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {submitting
            ? isEdit
              ? "Salvando..."
              : "Criando..."
            : isEdit
            ? "Salvar alteracoes"
            : "Criar campanha"}
        </button>
      </div>

      {pendingSubmit && (
        <CapEffectiveDateModal
          publishers={capRenegPublishers}
          onConfirm={(date) => setCapEffectiveDate(date)}
          onCancel={() => {
            setPendingSubmit(false);
            setCapRenegPublishers([]);
          }}
        />
      )}

      {pendingEventoCapSubmit && (
        <EventoCapReasonModal
          eventos={eventoCapRenegEventos}
          onConfirm={(reason) => setEventoCapReason(reason)}
          onCancel={() => {
            setPendingEventoCapSubmit(false);
            setEventoCapRenegEventos([]);
          }}
        />
      )}
    </form>
  );
}

function fmtDateBr(s: string | null | undefined): string {
  if (!s) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(s);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("pt-BR");
}

function capTipoLabel(t: CampanhaCapTipo): string {
  return t === "mensal" ? "Mensal" : t === "diario" ? "Diario" : "Nenhum";
}

function capUnidadeLabel(u: CampanhaCapUnidade): string {
  return u === "usd" ? "US$" : "eventos";
}

/** Resumo de uma vigencia de cap (ex: "Mensal · 1.000 eventos · 01/06 → atual"). */
function capHistLabel(h: CampanhaCapHistorico): string {
  const valor = h.valor != null ? formatNumberPtBr(h.valor) : "—";
  const unid = capUnidadeLabel((h.unidade || "eventos") as CampanhaCapUnidade);
  const ini = h.vigencia_inicio ? fmtDateBr(h.vigencia_inicio) : "—";
  const fim = h.vigencia_fim ? fmtDateBr(h.vigencia_fim) : "atual";
  return `${capTipoLabel((h.tipo || "nenhum") as CampanhaCapTipo)} · ${valor} ${unid} · ${ini} → ${fim}`;
}

// Bloco "Cap de eventos" de um publisher: tipo (Nenhum/Mensal/Diario), unidade
// (Eventos/US$), valor (mascara PT-BR) e vigencia. Mostra o historico read-only.
function CapBlock({
  cap,
  history,
  onChange,
  title = "Cap de eventos",
  hideVigenciaFim = false,
  renegNote
}: {
  cap: CapRow;
  history: CampanhaCapHistorico[];
  onChange: (patch: Partial<CapRow>) => void;
  /** Titulo do bloco (default "Cap de eventos"; evento usa "Cap deste evento"). */
  title?: string;
  /** Esconde o campo "Vigencia: fim" (cap de evento nao usa vigencia_fim). */
  hideVigenciaFim?: boolean;
  /** Override do aviso de renegociacao (publisher = data efetiva; evento = motivo). */
  renegNote?: string;
}) {
  const active = cap.tipo !== "nenhum";
  return (
    <div className="rounded-lg border border-border bg-surface/40 p-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
        {title}
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[150px,130px,1fr]">
        <Field label="Tipo">
          <select
            value={cap.tipo}
            onChange={(e) =>
              onChange({ tipo: e.target.value as CampanhaCapTipo })
            }
            className={inputCls}
            aria-label="Tipo de cap"
          >
            {[
              { value: "nenhum", label: "Nenhum" },
              { value: "mensal", label: "Mensal" },
              { value: "diario", label: "Diario" }
            ].map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </Field>
        {active && (
          <Field label="Unidade">
            <select
              value={cap.unidade}
              onChange={(e) =>
                onChange({ unidade: e.target.value as CampanhaCapUnidade })
              }
              className={inputCls}
              aria-label="Unidade do cap"
            >
              <option value="eventos">Eventos</option>
              <option value="usd">US$</option>
            </select>
          </Field>
        )}
        {active && (
          <Field
            label={`Valor (${capUnidadeLabel(cap.unidade)}${
              cap.tipo === "diario" ? "/dia" : "/mes"
            })`}
          >
            <PtBrCurrencyInput
              value={cap.valor}
              onChange={(v) => onChange({ valor: v })}
              prefix={cap.unidade === "usd" ? "US$" : "#"}
              aria-label="Valor do cap"
            />
          </Field>
        )}
      </div>
      {active && (
        <>
          <div
            className={`mt-3 grid grid-cols-1 gap-3 ${
              hideVigenciaFim ? "" : "sm:grid-cols-2"
            }`}
          >
            <Field label="Vigencia: inicio">
              <input
                type="date"
                value={cap.vigencia_inicio}
                onChange={(e) =>
                  onChange({ vigencia_inicio: e.target.value })
                }
                className={inputCls}
                aria-label="Inicio da vigencia do cap"
              />
            </Field>
            {!hideVigenciaFim && (
              <Field label="Vigencia: fim (opcional)">
                <input
                  type="date"
                  value={cap.vigencia_fim}
                  onChange={(e) => onChange({ vigencia_fim: e.target.value })}
                  className={inputCls}
                  aria-label="Fim da vigencia do cap"
                />
              </Field>
            )}
          </div>
          <p className="mt-1 text-xs text-muted">
            {cap.tipo === "diario"
              ? "Cap diario corta dia-a-dia (sem netting)."
              : "Cap mensal corta no acumulado do mes."}
            {cap.initial != null &&
              (renegNote ??
                " Mudar o valor pede a data efetiva (vira nova vigencia).")}
          </p>
        </>
      )}
      {history && history.length > 0 && (
        <div className="mt-3 border-t border-border pt-2">
          <p className="mb-1 text-xs font-medium text-muted">
            Historico de vigencias
          </p>
          <ul className="space-y-0.5">
            {history
              .slice()
              .sort((a, b) =>
                (a.vigencia_inicio || "").localeCompare(b.vigencia_inicio || "")
              )
              .map((h, i) => (
                <li key={i} className="text-xs text-muted">
                  • {capHistLabel(h)}
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// Modal simples (so data) pra capturar a data efetiva da renegociacao do cap.
// Reusa o visual do ReasonDateModal, mas sem o select de motivo.
function CapEffectiveDateModal({
  publishers,
  onConfirm,
  onCancel
}: {
  publishers: string[];
  onConfirm: (date: string) => void;
  onCancel: () => void;
}) {
  const [date, setDate] = useState(todayIso());
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-xl">
        <h3 className="mb-2 text-base font-semibold text-foreground">
          Data efetiva da mudanca de cap
        </h3>
        <p className="mb-4 text-sm text-muted">
          O cap mudou para{" "}
          {publishers.length === 1
            ? publishers[0]
            : `${publishers.length} caps`}
          . Informe a partir de que dia o novo cap vale — vira uma nova vigencia
          (o anterior fica no historico).
        </p>
        <label className="mb-1 block text-xs font-medium text-muted">
          Data efetiva
        </label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          autoFocus
          className={inputCls + " mb-4"}
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-border bg-background px-4 py-2 text-sm text-muted transition-colors hover:text-foreground"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => date && onConfirm(date)}
            disabled={!date}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            Confirmar e salvar
          </button>
        </div>
      </div>
    </div>
  );
}

// Modal simples (so motivo) pra capturar o motivo da renegociacao do cap de um
// evento. Espelha o CapEffectiveDateModal, mas com input de texto (motivo).
function EventoCapReasonModal({
  eventos,
  onConfirm,
  onCancel
}: {
  eventos: string[];
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  const trimmed = reason.trim();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-xl">
        <h3 className="mb-2 text-base font-semibold text-foreground">
          Motivo da mudanca de cap
        </h3>
        <p className="mb-4 text-sm text-muted">
          O cap mudou para{" "}
          {eventos.length === 1
            ? `o evento "${eventos[0]}"`
            : `${eventos.length} eventos`}
          . Informe o motivo da renegociacao — o novo cap vale a partir da data de
          inicio da vigencia informada (o anterior fica no historico).
        </p>
        <label className="mb-1 block text-xs font-medium text-muted">
          Motivo
        </label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          autoFocus
          rows={3}
          placeholder="Ex: renegociacao com o cliente, ajuste de budget..."
          className={textareaCls + " mb-4"}
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-border bg-background px-4 py-2 text-sm text-muted transition-colors hover:text-foreground"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => trimmed && onConfirm(trimmed)}
            disabled={!trimmed}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            Confirmar e salvar
          </button>
        </div>
      </div>
    </div>
  );
}

// Linha de media source dentro do form. Se a ms ja tem id (esta salva), mostra
// botao Pausar/Reativar que faz PATCH direto no backend e atualiza o estado
// local. Media source nova (sem id) so tem input + lixeira.
function FormMediaSourceRow({
  ms,
  canRemove,
  onChangeName,
  onChangeLink,
  onRemove,
  onToggled
}: {
  ms: MediaSourceRow;
  canRemove: boolean;
  onChangeName: (value: string) => void;
  onChangeLink: (value: string) => void;
  onRemove: () => void;
  onToggled: (patch: Partial<MediaSourceRow>) => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const hasId = Boolean(ms.id);

  const patch = async (
    active: boolean,
    reason?: string,
    deactivatedAt?: string
  ) => {
    if (!ms.id) return;
    setBusy(true);
    try {
      await apiFetch(`/campanhas/publishers/media-sources/${ms.id}`, {
        method: "PATCH",
        body: JSON.stringify(
          active ? { active } : { active, reason, deactivated_at: deactivatedAt }
        )
      });
      toast.success(
        active ? "Media source reativada." : "Media source desativada."
      );
      setConfirmOpen(false);
      if (active) {
        onToggled({
          active: true,
          deactivated_reason: null,
          deactivated_at: null,
          deactivated_registered_at: null
        });
      } else {
        onToggled({
          active: false,
          deactivated_reason: reason ?? null,
          // data efetiva = a escolhida (default hoje); registrado = now()
          deactivated_at: deactivatedAt
            ? `${deactivatedAt}T00:00:00`
            : new Date().toISOString(),
          deactivated_registered_at: new Date().toISOString()
        });
      }
    } catch (err: any) {
      toast.error(err?.message || "Falha ao atualizar media source.");
    } finally {
      setBusy(false);
    }
  };

  const removeBtn = (
    <button
      type="button"
      onClick={onRemove}
      disabled={!canRemove}
      className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-muted transition-colors hover:border-danger/40 hover:text-danger disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-border disabled:hover:text-muted"
      title="Remover media source"
      aria-label="Remover media source"
    >
      <Trash2 className="h-4 w-4" />
    </button>
  );

  // Input de link (URL) opcional da media source. So salva/exibe, sem validacao.
  const linkInput = (
    <input
      type="text"
      value={ms.link}
      onChange={(e) => onChangeLink(e.target.value)}
      placeholder="Link (https://...)"
      className={`${inputCls} text-xs`}
    />
  );

  // Inativa: input apagado/riscado + badge + justificativa + data, botao Reativar.
  if (hasId && !ms.active) {
    return (
      <div className="flex flex-col gap-1 rounded-lg border border-dashed border-border bg-surface/40 px-2 py-2">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={ms.name}
            onChange={(e) => onChangeName(e.target.value)}
            className={`${inputCls} text-muted line-through opacity-60`}
          />
          <span className="rounded-md bg-danger/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-danger">
            Inativa
          </span>
          <button
            type="button"
            onClick={() => patch(true)}
            disabled={busy}
            className="inline-flex h-9 flex-shrink-0 items-center gap-1 rounded-lg border border-border bg-surface px-2.5 text-xs text-muted transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-50"
            title="Reativar media source"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RotateCcw className="h-3.5 w-3.5" />
            )}
            Reativar
          </button>
          {removeBtn}
        </div>
        {(ms.deactivated_reason || ms.deactivated_at) && (
          <p className="pl-1 text-xs text-muted">
            {ms.deactivated_reason && <span>— {ms.deactivated_reason}</span>}
            {ms.deactivated_at && (
              <span className="ml-1">
                Pausado em {fmtDateBr(ms.deactivated_at)}
                {ms.deactivated_registered_at && (
                  <span className="ml-1 text-[10px] text-muted/70">
                    (registrado em {fmtDateBr(ms.deactivated_registered_at)})
                  </span>
                )}
              </span>
            )}
          </p>
        )}
        {linkInput}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={ms.name}
          onChange={(e) => onChangeName(e.target.value)}
          placeholder="Ex: mobupps_int"
          className={inputCls}
        />
        {hasId ? (
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            disabled={busy}
            className="inline-flex h-9 flex-shrink-0 items-center gap-1 rounded-lg border border-border bg-surface px-2.5 text-xs text-muted transition-colors hover:border-danger/40 hover:text-danger disabled:opacity-50"
            title="Pausar media source"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Ban className="h-3.5 w-3.5" />
            )}
            Pausar
          </button>
        ) : (
          <span
            className="hidden text-[10px] text-muted sm:inline"
            title="Salve a campanha pra poder pausar esta media source"
          >
            nova
          </span>
        )}
        {removeBtn}
      </div>
      {linkInput}
      {confirmOpen && (
        <DeactivateMediaSourceModal
          name={ms.name}
          submitting={busy}
          onConfirm={(reason, deactivatedAt) =>
            patch(false, reason, deactivatedAt)
          }
          onCancel={() => setConfirmOpen(false)}
        />
      )}
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-border bg-background px-3.5 py-2.5 text-sm text-foreground outline-none transition-colors focus:border-primary/60";
const textareaCls =
  "w-full resize-y rounded-lg border border-border bg-background px-3.5 py-2.5 text-sm text-foreground outline-none transition-colors focus:border-primary/60";

// Input numerico com formatacao PT-BR e prefixo de moeda.
// Aceita digitos/virgula/ponto enquanto digita; formata como "1.234,56" no blur.
function PtBrCurrencyInput({
  value,
  onChange,
  prefix,
  disabled,
  "aria-label": ariaLabel
}: {
  value: string;
  onChange: (v: string) => void;
  prefix: string;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted">
        {prefix}
      </span>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(sanitizeNumberInput(e.target.value))}
        onBlur={(e) => onChange(blurFormatNumberPtBr(e.target.value))}
        placeholder="0,00"
        aria-label={ariaLabel}
        disabled={disabled}
        className={`${inputCls} pl-9 disabled:cursor-not-allowed disabled:opacity-40`}
      />
    </div>
  );
}

function Section({
  title,
  hint,
  children
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4 rounded-xl border border-border bg-surface p-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-primary">
          {title}
        </h2>
        {hint && <p className="text-xs text-muted">{hint}</p>}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

// Combobox com busca pra escolher o fornecedor (supplier) de um publisher.
// Mostra o supplier selecionado (por id); se a campanha for antiga e o publisher
// ainda nao tiver supplier_id, cai no `fallbackName` (nome legado) ate o user
// escolher um. Lista filtravel por nome — escala pra dezenas de fornecedores.
function SupplierCombobox({
  suppliers,
  loading,
  value,
  fallbackName,
  onSelect
}: {
  suppliers: Supplier[];
  loading?: boolean;
  value: string | null;
  fallbackName?: string;
  onSelect: (s: Supplier) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(
    () => suppliers.find((s) => s.id === value) || null,
    [suppliers, value]
  );
  // Nome legado: publisher sem supplier_id (campanha antiga) ainda mostra o nome
  // texto-livre como fallback, sinalizando que precisa escolher um fornecedor.
  const legacyName = value == null ? fallbackName?.trim() || "" : "";
  const buttonLabel = selected?.name || legacyName;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return suppliers;
    return suppliers.filter((s) => (s.name || "").toLowerCase().includes(q));
  }, [suppliers, query]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`${inputCls} flex items-center justify-between gap-2 text-left`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span
          className={`truncate ${
            buttonLabel ? "text-foreground" : "text-muted"
          }`}
        >
          {buttonLabel ||
            (loading
              ? "Carregando fornecedores..."
              : "Selecione o fornecedor")}
          {legacyName && !selected ? " — sem cadastro" : ""}
        </span>
        <ChevronDown className="h-4 w-4 flex-shrink-0 text-muted" />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
          <div className="border-b border-border p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar fornecedor..."
                className={`${inputCls} pl-8`}
              />
            </div>
          </div>
          <ul className="max-h-56 overflow-auto py-1" role="listbox">
            {loading && (
              <li className="px-3 py-2 text-xs text-muted">Carregando...</li>
            )}
            {!loading && filtered.length === 0 && (
              <li className="px-3 py-2 text-xs text-muted">
                Nenhum fornecedor encontrado.
              </li>
            )}
            {filtered.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => {
                    onSelect(s);
                    setOpen(false);
                    setQuery("");
                  }}
                  className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-background ${
                    s.id === value ? "text-primary" : "text-foreground"
                  }`}
                  role="option"
                  aria-selected={s.id === value}
                >
                  <span className="truncate">{s.name}</span>
                  {s.default_moeda && (
                    <span className="flex-shrink-0 text-xs text-muted">
                      {moedaShort(String(s.default_moeda))}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  hint,
  required,
  children
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-foreground">
        {label}
        {required && <span className="text-danger"> *</span>}
        {hint && (
          <span className="ml-1 text-xs font-normal text-muted">({hint})</span>
        )}
      </label>
      {children}
    </div>
  );
}
