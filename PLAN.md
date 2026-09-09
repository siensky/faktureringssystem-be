# Plan: Faktureringssystem — mikrotjänstarkitektur i faser

## Arbetssätt

**Alla faser implementeras av mig (Sienna), för hand.** Syftet med projektet är att öva på att koda själv — inte att få kod genererad.

AI får användas för att svara på frågor, förklara koncept, granska kod jag redan skrivit, och felsöka när jag kört fast. AI ska **inte** skriva implementationen åt mig, och ska inte börja bygga en fas utan att jag uttryckligen bett om det.

Detta dokument är alltså en karta jag följer själv, inte en arbetsorder.

---

## Context

Projektet är ett automatiserat faktureringssystem med betalningsmatchning. Idag finns bara ett skelett: en Fastify-app på Bun med felhanteringslager ([src/error/error.ts](src/error/error.ts)), en Postgres-migration, och tomma stubs för `admin/`, `customer/` och `invoices/`. Ingen auth, inga tester, ingen CI, ingen kö.

Planen i [src/plan.md](src/plan.md) beskriver *vad* som ska byggas men inte *hur* eller *i vilken ordning*. Den här planen lägger till det som saknades:

- **Modulär arkitektur** — systemet byggs som fyra separata tjänster från start
- **Tester under utvecklingen** — enhetstester och e2e-tester i varje fas, inte på slutet
- **CI/CD-pipelines** från fas 0
- **Rules-md-filer** som styr hur koden skrivs
- **PM2 + nginx** för drift, **Redis** där det behövs, **cronjobb** för automatiseringen

Beslut som tagits: **multi-tenant SaaS** (flera företag registrerar sig och fakturerar sina egna kunder), **egen JWT-auth** (BankID som senare tillägg), **fyra tjänster**, **mikrotjänster direkt** istället för monolit-först, **en gemensam databas** för alla tjänster, allt i ett **monorepo**.

### Multi-tenancy

Varje företag som registrerar sig är en **tenant**. Alla tenants delar samma tabeller, och varje rad bär `tenant_id` som säger vem som äger den. Det är precis modellen som redan finns i din migration — kolumnen heter bara `admin_id` idag och döps om till `tenant_id`.

Kostnaden betalas **en gång**, inte per feature:

- **Repository-basklass** som injicerar `WHERE tenant_id = $ctx.tenantId` i varje query. Eftersom all SQL bor i repository-lagret finns det ett enda ställe där filtret kan glömmas.
- **`tenant_id` i JWT**, satt vid inloggning och aldrig taget från request-body — annars kan en angripare välja tenant själv.
- **`tenant_id` i event-envelopen** i RabbitMQ, inte bara i HTTP-anrop. Lätt att glömma, och en glömd tenant i ett event skickar fel faktura till fel företags kund.
- **Isoleringstest per skyddad endpoint** — ett e2e-test som loggar in som företag A och försöker läsa företag B:s resurs, och förväntar `404`. Aldrig `403` över tenant-gränsen; det bekräftar att resursen finns hos någon annan.

Två saker blir genuint pilligare och är värda att veta i förväg:

**1. Fakturanummer räknas per företag, inte globalt.** Företag A:s fakturor är nr 1, 2, 3… och företag B:s är *också* 1, 2, 3… — två separata serier. En vanlig Postgres-`SEQUENCE` har bara en räknare för hela systemet och skulle ge företag A nummer 1, 4, 7 med hål där B tog nummer emellan. Serien måste vara obruten per företag.

Lösningen är en räknare per tenant (`next_invoice_number` i `company_settings`), hämtad med `SELECT ... FOR UPDATE`. Låset behövs för att två samtidiga fakturor annars hinner läsa samma värde innan någon skrivit tillbaka, och båda får nummer 5. Låset tvingar den andra att vänta. Och det måste ligga i **samma transaktion som fakturan skapas** — tas numret men fakturan failar är numret förbrukat och serien får ett hål.

**2. OCR-nummer är unika per företag, inte globalt.** Migrationen säger idag `ocr_number TEXT UNIQUE`, vilket betyder unikt över *alla* företag — två orelaterade företag skulle konkurrera om samma nummerpool i onödan. Ändras till `UNIQUE (tenant_id, ocr_number)`.

**Följd för betalningsmatchningen:** eftersom två företag kan ha samma OCR går det inte att slå upp en betalning enbart på OCR-numret. Varje företag har istället sitt eget **bankgiro**, och banktransaktionen säger vilket konto som tog emot pengarna. Matchningen blir därför: `mottagarbankgiro → tenant → OCR inom den tenanten`.

### Konsekvens: befintlig migration skrivs om

[migrations/1775829869264_initial-migration.js](migrations/1775829869264_initial-migration.js) behåller sin tenant-struktur — det är auth-delen som ändras, eftersom Auth0 valts bort:

