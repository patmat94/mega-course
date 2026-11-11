---
key: SCHED-4465
title: "API: rate-limit replies carry no Retry-After header"
status: open
labels: [from:client]
---

When the API rate-limits a caller, the 429 reply does not say when to try again. Add a Retry-After header.
