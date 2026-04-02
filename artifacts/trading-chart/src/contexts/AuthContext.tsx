import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
const TOKEN_KEY = "tradingvue_token";

export interface AuthUser {
  userId: number;
  username: string;
}

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => void;
  authFetch: (url: string, init?: RequestInit) => Promise<Response>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) { setLoading(false); return; }
    fetch(`${BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() as Promise<{ user: AuthUser }> : Promise.reject())
      .then(data => setUser(data.user))
      .catch(() => { localStorage.removeItem(TOKEN_KEY); setToken(null); })
      .finally(() => setLoading(false));
  }, []);

  const applyAuth = (tok: string, usr: AuthUser) => {
    localStorage.setItem(TOKEN_KEY, tok);
    setToken(tok);
    setUser(usr);
  };

  const login = async (username: string, password: string) => {
    const r = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await r.json() as { token?: string; user?: AuthUser; error?: string };
    if (!r.ok) throw new Error(data.error ?? "Login failed");
    applyAuth(data.token!, data.user!);
  };

  const register = async (username: string, password: string) => {
    const r = await fetch(`${BASE}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await r.json() as { token?: string; user?: AuthUser; error?: string };
    if (!r.ok) throw new Error(data.error ?? "Registration failed");
    applyAuth(data.token!, data.user!);
  };

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
  }, []);

  const authFetch = useCallback((url: string, init: RequestInit = {}) => {
    return fetch(url, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${token ?? ""}` },
    });
  }, [token]);

  return (
    <AuthContext.Provider value={{ user, token, loading, login, register, logout, authFetch }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
