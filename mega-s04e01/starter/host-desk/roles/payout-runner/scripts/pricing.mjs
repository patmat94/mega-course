// pricing.mjs — the host's payout, composing the rules in this order:
// nights x rate minus the long-stay discount (r1) + city tax (r2), then the house commission on both,
// then the cleaning fee in full (r3, no commission). Math.floor once, at the end only (why/payout-rounding.md).
import { longStayDiscount } from './rules/long-stay-discount.mjs';
import { cityTax } from './rules/city-tax.mjs';
import { cleaningFeePayout } from './rules/cleaning-fee-commission.mjs';

export function hostPayout({ nights, nightlyRate, cleaningFee, guests, bookedAt, commissionPct }) {
  const nightsAmount = nights * nightlyRate - longStayDiscount({ nights, nightlyRate });
  const tax = cityTax({ nights, guests, bookedAt });
  const afterCommission = ((nightsAmount + tax) * (100 - commissionPct)) / 100;
  return Math.floor(afterCommission + cleaningFeePayout({ cleaningFee, commissionPct }));
}