1. **`admins`-tabellen delas i tre begrepp.** Den blandar idag tenant-identitet, företagsuppgifter och inloggning i en tabell:
   - `tenants` — id, namn, `org_number`, status, skapad (ägs av auth, skapas vid registrering). Svarar på *vilket företag är detta*.
   - `users` — `tenant_id`, `role` (`admin` | `customer`), `auth_method` (`password` | `bankid`), `email` + `password_hash` **eller** `pnr_hash`, verifieringsfält. Svarar på *vem loggar in*. Dagens `admins`-tabell slår ihop de två frågorna, vilket betyder att ett företag har exakt en inloggning — jobbar två personer där måste de dela lösenord, och det går inte att se vem som gjort vad. Med uppdelningen får Anna och Björn var sin rad som båda pekar på samma tenant. Slutar Anna raderas hennes rad, medan företaget och all fakturadata står kvar. Rader med `role: customer` bär även `customer_id` och ser bara sina egna fakturor.
   - `company_settings` — `tenant_id`, `bankgiro`, `vat_number`, adress, `logo_url`, `next_invoice_number`. Det som syns på fakturan, ägs av billing.
2. **`admin_id` → `tenant_id`** på `customers`, `invoices` och `invoice_templates`, med FK mot `tenants`. Index på `tenant_id` i varje tabell.
3. **`auth0_id` utgår.**
4. **`ocr_number UNIQUE`** ändras till `UNIQUE (tenant_id, ocr_number)`, och `invoice_number` får `UNIQUE (tenant_id, invoice_number)`.

Inget är deployat, så migrationen skrivs om på plats istället för att staplas med en ändringsmigration.

---

## Domänregler som styr datamodellen

Fem beslut som är billiga nu och dyra att ändra senare. De hör hemma i `rules/database.md` och `rules/domain.md`.

**1. En skickad faktura är oföränderlig.** En faktura som lämnat `draft` är en bokföringspost och får varken redigeras eller raderas — rättelse sker med **kreditfaktura**. Det betyder konkret:

- `PUT /admin/invoices/:id` och `DELETE /admin/invoices/:id` gäller **endast** status `draft`, annars `409`
- `POST /admin/invoices/:id/credit` skapar en ny faktura med negativa belopp som pekar tillbaka via `credits_invoice_id`, och sätter originalet till `credited`
- Din [src/plan.md:23](src/plan.md:23) listar "ta bort faktura" och "redigera faktura" utan förbehåll — det är den begränsningen som saknades

**2. Nummerserien måste vara obruten.** Inga hål, inga dubbletter, per tenant. Det är hela skälet till att fakturanumret hämtas med radlås i samma transaktion som fakturan skapas, och till att en misslyckad fakturaskapning måste rulla tillbaka numret med sig.

**3. Pengar lagras som `BIGINT` i öre, aldrig `DECIMAL` eller float.** `postgres.js` returnerar `DECIMAL` som **sträng**, och första gången någon skriver `parseFloat()` på den börjar ören försvinna. Heltal i minsta enhet tar bort hela problemklassen. Formatering till kronor sker först i mapper-lagret, precis innan svaret lämnar API:et. Detta ändrar `DECIMAL(15,2)`-kolumnerna i migrationen.

**4. Allt lagras i UTC, affärsdatum tolkas i `Europe/Stockholm`.** Ett cronjobb schemalagt "03:00" utan uttalad tidszon kör två gånger eller noll gånger vid DST-övergången i mars och oktober. Förfallodatum och "idag" avgörs i svensk tid; tidsstämplar lagras som `TIMESTAMPTZ` i UTC.

**5. Personnummer är känsliga personuppgifter — och här även inloggningsidentitet.** `org_or_pnr` innehåller pnr för privatkunder, och eftersom privatkunder loggar in med BankID är pnr dessutom det som pekar ut *vem som loggar in*. Två följder:

- Pnr får aldrig hamna i strukturerade loggar, felmeddelanden eller URL:er — loggaren får en redigeringsregel i fas 0
- `users` lagrar **inte** pnr i klartext utan `pnr_hash`, en HMAC-SHA256 med en serverside-peppar. Uppslag vid inloggning fungerar eftersom hashen är deterministisk, men en läckt `users`-tabell lämnar inte ut personnummer.

GDPR:s rätt till radering **krockar** med bokföringslagens arkiveringskrav; bokföringslagen vinner för fakturadata, men att det är ett medvetet beslut och inte en glömska ska stå i `rules/domain.md`.

---

## Arkitektur: fyra tjänster

| Tjänst | Språk | Ansvarar för tabellerna | Varför egen tjänst |
|---|---|---|---|
| **auth** | TS/Bun | `tenants`, `users`, `user_tokens`, `service_clients` (+ refresh-tokens i Redis) | Säkerhetskänslig, egen ändringstakt, delas av backoffice och kundportal. Äger tenant-begreppet eftersom registrering skapar det. |
| **billing** | TS/Bun | `customers`, `invoices`, `invoice_items`, `invoice_templates`, `company_settings` | Transaktionell kärna — kund och faktura läses ihop, ska inte splittas. Innehåller även cron. |
| **documents** | **Python** | `documents`, `emails` | CPU-tung PDF-rendering med annan skalningsprofil. Se motiveringen till språkvalet nedan. |
| **payments** | TS/Bun | `bank_transactions` | Mötet med extern opålitlig part. Egen idempotens, replay-skydd och säkerhetsyta (webhooks). En transaktion pekar direkt på sin faktura — ingen separat matchningstabell behövs. |

