import type { CurrentUserDto } from "@faktura/contracts";
import { apiRequest } from "./client";

export interface TokenPairResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: "Bearer";
}

export function login(email: string, password: string): Promise<TokenPairResponse> {
  return apiRequest("/auth/login", { method: "POST", body: { email, password } });
}

export function refresh(refreshToken: string): Promise<TokenPairResponse> {
  return apiRequest("/auth/refresh", { method: "POST", body: { refreshToken } });
}

export function logout(refreshToken: string): Promise<{ status: "ok" }> {
  return apiRequest("/auth/logout", { method: "POST", body: { refreshToken } });
}

export function getCurrentUser(): Promise<CurrentUserDto> {
  return apiRequest("/auth/me");
}
