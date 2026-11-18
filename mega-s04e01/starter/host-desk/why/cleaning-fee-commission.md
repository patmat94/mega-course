# Why no commission on the cleaning fee

**Decision:** the host keeps the whole cleaning fee; no commission is taken on it.

**Why:** the host asked for it (request r3), and it was built as written.

**So:** `cleaningFeePayout({ cleaningFee, commissionPct })` returns the fee in full whatever the commission. It fits after the commission: the fee is added to the host's amount untouched. Commission applies only to the nights (less discount) plus city tax. The result is not rounded here.

Glossary line: "Cleaning fee: paid to the host in full, no commission taken on it."
