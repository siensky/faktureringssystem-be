// Samma mönster som apps/backoffice/src/auth/AuthContext.tsx — se den
// filens kommentarer för resonemangen bakom hasAttemptedRefresh (React
// StrictMode + engångs roterande refresh-token) och sessionExpiredHandler.

import type { CurrentUserDto } from "@faktura/contracts";
import { type ReactNode, createContext, useContext, useEffect, useRef, useState } from "react";
import * as authApi from "../api/auth";
import {
  clearTokens,
  getRefreshToken,
  setAccessToken,
  setRefreshToken,
  setSessionExpiredHandler,
} from "./tokenStore";

type Status = "loading" | "authenticated" | "unauthenticated";

interface AuthState {
  user: CurrentUserDto | null;
  status: Status;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUserDto | null>(null);
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    setSessionExpiredHandler(() => {
      setUser(null);
      setStatus("unauthenticated");
    });
    return () => setSessionExpiredHandler(null);
  }, []);

  const hasAttemptedRefresh = useRef(false);
  useEffect(() => {
    if (hasAttemptedRefresh.current) return;
    hasAttemptedRefresh.current = true;

    const existingRefresh = getRefreshToken();
    if (!existingRefresh) {
      setStatus("unauthenticated");
      return;
    }
    (async () => {
      try {
        const pair = await authApi.refresh(existingRefresh);
        setAccessToken(pair.accessToken);
        setRefreshToken(pair.refreshToken);
        setUser(await authApi.getCurrentUser());
        setStatus("authenticated");
      } catch {
        clearTokens();
        setStatus("unauthenticated");
      }
    })();
  }, []);

  async function login(email: string, password: string): Promise<void> {
    const pair = await authApi.login(email, password);
    setAccessToken(pair.accessToken);
    setRefreshToken(pair.refreshToken);
    setUser(await authApi.getCurrentUser());
    setStatus("authenticated");
  }

  async function logout(): Promise<void> {
    const token = getRefreshToken();
    clearTokens();
    setUser(null);
    setStatus("unauthenticated");
    if (token) {
      try {
        await authApi.logout(token);
      } catch {
        // Redan utloggad lokalt — ett misslyckat serveranrop ändrar inget för användaren.
      }
    }
  }

  return (
    <AuthContext.Provider value={{ user, status, login, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth måste användas inom AuthProvider");
  return ctx;
}
