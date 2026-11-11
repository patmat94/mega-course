---
key: SCHED-4446
title: "CSV export: times carry no UTC offset"
status: open
labels: [agent-ready, from:analytics]
---

## Intent
Add a UTC offset column next to the start and end times in the CSV export, so every tool knows the zone (ADR-0001).

## Acceptance
- Given a booking, when the export runs, then a new offset column (e.g. +13:00) sits next to start and end.
- Given the existing start and end columns, when the export runs, then they are not changed: same format and order of values (PRD-3, IN-2943).
- Given an account in a daylight-saving zone, when a booking falls on each side of the change, then each row carries its own offset.
- A test covers two zones and a daylight-saving change.

## Boundaries
- Must not change or remove the existing start and end columns.
- Must not change the date format (IN-7118 is open).

Allowed by AUT-1 (new columns, filters or fields that add to what is there and take nothing away).

## Request as filed
Start and end times in the CSV export have no offset, so every tool that reads them has to guess the zone. Add a UTC offset column next to them; the start and end columns stay as they are.