`event_outbox` och `processed_events` är gemensamma tabeller med `source_service` respektive `consumer` som skiljer raderna åt.

**Infrastruktur:** nginx (reverse proxy, TLS, routing, rate limiting) · RabbitMQ (event-buss) · Redis (refresh-tokens, cron-lås, cache) · Postgres · PM2 (processhantering av TS-tjänsterna).

### Varför Python just i documents

Varje språkgräns **dubblerar den delade infrastrukturen** — event-envelopen, JWT-verifieringen, loggformatet, felformatet, correlation-id. Allt det måste byggas och underhållas i två språk och hållas i exakt samsyn. Språkgränsen ska därför läggas där den delade ytan är tunnast och det språkspecifika skälet är starkast.

**Documents uppfyller båda:**

- **Tekniskt skäl:** WeasyPrint tar HTML + CSS och ger PDF med riktigt stöd för CSS Paged Media — sidhuvuden, sidfötter, "Sida 2 av 3", sidbrytningar. Exakt vad en faktura behöver. Alternativen i Node är Puppeteer (startar en hel headless Chrome per PDF, ~300 MB image, bräckligt i containers) eller pdfkit (lågnivå, manuell positionering). Python är här det bättre verktyget, inte en kompromiss.
- **Arkitektoniskt skäl:** documents konsumerar event och producerar filer. Den äger ingen affärslogik och behöver verifiera JWT men aldrig utfärda dem — tunnaste möjliga delade yta.

**Varför inte de andra:**

- **auth** — sämsta valet. Auth delar *mest* kod med övriga: `requireUser()` och `requireService()` ligger i `packages/shared` och används av alla TS-tjänster. Med auth i Python måste JWT-verifieringen finnas i två implementationer som aldrig får drifta isär. Säkerhetskod är fel ställe för den risken.
- **billing** — största tjänsten, ändras oftast, och all befintlig kod och alla mönster ligger redan där i TypeScript.
- **payments** — näst bästa alternativet. Fristående, och att parsa bankfiler i fast bredd är trevligt i Python. Men den behöver `requireService()`, idempotens och outbox-logik som redan finns skriven i TS, så dubbelarbetet blir större än för documents.

### Gemensam databas

Alla fyra tjänsterna kopplar upp mot **samma Postgres-databas**, och migrationerna ligger samlade i `/migrations` i repots rot — som idag. Tjänsterna delar alltså lagring, men inte ansvar: kolumnen "Ansvarar för" ovan säger vem som får **skriva** till vad.

Detta gör gränsen till en **kodkonvention istället för en teknisk spärr**, vilket är den viktiga skillnaden mot en databas per tjänst. Inget hindrar rent tekniskt payments från att köra en `UPDATE` på `invoices` — det är regeln i `rules/architecture.md` som gör det. Att den regeln följs är därför något kodgranskning och tester måste bevaka aktivt, annars växer tjänsterna ihop igen genom databasen.

Konkreta regler som följer av detta:

- **Skrivning:** endast ansvarig tjänst skriver till sina tabeller. Andra tjänster begär ändringar via event eller HTTP.
- **Läsning:** korsläsning tillåts endast via en tjänsts eget API — inte genom att joina mot dess tabeller.
- **Migrationer:** en gemensam katalog, en tidslinje. Varje migrationsfil namnges med vilken tjänst den tillhör.
- **Valfri skärpning senare:** separata Postgres-användare per tjänst med `GRANT` bara på egna tabeller gör regeln teknisk istället för social. Kan läggas till i fas 7 utan att något annat ändras.

### Eventflöde

```
billing:   invoice.created ──────────────► documents
documents: document.generated ────────────► documents (mejlsteg)
documents: email.sent ────────────────────► billing (status: sent)
payments:  payment.matched / payment.partial ─► billing (status: paid / restskuld)
billing:   invoice.overdue ───────────────► documents (påminnelse-PDF + mejl)
```

Regel: **ingen tjänst läser en annan tjänsts tabeller.** All korskommunikation går via RabbitMQ, eller via HTTP där ett synkront svar krävs.

Alla event delar en gemensam envelope, definierad i `packages/contracts`:

```
{ eventId, eventType, tenantId, correlationId, occurredAt, payload }
```

`tenantId` är obligatoriskt och valideras av varje konsument innan payloaden rörs — ett event utan tenant går till dead-letter, det gissas aldrig.

**Publicering sker via transactional outbox.** En tjänst får aldrig skriva till databasen och sedan publicera till RabbitMQ som två separata steg — failar publiceringen efter commit finns fakturan men inget event, och ingen PDF eller mejl genereras någonsin. Tyst dataförlust. Istället:

1. Affärsdata **och** eventet skrivs till `event_outbox` i **samma transaktion**
2. En separat publisher läser outboxen och skickar till RabbitMQ
3. Raden markeras publicerad först vid bekräftelse från brokern

