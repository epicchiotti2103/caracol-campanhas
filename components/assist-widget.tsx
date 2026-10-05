"use client";

/**
 * AssistWidget — chatbot flutuante de AJUDA DE USO da suite Caracol.
 *
 * Arquivo autocontido e replicado nos 5 apps (hub, tracker, nf, campanhas, gerencial).
 * Mudou aqui? Replique nos outros 4. Dependencias: react, next/navigation,
 * lucide-react, @/lib/api (apiFetch), @/lib/auth-context (useAuth) e os tokens
 * Tailwind da suite (background, foreground, surface, muted, border, primary, danger).
 *
 * Backend: POST /api/v1/assist/chat  { app, path, messages } -> { reply }
 */

import React, { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { HelpCircle, Loader2, Send, Trash2, X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

export type AssistApp = "hub" | "tracker" | "nf" | "campanhas" | "gerencial";

type Role = "user" | "assistant";
interface ChatMessage {
  role: Role;
  content: string;
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
    return parsed.filter(
      (m): m is ChatMessage =>
        m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string"
    );
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

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setMessages(loadHistory(app));
    setHydrated(true);
  }, [app]);

  useEffect(() => {
    if (hydrated) saveHistory(app, messages);
  }, [app, messages, hydrated]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, pending, error, open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
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
    try {
      const data = await apiFetch("/assist/chat", {
        method: "POST",
        body: JSON.stringify({ app, path: pathname, messages: next.slice(-MAX_HISTORY) })
      });
      const reply = typeof data?.reply === "string" ? data.reply.trim() : "";
      if (!reply) throw new Error("resposta vazia");
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setPending(false);
      inputRef.current?.focus();
    }
  }

  function clear() {
    setMessages([]);
    setError(null);
    setInput("");
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
          className="fixed bottom-4 right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-white shadow-lg transition hover:brightness-110"
        >
          <HelpCircle className="h-6 w-6" />
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
              <HelpCircle className="h-4 w-4 text-primary" />
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
                onClick={() => setOpen(false)}
                aria-label="Fechar ajuda"
                title="Fechar"
                className="rounded p-1.5 text-muted transition hover:bg-background hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm">
            <Bubble role="assistant" content={GREETING} />
            {messages.map((m, idx) => (
              <Bubble key={idx} role={m.role} content={m.content} />
            ))}
            {pending && (
              <div className="flex items-center gap-2 text-xs text-muted">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                pensando…
              </div>
            )}
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

function Bubble({ role, content }: ChatMessage) {
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
