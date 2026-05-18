"use client";

import React, { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { API_BASE_URL } from "@/lib/config";
import { Eye, EyeOff, AlertCircle, Loader2 } from "lucide-react";

const HUB_URL = process.env.NEXT_PUBLIC_HUB_URL || "https://app.aeobr.com.br";
const FORGOT_PASSWORD_URL = `${HUB_URL}/recuperar-senha`;

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!email || !password) {
      setError("Preencha todos os campos.");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || "E-mail ou senha incorretos.");
      }

      const data = await response.json();
      login(data.access_token, data.refresh_token, data.user);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-background">
      {/* Painel lateral escuro */}
      <div className="hidden lg:flex lg:w-[440px] flex-col justify-between p-12 flex-shrink-0 bg-black">
        <div>
          <div className="mb-12 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-base font-bold text-black">
              C
            </div>
            <span className="text-base font-semibold tracking-wide text-orange-50">
              Caracol Campanhas
            </span>
          </div>

          <h2 className="mb-4 text-3xl font-semibold leading-snug text-orange-50">
            Cadastre e gerencie<br />campanhas da<br />suite Caracol.
          </h2>
          <p className="text-sm leading-relaxed text-orange-100/50">
            Fonte de verdade pra campanhas usadas no NF, no Tracker e nos demais apps da suite.
          </p>
        </div>

        <div className="border-t border-white/10 pt-6">
          <p className="text-xs text-orange-100/40">Suite Caracol</p>
          <p className="mt-0.5 text-sm font-medium text-orange-50">AEO Brasil</p>
        </div>
      </div>

      {/* Painel direito (form) */}
      <div className="flex flex-1 items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-md">
          <div className="mb-10 flex items-center gap-3 lg:hidden">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-sm font-bold text-black">
              C
            </div>
            <span className="text-base font-semibold text-foreground">Caracol Campanhas</span>
          </div>

          <div className="mb-8">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-widest text-primary">
              Acesso a campanhas
            </h4>
            <h1 className="text-2xl font-semibold text-foreground">Bem-vindo de volta</h1>
            <p className="mt-1 text-sm text-muted">
              Entre com suas credenciais para acessar as campanhas.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="flex items-start gap-2.5 rounded-lg border border-danger/20 bg-danger/10 p-3">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-danger" />
                <p className="text-sm text-danger">{error}</p>
              </div>
            )}

            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">E-mail</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="seu@email.com.br"
                className="w-full rounded-lg border border-border bg-surface px-3.5 py-2.5 text-sm text-foreground outline-none transition-colors focus:border-primary/60"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Senha</label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-lg border border-border bg-surface px-3.5 py-2.5 pr-10 text-sm text-foreground outline-none transition-colors focus:border-primary/60"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted transition-colors hover:text-foreground"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-end">
              <a
                href={FORGOT_PASSWORD_URL}
                className="text-xs text-muted transition-colors hover:text-foreground hover:underline"
              >
                Esqueci minha senha
              </a>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Entrar"}
            </button>
          </form>

          <p className="mt-8 text-center text-xs text-muted">
            Problemas para acessar?{" "}
            <a href="mailto:du_sp12@hotmail.com" className="underline hover:text-foreground">
              Fale com a equipe Caracol
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