Konsekvensen är att leverans blir *at-least-once* — samma event kan komma två gånger. **Varje konsument måste därför vara idempotent**, med dedupliceringsnyckel på `eventId`. Det gäller alla fyra tjänsterna, inte bara documents.

### M2M-auth mellan tjänsterna

Ingen tjänst litar på en annan bara för att anropet kom från det interna nätverket. Auth Service är utfärdare även för tjänsterna.

**Flöde:** OAuth2 `client_credentials`. Varje tjänst har `client_id` + `client_secret` i sin miljö, hämtar ett tjänste-token från `POST /auth/token` och cachar det i Redis tills strax före utgång. Tokens signeras **asymmetriskt** (RS256/EdDSA) och verifieras av mottagaren mot Auth Services JWKS-endpoint — så ingen hemlighet behöver distribueras till verifierande tjänster.

**Tjänste-token och användar-token får aldrig kunna förväxlas.** Det är den klassiska buggen här: ett tjänste-token som råkar accepteras som användar-token ger obegränsad åtkomst över alla tenants. Därför:

- Olika `aud` (`internal` vs `api`) och en explicit `token_type`-claim
- Verifieringsfunktionerna är **två separata funktioner** i `packages/shared` — `requireUser()` och `requireService(scope)`. Ingen endpoint anropar en generisk "verifiera token".
- Ett tjänste-token har `sub` = tjänstenamn och saknar `tenantId` helt

**Scopes per anropspar**, minsta möjliga:

| Anropare | Mot | Scope | Vad den behöver |
|---|---|---|---|
| documents | billing | `billing:company:read` | Logga, bankgiro, orgnr till PDF:en |
| documents | billing | `billing:customer:read` | Kundens e-postadress vid utskick |
| payments | billing | `billing:invoice:read` | Slå upp faktura på OCR |
| billing | auth | `auth:tenant:read` | Lista aktiva tenants för cron |

Skrivningar går aldrig via S2S-HTTP — de går via event till ägande tjänst. Det håller scope-listan kort.

**Tenant vid S2S-anrop.** En tjänst *får* hävda vilken tenant den agerar för, via `X-Tenant-Id`, eftersom den är autentiserad och betrodd. En slutanvändare får det aldrig — där kommer tenant enbart från JWT. `requireService()` läser headern, `requireUser()` ignorerar den. Skillnaden dokumenteras i `rules/architecture.md`.

**RabbitMQ räknas också.** Varje tjänst får egna RabbitMQ-credentials med permissions bara på de exchanges och köer den faktiskt använder — inte ett delat `guest`-konto. Lätt att glömma när man tänker "M2M-auth" som enbart HTTP.

**Rotation:** Auth Service accepterar två giltiga signeringsnycklar samtidigt, så nyckelbyte kan ske utan nedtid.

### Monorepo-struktur

Allt ligger i detta repo, med Bun workspaces:

```
/services
  /auth          (TS, Fastify)
  /billing       (TS, Fastify)
  /payments      (TS, Fastify)
  /documents     (Python, FastAPI)
/packages
  /contracts     (event-scheman + typer, delas av TS-tjänsterna)
  /shared        (errors, logger, config-validering)
/migrations      (gemensam, en tidslinje för hela databasen)
/infra
  nginx.conf, ecosystem.config.js (PM2), docker-compose.yml
/rules
  *.md
```

Befintlig kod flyttas: `src/error/*` → `packages/shared/`, `src/invoices` + `src/customer` + `src/admin` → `services/billing/src/`. Mönstret routes → controllers → services → repository → mappers behålls, det är redan rätt.

---

## Faser

### Fas 0 — Fundament, spelregler och walking skeleton

Målet: hela infrastrukturen körs innan en enda affärsregel skrivs. Detta är den viktigaste fasen i ett mikrotjänstprojekt — allt infra-krångel ska hända här, medan det är billigt.

- Monorepo-struktur enligt ovan; Bun workspaces
- **Rules-md-filer** i `/rules`, en per område, som all kodning ska följa:
  - `architecture.md` — tjänstegränser, förbudet mot att läsa andras tabeller, eventnamngivning, **tenant-reglerna** (tenant_id från JWT aldrig från body, alltid med i event-envelopen), **M2M-reglerna** (`requireUser()` vs `requireService()`, när `X-Tenant-Id` får litas på)
  - `code-style.md` — lagerindelning, namngivning, felhantering via `BaseError`
  - `testing.md` — vad som kräver enhetstest vs e2e, coverage-krav, Definition of Done
  - `database.md` — gemensam databas men tabellägarskap per tjänst, migrationsnamngivning, **pengar som `BIGINT` i öre**, `TIMESTAMPTZ` i UTC
  - `domain.md` — de fem domänreglerna ovan: oföränderlig faktura, kreditfaktura, obruten nummerserie, `Europe/Stockholm` som affärstidszon, personnummerhantering och varför fakturadata inte raderas
  - `git.md` — branch- och commit-konventioner
