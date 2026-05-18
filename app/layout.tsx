import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import { ToastProvider } from "@/lib/toast-context";
import { BootstrapGate } from "@/components/bootstrap-gate";

export const metadata: Metadata = {
  title: "Caracol Campanhas",
  description: "Cadastro e gerencia de campanhas da suite Caracol"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" className="dark">
      <body>
        <AuthProvider>
          <ToastProvider>
            <BootstrapGate>{children}</BootstrapGate>
          </ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
