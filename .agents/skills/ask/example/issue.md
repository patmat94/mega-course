---
item: INV-212 · the invoices export times out for big months
from: interview-notes.md
---

## Intent

Make a month's invoices export finish for big months, so finance can still close the month from one file: they export it from the invoices page and paste its Total column into the board sheet. (A1)

## Acceptance

- Given a month with more invoices than the export handles today, when finance exports it from the invoices page, then they get one CSV file with every invoice of that month, not several files. (A1)
- Given that file, when finance filters on Status, then the cancelled invoices can still be taken out before the totals are pasted. (A3)

## Boundaries

- Must not rename, move or remove the Total and Status columns: finance pastes from Total and filters on Status. (A1, A3)
- Must not move the export off the invoices page. (A1)