- `docker-compose.yml` som startar postgres, redis, rabbitmq, nginx och alla fyra tjänsterna
- **Alla fyra tjänsterna som tomma skelett** med `/health` — de ska prata med varandra över RabbitMQ redan nu (en `ping`-event räcker)
- **Egna RabbitMQ-credentials per tjänst** med permissions bara på egna exchanges/köer — sätts upp nu, inte i efterhand när `guest` redan sitter i alla configar
- Testharness: `bun test` för TS, `pytest` för Python, Testcontainers för e2e mot riktig Postgres/RabbitMQ
- **CI-pipeline** (GitHub Actions): lint → typecheck → enhetstester → bygg → e2e → docker build
- **CD-pipeline** till staging, med PM2 + nginx — deploya det tomma skelettet skarpt
- Strukturerad loggning (pino / structlog) med correlation-id som följer med genom eventkedjan, **och en redigeringsregel som maskerar personnummer, lösenord och tokens** — den måste sitta innan första riktiga datat loggas
- Env-validering vid uppstart som kraschar tidigt vid saknad config
- **Seed-script** som skapar två tenants med varsina kunder, fakturor och användare. Litet, men gör manuell testning i varje efterföljande fas snabb — och är förutsättningen för att kunna prova tenant-isolering för hand.

**Klart när:** `docker compose up` ger fyra friska tjänster, CI är grön, och skelettet ligger deployat på staging bakom nginx.

### Fas 1 — Auth Service, tenancy och M2M

Detta är fasen där både multi-tenancy och tjänste-till-tjänst-auth grundläggs. Blir de rätt är resten billig; blir de fel läcker de överallt.

- `tenants` (namn, org_number, status) + `users` (`tenant_id`, roll, `auth_method`, email/password_hash eller pnr_hash), argon2/bcrypt
- **Registrering skapar tenant + första admin-användaren i en transaktion**, och publicerar `tenant.created`
- JWT bär `sub`, `tenantId` och `role` — access-token + refresh-token **lagrad i Redis** (möjliggör logout och återkallande)
- Endpoints: `POST /auth/register`, `/login`, `/logout`, `/refresh`, `/forgot-password`, `/reset-password`, `/verify-email`
- Verifierings- och återställningsmejl → skickas som event till documents

**Tre inloggningsvägar, en tokenmodell.** Alla tre ger samma sorts JWT, så resten av systemet behöver inte veta hur någon loggade in:

| Vem | Metod | Hur kontot skapas |
|---|---|---|
| Admin (företagets anställda) | e-post + lösenord | Registrering, eller inbjudan från befintlig admin |
| Företagskund | e-post + lösenord | Admin lägger upp kunden → inbjudningsmejl med länk för att sätta lösenord |
| Privatkund | **BankID** | Admin lägger upp kunden med personnummer → **inget mer behövs**, kunden kan logga in direkt |

Privatkunder har alltså varken registrering, lösenord, e-postverifiering eller glömt-lösenord — hela den kedjan bortfaller för dem.

**BankID i fas 1, men mockad:**

- `POST /auth/bankid/init` → returnerar `orderRef` och QR-data; `POST /auth/bankid/collect` → pollar tills signerat (BankID:s egna flöde)
- Bakom ett **provider-gränssnitt** med två implementationer: `MockBankIdProvider` (används lokalt och i CI) och senare `RealBankIdProvider`. Riktig BankID går inte att köra i en pipeline, så mocken är inte en genväg utan en förutsättning för att e2e-testerna ska kunna existera.
- Vid signering: hämta pnr från BankID-svaret → slå upp `pnr_hash` i `users` → utfärda JWT. Finns ingen matchande användare avvisas inloggningen; **inget konto skapas automatiskt** av en lyckad BankID-signering.
- **Delat auth-paket i `packages/shared`**: verifierar JWT och bygger ett `RequestContext { userId, tenantId, role }` som billing/payments tar emot. Tenant får aldrig läsas från body, query eller header.
- **Repository-basklass** som tar `RequestContext` och lägger på tenant-filtret automatiskt — så inget repository kan råka köra en ofiltrerad query

**M2M i samma fas:**

- `service_clients`-tabell (client_id, hashad secret, tillåtna scopes) + `POST /auth/token` med `client_credentials`
- Asymmetrisk signering och `GET /.well-known/jwks.json` för verifiering
- `requireUser()` och `requireService(scope)` som **två separata funktioner** i `packages/shared`
- Klient-helper som hämtar och Redis-cachar tjänste-token, med förnyelse strax före utgång

**Tester:** enhetstester på token-generering, hashning, utgångslogik och rollkontroll. E2e: hela register → verifiera → login → refresh → logout-kedjan, plus ett test som bevisar att en manipulerad `tenantId` i request-body ignoreras. BankID-flödet testas mot mocken: signerad order med känt pnr ger JWT, signerad order med okänt pnr ger `401` utan att skapa konto, avbruten order ger inget token.

**Säkerhetstester som måste finnas innan fasen är klar:**

- Ett **användar-token avvisas** på en `requireService()`-endpoint, och ett **tjänste-token avvisas** på en `requireUser()`-endpoint
- Ett tjänste-token med fel scope ger `403`
- `X-Tenant-Id` ignoreras på användar-endpoints även när den skickas med

