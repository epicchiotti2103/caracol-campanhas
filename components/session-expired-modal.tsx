"use client";

// Replicado nos 5 apps (hub, tracker, nf, campanhas, gerencial) junto com lib/api.ts.
// Quando a sessao cai de vez, lib/api.ts dispara "caracol:session-expired" e espera
// "caracol:session-restored". Este modal pede a senha sem sair da pagina, entao o
// que estava preenchido na tela nao se perde e a request original e re-executada.

import React, { useEffect, useRef, useState } from "react";
import Cookies from "js-cookie";
import { API_BASE_URL } from "@/lib/config";
import { AlertCircle, Loader2, Lock } from "lucide-react";

const ROOT_DOMAIN = ".aeobr.com.br";

function cookieOpts(): Cookies.CookieAttributes {
  const isCrossSubdomain =
    typeof window !== "undefined" && window.location.hostname.endsWith(ROOT_DOMAIN);
  return isCrossSubdomain
    ? { expires: 7, domain: ROOT_DOMAIN, secure: true, sameSite: "lax" }
    : { expires: 7 };
}

function currentUser(): { id?: string; email?: string } | null {
  try {
    const raw = Cookies.get("user_data");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function restore(token: string | null) {
  window.dispatchEvent(new CustomEvent("caracol:session-restored", { detail: { token } }));
}

export function SessionExpiredModal() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (window as any).__caracolSessionModal = true;
    const onExpired = () => {
      setEmail(currentUser()?.email || "");
      setPassword("");
      setError("");
      setOpen(true);
    };
    window.addEventListener("caracol:session-expired", onExpired);
    return () => {
      (window as any).__caracolSessionModal = false;
      window.removeEventListener("caracol:session-expired", onExpired);
    };
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => passwordRef.current?.focus(), 50);
  }, [open]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError("Preencha e-mail e senha.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "E-mail ou senha incorretos.");
      }
      const data = await res.json();
      const previousId = currentUser()?.id;
      const opts = cookieOpts();
      Cookies.set("auth_token", data.access_token, opts);
      Cookies.set("refresh_token", data.refresh_token, opts);
      Cookies.set("user_data", JSON.stringify(data.user), opts);
      setOpen(false);
      setPassword("");
      if (previousId && data.user?.id && previousId !== data.user.id) {
        // Entrou com OUTRO usuario: a tela atual e de quem saiu, recarrega.
        window.location.reload();
        return;
      }
      restore(data.access_token);
    } catch (err: any) {
      setError(err.message || "Nao foi possivel entrar.");
    } finally {
      setLoading(false);
    }
  };

  const handleLeave = () => {
    setOpen(false);
    restore(null); // api.ts limpa os cookies e redireciona pra /login
  };

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-2xl">
        <div className="mb-4 flex items-center gap-2">
          <Lock className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">Sua sessao expirou</h2>
        </div>
        <p className="mb-5 text-sm text-muted">
          Entre de novo para continuar. O que voce estava fazendo nesta tela nao foi perdido.
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-danger/20 bg-danger/10 p-3">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-danger" />
              <p className="text-sm text-danger">{error}</p>
            </div>
          )}
          <input
            type="text"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="seu@email.com.br"
            className="w-full rounded-lg border border-border bg-background px-3.5 py-2.5 text-sm text-foreground outline-none focus:border-primary/60"
          />
          <input
            ref={passwordRef}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Senha"
            className="w-full rounded-lg border border-border bg-background px-3.5 py-2.5 text-sm text-foreground outline-none focus:border-primary/60"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleLeave}
              disabled={loading}
              className="flex-1 rounded-lg border border-border py-2.5 text-sm text-muted hover:text-foreground disabled:opacity-60"
            >
              Sair
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex flex-1 items-center justify-center rounded-lg bg-primary py-2.5 text-sm font-semibold text-black hover:opacity-90 disabled:opacity-60"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Entrar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
