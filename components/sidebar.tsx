"use client";

// Sidebar recolhivel (substituiu a navbar de cima em 2026-11-17).
//
// - Desktop (md+): fixa a esquerda, larga (w-60) ou recolhida (w-16, so icones
//   com tooltip via `title`). Estado em localStorage, lido num useEffect pra nao
//   dar hydration mismatch (SSR renderiza sempre expandida).
// - Mobile: barra fina no topo com hamburguer -> drawer com o mesmo conteudo.
// - Permissoes preservadas da navbar antiga: links comuns pra todos que passam
//   no BootstrapGate; "Papeis" so pra admin (isAdmin). Nenhum gate novo.
// - z-index: sidebar/topbar z-30, drawer mobile z-[35] — abaixo do assist (40),
//   toasts/modais (50/60) e do session-expired-modal (1000).

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Megaphone,
  LogOut,
  ArrowLeft,
  ShieldCheck,
  User,
  LineChart,
  KeyRound,
  Wallet,
  Table2,
  ClipboardCheck,
  Send,
  ListChecks,
  ChevronsLeft,
  ChevronsRight,
  Menu,
  X
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { HUB_URL } from "@/lib/config";

type LinkDef = {
  href: string;
  label: string;
  icon: any;
  /** Match exato (pai de um grupo nao acende junto com o filho). */
  exact?: boolean;
  children?: LinkDef[];
};

const LINKS: LinkDef[] = [
  { href: "/campanhas", label: "Campanhas", icon: Megaphone },
  { href: "/desempenho", label: "Desempenho", icon: LineChart },
  { href: "/fechamento", label: "Fechamento", icon: ClipboardCheck },
  { href: "/media-sources", label: "Media Sources", icon: Table2 },
  { href: "/pagamentos", label: "Pagamentos", icon: Wallet },
  {
    href: "/inicio-campanha",
    label: "Inicio Campanha",
    icon: Send,
    exact: true,
    children: [
      {
        href: "/inicio-campanha/envios",
        label: "Acompanhamento de envios",
        icon: ListChecks
      }
    ]
  }
];

const ADMIN_LINKS: LinkDef[] = [
  { href: "/admin/papeis", label: "Papeis", icon: KeyRound }
];

const STORAGE_KEY = "campanhas.sidebar.collapsed";

function isActive(pathname: string, l: LinkDef): boolean {
  if (l.exact) return pathname === l.href;
  return pathname === l.href || pathname.startsWith(l.href + "/");
}

// Cache de modulo: AppShell e montado por pagina (remonta a cada rota). Sem
// isso a sidebar recolhida "piscaria" aberta->fechada em toda navegacao. No
// 1o load fica false (igual ao SSR, sem hydration mismatch).
let cachedCollapsed: boolean | null = null;