### Fas 2 — Billing Service, kärnan

- Omskriven migration enligt ovan (`tenant_id`, `company_settings`, per-tenant unika index, **belopp som `BIGINT` i öre**)
- `customers` CRUD, `invoices` CRUD, `invoice_items` — alla via tenant-filtrerade repositories
- **OCR-generering**: Luhn mod-10 med längdsiffra — ren funktion, tungt enhetstestad. Unik per tenant, med omgenerering vid krock.
- **Fakturanummer per tenant**: räknare i `company_settings` som hämtas med `SELECT ... FOR UPDATE` inuti samma transaktion som fakturan skapas — aldrig beräknat i appkod utan lås, det ger race conditions och hål i nummerserien
- Momsberäkning per rad + summering (25/12/6 %), avrundning i heltal öre enligt svensk praxis
- **Statusregler enligt domänregel 1:** `PUT`/`DELETE` endast på `draft`, annars `409` med förklarande felmeddelande
- **`POST /admin/invoices/:id/credit`** — kreditfaktura med negativa belopp, `credits_invoice_id` mot originalet, originalet sätts till `credited`. Får eget fakturanummer ur samma serie.
- **`Idempotency-Key`-header på `POST /admin/invoices`** — nyckeln lagras med svaret, en upprepad request returnerar samma faktura istället för att skapa en till. Utan detta ger ett dubbelklick två fakturor, två OCR och två mejl till kunden.
- Skriver `invoice.created` till `event_outbox` i samma transaktion som fakturan; publisher skickar vidare till RabbitMQ

**Tester:** enhetstester på OCR (inkl. kända giltiga/ogiltiga nummer), momsberäkning och avrundning — här är buggarna dyrast. Samtidighetstest som skapar fakturor parallellt och verifierar att nummerserien är obruten och utan dubbletter. Test som bekräftar att `PUT`/`DELETE` mot en skickad faktura ger `409`, och att en kreditfaktura nollar originalets belopp. E2e: skapa faktura via API → verifiera rader, totaler, OCR och att eventet landade i kön. **Isoleringstest:** företag A får `404` på företag B:s faktura och kund.

### Fas 3 — Documents & Delivery (Python)

- FastAPI-tjänst som konsumerar `invoice.created`
- PDF via WeasyPrint (HTML-mall → PDF) med den **avsändande tenantens** logga, bankgiro och orgnr, hämtat från billings API med tjänste-token (`billing:company:read`) och `X-Tenant-Id` från event-envelopen
- Lagring: MinIO lokalt / S3 i drift, filer nås via signerad URL. Nycklar prefixas med `tenantId/` så en felaktig sökväg inte kan träffa fel företags dokument.
- E-postutskick med **outbox-mönster**: skriv först till `email_outbox`, skicka sen, markera skickat — så ett kraschat utskick kan återupptas utan dubbletter
- Idempotens på `tenant_id + invoice_id + document_type` — samma faktura genererar aldrig två PDF:er
- Retry med exponentiell backoff, dead-letter-kö för permanenta fel
- Publicerar `document.generated` och `email.sent`

**Bounce-hantering.** Att mejlet lämnade servern betyder inte att det kom fram. En faktura som studsar är ur systemets synvinkel skickad men har i praktiken aldrig nått kunden — och det påverkar när betalningsvillkoren börjar löpa. Därför:

- `email_outbox` har en livscykel: `queued` → `sent` → `delivered` | `bounced` | `complaint`, inte bara "skickat"
- `POST /webhooks/email-status` tar emot leverantörens statusrapporter (Postmark/SendGrid/SES), med **signaturvalidering** — endpointen är publik och får inte gå att spoofa
- **Hård studs** (adressen finns inte) markerar kundens e-postadress som ogiltig så systemet slutar skicka dit; **mjuk studs** (full brevlåda) får fortsätta försöka enligt retry-policyn. Att behandla dem lika är det som får avsändardomäner svartlistade.
- Publicerar `email.bounced` → billing sätter leveransstatus på fakturan
- `GET /admin/deliveries?status=failed` i billing, så admin faktiskt kan **se** vilka fakturor som aldrig kom fram — annars är hela bounce-hanteringen bara en kolumn ingen tittar på

**Tester:** pytest-enhetstester på mallrendering, outbox-övergångar och skillnaden mellan hård och mjuk studs. Test som avvisar en webhook med felaktig signatur. E2e: publicera ett `invoice.created` → PDF finns i storage → mejl i mock-SMTP → `email.sent` publicerat; och en andra körning där leverantören rapporterar hård studs → fakturan syns i `/admin/deliveries?status=failed` och kundens adress är flaggad.

### Fas 4 — Kundportal

