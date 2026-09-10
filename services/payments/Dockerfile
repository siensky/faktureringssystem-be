# Byggs från REPO-ROTEN (docker-compose.yml sätter context: . för denna
# tjänst), inte från services/payments/ — annars kan Bun inte lösa
# workspace-paketen @faktura/shared och @faktura/contracts, som denna
# tjänst beror på.

FROM oven/bun:1-alpine
WORKDIR /app

# Kopiera bara paketfilerna för hela workspacet först, så Docker kan cacha
# "bun install"-steget och slippa köra om det vid varje kodändring — det är
# bara package.json-filerna som avgör vad som installeras.
COPY package.json bun.lock ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY services/auth/package.json services/auth/package.json
COPY services/billing/package.json services/billing/package.json
COPY services/payments/package.json services/payments/package.json
RUN bun install --frozen-lockfile

# Resten av monorepo-koden som denna tjänst faktiskt kan nå (workspace-
# paketen + tjänsten själv) kopieras in. Övriga tjänsters src/ tas inte
# med — bara deras package.json ovan, som behövdes för att bun install
# skulle förstå hela workspacets beroendeträd.
COPY packages ./packages
COPY services/payments ./services/payments

WORKDIR /app/services/payments

# Bara till dokumentation/introspektion — faktisk port styrs av PORT.
EXPOSE 4003

CMD ["bun", "run", "src/index.ts"]
