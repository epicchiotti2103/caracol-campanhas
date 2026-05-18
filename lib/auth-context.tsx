"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import Cookies from "js-cookie";
import { useRouter } from "next/navigation";

export type Tipo = "interno" | "externo";
export type HubRole =
  | "admin"
  | "campanha"
  | "cliente_tracker"
  | "cliente_mobile"
  | "publisher_tracker"
  | "publisher_mobile";

export interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  tipo?: Tipo | null;
  hub_role?: HubRole | null;
}

interface AuthContextType {
  user: User | null;
  isAdmin: boolean;
  loading: boolean;
  login: (accessToken: string, refreshToken: string, userData: User) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const ROOT_DOMAIN = ".aeobr.com.br";

function cookieOpts(): Cookies.CookieAttributes {
  const isCrossSubdomain =
    typeof window !== "undefined" && window.location.hostname.endsWith(ROOT_DOMAIN);
  return isCrossSubdomain
    ? { expires: 7, domain: ROOT_DOMAIN, secure: true, sameSite: "lax" }
    : { expires: 7 };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const token = Cookies.get("auth_token");
    let userDataStr: string | undefined = Cookies.get("user_data");
    if (!userDataStr && typeof window !== "undefined") {
      userDataStr = localStorage.getItem("user_data") || undefined;
    }
    if (token && userDataStr) {
      try {
        setUser(JSON.parse(userDataStr));
      } catch (e) {
        // ignore malformed payload
      }
    }
    setLoading(false);
  }, []);

  const login = (accessToken: string, refreshToken: string, userData: User) => {
    const opts = cookieOpts();
    Cookies.set("auth_token", accessToken, opts);
    Cookies.set("refresh_token", refreshToken, opts);
    Cookies.set("user_data", JSON.stringify(userData), opts);
    if (typeof window !== "undefined") {
      localStorage.removeItem("user_data");
    }
    setUser(userData);
    router.push("/");
  };

  const logout = () => {
    const opts = cookieOpts();
    const removeOpts = opts.domain ? { domain: opts.domain } : undefined;
    Cookies.remove("auth_token", removeOpts);
    Cookies.remove("refresh_token", removeOpts);
    Cookies.remove("user_data", removeOpts);
    if (typeof window !== "undefined") {
      localStorage.removeItem("user_data");
    }
    setUser(null);
    router.push("/login");
  };

  const isAdmin = useMemo(() => user?.hub_role === "admin", [user?.hub_role]);

  return (
    <AuthContext.Provider value={{ user, isAdmin, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
