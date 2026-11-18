// Long-stay discount: 10 % off the nights for stays of 7 nights or more.
// Returns the euros to subtract (not rounded). Not applied to the cleaning fee.
export function longStayDiscount({ nights, nightlyRate }) {
  if (nights < 7) return 0;
  return nights * nightlyRate * 0.1;
}
