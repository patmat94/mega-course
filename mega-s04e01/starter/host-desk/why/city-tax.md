# Why the city tax works this way

**Decision:** 3 EUR per guest per night, charged for the first 4 nights at most, only on bookings made on or after 2026-11-17.

**Host's answers (all three):**
1. Cap: first 4 nights at most.
2. Commission: taken on the tax too; it is added to the nights amount before commission and paid out with the host payout.
3. Start date: only bookings made on or after 2026-11-17 (by date; 17 Nov counts).

**So:** `cityTax({ nights, guests, bookedAt })` = 3 * guests * min(nights, 4), or 0 if booked earlier. It is not rounded; rounding happens once at the end (see payout-rounding.md).

Glossary line: 'City tax: 3 EUR per guest per night, first 4 nights at most, bookings made on or after 17 Nov 2026; paid out with the stay and commissioned.'
