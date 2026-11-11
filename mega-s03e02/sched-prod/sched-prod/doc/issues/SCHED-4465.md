---
key: SCHED-4465
title: "API: rate-limit replies carry no Retry-After header"
status: open
labels: [agent-ready, from:client]
---

## Intent
When the API rate-limits a caller, the 429 reply carries a Retry-After header with the seconds until the limit resets.

## Acceptance
- Given a caller over the limit, when the API replies 429, then the reply has Retry-After with a whole number of seconds > 0.
- Given a caller under the limit, when it calls, then the reply does not carry a Retry-After header and is otherwise as today.
- Given the 429 reply, when it is sent, then its status and body are unchanged.
- A test covers both cases.

## Boundaries
- Must not change the rate limits themselves.
- Must not change any other reply field.

Allowed by AUT-1 (new columns, filters or fields that add to what is there and take nothing away).

## Request as filed
When the API rate-limits a caller, the 429 reply does not say when to try again. Add a Retry-After header.
