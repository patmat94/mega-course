| Area | Choice | Source (session id + time) |
|------|--------|----------------------------|
| Job store | Postgres in Docker, compose service `db` (replaces the SQLite file `data/reorder.db`, which hit SQLITE_BUSY with four workers) | 019a35d2-7c41-7e08-a3f1-5b9e2d6c4a10 · proposed 2026-10-30T14:48:12Z, approved 2026-10-30T14:50:03Z |
| Image version | `postgres:17`, pinned to the image the shared CI runner keeps cached (replaces `postgres:16`); same locally | c41e7b02-93d5-4f6a-8e21-7a0b5d3f9c64 (subagent agent-a5c0e3d19b72f4e60) · proposed 2026-11-02T22:02:46Z, done 2026-11-02T22:03:06Z |
| Port | host port 5462 (container 5432), because 5432 clashes on the shared CI runner (replaces 5432); same locally | c41e7b02-93d5-4f6a-8e21-7a0b5d3f9c64 (subagent agent-a5c0e3d19b72f4e60) · proposed 2026-11-02T22:02:46Z, done 2026-11-02T22:03:06Z |
| Database | `reorder_ydps` (POSTGRES_DB in compose, and the database in the db url) | 5d8a1f37-0c62-4b9e-b7a4-e13f6c290d85 · proposed 2026-11-02T22:38:16Z, approved 2026-11-02T22:38:54Z |
| ORM | Drizzle (`drizzle-orm` + `drizzle-kit`), schema in `src/db/schema.ts` | 7f3c2a91-4e5b-4d1a-9b8e-2c6d0f1a3b57 · proposed 2026-10-29T09:41:36Z, approved 2026-10-29T09:44:51Z |
| ORM dialect | `postgresql` in the db config | 019a35d2-7c41-7e08-a3f1-5b9e2d6c4a10 · proposed 2026-10-30T14:48:12Z, approved 2026-10-30T14:50:03Z |
| Schema | one table `reorder_jobs`, unique on (`sku`, `night`), so a re-run of a night never queues a SKU twice | 7f3c2a91-4e5b-4d1a-9b8e-2c6d0f1a3b57 · proposed 2026-10-29T09:41:36Z, approved 2026-10-29T09:44:51Z |
| Crash recovery | the loop writes each job to the store as it queues it; the next run skips jobs already queued; `state.json` is retired | 7f3c2a91-4e5b-4d1a-9b8e-2c6d0f1a3b57 · approved 2026-10-29T09:44:51Z, done 2026-10-29T10:42:56Z |
| Workers | four reorder workers write to the store at once | 019a35d2-7c41-7e08-a3f1-5b9e2d6c4a10 · stated 2026-10-30T14:31:40Z, run green 2026-10-30T15:08:16Z |
| Runs | nightly at 02:00 local (01:00Z) | 25e645ab-8a84-4a82-a463-ac9edd2d31c0 · reorder.log read 2026-10-28T10:31:50Z (runs at 2026-10-27T02:00+01:00 and 2026-10-28T02:00+01:00) |
