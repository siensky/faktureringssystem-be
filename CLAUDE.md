# Faktureringssystem

Multi-tenant SaaS för fakturering med automatisk betalningsmatchning. Fyra tjänster (auth, billing, payments, documents-i-Python) i ett monorepo, gemensam Postgres, RabbitMQ som event-buss.

## Arbetssätt — läs detta först

**Claude implementerar, Sienna granskar.** Det här är en ändring från projektets tidigare regel (implementationskod skrevs tidigare av Sienna själv för att öva) — beslutad av Sienna 2026-09-09 i planeringssamtalet inför den fulla byggfasen.

- Arbete sker på en egen branch per fas (`fas0/fundament`, `fas1/auth`, …), aldrig direkt på `main`.
- Varje fas avslutas med en pull request: vad och varför, Definition of Done avbockad ([rules/testing.md](rules/testing.md)), grön CI. Claude stannar där och väntar på Siennas granskning — nästa fas börjar inte förrän PR:en är godkänd och mergad, om inte Sienna uttryckligen säger åt Claude att merga själv för den fasen.
- En fas som blir för stor för en läsbar diff (billing-kärnan, den stora e2e-sviten) delas i flera PR:ar inom samma branch-prefix.
- Planen som styr arbetet ligger i [PLAN.md](PLAN.md) och i den senast godkända plan-filen i `~/.claude/plans/`. Läs den innan en fas påbörjas.

AI-hjälp är fortsatt värdefull utöver implementationen: frågor, förklaringar, granskning, felsökning, planering och dokumentation.

## Dokument

- [PLAN.md](PLAN.md) — arkitektur och alla faser. Läs den innan du svarar på designfrågor i stället för att härleda om beslut.
- [rules/](rules/) — reglerna all kod följer. Numrerade så de kan citeras: "bryter mot `database.md` #18".

| Fil | Innehåll |
|---|---|
| [rules/architecture.md](rules/architecture.md) | Tjänstegränser, event, idempotens, tenant, M2M, enkelhet |
| [rules/domain.md](rules/domain.md) | Fakturans livscykel, kreditfaktura, nummerserie, personuppgifter |
| [rules/database.md](rules/database.md) | Migrationer, pengar i öre, tid i UTC, index, queries |
| [rules/code-style.md](rules/code-style.md) | Lagerindelning, namngivning, fel, säkerhet |
| [rules/testing.md](rules/testing.md) | Vad som testas hur, obligatoriska tester, Definition of Done |
| [rules/git.md](rules/git.md) | Branches, commits, vad som aldrig committas |

## Snabbfakta att inte glömma

- **Pengar är `BIGINT` i öre**, aldrig `DECIMAL` eller float. Kolumnnamn slutar på `_ore`.
- **`tenant_id` kommer från JWT**, aldrig från request-body. Saknas tenant i kontexten kastas ett fel — filtret får aldrig tyst utebli.
- **`404` över tenant-gränsen**, aldrig `403`.
- **En skickad faktura ändras aldrig** — rättelse sker med kreditfaktura. Fakturan blir `sent` bara via `POST /:id/send`, aldrig av ett leveransevent.
- **`invoices.status` (bokföring) och `invoices.delivery_status` (leverans) är två olika kolumner.** Blanda aldrig ihop dem.
- **Betalningar är rader i `invoice_payments`, inte en lagrad summa.** `paid_ore` beräknas.
- Kör med **Bun**, inte npm eller node — utom documents-tjänsten som kör Python/uv.

## Status

Fas 0–3 mergade. Fas 4 (documents: PDF, S3, e-postutskick, leveransstatus) ligger i PR och väntar på granskning. Full arkitektur: se plan-filen i `~/.claude/plans/`.
