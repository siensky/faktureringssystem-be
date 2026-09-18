import type { CompanyOverviewDto } from "@faktura/contracts";
import { apiRequest } from "./client";

export function getOverview(): Promise<CompanyOverviewDto> {
  return apiRequest("/auth/companies/overview");
}
