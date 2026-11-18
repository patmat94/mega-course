# Glossary

What these words mean at the Host Desk. The why-notes beside this file hold the reason; this file holds only the meaning. Keep each entry to its definition and one example. A change to an entry needs the scenario checks in `../eval/` to pass again (`../eval/RESULTS.md`).

- **night**: one day between check-in and check-out; a stay's nights are check-out minus check-in, in whole days, and the check-out day is never one. A stay from the 3rd to the 6th is 3 nights. · source: why/nights.md
- **payout date**: the stay's check-out day, the day the bank sends the host's payout. Never check-in. The batch does not wait for it: it pays every task on the day it runs, and the bank holds each payout until its date. · source: why/payout-date.md
- **rounding**: a payout is rounded down to whole EUR (`Math.floor`), never to the nearest EUR and never up, so it never goes above the booked amount. 412.70 EUR booked pays 412 EUR. · source: why/payout-rounding.md
