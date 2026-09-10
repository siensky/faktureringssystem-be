# Domänregler

Reglerna för fakturering som svensk lag och praxis kräver. De är inte förhandlingsbara och får inte kringgås för att något blir enklare att bygga.

## Fakturans livscykel

```
draft ──► sent ──► paid
            │
            ├──► overdue ──► paid
            │
            └──► credited
```

1. **`draft` är enda status där fakturan får ändras eller raderas.** `PUT` och `DELETE` mot en faktura i något annat läge svarar `409`. Ett utkast har ännu inget fakturanummer och ingen OCR — de tilldelas vid utskick.
2. **En skickad faktura är en bokföringspost.** Den får aldrig redigeras, aldrig raderas, aldrig få nytt belopp. Rättelse sker med kreditfaktura.
3. **Status går aldrig baklänges.** En `paid` faktura blir inte `sent` igen.

## Kreditfaktura

4. **Fel på en skickad faktura rättas med `POST /admin/invoices/:id/credit`.** Det skapar en *ny* faktura med negativa belopp och `credits_invoice_id` mot originalet. Originalet sätts till `credited` men rörs inte i övrigt.
5. Kreditfakturan tar ett eget nummer ur samma serie — den är en egen bokföringspost.

## Nummerserie

6. **Fakturanummer är obrutna per företag.** Inga hål, inga dubbletter, ingen omstart.
7. **Numret hämtas med `SELECT ... FOR UPDATE` i samma transaktion som det tilldelas** — vid `POST /:id/send` för en vanlig faktura, vid `POST /:id/credit` för en kreditfaktura. Failar den transaktionen rullar numret tillbaka med den. Ett utkast förbrukar inget nummer, så att radera ett utkast river inget hål i serien.
8. Varje företag har sin egen serie. Företag A och företag B har båda en faktura nr 1.

## Pengar

9. **Allt i öre som heltal.** Se `database.md`.
10. **Moms räknas per rad och summeras**, inte på totalen. Avrundning sker en gång, på radnivå, med **matematisk avrundning halvt uppåt** (0,5 öre → 1 öre). Totalen är summan av de redan avrundade radbeloppen — ingen öresavrundning av totalen. En kreditrad negerar originalradens färdigt avrundade belopp i stället för att räkna om med negativa tal.
11. **Restskuld beräknas**, lagras aldrig: `total_incl_vat_ore - paid_ore`. Två kolumner som ska hållas i synk blir förr eller senare osynkade.

## Betalningar

12. **En delbetalning ökar `paid_ore`** och lämnar status oförändrad. Först när `paid_ore >= total_incl_vat_ore` blir fakturan `paid`.
13. **Tenant bestäms av mottagarbankgirot**, aldrig av OCR-numret — OCR är bara unikt inom ett företag.
14. **En obetalbar transaktion tappas aldrig tyst.** Okänt bankgiro, okänt OCR eller överbetalning går till manuell hantering.

## Påminnelser

15. **En påminnelse är en ny faktura** med `reminds_invoice_id` mot originalet, inte en ändring av originalet.
16. **Påminnelseavgiften ligger i `company_settings.reminder_fee_ore`** (60 kr = 6000 öre som standard), inte hårdkodad. **Rättslig not:** 60 kr påminnelseavgift förutsätter enligt lagen (1981:739) om ersättning för inkassokostnader att avgiften avtalats innan skulden uppkom. Kolumnen är per tenant och tenanten ansvarar för att det avtalet finns.
17. **Påminnelser skapas aldrig på påminnelser.** Kontrollera `reminds_invoice_id IS NULL` i urvalet.
18. Vid delbetalning är påminnelsens belopp restskulden plus avgiften.

## Personuppgifter och hemligheter

19. **Detta loggas aldrig** — inte i strukturerade loggar, felmeddelanden, URL:er eller stack traces: personnummer, lösenord, tokens, `client_secret`, JWT:er, återställningslänkar, signerade URL:er (PDF-länkar och liknande — de är bärartokens precis som återställningslänkar). Loggaren har en maskeringsregel; lita inte på att den fångar allt utan tänk efter innan du loggar ett helt objekt.
20. **`users` lagrar `pnr_hash`**, en HMAC-SHA256 med serverside-peppar. Aldrig personnummer i klartext i inloggningstabellen.
21. **Fakturadata raderas inte på begäran, den anonymiseras.** GDPR:s rätt till radering krockar med bokföringslagens arkiveringskrav på sju år. Bokföringslagen väger tyngre för själva fakturan — det är ett medvetet beslut, inte en glömska. En kund med fakturor kan därför inte raderas (`ON DELETE RESTRICT` från `invoices`); det som får hända är att person­uppgifter som inte ingår i bokföringen anonymiseras. Kunder helt utan fakturor får raderas.

