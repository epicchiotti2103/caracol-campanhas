"use client";

/**
 * AssistWidget — chatbot flutuante de AJUDA DE USO da suite Caracol.
 *
 * Arquivo autocontido e replicado nos 5 apps (hub, tracker, nf, campanhas, gerencial).
 * Mudou aqui? Replique nos outros 4. Dependencias: react, next/navigation,
 * lucide-react, js-cookie, @/lib/config (API_BASE_URL), @/lib/api (apiFetch),
 * @/lib/auth-context (useAuth) e os tokens Tailwind da suite (background,
 * foreground, surface, muted, border, primary, danger).
 *
 * Backend:
 *   POST /api/v1/assist/chat/stream { app, path, messages } -> text/event-stream
 *     eventos `data: <json>`: {type:"status",text} | {type:"delta",text} |
 *     {type:"done", resposta_id?, origem?} | {type:"error",detail}
 *   POST /api/v1/assist/chat        { app, path, messages } -> { reply, resposta_id?, origem? }  (fallback)
 *   POST /api/v1/assist/feedback    { resposta_id, voto: 1 | -1 } -> { ok: true }
 *
 * `origem`: "modelo" (gerada agora) | "arquivo" (resposta salva de pergunta igual).
 * Sem `resposta_id` (backend antigo / resposta de bloqueio) nao mostra 👍/👎.
 *
 * Fluxo: tenta o stream via fetch direto. Se o fetch falhar, a resposta nao for ok
 * (inclui 401 e 404) ou nao for event-stream, refaz pela rota antiga via apiFetch
 * (que trata refresh de token). Excecao: 429/403/503 com `detail` -> erro direto.
 */

import React, { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Loader2, Send, ThumbsDown, ThumbsUp, Trash2, X } from "lucide-react";
import Cookies from "js-cookie";
import { apiFetch } from "@/lib/api";
import { API_BASE_URL } from "@/lib/config";
import { useAuth } from "@/lib/auth-context";

export type AssistApp = "hub" | "tracker" | "nf" | "campanhas" | "gerencial";

type Role = "user" | "assistant";
type RespostaId = string | number;
type Voto = 1 | -1;
interface ChatMessage {
  role: Role;
  content: string;
  /** so em resposta do bot vinda de backend novo */
  resposta_id?: RespostaId;
  origem?: string;
  voto?: Voto;
}

interface ReplyMeta {
  resposta_id?: RespostaId;
  origem?: string;
}

function readMeta(obj: unknown): ReplyMeta {
  const meta: ReplyMeta = {};
  if (!obj || typeof obj !== "object") return meta;
  const o = obj as Record<string, unknown>;
  const id = o.resposta_id;
  if ((typeof id === "string" && id) || (typeof id === "number" && Number.isFinite(id))) {
    meta.resposta_id = id;
  }
  if (typeof o.origem === "string" && o.origem) meta.origem = o.origem;
  return meta;
}

const GREETING = "Oi! Pergunte como usar qualquer tela da suite.";
const MAX_HISTORY = 10;
const MAX_STORED = 50;
const HIDDEN_PREFIXES = ["/login", "/recuperar-senha", "/redefinir-senha", "/aceitar-convite"];

// ---------- sessionStorage (opcional, nunca quebra) ----------

function storageKey(app: AssistApp) {
  return `caracol_assist_${app}`;
}

