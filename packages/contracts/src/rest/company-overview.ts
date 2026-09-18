// Fas 12: GET /auth/companies/overview — en accountSummary-läsning per
// länkat företag (services/auth/src/bankid/services.ts:overview).

import type { CompanyLinkDto } from "./auth";
import type { PortalAccountSummaryDto } from "./portal";

export interface CompanyOverviewEntry extends CompanyLinkDto, PortalAccountSummaryDto {}

export interface CompanyOverviewDto {
  companies: CompanyOverviewEntry[];
}
