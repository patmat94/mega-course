# scripts

Scripts the code tool runs live here. Each one gets the values from vars.json as environment variables; the rest of the environment, your model key too, does not.

| Script | What it does |
|---|---|
| `event.mjs` | Prints the event this start handles. |
| `change.mjs` | Records one change to a booking in `host-desk/night/changes.json`. |
| `result.mjs` | Writes the event's result for the poller to post. |
