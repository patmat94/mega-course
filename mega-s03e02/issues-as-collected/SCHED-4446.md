---
key: SCHED-4446
title: "CSV export: times carry no UTC offset"
status: open
labels: [from:analytics]
---

Start and end times in the CSV export have no offset, so every tool that reads them has to guess the zone. Add a UTC offset column next to them; the start and end columns stay as they are.