function loadHistory(app: AssistApp): ChatMessage[] {
  try {
    const raw = window.sessionStorage.getItem(storageKey(app));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: ChatMessage[] = [];
    for (const m of parsed) {
      if (!m || (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string") continue;
      const msg: ChatMessage = { role: m.role, content: m.content };
      if (m.role === "assistant") {
        Object.assign(msg, readMeta(m));
        if (msg.resposta_id !== undefined && (m.voto === 1 || m.voto === -1)) msg.voto = m.voto;
      }
      out.push(msg);
    }
    return out;
  } catch {
    return [];
  }
}

function saveHistory(app: AssistApp, messages: ChatMessage[]) {
  try {
    if (messages.length === 0) {
      window.sessionStorage.removeItem(storageKey(app));
    } else {
      window.sessionStorage.setItem(storageKey(app), JSON.stringify(messages.slice(-MAX_STORED)));
    }
  } catch {
    // storage bloqueado/cheio — segue so em memoria
  }
}

// ---------- erros ----------
// apiFetch (lib/api.ts) nao expoe o status HTTP, so a mensagem (`detail`) do backend.
// Mapeamos por palavra-chave; o backend devolve `detail` em pt-br.

function friendlyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : "";
  const m = msg.toLowerCase();
  if (m.includes("429") || m.includes("muitas") || m.includes("rate") || m.includes("too many")) {
    return "Muitas perguntas seguidas, tenta de novo em alguns minutos.";
  }
  if (m.includes("403") || m.includes("acesso") || m.includes("forbidden") || m.includes("permiss")) {
    return "Voce nao tem acesso ao assistente.";
  }
  if (m.includes("503") || m.includes("indispon") || m.includes("unavailable")) {
    return "Assistente indisponivel no momento. Tenta de novo mais tarde.";
  }
  if (m.includes("sessao expirada")) {
    return "Sessao expirada. Faca login de novo.";
  }
  return "Nao consegui responder agora. Tenta de novo em instantes.";
}

function errorForStatus(status: number): string | null {
  if (status === 429) return "Muitas perguntas seguidas, tenta de novo em alguns minutos.";
  if (status === 403) return "Voce nao tem acesso ao assistente.";
  if (status === 503) return "Assistente indisponivel no momento. Tenta de novo mais tarde.";
  return null;
}

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === "AbortError") ||
    (err instanceof Error && err.name === "AbortError")
  );
}

// ---------- streaming SSE ----------

type StreamEvent =
  | { type: "status"; text: string }
  | { type: "delta"; text: string }
  | { type: "done"; resposta_id?: RespostaId; origem?: string }
  | { type: "error"; detail: string };

/** Erro que deve ser mostrado direto (sem fallback pra rota antiga). */
class DirectError extends Error {}

/** Erro com mensagem ja amigavel, mostrada como esta. */
class ShownError extends Error {}

/** Sinaliza que o stream nao pode ser usado e a rota antiga deve ser tentada. */
class FallbackSignal extends Error {}

function parseEventBlock(block: string): StreamEvent | null {
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (!line.startsWith("data:")) continue; // ignora comentarios (":"), event:, id:
    let v = line.slice(5);
    if (v.startsWith(" ")) v = v.slice(1);
    data.push(v);
  }
  if (data.length === 0) return null;
  try {
    const obj = JSON.parse(data.join("\n"));
    if (!obj || typeof obj.type !== "string") return null;
    return obj as StreamEvent;
  } catch {
    return null;
  }
}

/**
 * Le o corpo SSE e chama onEvent pra cada evento. Robusto a eventos quebrados
 * entre chunks (acumula em buffer ate achar a linha em branco separadora).
 */
async function readSSE(body: ReadableStream<Uint8Array>, onEvent: (ev: StreamEvent) => void) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const flush = (final: boolean) => {
    buffer = buffer.replace(/\r\n?/g, "\n");
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const ev = parseEventBlock(block);
      if (ev) onEvent(ev);
    }
    if (final && buffer.trim()) {
      const ev = parseEventBlock(buffer);
      buffer = "";
      if (ev) onEvent(ev);
    }
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      flush(false);
    }
    buffer += decoder.decode();
    flush(true);
  } catch (err) {
    reader.cancel().catch(() => {}); // fecha a conexao (erro do servidor ou abort)
    throw err;
  }
}

// ---------- markdown minimo e seguro (so nos React, sem HTML cru) ----------

