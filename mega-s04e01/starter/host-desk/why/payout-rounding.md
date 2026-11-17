# Why payouts round down

**Decision:** a host's payout is rounded down to whole EUR (`Math.floor`), never to the nearest EUR.

**Why:** the bank refuses any payout above the amount booked for the host. Rounding to the nearest EUR goes up for half of the stays, and one payout a cent over makes the bank refuse the whole batch. Rounding down keeps every payout at or under the booked amount.

**So:** the host may get up to 0.99 EUR less per stay. That is on purpose. Do not change it to `Math.round` or `Math.ceil`.
