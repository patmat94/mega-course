# Long-stay discount

Request r1: give 10 % off the nights for stays of 7 nights or more.

Read plainly, as the host asked ("build as written"):
- 10 % off the nights part only (nights x nightly rate).
- Applies at 7 nights or more; 6 nights gets nothing.
- Not applied to the cleaning fee.
- The discounted nights are what commission applies to (the discount comes before the commission).
- `longStayDiscount({ nights, nightlyRate })` returns the euros to subtract, not rounded.

Glossary line: Long-stay discount: 10 % off the nights for stays of 7 nights or more; not on the cleaning fee.