## Inloggning

22. **En lyckad BankID-signering skapar aldrig ett konto.** Finns ingen matchande `pnr_hash` blir det `401`. Annars kan vem som helst med BankID skaffa sig åtkomst till vilket företag som helst.

## Utskick

23. **Hård studs stoppar framtida utskick** — sätt `customers.email_valid = false`. Mjuk studs (full brevlåda) får fortsätta enligt retry-policyn. Behandlar du dem lika blir din avsändardomän svartlistad.
24. **Ett skickat mejl är inte ett levererat mejl.** Fakturans leveransstatus följer leverantörens statusrapport, inte att `send()` returnerade utan fel.

## Externa anrop

25. **Webhooks signaturvalideras alltid** innan payloaden läses — betalningar, e-poststatus, allt. En publik endpoint utan signaturkontroll låter vem som helst markera fakturor som betalda.
26. **Betalningsstatus kommer från webhooken, aldrig från en redirect.** Att kunden landar på tack-sidan bevisar ingenting; den URL:en kan vem som helst besöka.
27. **Belopp verifieras alltid mot fakturan på servern**, aldrig mot ett belopp som klienten skickat med.


## Faktura- och leveransstatus (fas 3)

28. **`invoices.status` och `invoices.delivery_status` är två skilda kolumner.** `status` (`draft` · `sent` · `paid` · `overdue` · `credited` · `superseded` · `settled`) är den bokföringsmässiga livscykeln och ägs av admins handling i billing — den sätts av `POST /admin/invoices/:id/send`, aldrig av ett leveransevent. Är documents nere står fakturan ändå som `sent` och betalningsvillkoren börjar löpa.
29. **`delivery_status` (`none` · `queued` · `sent` · `delivered` · `bounced` · `failed`) ägs av documents statusrapporter och är monoton** — `delivered` skriver aldrig över `bounced`. `GET /admin/deliveries?status=failed` läser den här kolumnen.
30. Båda kolumnerna är `TEXT` + `CHECK`, inte `ENUM` — en livscykel som fortfarande rör sig ska inte kräva `ALTER TYPE`.

## OCR härleds ur fakturanumret (fas 3)

31. **OCR-referensen härleds ur fakturanumret:** `ocr = invoice_number ‖ längdsiffra ‖ Luhn-kontrollsiffra`, som Bankgirot gör det. Fakturanumret är redan obrutet och unikt per tenant, så en OCR-kollision är omöjlig per konstruktion. `UNIQUE (tenant_id, ocr_number)` ligger kvar som databasgaranti men ska aldrig lösa ut, och det finns ingen omgenereringsloop.
32. **OCR är därmed förutsägbart.** Det är ofarligt — numret står tryckt på fakturan — men det får **aldrig** användas som identitetsbevis. Portalens åtkomstkontroll går på tenant plus kund, aldrig på OCR.
33. **Betalningsmatchning följer `superseded_by_invoice_id`-kedjan.** Betalar en kund på en gammal fakturas OCR efter att en påminnelse gått ut, pekar OCR:et på en `superseded` faktura — matchningen måste följa kedjan till den aktuella fakturan och bokföra betalningen där. `GET /internal/invoices/by-ocr` gör den kedjeföljningen.

## Kreditfakturans livscykel (fas 3)

34. **En kreditfaktura (`invoice_type = 'credit_note'`) skapas av `POST /admin/invoices/:id/credit`** direkt i status `settled`, i samma transaktion som originalet sätts till `credited`. Den tar ett eget nummer ur samma serie (under samma radlås som utskick använder) och har negativa belopp — raderna är originalradernas färdigt avrundade belopp med ombytt tecken.
35. **En kreditfaktura blir aldrig `overdue`**, plockas aldrig av påminnelsejobbet och räknas aldrig som utestående. Den har ändå `delivery_status` eftersom den skickas till kunden som PDF.
