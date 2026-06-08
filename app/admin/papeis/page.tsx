"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  KeyRound,
  Loader2,
  AlertCircle,
  Save,
  ShieldCheck,
  Lock
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { useAuth } from "@/lib/auth-context";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/lib/toast-context";

type CatalogItem = { key: string; label: string; group?: string };
type Matrix = Record<string, Record<string, boolean>>;
type MatrixResponse = {
  roles: string[];
  catalog: CatalogItem[];
  matrix: Matrix;
};

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  campanha: "Campanha"
};

function roleLabel(role: string): string {
  return ROLE_LABELS[role] || role;
}

export default function PapeisPage() {
  return (
    <AppShell>
      <PapeisView />
    </AppShell>
  );
}

function PapeisView() {
  const router = useRouter();
  const toast = useToast();
  const { isAdmin, loading: authLoading } = useAuth();

  const [data, setData] = useState<MatrixResponse | null>(null);
  const [matrix, setMatrix] = useState<Matrix>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Admin-only: quem nao for admin volta pra listagem.
  useEffect(() => {
    if (!authLoading && !isAdmin) {
      router.replace("/campanhas");
    }
  }, [authLoading, isAdmin, router]);

  useEffect(() => {
    if (authLoading || !isAdmin) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const res: MatrixResponse = await apiFetch("/perms/campanhas/matrix");
        if (cancelled) return;
        setData(res);
        setMatrix(res.matrix || {});
      } catch (err: any) {
        if (cancelled) return;
        setError(err?.message || "Falha ao carregar a matriz de papeis.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, isAdmin]);

  const groups = useMemo(() => {
    const cat = data?.catalog ?? [];
    const order: string[] = [];
    const byGroup = new Map<string, CatalogItem[]>();
    for (const item of cat) {
      const g = item.group || "Geral";
      if (!byGroup.has(g)) {
        byGroup.set(g, []);
        order.push(g);
      }
      byGroup.get(g)!.push(item);
    }
    return order.map((g) => ({ group: g, items: byGroup.get(g)! }));
  }, [data]);

  const editableRoles = useMemo(
    () => (data?.roles ?? []).filter((r) => r !== "admin"),
    [data]
  );

  const toggle = (role: string, key: string) => {
    setMatrix((prev) => ({
      ...prev,
      [role]: { ...(prev[role] || {}), [key]: !prev[role]?.[key] }
    }));
  };

  const save = async () => {
    setSaving(true);
    try {
      // admin e god-mode read-only: nao envia.
      const payload: Matrix = {};
      for (const role of editableRoles) {
        payload[role] = matrix[role] || {};
      }
      await apiFetch("/perms/campanhas/matrix", {
        method: "PUT",
        body: JSON.stringify({ matrix: payload })
      });
      toast.success("Permissoes salvas.");
    } catch (err: any) {
      toast.error(err?.message || "Falha ao salvar permissoes.");
    } finally {
      setSaving(false);
    }
  };

  if (authLoading || !isAdmin) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );
  }

  const roles = data?.roles ?? [];

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h4 className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary">
            <KeyRound className="h-3.5 w-3.5" />
            Admin
          </h4>
          <h1 className="text-2xl font-semibold text-foreground">
            Papeis e permissoes
          </h1>
          <p className="mt-1 text-sm text-muted">
            Defina o que cada papel pode fazer no Campanhas. O papel{" "}
            <span className="font-medium text-foreground">admin</span> tem acesso
            total (somente leitura aqui).
          </p>
        </div>
        <button
          onClick={save}
          disabled={saving || loading || !data}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Salvar
        </button>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-danger/20 bg-danger/10 p-3">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-danger" />
          <p className="text-sm text-danger">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="flex min-h-[30vh] items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      ) : !data ? null : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted">
                  Permissao
                </th>
                {roles.map((role) => (
                  <th
                    key={role}
                    className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-muted"
                  >
                    <span className="inline-flex items-center gap-1.5">
                      {role === "admin" ? (
                        <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                      ) : null}
                      {roleLabel(role)}
                      {role === "admin" && (
                        <Lock className="h-3 w-3 text-muted/60" />
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map(({ group, items }) => (
                <RoleGroup
                  key={group}
                  group={group}
                  items={items}
                  roles={roles}
                  matrix={matrix}
                  onToggle={toggle}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RoleGroup({
  group,
  items,
  roles,
  matrix,
  onToggle
}: {
  group: string;
  items: CatalogItem[];
  roles: string[];
  matrix: Matrix;
  onToggle: (role: string, key: string) => void;
}) {
  return (
    <>
      <tr className="border-b border-border bg-background/40">
        <td
          colSpan={roles.length + 1}
          className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted"
        >
          {group}
        </td>
      </tr>
      {items.map((item, i) => (
        <tr
          key={item.key}
          className={i < items.length - 1 ? "border-b border-border" : ""}
        >
          <td className="px-4 py-3">
            <p className="font-medium text-foreground">{item.label}</p>
            <p className="font-mono text-[11px] text-muted">{item.key}</p>
          </td>
          {roles.map((role) => {
            const isAdminRole = role === "admin";
            const checked = isAdminRole ? true : !!matrix[role]?.[item.key];
            return (
              <td key={role} className="px-4 py-3 text-center">
                <label className="inline-flex cursor-pointer items-center justify-center">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={isAdminRole}
                    onChange={() => onToggle(role, item.key)}
                    className="h-4 w-4 cursor-pointer rounded border-border bg-background text-primary accent-primary disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </label>
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}
