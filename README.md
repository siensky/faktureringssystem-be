# Faktureringssystem

Multi-tenant SaaS för fakturering med automatisk betalningsmatchning. Se [CLAUDE.md](CLAUDE.md) för arbetssätt och [PLAN.md](PLAN.md) för arkitektur och faser.

## Köra allt lokalt

```bash
cp .env.example .env   # fyll i egna lokala värden
docker compose up -d
```

Det ger fyra friska tjänster bakom nginx på `localhost:${NGINX_PORT}` (default 8080):

| Tjänst | Port | Språk |
|---|---|---|
| auth | 4001 | TS/Bun |
| billing | 4002 | TS/Bun |
| payments | 4003 | TS/Bun |
| documents | 4004 | Python/FastAPI |

Plus infrastruktur: Postgres (`${DB_EXTERNAL_PORT}`), Redis, RabbitMQ (management-UI på `:15672`), MinIO (`:9001`), Mailpit (`:8025`).

Varje tjänst svarar på `/health/live` (processen lever) och `/health/ready` (Postgres/RabbitMQ/Redis nåbara — det Docker och nginx faktiskt agerar på).

## Utveckling

```bash
bun install          # rot-workspace, alla TS-paket och tjänster
bun run lint          # biome
bun run typecheck     # tsc --noEmit per workspace
bun test              # alla TS-tester
bun run migrate       # kör migrationerna mot DATABASE_URL
bun run codegen       # regenererar TS-typer ur packages/contracts/schemas
```

Python-tjänsten (`services/documents`) sköts med `uv`:

```bash
cd services/documents
uv sync
uv run pytest
uv run ruff check .
```

## Struktur

```
/services    auth, billing, payments (TS/Fastify), documents (Python/FastAPI)
/packages    shared (db, RabbitMQ, errors, logger, config, crypto, redis),
             contracts (event-scheman + genererade typer, delas med Python)
/apps        backoffice, portal (React — kommer fas 8/9)
/migrations  gemensam tidslinje, en migration per fas
/infra       nginx.conf, RabbitMQ-init
/rules       reglerna all kod följer
```
