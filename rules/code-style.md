# Kodstil

## Lagerindelning

Varje modul följer samma struktur, och varje lager har exakt ett ansvar:

```
routes/       → HTTP-vägar, kopplar på schema
controllers/  → plocka isär request, anropa service, forma svar
services/     → affärslogik
repository/   → SQL
schema/       → JSON Schema för inkommande data
mappers/      → översätt mellan databasrad och API-form, öre → kronor
types/        → TypeScript-typer för modulen
```

1. **Anrop går bara nedåt.** Route → controller → service → repository. Ett repository anropar aldrig en service.
2. **Ingen affärslogik i controllers.** Ser du ett `if` som handlar om fakturor och inte om HTTP hör det hemma i en service.
3. **Ingen SQL utanför repository.**
4. **Controllers rör aldrig databasrader direkt** — de får det mappers gett dem.
5. **Services känner inte till HTTP.** Ingen `request`, ingen `reply`, inga statuskoder i en service. Den kastar fel; controllern eller felhanteraren översätter.

## Namngivning

6. **Databasen är `snake_case`, TypeScript är `camelCase`.** Mappers är enda stället där de möts.
7. **Booleans börjar med `is`, `has` eller `should`** — `isActive`, `hasBounced`.
8. **Inga förkortningar utom vedertagna** (`id`, `vat`, `ocr`, `pdf`). `inv` eller `cust` säger ingenting.
9. **Belopp har enheten i namnet** — `totalOre`, aldrig bara `total`.
10. Svenska domänbegrepp behåller sitt svenska namn där det är tydligast (`bankgiro`, `orgNumber`), men kod och kommentarer skrivs i övrigt på engelska.

## Fel

11. **Alla fel är subklasser av `BaseError`** från `packages/shared`. Kasta aldrig en sträng, aldrig en naken `Error`.
12. **Välj rätt felklass** — `NotFound`, `BadRequest`, `Conflict`, `Forbidden`, `Unauthorized`. Statuskoden kommer därifrån, sätt den aldrig för hand.
13. **Felmeddelanden till klienten avslöjar inget internt** — ingen SQL, inga stack traces, inga tabellnamn. `full_error` är för loggen, `toPublicError()` för svaret.
14. **Ett `404` över tenant- eller kundgränsen, aldrig `403`.** Att svara "förbjudet" bekräftar att resursen finns hos någon annan. `403` används bara när anroparen är rätt identifierad men saknar behörighet — till exempel ett tjänste-token med fel scope.
15. **Svälj aldrig ett fel.** Ingen tom `catch`. Kan du inte hantera felet, låt det bubbla.

## TypeScript

16. **`strict: true`.** Ingen `any` utan en kommentar som förklarar varför.
17. **Inga flytande promises.** Varje `async`-anrop `await`:as eller hanteras uttryckligen.
18. **Validera inkommande data vid gränsen** — Fastifys schema på varje route. Inne i systemet är data betrodd, vid gränsen är den det inte.
19. **Returtyper skrivs ut på publika funktioner.** Inferens är bra internt, men en exporterad funktions kontrakt ska synas.

## Säkerhet

20. **Lösenord hashas med argon2id.** Aldrig sha256, aldrig md5, aldrig egen salt-hantering.
21. **Tokens lagras hashade och jämförs tidssäkert** med `crypto.timingSafeEqual`. En vanlig `===` på en hemlighet läcker information genom hur lång tid jämförelsen tar.
22. **Rate limiting på allt som gissar sig fram** — login, BankID-init, glömt lösenord, återställningslänkar. Byggs i den fas där endpointen skapas (fas 1/2), inte skjutet till en härdningsfas — sju faser oskyddad är för länge. Grov, per-IP-gräns sitter i nginx; fin, per-konto-gräns i Fastify mot en Redis-räknare (delad över instanser — se `packages/shared/src/redis`).
23. **Hemligheter kommer från miljön, aldrig från koden.** Inga nycklar, certifikat eller lösenord i repot. `.env.example` innehåller bara placeholder-värden, aldrig riktiga.
24. **Seed-scriptet vägrar köra utanför utvecklingsmiljö.** Ett script som skapar kända konton med kända lösenord är en bakdörr om det råkar köras i produktion.
25. **JWT-verifiering pinnar algoritmen explicit** (`algorithms: ['HS256']` eller motsvarande). `alg`-fältet i tokenens header litas aldrig på — det är grunden för `alg: none`-attacken.
26. **CORS, `helmet`/säkerhetsheaders och en `bodyLimit`** registreras i varje tjänst från dess första commit, inte i efterhand. Origin-listan är explicit per miljö, aldrig `*` när cookies eller `Authorization` är med.

## Struktur

27. **Ingen delad kod mellan tjänster utom via `packages/shared` och `packages/contracts`.** Kopiera inte en hjälpfunktion mellan tjänster — flytta den till `shared`. documents (Python) delar inte `packages/shared`, men läser samma scheman ur `packages/contracts/schemas` — se kommentaren i `services/documents/src/documents/contracts.py`.
28. **Konfiguration läses en gång vid uppstart och valideras.** Inga `process.env` utspridda i affärslogiken.
29. **Ingen kod bakom en flagga som aldrig sätts.** Dör en kodväg, ta bort den.

## Enkelhet

30. **Skriv den uppenbara lösningen först.** Optimera när något mätbart är för långsamt, inte när du misstänker att det kan bli det.
31. **En funktion gör en sak.** Behöver du "och" för att beskriva den, dela den.
32. **Färre filer slår fler filer.** Skapa inte en modul för en funktion.
33. **Kommentarer förklarar varför, inte vad.** Behöver koden en kommentar för att förstås alls, skriv om koden i stället.
