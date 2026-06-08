"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState
} from "react";
import { useAuth } from "@/lib/auth-context";
import { apiFetch } from "@/lib/api";

/**
 * RBAC dinamico do Campanhas.
 *
 * No bootstrap carregamos as permissoes do usuario via
 * `GET /perms/campanhas/me` e expomos um helper `can(key)`. A UI deve gatear
 * acoes por `can(...)` em vez de checar `hub_role === "admin"` direto.
 *
 * IMPORTANTE: `lib/auth-context.tsx` e replicado nos 5 apps da suite e NAO pode
 * ser editado aqui. Por isso este provider vive num arquivo proprio do
 * Campanhas e apenas le o `user` do auth-context.
 *
 * Graceful degradation: o backend de perms pode nao estar no ar. Se a chamada
 * falhar, derivamos um fallback seguro do `hub_role`:
 *   - admin   -> ve tudo (god-mode)
 *   - campanha-> view_all + create + edit (sem delete, sem metrics_manual)
 *   - outros  -> nada (o BootstrapGate ja barra quem nao tem o app)
 */

export type PermKey =
  | "campanhas.view_all"
  | "campanhas.create"
  | "campanhas.edit"
  | "campanhas.delete"
  | "campanhas.metrics_manual";

const ALL_PERMS: PermKey[] = [
  "campanhas.view_all",
  "campanhas.create",
  "campanhas.edit",
  "campanhas.delete",
  "campanhas.metrics_manual"
];

const CAMPANHA_FALLBACK: PermKey[] = [
  "campanhas.view_all",
  "campanhas.create",
  "campanhas.edit"
];

function fallbackPerms(hubRole: string | null | undefined): PermKey[] {
  if (hubRole === "admin") return ALL_PERMS;
  if (hubRole === "campanha") return CAMPANHA_FALLBACK;
  return [];
}

interface PermsContextType {
  role: string | null;
  permissions: PermKey[];
  loading: boolean;
  /** admin tem god-mode (sempre true). */
  can: (key: PermKey) => boolean;
}

const PermsContext = createContext<PermsContextType | undefined>(undefined);

export function PermsProvider({ children }: { children: React.ReactNode }) {
  const { user, isAdmin, loading: authLoading } = useAuth();
  const [role, setRole] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<PermKey[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setRole(null);
      setPermissions([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await apiFetch("/perms/campanhas/me");
        if (cancelled) return;
        const perms = Array.isArray(res?.permissions)
          ? (res.permissions as PermKey[])
          : fallbackPerms(user.hub_role);
        setRole(res?.role ?? user.hub_role ?? null);
        setPermissions(perms);
      } catch {
        if (cancelled) return;
        // Graceful degradation: backend de perms fora do ar.
        setRole(user.hub_role ?? null);
        setPermissions(fallbackPerms(user.hub_role));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, authLoading]);

  const value = useMemo<PermsContextType>(() => {
    const set = new Set(permissions);
    return {
      role,
      permissions,
      loading,
      can: (key: PermKey) => isAdmin || set.has(key)
    };
  }, [role, permissions, loading, isAdmin]);

  return <PermsContext.Provider value={value}>{children}</PermsContext.Provider>;
}

export function usePerms() {
  const ctx = useContext(PermsContext);
  if (ctx === undefined) {
    throw new Error("usePerms must be used within a PermsProvider");
  }
  return ctx;
}

/** Atalho pra checar uma permissao. */
export function useCan() {
  return usePerms().can;
}