- Kundinloggning via Auth Service (roll `customer`, kopplad till både `tenant_id` och `customer_id`) — **BankID för privatkunder, e-post + lösenord för företagskunder**, båda mynnar ut i samma JWT så portalens övriga endpoints inte behöver skilja på dem
- **Inbjudningsflöde för företagskunder:** admin lägger upp kunden → mejl med engångslänk för att sätta lösenord. Länken är tidsbegränsad och förbrukas vid användning.
- Privatkunder behöver inget inbjudningsflöde — de loggar in med BankID så snart admin lagt upp dem med personnummer
- `GET /portal/invoices`, `GET /portal/invoices/:id`
- `GET /portal/invoices/:id/pdf` — signerad, tidsbegränsad URL
- `GET /portal/account-summary` — total utestående skuld
- Åtkomstkontroll i **två lager**: rätt tenant *och* rätt kund inom den tenanten

**Tester:** e2e som försöker läsa (a) en annan kunds faktura hos samma företag och (b) en faktura hos ett annat företag — båda ska ge `404`. De testerna ska finnas innan endpointen anses klar. Båda inloggningsvägarna körs genom samma testsvit: en privatkund via mockad BankID och en företagskund via lösenord ska få identisk åtkomstkontroll.

### Fas 5 — Payments Service

- Ingest på två vägar: `POST /webhooks/payment-received` och filimport (mockad Bankgiro `.tlr`)
- Idempotens på banktransaktions-id — samma fil får importeras om utan effekt
- **Tenant bestäms av mottagarbankgirot, inte av OCR-numret.** Varje tenant har ett eget bankgiro i `company_settings`; banktransaktionen säger vilket konto pengarna kom in på. Matchningen är alltså `bankgiro → tenant → OCR inom den tenanten`. Detta är nödvändigt eftersom OCR bara är unikt per tenant — banken vet inget om tenants.
- Kommer en transaktion in på ett okänt bankgiro avvisas den till manuell hantering; den gissas aldrig till en tenant
- OCR-matchning mot fakturor via HTTP-uppslag mot billing med tjänste-token (`billing:invoice:read`), inte direkt DB-läsning
- **Delbetalning:** matcha belopp < fakturabelopp → publicera `payment.partial` med restskuld
- **Överbetalning och obetalbar transaktion:** hamnar i manuell hantering-kö, tappas aldrig tyst
- Billing konsumerar → sätter `paid` eller uppdaterar restskuld

**Tester:** enhetstester på matchningslogiken (exakt, del, över, okänt OCR, okänt bankgiro, dubblett). E2e: full kedja faktura → betalning → status `paid`. **Isoleringstest:** två tenants med **samma** OCR-nummer får sina betalningar rätt matchade tack vare bankgirot — det testet är hela beviset för att matchningsmodellen håller.

### Fas 6 — Betalningsinitiering i kundportalen

[src/plan.md:35](src/plan.md:35) säger att kunden ska kunna **betala** en faktura, inte bara se den. Fas 5 hanterar pengar som redan kommit in via banken — den här fasen låter kunden starta betalningen inifrån portalen.

- `POST /portal/invoices/:id/pay` skapar en betalningssession hos leverantören (Stripe i testläge räcker för övning; Swish kräver certifikat på samma sätt som BankID)
- Leverantörens webhook tas emot av **payments-tjänsten**, som redan äger den säkerhetsytan — samma signaturvalidering och idempotens som bankfilerna
- **Betalningsstatus är alltid webhookens, aldrig redirectens.** Att kunden landar på "tack"-sidan bevisar ingenting; en betalning räknas som genomförd först när den signerade webhooken bekräftat den.
- Resultatet blir en `payment.matched` precis som en bankbetalning — resten av kedjan är redan byggd i fas 5 och behöver inte ändras
- Belopp verifieras mot fakturan på servern, aldrig mot ett belopp som kommer från klienten

**Tester:** enhetstest på signaturvalidering av webhooken (inkl. avvisad felaktig signatur). E2e mot leverantörens testläge: skapa session → simulera betalning → fakturan blir `paid`. Test som bekräftar att en manipulerad beloppsparameter från klienten ignoreras.

### Fas 7 — Automatisering och cronjobb

Cron ligger i billing-tjänsten, men **skyddad av Redis-lås** så jobbet kör exakt en gång även om tjänsten skalas till flera instanser.

- **Dagligt jobb kl. 03:00 `Europe/Stockholm`** (uttalad tidszon enligt domänregel 4, annars kör det två gånger eller noll gånger vid DST-övergångarna i mars och oktober): hitta fakturor där `date_due < today` och status ≠ `paid` → sätt `overdue` → generera påminnelsefaktura med påminnelseavgift (60 kr) → publicera event som ger PDF + mejl
- **Påminnelse vid delbetalning:** nytt belopp = restskuld + avgift
- **Återkommande fakturor:** läs `invoice_templates` där `next_generation_date <= today` → skapa faktura → flytta fram datumet
- **Cron kör över alla tenants**, men varje resulterande faktura och event bär rätt `tenant_id`. Jobbet itererar per tenant så ett fel hos en tenant inte stoppar de andra.
- Varje körning loggas per tenant så den kan granskas i efterhand