function renderInline(text: string, keyBase: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  // `code` | **negrito** | *italico*
  const re = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const tok = match[0];
    const key = `${keyBase}-${i++}`;
    if (tok.startsWith("`")) {
      out.push(
        <code key={key} className="rounded bg-background/70 px-1 py-0.5 font-mono text-[12px]">
          {tok.slice(1, -1)}
        </code>
      );
    } else if (tok.startsWith("**")) {
      out.push(
        <strong key={key} className="font-semibold">
          {tok.slice(2, -2)}
        </strong>
      );
    } else {
      out.push(<em key={key}>{tok.slice(1, -1)}</em>);
    }
    last = match.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let k = 0;

  while (i < lines.length) {
    const line = lines[i];

    // bloco de codigo ```
    if (line.trim().startsWith("```")) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        buf.push(lines[i]);
        i++;
      }
      i++; // fecha ```
      blocks.push(
        <pre
          key={k++}
          className="overflow-x-auto whitespace-pre rounded bg-background/70 p-2 font-mono text-[12px]"
        >
          {buf.join("\n")}
        </pre>
      );
      continue;
    }

    // lista nao ordenada
    if (/^\s*[-*•]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*•]\s+/, ""));
        i++;
      }
      const bk = k++;
      blocks.push(
        <ul key={bk} className="list-disc space-y-0.5 pl-5">
          {items.map((it, j) => (
            <li key={j}>{renderInline(it, `${bk}-${j}`)}</li>
          ))}
        </ul>
      );
      continue;
    }

    // lista ordenada
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ""));
        i++;
      }
      const bk = k++;
      blocks.push(
        <ol key={bk} className="list-decimal space-y-0.5 pl-5">
          {items.map((it, j) => (
            <li key={j}>{renderInline(it, `${bk}-${j}`)}</li>
          ))}
        </ol>
      );
      continue;
    }

    // titulo (# ..) vira negrito
    const heading = /^\s*#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      const bk = k++;
      blocks.push(
        <p key={bk} className="font-semibold">
          {renderInline(heading[1], `${bk}`)}
        </p>
      );
      i++;
      continue;
    }

    if (line.trim() === "") {
      i++;
      continue;
    }

    // paragrafo: junta linhas ate linha vazia ou inicio de outro bloco
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].trim().startsWith("```") &&
      !/^\s*[-*•]\s+/.test(lines[i]) &&
      !/^\s*\d+[.)]\s+/.test(lines[i]) &&
      !/^\s*#{1,6}\s+/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    const bk = k++;
    blocks.push(
      <p key={bk}>
        {para.map((p, j) => (
          <React.Fragment key={j}>
            {j > 0 && <br />}
            {renderInline(p, `${bk}-${j}`)}
          </React.Fragment>
        ))}
      </p>
    );
  }

  return <div className="space-y-2 break-words">{blocks}</div>;
}

// ---------- componente ----------

