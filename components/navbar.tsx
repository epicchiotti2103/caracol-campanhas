"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { HUB_URL } from "@/lib/config";
import { Megaphone, LogOut, ArrowLeft, ShieldCheck, User } from "lucide-react";

type LinkDef = { href: string; label: string; icon: any };

const LINKS: LinkDef[] = [
  { href: "/campanhas", label: "Campanhas", icon: Megaphone }
];

export function Navbar() {
  const pathname = usePathname();
  const { user, isAdmin, logout } = useAuth();

  return (
    <header className="sticky top-0 z-40 border-b border-primary/30 bg-zinc-950">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-14 items-center justify-between">
          <div className="flex items-center gap-6">
            <a
              href={HUB_URL}
              className="flex items-center gap-2.5"
              title="Voltar ao Hub"
            >
              <Image
                src="/logo-caracol.png"
                alt="Caracol"
                width={120}
                height={32}
                priority
                className="h-7 w-auto sm:h-8"
              />
              <div className="hidden sm:block">
                <span className="text-sm font-semibold tracking-wide text-orange-50">
                  Campanhas
                </span>
                {isAdmin && (
                  <span className="ml-2 rounded bg-primary px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-black">
                    Admin
                  </span>
                )}
              </div>
            </a>

            <nav className="hidden items-center gap-1 md:flex">
              {LINKS.map(({ href, label, icon: Icon }) => {
                const active = pathname === href || pathname.startsWith(href + "/");
                return (
                  <Link
                    key={href}
                    href={href}
                    className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                      active
                        ? "text-primary"
                        : "text-orange-100/60 hover:bg-white/5 hover:text-orange-50"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <a
              href={HUB_URL}
              className="hidden items-center gap-1 rounded-md px-2 py-1.5 text-xs text-orange-100/40 hover:text-orange-50 sm:flex"
              title="Voltar ao Hub"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Hub
            </a>

            <div className="flex items-center gap-2 border-l border-white/10 pl-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                {isAdmin ? (
                  <ShieldCheck className="h-4 w-4 text-primary" />
                ) : (
                  <User className="h-4 w-4 text-primary" />
                )}
              </div>
              <div className="hidden text-right sm:block">
                <p className="max-w-[160px] truncate text-xs font-medium leading-tight text-orange-50">
                  {user?.name || "Usuario"}
                </p>
                <p className="text-[11px] leading-tight text-primary/70">
                  {isAdmin ? "Admin" : "Equipe"}
                </p>
              </div>
              <button
                onClick={logout}
                title="Sair"
                className="rounded-md p-1.5 text-orange-100/60 transition-colors hover:bg-white/5 hover:text-orange-50"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
