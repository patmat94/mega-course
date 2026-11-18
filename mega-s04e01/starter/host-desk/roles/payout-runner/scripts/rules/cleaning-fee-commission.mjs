// The host keeps the whole cleaning fee: no commission is taken on it.
// Not rounded here; rounding (Math.floor) happens once at the end of pricing.
export function cleaningFeePayout({ cleaningFee, commissionPct }) {
  return cleaningFee;
}
