import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import {
  type LocalUser,
  getSession,
  clearSession,
  loginLocal,
  registerLocal,
  handleLocalApi,
} from "@/lib/local-store";

// Accounts and all user data are stored locally in the browser. No backend
// account database exists, so upgrades never affect logins or watchlists.

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
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const session = getSession();
    if (session) {
      setUser(session.user);
      setToken(session.token);
    }
    setLoading(false);
  }, []);

  const apply = (session: { token: string; user: LocalUser }) => {
    setToken(session.token);
    setUser(session.user);
  };

  const login = async (username: string, password: string) => {
    apply(await loginLocal(username, password));
  };

  const register = async (username: string, password: string) => {
    apply(await registerLocal(username, password));
  };

  const logout = useCallback(() => {
    clearSession();
    setToken(null);
    setUser(null);
  }, []);

  // Serves user/alert endpoints from localStorage; passes market/chat/trading
  // through to the stateless backend proxy.
  const authFetch = useCallback(async (url: string, init: RequestInit = {}) => {
    const local = await handleLocalApi(url, init);
    if (local) return local;
    return fetch(url, init);
  }, []);

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
