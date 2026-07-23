"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  ReactNode,
} from "react";

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  /** Blendet waehrend der Partie den Engine-Vorschlag ein (nur Admin-Konto). */
  engineAssist: boolean;
}

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  ready: boolean;
  login: (username: string, password: string) => Promise<string | null>;
  register: (
    username: string,
    password: string,
    displayName: string
  ) => Promise<string | null>;
  logout: () => void;
  /** fetch mit Bearer-Token — fuer alle geschuetzten API-Routen. */
  authFetch: (input: string, init?: RequestInit) => Promise<Response>;
}

const AuthContext = createContext<AuthContextType | null>(null);
const STORAGE_KEY = "chess-session";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // Sitzung wiederherstellen und gegen den Server pruefen — ein abgelaufenes
  // Token soll nicht als "eingeloggt" durchgehen.
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      setReady(true);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const parsed = JSON.parse(stored) as { token?: string };
        if (!parsed.token) throw new Error("kein Token");
        const res = await fetch("/api/auth/me", {
          headers: { Authorization: `Bearer ${parsed.token}` },
        });
        if (!res.ok) throw new Error("Sitzung ungültig");
        const data = await res.json();
        if (cancelled) return;
        setUser(data.user);
        setToken(parsed.token);
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ token: parsed.token, user: data.user })
        );
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback((nextUser: AuthUser, nextToken: string) => {
    setUser(nextUser);
    setToken(nextToken);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ token: nextToken, user: nextUser }));
  }, []);

  const submit = useCallback(
    async (path: string, body: Record<string, string>): Promise<string | null> => {
      try {
        const res = await fetch(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) return data.error ?? "Unbekannter Fehler";
        persist(data.user, data.token);
        return null;
      } catch {
        return "Server nicht erreichbar";
      }
    },
    [persist]
  );

  const login = useCallback(
    (username: string, password: string) =>
      submit("/api/auth/login", { username, password }),
    [submit]
  );

  const register = useCallback(
    (username: string, password: string, displayName: string) =>
      submit("/api/auth/register", { username, password, displayName }),
    [submit]
  );

  const logout = useCallback(() => {
    setUser(null);
    setToken(null);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  const authFetch = useCallback(
    (input: string, init: RequestInit = {}) =>
      fetch(input, {
        ...init,
        headers: {
          ...(init.headers || {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }),
    [token]
  );

  const value = useMemo(
    () => ({ user, token, ready, login, register, logout, authFetch }),
    [user, token, ready, login, register, logout, authFetch]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
