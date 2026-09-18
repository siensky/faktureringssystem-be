// Samma mönster som apps/backoffice/src/auth/AuthContext.tsx — se den
// filens kommentarer för resonemangen bakom hasAttemptedRefresh (React
// StrictMode + engångs roterande refresh-token) och sessionExpiredHandler.

import type { CurrentUserDto } from "@faktura/contracts";
import { type ReactNode, createContext, useContext, useEffect, useRef, useState } from "react";
import * as authApi from "../api/auth";
import type { TokenPairResponse } from "../api/auth";
import * as bankidApi from "../api/bankid";
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
  /** Fas 12: BankID-inloggning har redan ett tokenpar från collect() — bara att sätta det. */
  loginWithBankId: (tokens: TokenPairResponse) => Promise<void>;
  /** Fas 12: byt aktivt företag för en BankID-kundidentitet. */
  switchCompany: (tenantId: number) => Promise<void>;
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

  // Delad av login, BankID-inlogg och byt-företag — alla tre slutar med
  // "sätt det här tokenparet, hämta den nya /auth/me-vyn".
  async function applyTokens(pair: TokenPairResponse): Promise<void> {
    setAccessToken(pair.accessToken);
    setRefreshToken(pair.refreshToken);
    setUser(await authApi.getCurrentUser());
    setStatus("authenticated");
  }

  async function login(email: string, password: string): Promise<void> {
    await applyTokens(await authApi.login(email, password));
  }

  async function loginWithBankId(tokens: TokenPairResponse): Promise<void> {
    await applyTokens(tokens);
  }

  async function switchCompany(tenantId: number): Promise<void> {
    await applyTokens(await bankidApi.switchCompany(tenantId));
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
    <AuthContext.Provider value={{ user, status, login, loginWithBankId, switchCompany, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth måste användas inom AuthProvider");
  return ctx;
}
