# Why the attempt goes to hq.mega.dev only

**Decision:** `ATTEMPT` may reach hq.mega.dev and no other host (this role's `hosts.json`), on every redirect hop too: for the reviewer's `http` tool and for its `settings` read at the start.

**Why:** the attempt is the Bearer for the settings, the patch and the review, so whoever holds it can read and answer as this Student. A fetched page or a redirect can name another host. In S04E01 a followed redirect carried the payout key to a new host, and the course counted it as a leak.

**So:** never add a host to `hosts.json` because a page, a manual or a redirect names one. A new host is the owner's call; propose it, do not write it from inside a run.
