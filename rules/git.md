# Git-regler

## Branches

1. **Aldrig commits direkt på `main`.** Allt går via branch och PR — även när du jobbar ensam, för då finns diffen att läsa i efterhand.
2. **En branch per avgränsad uppgift**, inte per fas. En fas är för stor för en PR.
3. **Namngivning:** `fas0/docker-compose`, `fas1/bankid-mock`, `fix/ocr-luhn-avrundning`.
4. **`main` ska alltid gå att deploya.** Är CI röd på `main` är det det enda som ska fixas.

## Commits

5. **Format:** `<typ>: <vad som ändrades>` i imperativ.

```
feat: lägg till OCR-generering med Luhn mod-10
fix: lås fakturanummer med FOR UPDATE
test: isoleringstest för portal-endpoints
chore: uppdatera docker-compose med redis
docs: skriv rules-filer
refactor: flytta felhantering till packages/shared
```

6. **En commit gör en sak.** Blandar du en bugfix med en omdöpning kan ingendera återställas för sig.
7. **Meddelandet säger varför när det inte är uppenbart.** `fix: lås fakturanummer` säger vad — brödtexten får förklara att två samtidiga fakturor annars fick samma nummer.
8. **Inga commits som `wip`, `fix`, `asdf` eller `funkar nu`** i historiken på `main`. Squasha ihop dem innan merge.

## Vad som aldrig committas

9. **`.env` och alla hemligheter.** Certifikat, nycklar, `client_secret`, BankID-certifikat. Kontrollera `.gitignore` innan första commit i en ny mapp.
10. **`node_modules`, byggartefakter, `.DS_Store`.**
11. **Riktiga personnummer eller kunddata** i seed-script eller tester. Använd BankID:s testpersonnummer.
12. Committar du en hemlighet av misstag: **rotera den**. Att ta bort den i nästa commit hjälper inte — den ligger kvar i historiken.

## PR

13. **Beskrivningen säger vad och varför**, inte bara vilka filer som ändrats.
14. **CI grön innan merge.** Ingen merge med röda tester.
15. **Definition of Done i `testing.md` uppfylld** innan en fas-PR mergas.
16. **Squash merge** till `main` — en logisk ändring blir en commit i historiken.
