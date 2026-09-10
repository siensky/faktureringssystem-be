# Arkitekturregler

Gäller all kod i alla tjänster. Bryts en regel här växer tjänsterna ihop och hela poängen med uppdelningen försvinner.

## Tjänstegränser

| Tjänst | Äger tabellerna |
|---|---|
| auth | `tenants`, `users`, `user_tokens`, `service_clients` |
| billing | `company_settings`, `customers`, `invoices`, `invoice_items`, `invoice_templates` |
| documents | `documents`, `emails` |
| payments | `bank_transactions` |

`event_outbox` och `processed_events` är **gemensamma tabeller** — en av varje, inte en per tjänst. `event_outbox.source_service` och `processed_events.consumer` skiljer raderna åt, och varje tjänst rör bara sina egna. En tabell med en kolumn är enklare än fyra tabeller som gör samma sak.

1. **Endast ägande tjänst skriver till sina tabeller.** Ingen `INSERT`, `UPDATE` eller `DELETE` mot en annan tjänsts tabell.
2. **Endast ägande tjänst läser sina tabeller.** Behöver du data från en annan tjänst: anropa dess API eller lyssna på dess event. Aldrig en `JOIN` över gränsen.
3. Databasen är gemensam, så inget hindrar dig rent tekniskt. Regeln upprätthålls av kodgranskning — det är därför den står här.

## Event

**Namn:** `<entitet>.<verb i dåtid>` — `invoice.created`, `payment.matched`, `email.bounced`. Aldrig imperativ (`send.email`); ett event beskriver något som *har hänt*, inte en order.

**Envelope** — alla event har exakt denna form:

```json
{ "eventId": "uuid", "eventType": "invoice.created", "tenantId": 1,
  "correlationId": "uuid", "occurredAt": "2026-08-04T10:00:00Z", "payload": {} }
```

4. **`tenantId` är obligatoriskt.** Saknas det går eventet till dead-letter. Gissa aldrig.
5. **`correlationId` följer med hela kedjan** — sätts vid första inkommande request och kopieras vidare i varje event och HTTP-anrop. Utan det går ett fel inte att spåra genom fyra tjänster.
6. **Publicering sker via outbox.** Skriv affärsdata och event till `event_outbox` i *samma transaktion*. En separat publisher skickar vidare. Publicera aldrig direkt från affärslogiken — failar publiceringen efter commit är datan sparad men eventet borta för alltid.
7. **Varje konsument är idempotent — men markera på rätt sätt beroende på sidoeffekten.** Outbox ger at-least-once, samma event kommer ibland två gånger. Nyckeln `(event_id, consumer)` i `processed_events` är dedupen. Ordningen mellan markering och jobb skiljer sig åt:
   - **Sidoeffekten är en skrivning i den egna databasen:** `INSERT INTO processed_events` → gör jobbet → `COMMIT`, allt i *en* transaktion. Unique-violation = redan hanterat, `ack`:a och gör inget. Kraschar jobbet rullar markeringen tillbaka och eventet får ett ärligt nytt försök.
   - **Sidoeffekten är extern** (S3, SMTP, ett HTTP-anrop): gör jobbet **först**, markera efteråt. Markera före en extern effekt och krascha sedan = eventet permanent bokfört som hanterat utan att effekten skett (at-least-once har blivit at-most-once). Här är den *naturliga* idempotensnyckeln (t.ex. `tenant_id + invoice_id + document_type`) garantin; `processed_events` blir bara en optimering som slipper göra om arbetet.
8. **Payload innehåller id:n, inte hela objekt.** Skicka `invoiceId`, låt konsumenten hämta det den behöver. Annars blir eventet ett andra ställe där fakturadata bor och kan bli inaktuell.

## Idempotens överallt, inte bara i event

Allt som kan köras om **kommer** att köras om — av en retry, en omstart, ett dubbelklick eller en manuell körning. Fyra ställen, samma princip:

9. **Event:** `processed_events`, se ovan.
10. **Skapande via API:** `POST /admin/invoices` kräver en `Idempotency-Key`-header. Nyckeln lagras med svaret; en upprepad request returnerar samma faktura istället för att skapa en till. Utan detta ger ett dubbelklick två fakturor, två OCR och två mejl till kunden.
11. **Webhooks och filimport:** deduplicera på avsändarens id — `bank_transactions.external_id` är `UNIQUE`. Samma fil ska gå att importera om utan effekt.
12. **Cronjobb:** ett jobb som körs två gånger samma dag får inte skapa två påminnelser. Villkoret måste vara sådant att andra körningen inte hittar något att göra — kolla att en påminnelse inte redan finns för fakturan, förlita dig inte på att jobbet bara körs en gång.

