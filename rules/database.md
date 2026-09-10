# Databasregler

## Migrationer

1. **En migration per fas**, numrerad och namngiven efter vad den gör. Faktisk ordning: `0001_extensions` (pgcrypto), `0002_auth` (tenants/users/user_tokens/service_clients), `0003_shared` (event_outbox/processed_events/idempotency_keys/audit_log), `0004_billing`, … Inte allt i en fil.
2. **En applicerad migration ändras aldrig.** Är den körd någonstans — även bara lokalt — skriv en ny migration istället. Att ändra en redan körd migration gör att din databas och andras skiljer sig utan att någon märker det.
3. **Varje migration har en fungerande `down`.** Går den inte att rulla tillbaka går deployen inte att ångra.
4. Migrationer ligger i `/migrations` i repots rot, en gemensam tidslinje för hela databasen.
5. **Seed-data ligger aldrig i en migration.** Migrationer beskriver strukturen; testdata kommer från seed-scriptet, som bara får köras i utvecklingsmiljö.

## Pengar

6. **Alla belopp är `BIGINT` i öre.** Aldrig `DECIMAL`, aldrig `FLOAT`. `postgres.js` returnerar `DECIMAL` som *sträng*, och första `parseFloat()` börjar tappa ören.
7. **Beloppskolumner slutar på `_ore`** — `total_incl_vat_ore`, `price_per_unit_ore`. Du ska aldrig behöva gissa enhet när du läser koden om tre veckor.
8. **Omvandling till kronor sker i mapper-lagret**, sista steget innan svaret lämnar API:et. Inne i systemet är allt öre.
9. Undantag: `quantity` och `vat_rate` är `NUMERIC` — de är inte pengar. Antal kan vara 2,5 timmar, momssats är 25,00 %.

## Tid

10. **Tidsstämplar är `TIMESTAMPTZ` och lagras i UTC.** Aldrig `TIMESTAMP` utan tidszon.
11. **Affärsdatum är `DATE`** — förfallodatum, fakturadatum. De tolkas i `Europe/Stockholm`, inte UTC. "Förfallen idag" avgörs i svensk tid.
12. **Cronjobb har uttalad tidszon.** Ett jobb schemalagt "03:00" utan tidszon kör två gånger eller noll gånger vid DST-övergången.

## Kolumner

13. **`NOT NULL` på allt som alltid har ett värde.** `DEFAULT NOW()` räcker inte — utan `NOT NULL` går ett explicit `NULL` fortfarande igenom.
14. **`NULL` betyder något.** Använd det bara när frånvaro är meningsfullt: `published_at IS NULL` = inte publicerad än. Inte som "vet inte".
15. **`created_at` och `updated_at` på alla tabeller** med affärsdata.
16. **Slutna värdemängder som fritext + `CHECK`, inte Postgres `ENUM`** — för sådant som fortfarande kan röra sig (status, roll, token-typ). En `ENUM` går inte att döpa om eller ta bort värden ur utan krångel. `ENUM` bara för mängder som är genuint stabila.

## Nycklar och index

17. **Index på `tenant_id`** i varje tenant-ägd tabell — varje query filtrerar på det.
18. **Unika constraints är per tenant**, inte globala: `UNIQUE (tenant_id, ocr_number)`, `UNIQUE (tenant_id, invoice_number)`. Globalt unikt får två orelaterade företag att konkurrera om samma nummer.
19. **Constraints i databasen, inte bara i koden.** Kan databasen garantera en regel ska den göra det — `CHECK`, `UNIQUE`, `FOREIGN KEY`. Appkoden har buggar; en constraint har det inte.
20. **`ON DELETE` väljs medvetet.** `CASCADE` för sådant som saknar mening utan sin förälder (fakturarader — `invoice_items` mot `invoices`), `RESTRICT` för sådant som aldrig får försvinna under fötterna på en bokföringspost (`invoices` och `invoice_templates` mot `customers`, `invoice_payments` mot `invoices`). `RESTRICT` mot kund är avsiktligt kopplat till att en kund med fakturor anonymiseras i stället för att raderas (`domain.md` #21).
21. **Lägg index när en query behöver det**, inte i förväg. Ett oanvänt index kostar vid varje skrivning.

## Queries

22. **All SQL bor i repository-lagret.** Ingen SQL i services, controllers eller routes.
23. **Parametriserade queries alltid.** Aldrig stränginterpolering in i SQL, oavsett hur säker datan känns.
24. **Läs-modifiera-skriv sker med lås.** Fakturanummer hämtas med `SELECT ... FOR UPDATE` i samma transaktion som fakturan skapas — annars får två samtidiga fakturor samma nummer.
25. **Skriv aldrig till en annan tjänsts tabeller.** Se `architecture.md`.

## Gemensamma tabeller

26. **`event_outbox` och `processed_events` är en tabell var**, inte en per tjänst. `source_service` respektive `consumer` skiljer raderna åt.
27. **Publishern plockar rader med `FOR UPDATE SKIP LOCKED`** filtrerat på sin egen `source_service`. Då kan flera tjänsters publishers arbeta mot samma tabell utan att blockera varandra.
28. **`event_outbox` bär hela livscykeln som kolumner:** `attempts`, `next_attempt_at`, `last_error`, `published_at`, `failed_at` (dead-letter). Ett **partiellt index** `WHERE published_at IS NULL AND failed_at IS NULL` — annars växer publisherns skanning monotont med hela historiken. `event_id` är `UUID`-PK satt när raden skrivs (samma id följer med vid en omsänd leverans, vilket är det som gör konsumentens dedup möjlig).


## Fas 3 — billing

29. **`paid_ore` lagras aldrig som kolumn.** Det beräknas som `SUM(invoice_payments.amount_ore)` per faktura. Samma skäl som `domain.md` #11 ger för restskuld, fast över en tjänstegräns: ett dubbellevererat `payment.matched` skulle öka en lagrad kolumn två gånger och göra en halvbetald faktura `paid`. `invoice_payments` har `UNIQUE (tenant_id, payment_id)` så en dubblett blir en unique-violation i stället för ett tyst felaktigt saldo. En cachad kolumn läggs till först om något mäts som för långsamt (`architecture.md` #22).
30. **Snapshoten (`invoice_snapshots`) är en frusen `JSONB`-kopia** av företagsuppgifter, kundadress, rader och summor som de såg ut vid utskick. Documents renderar PDF ur den, aldrig de levande tabellerna, så en senare ändring i `company_settings` inte ändrar en redan bokförd faktura. Beloppen i snapshoten är kvar i öre — den är en intern post, inte ett API-svar.
