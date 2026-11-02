# stock-5 · nightly reorder loop · job store — plan

_updated Fri 30 Oct 15:30 CEST_

| Area | Choice | Notes |
|------|--------|-------|
| Job store | SQLite file `data/reorder.db` | one box, survives a crash mid-run |
| ORM | Drizzle (`drizzle-orm` + `drizzle-kit`) | schema in `src/db/schema.ts` |
| Runs | nightly 02:00, four workers | |
