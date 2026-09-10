# Engångscontainer: provisionerar S2S-klienter i service_clients och
# avslutar sig själv. Körs efter migrate, före tjänsterna (docker-compose.yml).
#
# Byggs från repo-roten. Egen minimal package.json (bara postgres.js) —
# inget workspace-beroende, precis som infra/migrate.

FROM oven/bun:1-alpine
WORKDIR /app

COPY infra/seed/package.json ./package.json
RUN bun install

COPY infra/seed/seed.ts ./seed.ts

CMD ["bun", "run", "seed.ts"]