## Tenant

13. **`tenantId` kommer från JWT.** Aldrig från request-body, query eller header på användar-endpoints. En användare får aldrig välja vilken tenant den agerar i.
14. **All SQL går genom repository-lagret**, som lägger på `WHERE tenant_id = ?` automatiskt. Skriv aldrig en query utanför ett repository.
15. **Varje skyddad endpoint har ett isoleringstest** som bevisar att företag A får `404` på företag B:s resurs. Endpointen är inte klar utan det.

## M2M

16. **Två separata funktioner: `requireUser()` och `requireService(scope)`.** Ingen endpoint anropar en generisk "verifiera token". Ett tjänste-token saknar `tenantId` helt — accepteras det på en användar-endpoint blir tenant-filtret tomt och allt läcker till alla.
17. **`X-Tenant-Id` litas på endast från `requireService()`.** En autentiserad tjänst får hävda vilken tenant den agerar för. En slutanvändare får det aldrig — `requireUser()` ignorerar headern helt.
18. **Minsta möjliga scope.** En tjänst begär bara de scopes den faktiskt använder. Ett tjänste-token utfärdas via OAuth2 `client_credentials` (`POST /auth/token`); scopen är en mellanslagsseparerad `scope`-claim, och bara scopes som klienten *både* begär och har i `service_clients.allowed_scopes` beviljas. TTL 5 minuter — kort livstid är den enda revokering ett stateless token har.
19. **Fel scope ger `403`, inte `401`.** Saknad eller ogiltig token = `401` (vem är du?). Giltig token men utan rätt scope = `403` (jag vet vem du är, du får inte). Samma skillnad som `code-style.md` #14.
20. **Skrivningar går aldrig via S2S-HTTP.** Behöver en tjänst ändra en annans data sker det via event till ägande tjänst.

## Tokens och tenant-filter

21. **Saknas tenant i `RequestContext` kastas ett fel — filtret får aldrig tyst utebli.** `WHERE tenant_id IS NULL` returnerar inget (ofarligt); ett *bortfallet* filter returnerar alla tenanters rader. Repository-basklassen (`packages/shared`) har därför `tenantId` som en getter som kastar, inte ett fält som kan vara `undefined`.
22. **JWT-verifiering pinnar algoritmen** (`algorithms: ['HS256']`) och validerar `iss`, `aud` och `token_type`. `alg` i token-headern litas aldrig på (`alg: none`-attacken). Användar-token har `aud: api`, tjänste-token `aud: internal` — en token som passerar fel dörr avvisas på flera oberoende fält.
23. **HS256 är ett uttalat val, inte en glömska.** Den hemlighet som *verifierar* en token-klass kan också *signera* i den klassen. Skadan begränsas av: separat hemlighet per klass (`JWT_USER_SECRET`, `JWT_SERVICE_SECRET`), distribuerad bara till de tjänster som verifierar respektive klass; kort livstid på tjänste-tokens; och att all signering/verifiering ligger i `packages/shared/auth` så en uppgradering till asymmetriska nycklar är två rader.

## Enkelhet

Den här delen väger tyngre än den ser ut. Ett system med fyra tjänster, en kö och en cache har redan all komplexitet det tål.

24. **Välj den tråkiga lösningen.** En `WHERE`-sats slår en cache. En kolumn slår en tabell. En funktion slår ett interface.
25. **Ingen abstraktion förrän du har två verkliga fall.** Ett interface med en implementation är inte flexibilitet, det är ett extra lager att läsa igenom. Undantag: mockade externa tjänster (BankID, e-post, betalningar), där det andra fallet är testet.
26. **Redis, cache och köer läggs till när något faktiskt är för långsamt** eller när ordningen kräver det — inte i förväg.
27. **Ta bort kod istället för att kommentera bort den.** Historiken finns i git.
28. **Om en regel här gör en enkel uppgift krånglig, ifrågasätt regeln** i stället för att bygga runt den. Reglerna finns för att förhindra kaos, inte för att skapa det.
