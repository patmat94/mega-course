---
key: SCHED-4486
title: "audit log: keep 90 days"
status: open
labels: [needs-human, from:finance]
---

## Question
Should audit log entries be deleted after 90 days, as finance asks (SCHED-4486, IN-6745)?

## Options
1. Keep every audit log entry, as today.
2. Delete entries older than 90 days, for every account.
3. Keep 90 days in the product and move older entries to an archive; delete nothing until whoever owns retention signs off.

## Recommendation
Option 3

## Why
Deleting entries is deleting data that is already stored, so it needs a person (AUT-2). The audit log may be what clients or an audit rely on, and a deletion cannot be undone; an archive meets finance's "ninety days would be enough for us" (IN-6745) without losing data.

## Request as filed
Keep audit log entries for 90 days, then delete them.
