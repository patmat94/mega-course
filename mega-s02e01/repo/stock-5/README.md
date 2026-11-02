# stock-5 · nightly reorder loop

The loop that queues tomorrow's reorders, one job per SKU per night.

- `plan-draft.md` — the plan as it was handed over.
- `plan.md` — the plan that holds. One row per decision: `Area | Choice | Source (session id + time)`.