export function AssistWidget({ app }: { app: AssistApp }) {
  const { user, loading } = useAuth();
  const pathname = usePathname() || "/";

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  // resposta em andamento (stream): status antes do 1o delta, depois o texto crescendo
  const [live, setLive] = useState<{ status: string | null; text: string } | null>(null);
  // feedback: votos em voo e "Obrigado!" temporario (chave = String(resposta_id))
  const [voting, setVoting] = useState<Record<string, true>>({});
  const [thanks, setThanks] = useState<string | null>(null);
  const thanksTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const reqIdRef = useRef(0);
  const stickRef = useRef(true); // acompanha o fim enquanto o usuario nao rolar pra cima

  function abortCurrent() {
    reqIdRef.current++; // invalida qualquer atualizacao pendente da requisicao anterior
    abortRef.current?.abort();
    abortRef.current = null;
    setLive(null);
    setPending(false);
  }

  useEffect(() => {
    return () => {
      reqIdRef.current++;
      abortRef.current?.abort();
      if (thanksTimer.current) clearTimeout(thanksTimer.current);
    };
  }, []);

  useEffect(() => {
    setMessages(loadHistory(app));
    setHydrated(true);
  }, [app]);

  useEffect(() => {
    if (hydrated) saveHistory(app, messages);
  }, [app, messages, hydrated]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, pending, error, open, live]);

  useEffect(() => {
    if (open) {
      stickRef.current = true;
      inputRef.current?.focus();
    }
  }, [open]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        abortCurrent();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const hidden =
    loading || !user || HIDDEN_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
  if (hidden) return null;

  async function send() {
    const text = input.trim();
    if (!text || pending) return;
    const next: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setError(null);
    setPending(true);
    setLive({ status: null, text: "" });
    stickRef.current = true;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const myId = ++reqIdRef.current;
    const alive = () => reqIdRef.current === myId;
    // so role/content vao pro backend (resposta_id/origem/voto ficam no cliente)
    const history = next.slice(-MAX_HISTORY).map((m) => ({ role: m.role, content: m.content }));
    const body = JSON.stringify({ app, path: pathname, messages: history });

    let acc = "";
    try {
      try {
        const meta = await streamChat(body, controller.signal, (ev) => {
          if (!alive()) return;
          if (ev.type === "status") {
            if (!acc) setLive({ status: String(ev.text ?? ""), text: "" });
          } else if (ev.type === "delta") {
            acc += String(ev.text ?? "");
            setLive({ status: null, text: acc });
          } else if (ev.type === "error") {
            throw new DirectError(String(ev.detail ?? ""));
          }
        });
        if (!alive()) return;
        const reply = acc.trim();
        if (!reply) throw new DirectError("resposta vazia");
        setMessages((prev) => [...prev, { role: "assistant", content: reply, ...meta }]);
      } catch (err) {
        if (!(err instanceof FallbackSignal)) throw err;
        if (!alive()) return;
        // rota antiga (trata refresh de token e erros por `detail`)
        const data = await apiFetch("/assist/chat", {
          method: "POST",
          body,
          signal: controller.signal
        });
        if (!alive()) return;
        const reply = typeof data?.reply === "string" ? data.reply.trim() : "";
        if (!reply) throw new Error("resposta vazia");
        setMessages((prev) => [...prev, { role: "assistant", content: reply, ...readMeta(data) }]);
      }
    } catch (err) {
      if (!alive() || isAbortError(err)) return;
      // erro no meio do stream: mantem o que ja veio e acrescenta o erro
      const partial = acc.trim();
      if (partial) setMessages((prev) => [...prev, { role: "assistant", content: partial }]);
      setError(err instanceof ShownError ? err.message : friendlyError(err));
    } finally {
      if (alive()) {
        abortRef.current = null;
        setLive(null);
        setPending(false);
        inputRef.current?.focus();
      }
    }
  }

  async function vote(id: RespostaId, voto: Voto) {
    const key = String(id);
    if (voting[key]) return;
    const target = messages.find((m) => m.role === "assistant" && m.resposta_id === id);
    if (!target || target.voto !== undefined) return;
    const setVoto = (v: Voto | undefined) =>
      setMessages((prev) =>
        prev.map((m) => (m.role === "assistant" && m.resposta_id === id ? { ...m, voto: v } : m))
      );
    setVoting((p) => ({ ...p, [key]: true }));
    setVoto(voto); // otimista
    try {
      await apiFetch("/assist/feedback", {
        method: "POST",
        body: JSON.stringify({ resposta_id: id, voto })
      });
      if (thanksTimer.current) clearTimeout(thanksTimer.current);
      setThanks(key);
      thanksTimer.current = setTimeout(() => setThanks(null), 2000);
    } catch {
      setVoto(undefined); // volta ao estado anterior, sem barulho
    } finally {
      setVoting((p) => {
        const n = { ...p };
        delete n[key];
        return n;
      });
    }
  }

  function clear() {
    abortCurrent();
    setMessages([]);
    setError(null);
    setInput("");
  }

  function close() {
    abortCurrent();
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Abrir ajuda"
          title="Ajuda Caracol"
          className="fixed bottom-4 right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full border border-border bg-white shadow-lg transition hover:scale-105"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assist-caracol.png" alt="" className="h-11 w-11" />
        </button>
      )}

      {open && (
        <div
          role="dialog"
          aria-label="Ajuda Caracol"
          className="fixed inset-0 z-40 flex flex-col overflow-hidden border-border bg-background text-foreground shadow-2xl sm:inset-auto sm:bottom-4 sm:right-4 sm:h-[520px] sm:max-h-[calc(100vh-2rem)] sm:w-[380px] sm:rounded-xl sm:border"
        >
          <div className="flex items-center justify-between border-b border-border bg-surface px-4 py-3">
            <div className="flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/assist-caracol.png" alt="" className="h-6 w-6" />
              <span className="text-sm font-semibold">Ajuda Caracol</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={clear}
                disabled={pending || (messages.length === 0 && !error)}
                aria-label="Limpar conversa"
                title="Limpar conversa"
                className="rounded p-1.5 text-muted transition hover:bg-background hover:text-foreground disabled:opacity-40"
              >
                <Trash2 className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={close}
                aria-label="Fechar ajuda"
                title="Fechar"
                className="rounded p-1.5 text-muted transition hover:bg-background hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div ref={scrollRef} onScroll={onScroll} className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm">
            <Bubble role="assistant" content={GREETING} />
            {messages.map((m, idx) => {
              if (m.role !== "assistant" || m.resposta_id === undefined) {
                return <Bubble key={idx} role={m.role} content={m.content} />;
              }
              const id = m.resposta_id;
              const key = String(id);
              const locked = m.voto !== undefined || !!voting[key];
              return (
                <div key={idx} className="space-y-1">
                  {m.origem === "arquivo" && (
                    <div className="pl-1 text-[10px] text-muted">Resposta salva · se não ajudou, clique 👎</div>
                  )}
                  <Bubble role="assistant" content={m.content} />
                  <div className="flex items-center gap-1 pl-1">
                    <button
                      type="button"
                      onClick={() => void vote(id, 1)}
                      disabled={locked}
                      aria-label="Resposta ajudou"
                      title="Ajudou"
                      className="rounded p-1 text-muted transition hover:text-foreground disabled:cursor-default disabled:hover:text-muted"
                    >
                      <ThumbsUp className="h-3.5 w-3.5" fill={m.voto === 1 ? "currentColor" : "none"} />
                    </button>
                    <button
                      type="button"
                      onClick={() => void vote(id, -1)}
                      disabled={locked}
                      aria-label="Resposta nao ajudou"
                      title="Nao ajudou"
                      className="rounded p-1 text-muted transition hover:text-foreground disabled:cursor-default disabled:hover:text-muted"
                    >
                      <ThumbsDown className="h-3.5 w-3.5" fill={m.voto === -1 ? "currentColor" : "none"} />
                    </button>
                    {thanks === key && <span className="text-[10px] text-muted">Obrigado!</span>}
                  </div>
                </div>
              );
            })}
            {pending &&
              (live && live.text ? (
                <Bubble role="assistant" content={live.text} />
              ) : (
                <div className="flex justify-start">
                  <div className="flex max-w-[90%] items-center gap-2 rounded-2xl rounded-bl-sm border border-border bg-surface px-3 py-2 text-xs italic text-muted">
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                    <span>{live?.status || "pensando…"}</span>
                  </div>
                </div>
              ))}
            {error && (
              <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
                {error}
              </div>
            )}
          </div>

          <div className="border-t border-border bg-surface p-3">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                rows={2}
                maxLength={2000}
                placeholder="Como faco pra…"
                className="max-h-32 min-h-[40px] flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-primary focus:outline-none"
              />
              <button
                type="button"
                onClick={() => void send()}
                disabled={pending || !input.trim()}
                aria-label="Enviar"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-white transition hover:brightness-110 disabled:opacity-40"
              >
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </button>
            </div>
            <div className="mt-1 text-[10px] text-muted">Enter envia · Shift+Enter quebra linha</div>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Faz o POST no endpoint de stream e repassa os eventos. Lanca FallbackSignal quando
 * a rota antiga deve ser usada, DirectError pra 429/403/503 com `detail`.
 */
async function streamChat(
  body: string,
  signal: AbortSignal,
  onEvent: (ev: StreamEvent) => void
): Promise<ReplyMeta> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "text/event-stream"
  };
  const token = Cookies.get("auth_token");
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/assist/chat/stream`, { method: "POST", headers, body, signal });
  } catch (err) {
    if (isAbortError(err)) throw err;
    throw new FallbackSignal("fetch falhou");
  }

  if (!res.ok) {
    const direct = errorForStatus(res.status);
    if (direct) {
      const data = await res.json().catch(() => null);
      if (data && typeof data.detail === "string" && data.detail) throw new ShownError(direct);
    }
    throw new FallbackSignal(`HTTP ${res.status}`);
  }

  const ctype = res.headers.get("content-type") || "";
  if (!ctype.includes("text/event-stream") || !res.body) {
    res.body?.cancel().catch(() => {});
    throw new FallbackSignal("nao e event-stream");
  }

  let finished = false;
  let meta: ReplyMeta = {};
  await readSSE(res.body, (ev) => {
    if (finished) return;
    if (ev.type === "done") {
      finished = true;
      meta = readMeta(ev);
      return;
    }
    onEvent(ev);
  });
  return meta;
}

function Bubble({ role, content }: { role: Role; content: string }) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={
          isUser
            ? "max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-white"
            : "max-w-[90%] rounded-2xl rounded-bl-sm border border-border bg-surface px-3 py-2"
        }
      >
        {isUser ? content : <Markdown text={content} />}
      </div>
    </div>
  );
}

export default AssistWidget;
