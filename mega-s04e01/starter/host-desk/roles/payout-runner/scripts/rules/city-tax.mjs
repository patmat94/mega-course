// City tax: 3 EUR per guest per night, first 4 nights at most,
// only for bookings made on or after 2026-11-17. Not rounded.
export function cityTax({ nights, guests, bookedAt }) {
  const day = String(bookedAt).slice(0, 10);
  if (day < '2026-11-17') return 0;
  return 3 * guests * Math.min(nights, 4);
}
