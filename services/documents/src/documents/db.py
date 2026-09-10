"""asyncpg-pool för documents. Motsvarigheten till packages/shared/src/db
på TS-sidan — en pool per process, skapad vid uppstart och stängd vid
graceful shutdown. All SQL bor i repository.py (code-style.md #22, samma
princip som TS-tjänsterna även om Python-sidan inte delar lagerkoden).
"""

from __future__ import annotations

import asyncpg


async def connect_db(dsn: str) -> asyncpg.Pool:
    # min_size 1 så en trasig databas syns direkt vid uppstart i stället
    # för vid första query. Litet tak — documents kör en handfull
    # bakgrundsloopar, ingen request-storm.
    return await asyncpg.create_pool(dsn, min_size=1, max_size=8)


async def close_db(pool: asyncpg.Pool | None) -> None:
    if pool is not None:
        await pool.close()