**Tester:** enhetstester på urvalslogiken med manipulerad klocka, **inklusive de två DST-dygnen** — det är där tidszonsbuggar visar sig. E2e: förfallen faktura → kör jobbet → påminnelsefaktura med rätt belopp finns, PDF genererad, mejl skickat. Test som körs två gånger i rad och verifierar att ingen dubbelpåminnelse skapas. **Isoleringstest:** två tenants med förfallna fakturor får var sin påminnelse med rätt avsändaruppgifter.

### Fas 8 — Härdning och drift

- nginx: TLS, rate limiting på auth-endpoints, routing till alla fyra tjänsterna. **Interna S2S-endpoints exponeras inte publikt** — de nås bara på det interna nätverket, så M2M-auth är andra försvarslinjen och inte den enda.
- Rotation av signeringsnycklar och `client_secret` provkörd minst en gång, med båda nycklarna giltiga samtidigt
- PM2 cluster mode, log rotation, auto-restart, `ecosystem.config.js`
- CI/CD: full deploy-pipeline med migrationssteg och rollback
- Kontraktstester mellan tjänsterna så en eventändring bryter CI, inte produktion
- Observability: metrics, köövervakning, larm på dead-letter-kön
- **Valfri skärpning av tenant-isoleringen:** Postgres Row-Level Security på de tenant-ägda tabellerna gör isoleringen till en databasgaranti istället för en applikationsgaranti. Kan läggas till här utan att någon applikationskod ändras.

### Fas 9 — Riktig BankID-integration

Gränssnittet och flödet finns redan från fas 1; här byts `MockBankIdProvider` mot `RealBankIdProvider` mot BankID:s RP-testmiljö, och senare mot produktion.

- Certifikathantering (RP-certifikat, mTLS mot BankID:s API)
- Testmiljöns testpersonnummer i staging, riktiga certifikat i produktion
- **Mocken tas inte bort** — CI fortsätter köra mot den, eftersom BankID inte går att automatisera i en pipeline

Att detta ligger sist är avsiktligt: certifikat och avtal är administrativt trögt, och inget annat i systemet ska behöva vänta på det. Kundportalen är fullt byggd och testad långt innan.

---

## Kritiska filer

**Skrivs om:**
- [migrations/1775829869264_initial-migration.js](migrations/1775829869264_initial-migration.js) — `admins` delas i `tenants`/`users`/`company_settings`, `admin_id` → `tenant_id`, per-tenant unika index, `DECIMAL(15,2)` → `BIGINT` i öre, `credits_invoice_id` på `invoices`, samt `event_outbox`. Ligger kvar som gemensam migration för hela databasen.
- [src/index.ts](src/index.ts) — blir `services/billing/src/index.ts`, dubblerad DB-uppkoppling (`@fastify/postgres` + `postgres.js`) rensas till en
- [package.json](package.json) — workspace-rot
- [docker-compose.yml](docker-compose.yml) — utökas med redis, rabbitmq, nginx och alla tjänster
- [Dockerfile](Dockerfile) — en per tjänst; nuvarande använder npm/node trots att projektet kör Bun

**Återanvänds som de är:**
- [src/error/error.ts](src/error/error.ts) och [src/error/errorHandler.ts](src/error/errorHandler.ts) → `packages/shared/` — `BaseError`-hierarkin är redan färdig och ska användas av alla TS-tjänster
- Lagermönstret routes/controllers/services/repository/mappers i `src/invoices/` m.fl.

**Föråldrad:**
- [db.md](db.md) — beskriver Auth0, som valts bort. Tenant-modellen där stämmer däremot fortfarande. Ersätts av rules-filerna och denna plan.

---

## Verifiering

Varje fas har ett eget "klart när", men systemet som helhet verifieras så här:

1. `docker compose up` — alla tjänster friska, `/health` svarar på var och en
2. `bun test` och `pytest` — enhetstester gröna i alla fyra tjänsterna
3. `bun run test:e2e` — e2e-svit mot riktig Postgres/RabbitMQ via Testcontainers
4. **Manuellt rökprov av hela kedjan:** registrera företag → skapa kund → skapa faktura → kontrollera att PDF genererats med rätt företagslogga och att mejl landat i mock-SMTP → posta en betalning med rätt OCR → fakturan blir `paid`
5. **Rökprov av påminnelsekedjan:** skapa faktura med passerat förfallodatum → kör cronjobbet manuellt → påminnelsefaktura med avgift finns, PDF och mejl skickade
6. **Rökprov av kreditering:** skickad faktura → `PUT` och `DELETE` ger `409` → kreditfaktura skapas → originalet står som `credited` och nummerserien är obruten
7. **Tenant-isoleringssvit:** en dedikerad e2e-svit som seedar två företag med varsin kund och faktura, och verifierar att varje skyddad endpoint ger `404` över tenant-gränsen. Den sviten växer med varje ny endpoint och är en del av Definition of Done i `rules/testing.md`.
8. **M2M-svit:** verifierar att användar- och tjänste-tokens inte kan bytas mot varandra, att fel scope ger `403`, att ett anrop helt utan token ger `401`, och att `X-Tenant-Id` bara har effekt när avsändaren är en autentiserad tjänst.
9. CI grön på alla steg innan merge till main
