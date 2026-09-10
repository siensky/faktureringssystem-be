# Engångscontainer som kör alla migrationer mot den gemensamma databasen
# innan tjänsterna startar — så `docker compose up` är självförsörjande,
# ingen manuell `bun run migrate` behövs (lokalt eller i CI).
#
# Byggs från repo-roten för att komma åt migrations/. Egen minimal
# package.json (bara node-pg-migrate) — inget workspace-beroende.

FROM oven/bun:1-alpine
WORKDIR /app

COPY infra/migrate/package.json ./package.json
RUN bun install

COPY migrations ./migrations

# node-pg-migrate läser DATABASE_URL ur miljön och migrations/ ur cwd.
CMD ["bunx", "node-pg-migrate", "up"]