export function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useState<boolean>(() => cachedCollapsed ?? false);
  useEffect(() => {
    if (cachedCollapsed !== null) return;
    try {
      cachedCollapsed = window.localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      cachedCollapsed = false; // storage bloqueado: fica expandida
    }
    setCollapsed(cachedCollapsed);
  }, []);
  const toggle = () =>
    setCollapsed((c) => {
      const next = !c;
      cachedCollapsed = next;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  return { collapsed, toggle };
}

function NavItem({
  link,
  pathname,
  collapsed,
  nested,
  onNavigate
}: {
  link: LinkDef;
  pathname: string;
  collapsed: boolean;
  nested?: boolean;
  onNavigate?: () => void;
}) {
  const active = isActive(pathname, link);
  const Icon = link.icon;
  return (
    <Link
      href={link.href}
      onClick={onNavigate}
      title={collapsed ? link.label : undefined}
      aria-current={active ? "page" : undefined}
      className={`group relative flex items-center rounded-md text-sm font-medium transition-colors ${
        collapsed ? "h-9 justify-center px-0" : `gap-2.5 px-3 py-2 ${nested ? "ml-4 text-[13px]" : ""}`
      } ${
        active
          ? "bg-primary/10 text-primary"
          : "text-orange-100/60 hover:bg-white/5 hover:text-orange-50"
      }`}
    >
      {active && !collapsed && (
        <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-primary" />
      )}
      <Icon className={`${nested ? "h-3.5 w-3.5" : "h-4 w-4"} shrink-0`} />
      {!collapsed && <span className="truncate">{link.label}</span>}
    </Link>
  );
}

function SidebarContent({
  collapsed,
  onToggle,
  onNavigate,
  mobile
}: {
  collapsed: boolean;
  onToggle?: () => void;
  onNavigate?: () => void;
  mobile?: boolean;
}) {
  const pathname = usePathname() || "/";
  const { user, isAdmin, logout } = useAuth();
  const links = [...LINKS, ...(isAdmin ? ADMIN_LINKS : [])];

  return (
    <div className="flex h-full flex-col">
      {/* Topo: logo/Hub */}
      <div
        className={`flex h-14 shrink-0 items-center border-b border-white/5 ${
          collapsed ? "justify-center px-2" : "justify-between px-4"
        }`}
      >
        {collapsed ? (
          <a
            href={HUB_URL}
            title="Voltar ao Hub"
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary"
          >
            <Megaphone className="h-4 w-4" />
          </a>
        ) : (
          <a href={HUB_URL} className="flex min-w-0 items-center gap-2.5" title="Voltar ao Hub">
            <Image
              src="/logo-caracol.png"
              alt="Caracol"
              width={120}
              height={32}
              priority
              className="h-7 w-auto"
            />
            <span className="truncate text-sm font-semibold tracking-wide text-orange-50">
              Campanhas
            </span>
          </a>
        )}
        {mobile && (
          <button
            onClick={onNavigate}
            className="rounded-md p-1.5 text-orange-100/60 hover:bg-white/5 hover:text-orange-50"
            aria-label="Fechar menu"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Itens */}
      <nav className={`flex-1 space-y-0.5 overflow-y-auto py-3 ${collapsed ? "px-2" : "px-3"}`}>
        {links.map((l) => {
          // Subitens sempre visiveis (indentados quando expandida; icones
          // proprios com tooltip quando recolhida) — descoberta > economia.
          const showChildren = !!l.children;
          return (
            <div key={l.href} className="space-y-0.5">
              <NavItem link={l} pathname={pathname} collapsed={collapsed} onNavigate={onNavigate} />
              {showChildren &&
                l.children!.map((c) => (
                  <NavItem
                    key={c.href}
                    link={c}
                    pathname={pathname}
                    collapsed={collapsed}
                    nested
                    onNavigate={onNavigate}
                  />
                ))}
            </div>
          );
        })}
      </nav>

      {/* Rodape: Hub + usuario + logout + recolher */}
      <div className={`shrink-0 border-t border-white/5 py-3 ${collapsed ? "px-2" : "px-3"}`}>
        <a
          href={HUB_URL}
          title={collapsed ? "Voltar ao Hub" : undefined}
          className={`mb-2 flex items-center rounded-md text-xs text-orange-100/40 hover:bg-white/5 hover:text-orange-50 ${
            collapsed ? "h-8 justify-center" : "gap-2 px-3 py-1.5"
          }`}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {!collapsed && "Voltar ao Hub"}
        </a>

        <div
          className={`flex items-center rounded-lg bg-white/[0.03] ${
            collapsed ? "flex-col gap-2 py-2" : "gap-2.5 px-2.5 py-2"
          }`}
        >
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10"
            title={collapsed ? `${user?.name || "Usuario"} — ${isAdmin ? "Admin" : "Equipe"}` : undefined}
          >
            {isAdmin ? (
              <ShieldCheck className="h-4 w-4 text-primary" />
            ) : (
              <User className="h-4 w-4 text-primary" />
            )}
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium leading-tight text-orange-50">
                {user?.name || "Usuario"}
              </p>
              <p className="mt-0.5 flex items-center gap-1.5 text-[11px] leading-tight text-primary/70">
                {isAdmin ? (
                  <span className="rounded bg-primary px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-black">
                    Admin
                  </span>
                ) : (
                  "Equipe"
                )}
              </p>
            </div>
          )}
          <button
            onClick={logout}
            title="Sair"
            className="rounded-md p-1.5 text-orange-100/60 transition-colors hover:bg-white/5 hover:text-orange-50"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>

        {onToggle && (
          <button
            onClick={onToggle}
            title={collapsed ? "Expandir menu" : "Recolher menu"}
            className={`mt-2 flex w-full items-center rounded-md py-1.5 text-xs text-orange-100/40 transition-colors hover:bg-white/5 hover:text-orange-50 ${
              collapsed ? "justify-center" : "gap-2 px-3"
            }`}
          >
            {collapsed ? (
              <ChevronsRight className="h-4 w-4" />
            ) : (
              <>
                <ChevronsLeft className="h-4 w-4" />
                Recolher
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

export function Sidebar({
  collapsed,
  onToggle
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Fecha o drawer ao navegar.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  return (
    <>
      {/* Desktop */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 hidden border-r border-primary/30 bg-zinc-950 transition-[width] duration-200 md:block ${
          collapsed ? "w-16" : "w-60"
        }`}
      >
        <SidebarContent collapsed={collapsed} onToggle={onToggle} />
      </aside>

      {/* Mobile: barra fina + drawer */}
      <header className="sticky top-0 z-30 flex h-12 items-center gap-3 border-b border-primary/30 bg-zinc-950 px-3 md:hidden">
        <button
          onClick={() => setMobileOpen(true)}
          className="rounded-md p-1.5 text-orange-100/70 hover:bg-white/5 hover:text-orange-50"
          aria-label="Abrir menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        <a href={HUB_URL} className="flex items-center gap-2" title="Voltar ao Hub">
          <Image src="/logo-caracol.png" alt="Caracol" width={96} height={26} className="h-6 w-auto" />
          <span className="text-sm font-semibold text-orange-50">Campanhas</span>
        </a>
      </header>
      {mobileOpen && (
        <div className="fixed inset-0 z-[35] md:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r border-primary/30 bg-zinc-950 shadow-2xl">
            <SidebarContent collapsed={false} mobile onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}
    </>
  );
}
