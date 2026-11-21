# scripts

Scripts the code tool runs live here. Each one gets the values from vars.json as environment variables.

- `tasks.mjs practice|run`: the routine work, all tasks in one go (the house rules of factory/CHECKLIST.md, in code).
- `finish.mjs run|practice [seconds]`: finishes each flagged task once, after the owner's decision.
- `job.mjs`: this role's rule for one task, from factory/make-a-role/jobs/<role>.mjs.
- `wire.mjs`: one request, every redirect hop checked against ../hosts.json and logged.
