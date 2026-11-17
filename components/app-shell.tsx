"use client";

import { Sidebar, useSidebarCollapsed } from "@/components/sidebar";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { collapsed, toggle } = useSidebarCollapsed();
  return (
    <div className="min-h-screen bg-background">
      <Sidebar collapsed={collapsed} onToggle={toggle} />
      <main
        className={`min-w-0 transition-[padding] duration-200 ${
          collapsed ? "md:pl-16" : "md:pl-60"
        }`}
      >
        {children}
      </main>
    </div>
  );
}
